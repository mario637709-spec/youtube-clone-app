/**
 * ═══════════════════════════════════════════════════════════════════
 *  MICROSERVICE 2: urlExtractor.js
 *  ─────────────────────────────────────────────────────────────────
 *  📋 KYA KARTA HAI:
 *     YouTube video ID se raw googlevideo.com CDN URL nikalta hai.
 *
 *  ⚠️ 2026 STATUS (Google attestation):
 *     - ANDROID client → 400 FAILED_PRECONDITION (server-side botguard
 *       attestation added by Google). REMOVED from the chain.
 *     - IOS client → kaam karta hai SIRF agar clientVersion FRESH hai.
 *       (19.45.4 → 400 FAILED_PRECONDITION, 20.42.4 → 200 OK).
 *       IOS URLs come pre-signed (sig) and WITHOUT the `n`/nsig param,
 *       so no nsig transformation is needed for this client.
 *     - WEB_EMBEDDED_PLAYER → needs poToken + visitorData.
 *
 *  ✅ FALLBACK CHAIN (parallel race → last resort):
 *     1. ANDROID_VR + IOS + WEB_EMBEDDED race IN PARALLEL
 *        (fastest method wins, typically IOS ~1s / ANDROID_VR ~500ms)
 *     2. ytdl-core (IOS)                      — last resort
 *
 *  📌 NSIG (`n` param) NOTE:
 *     The current player script obfuscates the nsig function `bOa`
 *     (ytdl-core itself warns "Could not parse n transform function",
 *     distube issue #144). URLs carrying an untransformed `n` param
 *     get 403 from googlevideo. The IOS client (fresh) returns URLs
 *     WITHOUT `n` → 403 root cause removed at the source. If a format
 *     still carries `n`, we log a warning (it would 403 in a browser).
 *
 *  ⚡ CACHE STRATEGY:
 *     URL 55 min cache mein rehta hai
 *     Same video ke 50 users → sirf 1 extraction (coalescing)
 *     `force: true` bypasses the cache (used on CDN 403/410 re-extract)
 * ═══════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const dns = require('dns');
const https = require('https');
const http = require('http');

// ─── DNS cache + keep-alive agents (flaky mobile hotspot!) ────────
// Every axios call was doing a FRESH DNS lookup; on this hotspot
// `getaddrinfo ENOTFOUND www.youtube.com` strikes intermittently and
// killed extraction even when the network was fine. Cache lookups for
// 60s and reuse sockets via keep-alive agents so DNS flakiness can't
// take the whole extraction down. (Verified 2026-08: server.err.log
// was full of ENOTFOUND while other network was working.)
const dnsCache = new Map();
const cachedLookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (typeof options === 'number') options = { family: options };
  const family = options.family || 0;
  const key = `${hostname}|${family}`;
  const hit = dnsCache.get(key);
  if (hit && hit.expires > Date.now()) {
    return process.nextTick(callback, null, hit.address, hit.family);
  }
  dns.lookup(hostname, { ...options, family }, (err, address, fam) => {
    if (!err) dnsCache.set(key, { address, family: fam, expires: Date.now() + 60000 });
    callback(err, address, fam);
  });
};
const extractorAgent = new https.Agent({ keepAlive: true, maxSockets: 100, lookup: cachedLookup });
const extractorHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, lookup: cachedLookup });
const AXIOS_AGENTS = { httpsAgent: extractorAgent, httpAgent: extractorHttpAgent };

// ─── InnerTube endpoint ─────────────────────────────────────────
// SANDBOX first: www.youtube.com from this IP returns "Sign in to
// confirm you're not a bot" (400) while the googleapis sandbox host
// serves the same API without the bot check. Verified 2026-08.
const PLAYER_ENDPOINTS = [
  'https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player',
  'https://www.youtube.com/youtubei/v1/player',
];

// ─── URL Cache (videoId → { url, quality, expires }) ─────────────
const urlCache = new Map();
// ─── Active Extractions (prevent duplicate API calls) ─────────────
const activeExtractions = new Map();

// ─── Cache TTL: 55 minutes (CDN URLs expire ~6 hours, safe margin) ─
const CACHE_TTL_MS = 55 * 60 * 1000;

// ─── Hard timeouts — without these the chain can hang forever ─────
// Primary race: even if every method is stuck, we move on in 6s.
const PRIMARY_RACE_TIMEOUT_MS = 6000;
// ytdl-core has NO internal timeout — cap it ourselves (verified 2026-08:
// a stuck ytdl.getInfo kept requests pending 60s+ while the client waited).
const YTDL_TIMEOUT_MS = 8000;
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);

// ─── ANDROID_VR InnerTube Client (PRIMARY since 2026-08) ────────
// IOS URLs now get 403 from googlevideo (GVS PO-token enforcement)
// while ANDROID_VR URLs return 206 video/mp4 WITHOUT any PO token.
// Verified 2026-08: playability OK, direct url, CDN serves bytes.
const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.52.26',
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.52.26 (Linux; U; Android 12; eureka_user 1.52.26.0) gzip',
  osName: 'Android',
  osVersion: '12',
};

// ─── IOS InnerTube Client (FRESH version — required since 2026) ──
// Older versions (19.x) now hit "Precondition check failed" (400).
const IOS_CLIENT = {
  clientName: 'IOS',
  clientVersion: '20.42.4',
  deviceModel: 'iPhone17,2',
  userAgent: 'com.google.ios.youtube/20.42.4 (iPhone17,2; U; CPU iOS 18_3_1 like Mac OS X)',
  osName: 'iPhone',
  osVersion: '18.3.1',
};

// ─── WEB_EMBEDDED client config (used with poToken fallback) ─────
const WEB_EMBEDDED_CLIENT = {
  clientName: 'WEB_EMBEDDED_PLAYER',
  clientVersion: '1.20260807.00.00',
  clientScreen: 'EMBED',
  hl: 'en',
};

// ─── poToken cache (visitorData + poToken pair, ~30 min TTL) ─────
let poTokenCache = null;
let poTokenGenerating = null;

// ─── Generate (and cache) visitorData + poToken via po-token-gen ──
const getPoToken = async () => {
  if (poTokenCache && Date.now() < poTokenCache.expires) {
    return poTokenCache;
  }
  if (poTokenGenerating) return poTokenGenerating;

  poTokenGenerating = (async () => {
    const { generate } = require('youtube-po-token-generator');
    // generate() runs a headless eval and CAN hang — cap it so the
    // primary race always settles (verified 2026-08).
    const { visitorData, poToken } = await withTimeout(generate(), 6000, 'poToken generate');
    const pair = { visitorData, poToken, expires: Date.now() + 30 * 60 * 1000 };
    poTokenCache = pair;
    return pair;
  })();

  try {
    return await poTokenGenerating;
  } finally {
    poTokenGenerating = null;
  }
};

// ─── Choose best format from player response ──────────────────────
// Prefers muxed (video+audio) formats, then mp4 over webm (browser
// compatibility), matching `preferQuality` without exceeding it.
// ⚠️ 2026-08: ALWAYS prefer muxed — even when the target is 1080p+,
// fall back to the best muxed ≤720p instead of serving video-only.
// A video-only stream forces a SECOND parallel download for audio,
// which starves flaky connections (1s play / 1s buffer churn).
// Muxed formats carry audio tracks; video-only adaptive formats carry
// NONE of these. `mimeType` alone can't tell them apart (a video-only
// format's mime string is "video/mp4; codecs=\"avc1...\"" — same shape
// as muxed), so checking codecs/count of codecs is the reliable signal.
const isMuxed = (f) => {
  if (!f.mimeType?.includes('video')) return false;
  if (f.hasAudio === true) return true;
  if (f.audioChannels || f.audioBitrate) return true;
  const codecs = (f.mimeType.match(/codecs="([^"]+)"/) || [])[1] || '';
  return codecs.includes(',');
};

const chooseBestFormat = (formats, preferQuality = 'auto') => {
  if (!formats || formats.length === 0) return null;

  // ─── Audio-only request: best mp4 audio (itag 140 over 139/249/250) ──
  if (preferQuality === 'audio') {
    const audioFormats = formats.filter(f => f.mimeType?.startsWith('audio/'));
    if (audioFormats.length === 0) return null;
    const rank = (f) => (f.mimeType?.includes('audio/mp4') ? 0 : f.itag === 140 ? 0 : 1);
    return audioFormats
      .sort((a, b) => rank(a) - rank(b) || (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
  }

  // Filter: must have both video + audio (muxed), or at least video.
  // ⚠️ 3gp (itag 17, the only muxed "144p") is NOT playable in Chrome —
  // exclude it whenever any webm/mp4 muxed exists. (2026-08)
  const all = formats.filter(f => f.url);
  const playable = all.filter(f => !f.mimeType?.includes('3gpp'));
  const pool = playable.length > 0 ? playable : all;

  const muxed = pool.filter(isMuxed);
  const candidates = muxed.length > 0 ? muxed : pool;

  const mp4Rank = (f) => (f.mimeType?.includes('video/mp4') ? 0 : 1);

  // Quality preference. Browsers can't play 3gp muxed formats (itag 17),
  // so if only 3gp exists under 360p the playable-filter already handles
  // it. IOS/ANDROID_VR expose real 240p/144p mp4 adaptive formats with
  // separate audio, so map them to their true heights (240p keeps the
  // slow-hotspot fast path as cheap as possible).
  const qualityMap = { '1080p': 1080, '720p': 720, '480p': 480, '360p': 360, '240p': 240, '144p': 240 };
  const targetHeight = qualityMap[preferQuality] || 720;

  // Try to find exact quality match (mp4 preferred)
  let best = candidates
    .filter(f => f.height === targetHeight)
    .sort((a, b) => mp4Rank(a) - mp4Rank(b))[0];

  if (!best) {
    // Find closest quality ≤ target (don't exceed what's asked)
    const belowTarget = candidates
      .filter(f => f.height && f.height <= targetHeight)
      .sort((a, b) => b.height - a.height || mp4Rank(a) - mp4Rank(b));
    best = belowTarget[0];
  }

  // Fallback: just pick highest available (mp4 preferred)
  if (!best) {
    best = candidates.sort((a, b) => (b.height || 0) - (a.height || 0) || mp4Rank(a) - mp4Rank(b))[0];
  }

  return best;
};

// ─── Sanitize CDN URL (do NOT touch signed params!) ───────────────
// ⚠️  Do NOT strip `spc` — it is covered by the URL signature and
//     removing it makes googlevideo return 403 (verified 2026-08).
//     Only warn when an untransformed `n` (nsig) param survives — such
//     URLs 403 in a browser (our primary IOS client never emits `n`).
const cleanCdnUrl = (url) => {
  try {
    const u = new URL(url);
    const nVal = u.searchParams.get('n');
    if (nVal) {
      console.warn(`[URLExtractor] ⚠️  URL contains untransformed n param (len=${nVal.length}) — will 403 in browser unless nsig-transformed`);
    }
    return u.toString();
  } catch {
    return url;
  }
};

// ─── Method 1: ANDROID_VR InnerTube (Primary — no PO token, CDN OK) ─
// IOS URLs 403 from googlevideo (GVS PO-token enforcement), ANDROID_VR
// URLs serve bytes directly. Returns muxed itag=18 (360p mp4).
// Both PLAYER_ENDPOINTS are raced IN PARALLEL (old code tried them
// serially — 2 × 8s timeout = 16s worst case before giving up).
const extractViaAndroidVr = async (videoId, quality = 'auto') => {
  console.log(`[URLExtractor] 🥽 Trying ANDROID_VR client (${ANDROID_VR_CLIENT.clientVersion}) for: ${videoId}`);

    const attempt = async (endpoint) => {
      const response = await axios.post(
        endpoint,
        {
          context: { client: ANDROID_VR_CLIENT },
          videoId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': ANDROID_VR_CLIENT.userAgent,
            'X-Youtube-Client-Name': '28',
            'X-Youtube-Client-Version': ANDROID_VR_CLIENT.clientVersion,
            'Accept-Language': 'en-US,en;q=0.9',
          },
          // 2026-08: both endpoints now time out (bot-checked/dead) —
          // a short timeout stops them from squatting on the race.
          timeout: 4000,
          ...AXIOS_AGENTS,
        }
      );

    const data = response.data;
    if (data?.playabilityStatus?.status !== 'OK') {
      throw new Error(`ANDROID_VR: ${data?.playabilityStatus?.reason || 'unplayable'}`);
    }

    const formats = [
      ...(data.streamingData?.formats || []),
      ...(data.streamingData?.adaptiveFormats || []),
    ];

    const directFormats = formats.filter(f => f.url && !f.signatureCipher && !f.cipher);
    if (directFormats.length === 0) throw new Error('ANDROID_VR: no direct URL found');

    const best = chooseBestFormat(directFormats, quality);
    if (!best?.url) throw new Error('ANDROID_VR: no suitable format');

    console.log(`[URLExtractor] ✅ ANDROID_VR extracted: ${best.qualityLabel || best.quality} — ${videoId}`);
    return { url: cleanCdnUrl(best.url), formats: directFormats };
  };

  try {
    return await Promise.any(PLAYER_ENDPOINTS.map((endpoint) =>
      attempt(endpoint).catch((e) => {
        console.warn(`[URLExtractor] ANDROID_VR @ ${endpoint.includes('sandbox') ? 'sandbox' : 'www'} failed: ${e.message}`);
        throw e;
      })
    ));
  } catch (agg) {
    throw agg.errors?.[0] || agg;
  }
};

// ─── Method 2: IOS InnerTube (Fallback — no cipher/nsig) ─────────
const extractViaIOS = async (videoId, quality = 'auto') => {
  console.log(`[URLExtractor] 📱 Trying IOS client (${IOS_CLIENT.clientVersion}) for: ${videoId}`);

  const response = await axios.post(
    'https://www.youtube.com/youtubei/v1/player',
    {
      context: { client: IOS_CLIENT },
      videoId,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': IOS_CLIENT.userAgent,
        'X-Youtube-Client-Name': '5',
        'X-Youtube-Client-Version': IOS_CLIENT.clientVersion,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 6000,
      ...AXIOS_AGENTS,
    }
  );

  const data = response.data;
  if (data?.playabilityStatus?.status !== 'OK') {
    throw new Error(`IOS client: ${data?.playabilityStatus?.reason || 'unplayable'}`);
  }

  const formats = [
    ...(data.streamingData?.formats || []),
    ...(data.streamingData?.adaptiveFormats || []),
  ];

  const directFormats = formats.filter(f => f.url);
  if (directFormats.length === 0) throw new Error('IOS: no direct URL found');

  const best = chooseBestFormat(directFormats, quality);
  if (!best?.url) throw new Error('IOS: no suitable format');

  console.log(`[URLExtractor] ✅ IOS extracted: ${best.qualityLabel || best.quality} — ${videoId}`);
  return { url: cleanCdnUrl(best.url), formats: directFormats };
};

// ─── IOS with DNS-error retry (flaky hotspot) ─────────────────────
// `getaddrinfo ENOTFOUND` hits intermittently on this network; one
// retry ~1s later usually succeeds once DNS recovers. Only retried on
// network errors — never on 4xx playability errors.
const extractViaIOSWithRetry = async (videoId, quality = 'auto') => {
  try {
    return await extractViaIOS(videoId, quality);
  } catch (err) {
    const isDnsOrNetwork = /ENOTFOUND|EAI_AGAIN|getaddrinfo|network|socket/i.test(err.message);
    if (!isDnsOrNetwork) throw err;
    console.warn(`[URLExtractor] IOS DNS/network hiccup (${err.message}) — retrying once...`);
    await new Promise((r) => setTimeout(r, 1000));
    return extractViaIOS(videoId, quality);
  }
};

// ─── Method 2: WEB_EMBEDDED_PLAYER + poToken + visitorData ────────
const extractViaWebEmbedded = async (videoId, quality = 'auto') => {
  console.log(`[URLExtractor] 🛡️  Trying WEB_EMBEDDED_PLAYER + poToken for: ${videoId}`);

  const { visitorData, poToken } = await getPoToken();

  const response = await axios.post(
    'https://www.youtube.com/youtubei/v1/player',
    {
      context: {
        client: { ...WEB_EMBEDDED_CLIENT, visitorData },
        thirdParty: { embedUrl: `https://www.youtube.com/embed/${videoId}` },
      },
      serviceIntegrityDimensions: { poToken },
      videoId,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'X-Youtube-Client-Name': '56',
        'X-Youtube-Client-Version': WEB_EMBEDDED_CLIENT.clientVersion,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 6000,
      ...AXIOS_AGENTS,
    }
  );

  const data = response.data;
  if (data?.playabilityStatus?.status !== 'OK') {
    throw new Error(`WEB_EMBEDDED: ${data?.playabilityStatus?.reason || 'unplayable'}`);
  }

  const formats = [
    ...(data.streamingData?.formats || []),
    ...(data.streamingData?.adaptiveFormats || []),
  ];

  // WEB clients often return signatureCipher → we can only use plain URLs
  const directFormats = formats.filter(f => f.url && !f.signatureCipher && !f.cipher);
  if (directFormats.length === 0) {
    throw new Error('WEB_EMBEDDED: all formats encrypted (need decipher)');
  }

  const best = chooseBestFormat(directFormats, quality);
  if (!best?.url) throw new Error('WEB_EMBEDDED: no suitable format');

  console.log(`[URLExtractor] ✅ WEB_EMBEDDED+poToken extracted: ${best.qualityLabel || best.quality} — ${videoId}`);
  return { url: cleanCdnUrl(best.url), formats: directFormats };
};

// ─── Method 3: ytdl-core (Last resort — HARD timeout!) ───────────
// ytdl.getInfo has no timeout of its own; a stuck call (flaky hotspot
// network) held the request open 60s+. Capped at YTDL_TIMEOUT_MS.
const extractViaYtdl = async (videoId, quality = 'auto') => {
  console.log(`[URLExtractor] 📦 Trying ytdl-core (IOS) for: ${videoId}`);
  const ytdl = require('@distube/ytdl-core');
  const info = await withTimeout(ytdl.getInfo(videoId, { clients: ['IOS'] }), YTDL_TIMEOUT_MS, 'ytdl-core getInfo');
  const format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
  if (!format?.url) throw new Error('ytdl-core: no format URL');
  const best = chooseBestFormat(info.formats, quality) || format;
  console.log(`[URLExtractor] ✅ ytdl-core extracted: ${best.qualityLabel} — ${videoId}`);
  return { url: cleanCdnUrl(best.url), formats: info.formats };
};

// ─── Re-pick a cached extraction for a requested quality ──────────
// One extraction caches ALL formats; a quality switch re-picks from
// them instantly — no second InnerTube call (previously every quality
// triggered a fresh extraction + separate cache key; one flaky request
// for "360p" alone could 503 while "auto" worked fine).
const pickFromCached = (cached, quality) => {
  if (!cached || !cached.formats?.length) return cached?.url || null;
  const best = chooseBestFormat(cached.formats, quality);
  return best?.url || cached.url || null;
};

// ─── MAIN: Extract URL with fallback chain ────────────────────────
// opts.force = true → skip cache entirely (used after CDN 403/410)
const extractUrl = async (videoId, quality = 'auto', opts = {}) => {
  const force = !!opts.force;

  // ① Cache hit? (skipped when forcing a fresh extraction)
  //    Cache is keyed by videoId ONLY — one extraction serves every
  //    quality via pickFromCached (2026-08: previously per-quality
  //    keys caused duplicate InnerTube calls and phantom 503s).
  if (!force) {
    const cached = urlCache.get(videoId);
    if (cached && Date.now() < cached.expires) {
      // Negative cache: a video that failed seconds ago (members-only,
      // DNS blackout, etc.) will fail again — don't make the user sit
      // through the full 6s race + 8s ytdl again. (2026-08)
      if (cached.failedAt) {
        throw new Error(`Extraction recently failed for ${videoId} (${cached.reason})`);
      }
      console.log(`[URLExtractor] 🗃️  Cache hit: ${videoId} → re-pick ${quality}`);
      return pickFromCached(cached, quality);
    }

    // ② Already extracting? Coalesce (50 users same video → 1 API call)
    if (activeExtractions.has(videoId)) {
      console.log(`[URLExtractor] 🔗 Coalescing extraction for: ${videoId}`);
      const result = await activeExtractions.get(videoId);
      return pickFromCached(result, quality);
    }
  }

  // ③ Start fresh extraction
  const extractionPromise = (async () => {
    let result = null;
    let lastError = null;

    // ⚠️ 2026-08 PRIORITY FIX: ANDROID_VR always wins — IOS URLs now
    //    get 403 from googlevideo (GVS PO-token enforcement) while
    //    ANDROID_VR URLs serve bytes without any PO token. The old
    //    blind Promise.any let the first resolution win, and IOS
    //    (~1s) often beat ANDROID_VR (~500ms) → cached URLs 403'd
    //    intermittently in the proxy stream. Now: try ANDROID_VR
    //    first (internal 4s endpoint timeout), fall back to the
    //    IOS/WEB race only if it fails.
    try {
      // Parallel race: IOS resolves in ~1s, ANDROID_VR resolves in ~0.5s.
      // Racing both in parallel eliminates the 6-second serial timeout delay!
      result = await withTimeout(
        Promise.any([
          extractViaAndroidVr(videoId, quality),
          extractViaIOSWithRetry(videoId, quality),
        ]),
        PRIMARY_RACE_TIMEOUT_MS,
        'parallel primary extraction'
      );
    } catch (primaryErr) {
      console.warn(`[URLExtractor] Primary parallel extraction failed — trying web embedded / ytdl: ${primaryErr.message}`);
      try {
        result = await withTimeout(
          extractViaWebEmbedded(videoId, quality),
          PRIMARY_RACE_TIMEOUT_MS,
          'web embedded extraction'
        );
      } catch (agg) {
        lastError = agg.errors?.[0] || agg;
        console.warn(`[URLExtractor] Web fallback failed: ${lastError.message}`);

        // Last resort: ytdl-core (known limitation: cannot parse nsig)
        try {
          result = await extractViaYtdl(videoId, quality);
        } catch (e3) {
          lastError = e3;
          console.error(`[URLExtractor] ❌ All methods failed for ${videoId}`);
          throw new Error(`URL extraction failed: ${e3.message}`);
        }
      }
    }

    // Cache the result (only successful URLs get cached)
    if (!force) {
      urlCache.set(videoId, { ...result, expires: Date.now() + CACHE_TTL_MS });
    }
    return result;
  })();

  // ④ Coalescing bookkeeping — ALWAYS clean up on failure too, so a
  //    failed extraction doesn't poison the map (previously a rejected
  //    promise stayed cached forever → every retry got the SAME 503).
  activeExtractions.set(videoId, extractionPromise);
  try {
    const result = await extractionPromise;
    return pickFromCached(result, quality);
  } catch (err) {
    // ⑤ Negative cache: remember the failure briefly so the next request
    //    fails instantly instead of re-running the whole 6s race + 8s ytdl.
    //    ⚠️ 2026-08-15: 60s was too aggressive — a single transient blip
    //    (ytdl getInfo timeout on a flaky hotspot) poisoned the video for a
    //    full minute, killing playback mid-stream (error:2 + ORB retry
    //    loop). 10s is long enough to stop thundering-herd duplicates but
    //    short enough that a retry recovers quickly.
    urlCache.set(videoId, {
      failedAt: Date.now(),
      reason: err.message || 'unknown',
      expires: Date.now() + 10 * 1000,
    });
    throw err;
  } finally {
    activeExtractions.delete(videoId);
  }
};

// ─── Cache stats for monitoring ──────────────────────────────────
const getCacheStats = () => ({
  cached: urlCache.size,
  extracting: activeExtractions.size,
  entries: Array.from(urlCache.entries()).map(([key, val]) => ({
    key,
    expiresIn: Math.round((val.expires - Date.now()) / 1000) + 's',
  })),
});

// ─── Clear expired cache entries ─────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of urlCache.entries()) {
    if (now > val.expires) urlCache.delete(key);
  }
}, 10 * 60 * 1000); // Cleanup every 10 minutes

module.exports = { extractUrl, getCacheStats, chooseBestFormat, cachedLookup };
