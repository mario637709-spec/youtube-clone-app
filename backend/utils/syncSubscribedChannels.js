const { exec } = require('child_process');
const path = require('path');

// Configure custom local temp folder for yt-dlp to avoid PyInstaller decompression file-lock errors on Windows
const fs = require('fs');
const getPublicBaseUrl = require('./publicBaseUrl');
const customTempDir = path.join(__dirname, '..', 'tmp', 'yt-dlp-temp');
if (!fs.existsSync(customTempDir)) {
  fs.mkdirSync(customTempDir, { recursive: true });
}
process.env.TEMP = customTempDir;
process.env.TMP = customTempDir;
process.env.TMPDIR = customTempDir;

// Load environment variables before requiring firebase or other modules
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });


const axios = require('axios');
const { google } = require('googleapis');
const dbFirestore = require('./dbFirestore');
const { CHANNELS } = require('./subscribeChannels');

// Default sync limit
const DEFAULT_SYNC_LIMIT = 5000;

// â”€â”€â”€ SPEED OPTIMIZATION 1: Skip OAuth entirely if we know it's expired â”€â”€â”€â”€â”€â”€
// Only use API Key auth (much faster, no token refresh roundtrip)
let youtubeClient = null;
if (process.env.YOUTUBE_API_KEY) {
  try {
    youtubeClient = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
    console.log('[Sync Agent] âœ… YouTube API v3 initialized via API Key.');
  } catch (err) {
    console.warn('[Sync Agent] Failed to init YouTube API Key client:', err.message);
  }
} else {
  console.warn('[Sync Agent] No YOUTUBE_API_KEY found â€” using fast Piped/yt-dlp fallback only.');
}

/**
 * Parses ISO 8601 duration string into MM:SS and total seconds.
 */
const parseIsoDuration = (durationStr) => {
  if (!durationStr) return { formatted: '0:00', seconds: 0 };
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return { formatted: '0:00', seconds: 0 };
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  const seconds = parseInt(match[3] || 0, 10);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const totalMinutes = hours * 60 + minutes;
  return { formatted: `${totalMinutes}:${seconds.toString().padStart(2, '0')}`, seconds: totalSeconds };
};

/**
 * Batch fetch from YouTube API v3 (only runs if API Key is configured).
 */
const fetchVideoDetailsBatch = async (videoIds) => {
  if (!youtubeClient || videoIds.length === 0) return {};
  try {
    const response = await youtubeClient.videos.list({
      id: videoIds.join(','),
      part: 'snippet,contentDetails'
    });
    const detailsMap = {};
    if (response.data && response.data.items) {
      for (const item of response.data.items) {
        const { formatted, seconds } = parseIsoDuration(item.contentDetails?.duration);
        detailsMap[item.id] = {
          title: item.snippet.title,
          description: item.snippet.description,
          tags: item.snippet.tags || [],
          category: item.snippet.categoryId || 'General',
          duration: formatted,
          durationSeconds: seconds,
          thumbnailUrl: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null
        };
      }
    }
    return detailsMap;
  } catch (err) {
    console.warn('[Sync Agent] YouTube API batch fetch failed:', err.message);
    return {};
  }
};

// â”€â”€â”€ SPEED OPTIMIZATION 2: Thumbnail = direct YouTube URL, no download â”€â”€â”€â”€â”€â”€â”€
// YouTube CDN thumbnails are publicly accessible â€” no need to save locally!
const getThumbnailUrl = (videoId) => {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
};

// â”€â”€â”€ SPEED OPTIMIZATION 3: Checks if short by title/tags first (no yt-dlp) â”€â”€
// yt-dlp aspect ratio check is VERY slow (spawns process per video).
// We check title/tags/duration first â€” only call yt-dlp as last resort.
const checkIsVideoPortrait = async (videoId, title = '', description = '', tags = []) => {
  // Fast keyword check first
  const text = `${title} ${description}`.toLowerCase();
  const allTags = tags.map(t => (typeof t === 'string' ? t.toLowerCase() : ''));
  if (text.includes('#shorts') || text.includes('#short') || allTags.some(t => t.includes('short'))) {
    return true;
  }
  // If no keyword found, try yt-dlp as last resort (only for very short videos)
  const ytdlpPath = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) return false;
  return new Promise((resolve) => {
    const cmd = `"${ytdlpPath}" --force-ipv4 --print "%(width)s,%(height)s" --no-warnings https://www.youtube.com/watch?v=${videoId}`;
    exec(cmd, { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const parts = stdout.trim().split(',');
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      resolve(!isNaN(width) && !isNaN(height) && width < height);
    });
  });
};

// â”€â”€â”€ SPEED OPTIMIZATION 4: Parallel Piped+Invidious with Promise.race â”€â”€â”€â”€â”€â”€â”€â”€
// Instead of trying one-by-one (worst case: 9 Ã— 1200ms = 10.8s per video),
// we fire ALL requests at once and take the first success (usually < 1s).
const PIPED_INSTANCES = [
  'https://pipedapi.lunar.icu',
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt',
  'https://piped-api.garudalinux.org',
  'https://piped-api.privacydev.net'
];
const INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.f5.si'
];

const fetchSingleVideoScrapeFallback = async (videoId) => {
  const TIMEOUT = 1200; // Reduced from 3000ms â†’ 1200ms

  // Fire ALL Piped + Invidious requests simultaneously, take first success
  const pipedRequests = PIPED_INSTANCES.map(instance =>
    axios.get(`${instance}/streams/${videoId}`, { timeout: TIMEOUT })
      .then(res => {
        if (res.data && res.data.title) {
          return {
            title: res.data.title,
            description: res.data.description || '',
            tags: res.data.tags || [],
            category: res.data.category || 'General',
            durationSeconds: res.data.duration || 0,
            thumbnailUrl: res.data.thumbnailUrl || null
          };
        }
        return Promise.reject(new Error('No title'));
      })
  );

  const invidiousRequests = INVIDIOUS_INSTANCES.map(instance =>
    axios.get(`${instance}/api/v1/videos/${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: TIMEOUT
    }).then(res => {
      if (res.data && res.data.title) {
        let thumbnail = null;
        if (res.data.videoThumbnails && res.data.videoThumbnails.length > 0) {
          thumbnail = res.data.videoThumbnails[res.data.videoThumbnails.length - 1].url;
        }
        return {
          title: res.data.title,
          description: res.data.description || '',
          tags: res.data.tags || [],
          category: res.data.category || 'General',
          durationSeconds: res.data.lengthSeconds || 0,
          thumbnailUrl: thumbnail
        };
      }
      return Promise.reject(new Error('No title'));
    })
  );

  // Race all requests â€” first success wins
  try {
    const result = await Promise.any([...pipedRequests, ...invidiousRequests]);
    return result;
  } catch (e) {
    // All failed â€” fall back to yt-dlp
  }

  // yt-dlp last resort (slow but reliable)
  const ytdlpPath = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) return null;

  return new Promise((resolve) => {
    const cmd = `"${ytdlpPath}" --force-ipv4 --dump-json --no-warnings https://www.youtube.com/watch?v=${videoId}`;
    exec(cmd, { maxBuffer: 1024 * 1024 * 50, timeout: 30000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          title: parsed.title,
          description: parsed.description || '',
          tags: parsed.tags || [],
          category: parsed.categories ? parsed.categories[0] : 'General',
          durationSeconds: parsed.duration || 0,
          thumbnailUrl: parsed.thumbnail || null
        });
      } catch (e) {
        resolve(null);
      }
    });
  });
};

/**
 * Process a single video and save to DB.
 */
const processSingleVideo = async (flatData, channelId, apiMetadata) => {
  const videoId = flatData.id;
  let apiData = apiMetadata[videoId];

  // Fallback if no API data
  if (!apiData || !apiData.title) {
    const scraped = await fetchSingleVideoScrapeFallback(videoId);
    if (scraped) {
      apiData = Object.assign({}, apiData || {}, scraped);
    }
  }

  const title = (apiData && apiData.title) ? apiData.title : (flatData.title || 'Untitled Video');
  const description = (apiData && apiData.description) ? apiData.description : (flatData.description || '');
  const tags = (apiData && apiData.tags) ? apiData.tags : ['imported', 'channel_sync'];
  const category = (apiData && apiData.category) ? apiData.category : 'General';

  let duration = '0:00';
  let durationSeconds = 0;

  if (apiData && apiData.durationSeconds) {
    durationSeconds = apiData.durationSeconds;
    duration = apiData.duration || (() => {
      const m = Math.floor(durationSeconds / 60);
      const s = Math.floor(durationSeconds % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    })();
  } else if (flatData.duration_string) {
    duration = flatData.duration_string;
    const parts = duration.split(':').map(Number);
    if (parts.length === 2) {
      durationSeconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  } else if (flatData.duration) {
    durationSeconds = flatData.duration;
    const m = Math.floor(durationSeconds / 60);
    const s = Math.floor(durationSeconds % 60);
    duration = `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Shorts check: URL check first, then hashtag check, then fallback to portrait check if duration is short/zero
  const text = `${title} ${description}`.toLowerCase();
  const allTags = tags.map(t => (typeof t === 'string' ? t.toLowerCase() : ''));
  const hasShortsHashtag = text.includes('#shorts') || text.includes('#short') || allTags.some(t => t.includes('short'));
  
  const urlText = `${flatData.url || ''} ${flatData.webpage_url || ''} ${flatData.original_url || ''}`.toLowerCase();
  const hasShortsUrl = urlText.includes('/shorts/') || urlText.includes('/short/');

  const isShortDuration = durationSeconds === 0 || durationSeconds < 180;
  
  let isShort = false;
  if (hasShortsHashtag || hasShortsUrl) {
    isShort = true;
    duration = '0:00'; // Hiding timer for shorts
  } else if (isShortDuration) {
    isShort = await checkIsVideoPortrait(videoId, title, description, tags);
    if (isShort) {
      duration = '0:00'; // Hiding timer for shorts
    }
  }

  // â”€â”€ SPEED OPTIMIZATION 5: Use direct YouTube thumbnail URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // No download, no disk write, no Firebase upload â€” just store the URL string
  const thumbnailUrl = (apiData && apiData.thumbnailUrl) ? apiData.thumbnailUrl : getThumbnailUrl(videoId);

  const uploaderName = flatData.uploader || `channel_${channelId.substring(0, 8)}`;
  const channelName = flatData.uploader || `YouTube Channel (${channelId.substring(0, 6)})`;

  const newVideo = {
    id: videoId,
    youtube_id: videoId,
    title,
    description,
    category,
    tags,
    visibility: 'public',
    uploader: {
      id: channelId,
      username: uploaderName,
      channelName,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}&background=ff0000&color=fff`
    },
    views: flatData.view_count || 0,
    likes: flatData.like_count || 0,
    dislikes: 0,
    duration,
    isShort,
    thumbnail: thumbnailUrl,
    videoUrl: `${getPublicBaseUrl()}/api/videos/stream/${videoId}`,
    storageLocation: 'YouTube',
    status: 'Live',
    createdAt: new Date().toISOString()
  };

  await dbFirestore.createVideo(videoId, newVideo);
  console.log(`[Sync Agent] âœ… [${duration}${isShort ? ' ðŸ“±SHORT' : ''}] "${title}" [${videoId}]`);
  return true;
};

/**
 * Scrapes a YouTube channel and indexes all its videos.
 */
const syncSingleChannel = async (channelId, limit = DEFAULT_SYNC_LIMIT) => {
  const channelUrl = `https://www.youtube.com/channel/${channelId}`;
  console.log(`\n[Sync Agent] â–¶ Starting channel: ${channelUrl}`);

  const ytdlpPath = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) throw new Error(`yt-dlp.exe not found at ${ytdlpPath}`);

  const cmd = `"${ytdlpPath}" --force-ipv4 --dump-json --flat-playlist --playlist-end ${limit} --no-warnings ${channelUrl}`;

  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 150 }, async (error, stdout) => {
      if (error) {
        console.error(`[Sync Agent] yt-dlp error for channel ${channelId}:`, error.message);
        return reject(error);
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      console.log(`[Sync Agent] Found ${lines.length} videos on channel ${channelId}`);

      // Filter already-existing videos
      let allVideos = [];
      try { allVideos = await dbFirestore.getVideos(); } catch (e) { }
      const existingIds = new Set(allVideos.map(v => v.id || v.youtube_id));

      const newVideoList = [];
      let skippedCount = 0;
      for (const line of lines) {
        try {
          const videoData = JSON.parse(line);
          if (!videoData.id) continue;
          if (existingIds.has(videoData.id)) { skippedCount++; continue; }
          newVideoList.push(videoData);
        } catch (e) { /* ignore */ }
      }

      console.log(`[Sync Agent] ${newVideoList.length} new to sync, ${skippedCount} already exist.`);
      if (newVideoList.length === 0) return resolve({ added: 0, skipped: skippedCount });

      // Batch fetch from YouTube API (only if API Key is set)
      const apiMetadata = {};
      if (youtubeClient) {
        const batchSize = 50;
        for (let i = 0; i < newVideoList.length; i += batchSize) {
          const chunk = newVideoList.slice(i, i + batchSize);
          const batchResults = await fetchVideoDetailsBatch(chunk.map(v => v.id));
          Object.assign(apiMetadata, batchResults);
        }
      }

      // â”€â”€ SPEED OPTIMIZATION 6: Process 5 videos concurrently â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const CONCURRENCY = 5;
      let added = 0;
      let processed = 0;

      for (let i = 0; i < newVideoList.length; i += CONCURRENCY) {
        const batch = newVideoList.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(flatData => processSingleVideo(flatData, channelId, apiMetadata))
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) added++;
        }
        processed += batch.length;
        console.log(`[Sync Agent] Progress: ${processed}/${newVideoList.length} (${added} added)`);
      }

      console.log(`[Sync Agent] âœ… Channel ${channelId} done! Added: ${added}, Skipped: ${skippedCount}`);
      resolve({ added, skipped: skippedCount });
    });
  });
};

/**
 * Runs bulk sync for all subscribed channels.
 */
const runBulkSync = async (limit = DEFAULT_SYNC_LIMIT) => {
  console.log(`[Sync Agent] ðŸš€ Starting FAST bulk sync for ${CHANNELS.length} channels (limit: ${limit})...`);
  let totalAdded = 0;
  let totalSkipped = 0;

  for (const channelId of CHANNELS) {
    try {
      const result = await syncSingleChannel(channelId, limit);
      totalAdded += result.added;
      totalSkipped += result.skipped;
    } catch (err) {
      console.error(`[Sync Agent] Failed to sync channel ${channelId}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 1000)); // 1s gap between channels
  }

  console.log(`\n[Sync Agent] ðŸŽ‰ Bulk Sync Complete! Total Added: ${totalAdded}, Total Skipped: ${totalSkipped}`);
};

// Execute directly if run from console
if (require.main === module) {
  const customLimit = process.argv[2] ? parseInt(process.argv[2], 10) : DEFAULT_SYNC_LIMIT;
  runBulkSync(customLimit)
    .then(() => {
      console.log('[Sync Agent] Sync Process Completed. Exiting.');
      process.exit(0);
    })
    .catch(err => {
      console.error('[Sync Agent] Bulk sync failed:', err.message);
      process.exit(1);
    });
}

module.exports = { syncSingleChannel, runBulkSync };

