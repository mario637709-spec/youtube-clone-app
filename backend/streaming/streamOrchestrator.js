/**
 * ═══════════════════════════════════════════════════════════════════
 *  MICROSERVICE 6: streamOrchestrator.js
 *  ─────────────────────────────────────────────────────────────────
 *  📋 KYA KARTA HAI:
 *     YE POORE SYSTEM KA BRAIN HAI.
 *     Decide karta hai ki kaunsa service use karna hai — waterfall mein.
 *     Ek fail → next try → next fail → next try → error
 *
 *  ✅ WATERFALL ORDER:
 *     1. OWN PROXY (teri bandwidth) — best quality, always works
 *        ↓ fail?
 *     2. PIPED REDIRECT (0 bandwidth) — free, public servers
 *        ↓ fail?
 *     3. INVIDIOUS REDIRECT (0 bandwidth) — backup of backup
 *        ↓ fail?
 *     4. URL ONLY — client ko raw URL do, woh khud stream kare
 *        ↓ fail?
 *     5. ERROR — kuch nahi hua, sab failed
 *
 *  ⚡ MODES:
 *     'proxy'    → Teri bandwidth use karo (default, best quality)
 *     'redirect' → Free services use karo (0 bandwidth but less reliable)
 *     'url'      → Sirf URL return karo (client khud manage kare)
 *     'auto'     → Smart: proxy try → redirect fallback → url fallback
 *
 *  📊 CONCURRENCY HANDLING:
 *     requestQueue: Max 200 concurrent requests accept karta hai
 *     Above 200: 429 Too Many Requests return karta hai
 *     Each request tracked: videoId, startTime, mode
 * ═══════════════════════════════════════════════════════════════════
 */

const { proxyStream, getStats: getProxyStats } = require('./proxyStreamer');
const { getPipedStreamUrl, redirectToPiped } = require('./pipedService');
const { getInvidiousStreamUrl, redirectToInvidious } = require('./invidiousService');
const { extractUrl, getCacheStats: getUrlCacheStats } = require('./urlExtractor');
const healthMonitor = require('./healthMonitor');

// ─── Concurrency Limiter ──────────────────────────────────────────
const MAX_CONCURRENT = 200;
let activeRequests = 0;

// ─── Request stats ────────────────────────────────────────────────
const stats = {
  total: 0,
  byService: { client: 0, ytjs: 0, decipher: 0, proxy: 0, piped: 0, invidious: 0, urlOnly: 0, failed: 0 },
  rejected: 0,
};

// ─── Source reporting (client tiers report which source they used) ─
// Browser (Tier 0/1/2) fire-and-forget POST /api/stream/report karta hai
// taki /api/stream/stats me dikhe: client | ytjs | decipher | proxy ...
const reportStreamSource = (source) => {
  const key = typeof source === 'string' && source ? source : 'unknown';
  if (!(key in stats.byService)) stats.byService[key] = 0;
  stats.byService[key]++;
  return stats.byService;
};

// ─── Mode decision logic ──────────────────────────────────────────
const decideMode = (queryMode, activeProxyStreams) => {
  if (queryMode && queryMode !== 'auto') return queryMode;

  // Auto mode: if too many proxy streams → use redirect to save bandwidth
  if (activeProxyStreams > 100) {
    console.log('[Orchestrator] 📊 >100 proxy streams — switching to redirect mode');
    return 'redirect';
  }
  return 'proxy';
};

// ─── MAIN: Handle stream request ──────────────────────────────────
const handleStream = async (videoId, req, res) => {
  // ─── Concurrency check ────────────────────────────────────────
  if (activeRequests >= MAX_CONCURRENT) {
    stats.rejected++;
    console.warn(`[Orchestrator] 🚫 Max concurrency (${MAX_CONCURRENT}) reached — rejecting`);
    return res.status(429).json({
      error: 'Server at capacity',
      message: `Max ${MAX_CONCURRENT} concurrent streams. Try again shortly.`,
      activeStreams: activeRequests,
      retryAfterMs: 3000,
    });
  }

  activeRequests++;
  stats.total++;

  const quality = req.query.quality || 'auto';
  const modeQuery = req.query.mode || 'auto';
  const proxyStats = getProxyStats();
  const mode = decideMode(modeQuery, proxyStats.activeStreams);

  console.log(`[Orchestrator] 🎬 Request #${stats.total} | ${videoId} | Mode: ${mode} | Quality: ${quality} | Active: ${activeRequests}`);

  try {
    // ═════════════════════════════════════════════════════════════
    // LEVEL 1: OWN PROXY — Teri bandwidth, best quality
    // ═════════════════════════════════════════════════════════════
    if (mode === 'proxy' || mode === 'auto') {
      try {
        await proxyStream(videoId, req, res, quality);
        stats.byService.proxy++;
        return; // Success
      } catch (proxyErr) {
        console.warn(`[Orchestrator] Proxy failed: ${proxyErr.message}`);
        // Fall through to backup
      }
    }

    // ═════════════════════════════════════════════════════════════
    // LEVEL 2: PIPED REDIRECT — 0 bandwidth, free
    // ═════════════════════════════════════════════════════════════
    if (mode === 'redirect' || mode === 'auto') {
      try {
        await redirectToPiped(videoId, req, res, quality);
        stats.byService.piped++;
        return; // Success
      } catch (pipedErr) {
        console.warn(`[Orchestrator] Piped redirect failed: ${pipedErr.message}`);
      }

      // ═══════════════════════════════════════════════════════════
      // LEVEL 3: INVIDIOUS REDIRECT — backup of backup
      // ═══════════════════════════════════════════════════════════
      try {
        await redirectToInvidious(videoId, req, res, quality);
        stats.byService.invidious++;
        return; // Success
      } catch (invErr) {
        console.warn(`[Orchestrator] Invidious redirect failed: ${invErr.message}`);
      }
    }

    // ═════════════════════════════════════════════════════════════
    // LEVEL 4: URL ONLY — Return raw URL, client streams directly
    // ═════════════════════════════════════════════════════════════
    if (mode === 'url' || mode === 'auto') {
      try {
        // Try our extractor first
        let rawUrl = null;
        try {
          rawUrl = await extractUrl(videoId, quality);
        } catch {
          // Try Piped URL
          rawUrl = await getPipedStreamUrl(videoId, quality);
        }
        if (!rawUrl) throw new Error('No URL available');

        stats.byService.urlOnly++;
        if (!res.headersSent) {
          return res.json({
            success: true,
            mode: 'url',
            url: rawUrl,
            videoId,
            note: 'Use this URL as <video src>',
          });
        }
        return;
      } catch (urlErr) {
        console.warn(`[Orchestrator] URL-only also failed: ${urlErr.message}`);
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ALL FAILED
    // ═════════════════════════════════════════════════════════════
    stats.byService.failed++;
    if (!res.headersSent) {
      res.status(503).json({
        error: 'All streaming methods failed',
        videoId,
        triedModes: ['proxy', 'piped', 'invidious', 'url'],
        suggestion: 'Video may be private, age-restricted, or temporarily unavailable',
      });
    }

  } finally {
    activeRequests--;
  }
};

// ─── GET: Full system stats ───────────────────────────────────────
const getFullStats = () => ({
  orchestrator: {
    activeRequests,
    maxConcurrent: MAX_CONCURRENT,
    totalServed: stats.total,
    rejected: stats.rejected,
    byService: stats.byService,
    utilizationPercent: Math.round((activeRequests / MAX_CONCURRENT) * 100),
  },
  proxy: getProxyStats(),
  urlCache: getUrlCacheStats(),
  services: healthMonitor.getFullStatus(),
});

module.exports = { handleStream, getFullStats, reportStreamSource };
