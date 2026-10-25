/**
 * ═══════════════════════════════════════════════════════════════════
 *  MICROSERVICE 4: pipedService.js
 *  ─────────────────────────────────────────────────────────────────
 *  📋 KYA KARTA HAI:
 *     Piped public instances se YouTube video stream URLs nikalta hai.
 *     Piped = open-source YouTube proxy — servers khud video stream karte hain.
 *     TERI BANDWIDTH USE NAHI HOTI — redirect karta hai Piped servers pe.
 *
 *  ✅ KAB KAAM KARTA HAI:
 *     Jab Piped instances up ho (usually ~70-80% uptime)
 *     Best for: backup when own proxy fails
 *     Free — koi API key nahi chahiye
 *
 *  ❌ KAHAN FAIL HO SAKTA HAI:
 *     Public instances overloaded ho jaye → slow / timeout
 *     Piped servers YouTube block kare → all instances fail
 *     Rate limits (aggressive use pe)
 *
 *  💡 STRATEGY:
 *     Healthy instances list healthMonitor se lo
 *     Fastest (lowest response time) pehle try karo
 *     Fail → next instance try karo (rotation)
 *     Success → client ko Piped stream URL bhejo → client Piped se direct stream kare
 *
 *  ⚡ BANDWIDTH: ZERO (Piped ke server stream karte hain, not tera server)
 * ═══════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const healthMonitor = require('./healthMonitor');

// ─── Piped response cache ─────────────────────────────────────────
const pipedCache = new Map();
const CACHE_TTL = 45 * 60 * 1000; // 45 min

// ─── Get stream URL from a single Piped instance ─────────────────
const fetchFromPipedInstance = async (baseUrl, videoId, quality = 'auto') => {
  const response = await axios.get(`${baseUrl}/streams/${videoId}`, {
    timeout: 5000,
    headers: { 'Accept': 'application/json' },
  });

  const data = response.data;
  if (!data) throw new Error('Empty response from Piped');

  // Try to find a muxed (video+audio) stream first
  const videoStreams = data.videoStreams || [];
  const audioStreams = data.audioStreams || [];

  // Quality preference
  const qualityMap = { '1080p': '1080p', '720p': '720p', '480p': '480p', '360p': '360p', 'auto': '720p' };
  const targetQuality = qualityMap[quality] || '720p';

  // Find best video stream
  let best = videoStreams.find(s => s.quality === targetQuality && !s.videoOnly);
  if (!best) best = videoStreams.find(s => !s.videoOnly); // any muxed
  if (!best) best = videoStreams.find(s => s.quality === targetQuality); // any matching quality
  if (!best && videoStreams.length > 0) best = videoStreams[0]; // fallback

  if (!best?.url) throw new Error('No video stream URL in Piped response');

  // Also get best audio if video is video-only
  let audioUrl = null;
  if (best.videoOnly && audioStreams.length > 0) {
    audioUrl = audioStreams[0].url;
  }

  return {
    videoUrl: best.url,
    audioUrl,
    quality: best.quality,
    videoOnly: best.videoOnly || false,
    instanceUrl: baseUrl,
    thumbnailUrl: data.thumbnailUrl,
    duration: data.duration,
    title: data.title,
  };
};

// ─── MAIN: Get Piped stream (tries all healthy instances) ─────────
const getPipedStream = async (videoId, quality = 'auto') => {
  const cacheKey = `${videoId}_${quality}`;
  const cached = pipedCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    console.log(`[PipedService] 🗃️  Cache hit: ${videoId}`);
    return cached.data;
  }

  // Get healthy instances (sorted by response time)
  const instances = healthMonitor.getHealthyPipedInstances();
  if (instances.length === 0) {
    throw new Error('No healthy Piped instances available');
  }

  let lastError = null;
  for (const instance of instances) {
    try {
      console.log(`[PipedService] 🔄 Trying: ${instance} for ${videoId}`);
      const result = await fetchFromPipedInstance(instance, videoId, quality);

      // Cache success
      pipedCache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL });
      console.log(`[PipedService] ✅ Got stream from ${instance} | Quality: ${result.quality}`);
      return result;
    } catch (err) {
      console.warn(`[PipedService] ❌ ${instance} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`All Piped instances failed: ${lastError?.message}`);
};

// ─── Pipe Piped stream to client (redirect mode) ─────────────────
// Option A: Redirect — client streams from Piped directly (0 teri bandwidth)
const redirectToPiped = async (videoId, req, res, quality = 'auto') => {
  try {
    const streamData = await getPipedStream(videoId, quality);

    // If video + audio both needed, can't simply redirect (browser needs muxed)
    // For simplicity: redirect to muxed URL or best available
    const streamUrl = streamData.videoUrl;

    console.log(`[PipedService] 🔀 Redirecting to Piped stream: ${streamUrl.substring(0, 80)}...`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Stream-Source', 'piped');
    res.setHeader('X-Piped-Instance', streamData.instanceUrl);
    res.redirect(302, streamUrl);
  } catch (err) {
    console.error(`[PipedService] Redirect failed:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Piped stream unavailable', message: err.message });
    }
  }
};

// ─── Get just the URL (for orchestrator to use) ──────────────────
const getPipedStreamUrl = async (videoId, quality = 'auto') => {
  const data = await getPipedStream(videoId, quality);
  return data.videoUrl;
};

// ─── Cache stats ──────────────────────────────────────────────────
const getCacheStats = () => ({
  cached: pipedCache.size,
  entries: Array.from(pipedCache.keys()),
});

module.exports = { getPipedStream, redirectToPiped, getPipedStreamUrl, getCacheStats };
