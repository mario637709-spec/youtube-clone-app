// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// clientStream.ts — TIER 0: DIRECT CLIENT-SIDE STREAM EXTRACTION
// ───────────────────────────────────────────────────────────────────
// Google ka khud ka sandbox youtubei endpoint (CORS: *) + ANDROID
// client (PO token nahi chahiye, BotGuard bypass) = direct
// googlevideo URLs jo USER KE APNE IP se sign hote hain.
// Server bandwidth = 0. IP-lock errors = 0. Rate limits = per-user IP.
// URL 6 ghante valid -> IndexedDB cache me rakha jata hai.
// ───────────────────────────────────────────────────────────────────

import { getApiBaseUrl } from '../config';

const SANDBOX_PLAYER_URL = 'https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player?prettyPrint=false';

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

// ─── ANDROID_VR client (PRIMARY) — pot-bound session ke saath itag=315
//     (4K) spc URL deta hai jo FULL FILE serve karta hai (deep2000M=206
//     verified 9 Aug 2026). Flaky: kabhi LOGIN_REQUIRED → retry loop.
const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.65.10',
  androidSdkVersion: 32,
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  osName: 'Android',
  osVersion: '12L',
  clientFormFactor: 'SMALL_FORM_FACTOR',
  platform: 'MOBILE'
};

const WEB_EMBEDDED_CLIENT = {
  clientName: 'WEB_EMBEDDED_PLAYER',
  clientVersion: '2.20240101.01.00',
  clientScreen: 'EMBED',
  hl: 'en',
  gl: 'IN',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

// ─── IndexedDB cache (URLs expire ~6h, isliye TTL rakhte hain) ────
let cachePromise = null;
// In-flight dedupe — page pre-warm + player dono ek hi videoId ke liye
// concurrent calls kar sakte hain; coalesce karke sandbox pe SIRF 1
// player request jaati hai (2026-08).
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
        // 2026-08-15: Purane cached URLs ab googlevideo pe open-ended
        // Range pe 403 dete hain (muxed itag 18, 60fps itag 298/299/315).
        // Unhe stale maano taki fresh safe-itag (136 etc.) extraction ho.
        // NOTE: SIRF bestUrl nahi — qualityMap ke HAR URL ka itag check
        // karo. VideoPlayer quality='auto' pe qualityMap[suggested] pick
        // karta hai (360p → itag 18 poison entry!) — wo bhi reject.
        const urls = [
          data && data.bestUrl,
          ...Object.values((data && data.qualityMap) || {}).map(e => e && e.url),
          ...(data && data.audioOnlyFormats || []).map(a => a && a.url)
        ].filter(Boolean);
        if (urls.some(u => !SAFE_VIDEO_ITAGS.has(itagOf(u)) && !SAFE_AUDIO_ITAGS.has(itagOf(u)))) {
          return resolve(null);
        }
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
    // cache fail = stream chalega, bas cache miss hoga
  }
};

// ─── Player API call (sandbox pehle, www.youtube.com proxy backup) ─
const clientHeaderId = (clientName) => {
  if (clientName === 'WEB') return '1';
  if (clientName === 'WEB_EMBEDDED_PLAYER') return '56';
  return '3'; // ANDROID
};

const apiBase = () =>
  getApiBaseUrl();

const PROXY_BASE = () => `${apiBase()}/videos/proxy/cors?url=`;

const callPlayerApi = async (url, body, clientName = 'ANDROID', opts = {}) => {
  const clientVersion = body?.context?.client?.clientVersion || ANDROID_CLIENT.clientVersion;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 8000); // Tier 0 must fail fast → proxy fallback
  try {
    // pot-bound attempts: www.youtube.com via backend proxy (ANDROID_VR
    // sandbox pe hamesha LOGIN_REQUIRED deta hai, www pe pot ke saath
    // chalta hai — verified 9 Aug 2026: itag=315 4K FULL FILE!)
    const viaProxy = opts.useProxy || url === 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
    const headers = {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': clientHeaderId(clientName),
      'X-Youtube-Client-Version': clientVersion,
      'Origin': 'https://www.youtube.com'
    };
    // ANDROID family: google real client headers (youtubei.js HTTPClient ke
    // jaisa) — bina User-Agent ke ANDROID_VR LOGIN_REQUIRED deta hai.
    if (clientName.startsWith('ANDROID')) {
      headers['User-Agent'] = body?.context?.client?.userAgent || ANDROID_CLIENT.userAgent;
      headers['X-GOOG-API-FORMAT-VERSION'] = '2';
    }
    const res = await fetch(viaProxy ? `${PROXY_BASE()}${encodeURIComponent(url)}` : url, {
      method: 'POST',
      mode: 'cors',
      signal: controller.signal,
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Player API HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
};

// ─── InnerTube player request body (poToken/visitorData aware) ─────
const buildPlayerBody = (client, videoId, opts = {}) => {
  const body = {
    context: {
      client: { ...client },
      request: { useSsl: true },
      user: { lockedSafetyMode: false }
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };
  if (opts.visitorData) body.context.client.visitorData = opts.visitorData;
  if (opts.poToken) body.serviceIntegrityDimensions = { poToken: opts.poToken };
  return body;
};

// ─── ANDROID/WEB formats me direct `url` hota hai (no cipher) ─────
// 2026-08-15: googlevideo ab open-ended Range (bytes=0-) — jo browser
// <video> ALWAYS bhejta hai — ko 403 deta hai for:
//   ❌ muxed itag 18 (bina keepalive=yes)
//   ❌ 60fps formats (itag 298/299/302/308/315) — verified 403
// ✅ Verified 206 playable: itag 160/134/135/136/137 (H.264 30fps) +
//    audio 139/140. Inhi ko direct browser playback ke liye chuno.
const SAFE_VIDEO_ITAGS = new Set([160, 133, 134, 135, 136, 137, 244, 247, 248]);
const SAFE_AUDIO_ITAGS = new Set([139, 140]);
const itagOf = (u) => parseInt((u.match(/itag=(\d+)/) || [])[1], 10);

const buildConfig = (playerResponse, quality) => {
  const sd = playerResponse?.streamingData;
  if (!sd) throw new Error('No streamingData in player response');

  const hasAnyFormats = (sd.formats?.length || 0) + (sd.adaptiveFormats?.length || 0) > 0;

  // Only direct-`url` formats (no cipher) AND safe-itag ones survive.
  const combined = (sd.formats || [])
    .filter(f => f.url && SAFE_VIDEO_ITAGS.has(itagOf(f.url)))
    .map(f => ({ ...f, _type: 'combined' }));

  const videoOnly = (sd.adaptiveFormats || [])
    .filter(f => f.mimeType?.startsWith('video/') && f.url && SAFE_VIDEO_ITAGS.has(itagOf(f.url)))
    .map(f => ({ ...f, _type: 'video_only' }));

  const audioOnly = (sd.adaptiveFormats || [])
    .filter(f => f.mimeType?.startsWith('audio/') && f.url && SAFE_AUDIO_ITAGS.has(itagOf(f.url)))
    .map(f => ({ ...f, _type: 'audio_only' }));

  // Formats exist but every one is ciphered (signatureCipher/cipher, no url) —
  // WEB-family client case. Clear error so VideoPlayer falls through to Tier 1 decipher.
  if (hasAnyFormats && combined.length === 0 && videoOnly.length === 0 && audioOnly.length === 0) {
    throw new Error('Only ciphered formats returned (needs Tier 1 browser decipher)');
  }
  // All formats exist but none are safe-itag (muxed-18/60fps-only response) →
  // proxy fallback se bhi play ho jata hai, clear error do.
  if (combined.length === 0 && videoOnly.length === 0 && audioOnly.length === 0) {
    throw new Error('No browser-playable (safe-itag) formats from client extraction');
  }

  const qualityMap = {};
  // 2026-08-15 FIX: YouTube googlevideo ab open-ended Range (bytes=0-)
  // ko 403 deta hai SIRF muxed itag 18 (bina keepalive=yes) pe. Adaptive
  // video-only formats (itag 134+/139+, keepalive=yes) 206 dete hain —
  // browser <video> direct play kar sakta hai. Isliye video_only ko
  // combined (muxed) se PEHLE priority do; itag 18 sirf tab jab koi
  // adaptive na ho. Audio player ke alag element me jata hai
  // (audioOnlyFormats), isliye video-only se koi problem nahi.
  for (const f of videoOnly) {
    const h = f.height || 0;
    if (!h) continue;
    if (!qualityMap[`${h}p`]) {
      qualityMap[`${h}p`] = { url: f.url, type: 'video_only' };
    }
  }
  for (const f of combined) {
    const h = f.height || 0;
    if (!h) continue;
    if (!qualityMap[`${h}p`]) {
      qualityMap[`${h}p`] = { url: f.url, type: 'combined' };
    }
  }

  const audioUrl = audioOnly[0]?.url || '';

  const heights = Object.keys(qualityMap)
    .map(h => parseInt(h, 10))
    .filter(h => !isNaN(h))
    .sort((a, b) => a - b);

  let bestUrl = null;
  let bestQuality = null;

  const pickByQuality = (target) => {
    if (!target) return null;
    // Accept both numeric height (360) and "360p" labels.
    const targetH = parseInt(String(target).replace('p', ''), 10);
    if (isNaN(targetH)) return null;
    const exact = heights.find(h => h === targetH);
    if (exact) return `${exact}p`;
    const below = heights.filter(h => h < targetH).pop();
    if (below) return `${below}p`;
    return heights[0] ? `${heights[0]}p` : null;
  };

  let bestKey = pickByQuality(quality);
  if (!bestKey && heights.length > 0) bestKey = `${heights[heights.length - 1]}p`;
  if (bestKey && qualityMap[bestKey]) {
    bestUrl = qualityMap[bestKey].url;
    bestQuality = bestKey;
  }
  if (!bestUrl && heights.length > 0) {
    bestUrl = qualityMap[`${heights[0]}p`]?.url || null;
    bestQuality = `${heights[0]}p`;
  }

  if (!bestUrl) throw new Error('No playable URL from client extraction');

  return {
    bestUrl,
    bestQuality,
    qualityMap,
    audioOnlyFormats: audioUrl ? [{ url: audioUrl }] : []
  };
};

// ─── URL expiry (googlevideo `expire` param, epoch seconds) ───────
const getExpiry = (config) => {
  const urls = [
    config.bestUrl,
    ...Object.values(config.qualityMap || {}).map(e => e.url),
    ...(config.audioOnlyFormats || []).map(a => a.url)
  ].filter(Boolean);

  let minExpire = Infinity;
  for (const u of urls) {
    try {
      const exp = parseInt(new URL(u).searchParams.get('expire'), 10);
      if (!isNaN(exp)) minExpire = Math.min(minExpire, exp);
    } catch {
      // invalid URL format, skip
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

// ─── MAIN: Get direct stream config from the user's own device ────
// Tier 0 flow:
//   (a) ANDROID_VR + poToken — THE WINNER: pot-bound session ke saath
//       itag=315 (4K) spc URL milta hai jo FULL FILE serve karta hai
//       (deep2000M=206 verified). Bina pot: LOGIN_REQUIRED flaky.
//   (b) ANDROID + poToken — itag=18 (360p muxed) spc, FULL FILE.
//   (c) ANDROID_VR / ANDROID bina pot — fast path, kabhi kaam kare.
//   (d) WEB_EMBEDDED_PLAYER + poToken + visitorData via the sandbox
//       (only if (a)+(b)+(c) fail — PO token fetch is slow). Formats
//       mostly ciphered → buildConfig throws clear error → Tier 1.
export const getClientDirectStream = async (videoId, quality = 'auto', opts = {}) => {
  const cached = opts.skipCache ? null : await getFromCache(videoId);
  if (cached) {
    return { ...cached, source: 'client-cache' };
  }

  // Coalesce: page pre-warm + player can fire for the same videoId
  // simultaneously — share ONE extraction instead of two player calls.
  if (inFlightExtractions.has(videoId)) {
    return inFlightExtractions.get(videoId);
  }
  const extraction = (async () => {
  let lastErr = null;

  // ---- Phase 1 (FAST): POT-BOUND ANDROID_VR / ANDROID via backend CORS proxy ----
  // 2026-08-13 FIX: Google ne sandbox (release-youtubei.sandbox.google
  // apis.com) pe no-token ANDROID client POSTs band kar diye: browser
  // verification ANDROID_VR=404, ANDROID=400, preflight OPTIONS=403.
  // POT-BOUND ANDROID_VR via www.youtube.com THROUGH backend
  // /api/videos/proxy/cors relay = 200 + FULL quality map incl MUXED
  // itag 18 (360p). The googlevideo URL plays DIRECTLY in a <video>
  // element (verified 640x360 2587s, no crossOrigin needed). Server
  // bandwidth stays ~0: only the small JSON player request transits;
  // video bytes go browser->CDN. No-token sandbox path removed (dead).
  // Phase 2 removed too - WEB_EMBEDDED goes last (keep below).

  // Phase 2 (was Phase 1): POT-BOUND ANDROID_VR / ANDROID — only reached
  // when the fast no-token attempts failed. 4K (itag 315) full-file
  // requires this path but it costs server round trips → don't block
  // the player deadline on it unless Phase 1 proved unreachable.
  let poToken = opts.poToken || null;
  if (!poToken) {
    try {
      const { getMintedPoToken } = await import('./poTokenMint');
      poToken = await getMintedPoToken(videoId, (m) => console.log('[clientStream]', m));
    } catch (e) {
      console.warn('[clientStream] poToken mint failed:', e.message);
    }
  }
  if (poToken) {
    const potUrl = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
    // visitorData: youtubei.js session me hota hai aur ANDROID_VR ke
    // LOGIN_REQUIRED risk ko kam karta hai — player-bootstrap se milega.
    let visitorData = opts.visitorData || '';
    if (!visitorData) {
      try {
        const { getPoTokenBootstrap } = await import('./browserPoToken');
        const boot = await getPoTokenBootstrap(videoId);
        visitorData = boot?.visitorData || '';
      } catch { /* visitor optional */ }
    }
    for (let i = 0; i < 3; i++) {
      for (const attempt of [
        { label: 'ANDROID_VR', client: getAndroidVrClient() },
        { label: 'ANDROID', client: getAndroidClient() }
      ]) {
        try {
          const body = buildPlayerBody(attempt.client, videoId, { poToken, visitorData });
          const data = await callPlayerApi(potUrl, body, attempt.label, { useProxy: true });
          if (data?.playabilityStatus?.status !== 'OK' || !data.streamingData) {
            console.log(`[clientStream] ${attempt.label}+pot attempt ${i}: playability ${data?.playabilityStatus?.status}`);
            continue;
          }
          const config = buildConfig(data, quality);
          const expiresAt = getExpiry(config);
          saveToCache(videoId, config, expiresAt);
          console.log(`[clientStream] ✅ ${attempt.label}+pot OK: ${config.bestUrl.substring(0, 80)}...`);
          return {
            ...config,
            source: 'client-direct',
            client: `${attempt.label}+pot`,
            visitorData: data?.responseContext?.visitorData || ''
          };
        } catch (e) {
          lastErr = e;
          console.log(`[clientStream] ${attempt.label}+pot attempt ${i} failed:`, e.message);
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Phase 3: WEB_EMBEDDED_PLAYER + poToken (slowest, last resort)
  let webOpts = opts;
  if (!webOpts.poToken) {
    try {
      const { getBrowserPoToken } = await import('./browserPoToken');
      // PO-token generation (base.js eval) can take ~25s — never stall the
      // stream on it. Race with a 6s cap; token resolves in the background
      // for later tiers if it ever completes.
      const tokenData = await Promise.race([
        getBrowserPoToken(),
        new Promise((r) => setTimeout(() => r(null), 6000))
      ]);
      if (tokenData && tokenData.poToken) {
        webOpts = { poToken: tokenData.poToken, visitorData: tokenData.visitorData || '' };
        console.log('[clientStream] Got PO token for WEB_EMBEDDED attempt');
      } else {
        console.log('[clientStream] No PO token available — WEB_EMBEDDED attempt skipped');
      }
    } catch (e) {
      console.warn('[clientStream] PO token fetch failed:', e.message);
    }
  }
  if (webOpts.poToken) {
    const webBody = buildPlayerBody(getWebEmbeddedClient(), videoId, {
      poToken: webOpts.poToken,
      visitorData: webOpts.visitorData
    });
    try {
      const data = await callPlayerApi(SANDBOX_PLAYER_URL, webBody, 'WEB_EMBEDDED');
      if (data?.playabilityStatus?.status === 'OK' && data.streamingData) {
        const config = buildConfig(data, quality);
        const expiresAt = getExpiry(config);
        saveToCache(videoId, config, expiresAt);
        return {
          ...config,
          source: 'client-direct',
          client: 'WEB_EMBEDDED',
          visitorData: data?.responseContext?.visitorData || webOpts.visitorData || ''
        };
      }
    } catch (e) {
      lastErr = e;
      console.log('[clientStream] WEB_EMBEDDED attempt failed:', e.message);
    }
  }

  throw lastErr || new Error('All player endpoints failed');
  })();

  inFlightExtractions.set(videoId, extraction);
  try {
    return await extraction;
  } finally {
    inFlightExtractions.delete(videoId);
  }
};

// ─── Batch pre-warm: home feed ke top videos ke CDN URLs IndexedDB
// cache me daal deta hai taaki watch page turant (cache hit) play kare.
// Concurrency-limited + fire-and-forget — kabhi UI block nahi karta.
// in-flight dedupe (above) ensure karta hai ki same videoId ke liye
// sirf EK player call ho, chahe prewarm + hover + player sab chalein.
export const prewarmVideos = (videos, max = 12, concurrency = 3) => {
  try {
    const ids = [];
    for (const v of videos || []) {
      const id = v.youtube_id || v.id || (v.videoUrl && v.videoUrl.match(/(?:embed\/|v\/|v=)([a-zA-Z0-9_-]{11})/)?.[1]);
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id) && !ids.includes(id)) {
        ids.push(id);
        if (ids.length >= max) break;
      }
    }
    if (ids.length === 0) return;
    // Idle/background priority: browser pehle page render ho, pre-warm
    // baad me (2s ke baad) chale taaki hero/cards jaldi dikhein.
    const run = () => {
      let i = 0;
      const worker = async () => {
        while (i < ids.length) {
          const id = ids[i++];
          try {
            const existing = await getFromCache(id);
            if (existing) continue; // already warm
            await getClientDirectStream(id, '720p', {});
          } catch { /* prewarm fail = bas cache miss, playback ab bhi try karega */ }
        }
      };
      const n = Math.max(1, Math.min(concurrency, ids.length));
      for (let k = 0; k < n; k++) worker();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => run(), { timeout: 3000 });
    } else {
      setTimeout(run, 2000);
    }
  } catch {
    // pre-warm me koi bhi error playback flow ko nahi todta
  }
};

// ─── Source reporting (server ke /api/stream/stats ke liye) ───────
export const reportStreamSource = (videoId, source) => {  try {
    const backendBase = getApiBaseUrl();
    fetch(`${backendBase}/stream/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, source }),
      keepalive: true
    }).catch(() => {
      // reporting fail hone se playback pe koi asar nahi
    });
  } catch {
    // ignore
  }
};
