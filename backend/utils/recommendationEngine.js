const cache = require('./cache');
const { predictScore } = require('./modelScorer');

// ─────────────────────────────────────────────────────────────────────
// Recommendation Engine — deterministic personalization brain
//
// YouTube/Instagram-style algorithm on 3 pillars:
//   1. Profile  = what this user likes (category + tag affinities,
//                 followed creators, from watch history + explicit signals)
//   2. Signals  = watch %, like, dislike, share, subscribe, skip, comment
//   3. Scoring  = interest match + creator affinity + popularity +
//                 freshness − seen penalty, with exploration mix
//
// No LLM calls, no per-request AI cost — pure math, runs in <1ms per video.
// ─────────────────────────────────────────────────────────────────────

const RECENCY_WEIGHTS = { 1: 1.0, 7: 0.8, 30: 0.5, 90: 0.3, inf: 0.1 };

const calculateRecencyWeight = (createdAt) => {
  if (!createdAt) return 0.5;
  const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  for (const [limit, weight] of Object.entries(RECENCY_WEIGHTS)) {
    if (limit === 'inf') continue;
    if (days <= parseInt(limit, 10)) return weight;
  }
  return RECENCY_WEIGHTS.inf;
};

// Popularity score 0..100 — same formula family as the trending feed
const calculateAlgoScore = (v) => {
  const recency = calculateRecencyWeight(v.createdAt);
  const likeCount = Array.isArray(v.likes) ? v.likes.length : (v.likes || 0);
  const viewsScore = Math.min((v.views || 0) / 10000, 100) * 0.4;
  const likesScore = Math.min(likeCount / 100, 100) * 0.3;
  const recencyScore = recency * 30;
  return viewsScore + likesScore + recencyScore;
};

const valueSum = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0);

// Decays old interests so long-ago engagements fade (like Instagram)
const decayInterests = (interests, factor = 0.96) => {
  const out = {};
  for (const [key, val] of Object.entries(interests || {})) {
    const next = val * factor;
    if (next > 0.15) out[key] = next;
  }
  return out;
};

// ── Profile building ─────────────────────────────────────────────────
// Derives { interests, tagScores, creatorIds, seen, hidden } from any
// user doc (or guest profile doc). watchHistory alone gives us taste.
const buildProfile = (user = {}) => {
  const interests = decayInterests(user.interests);
  const tagScores = { ...(user.tagScores || {}) };
  const creatorIds = new Set((user.subscriptions || []).map((c) => String(c)));
  const seen = new Set((user.watchHistory || []).map((v) => String(v)));
  (user.likedVideos || []).forEach((v) => seen.add(String(v)));
  (user.hiddenVideos || []).forEach((v) => seen.add(String(v)));
  (user.notInterestedVideos || []).forEach((v) => seen.add(String(v)));
  const hidden = new Set([
    ...(user.hiddenVideos || []).map((v) => String(v)),
    ...(user.notInterestedVideos || []).map((v) => String(v)),
  ]);

  const hasSignals =
    (user.watchHistory && user.watchHistory.length > 0) ||
    (user.likedVideos && user.likedVideos.length > 0) ||
    (user.subscriptions && user.subscriptions.length > 0) ||
    Object.keys(interests).length > 0;

  return { interests, tagScores, creatorIds, seen, hidden, hasSignals };
};

// ── Per-video scoring ────────────────────────────────────────────────
// 35% profile interest + 25% creator affinity + 15% popularity
// + 15% ML model prediction (upload-time features, new-video friendly)
// + 5% freshness + 5% tag overlap − seen demotion
const scoreVideo = (video, profile) => {
  const category = video.category || 'General';
  const interests = profile.interests || {};
  const maxInterest = Math.max(1, ...Object.values(interests));

  const interestScore = (interests[category] || 0) / maxInterest; // 0..1
  const tags = Array.isArray(video.tags) ? video.tags : [];
  const tagOverlap = tags.filter((t) => (profile.tagScores || {})[String(t).toLowerCase()]).length;
  const tagScore = Math.min(tagOverlap / 4, 1); // 0..1

  const uploader = video.uploader || {};
  const uploaderId = uploader.id || uploader._id;
  const creatorBoost = uploaderId && profile.creatorIds.has(String(uploaderId)) ? 1 : 0;

  const algoScore = calculateAlgoScore(video) / 100; // 0..~1
  const freshness = calculateRecencyWeight(video.createdAt);
  const modelScore = predictScore(video); // 0..1 (neutral 0.5 if no model)

  let score =
    35 * interestScore +
    25 * creatorBoost +
    15 * algoScore +
    15 * modelScore +
    5 * freshness +
    5 * tagScore;

  const videoId = String(video.id || video.youtube_id || (video._id && video._id.toString()) || '');
  if (profile.seen && profile.seen.has(videoId)) score -= 25;
  if (profile.hidden && profile.hidden.has(videoId)) score = -1e9;

  return score;
};

// ── Feed ranking with exploration mix ────────────────────────────────
// 75% personalized / 20% trending / 5% fresh — prevents the filter
// bubble the way YouTube+Instagram do (cold start = pure trending).
// Channel key jo bhi shape ho extract karo (channel / uploader / channelId / uploaderId)
const getChannelKey = (v) => {
  const ch = v.channel || v.uploader || {};
  return String(
    ch.channelId || ch.id || ch._id || ch.channelName || ch.username ||
    v.channelId || v.uploaderId || v.uploaderChannelId ||
    ch.name || ''
  ).trim();
};

// YouTube-style channel diversity: interleave so no channel repeats
// within a 6-video window and adjacent videos NEVER share a channel.
// Score-wise: highest-score video wins its slot, then next candidate
// is the best-scoring video from a channel not seen in the window.
const diversifyByChannel = (scoredVideos) => {
  const WINDOW = 6;
  const buckets = new Map(); // channelKey -> array of {v, score}
  const order = [];
  for (const item of scoredVideos) {
    const key = getChannelKey(item.v);
    if (!key) { order.push(item); continue; } // no channel -> free slot
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  // Channels sorted by their best video so heavy hitters still lead
  const channels = [...buckets.keys()].sort((a, b) => {
    const ba = buckets.get(b)[0].score, aa = buckets.get(a)[0].score;
    return ba - aa;
  });
  // Multi-pass fair round-robin: every pass takes one best video per
  // channel (channels with nothing left drop out).
  let placed = 0;
  const total = scoredVideos.length;
  let activeChannels = [...channels];
  const pointers = new Map();
  for (const c of activeChannels) pointers.set(c, 0);

  while (placed < total && activeChannels.length > 0) {
    if (activeChannels.length === 1) {
      const key = activeChannels[0];
      const bucket = buckets.get(key) || [];
      const ptr = pointers.get(key) || 0;
      for (let i = ptr; i < bucket.length; i++) order.push(bucket[i]);
      break;
    }
    const nextActive = [];
    for (const key of activeChannels) {
      const bucket = buckets.get(key);
      const ptr = pointers.get(key) || 0;
      if (!bucket || ptr >= bucket.length) continue;
      order.push(bucket[ptr]);
      pointers.set(key, ptr + 1);
      placed++;
      if (ptr + 1 < bucket.length) nextActive.push(key);
    }
    activeChannels = nextActive;
  }
  return order;
};

const rankFeed = (videos, profile) => {
  if (!profile || !profile.hasSignals) {
    const scored = videos.map((v) => ({ v, score: calculateAlgoScore(v) }));
    scored.sort((a, b) => b.score - a.score);
    // Diversify top 2000 candidate pool (100 pages of 20 items) in milliseconds
    const topCandidates = scored.slice(0, 2000);
    const rest = scored.slice(2000);
    return [...diversifyByChannel(topCandidates), ...rest].map((i) => i.v);
  }

  // Implicit taste: categories/tags of videos this user ALREADY watched get
  // an instant boost — zero DB reads, works for users with only watchHistory.
  const implicitInterests = {};
  const implicitTags = {};
  for (const v of videos) {
    const id = String(v.id || v.youtube_id || (v._id && v._id.toString()) || '');
    if (profile.seen && profile.seen.has(id)) {
      const cat = v.category || 'General';
      implicitInterests[cat] = (implicitInterests[cat] || 0) + 0.75;
      for (const t of Array.isArray(v.tags) ? v.tags : []) {
        implicitTags[String(t).toLowerCase()] = (implicitTags[String(t).toLowerCase()] || 0) + 0.4;
      }
    }
  }

  const localProfile = {
    ...profile,
    interests: { ...implicitInterests, ...(profile.interests || {}) },
    tagScores: { ...implicitTags, ...(profile.tagScores || {}) },
  };

  const total = videos.length;
  const personalShare = Math.max(1, Math.floor(total * 0.75));
  const trendingShare = Math.max(1, Math.floor(total * 0.2));

  const scored = videos.map((v) => ({ v, score: scoreVideo(v, localProfile) }));
  scored.sort((a, b) => b.score - a.score);

  const personalized = scored.slice(0, personalShare).filter((x) => x.score > -1e8);
  const rest = scored.slice(personalShare);

  const trending = rest
    .slice()
    .sort((a, b) => calculateAlgoScore(b.v) - calculateAlgoScore(a.v))
    .slice(0, trendingShare);
  const fresh = rest
    .slice()
    .sort((a, b) => new Date(b.v.createdAt || 0) - new Date(a.v.createdAt || 0))
    .slice(0, total - personalShare - trendingShare);

  const ordered = [...personalized, ...trending, ...fresh];
  const seenInFeed = new Set();
  const deduped = [];
  for (const item of ordered) {
    const id = String(item.v.id || item.v.youtube_id || '');
    if (seenInFeed.has(id)) continue;
    seenInFeed.add(id);
    deduped.push(item);
  }
  return diversifyByChannel(deduped).map((i) => i.v);
};

// ── Signal application ───────────────────────────────────────────────
// Weights per event type. watch_90 beats watch_25 — deeper watch = more taste.
const EVENT_WEIGHTS = {
  watch_25: 0.5,
  watch_50: 1.0,
  watch_75: 1.25,
  watch_90: 1.5,
  watch_100: 2.0,
  like: 3.0,
  dislike: -2.5,
  share: 2.0,
  comment: 1.0,
  subscribe: 1.5,
  skip: -1.5,
  not_interested: -3.0,
  impression: 0.05, // thumbnail dikha — CTR ka denominator (reetesh: feed me render pe bhejo)
};

const normalizeEventType = (type, percent) => {
  const t = String(type || '').toLowerCase();
  if (t === 'watch') {
    const p = Number(percent) || 0;
    if (p >= 100) return 'watch_100';
    if (p >= 90) return 'watch_90';
    if (p >= 75) return 'watch_75';
    if (p >= 50) return 'watch_50';
    if (p >= 25) return 'watch_25';
    return 'watch_25'; // any real watch start counts as mild interest
  }
  if (t === 'not_interested' || t === 'hide') return 'not_interested';
  if (t === 'impression') return 'impression'; // CTR denominator — profile pe halka asar
  if (EVENT_WEIGHTS[t] !== undefined) return t;
  return null;
};

// Mutates (clones) a profile payload that gets persisted on the user doc.
const applySignal = (payload, type, video) => {
  if (!video) return payload;
  const weight = EVENT_WEIGHTS[type];
  if (!weight) return payload;

  const category = video.category || 'General';
  payload.interests = payload.interests || {};
  payload.interests[category] = (payload.interests[category] || 0) + weight;

  const tags = Array.isArray(video.tags) ? video.tags : [];
  payload.tagScores = payload.tagScores || {};
  for (const tag of tags) {
    const key = String(tag).toLowerCase();
    payload.tagScores[key] = (payload.tagScores[key] || 0) + weight * 0.5;
  }

  const videoId = String(video.id || video.youtube_id || '');
  if (type === 'not_interested') {
    payload.notInterestedVideos = payload.notInterestedVideos || [];
    if (videoId && !payload.notInterestedVideos.includes(videoId)) {
      payload.notInterestedVideos.push(videoId);
    }
  }
  return payload;
};

// Feed cache helpers (per-user, 120s TTL — matches existing recsCache)
const getFeedCache = (key) => cache.getCache(`feed_${key}`);
const setFeedCache = (key, videos, ttl = 120) => cache.setCache(`feed_${key}`, videos, ttl);

module.exports = {
  calculateAlgoScore,
  calculateRecencyWeight,
  buildProfile,
  scoreVideo,
  rankFeed,
  EVENT_WEIGHTS,
  normalizeEventType,
  applySignal,
  getFeedCache,
  setFeedCache,
};