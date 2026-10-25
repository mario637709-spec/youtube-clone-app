// channelCrawl.js — Channel-wise video collection + Firebase partitions + algo training
// Usage:
//   node utils/channelCrawl.js --build-list                  (channel list banao, 20 cats report)
//   node utils/channelCrawl.js --backfill-meta                (registry + channel metas -> db1)
//   node utils/channelCrawl.js --backfill-videos [--max-channels N]  (existing videos -> channel partitions)
//   node utils/channelCrawl.js --crawl [--only HANDLE] [--max-pages N] (live long-form crawl, members-only skip)
//   node utils/channelCrawl.js --full                         (backfill-videos ALL + crawl ALL, background me chalao)
// Structure:
//   db1: /channels/{channelId}, /channels_by_category/{cat}/{channelId}, /channel_registry,
//        /algo/video_stats/{id}, /algo/video_audience/{id}, /meta/channels
//   db2/db3 (shard by channel hash): /channel_videos/{channelId}/{videoId}
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getDb } = require('../tmp/firebase_all');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const DATA = path.join(__dirname, '..', 'data');
const PROGRESS_FILE = path.join(DATA, 'channel_crawl_progress.json');

const CATS_20 = ['Gaming', 'Tech', 'News', 'Music', 'Food', 'Education', 'Comedy', 'Sports',
  'Finance', 'Vlogs & Lifestyle', 'Travel', 'Fitness & Health', 'Movies & TV', 'Devotional',
  'Kids & Family', 'Fashion & Beauty', 'Motivation', 'Science & Space', 'Auto', 'History & Facts'];

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseCount = (t) => { if (!t) return 0; const m = String(t).replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB]?)/i); if (!m) return 0; const n = parseFloat(m[1]) || 0; const s = (m[2] || '').toUpperCase(); return Math.round(n * (s === 'K' ? 1e3 : s === 'M' ? 1e6 : s === 'B' ? 1e9 : 1)); };
const durToSec = (t) => { if (!t) return 0; return String(t).split(':').map((p) => parseInt(p, 10) || 0).reduce((a, p) => a * 60 + p, 0); };
const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const shardOfChannel = (cid) => { let h = 0; for (const c of String(cid)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 2 === 0 ? 'db2' : 'db3'; };
const guessLang = (t) => (/[\u0900-\u097F]/.test(t || '') ? 'hi' : 'en');
const loadProgress = () => { try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return { channels: {}, backfill: {} }; } };
const saveProgress = (p) => fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));

let fbFails = 0;
async function rtdbPatch(dbName, body) {
  const data = JSON.stringify(body);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { token, url } = await getDb(dbName);
      const https = require('https');
      const u = new URL(url + '/.json');
      const r = await new Promise((resolve, reject) => {
        const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
          let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.on('error', reject); req.write(data); req.end();
      });
      fbFails = 0;
      return r;
    } catch (e) {
      fbFails++;
      console.log(`[rtdb] PATCH ${dbName} attempt ${attempt}/4 failed (${e.message}), fails=${fbFails}`);
      if (fbFails >= 12) {
        console.log('[rtdb] network lagatar fail — 5 min ruk ke retry');
        await sleep(5 * 60 * 1000);
        fbFails = 0;
      } else {
        await sleep(2000 * attempt);
      }
    }
  }
  throw new Error(`rtdbPatch ${dbName} failed after 4 attempts`);
}

// ---------- channel list (main 561 + extra 483, dedupe) ----------
function buildList() {
  const a = require('../config/indianChannels').CHANNELS || [];
  const ex = require('../config/extraChannels');
  const extra = [];
  for (const k of Object.keys(ex)) if (Array.isArray(ex[k])) for (const c of ex[k]) extra.push(c);
  const seen = new Set(); const out = [];
  for (const c of [...a, ...extra]) {
    const h = String(c.handle || '').toLowerCase();
    if (!h || seen.has(h)) continue;
    seen.add(h); out.push({ handle: c.handle, name: c.name || c.handle, category: c.category || 'General' });
  }
  // batch2: bare "channel/UC..." entries -> UC id seedha channelId banta hai (resolve nahi chahiye)
  try {
    const b2 = require('../config/channels_batch2').CHANNELS_BATCH2 || [];
    for (const c of b2) {
      const uc = String(c.handle || '').replace(/^channel\//i, '');
      if (!/^UC[\w-]{22}$/.test(uc)) continue;
      const key = 'uc:' + uc;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ handle: uc, name: c.name && c.name !== c.handle ? c.name : uc, category: c.category || 'General', directId: uc });
    }
  } catch {}
  // batch3: 2000-channel discovery (20 categories, query-theme based)
  try {
    const b3 = require('../config/channels_batch3').CHANNELS_BATCH3 || [];
    for (const c of b3) {
      const h = String(c.handle || '').toLowerCase();
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push({ handle: c.handle, name: c.name || c.handle, category: c.category || 'General' });
    }
  } catch {}
  return out;
}

// ---------- youtube fetch (continuation) ----------
const getToken = (items) => { for (const it of items || []) { const t = it?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || it?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token; if (t) return t; } return null; };

function extractItems(items) {
  const TIME_RE = /^(\d+:)?\d{1,3}:\d{2}$/;
  const overlayTexts = (lvm) => {
    try {
      const ov = lvm?.contentImage?.thumbnailViewModel?.overlays || lvm?.contentImage?.overlays || [];
      const arr = Array.isArray(ov) ? ov : [ov];
      const out = [];
      for (const o of arr) {
        for (const b of o?.thumbnailBottomOverlayViewModel?.badges || []) {
          const t = b?.thumbnailBadgeViewModel?.text;
          if (t) out.push(String(t));
        }
      }
      return out;
    } catch { return []; }
  };
  const out = [];
  for (const item of items || []) {
    const inner = item?.richItemRenderer?.content || item?.lockupViewModel || item?.videoRenderer || null;
    if (!inner) continue;
    if (inner.videoRenderer) {
      const vr = inner.videoRenderer;
      const badges = JSON.stringify(vr.badges || []);
      out.push({ id: vr.videoId, title: vr.title?.runs?.map((r) => r.text).join('') || vr.title?.simpleText || 'Unknown', durationSec: durToSec(vr.lengthText?.simpleText), views: parseCount(vr.viewCountText?.simpleText), thumbnail: (vr.thumbnail?.thumbnails || []).slice(-1)[0]?.url || '', membersOnly: /members only/i.test(badges), isShortsBadge: /shorts/i.test(badges), badges: badges.slice(0, 200) });
    } else if (inner.lockupViewModel || inner.title) {
      const lvm = inner.lockupViewModel || inner;
      const meta = lvm?.metadata?.lockupMetadataViewModel;
      const title = meta?.title?.content || 'Unknown';
      const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap((r) => r.metadataParts || []).map((p) => p?.text?.content || '');
      const badges = JSON.stringify(lvm?.badges || meta?.badges || []);
      const oTexts = overlayTexts(lvm);
      const durText = oTexts.find((t) => TIME_RE.test(t)) || '';
      const allBadges = badges + ' ' + oTexts.join(' ');
      out.push({ id: lvm.contentId || '', title, durationSec: durToSec(durText), views: parseCount(parts[0]), thumbnail: (lvm?.contentImage?.thumbnailViewModel?.image?.sources || []).slice(-1)[0]?.url || '', membersOnly: /members only/i.test(allBadges), isShortsBadge: /shorts/i.test(allBadges), badges: allBadges.slice(0, 200) });
    }
  }
  return out.filter((v) => v.id);
}

async function fetchInitial(channelId) {
  const res = await axios.get(`https://www.youtube.com/channel/${channelId}/videos`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, timeout: 25000 });
  const m = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!m) throw new Error('ytInitialData not found');
  const data = JSON.parse(m[1]);
  for (const tab of data?.contents?.twoColumnBrowseResultsRenderer?.tabs || []) {
    const grid = tab?.tabRenderer?.content?.richGridRenderer || tab?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.richGridRenderer;
    if (grid?.contents?.length) return { items: grid.contents, token: getToken(grid.contents) };
  }
  return { items: [], token: null };
}

async function fetchCont(token) {
  const res = await axios.post(`https://www.youtube.com/youtubei/v1/browse?key=${API_KEY}&prettyPrint=false`,
    { context: { client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20240821.01.00' } }, continuation: token },
    { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, timeout: 25000 });
  for (const a of res.data?.onResponseReceivedActions || []) {
    const items = a?.appendContinuationItemsAction?.continuationItems;
    if (items) return { items, token: getToken(items) };
  }
  return { items: [], token: null };
}

const isLongform = (v) => {
  if (v.membersOnly) return false;
  if (v.isShortsBadge) return false;
  const t = `${v.title}`.toLowerCase();
  if (t.includes('#short')) return false;
  // duration unknown (overlay nahi mila) -> shorts prove nahi hota, rakho
  if (!v.durationSec || v.durationSec <= 0) return true;
  return v.durationSec >= 60;
};

// Existing db.json docs ke liye: duration string ("12:41") se bhi seconds nikalo
const durStrToSec = (d) => {
  if (!d) return 0;
  const parts = String(d).trim().split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((a, p) => a * 60 + p, 0);
};
const isLongformExisting = (v) => {
  if (v.isShort === true) return false; // ONLY LONG-FORM: shorts bahar
  const t = `${v.title || ''} ${(v.tags || []).join(' ')} ${v.videoUrl || ''} ${v.youtube_id || ''}`.toLowerCase();
  if (t.includes('#short')) return false;
  if (t.includes('/shorts/') || t.includes('/short/')) return false;
  const secs = v.durationSec || v.lengthSeconds || durStrToSec(v.duration);
  if (secs > 0 && secs < 60) return false; // known-short bahar; unknown-duration wali rakho (prove nahi kar sakte)
  return true;
};

const cleanDoc = (id, v, ch, channelId) => {
  const c = { ...v }; delete c.algoScore; delete c.searchScore; delete c.badges; delete c.membersOnly;
  c.id = id; if (!c.youtube_id) c.youtube_id = id;
  c.durationSec = v.durationSec || 0;
  c.language = guessLang(v.title);
  if (!c.uploader) c.uploader = { id: channelId, username: ch.handle, channelName: ch.name, avatar: '' };
  if (!c.createdAt) c.createdAt = new Date().toISOString();
  return c;
};

const algoInit = (id, v, ch) => ({
  stats: { impressions: 0, clicks: 0, ctr: 0, watchTimeSec: 0, avgPercent: 0, views24h: v.views || 0, views7d: v.views || 0, shares: 0, subsGained: 0, commentCount: 0, language: v.language || 'en' },
  audience: { categories: { [ch.category || 'General']: 1 }, tags: {}, regions: {}, langs: {}, updatedAt: Date.now() },
});

// ---------- channel resolve ----------
async function resolveChannel(handle, directId) {
  if (directId && /^UC[\w-]{22}$/.test(directId)) return directId;
  if (/^channel\//i.test(handle)) return handle.replace(/^channel\//i, '');
  if (/^UC[\w-]{22}$/.test(handle)) return handle;
  const { resolveChannelId } = require('./channelRegistry');
  return resolveChannelId(handle);
}

// ---------- PHASES ----------
async function phaseBackfillMeta(list) {
  const { readDb } = require('./dbJson');
  const local = readDb();
  const registry = local.channel_registry || {};
  await rtdbPatch('db1', { channel_registry: registry });
  console.log(`registry -> db1 (${Object.keys(registry).length} entries)`);
  // FAST: 10 parallel workers se resolve (sequential me 573 channels = 20-40 min tha)
  const metas = {}, byCat = {};
  const p0 = loadProgress();
  const queue = list.filter((ch) => !(p0.metaChannels && p0.metaChannels[ch.handle]));
  console.log(`resolving ${queue.length}/${list.length} channels (10 workers)...`);
  let done = 0, ok = 0, fail = 0;
  const failedHandles = [];
  const worker = async () => {
    while (queue.length) {
      const ch = queue.shift();
      const cid = await resolveChannel(ch.handle, ch.directId).catch(() => null);
      done++;
      if (cid) {
        ok++;
        const shard = shardOfChannel(cid);
        metas[cid] = { channelId: cid, handle: ch.handle, name: ch.name, category: ch.category, shard, videoCount: 0, longformCount: 0, status: 'listed', listedAt: Date.now() };
        if (!byCat[ch.category]) byCat[ch.category] = {};
        byCat[ch.category][cid] = { name: ch.name, handle: ch.handle, videoCount: 0 };
      } else { fail++; failedHandles.push(ch.handle); }
      const p = loadProgress(); if (!p.metaChannels) p.metaChannels = {};
      p.metaChannels[ch.handle] = cid || 'FAILED'; saveProgress(p);
      if (done % 50 === 0) console.log(`  resolve ${done}/${done + queue.length} ok=${ok} fail=${fail}`);
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  console.log(`resolve DONE: ok=${ok} fail=${fail}`);
  if (failedHandles.length) console.log('failed handles:', failedHandles.slice(0, 40).join(', '), failedHandles.length > 40 ? `...(+${failedHandles.length - 40})` : '');
  const keys = Object.keys(metas);
  for (let i = 0; i < keys.length; i += 200) {
    const b = {}; for (const k of keys.slice(i, i + 200)) b[`channels/${k}`] = metas[k];
    const r = await rtdbPatch('db1', b);
    console.log(`  metas chunk ${i / 200 + 1}: HTTP ${r.status}`);
  }
  await rtdbPatch('db1', { channels_by_category: byCat });
  await rtdbPatch('db1', { 'meta/channels': { totalChannels: keys.length, failedChannels: fail, categories: CATS_20, updatedAt: Date.now() } });
  console.log(`channel metas -> db1 (${keys.length} channels, ${Object.keys(byCat).length} categories)`);
  const p = loadProgress(); p.metasDone = true; saveProgress(p);
}

function groupExistingVideos() {
  const groups = {};
  const addFile = (fp) => {
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const [id, v] of Object.entries(raw.videos || {})) {
        const u = v.uploader || {};
        let cid = null, handle = v.syncedFrom ? String(v.syncedFrom).replace(/^@/, '') : null, name = u.channelName || u.username || handle || 'Unknown';
        if (u.id && /^UC[\w-]{22}$/.test(u.id)) cid = u.id;
        else if (handle) cid = 'H:' + handle.toLowerCase();
        else continue;
        if (!groups[cid]) groups[cid] = { channelId: cid, handle, name, category: v.category || 'General', videos: [] };
        groups[cid].videos.push([id, v]);
      }
    } catch (e) { console.log('skip file', fp, e.message); }
  };
  addFile(path.join(DATA, 'db.json'));
  for (const f of fs.readdirSync(DATA).filter((x) => /^db_worker\d+\.json$/.test(x))) addFile(path.join(DATA, f));
  return groups;
}

async function phaseBackfillVideos(maxChannels = Infinity) {
  const p = loadProgress();
  const groups = groupExistingVideos();
  const cids = Object.keys(groups);
  console.log(`grouped existing videos: ${cids.length} channel-groups`);
  let done = 0;
  for (const cid of cids) {
    if (done >= maxChannels) break;
    if (p.backfill[cid]) continue;
    const g = groups[cid];
    // ONLY LONG-FORM: shorts/unknown-shorts yahin filter (crawl me pehle se hai)
    const allVids = g.videos;
    const vids = allVids.filter(([, v]) => isLongformExisting(v));
    if (!vids.length) { p.backfill[cid] = { videos: 0, skippedShorts: allVids.length, at: Date.now() }; saveProgress(p); continue; }
    const realCid = cid.startsWith('H:') ? 'GX' + Math.abs([...cid].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) : cid;
    const shard = shardOfChannel(realCid);
    // FAST: videos(shard) + algo-inits(db1) har chunk me PARALLEL
    for (let i = 0; i < vids.length; i += 300) {
      const slice = vids.slice(i, i + 300);
      const b = {}, ab = {};
      for (const [id, v] of slice) {
        const doc = { ...v }; delete doc.algoScore; delete doc.searchScore;
        doc.id = id; if (!doc.youtube_id) doc.youtube_id = id;
        b[`channel_videos/${realCid}/${id}`] = doc;
        ab[`algo/video_stats/${id}`] = { impressions: 0, clicks: 0, ctr: 0, watchTimeSec: 0, avgPercent: 0, views24h: v.views || 0, views7d: v.views || 0, shares: 0, subsGained: 0, commentCount: 0, language: guessLang(v.title) };
        ab[`algo/video_audience/${id}`] = { categories: { [v.category || 'General']: 1 }, tags: {}, regions: {}, langs: {}, updatedAt: Date.now() };
      }
      const [r1, r2] = await Promise.all([rtdbPatch(shard, b), rtdbPatch('db1', ab)]);
      if (r1.status !== 200) throw new Error(`backfill PATCH failed ${shard}: ${r1.body.slice(0, 150)}`);
      if (r2.status !== 200) throw new Error(`backfill PATCH failed db1: ${r2.body.slice(0, 150)}`);
    }
    // channel meta counts (sirf long-form gine jayenge)
    const skipped = allVids.length - vids.length;
    await rtdbPatch('db1', { [`channels/${realCid}`]: { channelId: realCid, handle: g.handle || '', name: g.name, category: g.category, shard, videoCount: vids.length, longformCount: vids.length, shortsSkipped: skipped, status: 'backfilled', backfilledAt: Date.now() } });
    p.backfill[cid] = { videos: vids.length, skippedShorts: skipped, shard, at: Date.now() };
    saveProgress(p);
    done++;
    if (done % 20 === 0) console.log(`backfill: ${done} channel-groups done`);
  }
  console.log(`backfill-videos DONE: ${done} channel-groups`);
}

async function crawlChannelLive(ch, maxPages = 5000) {
  const channelId = await resolveChannel(ch.handle, ch.directId).catch(() => null);
  if (!channelId) { console.log(`[crawl] @${ch.handle} resolve fail`); return { status: 'failed' }; }
  const shard = shardOfChannel(channelId);
  let items = [], token = null;
  try { ({ items, token } = await fetchInitial(channelId)); }
  catch (e) { console.log(`[crawl] @${ch.handle} initial fail: ${e.message}`); return { status: 'failed' }; }
  const { readDb } = require('./dbJson');
  const existing = new Set(Object.keys((readDb().videos || {})));
  let page = 0, seen = 0, added = 0, skippedShort = 0, skippedMembers = 0;
  const pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    // local db.json
    const local = readDb(); for (const d of batch) local.videos[d.id] = d.doc;
    require('./dbJson').writeDb(local);
    // firebase channel-wise + index + algo
    const b = {}, ab = {}, ix = {};
    for (const d of batch) {
      b[`channel_videos/${channelId}/${d.id}`] = d.doc;
      ix[`video_index/${d.id}`] = { c: channelId, s: shard };
      ab[`algo/video_stats/${d.id}`] = d.stats; ab[`algo/video_audience/${d.id}`] = d.audience;
    }
    await rtdbPatch(shard, b); await rtdbPatch('db1', ix); await rtdbPatch('db1', ab);
    // NOTIFY: naye videos pe subscribers ko fan-out (fire-and-forget)
    try {
      const notify = require('./notify');
      for (const d of batch) notify.onNewVideo(channelId, d.doc).catch(() => {});
    } catch {}
    added += batch.length;
    console.log(`[crawl] @${ch.handle} +${batch.length} (total ${added})`);
  };
  while (items.length && page < maxPages) {
    for (const v of extractItems(items)) {
      seen++;
      if (!v.id || existing.has(v.id)) continue;
      existing.add(v.id);
      if (v.membersOnly) { skippedMembers++; continue; }
      if (!isLongform(v)) { skippedShort++; continue; }
      const doc = cleanDoc(v.id, { id: v.id, youtube_id: v.id, title: v.title, description: `Long-form video from ${ch.name}.`, category: ch.category, tags: [ch.category.toLowerCase(), 'youtube', ch.handle], visibility: 'public', uploader: { id: channelId, username: ch.handle, channelName: ch.name, avatar: '' }, views: v.views || 0, likes: 0, dislikes: 0, duration: fmtDur(v.durationSec), durationSec: v.durationSec, isShort: false, thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`, videoUrl: `https://www.youtube.com/watch?v=${v.id}`, storageLocation: 'YouTube', status: 'Live', createdAt: new Date().toISOString(), syncedFrom: '@' + ch.handle }, ch, channelId);
      pending.push({ id: v.id, doc, ...algoInit(v.id, doc, ch) });
      if (pending.length >= 100) await flush();
    }
    if (!token) break;
    try { ({ items, token } = await fetchCont(token)); }
    catch (e) { console.log(`[crawl] @${ch.handle} cont stop: ${e.message}`); break; }
    page++;
    await sleep(400);
  }
  await flush();
  await rtdbPatch('db1', { [`channels/${channelId}`]: { channelId, handle: ch.handle, name: ch.name, category: ch.category, shard, videoCount: added, longformCount: added, status: 'crawled', lastCrawledAt: Date.now() }, [`channels_by_category/${ch.category}/${channelId}`]: { name: ch.name, handle: ch.handle, videoCount: added } });
  const p = loadProgress(); p.channels[ch.handle] = { status: 'done', channelId, shard, pages: page, added, seen, skippedShort, skippedMembers, at: Date.now() }; saveProgress(p);
  console.log(`[crawl] @${ch.handle} DONE pages=${page} seen=${seen} added=${added} shorts-skip=${skippedShort} members-skip=${skippedMembers}`);
  return { status: 'done', added };
}

// ---------- CLI ----------
(async () => {
  const args = process.argv.slice(2);
  const list = buildList();
  if (args.includes('--build-list')) {
    const cats = {};
    for (const c of list) cats[c.category] = (cats[c.category] || 0) + 1;
    console.log(`UNIQUE CHANNELS: ${list.length}`);
    console.log('per-category:', JSON.stringify(cats));
    console.log('taxonomy-20:', CATS_20.join(' | '));
    const missing = CATS_20.filter((c) => !cats[c]);
    console.log('categories needing discovery:', missing.length ? missing.join(', ') : 'none');
    return;
  }
  if (args.includes('--backfill-meta')) { await phaseBackfillMeta(list); return; }
  if (args.includes('--backfill-videos')) {
    const i = args.indexOf('--max-channels');
    await phaseBackfillVideos(i >= 0 ? parseInt(args[i + 1], 10) : Infinity);
    return;
  }
  if (args.includes('--crawl')) {
    const oi = args.indexOf('--only'), pi = args.indexOf('--max-pages');
    const maxPages = pi >= 0 ? parseInt(args[pi + 1], 10) : 5000;
    const targets = oi >= 0 ? list.filter((c) => c.handle === args[oi + 1]) : list;
    const p = loadProgress();
    for (const ch of targets) {
      if (p.channels[ch.handle]?.status === 'done') continue;
      await crawlChannelLive(ch, maxPages);
    }
    return;
  }
  if (args.includes('--full')) {
    await phaseBackfillVideos(Infinity);
    const p = loadProgress();
    for (const ch of list) {
      if (p.channels[ch.handle]?.status === 'done') continue;
      await crawlChannelLive(ch, 5000);
    }
    console.log('FULL DONE');
    return;
  }
  if (args.includes('--recount-counts')) {
    // Har channel ka actual shallow count lekar videoCount/longformCount sahi karo
    const https = require('https');
    const p = loadProgress();
    const done = [];
    for (const [handle, info] of Object.entries(p.channels || {})) {
      if (!info || !info.channelId || info.status !== 'done') continue;
      done.push(info);
    }
    // backfill wale groups bhi (progress.backfill me channelId nahi, realCid banta hai)
    for (const [cid, info] of Object.entries(p.backfill || {})) {
      if (!info || !(info.videos > 0) || info.recounted) continue;
      const realCid = cid.startsWith('H:') ? 'GX' + Math.abs([...cid].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) : cid;
      done.push({ channelId: realCid, shard: info.shard });
      info._isBackfill = true;
    }
    console.log(`recount: ${done.length} channels`);
    let fixed = 0;
    for (const info of done) {
      const { token, url } = await getDb(info.shard);
      const n = await new Promise((resolve, reject) => {
        const u = new URL(url + `/channel_videos/${info.channelId}.json?shallow=true`);
        https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: 'Bearer ' + token } }, (res) => {
          let b = ''; res.on('data', (c) => (b += c));
          res.on('end', () => { try { resolve(Object.keys(JSON.parse(b) || {}).length); } catch (e) { reject(e); } });
        }).on('error', reject);
      });
      await rtdbPatch('db1', { [`channels/${info.channelId}/videoCount`]: n, [`channels/${info.channelId}/longformCount`]: n });
      fixed++;
      if (fixed % 50 === 0) console.log(`  ${fixed}/${done.length} fixed`);
    }
    const p2 = loadProgress();
    for (const info of done) {
      for (const [cid, b] of Object.entries(p2.backfill || {})) {
        const realCid = cid.startsWith('H:') ? 'GX' + Math.abs([...cid].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) : cid;
        if (realCid === info.channelId) b.recounted = true;
      }
    }
    saveProgress(p2);
    console.log(`RECOUNT DONE: ${fixed} channels fixed`);
    return;
  }
  if (args.includes('--build-index')) {    // /video_index/{videoId} = {c: channelId, s: shard} — getVideo() lookup ke liye
    const https = require('https');
    const p = loadProgress();
    let total = 0;
    for (const [cid, info] of Object.entries(p.backfill || {})) {
      if (!info || !(info.videos > 0) || info.indexed) continue;
      const realCid = cid.startsWith('H:') ? 'GX' + Math.abs([...cid].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) : cid;
      const shard = info.shard;
      const { token, url } = await getDb(shard);
      const keys = await new Promise((resolve, reject) => {
        const u = new URL(url + `/channel_videos/${realCid}.json?shallow=true`);
        https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: 'Bearer ' + token } }, (res) => {
          let b = ''; res.on('data', (c) => (b += c));
          res.on('end', () => { try { resolve(Object.keys(JSON.parse(b) || {})); } catch (e) { reject(e); } });
        }).on('error', reject);
      });
      for (let i = 0; i < keys.length; i += 500) {
        const b = {};
        for (const k of keys.slice(i, i + 500)) b[`video_index/${k}`] = { c: realCid, s: shard };
        await rtdbPatch('db1', b);
      }
      p.backfill[cid].indexed = true; saveProgress(p);
      total += keys.length;
      console.log(`index: ${realCid} -> ${keys.length} ids (total ${total})`);
    }
    console.log(`BUILD-INDEX DONE: ${total} video ids`);
    return;
  }
  console.log('usage: --build-list | --backfill-meta | --backfill-videos [--max-channels N] | --crawl [--only HANDLE] [--max-pages N] | --full');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
