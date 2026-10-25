// utils/rtdb.js — Backend RTDB client (Admin SDK v14, 3 DBs)
// Reads: hot cache -> db1 /videos -> db1 /video_index -> shard channel path
// Writes: ServerValue.increment (atomic, server-side) — fire-and-forget safe
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const cache = require('./cache');

const SA = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tmp', f), 'utf8'));
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tmp', 'firebase_all_dbs.json'), 'utf8'));

const apps = {};
function db(name) {
  if (apps[name]) return apps[name];
  const e = REG.databases[name];
  const app = initializeApp({ credential: cert(SA(e.sa_file)), databaseURL: e.rtdb_url }, `rtdb-${name}`);
  apps[name] = getDatabase(app);
  return apps[name];
}

// id-prefix shard rule (shard-test se proven: a-m -> db2, else db3)
const shardOf = (id) => ('abcdefghijklm'.includes(String(id[0] || '').toLowerCase()) ? 'db2' : 'db3');

async function getVideo(id) {
  if (!id) return null;
  const ck = `rtdb_video_${id}`;
  const hit = cache.getCache(ck);
  if (hit) return hit;
  // 1) db1 hot layer
  try {
    const s = await db('db1').ref(`videos/${id}`).get();
    if (s.exists()) { cache.setCache(ck, s.val(), 120); return s.val(); }
  } catch {}
  // 2) index -> channel path
  try {
    const ix = await db('db1').ref(`video_index/${id}`).get();
    if (ix.exists()) {
      const { c, s: sh } = ix.val();
      const d = await db(sh).ref(`channel_videos/${c}/${id}`).get();
      if (d.exists()) { cache.setCache(ck, d.val(), 120); return d.val(); }
    }
  } catch {}
  // 3) legacy shard-test path /videos/{id}
  try {
    const d = await db(shardOf(id)).ref(`videos/${id}`).get();
    if (d.exists()) { cache.setCache(ck, d.val(), 120); return d.val(); }
  } catch {}
  return null;
}

// Atomic increments (server-side, no read-modify-write race)
function bump(id, paths) {
  // paths: { 'counters/ID/views': 1, 'algo/video_stats/ID/views24h': 1 }
  if (!id) return;
  const up = {};
  for (const [p, n] of Object.entries(paths)) up[p.replace('ID', id)] = ServerValue.increment(n);
  db('db1').ref().update(up).catch((e) => console.error('[rtdb] bump failed:', e.message));
  cache.deleteCache(`rtdb_video_${id}`);
}

const bumpView = (id) => bump(id, { 'counters/ID/views': 1, 'algo/video_stats/ID/views24h': 1, 'algo/video_stats/ID/views7d': 1, 'algo/video_stats/ID/clicks': 1 });
const bumpLike = (id) => bump(id, { 'counters/ID/likes': 1 });
const bumpComment = (id) => bump(id, { 'counters/ID/comments': 1, 'algo/video_stats/ID/commentCount': 1 });
const bumpShare = (id) => bump(id, { 'algo/video_stats/ID/shares': 1 });
const bumpImpression = (id) => bump(id, { 'algo/video_stats/ID/impressions': 1 });

module.exports = { getVideo, bumpView, bumpLike, bumpComment, bumpShare, bumpImpression, shardOf };
