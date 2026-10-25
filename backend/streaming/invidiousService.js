/**
 * ═══════════════════════════════════════════════════════════════════
 *  MICROSERVICE 5: invidiousService.js
 *  ─────────────────────────────────────────────────────────────────
 *  📋 KYA KARTA HAI:
 *     Invidious public instances se YouTube video stream URLs nikalta hai.
 *     Invidious = Piped ka alternative, alag servers use karta hai.
 *     Double backup: Piped fail + Invidious live = kaam chalega
 *
 *  ✅ KAB KAAM KARTA HAI:
 *     Jab Invidious instances up ho
 *     Better privacy (no Google tracking)
 *     Usually Piped se slower but more reliable format support
 *
 *  ❌ KAHAN FAIL HO SAKTA HAI:
 *     Same as Piped — public servers, rate limits
 *     Age-restricted videos: fails
 *     Live videos: mostly fails
 *
 *  💡 BANDWIDTH: ZERO (Invidious stream karte hain, tera server redirect karta hai)
 * ═══════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const healthMonitor = require('./healthMonitor');

const invidiousCache = new Map();
const CACHE_TTL = 40 * 60 * 1000; // 40 min (Invidious URLs expire faster)

// ─── Fetch from single Invidious instance ─────────────────────────
const fetchFromInvidiousInstance = async (baseUrl, videoId, quality = 'auto') => {
  const response = await axios.get(`${baseUrl}/api/v1/videos/${videoId}`, {
    timeout: 6000,
    headers: { 'Accept': 'application/json' },
  });

  const data = response.data;
  if (!data || !data.adaptiveFormats) {
    throw new Error('No adaptiveFormats in Invidious response');
  }

  // qualityLabel examples: "720p", "1080p60", "480p"
  const qualityMap = { '1080p': 1080, '720p': 720, '480p': 480, '360p': 360, 'auto': 720 };
  const targetH = qualityMap[quality] || 720;

  // Find video formats
  const videoFormats = (data.adaptiveFormats || []).filter(f =>
    f.type?.includes('video') && f.url
  );

  let best = videoFormats.find(f => {
    const h = parseInt(f.qualityLabel || '0', 10);
    return h === targetH;
  });

  if (!best) {
    // Closest below target
    const sorted = videoFormats
      .filter(f => parseInt(f.qualityLabel || '0', 10) <= targetH)
      .sort((a, b) => parseInt(b.qualityLabel || '0', 10) - parseInt(a.qualityLabel || '0', 10));
    best = sorted[0];
  }

  if (!best) best = videoFormats[0]; // any video
  if (!best?.url) throw new Error('No video URL found in Invidious response');

  // Audio
  const audioFormats = (data.adaptiveFormats || []).filter(f =>
    f.type?.includes('audio') && f.url
  );
  const audioUrl = audioFormats[0]?.url || null;

  return {
    videoUrl: best.url,
    audioUrl,
    quality: best.qualityLabel,
    instanceUrl: baseUrl,
    title: data.title,
    duration: data.lengthSeconds,
  };
};

// ─── MAIN: Get Invidious stream ───────────────────────────────────
const getInvidiousStream = async (videoId, quality = 'auto') => {
  const cacheKey = `${videoId}_${quality}`;
  const cached = invidiousCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    console.log(`[InvidiousService] 🗃️  Cache hit: ${videoId}`);
    return cached.data;
  }

  const instances = healthMonitor.getHealthyInvidiousInstances();
  if (instances.length === 0) {
    throw new Error('No healthy Invidious instances available');
  }

  let lastError = null;
  for (const instance of instances) {
    try {
      console.log(`[InvidiousService] 🔄 Trying: ${instance}`);
      const result = await fetchFromInvidiousInstance(instance, videoId, quality);
      invidiousCache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL });
      console.log(`[InvidiousService] ✅ Got stream from ${instance} | ${result.quality}`);
      return result;
    } catch (err) {
      console.warn(`[InvidiousService] ❌ ${instance}: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`All Invidious instances failed: ${lastError?.message}`);
};

// ─── Get just the URL ─────────────────────────────────────────────
const getInvidiousStreamUrl = async (videoId, quality = 'auto') => {
  const data = await getInvidiousStream(videoId, quality);
  return data.videoUrl;
};

// ─── Redirect client to Invidious ────────────────────────────────
const redirectToInvidious = async (videoId, req, res, quality = 'auto') => {
  try {
    const streamData = await getInvidiousStream(videoId, quality);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Stream-Source', 'invidious');
    res.setHeader('X-Invidious-Instance', streamData.instanceUrl);
    res.redirect(302, streamData.videoUrl);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Invidious stream unavailable', message: err.message });
    }
  }
};

module.exports = { getInvidiousStream, getInvidiousStreamUrl, redirectToInvidious };
