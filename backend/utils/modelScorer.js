const { AlgorithmTrainer, MODEL_PATH } = require('./algorithmTrainer');
const { durationBracket, titleFeatures, tagFeatures } = require('./videoStats');

// ─── modelScorer.js — Trained-model inference for feed ranking ────
// algorithmTrainer.js se bana model (models/algorithmWeights.json) load
// karta hai aur kisi bhi video ko UPLOAD-TIME features se score karta
// hai — views hone ya na hone ka wait nahi. New videos (0 views) jo
// trending potential rakhti hain unhe feed me upar latne ka kaam ye
// karta hai.
//
// Output: score roughly log10-scale ka normalized 0..1 nishan.

let cachedModel = null;
let modelMtime = 0;

const loadModel = () => {
  try {
    const fs = require('fs');
    const stat = fs.statSync(MODEL_PATH);
    if (cachedModel && stat.mtimeMs === modelMtime) return cachedModel;
    const model = AlgorithmTrainer.load();
    if (!model) return null;
    cachedModel = model;
    modelMtime = stat.mtimeMs;
    return model;
  } catch {
    return null;
  }
};

// Model available ho to return true — server logs once on first check
let warned = false;
const isModelReady = () => {
  const ok = !!loadModel();
  if (!ok && !warned) {
    console.warn('[modelScorer] No trained model — run: node utils/trainAll.js --no-sync');
    warned = true;
  }
  return ok;
};

// Feature score: globalMean + keyword overshoots + category/duration/shorts
const predictRawScore = (video, model) => {
  const title = titleFeatures(video.title);
  const tags = tagFeatures(video.tags);
  const category = video.category || 'unknown';
  const bracket = durationBracket(video.duration, video.isShort);
  const shortsKey = String(!!video.isShort);

  let score = model.globalMean || 0;
  const words = [...title, ...tags];
  for (const w of words) {
    if (model.keywords[w] !== undefined) score += model.keywords[w] - model.globalMean;
  }
  score += (model.categories[category] || 0) - model.globalMean;
  score += (model.durations[bracket] || 0) - model.globalMean;
  score += (model.shorts[shortsKey] || 0) - model.globalMean;

  const handle = (video.syncedFrom || '').replace(/^@/, '') ||
    (video.uploader && video.uploader.username) || '';
  if (handle && model.channels[handle] !== undefined) score += model.channels[handle];

  return score;
};

// Normalized 0..1 (sigmoid-ish clamp on predicted log-label)
const predictScore = (video) => {
  const model = loadModel();
  if (!model) return 0.5; // no model → neutral (don't distort existing ranker)
  const raw = predictRawScore(video, model);
  // Model labels range ~0..9; squash with soft clamp: 1 / (1 + e^-(x-2))
  const normalized = 1 / (1 + Math.exp(-(raw - 2)));
  return Math.min(1, Math.max(0, normalized));
};

// Model se trained channel baseline — trending calibration ke liye
const getModelSummary = () => {
  const model = loadModel();
  if (!model) return null;
  return {
    trainedAt: model.trainedAt,
    samples: model.sampleCount,
    keywords: Object.keys(model.keywords).length,
    categories: Object.keys(model.categories).length,
  };
};

module.exports = { predictScore, getModelSummary, isModelReady, MODEL_PATH };