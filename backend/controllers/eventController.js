const dbFirestore = require('../utils/dbFirestore');
const {
  normalizeEventType,
  applySignal,
  EVENT_WEIGHTS
} = require('../utils/recommendationEngine');

// POST /api/events — every user action becomes a personalization signal:
//   { type: 'watch'|'like'|'dislike'|'share'|'subscribe'|'skip'|'comment'|'not_interested',
//     videoId, percent, guestId }
// Logged-in users → their user doc gains interests. Guests → guest profile.
exports.recordEvent = async (req, res) => {
  try {
    const { type, videoId, percent, guestId } = req.body || {};
    if (!videoId) {
      return res.status(400).json({ message: 'videoId is required' });
    }

    const eventType = normalizeEventType(type, percent);
    if (!eventType) {
      return res.status(400).json({ message: `Unknown event type: ${type}` });
    }

    // Resolve the video (cached at the DB layer) so we can learn its category/tags
    let video = null;
    try {
      video = await dbFirestore.getVideoById(videoId);
    } catch (e) {
      video = null;
    }
    if (!video) video = { id: videoId, category: 'General', tags: [] };

    // DUAL-WRITE (algorithm training): user-side neeche hota hai, video-side
    // yahan — RTDB atomic increments, fire-and-forget (API ko slow nahi karta)
    try {
      const rtdb = require('../utils/rtdb');
      if (eventType.startsWith('watch_')) rtdb.bumpView(videoId);
      else if (eventType === 'like') rtdb.bumpLike(videoId);
      else if (eventType === 'comment') rtdb.bumpComment(videoId);
      else if (eventType === 'share') rtdb.bumpShare(videoId);
      else if (eventType === 'impression') rtdb.bumpImpression(videoId);
    } catch {}

    // 1. Logged-in user → update interests directly on their user doc
    if (req.user && req.user.id) {
      const userId = req.user.id;

      const existing = (await dbFirestore.getUserById(userId)) || {};
      const payload = {
        interests: { ...(existing.interests || {}) },
        tagScores: { ...(existing.tagScores || {}) },
        notInterestedVideos: [...(existing.notInterestedVideos || [])]
      };
      const updated = applySignal(payload, eventType, video);

      await dbFirestore.updateUser(userId, {
        interests: updated.interests,
        tagScores: updated.tagScores,
        notInterestedVideos: updated.notInterestedVideos,
        lastEvent: new Date().toISOString()
      });

      return res.json({ ok: true, type: eventType, weight: EVENT_WEIGHTS[eventType] });
    }

    // 2. Guest → anonymous profile keyed by guestId from localStorage
    if (guestId) {
      const existing = (await dbFirestore.getGuestProfile(guestId)) || {};
      const payload = {
        interests: { ...(existing.interests || {}) },
        tagScores: { ...(existing.tagScores || {}) },
        notInterestedVideos: [...(existing.notInterestedVideos || [])],
        watchHistory: [...(existing.watchHistory || [])]
      };
      const updated = applySignal(payload, eventType, video);

      if ('watch_25' === eventType || eventType.startsWith('watch_')) {
        if (!updated.watchHistory.includes(videoId)) {
          updated.watchHistory.unshift(videoId);
          if (updated.watchHistory.length > 100) updated.watchHistory.length = 100;
        }
      }

      await dbFirestore.updateGuestProfile(guestId, updated);
      return res.json({ ok: true, type: eventType, weight: EVENT_WEIGHTS[eventType] });
    }

    // 3. No identity at all — accept silently (no signal to store)
    return res.json({ ok: true, type: eventType, stored: false });
  } catch (error) {
    console.error('[Events] Error recording event:', error.message);
    res.status(500).json({ message: error.message });
  }
};