const fs = require('fs');
const path = require('path');
const { getAllChannelStats, getChannelStats, getChannelVideos, resolveChannelHandle } = require('./dbFirestore');
const { buildFeatureRow, durationBracket } = require('./videoStats');

// ─── algorithmTrainer.js — Offline supervised trainer ────────────
// db.json snapshot se "upload-time features → eventual views/engagement"
// mapping seekhta hai aur model weights JSON me dump karta hai.
// Recommender (feed) in weights ko scorer function se use karta hai.
//
// Modely simple bayesian-smoothed ranking model:
//   score(video, user) = base + Σ keyword_boost + category_boost
//                       + duration_boost + shorts_boost + channel_boost

const MODEL_DIR = path.join(__dirname, '../models');
const MODEL_PATH = path.join(MODEL_DIR, 'algorithmWeights.json');

// Laplace smoothing factor — kam samples ke keywords ko moderate karta hai
const SMOOTHING = 8;
const MIN_KEYWORD_SAMPLES = 2;
const MIN_CHANNEL_VIDEOS = 2;

const round = (n, d = 3) => Number(n.toFixed(d));

// Smoothed average: prior = global mean, pulled toward keyword's own mean
const smoothedMean = (kwMean, kwCount, globalMean, smoothing = SMOOTHING) =>
  (kwMean * kwCount + globalMean * smoothing) / (kwCount + smoothing);

class AlgorithmTrainer {
  constructor() {
    this.rows = [];
    this.channelStats = new Map();
    this.model = null;
  }

  // 1. Collect training rows: har video jo upload-time features + hindsight labels
  async collectRows({ minViews = 20, maxRows = 4000 } = {}) {
    const channels = await getAllChannelStats(MIN_CHANNEL_VIDEOS);
    for (const c of channels) this.channelStats.set(c.handle.toLowerCase(), c);

    for (const [handle, stats] of this.channelStats) {
      const videos = await getChannelVideos(stats.handle, 200);
      for (const v of videos) {
        const row = buildFeatureRow(v, stats);
        if (v.views !== undefined && v.views < minViews) continue; // dead videos label bias
        row.channelHandle = stats.handle;
        this.rows.push(row);
        if (this.rows.length >= maxRows) break;
      }
      if (this.rows.length >= maxRows) break;
    }
    console.log(`[trainer] Training rows: ${this.rows.length}`);
    return this.rows;
  }

  // 2. Keyword weights: average label per keyword, bayesian-smoothed
  buildKeywordWeights() {
    const kwCount = {};
    const kwSum = {};
    for (const row of this.rows) {
      const words = [...row.title, ...row.tags];
      for (const w of words) {
        kwCount[w] = (kwCount[w] || 0) + 1;
        kwSum[w] = (kwSum[w] || 0) + row.label;
      }
    }
    const globalMean = this.rows.reduce((s, r) => s + r.label, 0) / Math.max(1, this.rows.length);
    this.globalMean = globalMean;

    const weights = {};
    for (const [w, count] of Object.entries(kwCount)) {
      if (count < MIN_KEYWORD_SAMPLES) continue;
      weights[w] = round(smoothedMean(kwSum[w] / count, count, globalMean));
    }
    return { weights, globalMean };
  }

  // 3. Category / duration / shorts base rates (mean label per bucket)
  bucketWeights(field) {
    const groups = {};
    for (const row of this.rows) {
      const key = row[field] ?? 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(row.label);
    }
    const out = {};
    for (const [k, labels] of Object.entries(groups)) {
      out[k] = round(labels.reduce((s, l) => s + l, 0) / labels.length);
    }
    return out;
  }

  // 4. Channel boost: overshoot/undershoot vs category average
  channelBoosts() {
    const catAvg = this.bucketWeights('category');
    const boosts = {};
    for (const [handle, stats] of this.channelStats) {
      const rows = this.rows.filter((r) => (r.channelHandle || '').toLowerCase() === handle);
      if (!rows.length) continue;
      const channelMean = rows.reduce((s, r) => s + r.label, 0) / rows.length;
      const catMean = catAvg[rows[0].category] ?? this.globalMean ?? 0;
      boosts[handle] = round(channelMean - catMean, 4);
    }
    return boosts;
  }

  // 5. Assemble + persist model
  train() {
    if (!this.rows.length) throw new Error('Run collectRows() first — no training rows available');
    const { weights, globalMean } = this.buildKeywordWeights();
    const categories = this.bucketWeights('category');
    const durations = this.bucketWeights('durationBracket');
    const shorts = this.bucketWeights('isShort');

    const model = {
      version: 2,
      trainedAt: new Date().toISOString(),
      sampleCount: this.rows.length,
      globalMean: round(globalMean),
      keywords: weights,
      categories,
      durations,
      shorts,
      channels: this.channelBoosts(),
      meta: { source: 'db.json snapshot' }
    };
    this.model = model;
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    fs.writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2));
    return model;
  }

  // Convenience: collect rows → build model → persist
  async run({ minViews = 20, maxRows = 4000 } = {}) {
    await this.collectRows({ minViews, maxRows });
    this.train();
    return { path: MODEL_PATH, ...this.model };
  }

  static load() {
    if (!fs.existsSync(MODEL_PATH)) return null;
    return JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
  }
}

module.exports = { AlgorithmTrainer, MODEL_PATH, MODEL_DIR };