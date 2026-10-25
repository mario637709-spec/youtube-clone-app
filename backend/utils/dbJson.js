const fs = require('fs');
const path = require('path');

// Parallel crawler workers apni alag db file use karte hain —
// env DB_FILE_PATH set karne se poora module us file par shift ho jata hai.
// LAZY: har call pe evaluate hota hai taaki env require ke baad bhi set ho sake.
const getFilePath = () =>
  process.env.DB_FILE_PATH
    ? path.resolve(process.env.DB_FILE_PATH)
    : path.join(__dirname, '../data/db.json');

let dbCache = null;
let dbCacheTime = 0;
// 3s TTL par har request 229MB db.json dobara parse karti thi (event loop
// seconds tak block + feed 19s). Writes writeDb() se hote hain jo cache ko
// khud refresh karta hai, isliye lambi TTL safe hai.
const DB_CACHE_TTL_MS = 3600000; // 1 hour (was 60s which caused 50s event-loop freezing)

// Parallel crawler worker files bhi same folder me padhe jate hain taaki
// poora 469k-video corpus (db.json + db_worker0-4.json) feed/search me aaye.
let workerCache = null;
let workerCacheTime = 0;
const WORKER_CACHE_TTL_MS = 3600000; // 1 hour

const getWorkerFiles = () => {
  const dir = path.join(__dirname, '../data');
  try {
    return fs.readdirSync(dir)
      .filter((f) => /^db_worker\d+\.json$/.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
};

const initDb = () => {
  const FILE_PATH = getFilePath();
  if (!fs.existsSync(path.dirname(FILE_PATH))) {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  }
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({ videos: {}, comments: {} }, null, 2));
  }
};

// Cached reads: a 200MB+ db.json parse per request (feed/search/watch page)
// pegs the event loop for seconds and GC-thrashes the heap. Within the TTL
// window we serve the in-memory snapshot — crawler writes invalidate via writeDb.
const readDb = () => {
  if (dbCache && Date.now() - dbCacheTime < DB_CACHE_TTL_MS) return dbCache;
  const FILE_PATH = getFilePath();
  initDb();
  try {
    const data = fs.readFileSync(FILE_PATH, 'utf8');
    dbCache = JSON.parse(data);
    dbCacheTime = Date.now();
    return dbCache;
  } catch (err) {
    return dbCache || { videos: {}, comments: {} };
  }
};

const writeDb = (data) => {
  const FILE_PATH = getFilePath();
  dbCache = data;
  dbCacheTime = Date.now();
  initDb();
  const tempPath = FILE_PATH + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    // Windows pe do processes (server + crawler) ek saath likhe to rename
    // EPERM de sakta hai — 3 retry, phir haar mano (data memory me safe hai)
    let renamed = false;
    for (let i = 0; i < 3 && !renamed; i++) {
      try {
        fs.renameSync(tempPath, FILE_PATH);
        renamed = true;
      } catch (e) {
        if (i === 2) throw e;
        const wait = (ms) => { const t = Date.now(); while (Date.now() - t < ms); };
        wait(500 * (i + 1));
      }
    }
  } catch (err) {
    console.error('[DB] Error writing to db.json:', err.message);
    try { fs.unlinkSync(tempPath); } catch {}
  }
};

// Merged view across main db.json + all db_worker*.json files.
// Worker duplicates (same id) overwrite nahi karte — main db wins.
// workerCache me parsed worker videos bhi rakho: pehle cache-hit path
// worker videos ko result se DROP kar deta tha (sirf main db milti thi).
const readAllVideos = () => {
  const main = readDb();
  const now = Date.now();
  if (workerCache && now - workerCacheTime < WORKER_CACHE_TTL_MS) {
    return { videos: Object.assign({}, main.videos || {}, workerCache.videos), workerFiles: workerCache.files };
  }
  const files = getWorkerFiles();
  const workerVideos = {};
  const merged = { ...(main.videos || {}) };
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const vids = raw.videos || {};
      for (const [id, v] of Object.entries(vids)) {
        if (!merged[id] && !workerVideos[id]) workerVideos[id] = v;
      }
    } catch (err) {
      console.error(`[DB] Error reading worker file ${file}:`, err.message);
    }
  }
  Object.assign(merged, workerVideos);
  workerCache = { files, videos: workerVideos };
  workerCacheTime = now;
  return { videos: merged, workerFiles: files };
};

let shortsCache = null;
let shortsCacheTime = 0;
const readShortsVideos = () => {
  const now = Date.now();
  if (shortsCache && now - shortsCacheTime < WORKER_CACHE_TTL_MS) {
    return shortsCache;
  }
  const fpath = path.join(__dirname, '../data/db_shorts.json');
  try {
    if (fs.existsSync(fpath)) {
      const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
      shortsCache = data.videos || {};
      shortsCacheTime = now;
      return shortsCache;
    }
  } catch (err) {
    console.error('[DB] Error reading db_shorts.json:', err.message);
  }
  return {};
};

let longCache = null;
let longCacheTime = 0;
const readLongVideos = () => {
  const now = Date.now();
  if (longCache && now - longCacheTime < WORKER_CACHE_TTL_MS) {
    return longCache;
  }
  const fpath = path.join(__dirname, '../data/db_long.json');
  try {
    if (fs.existsSync(fpath)) {
      const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
      longCache = data.videos || {};
      longCacheTime = now;
      return longCache;
    }
  } catch (err) {
    console.error('[DB] Error reading db_long.json:', err.message);
  }
  return {};
};

module.exports = {
  readDb,
  writeDb,
  readAllVideos,
  readShortsVideos,
  readLongVideos
};
