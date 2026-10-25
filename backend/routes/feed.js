const express = require('express');
const router = express.Router();
const dbFirestore = require('../utils/dbFirestore');
const { optionalProtect } = require('../middleware/auth');
const cache = require('../utils/cache');
const {
  buildProfile,
  rankFeed,
  getFeedCache,
  setFeedCache,
} = require('../utils/recommendationEngine');

// Same homepage filters as getVideos — keeps /feed output identical in shape
// to /api/videos so the frontend UI doesn't change.
const filterHomeVideos = (videos) => {
  return videos.filter((v) => {
    if (v.status === 'Flagged') return false;
    if (v.storageLocation !== 'YouTube' && v.storageLocation !== 'GDrive' && v.storageLocation !== 'Local') return false;
    if (v.isShort === true) return false;

    const titleLower = (v.title || '').toLowerCase();
    const descLower = (v.description || '').toLowerCase();
    const tagsLower = (v.tags || []).map((t) => (typeof t === 'string' ? t.toLowerCase() : ''));
    const hasShortsHashtag =
      titleLower.includes('#shorts') ||
      titleLower.includes('#short') ||
      descLower.includes('#shorts') ||
      descLower.includes('#short') ||
      tagsLower.some((t) => t.includes('short'));

    const urlText = `${v.videoUrl || ''} ${v.youtube_id || ''} ${v.id || ''}`.toLowerCase();
    if (hasShortsHashtag || urlText.includes('/shorts/') || urlText.includes('/short/')) return false;

    const d = String(v.duration || '').trim().toLowerCase();
    const isZero = d === '0:00' || d === '00:00' || d === '00' || d === '0' || !v.duration;
    if (isZero) return false;

    return true;
  });
};

// GET /api/feed?category=All&page=1&limit=20&guestId=g_xxx
// Logged-in (JWT) → personal profile ranking
// Guest (guestId) → guest profile ranking
// Nobody   → pure trending (existing algoScore behavior)
router.get('/', optionalProtect, async (req, res) => {
  try {
    const { category, guestId } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    let profile = null;
    if (req.user && req.user.id) {
      const user = await dbFirestore.getUserById(req.user.id);
      profile = buildProfile(user || {});
    } else if (guestId) {
      const guest = await dbFirestore.getGuestProfile(guestId);
      profile = buildProfile(guest || {});
    }

    const hasSignals = profile && profile.hasSignals;
    const cacheKey = hasSignals
      ? `feed_${req.user ? `u_${req.user.id}` : `g_${guestId}`}_${category || 'all'}`
      : `feed_global_${category || 'all'}`;

    // Return cached feed if available (instant 1ms response for global & repeat users)
    let cached = getFeedCache(cacheKey);
    if (cached) {
      const start = (page - 1) * limit;
      const slice = cached.slice(start, start + limit);
      return res.json({
        videos: slice,
        page,
        limit,
        total: cached.length,
        hasMore: start + limit < cached.length,
      });
    }

    // Videos come from the dbJson snapshot cache
    let videos = await dbFirestore.getVideos({ category });
    videos = filterHomeVideos(videos);

    const ranked = rankFeed(videos, profile);
    setFeedCache(cacheKey, ranked, 600); // 10 min cache

    const start = (page - 1) * limit;
    res.json({
      videos: ranked.slice(start, start + limit),
      page,
      limit,
      total: ranked.length,
      hasMore: start + limit < ranked.length,
    });
  } catch (error) {
    console.error('[Feed] Error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;