/**
 * Members-only / locked videos DB se remove karta hai.
 * ANDROID_VR player API se playabilityStatus check — agar reason me
 * "members" / "Join this channel" hai to video playable nahi hai.
 *
 * Run: node scripts/removeMembersOnly.js
 * NOTE: Server ko restart nahi karta — direct DB file update (atomic write).
 * dbJson.js 3s cache ke saath file re-read karta hai, to running server
 * agle request pe updated data dekhega.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_DIR = path.join(__dirname, '../data');

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.52.26',
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.52.26 (Linux; U; Android 12; eureka_user 1.52.26.0) gzip',
  osName: 'Android',
  osVersion: '12',
};

const ENDPOINTS = [
  'https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player',
  'https://www.youtube.com/youtubei/v1/player',
];

const MAX_CONCURRENCY = 15;
const REQUEST_TIMEOUT = 6000;

async function checkVideo(videoId) {
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await axios.post(endpoint, {
        context: { client: ANDROID_VR_CLIENT },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ANDROID_VR_CLIENT.userAgent,
          'X-Youtube-Client-Name': '28',
          'X-Youtube-Client-Version': ANDROID_VR_CLIENT.clientVersion,
        },
        timeout: REQUEST_TIMEOUT,
      });
      const playability = response.data?.playabilityStatus;
      const status = playability?.status || 'UNKNOWN';
      const reason = playability?.reason ||
        playability?.errorScreen?.playerErrorMessageRenderer?.reason?.runs?.map(r => r.text).join(' ') || '';
      return { status, reason };
    } catch {
      // try next endpoint
    }
  }
  return { status: 'NETWORK_ERROR', reason: '' };
}

function isMembersOnly(v) {
  const reason = (v.reason || '').toLowerCase();
  return reason.includes('members') || reason.includes("join this channel");
}

// ─── Load all videos ─────────────────────────────────────────────
function loadAllVideos() {
  const files = ['db.json', ...fs.readdirSync(DATA_DIR).filter(f => /^db_worker\d+\.json$/.test(f))];
  const locations = new Map(); // videoId -> { file, db }
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const vids = raw.videos || {};
      for (const [id, v] of Object.entries(vids)) {
        if (!locations.has(id)) locations.set(id, { file: filePath, db: raw });
      }
    } catch (err) {
      console.error(`[load] Error reading ${file}:`, err.message);
    }
  }
  return locations;
}

function saveFile(filePath, db) {
  const tmp = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    console.error(`[save] Error writing ${filePath}:`, err.message);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────
(async () => {
  console.log('Loading DBs...');
  const locations = loadAllVideos();
  console.log(`Total videos in DBs: ${locations.size}`);

  // Get the actual video objects
  const videoEntries = [];
  for (const [id, loc] of locations.entries()) {
    const v = loc.db.videos[id];
    if (v && !v.isShort) {
      videoEntries.push({ id, v, loc });
    }
  }
  console.log(`Non-short (feed-eligible) videos to check: ${videoEntries.length}`);

  // If a video was already checked before (stored reason), skip re-check
  const toCheck = videoEntries.filter(({ v }) => !v.playabilityChecked);
  console.log(`Already checked: ${videoEntries.length - toCheck.length}, to check now: ${toCheck.length}`);

  const removed = [];
  const keep = [];
  let index = 0;
  let networkErrors = 0;

  async function worker() {
    while (index < toCheck.length) {
      const i = index++;
      const { id, v, loc } = toCheck[i];
      const result = await checkVideo(id);
      if (result.status === 'NETWORK_ERROR') {
        networkErrors++;
        v.playabilityChecked = true; // don't retry this round
        continue;
      }
      v.playabilityChecked = true;
      v.playabilityStatus = result.status;
      v.reason = result.reason;

      if (result.status === 'OK' || (result.status === 'LOGIN_REQUIRED' && !isMembersOnly(v))) {
        keep.push(id);
      } else if (result.status !== 'OK') {
        removed.push({ id, title: (v.title || '').substring(0, 50), status: result.status, reason: (result.reason || '').substring(0, 80) });
      }
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${toCheck.length} | removed so far: ${removed.length} | network errors: ${networkErrors}`);
      }
    }
  }

  const workers = Array.from({ length: MAX_CONCURRENCY }, worker);
  await Promise.all(workers);

  console.log(`\nScan complete. Removed candidates: ${removed.length}, kept: ${keep.length}, network errors: ${networkErrors}`);

  // ─── Remove members-only from DBs ───────────────────────────────
  const removeIds = new Set(removed.map(r => r.id));
  const dirtyFiles = new Map(); // filePath -> db
  for (const [id, loc] of locations.entries()) {
    if (removeIds.has(id) && loc.db.videos[id]) {
      delete loc.db.videos[id];
      dirtyFiles.set(loc.file, loc.db);
    }
  }
  for (const [filePath, db] of dirtyFiles.entries()) {
    const ok = saveFile(filePath, db);
    console.log(`[save] ${path.basename(filePath)}: ${ok ? 'saved' : 'FAILED'} (removed ${removeIds.size} from this file)`);
  }

  console.log(`\nDONE. Total members-only/locked videos removed: ${removed.size}`);

  // ─── Report ────────────────────────────────────────────────────
  const report = {
    scanned: toCheck.length,
    removed: removed.length,
    networkErrors,
    sample: removed.slice(0, 20).map(r => `${r.id} | ${r.title} | ${r.status} | ${r.reason}`),
  };
  fs.writeFileSync(path.join(DATA_DIR, 'membersOnlyReport.json'), JSON.stringify(report, null, 2));
  console.log('Report: data/membersOnlyReport.json');
  removed.slice(0, 20).forEach(r => console.log(`  REMOVED: ${r.id} | ${r.title} | ${r.reason}`));
})();
