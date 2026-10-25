const mongoose = require('mongoose');
const { db, isRealFirebase } = require('../config/firebase');
const { readDb, readAllVideos, writeDb, readShortsVideos, readLongVideos } = require('./dbJson');
const rtdb = require('./rtdb'); // Firebase RTDB hot layer (db1/db2/db3) — read-first

// Firestore reads are slow on cold connections (2325 docs ~30s). Every
// Firestore call gets a timeout race — on timeout we fall back to the
// local db.json snapshot so the API never hangs for users.
const FIRESTORE_TIMEOUT_MS = 8000;

// ─── Firestore circuit breaker ────────────────────────────────────
// When Firestore is unreachable, every call burns 8s on a timeout race
// before falling back to db.json (feed ~8s, notification spam, etc.).
// After 2 consecutive failures the breaker OPENS and Firestore calls
// are skipped entirely for 5 minutes (instant fallback). A single
// success resets the counter so it re-arms automatically.
const firestoreCircuit = { failures: 0, disabledUntil: 0 };
const FIRESTORE_MAX_FAILURES = 2;
const FIRESTORE_COOLDOWN_MS = 5 * 60 * 1000;

const isFirestoreUsable = () => {
  if (!isRealFirebase) return false;
  if (Date.now() < firestoreCircuit.disabledUntil) return false;
  return true;
};

const recordFirestoreFailure = () => {
  firestoreCircuit.failures++;
  if (firestoreCircuit.failures >= FIRESTORE_MAX_FAILURES) {
    firestoreCircuit.disabledUntil = Date.now() + FIRESTORE_COOLDOWN_MS;
    firestoreCircuit.failures = 0;
    console.warn(`[dbFirestore] ⛔ Circuit breaker OPEN — skipping Firestore for ${FIRESTORE_COOLDOWN_MS / 60000} min (${FIRESTORE_MAX_FAILURES}+ consecutive failures)`);
  }
};

const recordFirestoreSuccess = () => {
  firestoreCircuit.failures = 0;
};

const withTimeout = (promise, ms = FIRESTORE_TIMEOUT_MS, label = 'firestore') => {
  if (!isRealFirebase || !isFirestoreUsable()) return promise;
  return Promise.race([
    promise.then((v) => { recordFirestoreSuccess(); return v; }),
    new Promise((_, reject) => setTimeout(() => { recordFirestoreFailure(); reject(new Error(`${label} timed out after ${ms}ms`)); }, ms)),
  ]);
};

// Helper to check if MongoDB is active and connected
const isMongoConnected = () => {
  return mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db;
};

// Helper to sanitize Firestore documents
const formatDoc = (doc) => {
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
};

// 1. Fetch all videos
const getVideos = async (query = {}) => {
  const { category } = query;

  if (isRealFirebase && isFirestoreUsable()) {
    try {
      let ref = db.collection('videos');
      if (category && category !== 'All') {
        ref = ref.where('category', '==', category);
      }
      const snapshot = await withTimeout(ref.get(), FIRESTORE_TIMEOUT_MS, `firestore getVideos(${category || 'all'})`);
      const list = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      return list;
    } catch (err) {
      console.error(`Firestore getVideos error (${category || 'all'}):`, err.message);
    }
  }

  // MongoDB active fallback
  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('videos');
      let filter = {};
      if (category && category !== 'All') {
        filter.category = category;
      }
      return await dbCol.find(filter).toArray();
    } catch (err) {
      console.error('MongoDB getVideos error:', err.message);
    }
  }

  // Fallback JSON DB — this runs when Firestore/Mongo are slow or down,
  // keeping the homepage feed responsive (db.json is synced by the ingester).
  // readAllVideos() merges main db.json + db_worker0-4.json (469k corpus).
  const { videos } = readAllVideos();
  let list = Object.values(videos);
  if (category && category !== 'All') {
    list = list.filter(v => v.category === category);
  }
  return list;
};

// 1.1 Fetch Shorts videos dedicated
const getShortsVideos = async () => {
  const shortsObj = readShortsVideos();
  return Object.values(shortsObj);
};

// 1.2 Fetch Long format videos dedicated
const getLongVideos = async () => {
  const longObj = readLongVideos();
  return Object.values(longObj);
};

// 2. Fetch video by ID — RTDB-first (db1 hot -> index -> shard), phir purana chain
const getVideoById = async (id) => {
  try {
    const hit = await rtdb.getVideo(id);
    if (hit) return hit;
  } catch (err) {
    console.error('RTDB getVideoById miss:', err.message);
  }

  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const doc = await withTimeout(db.collection('videos').doc(id).get(), FIRESTORE_TIMEOUT_MS, `firestore getVideoById(${id})`);
      return formatDoc(doc);
    } catch (err) {
      console.error('Firestore getVideoById error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('videos');
      return await dbCol.findOne({ id });
    } catch (err) {
      console.error('MongoDB getVideoById error:', err.message);
    }
  }

  const { videos } = readAllVideos();
  return videos[id] || null;
};

// 3. Create video
const createVideo = async (id, videoData) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      await db.collection('videos').doc(id).set(videoData);
    } catch (err) {
      console.error('Firestore createVideo error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('videos');
      const data = { _id: id, id, ...videoData };
      await dbCol.updateOne({ id }, { $set: data }, { upsert: true });
      return data;
    } catch (err) {
      console.error('MongoDB createVideo error:', err.message);
    }
  }

  const localDb = readDb();
  localDb.videos[id] = { id, ...videoData };
  writeDb(localDb);
  return localDb.videos[id];
};

// 4. Update video fields
const updateVideo = async (id, updates) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const ref = db.collection('videos').doc(id);
      await ref.update(updates);
    } catch (err) {
      console.error('Firestore updateVideo error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('videos');
      await dbCol.updateOne({ id }, { $set: updates });
      return await dbCol.findOne({ id });
    } catch (err) {
      console.error('MongoDB updateVideo error:', err.message);
    }
  }

  const localDb = readDb();
  if (localDb.videos[id]) {
    localDb.videos[id] = { ...localDb.videos[id], ...updates };
    writeDb(localDb);
    return localDb.videos[id];
  }
  return null;
};

// 5. Delete video
const deleteVideo = async (id) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      await db.collection('videos').doc(id).delete();
    } catch (err) {
      console.error('Firestore deleteVideo error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('videos');
      const res = await dbCol.deleteOne({ id });
      return res.deletedCount > 0;
    } catch (err) {
      console.error('MongoDB deleteVideo error:', err.message);
    }
  }

  const localDb = readDb();
  if (localDb.videos[id]) {
    delete localDb.videos[id];
    writeDb(localDb);
    return true;
  }
  return false;
};

// 6. Fetch comments for a video
const getComments = async (videoId) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const snapshot = await withTimeout(
        db
          .collection('comments')
          .where('video', '==', videoId)
          .get(),
        FIRESTORE_TIMEOUT_MS,
        `firestore getComments(${videoId})`
      );
      const list = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return list;
    } catch (err) {
      console.error('Firestore getComments error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('comments');
      const list = await dbCol.find({ video: videoId }).toArray();
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return list;
    } catch (err) {
      console.error('MongoDB getComments error:', err.message);
    }
  }

  const localDb = readDb();
  const comments = Object.values(localDb.comments || {})
    .filter(c => c.video === videoId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return comments;
};

// 7. Add a comment
const addComment = async (commentData) => {
  const commentId = Math.random().toString(36).substring(2, 11);
  const data = { id: commentId, ...commentData, createdAt: new Date().toISOString() };

  if (isRealFirebase && isFirestoreUsable()) {
    try {
      await db.collection('comments').doc(commentId).set(data);
    } catch (err) {
      console.error('Firestore addComment error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('comments');
      const mongoData = { _id: commentId, ...data };
      await dbCol.insertOne(mongoData);
      return data;
    } catch (err) {
      console.error('MongoDB addComment error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.comments) localDb.comments = {};
  localDb.comments[commentId] = data;
  writeDb(localDb);
  return data;
};

// 8. Fetch user by ID
const getUserById = async (id) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const doc = await withTimeout(db.collection('users').doc(id).get(), FIRESTORE_TIMEOUT_MS, 'firestore getUserById');
      return formatDoc(doc);
    } catch (err) {
      console.error('Firestore getUserById error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('users');
      return await dbCol.findOne({ id });
    } catch (err) {
      console.error('MongoDB getUserById error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.users) localDb.users = {};
  return localDb.users[id] || null;
};

// 9. Fetch user by email
const getUserByEmail = async (email) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const snapshot = await withTimeout(db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get(), FIRESTORE_TIMEOUT_MS, 'firestore getUserByEmail');
      if (snapshot.empty) return null;
      let user = null;
      snapshot.forEach(doc => { user = { id: doc.id, ...doc.data() }; });
      return user;
    } catch (err) {
      console.error('Firestore getUserByEmail error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('users');
      return await dbCol.findOne({ email: email.toLowerCase() });
    } catch (err) {
      console.error('MongoDB getUserByEmail error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.users) localDb.users = {};
  return Object.values(localDb.users).find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
};

// 10. Fetch user by username
const getUserByUsername = async (username) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const snapshot = await withTimeout(db.collection('users').where('username', '==', username).limit(1).get(), FIRESTORE_TIMEOUT_MS, 'firestore getUserByUsername');
      if (snapshot.empty) return null;
      let user = null;
      snapshot.forEach(doc => { user = { id: doc.id, ...doc.data() }; });
      return user;
    } catch (err) {
      console.error('Firestore getUserByUsername error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('users');
      return await dbCol.findOne({ username });
    } catch (err) {
      console.error('MongoDB getUserByUsername error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.users) localDb.users = {};
  return Object.values(localDb.users).find(u => u.username === username) || null;
};

// 11. Create user
const createUser = async (id, userData) => {
  const data = { id, ...userData, email: userData.email.toLowerCase() };
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      await db.collection('users').doc(id).set(data);
    } catch (err) {
      console.error('Firestore createUser error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('users');
      const mongoData = { _id: id, ...data };
      await dbCol.updateOne({ id }, { $set: mongoData }, { upsert: true });
      return data;
    } catch (err) {
      console.error('MongoDB createUser error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.users) localDb.users = {};
  localDb.users[id] = data;
  writeDb(localDb);
  return data;
};

// 12. Update user
const updateUser = async (id, updates) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const ref = db.collection('users').doc(id);
      await ref.update(updates);
    } catch (err) {
      console.error('Firestore updateUser error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('users');
      await dbCol.updateOne({ id }, { $set: updates });
      return await dbCol.findOne({ id });
    } catch (err) {
      console.error('MongoDB updateUser error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.users) localDb.users = {};
  if (localDb.users[id]) {
    localDb.users[id] = { ...localDb.users[id], ...updates };
    writeDb(localDb);
    return localDb.users[id];
  }
  return null;
};

// 13. Fetch pending youtube notifications
const getPendingNotifications = async (limitVal = 5) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const snapshot = await withTimeout(db.collection('youtube_notifications')
        .where('status', '==', 'Pending')
        .limit(limitVal)
        .get(), FIRESTORE_TIMEOUT_MS, 'firestore notifications');
      const list = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      return list;
    } catch (err) {
      console.error('Firestore getPendingNotifications error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('youtube_notifications');
      return await dbCol.find({ status: 'Pending' }).limit(limitVal).toArray();
    } catch (err) {
      console.error('MongoDB getPendingNotifications error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.youtube_notifications) localDb.youtube_notifications = {};
  const list = Object.values(localDb.youtube_notifications)
    .filter(n => n.status === 'Pending')
    .slice(0, limitVal);
  return list;
};

// 14. Create youtube notification
const createNotification = async (videoId, data) => {
  const finalData = { videoId, status: 'Pending', createdAt: new Date().toISOString(), ...data };
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      await db.collection('youtube_notifications').doc(videoId).set(finalData);
    } catch (err) {
      console.error('Firestore createNotification error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('youtube_notifications');
      const mongoData = { _id: videoId, ...finalData };
      await dbCol.updateOne({ videoId }, { $set: mongoData }, { upsert: true });
      return finalData;
    } catch (err) {
      console.error('MongoDB createNotification error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.youtube_notifications) localDb.youtube_notifications = {};
  localDb.youtube_notifications[videoId] = finalData;
  writeDb(localDb);
  return finalData;
};

// 15. Update youtube notification
const updateNotification = async (videoId, updates) => {
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const ref = db.collection('youtube_notifications').doc(videoId);
      await ref.update(updates);
    } catch (err) {
      console.error('Firestore updateNotification error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('youtube_notifications');
      await dbCol.updateOne({ videoId }, { $set: updates });
      return await dbCol.findOne({ videoId });
    } catch (err) {
      console.error('MongoDB updateNotification error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.youtube_notifications) localDb.youtube_notifications = {};
  if (localDb.youtube_notifications[videoId]) {
    localDb.youtube_notifications[videoId] = { ...localDb.youtube_notifications[videoId], ...updates };
    writeDb(localDb);
    return localDb.youtube_notifications[videoId];
  }
  return null;
};

// 16. Fetch guest profile (anonymous personalization — stored by guestId)
const getGuestProfile = async (guestId) => {
  if (!guestId) return null;
  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const doc = await withTimeout(db.collection('guest_profiles').doc(guestId).get(), FIRESTORE_TIMEOUT_MS, 'firestore getGuestProfile');
      return formatDoc(doc);
    } catch (err) {
      console.error('Firestore getGuestProfile error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('guest_profiles');
      return await dbCol.findOne({ guestId });
    } catch (err) {
      console.error('MongoDB getGuestProfile error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.guest_profiles) localDb.guest_profiles = {};
  return localDb.guest_profiles[guestId] || null;
};

// 17. Update guest profile
const updateGuestProfile = async (guestId, updates) => {
  if (!guestId) return null;
  const data = { guestId, ...updates };

  if (isRealFirebase && isFirestoreUsable()) {
    try {
      const ref = db.collection('guest_profiles').doc(guestId);
      await ref.set(data, { merge: true });
    } catch (err) {
      console.error('Firestore updateGuestProfile error:', err.message);
    }
  }

  if (isMongoConnected()) {
    try {
      const dbCol = mongoose.connection.db.collection('guest_profiles');
      await dbCol.updateOne({ guestId }, { $set: data }, { upsert: true });
      return data;
    } catch (err) {
      console.error('MongoDB updateGuestProfile error:', err.message);
    }
  }

  const localDb = readDb();
  if (!localDb.guest_profiles) localDb.guest_profiles = {};
  localDb.guest_profiles[guestId] = { ...(localDb.guest_profiles[guestId] || {}), ...updates };
  writeDb(localDb);
  return localDb.guest_profiles[guestId];
};

// ─── Channel stats helpers (offline trainer) ─────────────────────
// Ye helpers sirf local db.json snapshot par chalti hain (full-scan
// aggregation hai, isliye Firestore ghusana pointless hai). Trainer
// (trainAll.js) inhe use karta hai channel-level features nikalne ke lie.

const dayMs = 24 * 60 * 60 * 1000;

const resolveChannelHandle = (video) => {
  if (video.syncedFrom && video.syncedFrom.startsWith('@')) return video.syncedFrom.slice(1);
  if (video.syncedFrom) return video.syncedFrom;
  if (video.uploader) {
    const u = video.uploader.username || video.uploader.channelName || '';
    if (u.startsWith('@')) return u.slice(1);
    const m = u.match(/channel_(.+)/);
    if (m) return m[1];
  }
  return null;
};

// Aggregate stats for ONE channel: per-video metrics + channel-level signals
const getChannelStats = async (handle) => {
  if (!handle) return null;
  const localDb = readDb();
  const videos = Object.values(localDb.videos || {}).filter(
    (v) => (resolveChannelHandle(v) || '').toLowerCase() === handle.toLowerCase()
  );
  if (videos.length === 0) return null;

  const totalViews = videos.reduce((s, v) => s + (v.views || 0), 0);
  const totalLikes = videos.reduce((s, v) => s + (v.likes || 0), 0);
  const totalComments = videos.reduce((s, v) => s + (v.commentCount || 0), 0);
  const shorts = videos.filter((v) => v.isShort).length;

  const dates = videos
    .map((v) => new Date(v.createdAt).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  const spanDays = dates.length >= 2 ? Math.max(1, (dates[dates.length - 1] - dates[0]) / dayMs) : 1;

  return {
    handle,
    videoCount: videos.length,
    totalViews,
    totalLikes,
    totalComments,
    avgViewsPerVideo: Math.round(totalViews / videos.length),
    avgLikesPerVideo: Math.round(totalLikes / videos.length),
    avgViewsPerDay: Math.round(totalViews / spanDays),
    uploadsPerWeek: +(videos.length / (spanDays / 7)).toFixed(2),
    shortRatio: +(shorts / videos.length).toFixed(2),
    firstVideoAt: dates[0] ? new Date(dates[0]).toISOString() : null,
    lastVideoAt: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null
  };
};

// Stats for every channel present in the snapshot (minVideos filter laga pao)
const getAllChannelStats = async (minVideos = 3) => {
  const localDb = readDb();
  const buckets = {};
  for (const video of Object.values(localDb.videos || {})) {
    const handle = resolveChannelHandle(video);
    if (!handle) continue;
    if (!buckets[handle]) buckets[handle] = [];
    buckets[handle].push(video);
  }
  const out = [];
  for (const [handle, videos] of Object.entries(buckets)) {
    if (videos.length < minVideos) continue;
    const stats = await getChannelStats(handle);
    if (stats) out.push(stats);
  }
  return out.sort((a, b) => b.totalViews - a.totalViews);
};

// Latest N videos for a channel (chronological features ke liye)
const getChannelVideos = async (handle, limit = 100) => {
  if (!handle) return [];
  const localDb = readDb();
  return Object.values(localDb.videos || {})
    .filter((v) => (resolveChannelHandle(v) || '').toLowerCase() === handle.toLowerCase())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
};

module.exports = {
  getVideos,
  getShortsVideos,
  getLongVideos,
  getVideoById,
  createVideo,
  updateVideo,
  deleteVideo,
  getComments,
  addComment,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  createUser,
  updateUser,
  getPendingNotifications,
  createNotification,
  updateNotification,
  getGuestProfile,
  updateGuestProfile,
  getChannelStats,
  getAllChannelStats,
  getChannelVideos,
  resolveChannelHandle
};
