/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  syncYouTubeChannel.js â€” 100-channel auto video store
 *  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *  Pehle yt-dlp binary chahiye thi (missing â†’ sync hamesha fail).
 *  Ab sab kuch bina binary ke chalta hai:
 *    1. Channel ke /videos page ka ytInitialData parse â†’ latest ~30
 *       videos: real duration, views, publish time, thumbnail.
 *    2. Fallback: RSS feed (id/title/published) agar page parse fail.
 *    3. Naya video â†’ algorithm-friendly metadata (config category,
 *       tags, channel name/avatar) ke saath DB me store.
 *
 *  Ye pubsub ka backfill/catch-up hai â€” WebSub notification se bhi
 *  videos aati hain, dono paths same schema use karte hain.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */
const axios = require('axios');
const dbFirestore = require('./dbFirestore');
const getPublicBaseUrl = require('./publicBaseUrl');
const { CHANNELS } = require('../config/indianChannels');
const { resolveChannelId } = require('./channelRegistry');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

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

/** "12:34" â†’ 754 seconds (also handles "1:02:03") */
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

/** Parse channel /videos page â†’ array of video entries */
const fetchChannelVideos = async (handle) => {
  try {
    const res = await axios.get(`https://www.youtube.com/@${handle}/videos`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 20000,
    });

    const match = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
    if (!match) throw new Error('ytInitialData not found');

    const data = JSON.parse(match[1]);
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    let renderers = [];

    for (const tab of tabs) {
      const content = tab?.tabRenderer?.content;
      const grid = content?.richGridRenderer
        || content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.richGridRenderer;
      if (!grid) continue;
      renderers = grid.contents || [];
      if (renderers.length > 0) break;
    }

    const videos = [];
    for (const item of renderers) {
      const inner = item?.richItemRenderer?.content;
      const vr = inner?.videoRenderer;                 // old layout
      const lvm = inner?.lockupViewModel;              // new layout (2025+)
      if (!vr && !lvm) continue;

      if (vr) {
        const title = vr.title?.runs?.map((r) => r.text).join('') || vr.title?.simpleText || 'Unknown Title';
        const lengthSec = durationToSeconds(vr.lengthText?.simpleText);
        const thumbnails = vr.thumbnail?.thumbnails || [];
        videos.push({
          id: vr.videoId,
          title,
          durationSec: lengthSec,
          views: parseCount(vr.viewCountText?.simpleText),
          publishedText: vr.publishedTimeText?.simpleText || '',
          thumbnail: thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : '',
        });
      } else if (lvm) {
        const meta = lvm?.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || 'Unknown Title';
        const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows || [])
          .flatMap((row) => row.metadataParts || [])
          .map((p) => p?.text?.content || '');
        const img = lvm?.contentImage?.thumbnailViewModel?.image?.sources || [];
        videos.push({
          id: lvm.contentId || '',
          title,
          durationSec: durationToSeconds(parts[1]),   // [views, duration] order
          views: parseCount(parts[0]),
          publishedText: parts[2] || '',
          thumbnail: img.length > 0 ? img[img.length - 1].url : '',
        });
      }
    }

    if (videos.length === 0) {
      console.warn(`[YouTube Sync] @${handle} page gave 0 videos â€” RSS fallback`);
      return fetchChannelRss(handle);
    }
    return videos;
  } catch (err) {
    console.warn(`[YouTube Sync] @${handle} page parse failed (${err.message}) â€” trying RSS fallback`);
    return fetchChannelRss(handle);
  }
};

/** Fallback: RSS feed (no duration/views, title+publish only) */
const fetchChannelRss = async (handle) => {
  const channelId = await resolveChannelId(handle);
  if (!channelId) return [];
  const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { 'User-Agent': UA },
    timeout: 20000,
  });
  const body = res.data;
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const entry = m[1];
    const vid = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    if (vid) entries.push({ id: vid, title: (title || 'Unknown Title').trim(), durationSec: 0, views: 0, thumbnail: '' });
  }
  return entries;
};

/**
 * Sync latest videos from ALL configured channels into the DB.
 * @param {number} maxPerChannel max new videos to process per channel
 */
const syncChannel = async (maxPerChannel = 15) => {
  console.log(`[YouTube Sync] Starting sync for ${CHANNELS.length} channels (max ${maxPerChannel}/channel)...`);

  // Preload all existing video IDs ONCE (readDb parses the whole file per
  // call â€” doing it per-video would be 3000+ parses per sync cycle).
  let existingIds = new Set();
  try {
    const all = await dbFirestore.getVideos();
    if (Array.isArray(all)) existingIds = new Set(all.map((v) => v.id));
    console.log(`[YouTube Sync] Loaded ${existingIds.size} existing video IDs for dedupe`);
  } catch (err) {
    console.warn('[YouTube Sync] Could not preload existing IDs:', err.message);
  }

  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failedList = [];

  for (const ch of CHANNELS) {
    let channelId = await resolveChannelId(ch.handle);
    if (!channelId) {
      failedCount++;
      failedList.push(`@${ch.handle}`);
      continue;
    }

    try {
      const videos = await fetchChannelVideos(ch.handle);
      let processed = 0;

      for (const v of videos) {
        if (processed >= maxPerChannel) break;
        if (!v.id) continue;

        if (existingIds.has(v.id)) {
          skippedCount++;
          continue;
        }

        const durationSec = v.durationSec || 300; // RSS fallback â†’ 5:00 placeholder
        const isShort = durationSec > 0 && durationSec < 60;
        const uploaderAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(ch.name)}&background=ff0000&color=fff`;

        const newVideo = {
          id: v.id,
          youtube_id: v.id,
          title: v.title,
          description: `Latest video from ${ch.name}.`,
          category: ch.category,
          tags: [ch.category.toLowerCase(), 'youtube', ch.handle],
          visibility: 'public',
          uploader: {
            id: channelId,
            username: ch.handle,
            channelName: ch.name,
            avatar: uploaderAvatar,
          },
          views: v.views || 0,
          likes: 0,
          dislikes: 0,
          duration: formatDuration(durationSec),
          isShort: isShort,
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`,
          videoUrl: `${getPublicBaseUrl()}/api/videos/stream/${v.id}`,
          storageLocation: 'YouTube',
          status: 'Live',
          createdAt: new Date().toISOString(),
          syncedFrom: '@' + ch.handle,
        };

        await dbFirestore.createVideo(v.id, newVideo);
        existingIds.add(v.id);
        addedCount++;
        processed++;
        console.log(`[YouTube Sync] âœ… Added: "${newVideo.title}" [${v.id}] (${ch.name})`);
      }

      console.log(`[YouTube Sync] @${ch.handle}: ${processed} added, rest skipped`);
    } catch (err) {
      failedCount++;
      failedList.push(`@${ch.handle} (${err.message})`);
      console.error(`[YouTube Sync] Error syncing @${ch.handle}:`, err.message);
    }
  }

  console.log(`[YouTube Sync] ðŸŽ‰ Complete! Added ${addedCount}, skipped ${skippedCount}, failed ${failedCount}.`);
  if (failedList.length > 0) {
    console.warn('[YouTube Sync] Failed channels:', failedList.join(', '));
  }
  return { addedCount, skippedCount, failedCount, failedList };
};

// Check if run directly from CLI
if (require.main === module) {
  syncChannel()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[YouTube Sync] CLI Execution failed:', err);
      process.exit(1);
    });
}

module.exports = {
  syncChannel,
};

