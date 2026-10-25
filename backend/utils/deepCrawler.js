/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  deepCrawler.js â€” FULL channel history crawler
 *  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *  syncYouTubeChannel sirf /videos page ka ~30 videos leta hai. Ye
 *  crawler youtubei browse API ke continuation tokens se channel ki
 *  SABHI videos paginate karta hai (100sâ€“1000s per channel).
 *
 *  - Resumable: data/crawlProgress.json me har channel ka status
 *  - Batch writes: db.json ek saath flush (per-video rewrite nahi)
 *  - 429/backoff + retry, 300ms polite pacing
 *  - Naya video â†’ catalog category/metadata ke saath store
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const getPublicBaseUrl = require('./publicBaseUrl');
const dbFirestore = require('./dbFirestore');
const { readDb, writeDb } = require('./dbJson');
const { CHANNELS } = require('../config/indianChannels');
const { resolveChannelId } = require('./channelRegistry');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'crawlProgress.json');
const LOG_FILE = path.join(__dirname, '..', 'data', 'crawlLog.jsonl');
// Standard WEB client key (same one YouTube's own site uses)
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "1,234,567" â†’ 1234567 | "12K" â†’ 12000 | "3.4M" â†’ 3400000 */
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

/** "12:34" â†’ 754s | "1:02:03" â†’ 3723s */
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

// db.json server/log presses dono processes se likha jata hai â€” Windows
// par rename EPERM deta hai jab doosra process file open kare. Retry
// race se bachta hai (videos khona break na kare).
const writeDbWithRetry = async (db, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    try {
      writeDb(db);
      return true;
    } catch (err) {
      const isRace = /EPERM|EBUSY|EACCES/.test(err.message);
      if (!isRace) throw err;
      if (i === tries - 1) {
        log('[deep] âš ï¸ db.json write still blocked after ' + tries + ' tries â€” data pending me hai');
        return false;
      }
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

// â”€â”€â”€ Extracting items (videoRenderer + lockupViewModel, both layouts) â”€â”€
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
      log(`[deep] initial page network error (${err.message}) â€” retry ${attempt}/4`);
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
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: 'WEB',
          clientVersion: '2.20240821.01.00',
        },
      },
      continuation: token,
    },
    {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
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

// â”€â”€â”€ Crawl one channel completely â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const crawlChannel = async (ch, { maxPages = 5000, pageDelayMs = 350 } = {}) => {
  let channelId = null;
  try {
    channelId = await resolveChannelId(ch.handle);
  } catch (err) {
    log(`[deep] âŒ @${ch.handle} â€” resolve threw: ${err.message}`);
  }
  if (!channelId) {
    log(`[deep] âŒ @${ch.handle} â€” channel ID resolve failed`);
    return { handle: ch.handle, status: 'failed', added: 0 };
  }

  const existingIds = new Set();
  try {
    const all = await dbFirestore.getVideos();
    if (Array.isArray(all)) for (const v of all) existingIds.add(v.id);
  } catch {}

  let items = [];
  let token = null;
  try {
    ({ items, token } = await fetchInitialPage(channelId));
  } catch (err) {
    log(`[deep] âŒ @${ch.handle} â€” initial page failed: ${err.message}`);
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
      log(`[deep] @${ch.handle} â€” +${batch.length} (total this channel: ${added})`);
    } else {
      // write failed: wapas pending me daalo taaki agli flush me try ho
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
      const fetchNext = async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            return await fetchContinuation(token);
          } catch (err) {
            const retryable = /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNABORTED|socket/.test(err.message || '');
            if (err.response && [400, 403].includes(err.response.status)) throw err;
            if (attempt === 3 && !retryable) throw err;
            if (attempt < 3) {
              log(`[deep] @${ch.handle} â€” cont. retry ${attempt}/3 (${err.message})`);
              await sleep(1500 * attempt);
            } else {
              throw err;
            }
          }
        }
      };
      try {
        const next = await fetchNext();
        items = next.items;
        token = next.token;
      } catch (err) {
        if (err.response && err.response.status === 429) {
          log(`[deep] @${ch.handle} â€” 429, backing off 5s`);
          await sleep(5000);
          try {
            const next = await fetchNext();
            items = next.items;
            token = next.token;
          } catch (err2) {
            log(`[deep] @${ch.handle} â€” cont. error after 429 retry (${err2.message}), stopping`);
            break;
          }
        } else if (err.response && err.response.status === 403) {
          log(`[deep] @${ch.handle} â€” 403 (blocked), stopping`);
          break;
        } else {
          log(`[deep] @${ch.handle} â€” continuation error (${err.message}), stopping`);
          break;
        }
      }
      page++;
      if (page % 20 === 0) log(`[deep] @${ch.handle} â€” page ${page}, seen ${seen}, added ${added}`);
      await sleep(pageDelayMs);
    }

    await flushBatch();
    log(`[deep] @${ch.handle} â€” DONE: ${page} pages, ${seen} seen, +${added} added`);
    return { handle: ch.handle, status: 'done', pages: page, seen, added };
  } catch (err) {
    await flushBatch().catch(() => {});
    log(`[deep] @${ch.handle} â€” FAILED at page ${page}: ${err.message}`);
    return { handle: ch.handle, status: 'failed', pages: page, seen, added, error: err.message };
  }
};

// â”€â”€â”€ Main loop (resumable, all channels) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const runDeepCrawl = async ({ channels = CHANNELS, maxPages = 5000, pageDelayMs = 350, only = null } = {}) => {
  log(`â•â•â• DEEP CRAWL START â€” ${channels.length} channels â•â•â•`);
  const progress = loadProgress();
  const list = only ? channels.filter((c) => c.handle === only) : channels;

  let done = 0, failed = 0, totalAdded = 0;
  for (const ch of list) {
    const prev = progress[ch.handle];
    if (prev && prev.status === 'done') { done++; continue; }
    let r;
    try {
      r = await crawlChannel(ch, { maxPages, pageDelayMs });
    } catch (err) {
      // kabhi bhi crash na ho â€” ek channel ke failure se crawl aage badhe
      r = { handle: ch.handle, status: 'failed', added: 0, error: err.message };
      log(`[deep] âŒ @${ch.handle} â€” UNCAUGHT: ${err.message}`);
    }
    progress[ch.handle] = { status: r.status, pages: r.pages || 0, added: r.added || 0, at: Date.now() };
    saveProgress(progress);
    if (r.status === 'done') done++;
    else failed++;
    totalAdded += r.added || 0;
    log(`[deep] PROGRESS â€” ${done + failed}/${list.length}, +${totalAdded} videos`);
  }
  log(`â•â•â• DEEP CRAWL COMPLETE â€” done:${done} failed:${failed} added:${totalAdded} â•â•â•`);
  return { done, failed, totalAdded };
};

if (require.main === module) {
  // Network blips / random crashes se process kabhi nahi mare
  process.on('unhandledRejection', (e) => {
    console.error('[deep] unhandledRejection:', e && e.message);
  });
  process.on('uncaughtException', (e) => {
    console.error('[deep] uncaughtException:', e && e.message);
  });
  const only = process.argv[2] || null;
  runDeepCrawl({ only })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { crawlChannel, runDeepCrawl, extractVideos, getContinuationToken };
