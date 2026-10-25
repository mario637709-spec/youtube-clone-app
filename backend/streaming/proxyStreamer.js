/**
 * ═══════════════════════════════════════════════════════════════════
 *  MICROSERVICE 3: proxyStreamer.js
 *  ─────────────────────────────────────────────────────────────────
 *  📋 KYA KARTA HAI:
 *     Tera MAIN streaming system — apni bandwidth use karta hai.
 *     YouTube CDN se video chunks leta hai aur client ko pipe karta hai.
 *     HTTP Range requests support — seek, pause, resume sab kaam karta hai.
 *
 *  ✅ KAB KAAM KARTA HAI:
 *     Hamesha — jab tak teri internet connection hai
 *     Range requests support karta hai (video player controls)
 *     200 concurrent users handle kar sakta hai
 *
 *  ❌ KAHAN FAIL HO SAKTA HAI:
 *     CDN URL expire ho jaye (55 min cache, auto re-extract)
 *     Teri upload bandwidth full ho jaye (real constraint)
 *     YouTube CDN server drop kare connection
 *
 *  💡 KAISE KAAM KARTA HAI (CPU ~0%):
 *     Client:  GET /api/stream/proxy/VIDEO_ID  Range: bytes=5242880-
 *     Server:  RawUrl lo → CDN pe wahi Range bhejo → Response pipe karo
 *     CDN → [bytes] → Server → [bytes] → Client
 *     NO buffering. NO memory storage. Just pointer passing.
 *
 *  ⚡ 200 USERS CONCURRENCY:
 *     Node.js async event loop — 200 pipes = 200 async I/O ops
 *     Memory: ~64KB buffer × 200 = 12.8 MB only
 *     CPU: ~1-2% (copying pointers, not data)
 *
 *  📊 BANDWIDTH MATH:
 *     720p  = ~2.5 Mbps × 200 users = 500 Mbps upload needed
 *     480p  = ~1.5 Mbps × 200 users = 300 Mbps upload needed
 *     360p  = ~0.8 Mbps × 200 users = 160 Mbps upload needed
 * ═══════════════════════════════════════════════════════════════════
 */

const https = require('https');
const http = require('http');
const { extractUrl, cachedLookup } = require('./urlExtractor');

// ─── Connection Pool (keep-alive for reuse) ───────────────────────
// `lookup: cachedLookup` (shared with urlExtractor) keeps DNS results
// warm for 60s — on this flaky mobile hotspot a fresh getaddrinfo per
// socket was failing intermittently with ENOTFOUND.
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 500,          // Max 500 sockets to YouTube CDN
  keepAliveMsecs: 30000,
  freeSocketTimeout: 20000,
  lookup: cachedLookup,
});
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 500,
  freeSocketTimeout: 20000,
  lookup: cachedLookup,
});

// ─── Active streams tracker (for monitoring) ─────────────────────
const activeStreams = new Map(); // streamId → { videoId, startedAt, bytesSent }
let streamIdCounter = 0;

// ─── HEADERS to forward from CDN to client ────────────────────────
const FORWARD_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'last-modified',
  'etag',
];

// ─── Make a range request to YouTube CDN (follows 3xx redirects) ──
// googlevideo's redirect targets REJECT open-ended ranges (bytes=0- →
// 403), requests WITHOUT a range (403) AND huge closed ranges (10MiB+ →
// 403). Verified 2026-08 (this hotspot): bytes=0-524287 → 206 fast &
// reliable; bytes=0-1048575 → 206 but throttled to ~45KB/s; 3MiB+ → 403.
// So we clamp EVERY range to a 512KiB window — the browser follows up
// with the next chunk (bytes=524288-524287 etc.).
const MAX_CLOSED_RANGE_END = 524287; // 512 KiB — proven to work on redirect targets
const toClosedRange = (rangeHeader) => {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!m) return rangeHeader;
  const start = parseInt(m[1], 10);
  const end = m[2] !== '' ? parseInt(m[2], 10) : start + MAX_CLOSED_RANGE_END;
  const clampedEnd = Math.max(start, Math.min(end, start + MAX_CLOSED_RANGE_END));
  return `bytes=${start}-${clampedEnd}`;
};

const fetchFromCdn = (rawUrl, rangeHeader, redirectCount = 0) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(rawUrl);
    const isHttps = urlObj.protocol === 'https:';
    const agent = isHttps ? httpsAgent : httpAgent;

    const cdnRange = toClosedRange(rangeHeader);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',   // No compression — raw bytes
        'Connection': 'keep-alive',
        ...(cdnRange ? { 'Range': cdnRange } : {}),
      },
      timeout: 15000,
    };

    const req = (isHttps ? https : http).request(options, (res) => {
      // googlevideo load-balances with 302 redirects (redirect_counter=1).
      // Follow them server-side so the browser never sees a Location-less 302.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < 5) {
        console.log(`[ProxyStreamer] CDN 302 → following redirect (${redirectCount + 1})`);
        res.resume(); // Drain
        const nextUrl = new URL(res.headers.location, urlObj.origin).toString();
        // Pass the CLAMPED range (cdnRange) — the original open/huge range
        // gets 403 on redirect targets.
        fetchFromCdn(nextUrl, cdnRange, redirectCount + 1).then(resolve, reject);
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('CDN request timeout'));
    });
    req.end();
  });
};

// ─── MAIN: Proxy stream to client ────────────────────────────────
const proxyStream = async (videoId, req, res, quality = 'auto') => {
  const streamId = ++streamIdCounter;
  const startedAt = Date.now();

  try {
    // ① Get raw CDN URL (cached or fresh)
    let rawUrl;
    try {
      rawUrl = await extractUrl(videoId, quality);
    } catch (extractErr) {
      // ⚠️ 2026-08-15: "recently failed" (negative cache) or a transient
      //    extraction blip shouldn't kill an otherwise-playable video.
      //    Retry ONCE with force:true (bypasses the negative cache and
      //    runs the full fresh extraction race).
      if (extractErr.message.includes('recently failed')) {
        console.warn(`[ProxyStreamer] Negative-cache hit for ${videoId} — forcing fresh extraction...`);
        try {
          rawUrl = await extractUrl(videoId, quality, { force: true });
        } catch (retryErr) {
          console.error(`[ProxyStreamer] Fresh re-extraction failed for ${videoId}:`, retryErr.message);
          if (!res.headersSent) {
            res.status(502).json({
              error: 'Could not get video stream URL',
              message: retryErr.message,
              videoId,
            });
          }
          return;
        }
      } else {
        console.error(`[ProxyStreamer] URL extraction failed for ${videoId}:`, extractErr.message);
        if (!res.headersSent) {
          res.status(502).json({
            error: 'Could not get video stream URL',
            message: extractErr.message,
            videoId,
          });
        }
        return;
      }
    }

    // ② Get Range header from client
    const rangeHeader = req.headers['range'] || null;

    console.log(`[ProxyStreamer] 🎬 Stream #${streamId} | ${videoId} | Range: ${rangeHeader || 'full'}`);

    // ③ Request from YouTube CDN
    let cdnResponse;
    try {
      cdnResponse = await fetchFromCdn(rawUrl, rangeHeader);
    } catch (cdnErr) {
      console.error(`[ProxyStreamer] CDN fetch failed:`, cdnErr.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'CDN request failed', message: cdnErr.message });
      }
      return;
    }

    // ④ If CDN returns 403/410 → URL expired/bad → force a fresh
    //    extraction (bypassing the cache that holds the dead URL).
    //    NOTE: `n`-bearing URLs 403 from googlevideo; the fresh IOS
    //    client returns URLs without `n`, so re-extraction fixes it.
    if (cdnResponse.statusCode === 403 || cdnResponse.statusCode === 410) {
      console.warn(`[ProxyStreamer] CDN ${cdnResponse.statusCode} — URL rejected, forcing fresh extraction...`);
      cdnResponse.resume(); // Drain the response

      try {
        rawUrl = await extractUrl(videoId, quality, { force: true });
      } catch (reExtractErr) {
        console.error(`[ProxyStreamer] Re-extraction failed for ${videoId}:`, reExtractErr.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'CDN rejected stream URL and re-extraction failed', message: reExtractErr.message });
        }
        return;
      }

      cdnResponse = await fetchFromCdn(rawUrl, rangeHeader);
    }

    // ⑤ Forward CDN headers to client
    const statusCode = cdnResponse.statusCode;
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'X-Stream-Id': streamId,
      'X-Video-Id': videoId,
    };

    FORWARD_HEADERS.forEach(h => {
      const val = cdnResponse.headers[h];
      if (val) responseHeaders[h] = val;
    });

    // Always set accept-ranges so browser knows it can seek
    if (!responseHeaders['accept-ranges']) {
      responseHeaders['accept-ranges'] = 'bytes';
    }

    if (!res.headersSent) {
      res.writeHead(statusCode, responseHeaders);
    }

    // ⑥ Track active stream
    activeStreams.set(streamId, { videoId, startedAt, bytesSent: 0, quality });

    // ⑦ PIPE bytes: CDN → Server → Client (zero buffering)
    let bytesSent = 0;
    cdnResponse.on('data', (chunk) => {
      bytesSent += chunk.length;
      // Backpressure: if client buffer full → pause CDN
      if (!res.write(chunk)) {
        cdnResponse.pause();
        res.once('drain', () => cdnResponse.resume());
      }
    });

    cdnResponse.on('end', () => {
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[ProxyStreamer] ✅ Stream #${streamId} complete | ${(bytesSent / 1024).toFixed(0)}KB in ${duration}s`);
      activeStreams.delete(streamId);
      res.end();
    });

    cdnResponse.on('error', (err) => {
      console.error(`[ProxyStreamer] Stream #${streamId} CDN error:`, err.message);
      activeStreams.delete(streamId);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });

    // ⑧ Client disconnect → kill CDN pipe immediately (saves bandwidth!)
    req.on('close', () => {
      console.log(`[ProxyStreamer] 👋 Client disconnected stream #${streamId} — killing CDN pipe`);
      cdnResponse.destroy();
      activeStreams.delete(streamId);
    });

    req.on('error', () => {
      cdnResponse.destroy();
      activeStreams.delete(streamId);
    });

  } catch (err) {
    console.error(`[ProxyStreamer] Unexpected error stream #${streamId}:`, err.message);
    activeStreams.delete(streamId);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream proxy error', message: err.message });
    }
  }
};

// ─── Stats for monitoring endpoint ───────────────────────────────
const getStats = () => ({
  activeStreams: activeStreams.size,
  totalStreamsServed: streamIdCounter,
  streams: Array.from(activeStreams.entries()).map(([id, s]) => ({
    streamId: id,
    videoId: s.videoId,
    quality: s.quality,
    durationSec: Math.round((Date.now() - s.startedAt) / 1000),
  })),
});

module.exports = { proxyStream, getStats };
