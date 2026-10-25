/**
 * ═══════════════════════════════════════════════════════════════════
 *  streaming/routes.js — All streaming API endpoints
 *  ─────────────────────────────────────────────────────────────────
 *  ENDPOINTS:
 *
 *  GET  /api/stream/proxy/:videoId      → Own bandwidth proxy stream
 *  GET  /api/stream/url/:videoId        → Just returns raw URL (no bandwidth)
 *  GET  /api/stream/piped/:videoId      → Redirect to Piped (0 bandwidth)
 *  GET  /api/stream/invidious/:videoId  → Redirect to Invidious (0 bandwidth)
 *  GET  /api/stream/auto/:videoId       → Smart auto mode (tries all)
 *  GET  /api/stream/health              → System health dashboard
 *  GET  /api/stream/stats               → Live stats (active streams, etc.)
 * ═══════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const { handleStream, getFullStats, reportStreamSource } = require('./streamOrchestrator');
const { proxyStream, getStats: getProxyStats } = require('./proxyStreamer');
const { extractUrl, getCacheStats } = require('./urlExtractor');
const { redirectToPiped, getPipedStreamUrl } = require('./pipedService');
const { redirectToInvidious, getInvidiousStreamUrl } = require('./invidiousService');
const healthMonitor = require('./healthMonitor');

// ─── CORS-safe PO-token bootstrap helpers ─────────────────────────
// The browser CANNOT fetch www.youtube.com directly (CORS). These
// endpoints fetch YouTube server-side and re-serve the text so the
// frontend can bootstrap its own poToken/nsig pipeline.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const BOOTSTRAP_TTL_MS = 30 * 60 * 1000;
const bootstrapCache = new Map(); // key → { value, expires }
const bootstrapInFlight = new Map(); // key → Promise (coalesce)

const cachedFetch = async (key, fetcher) => {
  const cached = bootstrapCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.value;

  if (bootstrapInFlight.has(key)) return bootstrapInFlight.get(key);

  const promise = (async () => {
    const value = await fetcher();
    bootstrapCache.set(key, { value, expires: Date.now() + BOOTSTRAP_TTL_MS });
    return value;
  })();

  bootstrapInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    bootstrapInFlight.delete(key);
  }
};

// ─── Fetch YouTube embed page HTML (with Chrome UA) ───────────────
const fetchEmbedHtml = (videoId) =>
  cachedFetch(`embed:${videoId}`, async () => {
    const resp = await axios.get(`https://www.youtube.com/embed/${videoId}?hl=en`, {
      headers: { 'User-Agent': CHROME_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 15000,
    });
    return resp.data;
  });

// ─── Fetch YouTube iframe_api JS ──────────────────────────────────
const fetchIframeApi = () =>
  cachedFetch('iframe-api', async () => {
    const resp = await axios.get('https://www.youtube.com/iframe_api', {
      headers: { 'User-Agent': CHROME_UA },
      timeout: 15000,
    });
    return resp.data;
  });

// ─── Validate YouTube Video ID ────────────────────────────────────
const validateVideoId = (req, res, next) => {
  const { videoId } = req.params;
  if (!videoId || videoId.length !== 11 || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return res.status(400).json({
      error: 'Invalid YouTube video ID',
      received: videoId,
      format: '11 alphanumeric characters (e.g. dQw4w9WgXcQ)',
    });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────
// 1. AUTO SMART STREAM (Recommended — tries all methods in order)
//    GET /api/stream/auto/VIDEO_ID?quality=720p&mode=proxy
// ─────────────────────────────────────────────────────────────────
router.get('/auto/:videoId', validateVideoId, async (req, res) => {
  await handleStream(req.params.videoId, req, res);
});

// ─────────────────────────────────────────────────────────────────
// 2. OWN BANDWIDTH PROXY (Direct server pipe — best quality)
//    GET /api/stream/proxy/VIDEO_ID?quality=720p
// ─────────────────────────────────────────────────────────────────
router.get('/proxy/:videoId', validateVideoId, async (req, res) => {
  const { videoId } = req.params;
  const quality = req.query.quality || 'auto';
  await proxyStream(videoId, req, res, quality);
});

// ─────────────────────────────────────────────────────────────────
// 3. RAW URL ONLY (Returns JSON with stream URL — 0 server load)
//    GET /api/stream/url/VIDEO_ID?quality=720p
// ─────────────────────────────────────────────────────────────────
router.get('/url/:videoId', validateVideoId, async (req, res) => {
  const { videoId } = req.params;
  const quality = req.query.quality || 'auto';

  try {
    const url = await extractUrl(videoId, quality);
    res.json({
      success: true,
      videoId,
      url,
      quality,
      source: 'innertube',
      note: 'URL valid for ~55 minutes. Use as <video src>',
      expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    // Try Piped as fallback
    try {
      const url = await getPipedStreamUrl(videoId, quality);
      res.json({ success: true, videoId, url, quality, source: 'piped' });
    } catch (pipedErr) {
      // Try Invidious
      try {
        const url = await getInvidiousStreamUrl(videoId, quality);
        res.json({ success: true, videoId, url, quality, source: 'invidious' });
      } catch (invErr) {
        res.status(503).json({
          error: 'Could not get stream URL from any source',
          videoId,
          errors: {
            innertube: err.message,
            piped: pipedErr.message,
            invidious: invErr.message,
          },
        });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────
// 4. PIPED REDIRECT (0 bandwidth — redirects to Piped CDN)
//    GET /api/stream/piped/VIDEO_ID?quality=720p
// ─────────────────────────────────────────────────────────────────
router.get('/piped/:videoId', validateVideoId, async (req, res) => {
  await redirectToPiped(req.params.videoId, req, res, req.query.quality || 'auto');
});

// ─────────────────────────────────────────────────────────────────
// 5. INVIDIOUS REDIRECT (0 bandwidth — redirects to Invidious CDN)
//    GET /api/stream/invidious/VIDEO_ID?quality=720p
// ─────────────────────────────────────────────────────────────────
router.get('/invidious/:videoId', validateVideoId, async (req, res) => {
  await redirectToInvidious(req.params.videoId, req, res, req.query.quality || 'auto');
});

// ─────────────────────────────────────────────────────────────────
// 6. HEALTH DASHBOARD (Which services are alive)
//    GET /api/stream/health
// ─────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  // Trigger fresh health check if requested
  if (req.query.refresh === 'true') {
    await healthMonitor.checkAll();
  }

  const fullStats = getFullStats();
  const health = healthMonitor.getFullStatus();

  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    orchestrator: fullStats.orchestrator,
    proxy: fullStats.proxy,
    urlCache: fullStats.urlCache,
    services: health,
    summary: {
      healthyPipedInstances: health.piped?.filter(p => p.healthy).length || 0,
      totalPipedInstances: health.piped?.length || 0,
      healthyInvidiousInstances: health.invidious?.filter(i => i.healthy).length || 0,
      totalInvidiousInstances: health.invidious?.length || 0,
    },
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. LIVE STATS (Active streams, concurrency)
//    GET /api/stream/stats
// ─────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  res.json(getFullStats());
});

// ─────────────────────────────────────────────────────────────────
// 8. SOURCE REPORT (Client tiers report which streaming source used)
//    POST /api/stream/report  { videoId, source: 'client'|'ytjs'|'decipher'|'urlOnly'|'proxy'|'piped'|'invidious' }
//    Browser se fire-and-forget — taki stats me kaunsa tier chal
//    raha hai pata chale. ~2KB JSON, koi bandwidth nahi.
// ─────────────────────────────────────────────────────────────────
router.post('/report', (req, res) => {
  const { videoId, source } = req.body || {};
  if (!source) {
    return res.status(400).json({ error: 'source is required' });
  }
  const byService = reportStreamSource(source);
  res.json({ ok: true, videoId, source, byService });
});

// ─────────────────────────────────────────────────────────────────
// 9. CORS-SAFE PO-TOKEN BOOTSTRAP PROXIES
//    Browser cannot fetch www.youtube.com directly (CORS). These
//    endpoints re-serve YouTube text server-side so the frontend can
//    generate poTokens / boot the player.
//
//    GET /api/stream/embed/:videoId      → embed page HTML
//    GET /api/stream/iframe-api          → iframe_api JS
//    GET /api/stream/player-bootstrap    → { visitorData, playerId, jsUrl }
// ─────────────────────────────────────────────────────────────────

// 9a. Embed page HTML proxy (frontend PO-token bootstrap needs it)
router.get('/embed/:videoId', validateVideoId, async (req, res) => {
  const { videoId } = req.params;
  try {
    const html = await fetchEmbedHtml(videoId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(html);
  } catch (err) {
    console.error(`[PlayerBootstrap] embed fetch failed for ${videoId}:`, err.message);
    res.status(502).json({ error: 'Could not fetch embed page', message: err.message });
  }
});

// 9b. iframe_api JS proxy
router.get('/iframe-api', async (req, res) => {
  try {
    const js = await fetchIframeApi();
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(js);
  } catch (err) {
    console.error('[PlayerBootstrap] iframe_api fetch failed:', err.message);
    res.status(502).json({ error: 'Could not fetch iframe_api', message: err.message });
  }
});

// 9c. Player bootstrap metadata (visitorData + playerId + jsUrl)
//     visitorData ← regex from embed page
//     playerId    ← regex from iframe_api JS
//     jsUrl       ← /s/player/<id>/player_ias.vflset/en_US/base.js
//     Results cached ~30 min in memory to save bandwidth.
router.get('/player-bootstrap', async (req, res) => {
  try {
    const videoId = req.query.videoId && /^[a-zA-Z0-9_-]{11}$/.test(req.query.videoId)
      ? req.query.videoId
      : 'dQw4w9WgXcQ';

    const [embedHtml, iframeApiJs] = await Promise.all([
      fetchEmbedHtml(videoId),
      fetchIframeApi(),
    ]);

    const visitorMatch = embedHtml.match(/"visitorData":"([^"]+)/);
    // iframe_api JS escapes slashes as `\/` → unescape before matching
    const playerIdMatch = iframeApiJs.replace(/\\\//g, '/').match(/\/s\/player\/([^/]+)\//);

    if (!visitorMatch || !playerIdMatch) {
      return res.status(502).json({
        error: 'Could not extract bootstrap data from YouTube',
        visitorDataFound: !!visitorMatch,
        playerIdFound: !!playerIdMatch,
      });
    }

    const playerId = playerIdMatch[1];
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json({
      visitorData: visitorMatch[1],
      playerId,
      jsUrl: `/s/player/${playerId}/player_ias.vflset/en_US/base.js`,
      expiresAt: new Date(Date.now() + BOOTSTRAP_TTL_MS).toISOString(),
    });
  } catch (err) {
    console.error('[PlayerBootstrap] bootstrap failed:', err.message);
    res.status(502).json({ error: 'Player bootstrap failed', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 10. SERVER-SIDE PO TOKEN MINT (verified 9 Aug 2026)
//     POST /api/stream/pot
//     Browser WAA minting (jnn-pa) kabhi kabhi fail/hang karta hai
//     (ERR_CONNECTION_RESET) aur ANDROID_VR 4K (itag=315) pe HTTP 500
//     de sakta hai. Backend youtube-po-token-generator ka pot verified
//     kaam karta hai (playability OK + itag=315 4K FULL FILE). Ye
//     endpoint server-side mint karta hai, 30 min cache karta hai.
// ─────────────────────────────────────────────────────────────────
const POT_TTL_MS = 30 * 60 * 1000;
const potCache = new Map(); // { pot, visitorData, expires }
const potInFlight = null; // single-flight (mint is slow, dedupe)
let potMinting = null;

router.post('/pot', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const cached = potCache.get('pot');
    if (cached && Date.now() < cached.expires) {
      return res.json({ ok: true, cached: true, ...cached.value });
    }

    if (potMinting) {
      const result = await potMinting;
      return res.json({ ok: true, cached: false, ...result });
    }

    potMinting = (async () => {
      const { generate } = require('youtube-po-token-generator');
      const { poToken, visitorData } = await generate();
      if (!poToken || poToken.length < 80) {
        throw new Error('Server-side PO token mint failed');
      }
      const value = { poToken, visitorData };
      potCache.set('pot', { value, expires: Date.now() + POT_TTL_MS });
      return value;
    })();

    try {
      const result = await potMinting;
      res.json({ ok: true, cached: false, ...result });
    } finally {
      potMinting = null;
    }
  } catch (err) {
    console.error('[ServerPot] mint failed:', err.message);
    res.status(502).json({ error: 'PO token mint failed', message: err.message });
  }
});

// ─── OPTIONS preflight ────────────────────────────────────────────
router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.status(204).end();
});

module.exports = router;
