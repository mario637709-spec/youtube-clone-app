/**
 * discoverChannels.js — YouTube search ke through 1000+ Indian channels discover karo
 *
 * YouTube search (WEB client) ke search results se channelRenderer nikalta hai,
 * handles ko collect karta hai, aur config/channels_batch2.js generate karta hai.
 * Search queries = Indian categories/creators, continuation pagination ke saath.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const TARGET = 1000;
const OUT_FILE = path.join(__dirname, '..', 'config', 'channels_batch2.js');

const CATEGORIES = ['Gaming', 'Tech', 'News', 'Music', 'Food', 'Education', 'Comedy', 'Sports', 'Finance', 'Vlogs & Lifestyle'];

const QUERIES = [
  'indian youtuber', 'top indian channel', 'hindi vlogger', 'bollywood songs', 'indian comedy',
  'indian tech review', 'desi gaming', 'hindi news', 'indian food recipe', 'indian cricket',
  'bollywood music', 'punjabi songs', 'tamil songs', 'telugu songs', 'bhajan', 'kirtan',
  'indian cooking', 'street food india', 'indian travel vlog', 'motivation hindi',
  'educational hindi', 'upsc preparation', 'jee neet preparation', 'indian stock market',
  'indian business', 'startup india', 'kids cartoon hindi', 'indian science', 'indian space',
  'chhota bheem', 'tom and jerry hindi', 'bhakti songs', 'hindi kahaniya', 'indian standup',
  'indian podcast', 'indian interview', 'tech unboxing hindi', 'mobile review hindi',
  'cricket highlights hindi', 'ipl news', 'indian news today', 'aa j tak', 'zeenews',
  'indian politics', 'modi news', 'indian army', 'fitness hindi', 'yoga india',
  'indian fashion', 'makeup tutorial hindi', 'indian web series', 'bollywood gossip',
];

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

const getContinuationToken = (items) => {
  for (const item of items || []) {
    const token =
      item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
      item?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token;
    if (token) return token;
  }
  return null;
};

const extractChannels = (items) => {
  const out = [];
  for (const item of items || []) {
    const cr = item?.channelRenderer;
    if (!cr) continue;
    const handleRaw = cr.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
    const handle = handleRaw.replace(/^\//, '').replace(/^@/, '');
    if (!handle) continue;
    const titleObj = cr.title || {};
    const name = titleObj.simpleText || (titleObj.runs || []).map((r) => r.text).join('') || handle;
    const subs = parseCount(cr.subscriberCountText?.simpleText);
    out.push({ handle, name, subscribers: subs });
  }
  return out;
};

const fetchSearchPage = async (query, token = null, page = 1) => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (!token) {
        const res = await axios.get('https://www.youtube.com/results', {
          params: { search_query: query, sp: 'EgIQAg%3D%3D' },
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
          timeout: 25000,
        });
        const match = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
        if (!match) return { channels: [], token: null };
        const data = JSON.parse(match[1]);
        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents || [];
        let items = [];
        let nextToken = null;
        for (const section of contents) {
          const list = section?.itemSectionRenderer?.contents;
          if (list) items = items.concat(list);
          const t = getContinuationToken([section]);
          if (t) nextToken = t;
        }
        return { channels: extractChannels(items), token: nextToken };
      } else {
        const res = await axios.post(
          `https://www.youtube.com/youtubei/v1/search?key=${API_KEY}&prettyPrint=false`,
          {
            context: { client: { hl: 'en', gl: 'IN', clientName: 'WEB', clientVersion: '2.20240821.01.00' } },
            continuation: token,
          },
          { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, timeout: 25000 }
        );
        const actions = res.data?.onResponseReceivedActions || [];
        for (const action of actions) {
          const itemsArr = action?.appendContinuationItemsAction?.continuationItems;
          if (itemsArr) {
            return {
              channels: extractChannels(itemsArr),
              token: getContinuationToken(itemsArr),
            };
          }
        }
        return { channels: [], token: null };
      }
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(1500 * attempt);
    }
  }
};

const main = async () => {
  const found = new Map();
  const skipped = new Set();
  // resume: pehle se existing file ke handles load kar lo
  if (fs.existsSync(OUT_FILE)) {
    try {
      const raw = fs.readFileSync(OUT_FILE, 'utf8');
      const m = raw.match(/handle: "(.*?)"/g) || [];
      for (const x of m) found.set(x.slice(9, -1), { handle: x.slice(9, -1), name: x.slice(9, -1) });
      console.log(`[discover] Resumed with ${found.size} existing channels`);
    } catch {}
  }
  const MAX_PAGES_PER_QUERY = 5;
  const start = Date.now();
  console.log(`[discover] Target: ${TARGET} channels | ${QUERIES.length} queries`);

  outer:
  for (const query of QUERIES) {
    let token = null;
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
      try {
        const { channels, token: next } = await fetchSearchPage(query, token, page);
        for (const c of channels) {
          if (found.has(c.handle) || skipped.has(c.handle)) continue;
          if (c.subscribers > 0 && c.subscribers < 1000) { skipped.add(c.handle); continue; }
          found.set(c.handle, { handle: c.handle, name: c.name, subscribers: c.subscribers });
        }
        token = next;
        if (!token) break;
        await sleep(400 + Math.random() * 300);
      } catch (err) {
        console.log(`[discover] query "${query}" page ${page} failed: ${err.message}`);
        await sleep(5000);
        break;
      }
      if (found.size >= TARGET) break outer;
    }
    console.log(`[discover] "${query}" → total ${found.size}/${TARGET}`);
  }

  console.log(`[discover] Collected ${found.size} unique channels in ${((Date.now() - start) / 1000).toFixed(0)}s`);

  // category assignment: hash-based deterministic split
  const list = Array.from(found.values());
  const withCategory = list.map((c, i) => ({
    handle: c.handle,
    name: c.name,
    category: CATEGORIES[i % CATEGORIES.length],
  }));

  const lines = withCategory.map((c) => `  { handle: ${JSON.stringify(c.handle)}, name: ${JSON.stringify(c.name)}, category: ${JSON.stringify(c.category)} },`);
  const content = `// AUTO-GENERATED by discoverChannels.js — ${new Date().toISOString()}\n// ${withCategory.length} Indian channels discovered via YouTube search\n\nconst CHANNELS_BATCH2 = [\n${lines.join('\n')}\n];\n\nmodule.exports = { CHANNELS_BATCH2 };\n`;
  fs.writeFileSync(OUT_FILE, content, 'utf8');
  console.log(`[discover] Written ${withCategory.length} channels → ${OUT_FILE}`);
};

main().catch((e) => { console.error(e); process.exit(1); });