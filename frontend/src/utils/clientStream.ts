// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// clientStream.ts — TIER 0: DIRECT PLAYER API FROM THE USER'S DEVICE
// ───────────────────────────────────────────────────────────────────
// Every request goes straight to www.youtube.com from the device
// (CapacitorHttp on Android/iOS, plain fetch on web). No Render proxy,
// no Piped, no Invidious, no server-side video bytes.
//
// Flow:
//   1. WAA poToken minted in the browser (poTokenMint.ts)
//   2. visitorData read from the public embed page (youtubeDirect.ts)
//   3. ANDROID_VR / ANDROID player request with the device IP
//   4. Direct googlevideo URLs are returned and played by <video>
// ───────────────────────────────────────────────────────────────────

import { getEmbedBootstrap, youtubePlayerRequest, describePlayability } from './youtubeDirect';
import { getApiBaseUrl } from '../config';

const ANDROID_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '21.03.36',
  androidSdkVersion: 36,
  hl: 'en',
  gl: 'IN',
  userAgent: 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip',
  osName: 'Android',
  osVersion: '16'
};

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.65.10',
  androidSdkVersion: 32,
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  osName: 'Android',
  osVersion: '12L',
  clientFormFactor: 'SMALL_FACTOR',
  platform: 'MOBILE'
};

const WEB_EMBEDDED_CLIENT = {
  clientName: 'WEB_EMBEDDED_PLAYER',
  clientVersion: '2.20240101.01.00',
  clientScreen: 'EMBED',
  hl: 'en',
  gl: 'IN',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
};

// Adaptive H.264 (30fps) + AAC are the most reliable formats for the
// Android WebView <video> element. Muxed 18/22 are kept as fallbacks.
const SAFE_VIDEO_ITAGS = new Set([160, 133, 134, 135, 136, 137, 244, 247, 248]);
const MUXED_FALLBACK_ITAGS = new Set([18, 22]);
const SAFE_AUDIO_ITAGS = new Set([139, 140]);

const itagOf = (u) => parseInt((String(u || '').match(/[?&]itag=(\d+)/) || [])[1], 10);

// ─── IndexedDB cache (URLs expire, so TTL is enforced) ─────────────
let cachePromise = null;
const inFlightExtractions = new Map();

const openCache = () => {
  if (!cachePromise) {
    cachePromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('yt_client_stream_cache', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('streams')) {
          req.result.createObjectStore('streams', { keyPath: 'videoId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return cachePromise;
};

const getFromCache = async (videoId) => {
  try {
    const db = await openCache();
    return await new Promise((resolve) => {
      const tx = db.transaction('streams', 'readonly');
      const getReq = tx.objectStore('streams').get(videoId);
      getReq.onsuccess = () => {
        const entry = getReq.result;
        if (!entry || Date.now() >= entry.expiresAt) return resolve(null);
        const data = entry.data;
        const urls = [
          data && data.bestUrl,
          ...Object.values((data && data.qualityMap) || {}).map((e) => e && e.url),
          ...(data && data.audioOnlyFormats || []).map((a) => a && a.url)
        ].filter(Boolean);
        // A cached URL signed for a different network / IP will 403.
        // Do not reject the whole entry for a single unsafe itag; the
        // player retries with skipCache if playback fails.
        if (!urls.length) return resolve(null);
        resolve(data);
      };
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

const saveToCache = async (videoId, data, expiresAt) => {
  try {
    const db = await openCache();
    await new Promise((resolve) => {
      const tx = db.transaction('streams', 'readwrite');
      tx.objectStore('streams').put({ videoId, data, expiresAt });
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    // cache failure never blocks playback
  }
};

// ─── InnerTube player body ─────────────────────────────────────────
const buildPlayerBody = (client, videoId, opts = {}) => {
  const body = {
    context: {
      client: { ...client },
      request: { useSsl: true },
      user: { lockedSafetyMode: false }
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS'
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };
  if (opts.visitorData) body.context.client.visitorData = opts.visitorData;
  if (opts.poToken) body.serviceIntegrityDimensions = { poToken: opts.poToken };
  return body;
};

const pickFirst = (formats) => formats.find((f) => f && f.url) || null;

const buildConfig = (playerResponse, quality) => {
  const sd = playerResponse?.streamingData;
  if (!sd) throw new Error('No streamingData in player response');

  const combinedAll = (sd.formats || []).filter((f) => f && f.url);
  const videoAll = (sd.adaptiveFormats || []).filter(
    (f) => f && f.url && String(f.mimeType || '').startsWith('video/')
  );
  const audioAll = (sd.adaptiveFormats || []).filter(
    (f) => f && f.url && String(f.mimeType || '').startsWith('audio/')
  );

  let combined = combinedAll.filter((f) => {
    const itag = itagOf(f.url);
    return SAFE_VIDEO_ITAGS.has(itag) || MUXED_FALLBACK_ITAGS.has(itag);
  });
  let videoOnly = videoAll.filter((f) => SAFE_VIDEO_ITAGS.has(itagOf(f.url)));
  let audioOnly = audioAll.filter((f) => SAFE_AUDIO_ITAGS.has(itagOf(f.url)));

  // If YouTube only returned names outside the safe list, use whatever
  // direct URL it gave us instead of failing the whole tier.
  if (!combined.length && !videoOnly.length) {
    combined = combinedAll;
    videoOnly = videoAll;
  }
  if (!audioOnly.length) audioOnly = audioAll;

  if (!combined.length && !videoOnly.length && !audioOnly.length) {
    throw new Error('No direct-URL formats in player response (needs decipher tier)');
  }

  // Prefer H.264/AAC, then any codec.
  const h264Video = videoOnly.filter((f) => String(f.mimeType || '').includes('avc1'));
  if (h264Video.length) videoOnly = h264Video;
  const aacAudio = audioOnly.filter((f) => String(f.mimeType || '').includes('mp4a'));
  if (aacAudio.length) audioOnly = aacAudio;

  const qualityMap = {};

  // Adaptive video first (it has better range support than muxed 18).
  for (const f of videoOnly) {
    const h = f.height || 0;
    if (!h) continue;
    const label = `${h}p`;
    if (!qualityMap[label]) qualityMap[label] = { url: f.url, type: 'video_only' };
  }
  for (const f of combined) {
    const h = f.height || 0;
    if (!h) continue;
    const label = `${h}p`;
    if (!qualityMap[label]) qualityMap[label] = { url: f.url, type: 'combined' };
  }

  const audioUrl = pickFirst(audioOnly)?.url || '';
  const heights = Object.keys(qualityMap)
    .map((h) => parseInt(h, 10))
    .filter((h) => !isNaN(h))
    .sort((a, b) => a - b);

  let bestKey = null;
  const targetH = parseInt(String(quality || '').replace('p', ''), 10);
  if (!isNaN(targetH)) {
    const exact = heights.find((h) => h === targetH);
    const below = heights.filter((h) => h < targetH).pop();
    if (exact) bestKey = `${exact}p`;
    else if (below) bestKey = `${below}p`;
  }
  if (!bestKey && heights.length) bestKey = `${heights[heights.length - 1]}p`;
  if (!bestKey && qualityMap.auto) bestKey = 'auto';

  const bestUrl = bestKey && qualityMap[bestKey] ? qualityMap[bestKey].url : pickFirst(combined)?.url || pickFirst(videoOnly)?.url;
  if (!bestUrl) throw new Error('No playable URL from direct player response');

  return {
    bestUrl,
    bestQuality: bestKey,
    qualityMap,
    audioOnlyFormats: audioUrl ? [{ url: audioUrl }] : []
  };
};

const getExpiry = (config) => {
  const urls = [
    config.bestUrl,
    ...Object.values(config.qualityMap || {}).map((e) => e.url),
    ...(config.audioOnlyFormats || []).map((a) => a.url)
  ].filter(Boolean);

  let minExpire = Infinity;
  for (const u of urls) {
    try {
      const exp = parseInt(new URL(u).searchParams.get('expire'), 10);
      if (!isNaN(exp)) minExpire = Math.min(minExpire, exp);
    } catch {
      // skip invalid URL
    }
  }
  if (!isFinite(minExpire)) return Date.now() + 6 * 60 * 60 * 1000;
  return minExpire * 1000 - 60 * 1000;
};

const getAndroidClient = () => {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return { ...ANDROID_CLIENT, hl: lang.split('-')[0] };
};

const getAndroidVrClient = () => {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return { ...ANDROID_VR_CLIENT, hl: lang.split('-')[0] };
};

const getWebEmbeddedClient = () => {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return { ...WEB_EMBEDDED_CLIENT, hl: lang.split('-')[0] };
};

// ─── MAIN: direct player request from the user's device ───────────
export const getClientDirectStream = async (videoId, quality = 'auto', opts = {}) => {
  const cached = opts.skipCache ? null : await getFromCache(videoId);
  if (cached) {
    return { ...cached, source: 'client-cache' };
  }

  if (inFlightExtractions.has(videoId)) {
    return inFlightExtractions.get(videoId);
  }

  const extraction = (async () => {
    const deadline = Date.now() + (opts.deadlineMs || 40000);
    let lastErr = null;

    let poToken = opts.poToken || null;
    if (!poToken) {
      try {
        const { getMintedPoToken } = await import('./poTokenMint');
        poToken = await getMintedPoToken(videoId, (m) => console.log('[clientStream]', m));
      } catch (e) {
        console.warn('[clientStream] poToken mint failed:', e?.message || e);
      }
    }

    let visitorData = opts.visitorData || '';
    if (!visitorData) {
      try {
        const boot = await getEmbedBootstrap(videoId);
        visitorData = boot?.visitorData || '';
      } catch {
        // visitorData is optional
      }
    }

    const attempts = [];
    if (poToken) {
      attempts.push(
        { label: 'ANDROID_VR', client: getAndroidVrClient(), poToken },
        { label: 'ANDROID', client: getAndroidClient(), poToken }
      );
    }
    attempts.push(
      { label: 'ANDROID_VR', client: getAndroidVrClient(), poToken: null },
      { label: 'ANDROID', client: getAndroidClient(), poToken: null }
    );
    if (poToken) {
      attempts.push({ label: 'WEB_EMBEDDED_PLAYER', client: getWebEmbeddedClient(), poToken });
    }

    for (const attempt of attempts) {
      if (Date.now() > deadline) {
        lastErr = lastErr || new Error('Direct player deadline exceeded');
        break;
      }
      try {
        const body = buildPlayerBody(attempt.client, videoId, {
          poToken: attempt.poToken,
          visitorData
        });
        const data = await youtubePlayerRequest({
          body,
          clientName: attempt.label,
          clientVersion: attempt.client.clientVersion,
          videoId
        });

        if (data?.playabilityStatus?.status !== 'OK' || !data.streamingData) {
          const reason = describePlayability(data);
          console.log(`[clientStream] ${attempt.label}${attempt.poToken ? '+pot' : ''} -> ${reason}`);
          lastErr = new Error(`${attempt.label}: ${reason}`);
          continue;
        }

        const config = buildConfig(data, quality);
        const expiresAt = getExpiry(config);
        saveToCache(videoId, config, expiresAt);
        console.log(`[clientStream] OK ${attempt.label}${attempt.poToken ? '+pot' : ''}: ${config.bestQuality || 'auto'}`);
        return {
          ...config,
          source: 'client-direct',
          client: `${attempt.label}${attempt.poToken ? '+pot' : ''}`,
          visitorData: data?.responseContext?.visitorData || visitorData,
          poToken: attempt.poToken || ''
        };
      } catch (e) {
        lastErr = e;
        console.log(`[clientStream] ${attempt.label}${attempt.poToken ? '+pot' : ''} failed:`, e?.message || e);
      }
    }

    throw lastErr || new Error('All direct player attempts failed');
  })();

  inFlightExtractions.set(videoId, extraction);
  try {
    return await extraction;
  } finally {
    inFlightExtractions.delete(videoId);
  }
};

// Pre-warm intentionally disabled: it used to fire 12 extra player
// requests on every home-feed load. Direct playback is fast enough
// without it and this keeps YouTube quota/rate-limit pressure low.
export const prewarmVideos = () => {};

// ─── Source reporting (metadata only; no video bytes) ─────────────
export const reportStreamSource = (videoId, source) => {
  try {
    const backendBase = getApiBaseUrl();
    fetch(`${backendBase}/stream/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, source }),
      keepalive: true
    }).catch(() => {
      // reporting is best-effort
    });
  } catch {
    // ignore
  }
};

export default {
  getClientDirectStream,
  prewarmVideos,
  reportStreamSource
};
