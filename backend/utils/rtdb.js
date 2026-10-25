// utils/rtdb.js — Unified RTDB Client across 3 Firebase databases
// db1: chat-site-123 (Hot layer + feed indices + meta + counters)
// db2: db-2-eaab5 (Shard 1)
// db3: db-3-81e76 (Shard 2)
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const cache = require('./cache');

const DB_CONFIGS = {
  db1: {
    url: 'https://chat-site-123-default-rtdb.firebaseio.com',
    saFile: 'firebase-chat-site-123-sa.json',
    envVar: 'FIREBASE_SERVICE_ACCOUNT'
  },
  db2: {
    url: 'https://db-2-eaab5-default-rtdb.asia-southeast1.firebasedatabase.app',
    saFile: 'firebase-db-2-sa.json',
    envVar: 'FIREBASE_SERVICE_ACCOUNT_DB2'
  },
  db3: {
    url: 'https://db-3-81e76-default-rtdb.asia-southeast1.firebasedatabase.app',
    saFile: 'firebase-db-3-sa.json',
    envVar: 'FIREBASE_SERVICE_ACCOUNT_DB3'
  }
};

function getShard(id) {
  if (!id) return 'db1';
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const idx = hash % 3;
  return idx === 0 ? 'db1' : (idx === 1 ? 'db2' : 'db3');
}

function loadServiceAccount(dbName) {
  const cfg = DB_CONFIGS[dbName];
  if (!cfg) return null;

  // 1) From environment variable (Cloud/Render)
  if (process.env[cfg.envVar]) {
    try {
      return typeof process.env[cfg.envVar] === 'string'
        ? JSON.parse(process.env[cfg.envVar])
        : process.env[cfg.envVar];
    } catch (e) {
      console.warn(`[rtdb] Failed to parse env var ${cfg.envVar}:`, e.message);
    }
  }

  // 2) From local tmp/ file
  const localFile = path.join(__dirname, '..', 'tmp', cfg.saFile);
  if (fs.existsSync(localFile)) {
    try {
      return JSON.parse(fs.readFileSync(localFile, 'utf8'));
    } catch (e) {
      console.warn(`[rtdb] Failed to read ${localFile}:`, e.message);
    }
  }

  // 3) Fallback: if db1 service account is present in credentials.json
  if (dbName === 'db1') {
    const credPath = path.join(__dirname, '..', 'config', 'credentials.json');
    if (fs.existsSync(credPath)) {
      try {
        return JSON.parse(fs.readFileSync(credPath, 'utf8'));
      } catch {}
    }
  }

  return null;
}

const apps = {};
function db(name) {
  if (apps[name]) return apps[name];
  const cfg = DB_CONFIGS[name];
  if (!cfg) return null;

  const sa = loadServiceAccount(name);
  if (!sa) {
    return null;
  }

  try {
    const appName = `rtdb-${name}`;
    const existing = getApps().find(a => a.name === appName);
    const app = existing || initializeApp({
      credential: cert(sa),
      databaseURL: cfg.url
    }, appName);
    apps[name] = getDatabase(app);
    return apps[name];
  } catch (err) {
    console.error(`[rtdb] Failed to init app for ${name}:`, err.message);
    return null;
  }
}

async function getVideo(id) {
  if (!id) return null;
  const ck = `rtdb_video_${id}`;
  const hit = cache.getCache(ck);
  if (hit) return hit;

  const shard = getShard(id);
  const targetDb = db(shard);

  if (targetDb) {
    try {
      const snap = await targetDb.ref(`videos/${id}`).get();
      if (snap.exists()) {
        const val = snap.val();
        cache.setCache(ck, val, 300);
        return val;
      }
    } catch (e) {
      console.warn(`[rtdb] get from ${shard} failed for ${id}:`, e.message);
    }
  }

  // Fallback: check db1 hot layer if different
  if (shard !== 'db1') {
    const db1 = db('db1');
    if (db1) {
      try {
        const snap = await db1.ref(`videos/${id}`).get();
        if (snap.exists()) {
          const val = snap.val();
          cache.setCache(ck, val, 300);
          return val;
        }
      } catch {}
    }
  }

  return null;
}

async function getFeedVideos({ category, page = 1, limit = 20 } = {}) {
  const db1 = db('db1');
  if (!db1) return null;

  try {
    let ids = null;
    if (category && category !== 'All') {
      const snap = await db1.ref(`feed/by_category/${category}`).get();
      if (snap.exists()) ids = snap.val();
    }
    if (!ids || ids.length === 0) {
      const snap = await db1.ref('feed/top_long').get();
      if (snap.exists()) ids = snap.val();
    }

    if (!ids || ids.length === 0) return null;

    const start = (page - 1) * limit;
    const pageIds = ids.slice(start, start + limit);

    const docs = await Promise.all(pageIds.map(id => getVideo(id)));
    return docs.filter(Boolean);
  } catch (err) {
    console.warn('[rtdb] getFeedVideos failed:', err.message);
    return null;
  }
}

async function getShortsFeed({ page = 1, limit = 20 } = {}) {
  const db1 = db('db1');
  if (!db1) return null;

  try {
    const snap = await db1.ref('feed/top_shorts').get();
    if (!snap.exists()) return null;
    const ids = snap.val();
    if (!ids || ids.length === 0) return null;

    const start = (page - 1) * limit;
    const pageIds = ids.slice(start, start + limit);

    const docs = await Promise.all(pageIds.map(id => getVideo(id)));
    return docs.filter(Boolean);
  } catch (err) {
    console.warn('[rtdb] getShortsFeed failed:', err.message);
    return null;
  }
}

function bump(id, paths) {
  if (!id) return;
  const db1 = db('db1');
  if (!db1) return;
  const up = {};
  for (const [p, n] of Object.entries(paths)) up[p.replace('ID', id)] = ServerValue.increment(n);
  db1.ref().update(up).catch((e) => console.error('[rtdb] bump failed:', e.message));
  cache.deleteCache(`rtdb_video_${id}`);
}

const bumpView = (id) => bump(id, { 'counters/ID/views': 1, 'algo/video_stats/ID/views24h': 1, 'algo/video_stats/ID/views7d': 1, 'algo/video_stats/ID/clicks': 1 });
const bumpLike = (id) => bump(id, { 'counters/ID/likes': 1 });
const bumpComment = (id) => bump(id, { 'counters/ID/comments': 1, 'algo/video_stats/ID/commentCount': 1 });
const bumpShare = (id) => bump(id, { 'algo/video_stats/ID/shares': 1 });
const bumpImpression = (id) => bump(id, { 'algo/video_stats/ID/impressions': 1 });

module.exports = {
  getVideo,
  getFeedVideos,
  getShortsFeed,
  getShard,
  shardOf: getShard,
  db,
  bumpView,
  bumpLike,
  bumpComment,
  bumpShare,
  bumpImpression
};
