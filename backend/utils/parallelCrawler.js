/**
 * parallelCrawler.js â€” WORKER for parallel channel crawling
 *
 * Har worker apni alag db / progress / log file use karta hai taaki
 * 5 workers ek saath bina conflict ke chalein:
 *   data/db_worker{N}.json          â€” videos isi file mein
 *   data/progress_worker{N}.json    â€” channel status
 *   data/log_worker{N}.txt          â€” worker log
 *
 * Usage: node parallelCrawler.js <workerId 0-4>
 * Chunks: config/channels_batch2.js se workerId ke hisaab se slice.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const getPublicBaseUrl = require('./publicBaseUrl');
const { resolveChannelId } = require('./channelRegistry');
const { CHANNELS_BATCH2 } = require('../config/channels_batch2');

const WORKER_ID = parseInt(process.argv[2] || '0', 10);
const NUM_WORKERS = 5;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, `db_worker${WORKER_ID}.json`);
const PROGRESS_FILE = path.join(DATA_DIR, `progress_worker${WORKER_ID}.json`);
const LOG_FILE = path.join(DATA_DIR, `log_worker${WORKER_ID}.txt`);

// IMPORTANT: channelRegistry/dbJson ko bhi worker ki apni db file par
// bhejo â€” warna 5 workers 191MB ke main db.json ko parallel parse karenge
// aur memory OOM crash (0xC0000409) ho jata hai.
process.env.DB_FILE_PATH = DB_FILE;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseCount = (text) => {
  if (!text) return 0;
  const cleaned = String(text).replace(/,/g, '').trim();
  const m = cleaned.match(/^([\d.]+)\s*([KMB]?)/i);
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') return Math.round(num * 1e3);
  if (suffix === 'M') return Math.round(num * 1e6);
  if (suffix === 'B') return Math.round(num * 1e9);
  return Math.round(num);
};

const durationToSeconds = (text) => {
  if (!text) return 0;
  const parts = String(text).split(':').map((p) => parseInt(p, 10) || 0);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

const formatDuration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
};

// â”€â”€â”€ per-worker db.json (apni file â€” koi conflict nahi) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const readDb = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.videos) return parsed;
    throw new Error('db structure invalid');
  } catch (err) {
    console.error(`[worker${WORKER_ID}] readDb FAILED: ${err.message}`);
    return { videos: {} };
  }
};

const writeDb = (db) => {
  const tempPath = DB_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2));
  fs.renameSync(tempPath, DB_FILE);
};

const writeDbWithRetry = async (db, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    try {
      writeDb(db);
      return true;
    } catch (err) {
      const isRace = /EPERM|EBUSY|EACCES/.test(err.message);
      if (!isRace) throw err;
      if (i === tries - 1) return false;
      await sleep(300 + i * 250);
    }
  }
  return false;
};

const loadProgress = () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
};
const saveProgress = (p) => {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); } catch {}
};

// â”€â”€â”€ video extraction (videoRenderer + lockupViewModel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const extractVideos = (items) => {
  const out = [];
  for (const item of items || []) {
    const inner = item?.richItemRenderer?.content
      || item?.lockupViewModel
      || item?.videoRenderer
      || null;
    if (!inner) continue;
    if (inner.videoRenderer) {
      const vr = inner.videoRenderer;
      out.push({
        id: vr.videoId,
        title: vr.title?.runs?.map((r) => r.text).join('') || vr.title?.simpleText || 'Unknown Title',
        durationSec: durationToSeconds(vr.lengthText?.simpleText),
        views: parseCount(vr.viewCountText?.simpleText),
        thumbnail: (vr.thumbnail?.thumbnails || []).slice(-1)[0]?.url || '',
      });
    } else if (inner.lockupViewModel) {
      const lvm = inner.lockupViewModel;
      const meta = lvm?.metadata?.lockupMetadataViewModel;
      const title = meta?.title?.content || 'Unknown Title';
      const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows || [])
        .flatMap((row) => row.metadataParts || [])
        .map((p) => p?.text?.content || '');
      out.push({
        id: lvm.contentId || '',
        title,
        durationSec: durationToSeconds(parts[1]),
        views: parseCount(parts[0]),
        thumbnail: (lvm?.contentImage?.thumbnailViewModel?.image?.sources || []).slice(-1)[0]?.url || '',
      });
    }
  }
  return out.filter((v) => v.id);
};

const getContinuationToken = (items) => {
  for (const item of items || []) {
    const token =
      item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
      item?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token;
    if (token) return token;
  }
  return null;
};

const fetchInitialPage = async (channelId) => {
  let res;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      res = await axios.get(`https://www.youtube.com/channel/${channelId}/videos`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 25000,
      });
      break;
    } catch (err) {
      const retryable = /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNABORTED|socket/.test(err.message || '');
      if (attempt === 4 || !retryable) throw err;
      log(`initial page retry ${attempt}/4 (${err.message})`);
      await sleep(1500 * attempt);
    }
  }
  const match = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!match) throw new Error('ytInitialData not found');
  const data = JSON.parse(match[1]);
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  for (const tab of tabs) {
    const content = tab?.tabRenderer?.content;
    const grid = content?.richGridRenderer
      || content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.richGridRenderer;
    if (!grid) continue;
    return { items: grid.contents || [], token: getContinuationToken(grid.contents) };
  }
  return { items: [], token: null };
};

const fetchContinuation = async (token) => {
  const res = await axios.post(
    `https://www.youtube.com/youtubei/v1/browse?key=${API_KEY}&prettyPrint=false`,
    {
      context: { client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20240821.01.00' } },
      continuation: token,
    },
    {
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 25000,
    }
  );
  const actions = res.data?.onResponseReceivedActions || [];
  for (const action of actions) {
    const items = action?.appendContinuationItemsAction?.continuationItems;
    if (items) return { items, token: getContinuationToken(items) };
  }
  return { items: [], token: null };
};

// â”€â”€â”€ crawl ONE channel, write to worker's own db â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const crawlChannel = async (ch, { maxPages = 5000, pageDelayMs = 250 } = {}) => {
  let channelId = null;
  try {
    channelId = await resolveChannelId(ch.handle);
  } catch (err) {
    log(`âŒ @${ch.handle} â€” resolve threw: ${err.message}`);
  }
  if (!channelId) {
    log(`âŒ @${ch.handle} â€” channel ID resolve failed`);
    return { handle: ch.handle, status: 'failed', added: 0 };
  }

  const existingIds = new Set(Object.keys(readDb().videos || {}));

  let items = [];
  let token = null;
  try {
    ({ items, token } = await fetchInitialPage(channelId));
  } catch (err) {
    log(`âŒ @${ch.handle} â€” initial page failed: ${err.message}`);
    return { handle: ch.handle, status: 'failed', added: 0 };
  }
  let page = 1;
  let added = 0;
  let seen = 0;
  const pending = [];

  const flushBatch = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    const localDb = readDb();
    for (const v of batch) localDb.videos[v.id] = v;
    const ok = await writeDbWithRetry(localDb);
    if (ok) {
      added += batch.length;
      if (added % 250 === 0 || batch.length < 250) log(`@${ch.handle} â€” +${batch.length} (channel total: ${added})`);
    } else {
      pending.unshift(...batch);
    }
  };

  try {
    while (items.length > 0 && page <= maxPages) {
      const videos = extractVideos(items);
      for (const v of videos) {
        seen++;
        if (existingIds.has(v.id)) continue;
        existingIds.add(v.id);
        const isShort = v.durationSec > 0 && v.durationSec < 60;
        pending.push({
          id: v.id,
          youtube_id: v.id,
          title: v.title,
          description: `All videos from ${ch.name} (${ch.category}).`,
          category: ch.category,
          tags: [ch.category.toLowerCase(), 'youtube', ch.handle],
          visibility: 'public',
          uploader: {
            id: channelId,
            username: ch.handle,
            channelName: ch.name,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(ch.name)}&background=ff0000&color=fff`,
          },
          views: v.views || 0,
          likes: 0,
          dislikes: 0,
          duration: formatDuration(v.durationSec || 300),
          isShort,
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`,
          videoUrl: `${getPublicBaseUrl()}/api/videos/stream/${v.id}`,
          storageLocation: 'YouTube',
          status: 'Live',
          createdAt: new Date().toISOString(),
          syncedFrom: '@' + ch.handle,
          deepCrawledAt: Date.now(),
        });

        if (pending.length >= 250) await flushBatch();
      }

      if (!token) break;
      try {
        const next = await fetchContinuation(token);
        items = next.items;
        token = next.token;
      } catch (err) {
        if (err.response && err.response.status === 429) {
          log(`@${ch.handle} â€” 429, backing off 8s`);
          await sleep(8000);
          try {
            const next = await fetchContinuation(token);
            items = next.items;
            token = next.token;
          } catch (err2) {
            log(`@${ch.handle} â€” cont. error after 429 (${err2.message}), stopping`);
            break;
          }
        } else if (err.response && err.response.status === 403) {
          log(`@${ch.handle} â€” 403 (blocked), stopping`);
          break;
        } else {
          const retryable = /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNABORTED|socket/.test(err.message || '');
          if (retryable) {
            log(`@${ch.handle} â€” network err, retrying once (${err.message})`);
            try {
              const next = await fetchContinuation(token);
              items = next.items;
              token = next.token;
            } catch (err2) {
              log(`@${ch.handle} â€” cont. error (${err2.message}), stopping`);
              break;
            }
          } else {
            log(`@${ch.handle} â€” continuation error (${err.message}), stopping`);
            break;
          }
        }
      }
      page++;
      if (page % 25 === 0) log(`@${ch.handle} â€” page ${page}, seen ${seen}, added ${added}`);
      await sleep(pageDelayMs);
    }

    await flushBatch();
    log(`@${ch.handle} â€” DONE: ${page} pages, ${seen} seen, +${added} added`);
    return { handle: ch.handle, status: 'done', pages: page, seen, added };
  } catch (err) {
    await flushBatch().catch(() => {});
    log(`@${ch.handle} â€” FAILED at page ${page}: ${err.message}`);
    return { handle: ch.handle, status: 'failed', pages: page, seen, added, error: err.message };
  }
};

// â”€â”€â”€ worker main loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const runWorker = async () => {
  const all = CHANNELS_BATCH2;
  const chunk = all.filter((_, i) => i % NUM_WORKERS === WORKER_ID);
  log(`â•â•â• WORKER ${WORKER_ID} START â€” ${chunk.length} channels (${all.length} total) â•â•â•`);
  const progress = loadProgress();

  let done = 0, failed = 0, totalAdded = 0;
  for (const ch of chunk) {
    const prev = progress[ch.handle];
    if (prev && prev.status === 'done') { done++; continue; }
    let r;
    try {
      r = await crawlChannel(ch);
    } catch (err) {
      r = { handle: ch.handle, status: 'failed', added: 0, error: err.message };
      log(`âŒ @${ch.handle} â€” UNCAUGHT: ${err.message}`);
    }
    progress[ch.handle] = { status: r.status, pages: r.pages || 0, added: r.added || 0, at: Date.now() };
    saveProgress(progress);
    if (r.status === 'done') done++;
    else failed++;
    totalAdded += r.added || 0;
    log(`PROGRESS â€” ${done + failed}/${chunk.length}, +${totalAdded} videos`);
  }
  log(`â•â•â• WORKER ${WORKER_ID} COMPLETE â€” done:${done} failed:${failed} added:${totalAdded} â•â•â•`);
  return { done, failed, totalAdded };
};

process.on('unhandledRejection', (e) => {
  console.error(`[worker${WORKER_ID}] unhandledRejection:`, e && e.message);
});
process.on('uncaughtException', (e) => {
  console.error(`[worker${WORKER_ID}] uncaughtException:`, e && e.message);
});

runWorker()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
