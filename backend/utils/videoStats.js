const { getChannelVideos } = require('./dbFirestore');

// ─── videoStats.js — Predictive scoring engine ───────────────────
// Hindsight feature-extractor: video ki performance ko un FEATURES se
// score karta hai jo upload ke DIN hi female tih hote hain (title,
// tags, duration, shorts, category, channel cadence). Ye "future"
// (views/likes/comments) data ke sath milakar algorithmTrainer.js ko
// supervised training data deta hai.
//
// Model form:  predictedPerformance = f(titleFeature, tagsFeature,
// durationBracket, isShort, categoryBoost, channelCadenceBoost)

// ─── Text features ────────────────────────────────────────────────
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that',
  'these', 'those', 'it', 'its', 'as', 'from', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just',
  'don', 'now', 'vs', 'ft', 'the', 'de', 'la', 'le', 'ka', 'ki', 'ke',
  'mein', 'me', 'se', 'kiya', 'kya', 'hai', 'hain', 'ko', 'bhi', 'nahi',
  'aur', 'new', 'official', 'video', 'full', 'hd', 'watch'
]);

// Title ka feature fingerprint — normalized keywords, ordered by length desc
const titleFeatures = (title = '') => {
  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const unique = [...new Set(words)];
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, 8);
};

const tagFeatures = (tags = []) => {
  const clean = (tags || [])
    .map((t) => String(t).toLowerCase().trim())
    .filter((t) => t.length > 2);
  return [...new Set(clean)].slice(0, 12);
};

// ─── Duration bracket ─────────────────────────────────────────────
const durationToSeconds = (duration = '0:00') => {
  const parts = String(duration).split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

const durationBracket = (duration, isShort) => {
  if (isShort) return 'short';
  const secs = durationToSeconds(duration);
  if (secs < 60) return 'under60';
  if (secs <= 180) return '3min';
  if (secs <= 600) return '10min';
  return 'long';
};

// ─── Performance targets (labels for training) ────────────────────
// Engagement rate = (likes + comments) / views — views ke bina (i.e. new
// uploads) ke liye 0. Log-scale targets raw numbers ko typering se
// stabilize karte hain.
const VIEWS_LABEL_WEIGHT = 1.0;
const ENGAGEMENT_LABEL_WEIGHT = 0.6;
const SHORT_DAYS_WEIGHT = 0.15; // new video (age < 2 days)

const performanceLabel = (video) => {
  const views = video.views || 0;
  const likes = video.likes || 0;
  const comments = video.commentCount || 0;
  const ageDays = Math.max(0, (Date.now() - new Date(video.createdAt).getTime()) / (24 * 3600 * 1000));

  const viewsScore = Math.log10(1 + views);
  const engagement = views > 0 ? (likes + comments) / views : 0;
  const engagementScore = Math.log10(1 + engagement * 1000);

  let label = ENGAGEMENT_LABEL_WEIGHT * engagementScore + VIEWS_LABEL_WEIGHT * viewsScore;
  if (ageDays < 2) label = Math.min(label * SHORT_DAYS_WEIGHT, 1); // fresh upload: low label, high uncertainty
  return {
    label,
    views,
    likes,
    comments,
    engagementRate: +engagement.toFixed(4),
    ageDays: +ageDays.toFixed(1)
  };
};

// ─── Feature row builder ──────────────────────────────────────────
const buildFeatureRow = (video, channelStats = null) => {
  const { label, views, likes, comments, engagementRate, ageDays } = performanceLabel(video);
  const bracket = durationBracket(video.duration, video.isShort);

  return {
    // features (upload-time only)
    videoId: video.id || video.youtube_id,
    title: titleFeatures(video.title),
    tags: tagFeatures(video.tags),
    category: video.category || 'unknown',
    durationBracket: bracket,
    isShort: !!video.isShort,
    // channel cadence features (also upload-time known)
    channelVideos: channelStats ? channelStats.videoCount : 0,
    channelAvgViews: channelStats ? channelStats.avgViewsPerVideo : 0,
    channelUploadsPerWeek: channelStats ? channelStats.uploadsPerWeek : 0,
    // labels (hindsight)
    label,
    views,
    likes,
    comments,
    engagementRate,
    ageDays,
    createdAt: video.createdAt
  };
};

// ─── Trie-free keyword index builder (for recommender reuse) ──────
const keywordIndex = (rows) => {
  const index = {};
  for (const row of rows) {
    const words = [...row.title, ...row.tags];
    for (const w of words) {
      if (!index[w]) index[w] = [];
      index[w].push(row.videoId);
    }
  }
  return index;
};

module.exports = {
  titleFeatures,
  tagFeatures,
  durationToSeconds,
  durationBracket,
  performanceLabel,
  buildFeatureRow,
  keywordIndex,
  getChannelVideos,
  WEIGHTS: { VIEWS_LABEL_WEIGHT, ENGAGEMENT_LABEL_WEIGHT }
};