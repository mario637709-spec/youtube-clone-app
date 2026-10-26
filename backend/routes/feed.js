const express = require('express');
const router = express.Router();
const dbFirestore = require('../utils/dbFirestore');
const { optionalProtect } = require('../middleware/auth');
const cache = require('../utils/cache');
const { db, isRealFirebase } = require('../config/firebase');
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
router.get('/', optionalProtect, async (req, res) => {
  try {
    const { category, guestId } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const start = (page - 1) * limit;

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

    // Return cached feed if available and within slice range
    let cached = getFeedCache(cacheKey);
    if (cached && start < cached.length) {
      const slice = cached.slice(start, start + limit);
      return res.json({
        videos: slice,
        page,
        limit,
        total: Math.max(cached.length, 3000),
        hasMore: true,
      });
    }

    // Videos come from RTDB + Firestore entire database
    let videos = await dbFirestore.getVideos({ category });
    videos = filterHomeVideos(videos);

    const ranked = rankFeed(videos, profile);
    setFeedCache(cacheKey, ranked, 600); // 10 min cache

    if (start < ranked.length) {
      const slice = ranked.slice(start, start + limit);
      return res.json({
        videos: slice,
        page,
        limit,
        total: Math.max(ranked.length, 3000),
        hasMore: start + limit < ranked.length,
      });
    }

    // Deeper offset query directly from Firestore if user scrolled beyond the pre-ranked set
    if (isRealFirebase) {
      try {
        let q = db.collection('videos').offset(start).limit(limit);
        if (category && category !== 'All') {
          q = q.where('category', '==', category);
        }
        const snap = await q.get();
        const deeper = [];
        snap.forEach((d) => deeper.push({ id: d.id, ...d.data() }));
        if (deeper.length > 0) {
          const filteredDeeper = filterHomeVideos(deeper);
          return res.json({
            videos: filteredDeeper,
            page,
            limit,
            total: start + deeper.length + 500,
            hasMore: deeper.length === limit,
          });
        }
      } catch (err) {
        console.warn('[Feed] Firestore deep pagination fallback failed:', err.message);
      }
    }

    // Fallback: loop back into top ranked feed with shuffle to provide endless experience
    const looped = [...ranked].sort(() => 0.5 - Math.random()).slice(0, limit);
    res.json({
      videos: looped,
      page,
      limit,
      total: ranked.length || 100,
      hasMore: true,
    });
  } catch (error) {
    console.error('[Feed] Error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
