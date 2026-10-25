// discoverChannels2.js — 2000 Indian channels, 20 categories (query-theme based)
// run: node utils/discoverChannels2.js   (background me chalao, lamba hai)
// Output: config/channels_batch3.js (existing batch2/main/extra skip hote hain)
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const TARGET = 2000;
const PER_CAT_CAP = 130; // 20 cats x ~100 = 2000 (cap 130 taaki balance rahe)
const OUT_FILE = path.join(__dirname, '..', 'config', 'channels_batch3.js');

const CATEGORY_QUERIES = {
  'Gaming': ['desi gaming', 'indian gamer live', 'bgmi hindi gameplay', 'minecraft hindi'],
  'Tech': ['indian tech review', 'tech unboxing hindi', 'mobile review hindi', 'gadgets india'],
  'News': ['hindi news', 'indian news today', 'aaj tak', 'indian politics'],
  'Music': ['bollywood songs', 'punjabi songs', 'hindi songs 2024', 'indian classical music'],
  'Food': ['indian cooking', 'street food india', 'hindi recipe', 'indian food vlog'],
  'Education': ['upsc preparation', 'jee neet preparation', 'hindi study', 'indian teacher'],
  'Comedy': ['indian comedy', 'indian standup', 'hindi comedy video', 'comedy shorts hindi'],
  'Sports': ['indian cricket', 'ipl news', 'cricket highlights hindi', 'indian football'],
  'Finance': ['indian stock market', 'personal finance hindi', 'startup india', 'crypto india hindi'],
  'Vlogs & Lifestyle': ['hindi vlogger', 'indian daily vlog', 'indian family vlog', 'desi lifestyle'],
  'Travel': ['indian travel vlog', 'india travel guide hindi', 'budget travel india', 'kerala trip hindi'],
  'Fitness & Health': ['fitness hindi', 'yoga india', 'gym workout hindi', 'weight loss hindi'],
  'Movies & TV': ['bollywood movies', 'indian web series', 'movie review hindi', 'bollywood gossip'],
  'Devotional': ['bhajan', 'kirtan', 'aarti sangrah', 'hanuman chalisa'],
  'Kids & Family': ['chhota bheem', 'moral stories hindi', 'hindi rhymes', 'kids cartoon hindi'],
  'Fashion & Beauty': ['indian fashion', 'makeup tutorial hindi', 'saree draping', 'skincare hindi'],
  'Motivation': ['motivation hindi', 'hindi motivational speech', 'success story india', 'sandeep maheshwari'],
  'Science & Space': ['indian science', 'space hindi', 'isro news', 'science facts hindi'],
  'Auto': ['car review hindi', 'bike review india', 'tata mahindra suv', 'electric scooter india'],
  'History & Facts': ['indian history hindi', 'ancient india', 'amazing facts hindi', 'mystery hindi'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseCount = (t) => { if (!t) return 0; const m = String(t).replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB]?)/i); if (!m) return 0; const n = parseFloat(m[1]) || 0; const s = (m[2] || '').toUpperCase(); return Math.round(n * (s === 'K' ? 1e3 : s === 'M' ? 1e6 : s === 'B' ? 1e9 : 1)); };
const getToken = (items) => { for (const it of items || []) { const t = it?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || it?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token; if (t) return t; } return null; };

const extractChannels = (items) => {
  const out = [];
  for (const item of items || []) {
    const cr = item?.channelRenderer;
    if (!cr) continue;
    const handleRaw = cr.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
    const handle = handleRaw.replace(/^\//, '').replace(/^@/, '');
    if (!handle) continue;
    const name = cr.title?.simpleText || (cr.title?.runs || []).map((r) => r.text).join('') || handle;
    const subs = parseCount(cr.subscriberCountText?.simpleText);
    const browseId = cr.navigationEndpoint?.browseEndpoint?.browseId || '';
    out.push({ handle, name, subscribers: subs, browseId });
  }
  return out;
};

async function fetchSearchPage(query, token = null) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (!token) {
        const res = await axios.get('https://www.youtube.com/results', {
          params: { search_query: query, sp: 'EgIQAg%3D%3D' },
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, timeout: 25000,
        });
        const match = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
        if (!match) return { channels: [], token: null };
        const data = JSON.parse(match[1]);
        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        let items = [], next = null;
        for (const s of contents) { if (s?.itemSectionRenderer?.contents) items = items.concat(s.itemSectionRenderer.contents); const t = getToken([s]); if (t) next = t; }
        return { channels: extractChannels(items), token: next };
      }
      const res = await axios.post(`https://www.youtube.com/youtubei/v1/search?key=${API_KEY}&prettyPrint=false`,
        { context: { client: { hl: 'en', gl: 'IN', clientName: 'WEB', clientVersion: '2.20240821.01.00' } }, continuation: token },
        { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, timeout: 25000 });
      for (const a of res.data?.onResponseReceivedActions || []) {
        const arr = a?.appendContinuationItemsAction?.continuationItems;
        if (arr) return { channels: extractChannels(arr), token: getToken(arr) };
      }
      return { channels: [], token: null };
    } catch (err) { if (attempt === 4) throw err; await sleep(1500 * attempt); }
  }
}

const existingHandles = () => {
  const set = new Set();
  try {
    const a = require('../config/indianChannels').CHANNELS || [];
    const ex = require('../config/extraChannels');
    const b2 = require('../config/channels_batch2').CHANNELS_BATCH2 || [];
    for (const c of [...a, ...b2]) set.add(String(c.handle || '').toLowerCase());
    for (const k of Object.keys(ex)) if (Array.isArray(ex[k])) for (const c of ex[k]) set.add(String(c.handle || '').toLowerCase());
  } catch {}
  try {
    const raw = fs.readFileSync(OUT_FILE, 'utf8');
    for (const m of raw.matchAll(/handle: "(.*?)"/g)) set.add(m[1].toLowerCase());
  } catch {}
  return set;
};

const main = async () => {
  const found = new Map(); // handle -> {handle,name,category,subscribers}
  const skip = existingHandles();
  console.log(`[discover2] skip existing: ${skip.size} | target: ${TARGET} | cats: 20`);
  const catCount = {};
  outer:
  for (const [cat, queries] of Object.entries(CATEGORY_QUERIES)) {
    for (const q of queries) {
      let token = null;
      for (let page = 1; page <= 5; page++) {
        try {
          const { channels, token: next } = await fetchSearchPage(q, token);
          for (const c of channels) {
            const h = c.handle.toLowerCase();
            if (found.has(h) || skip.has(h)) continue;
            if (c.subscribers > 0 && c.subscribers < 1000) continue;
            if ((catCount[cat] || 0) >= PER_CAT_CAP) break;
            found.set(h, { handle: c.handle, name: c.name, category: cat, subscribers: c.subscribers });
            catCount[cat] = (catCount[cat] || 0) + 1;
          }
          token = next;
          if (!token) break;
          await sleep(400 + Math.random() * 300);
        } catch (e) { console.log(`[discover2] "${q}" p${page} fail: ${e.message}`); await sleep(5000); break; }
        if (found.size >= TARGET) break outer;
      }
      if ((catCount[cat] || 0) >= PER_CAT_CAP) break;
    }
    console.log(`[discover2] ${cat}: ${catCount[cat] || 0} (total ${found.size}/${TARGET})`);
    if (found.size >= TARGET) break;
  }
  console.log(`[discover2] collected ${found.size}`);
  const list = [...found.values()].sort((a, b) => a.category.localeCompare(b.category));
  const lines = list.map((c) => `  { handle: ${JSON.stringify(c.handle)}, name: ${JSON.stringify(c.name)}, category: ${JSON.stringify(c.category)} },`);
  fs.writeFileSync(OUT_FILE, `// AUTO-GENERATED discoverChannels2 — ${new Date().toISOString()}\n// ${list.length} channels, 20 categories\n\nconst CHANNELS_BATCH3 = [\n${lines.join('\n')}\n];\n\nmodule.exports = { CHANNELS_BATCH3 };\n`);
  console.log(`[discover2] written ${list.length} -> ${OUT_FILE}`);
};
main().catch((e) => { console.error(e); process.exit(1); });
