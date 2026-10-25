/**
 * ═══════════════════════════════════════════════════════════════════
 *  channelRegistry.js — handle → UC channelId resolver
 *  ─────────────────────────────────────────────────────────────────
 *  YouTube handles (@name) `channel_id` ke liye API nahi dete bina
 *  key. Hum channel page ka HTML fetch karke ytInitialData se
 *  "channelId":"UC..." nikalte hain. Result db.json ke
 *  `channel_registry` me cache hota hai taaki baar-baar na padna pade.
 *
 *  Resolve na hone wale channels skip + report hote hain.
 * ═══════════════════════════════════════════════════════════════════
 */
const axios = require('axios');
const { readDb, writeDb } = require('./dbJson');

const getRegistry = () => {
  const localDb = readDb();
  if (!localDb.channel_registry) localDb.channel_registry = {};
  return localDb.channel_registry;
};

const saveRegistry = (registry) => {
  const localDb = readDb();
  localDb.channel_registry = registry;
  writeDb(localDb);
};

/**
 * Resolve a single @handle to its UC channel ID.
 * The real canonical ID lives in `externalId` (channelMetadataRenderer) —
 * `channelId` on the page points to an unrelated/redirect channel.
 * @returns {Promise<string|null>} channelId or null
 */
const resolveChannelId = async (handle) => {
  const registry = getRegistry();
  const cached = registry[handle];
  if (cached && cached.channelId) return cached.channelId;
  if (cached && cached.failedAt && Date.now() - cached.failedAt < 6 * 60 * 60 * 1000) {
    return null; // Failed within last 6h — don't hammer
  }

  const attempt = async () => {
    const res = await axios.get(`https://www.youtube.com/@${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });

    // Verified 2026-08: `externalId` == `browseId` == canonical channel ID.
    // The `channelId` key can point to a DIFFERENT channel — do not use it.
    const match = res.data.match(/"externalId":"(UC[\w-]{22})"/)
      || res.data.match(/"browseId":"(UC[\w-]{22})"/);
    if (match && match[1]) return match[1];
    throw new Error('channelId not found in page');
  };

  // FALLBACK: @handle page 404 (rename/delete) -> YouTube search se channelId.
  // channelRenderer ka browseEndpoint.browseId hi canonical UC id hota hai.
  const attemptSearch = async () => {
    const res = await axios.get('https://www.youtube.com/results', {
      params: { search_query: handle, sp: 'EgIQAg%3D%3D' }, // EgIQAg== = Channels filter
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
    });
    const m = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
    if (!m) throw new Error('search page parse failed');
    const data = JSON.parse(m[1]);
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const want = String(handle).toLowerCase().replace(/^@/, '');
    let fallbackId = null;
    for (const section of contents) {
      for (const item of section?.itemSectionRenderer?.contents || []) {
        const cr = item?.channelRenderer;
        if (!cr) continue;
        const browseId = cr?.navigationEndpoint?.browseEndpoint?.browseId;
        if (!browseId || !/^UC[\w-]{22}$/.test(browseId)) continue;
        const hRaw = cr?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
        const h = hRaw.replace(/^\//, '').replace(/^@/, '').toLowerCase();
        const title = (cr?.title?.simpleText || (cr?.title?.runs || []).map((r) => r.text).join('') || '').toLowerCase();
        if (h === want || h === '@' + want) return browseId; // exact handle match
        if (!fallbackId && (title.includes(want) || want.includes(title))) fallbackId = browseId;
        if (!fallbackId) fallbackId = browseId; // pehla channel result
      }
    }
    if (fallbackId) return fallbackId;
    throw new Error('no channel in search results');
  };

  try {
    const channelId = await attempt();
    registry[handle] = { channelId, resolvedAt: Date.now() };
    saveRegistry(registry);
    console.log(`[ChannelRegistry] ✅ @${handle} → ${channelId}`);
    return channelId;
  } catch (err) {
    // FAST-FAIL + SEARCH FALLBACK: 404 = @handle page nahi mili (rename/delete).
    // Retry bekar hai — seedha YouTube search se UC id nikalo.
    const status = err.response?.status;
    if (status === 404) {
      try {
        const channelId = await attemptSearch();
        registry[handle] = { channelId, resolvedAt: Date.now(), via: 'search' };
        saveRegistry(registry);
        console.log(`[ChannelRegistry] ✅ @${handle} → ${channelId} (via search)`);
        return channelId;
      } catch (e2) {
        registry[handle] = { channelId: null, failedAt: Date.now(), reason: '404 + search miss' };
        saveRegistry(registry);
        console.warn(`[ChannelRegistry] ❌ @${handle} 404 + search miss (skip)`);
        return null;
      }
    }
    // Network flaky (mobile hotspot) — sirf network error pe 1 retry
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const channelId = await attempt();
      registry[handle] = { channelId, resolvedAt: Date.now() };
      saveRegistry(registry);
      console.log(`[ChannelRegistry] ✅ @${handle} → ${channelId} (retry)`);
      return channelId;
    } catch (err2) {
      registry[handle] = { channelId: null, failedAt: Date.now(), reason: err2.message };
      saveRegistry(registry);
      console.warn(`[ChannelRegistry] ❌ @${handle} resolve failed: ${err2.message}`);
      return null;
    }
  }
};

/**
 * Resolve all handles in a channel config list (in sequence to be gentle).
 * @returns {Promise<{ok: Array, failed: Array}>}
 */
const resolveAll = async (channels) => {
  const ok = [];
  const failed = [];
  for (const ch of channels) {
    const channelId = await resolveChannelId(ch.handle);
    if (channelId) {
      ok.push({ ...ch, channelId });
    } else {
      failed.push(ch);
    }
    await new Promise((r) => setTimeout(r, 300)); // gentle pacing
  }
  return { ok, failed };
};

/** Build the WebSub topic URL for a channel ID */
const getTopicUrl = (channelId) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

/** Look up a channel entry by handle (for uploader metadata) */
const getChannelByHandle = (handle) => {
  const { CHANNELS } = require('../config/indianChannels');
  return CHANNELS.find((c) => c.handle === handle) || null;
};

/** Reverse lookup: channelId → channel entry (uses cached registry) */
const getChannelByChannelId = (channelId) => {
  const registry = getRegistry();
  for (const [handle, info] of Object.entries(registry)) {
    if (info && info.channelId === channelId) {
      return getChannelByHandle(handle);
    }
  }
  return null;
};

module.exports = {
  resolveChannelId,
  resolveAll,
  getTopicUrl,
  getChannelByHandle,
  getChannelByChannelId,
};
