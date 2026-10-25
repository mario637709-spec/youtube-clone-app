// utils/notify.js — user/video/notification functions (sab DBs jude hue)
// - getUserFull(uid): profile(db1) + subs + likes + history + notifications count
// - getVideoFull(videoId): doc(shard) + counters(db1) + algo stats + related + comments info
// - onNewVideo(channelId, video): subscribers ko fan-out (notif_queue + /notifications)
// - toggleSub(uid, channelId): /user_subs + /subs_by_channel dual index + counts
const { getDb } = require('../tmp/firebase_all');
const rtdb = require('./rtdb');

async function rGet(dbName, p) {
  const { token, url } = await getDb(dbName);
  const https = require('https');
  return new Promise((resolve, reject) => {
    const u = new URL(url + p);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function rPatch(dbName, body) {
  const { token, url } = await getDb(dbName);
  const https = require('https');
  const data = JSON.stringify(body);
  const u = new URL(url + '/.json');
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ---- USER: ek id se poora user (profile + subs + likes + history + notif count)
async function getUserFull(uid) {
  const [profile, subs, likes, history, notifs] = await Promise.all([
    rGet('db1', `/users/${uid}.json`),
    rGet('db1', `/user_subs/${uid}.json`),
    rGet('db1', `/user_likes/${uid}.json`),
    rGet('db1', `/watch_history/${uid}.json`),
    rGet('db1', `/notifications/${uid}.json?shallow=true`),
  ]);
  return {
    profile: profile || null,
    subscriptions: subs ? Object.keys(subs) : [],
    likedVideos: likes ? Object.keys(likes).filter((k) => likes[k] === 'like') : [],
    watchHistory: history || [],
    unreadNotifications: notifs ? Object.keys(notifs).length : 0,
  };
}

// ---- VIDEO: ek id se poora video (doc + live counters + algo + related)
async function getVideoFull(videoId) {
  const doc = await rtdb.getVideo(videoId);
  if (!doc) return null;
  const [counters, stats, related] = await Promise.all([
    rGet('db1', `/counters/${videoId}.json`),
    rGet('db1', `/algo/video_stats/${videoId}.json`),
    rGet('db1', `/related/${videoId}.json`),
  ]);
  return { ...doc, liveViews: counters?.views ?? doc.views ?? 0, liveLikes: counters?.likes ?? doc.likes ?? 0, algo: stats || null, relatedIds: related || [] };
}

// ---- SUBSCRIBE: dual index (user->channels + channel->users) + counts
async function setSub(uid, channelId, subscribed) {
  const ts = Date.now();
  if (subscribed) {
    await Promise.all([
      rPatch('db1', { [`user_subs/${uid}/${channelId}`]: ts }),
      rPatch('db1', { [`subs_by_channel/${channelId}/${uid}`]: ts }),
    ]);
  } else {
    await Promise.all([
      rPatch('db1', { [`user_subs/${uid}/${channelId}`]: null }),
      rPatch('db1', { [`subs_by_channel/${channelId}/${uid}`]: null }),
    ]);
  }
  return { subscribed };
}

async function toggleSub(uid, channelId) {
  const cur = await rGet('db1', `/user_subs/${uid}/${channelId}.json`);
  if (cur) {
    await Promise.all([
      rPatch('db1', { [`user_subs/${uid}/${channelId}`]: null }),
      rPatch('db1', { [`subs_by_channel/${channelId}/${uid}`]: null }),
    ]);
    return { subscribed: false };
  }
  const ts = Date.now();
  await Promise.all([
    rPatch('db1', { [`user_subs/${uid}/${channelId}`]: ts }),
    rPatch('db1', { [`subs_by_channel/${channelId}/${uid}`]: ts }),
  ]);
  return { subscribed: true };
}

// ---- NOTIFY: naye video pe subscribers ko fan-out
// crawl flush se fire-and-forget call hota hai (await mat karna)
async function onNewVideo(channelId, video) {
  try {
    const subs = await rGet('db1', `/subs_by_channel/${channelId}.json`);
    const uids = subs ? Object.keys(subs) : [];
    const entry = {
      videoId: video.id, title: video.title, thumbnail: video.thumbnail,
      channelId, channelName: video.uploader?.channelName || '', createdAt: Date.now(), read: false,
    };
    await rPatch('db1', { [`notif_queue/${video.id}`]: { ...entry, subscriberCount: uids.length } });
    // fan-out (500 per chunk taaki PATCH chhota rahe)
    for (let i = 0; i < uids.length; i += 500) {
      const b = {};
      for (const u of uids.slice(i, i + 500)) b[`notifications/${u}/${video.id}`] = entry;
      await rPatch('db1', b);
    }
    return { notified: uids.length };
  } catch (e) {
    console.error('[notify] fan-out failed:', e.message);
    return { notified: 0 };
  }
}

module.exports = { getUserFull, getVideoFull, toggleSub, onNewVideo };
