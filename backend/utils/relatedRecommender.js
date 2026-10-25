const mongoose = require('mongoose');
const { readDb, writeDb } = require('./dbJson');
const { calculateRecencyWeight } = require('./recommendationEngine');

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','is','are','was','were',
  'vs','feat','ft','official','video','music','song','new','hd','4k','full','hdq','hd',
  'best','top','live','lyrics','audio','film','movie','episode','ep','part','mix','2026','2025','2024'
]);

const tokenize = (text = '') =>
  new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );

const jaccard = (a, b) => {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};

const uploaderId = (v) => {
  const u = v && (v.uploader || {});
  const raw = (u && (u.id || u._id || u.userId)) || '';
  return String(raw).toLowerCase();
};

const CHANNEL_NAME_KEYS = ['name', 'channelName', 'username', 'title'];

const channelNameOf = (v) => {
  const u = v && v.uploader;
  if (!u) return '';
  for (const key of CHANNEL_NAME_KEYS) {
    if (u[key]) return String(u[key]);
  }
  return '';
};

// YouTube-style "Up Next": category is the anchor (a viewer watching a
// cooking video mostly wants more cooking videos), then tag overlap,
// title/description token similarity, and a popularity + freshness
// tiebreak so the list stays interesting.
//
// CHANNEL DIVERSITY: unlike the old scorer (which gave the same channel
// a flat +30 bonus and flooded the sidebar with one channel's uploads),
// we now hard-limit any single channel to at most 1 slot in the top 8
// and 2 slots total. Category matching drives the list, like YouTube.
const computeRelatedVideos = (targetVideo, allVideos, opts = {}) => {
  const limit = opts.limit || 15;
  const targetId = String(targetVideo.id || '');
  const targetTitle = tokenize(targetVideo.title);
  const targetDesc = tokenize(targetVideo.description);
  const targetCat = targetVideo.category || 'General';
  const targetTags = new Set((targetVideo.tags || []).map((t) => String(t).toLowerCase()));
  const targetUploader = uploaderId(targetVideo);
  const targetUploaderName = channelNameOf(targetVideo);

  const scored = [];
  for (const v of allVideos) {
    const vid = String(v.id || '');
    if (!vid || vid === targetId) continue;
    if (v.status === 'Flagged') continue;
    const sl = v.storageLocation;
    if (!['YouTube', 'GDrive', 'Local'].includes(sl)) continue;

    const catMatch = (v.category || 'General') === targetCat;

    const tags = new Set((v.tags || []).map((t) => String(t).toLowerCase()));
    let inter = 0;
    for (const t of tags) if (targetTags.has(t)) inter++;
    const union = targetTags.size + tags.size - inter;
    const tagScore = union === 0 ? 0 : Math.min((inter / union) * 20, 20);

    const titleSim = jaccard(targetTitle, tokenize(v.title)) * 25;
    const descSim = jaccard(targetDesc, tokenize(v.description)) * 10;

    const sameUploader = targetUploader !== '' && uploaderId(v) === targetUploader;
    // Tiny same-channel affinity (like YouTube showing 1 more video from
    // the same creator) but it must NEVER dominate the sidebar.
    const channelBonus = sameUploader ? 8 : 0;

    const nameSim = (() => {
      const cand = channelNameOf(v);
      if (!targetUploaderName || !cand) return 0;
      return jaccard(tokenize(targetUploaderName), tokenize(cand)) * 12;
    })();

    const viewsBoost = Math.min((v.views || 0) / 25000, 20);
    const freshBoost = calculateRecencyWeight(v.createdAt) * 10;

    const score =
      (catMatch ? 60 : 0) + channelBonus + tagScore + titleSim + descSim + nameSim + viewsBoost + freshBoost;

    if (score <= 0) continue;
    scored.push({ v, score, sameUploader });
  }

  scored.sort((a, b) => b.score - a.score || (b.v.views || 0) - (a.v.views || 0));

  // Channel diversity pass: cap one channel at 1 slot in top 8,
  // 2 slots overall. Same-channel-as-target gets at most 1 slot.
  const channelCount = new Map();
  const final = [];
  let sameUploaderSeen = false;
  for (const item of scored) {
    const key = uploaderId(item.v) || channelNameOf(item.v) || String(item.v.id || '');
    const used = channelCount.get(key) || 0;
    const isTop8 = final.length < 8;
    if (used >= (isTop8 ? 1 : 2)) continue;
    if (item.sameUploader && sameUploaderSeen) continue;
    if (item.sameUploader) sameUploaderSeen = true;
    channelCount.set(key, used + 1);
    final.push(item);
    if (final.length >= limit) break;
  }

  return final.map(({ v, score }, i) => ({
    ...v,
    relevanceScore: Math.round(score),
    rank: i + 1,
  }));
};

const isMongoConnected = () =>
  mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db;

const getStoredRelated = async (videoId) => {
  try {
    if (isMongoConnected()) {
      const col = mongoose.connection.db.collection('recommendations');
      const doc = await col.findOne({ videoId });
      if (doc && doc.related) {
        return { related: doc.related, computedAt: doc.computedAt || 0 };
      }
    }
  } catch (e) {
    console.error('[relatedRecommender] Mongo read error:', e.message);
  }
  try {
    const local = readDb();
    const rec = local.recommendations && local.recommendations[videoId];
    if (rec && rec.related) {
      return { related: rec.related, computedAt: rec.computedAt || 0 };
    }
  } catch (e) {
    console.error('[relatedRecommender] db.json read error:', e.message);
  }
  return null;
};

const setStoredRelated = async (videoId, related) => {
  const payload = { videoId, related, computedAt: Date.now() };
  try {
    if (isMongoConnected()) {
      const col = mongoose.connection.db.collection('recommendations');
      await col.updateOne({ videoId }, { $set: payload }, { upsert: true });
    }
  } catch (e) {
    console.error('[relatedRecommender] Mongo write error:', e.message);
  }
  try {
    const local = readDb();
    local.recommendations = local.recommendations || {};
    local.recommendations[videoId] = { related, computedAt: payload.computedAt };
    writeDb(local);
  } catch (e) {
    console.error('[relatedRecommender] db.json write error:', e.message);
  }
};

const RECS_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_RELATED = 4;

module.exports = {
  computeRelatedVideos,
  getStoredRelated,
  setStoredRelated,
  RECS_TTL_MS,
  MIN_RELATED,
};