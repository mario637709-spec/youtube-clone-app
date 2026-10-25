const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dbFirestore = require('../utils/dbFirestore');
const { isRealFirebase, bucket } = require('../config/firebase');
const cache = require('../utils/cache');
const { computeRelatedVideos, getStoredRelated, setStoredRelated, RECS_TTL_MS, MIN_RELATED } = require('../utils/relatedRecommender');
const getPublicBaseUrl = require('../utils/publicBaseUrl');
const {
  buildProfile,
  rankFeed,
  getFeedCache,
  setFeedCache,
} = require('../utils/recommendationEngine');

// Fallback: fetch video metadata straight from YouTube when the DB misses.
// (Firestore free quota can be exhausted + MongoDB may be unreachable â€”
//  playback must keep working regardless. Verified 2026-08.)
let ytdlCore = null;
const getYtdlCore = () => {
  if (!ytdlCore) {
    try { ytdlCore = require('@distube/ytdl-core'); } catch { ytdlCore = null; }
  }
  return ytdlCore;
};

const fetchYoutubeMetadataFallback = async (youtubeId, timeoutMs = 8000) => {
  const ytdl = getYtdlCore();
  if (!ytdl) return null;
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('YT metadata timeout')), timeoutMs));
  try {
    const info = await Promise.race([ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${youtubeId}`), timer]);
    const d = info.videoDetails;
    if (!d || !d.title) return null;
    return {
      id: youtubeId,
      youtube_id: youtubeId,
      title: d.title,
      description: (d.shortDescription || '').substring(0, 5000),
      videoUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      thumbnail: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
      category: 'YouTube',
      tags: (d.keywords || []).slice(0, 10),
      views: parseInt(d.viewCount, 10) || 0,
      likes: 0,
      dislikes: 0,
      duration: formatYtDuration(d.lengthSeconds),
      lengthSeconds: parseInt(d.lengthSeconds, 10) || 0,
      isShort: false,
      status: 'Live',
      storageLocation: 'YouTube',
      localPath: null,
      gdriveId: null,
      channel: d.author ? { name: d.author.name || d.author.user || '', avatar: '' } : undefined,
      _fromYoutubeFallback: true,
    };
  } catch {
    return null;
  }
};

const formatYtDuration = (sec) => {
  sec = parseInt(sec, 10) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};

// Configure the dedicated local server buffer folder (Desktop/server)
const SERVER_FOLDER_PATH = path.join(os.homedir(), 'Desktop', 'server');
if (!fs.existsSync(SERVER_FOLDER_PATH)) {
  fs.mkdirSync(SERVER_FOLDER_PATH, { recursive: true });
}

// Helper to prefetch YouTube stream URLs in the background to warm cache (Disabled to prevent EADDRINUSE, queue congestion and 1-minute playback delays)
const prefetchYoutubeVideos = (videosList) => {
  return; // Disabled: Only extract URLs when a user actively plays a video.
};

const videoMetadataCache = new Map();
const playerConfigCache = new Map();
const relatedVideosCache = new Map();
const recsCache = new Map();

const getFolderSize = (dirPath) => {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const stats = fs.statSync(path.join(dirPath, file));
    if (stats.isFile()) size += stats.size;
  }
  return size;
};

// Helper for recommendation scores
const calculateRecencyWeight = (createdAt) => {
  const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 1.0;
  if (days <= 7) return 0.8;
  if (days <= 30) return 0.5;
  if (days <= 90) return 0.3;
  return 0.1;
};

// 1. GET ALL VIDEOS (Home Recommendation / Search Endpoint)
exports.getVideos = async (req, res) => {
  try {
    const { category, search } = req.query;

    if (search) {
      return exports.searchVideosInternal(search, category, res);
    }

    const cacheKey = `videos_cat_${category || 'all'}`;
    let videos = cache.getCache(cacheKey);

    if (!videos) {
      if ((!category || category === 'All') && typeof dbFirestore.getLongVideos === 'function') {
        const longs = await dbFirestore.getLongVideos();
        videos = longs && longs.length > 0 ? longs : await dbFirestore.getVideos({ category });
      } else {
        videos = await dbFirestore.getVideos({ category });
      }
      // Short TTL: dbJson already keeps a 3s in-memory snapshot, so the
      // NodeCache layer must not hold a second 193k-object copy for 10
      // minutes (that tripled memory and GC-thrashed the event loop).
      cache.setCache(cacheKey, videos, 60);
    }

    // Filter out flagged videos unless queried by the uploader (simplified)
    videos = videos.filter(v => v.status !== 'Flagged');

    // Filter out local mock videos (only show YouTube, GDrive, and user uploaded Local videos)
    videos = videos.filter(v => v.storageLocation === 'YouTube' || v.storageLocation === 'GDrive' || v.storageLocation === 'Local');

    // Filter out vertical shorts and zero-duration files from the main homepage feed
    videos = videos.filter(v => {
      if (v.isShort === true) return false;
      
      const titleLower = (v.title || '').toLowerCase();
      const descLower = (v.description || '').toLowerCase();
      const tagsLower = (v.tags || []).map(t => typeof t === 'string' ? t.toLowerCase() : '');
      const hasShortsHashtag = titleLower.includes('#shorts') || titleLower.includes('#short') || descLower.includes('#shorts') || descLower.includes('#short') || tagsLower.some(t => t.includes('short'));
      
      const urlText = `${v.videoUrl || ''} ${v.youtube_id || ''} ${v.id || ''}`.toLowerCase();
      const hasShortsUrl = urlText.includes('/shorts/') || urlText.includes('/short/');

      if (hasShortsHashtag || hasShortsUrl) {
        return false; // Filter out, it's a Short!
      }

      // Hide zero-duration videos from the homepage to avoid showing broken duration timers
      const d = String(v.duration || '').trim().toLowerCase();
      const isZero = d === '0:00' || d === '00:00' || d === '00' || d === '0' || !v.duration;
      if (isZero) {
        return false;
      }

      return true;
    });

    // Rank using YouTube Algorithm formula:
    // Score = (Views * 0.4) + (Likes * 0.3) + (RecencyWeight * 0.3)
    videos.forEach(v => {
      const recency = calculateRecencyWeight(v.createdAt);
      const viewsScore = Math.min((v.views || 0) / 10000, 100) * 0.4;
      const likesScore = Math.min((v.likes || 0) / 100, 100) * 0.3;
      const recencyScore = recency * 30;
      v.algoScore = viewsScore + likesScore + recencyScore;
    });

    videos.sort((a, b) => b.algoScore - a.algoScore);

    let finalList = videos;

    // If user is logged in, perform personalization with the deterministic
    // recommendation engine (no LLM quota â€” instant category/tag matching).
    if (req.user && req.user.id) {
      const userId = req.user.id;
      const user = await dbFirestore.getUserById(userId);
      const profile = buildProfile(user || {});

      if (profile.hasSignals) {
        // Check cache first (2 minute cache window)
        const cacheKey = `${userId}_${category || 'all'}`;
        const cached = getFeedCache(cacheKey);
        if (cached) {
          finalList = cached;
        } else {
          finalList = rankFeed(videos, profile);
          setFeedCache(cacheKey, finalList, 120);
        }
      }
    }

    // Apply pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedVideos = finalList.slice(startIndex, endIndex);

    prefetchYoutubeVideos(paginatedVideos);
    res.json(paginatedVideos);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 1.5 GET SHORTS (Shorts Algorithm Feed)
exports.getShorts = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const shortsCacheKey = 'shorts_all';
    let videos = cache.getCache(shortsCacheKey);

    if (!videos) {
      if (typeof dbFirestore.getShortsVideos === 'function') {
        videos = await dbFirestore.getShortsVideos();
      } else {
        videos = await dbFirestore.getVideos();
      }
      
      // Filter only Shorts and remove Flagged
      videos = videos.filter(v => {
      if (v.status === 'Flagged') return false;
      if (v.isShort === true) return true;
      
      const titleLower = (v.title || '').toLowerCase();
      const descLower = (v.description || '').toLowerCase();
      const tagsLower = (v.tags || []).map(t => typeof t === 'string' ? t.toLowerCase() : '');
      const hasShortsHashtag = titleLower.includes('#shorts') || titleLower.includes('#short') || descLower.includes('#shorts') || descLower.includes('#short') || tagsLower.some(t => t.includes('short'));
      
      const urlText = `${v.videoUrl || ''} ${v.youtube_id || ''} ${v.id || ''}`.toLowerCase();
      const hasShortsUrl = urlText.includes('/shorts/') || urlText.includes('/short/');
      
      return hasShortsHashtag || hasShortsUrl;
    });

    // Filter out local mock videos
    videos = videos.filter(v => v.storageLocation === 'YouTube' || v.storageLocation === 'GDrive' || v.storageLocation === 'Local');

    // Rank Shorts using the Algorithm
    videos.forEach(v => {
      const recency = calculateRecencyWeight(v.createdAt);
      const viewsScore = Math.min((v.views || 0) / 10000, 100) * 0.4;
      const likesScore = Math.min((v.likes || 0) / 100, 100) * 0.3;
      const recencyScore = recency * 30;
      v.algoScore = viewsScore + likesScore + recencyScore;
    });

    videos.sort((a, b) => b.algoScore - a.algoScore);
    cache.setCache(shortsCacheKey, videos, 60);
    }

    // Paginate â€” the shorts list is huge (191k+), so only serialize
    // the requested page instead of a ~90MB JSON payload per request.
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = videos.slice(start, end);

    // Personalization for Shorts â€” deterministic engine (same as Home)
    if (req.user && req.user.id) {
      const userId = req.user.id;
      const user = await dbFirestore.getUserById(userId);
      const profile = buildProfile(user || {});

      if (profile.hasSignals) {
        const cacheKey = `shorts_${userId}`;
        const cached = getFeedCache(cacheKey);
        if (cached) {
          const cachedSlice = cached.slice(start, end);
          return res.json({ videos: cachedSlice, page, limit, total: cached.length, hasMore: end < cached.length });
        }

        const finalShorts = rankFeed(videos, profile);
        setFeedCache(cacheKey, finalShorts, 120);

        prefetchYoutubeVideos(finalShorts);
        const finalSlice = finalShorts.slice(start, end);
        return res.json({ videos: finalSlice, page, limit, total: finalShorts.length, hasMore: end < finalShorts.length });
      }
    }

    prefetchYoutubeVideos(paginated);
    res.json({ videos: paginated, page, limit, total: videos.length, hasMore: end < videos.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 2. GET VIDEO BY ID (Atomic view count increment + watch history logging)
// 2. GET VIDEO BY ID (Atomic view count increment + watch history logging)
exports.getVideoById = async (req, res) => {
  try {
    const videoId = req.params.id;
    let video = null;
    let resolvedId = videoId; // The ID used for caching (may differ from req param)

    // Check video metadata cache first (by DB ID or YouTube ID)
    if (videoMetadataCache.has(videoId)) {
      const cached = videoMetadataCache.get(videoId);
      if (Date.now() < cached.expires) {
        video = cached.data;
      }
    }

    if (!video) {
      // 1. Try direct DB document ID lookup first
      video = await dbFirestore.getVideoById(videoId);

      // 2. If not found and looks like a YouTube ID (11 chars), search by youtube_id field
      if (!video && videoId && videoId.length === 11) {
        console.log(`[getVideoById] DB lookup miss â€” trying youtube_id field for: ${videoId}`);
        try {
          // Search all videos and find the one with matching youtube_id
          const allVideos = await dbFirestore.getVideos({});
          video = allVideos.find(v => v.youtube_id === videoId) || null;
          if (video) {
            console.log(`[getVideoById] Found via youtube_id match: DB ID = ${video.id}`);
            resolvedId = video.id; // Use the actual DB ID for cache key
          }
        } catch (ytErr) {
          console.error('[getVideoById] youtube_id fallback search failed:', ytErr.message);
        }
      }

      if (!video) {
        // 3. DB unavailable (Firestore quota / MongoDB unreachable)? Fall back
        //    to fetching metadata straight from YouTube so playback keeps working.
        if (videoId && videoId.length === 11) {
          console.log(`[getVideoById] DB miss â€” trying YouTube metadata fallback for: ${videoId}`);
          video = await fetchYoutubeMetadataFallback(videoId);
          if (video) {
            console.log(`[getVideoById] âœ… Got metadata from YouTube fallback: ${video.title}`);
            resolvedId = videoId;
          }
        }
      }

      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
    }

    // Real-time views increment in memory
    const newViews = (video.views || 0) + 1;
    video.views = newViews;

    // Cache updated document (1 hour TTL) â€” use resolvedId (actual DB ID, not the YouTube ID param)
    videoMetadataCache.set(resolvedId, {
      data: video,
      expires: Date.now() + 3600000
    });
    // Also cache by the original param so next lookup hits cache immediately
    if (resolvedId !== videoId) {
      videoMetadataCache.set(videoId, { data: video, expires: Date.now() + 3600000 });
    }

    // Views ab JSON me NAHI likhte (250MB stringify har view pe = loop block).
    // Source of truth: RTDB /counters (atomic increment, ms me hota hai).
    setImmediate(() => {
      try {
        const rtdb = require('../utils/rtdb');
        rtdb.bumpView(resolvedId);
      } catch (e) {
        console.error('[Views] RTDB bump failed:', e.message);
      }
    });

    // Logging watch history for logged-in users — bhi background me (response block nahi)
    if (req.user && req.user.id) {
      const __uid = req.user.id;
      setImmediate(async () => {
      try {
        const user = await dbFirestore.getUserById(__uid);
        if (user) {
          let history = user.watchHistory || [];
          // Move this video to top of history and deduplicate
          history = history.filter(id => id !== videoId);
          history.unshift(videoId);
          if (history.length > 30) history = history.slice(0, 30);
          
          await dbFirestore.updateUser(__uid, { watchHistory: history });

          // Clear recommendations cache for this user since history changed
          const userId = __uid;
          for (const key of recsCache.keys()) {
            if (key.startsWith(userId) || key === `shorts_${userId}`) {
              recsCache.delete(key);
            }
          }
          // Also clear the deterministic engine feed cache (per-user, all categories)
          cache.deleteCache(`feed_u_${userId}_all`);
          cache.deleteCache(`feed_${userId}_all`);
        }
      } catch (historyErr) {
        console.error('[Algorithm] Error logging watch history:', historyErr.message);
      }
      });
    }

    res.json(video);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 3. GET RELATED VIDEOS (Matching category/tags)
exports.getRelatedVideos = async (req, res) => {
  try {
    const videoId = req.params.id;
    const forceRefresh = req.query.refresh === '1';

    // Check related videos cache first (5 minutes TTL)
    if (!forceRefresh && relatedVideosCache.has(videoId)) {
      const cached = relatedVideosCache.get(videoId);
      if (Date.now() < cached.expires) {
        return res.json(cached.data);
      }
    }

    // Get target video (try to hit our fast metadata cache)
    let targetVideo = null;
    if (videoMetadataCache.has(videoId)) {
      const cached = videoMetadataCache.get(videoId);
      if (Date.now() < cached.expires) {
        targetVideo = cached.data;
      }
    }
    if (!targetVideo) {
      targetVideo = await dbFirestore.getVideoById(videoId);
    }
    if (!targetVideo) {
      return res.status(404).json({ message: 'Video not found' });
    }

    let allVideos = await dbFirestore.getVideos();
    allVideos = allVideos.filter(v => v.id !== targetVideo.id && v.status !== 'Flagged');

    // Filter out local mock videos
    allVideos = allVideos.filter(v => v.storageLocation === 'YouTube' || v.storageLocation === 'GDrive' || v.storageLocation === 'Local');

    // 2026-08-13: DB-persisted YouTube-style "Up Next" recommendations.
    // Stored per-video in MongoDB (recommendations collection) + db.json
    // fallback; recomputed only when stale (6h) or too sparse (<4).
    let related = null;
    if (!forceRefresh) {
      const stored = await getStoredRelated(videoId);
      if (stored && stored.related && stored.related.length >= MIN_RELATED &&
          Date.now() - stored.computedAt < RECS_TTL_MS) {
        related = stored.related;
      }
    }

    if (!related) {
      related = computeRelatedVideos(targetVideo, allVideos);
      if (related && related.length) {
        await setStoredRelated(videoId, related);
      }
    }

    // Cache the result for 5 minutes (only when non-empty so tiny
    // catalogs don't poison the cache with a permanent empty list)
    if (related && related.length) {
      relatedVideosCache.set(videoId, {
        data: related,
        expires: Date.now() + 300000
      });
    }

    prefetchYoutubeVideos(related || []);
    res.json(related || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Search Match scoring internal method
exports.searchVideosInternal = async (query, category, res) => {
  try {
    let videos = await dbFirestore.getVideos({ category });
    videos = videos.filter(v => v.status !== 'Flagged');

    // Filter out local mock videos
    videos = videos.filter(v => v.storageLocation === 'YouTube' || v.storageLocation === 'GDrive' || v.storageLocation === 'Local');

    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) {
      prefetchYoutubeVideos(videos);
      return res.json(videos);
    }

    videos.forEach(v => {
      let score = 0;
      const titleLower = v.title.toLowerCase();
      const descLower = (v.description || '').toLowerCase();
      
      if (titleLower.includes(query.toLowerCase())) score += 100;

      tokens.forEach(token => {
        if (titleLower.includes(token)) score += 25;
        if (v.category.toLowerCase().includes(token)) score += 15;
        if (v.tags && v.tags.some(tag => tag.toLowerCase().includes(token))) score += 10;
        if (descLower.includes(token)) score += 5;
      });

      score += Math.min((v.views || 0) / 50000, 10);
      v.searchScore = score;
    });

    const filtered = videos
      .filter(v => v.searchScore > 0)
      .sort((a, b) => b.searchScore - a.searchScore);

    prefetchYoutubeVideos(filtered);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 4. UPLOAD VIDEO API (Handles file binary upload, safety validation, ID generation, and indexing)
exports.uploadVideo = async (req, res) => {
  try {
    const { title, description, category, duration } = req.body;
    
    // File retrieval
    const videoFile = req.files && req.files.video ? req.files.video[0] : null;
    const thumbnailFile = req.files && req.files.thumbnail ? req.files.thumbnail[0] : null;

    if (!videoFile) {
      return res.status(400).json({ message: 'Video file is required' });
    }

    // 1. Safety & Format checks (Validation Pipeline)
    if (!videoFile.mimetype.startsWith('video/')) {
      return res.status(400).json({ message: 'Only video files are allowed' });
    }

    // Scan for inappropriate terms (Moderation check)
    const prohibitedWords = ['scam', 'spam', 'hack', 'virus', 'illegal'];
    const textToScan = `${title} ${description} ${category}`.toLowerCase();
    const isViolated = prohibitedWords.some(word => textToScan.includes(word));
    const status = isViolated ? 'Flagged' : 'Approved';

    // 2. Generate unique 11-char YouTube ID
    const videoId = crypto.randomBytes(8).toString('base64url').substring(0, 11).replace(/[^a-zA-Z0-9_-]/g, 'x');

    let videoUrl = '';
    let thumbnailUrl = '';

    // 3. Upload handler - (Hybrid Queue Architecture: Check local capacity first)
    const currentFolderSize = getFolderSize(SERVER_FOLDER_PATH);
    const incomingFileSize = videoFile.size; // Using .size for disk storage
    const MAX_LOCAL_QUEUE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

    let localVideoPath = null;
    let gdriveId = null;
    let storageLocation = 'Local';

    if ((currentFolderSize + incomingFileSize) > MAX_LOCAL_QUEUE_BYTES) {
      // OVERFLOW TO GOOGLE DRIVE
      console.log(`[Upload] Local capacity full (Size: ${(currentFolderSize / 1e9).toFixed(2)}GB / 10GB). Routing to Google Drive...`);
      const gdriveApi = require('../utils/gdriveApi');
      const videoFilename = `${videoId}_${videoFile.originalname.replace(/\s+/g, '_')}`;
      gdriveId = await gdriveApi.uploadToDrive(videoFile.path, videoFilename, videoFile.mimetype);
      
      // Cleanup the temp file created by multer
      if (fs.existsSync(videoFile.path)) {
        fs.unlinkSync(videoFile.path);
      }
      
      storageLocation = 'GDrive';
    } else {
      // SAVE LOCALLY IN DESKTOP/SERVER
      console.log(`[Upload] Saving locally. Current Size: ${((currentFolderSize + incomingFileSize) / 1e9).toFixed(2)}GB / 10GB`);
      const videoFilename = `${videoId}_${videoFile.originalname.replace(/\s+/g, '_')}`;
      localVideoPath = path.join(SERVER_FOLDER_PATH, videoFilename);
      
      // Move the temp file to the target local folder
      fs.renameSync(videoFile.path, localVideoPath);
    }
    
    // We don't have the final YouTube URL yet, so we set a placeholder processing URL
    videoUrl = `${getPublicBaseUrl()}/api/videos/stream/${videoId}`; 
    let finalStatus = 'Pending'; // Will be changed to 'Live' by youtubeWorker

    if (thumbnailFile) {
      const thumbFilename = `${videoId}_${thumbnailFile.originalname.replace(/\s+/g, '_')}`;
      const localThumbPath = path.join(__dirname, '../../images', thumbFilename);
      // Ensure images directory exists
      if (!fs.existsSync(path.dirname(localThumbPath))) {
        fs.mkdirSync(path.dirname(localThumbPath), { recursive: true });
      }
      fs.renameSync(thumbnailFile.path, localThumbPath);
      thumbnailUrl = `${getPublicBaseUrl()}/images/${encodeURIComponent(thumbFilename)}`;
    } else {
      // Generate thumbnail automatically from the uploaded video
      try {
        const { generateThumbnail } = require('../utils/videoTranscoder');
        const thumbFilename = `${videoId}_thumbnail.jpg`;
        const imagesDir = path.join(__dirname, '../../images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
        const videoSrcPath = localVideoPath || videoFile.path;
        await generateThumbnail(videoSrcPath, thumbFilename, imagesDir);
        thumbnailUrl = `${getPublicBaseUrl()}/images/${thumbFilename}`;
      } catch (thumbErr) {
        console.warn('[Upload Video] Failed to generate automatic thumbnail:', thumbErr.message);
        thumbnailUrl = `${getPublicBaseUrl()}/images/image.png_202606102130.jpeg`; // fallback
      }
    }

    // Uploader context (Remembering who uploaded the video)
    const uploaderId = req.user ? req.user.id || req.user._id : '1';
    const uploaderName = req.user ? req.user.username : 'User';
    const channelName = req.user ? req.user.channelName || req.user.username : 'User';
    const uploaderAvatar = req.user ? req.user.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(uploaderName)}`;

    // Build tags (Indexing keywords)
    const tags = [category || 'General'];
    title.split(/\s+/).forEach(word => {
      if (word.length > 4) tags.push(word.replace(/[^a-zA-Z]/g, ''));
    });

    const videoData = {
      id: videoId,
      title,
      description: description || `Upload details for ${title}.`,
      videoUrl,
      thumbnail: thumbnailUrl,
      category: category || 'General',
      tags: [...new Set(tags)].slice(0, 6),
      views: 0,
      likes: 0,
      dislikes: 0,
      duration: duration || '1:30',
      isShort: req.body.isShort === 'true',
      status: isViolated ? 'Flagged' : finalStatus,
      storageLocation: storageLocation,
      localPath: localVideoPath, // Will be null if in GDrive
      gdriveId: gdriveId, // Will be null if Local
      youtube_id: null, // Will be updated later
      uploadProgress: 0,
      uploadStatus: 'Queued for YouTube Upload...',
      uploader: {
        id: uploaderId,
        username: uploaderName,
        channelName: channelName,
        avatar: uploaderAvatar
      },
      createdAt: new Date().toISOString()
    };

    // Save in Firestore / JSON DB
    const saved = await dbFirestore.createVideo(videoId, videoData);

    // Trigger the background worker queue
    const youtubeWorker = require('../utils/youtubeWorker');
    youtubeWorker.triggerQueue();

    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 5. UPDATE VIDEO (likes toggling etc.)
exports.updateVideo = async (req, res) => {
  try {
    const video = await dbFirestore.getVideoById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    const updated = await dbFirestore.updateVideo(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 6. DELETE VIDEO
exports.deleteVideo = async (req, res) => {
  try {
    const deleted = await dbFirestore.deleteVideo(req.params.id);
    if (deleted) {
      return res.json({ message: 'Video removed' });
    }
    res.status(404).json({ message: 'Video not found' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 7. STREAM VIDEO (Raw MP4 Streaming - No Ads! Supports multiple resolutions)
exports.streamVideo = async (req, res) => {
  try {
    // [FIX] Short-circuit YouTube video IDs straight to the new streaming
    // orchestrator. The legacy DB lookup (Firestore) can hang for minutes
    // when Firestore/Mongo are unreachable, and pipeStream's old extraction
    // path also stalls â€” redirecting avoids both.
    if (req.params.id && /^[a-zA-Z0-9_-]{11}$/.test(req.params.id)) {
      const qp = [];
      if (req.query.quality) qp.push(`quality=${encodeURIComponent(req.query.quality)}`);
      if (req.query.type) qp.push(`type=${encodeURIComponent(req.query.type)}`);
      const qs = qp.length ? `?${qp.join('&')}` : '';
      return res.redirect(302, `/api/stream/auto/${encodeURIComponent(req.params.id)}${qs}`);
    }

    let video = await dbFirestore.getVideoById(req.params.id);
    const isYoutubeUrl = video && (video.youtube_id || (video.videoUrl && (video.videoUrl.includes('youtube.com') || video.videoUrl.includes('youtu.be'))));
    const isYoutube = isYoutubeUrl && video.storageLocation !== 'Local';

    // [STOP BY ADMIN - TEMPORARY]
    // Only stop the old YouTube streaming. Local video streaming must remain active!
    if (isYoutube) {
      return res.redirect(302, `/api/stream/auto/${encodeURIComponent(req.params.id)}`);
    }

    if (req.query.download === 'true') {
      const filename = video ? (video.title || 'video').replace(/[^a-zA-Z0-9]/g, '_') : req.params.id;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.mp4"`);
    }

    if (!video) {
      // Fallback: If not in DB, but looks like an 11-char YouTube ID, just stream it directly!
      if (req.params.id && req.params.id.length === 11) {
        return res.redirect(302, `/api/stream/auto/${encodeURIComponent(req.params.id)}`);
      }
      return res.status(404).send('Video not found');
    }

    const targetQuality = req.query.quality;

    // 1. If it is a YouTube video, stream directly from YouTube
    if (isYoutube) {
      const youtubeStreamAgent = require('../utils/youtubeStreamAgent');
      let ytId = video.youtube_id;
      if (!ytId && video.videoUrl) {
        try {
          const urlParams = new URLSearchParams(new URL(video.videoUrl).search);
          ytId = urlParams.get('v') || video.videoUrl.split('/').pop().split('?')[0];
        } catch (e) {
          ytId = video.videoUrl.split('/').pop().split('?')[0];
        }
      }
      if (ytId && ytId.length === 11) {
        console.log(`[Stream] Streaming video ${ytId} from YouTube directly...`);
        return await youtubeStreamAgent.pipeStream(ytId, req, res);
      }
    }

    // 2. If it's in Google Drive, stream it using our GDrive API
    if (video.storageLocation === 'GDrive' && video.gdriveId) {
      const gdriveApi = require('../utils/gdriveApi');
      const streamUrl = await gdriveApi.getStreamUrl(video.gdriveId);
      return res.redirect(streamUrl);
    }

    // 3. Local filesystem video
    if (video.storageLocation === 'Local' && video.localPath) {
      const fs = require('fs');
      if (!fs.existsSync(video.localPath)) {
        return res.status(404).send('Local video file not found on disk');
      }
      
      const stat = fs.statSync(video.localPath);
      const fileSize = stat.size;
      const range = req.headers.range;
      
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(video.localPath, {start, end});
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(video.localPath).pipe(res);
      }
      return;
    }

    return res.status(404).send('Video not found or streaming method not supported');

  } catch (error) {
    console.error('Stream API Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
};

// 7b. GET STREAM URL â€” Returns raw CDN URL as JSON (for direct video src assignment)
// This avoids the CORS opaqueredirect problem with /stream/:id redirect approach.
exports.getStreamUrl = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).json({ error: 'Service temporarily stopped by admin. Use new /api/stream endpoints.' });
  }
  try {
    const youtubeId = req.params.id;
    const quality = req.query.quality || 'auto';
    const poToken = req.query.poToken;
    const visitorData = req.query.visitorData;

    if (!youtubeId || youtubeId.length !== 11) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    // Extract client IP to generate IP-bound CDN URLs correctly
    const clientIp = req.headers['x-real-ip'] 
      || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress 
      || req.ip;

    const youtubeStreamAgent = require('../utils/youtubeStreamAgent');
    let rawUrl;
    try {
      rawUrl = await youtubeStreamAgent.getRawStreamUrl(youtubeId, quality, poToken, visitorData, false, clientIp);
    } catch (extractErr) {
      console.warn(`[StreamUrl] Direct extraction failed, trying Piped fallback: ${extractErr.message}`);
      try {
        rawUrl = await youtubeStreamAgent.getPipedStreamUrl(youtubeId, quality, false);
      } catch (pipedErr) {
        console.warn(`[StreamUrl] Piped fallback also failed: ${pipedErr.message}`);
      }
    }

    if (!rawUrl) {
      return res.status(500).json({ error: 'Could not resolve stream URL' });
    }

    console.log(`[StreamUrl] âœ… Returning raw CDN URL for ${youtubeId}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ url: rawUrl, youtubeId });

  } catch (error) {
    console.error('[StreamUrl] Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
};


const chunkDirBase = path.join(os.tmpdir(), 'video-chunks');
if (!fs.existsSync(chunkDirBase)) {
  fs.mkdirSync(chunkDirBase, { recursive: true });
}

exports.uploadChunk = async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    const chunkFile = req.file;

    if (!uploadId || chunkIndex === undefined || !chunkFile) {
      return res.status(400).json({ message: 'Missing chunk upload parameters' });
    }

    const chunkDir = path.join(chunkDirBase, uploadId);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
    fs.renameSync(chunkFile.path, chunkPath);

    console.log(`[Chunk Upload] Saved chunk ${chunkIndex}/${totalChunks - 1} for uploadId ${uploadId}`);
    res.json({ success: true, message: `Chunk ${chunkIndex} uploaded successfully` });
  } catch (err) {
    console.error('[Chunk Upload] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// 9. CHUNK UPLOAD COMPLETE ENDPOINT (Merges chunks and triggers FFmpeg + S3 + YouTube)
exports.uploadComplete = async (req, res) => {
  try {
    const { uploadId, title, description, category, visibility, duration, isShort } = req.body;
    const thumbnailFile = req.files && req.files.thumbnail ? req.files.thumbnail[0] : null;

    if (!uploadId || !title) {
      return res.status(400).json({ message: 'UploadId and Title are required' });
    }

    const chunkDir = path.join(chunkDirBase, uploadId);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ message: 'Chunks folder not found for this upload ID' });
    }

    const chunks = fs.readdirSync(chunkDir).sort((a, b) => {
      const idxA = parseInt(a.split('_')[1], 10);
      const idxB = parseInt(b.split('_')[1], 10);
      return idxA - idxB;
    });

    const videoId = crypto.randomBytes(8).toString('base64url').substring(0, 11).replace(/[^a-zA-Z0-9_-]/g, 'x');
    const finalFilename = `${videoId}_merged.mp4`;
    const tempMergedPath = path.join(os.tmpdir(), finalFilename);

    console.log(`[Upload Complete] Merging ${chunks.length} chunks into: ${tempMergedPath}`);
    fs.writeFileSync(tempMergedPath, '');
    for (const chunk of chunks) {
      const chunkPath = path.join(chunkDir, chunk);
      const chunkBuffer = fs.readFileSync(chunkPath);
      fs.appendFileSync(tempMergedPath, chunkBuffer);
      fs.unlinkSync(chunkPath);
    }

    // Remove chunk folder
    fs.rmdirSync(chunkDir);

    // Save locally or upload to Google Drive
    const currentFolderSize = getFolderSize(SERVER_FOLDER_PATH);
    const incomingFileSize = fs.statSync(tempMergedPath).size;
    const MAX_LOCAL_QUEUE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

    let localVideoPath = null;
    let gdriveId = null;
    let storageLocation = 'Local';

    if ((currentFolderSize + incomingFileSize) > MAX_LOCAL_QUEUE_BYTES) {
      console.log(`[Upload] Capacity full, routing raw file to Drive...`);
      const gdriveApi = require('../utils/gdriveApi');
      gdriveId = await gdriveApi.uploadToDrive(tempMergedPath, finalFilename, 'video/mp4');
      if (fs.existsSync(tempMergedPath)) {
        fs.unlinkSync(tempMergedPath);
      }
      storageLocation = 'GDrive';
    } else {
      localVideoPath = path.join(SERVER_FOLDER_PATH, finalFilename);
      fs.renameSync(tempMergedPath, localVideoPath);
    }

    // Default thumbnail
    let thumbnailUrl = '';
    if (thumbnailFile) {
      const thumbFilename = `${videoId}_${thumbnailFile.originalname.replace(/\s+/g, '_')}`;
      const localThumbPath = path.join(__dirname, '../../images', thumbFilename);
      if (!fs.existsSync(path.dirname(localThumbPath))) {
        fs.mkdirSync(path.dirname(localThumbPath), { recursive: true });
      }
      fs.renameSync(thumbnailFile.path, localThumbPath);
      thumbnailUrl = `${getPublicBaseUrl()}/images/${encodeURIComponent(thumbFilename)}`;
    } else {
      // Generate thumbnail automatically from the merged video
      try {
        const { generateThumbnail } = require('../utils/videoTranscoder');
        const thumbFilename = `${videoId}_thumbnail.jpg`;
        const imagesDir = path.join(__dirname, '../../images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
        const videoSrcPath = localVideoPath || tempMergedPath;
        await generateThumbnail(videoSrcPath, thumbFilename, imagesDir);
        thumbnailUrl = `${getPublicBaseUrl()}/images/${thumbFilename}`;
      } catch (thumbErr) {
        console.warn('[Upload Complete] Failed to generate automatic thumbnail:', thumbErr.message);
        thumbnailUrl = `${getPublicBaseUrl()}/images/image.png_202606102130.jpeg`; // fallback
      }
    }

    const uploaderId = req.user ? req.user.id || req.user._id : '1';
    const uploaderName = req.user ? req.user.username : 'User';
    const channelName = req.user ? req.user.channelName || req.user.username : 'User';
    const uploaderAvatar = req.user ? req.user.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(uploaderName)}`;

    const tags = [category || 'General'];
    title.split(/\s+/).forEach(word => {
      if (word.length > 4) tags.push(word.replace(/[^a-zA-Z]/g, ''));
    });

    const videoData = {
      id: videoId,
      title,
      description: description || '',
      videoUrl: `${getPublicBaseUrl()}/api/videos/stream/${videoId}`,
      thumbnail: thumbnailUrl,
      category: category || 'General',
      tags: [...new Set(tags)].slice(0, 6),
      views: 0,
      likes: 0,
      dislikes: 0,
      duration: duration || '0:00',
      uploader: {
        id: uploaderId,
        username: uploaderName,
        channelName: channelName,
        avatar: uploaderAvatar
      },
      isShort: isShort === 'true' || isShort === true,
      storageLocation,
      visibility: visibility || 'public',
      status: 'Pending',
      uploadProgress: 0,
      uploadStatus: 'Queued for YouTube Upload...',
      createdAt: new Date().toISOString()
    };

    if (localVideoPath) {
      videoData.localPath = localVideoPath;
    }
    if (gdriveId) {
      videoData.gdriveId = gdriveId;
    }

    // Save to Database
    const saved = await dbFirestore.createVideo(videoId, videoData);

    // Transcoding pipeline is now triggered sequentially inside youtubeWorker.js after YouTube upload completes to prevent file lock issues.

    // Trigger the YouTube uploader worker queue
    const youtubeWorker = require('../utils/youtubeWorker');
    youtubeWorker.triggerQueue();

    res.status(201).json(saved);
  } catch (err) {
    console.error('[Upload Complete] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// 9. DECRYPT SIGNATURE (Signature Offloading)
exports.decryptSignature = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).json({ error: 'Service temporarily stopped by admin. Use new /api/stream endpoints.' });
  }
  try {
    const { s, n, jsUrl } = req.body;
    if (!s && !n) {
      return res.status(400).json({ error: 'Missing signature (s) and n-code (n) parameters.' });
    }

    const youtubeStreamAgent = require('../utils/youtubeStreamAgent');
    const result = await youtubeStreamAgent.decryptSignature(s, n, jsUrl);
    
    res.json(result);
  } catch (error) {
    console.error('[DecryptSignature] Error:', error.message);
    res.status(500).json({ error: 'Failed to decrypt signature', details: error.message });
  }
};

// 10. GET DIRECT STREAM CONFIG (Zero-Bandwidth Direct CDN Streaming)
// Deprecated in favor of getYoutubeiPlayerConfig (Frontend Decryption)
exports.getDirectStreamConfig = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).json({ error: 'Service temporarily stopped by admin. Use new /api/stream endpoints.' });
  }
  res.status(500).json({ error: 'Endpoint deprecated. Use /api/videos/proxy/youtubei-player' });
};

// 11. GET YOUTUBE PLAYER CONFIG (Direct URL Pipeline â€” Primary Streaming Method)
exports.getYoutubePlayerConfig = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).json({ error: 'Service temporarily stopped by admin. Use new /api/stream endpoints.' });
  }
  try {
    const { videoId, poToken, visitorData } = req.query;
    if (!videoId) {
      return res.status(400).json({ error: 'Missing videoId parameter' });
    }

    // Check cache first
    const cacheKey = `${videoId}_${poToken || ''}`;
    if (playerConfigCache.has(cacheKey)) {
      const cached = playerConfigCache.get(cacheKey);
      if (Date.now() < cached.expires) {
        console.log(`[PlayerConfig] Serving cached player config for: ${videoId}`);
        return res.json(cached.config);
      }
    }

    const youtubedl = require('youtube-dl-exec');

    console.log(`[PlayerConfig] Fetching full player config for: ${videoId}`);
    
    const options = {
      dumpJson: true,
      noWarnings: true,
      forceIpv4: true,
      format: 'best[ext=mp4]/best',
      noCheckCertificates: true,
      noPlaylist: true,
    };

    if (poToken && visitorData) {
      options.extractorArgs = `youtube:player-client=web_embedded,android,web;po_token=web+${poToken};visitor_data=${visitorData}`;
      console.log(`[PlayerConfig] Running extraction with client PO Token & Visitor Data (web_embedded, android)`);
    } else {
      options.extractorArgs = `youtube:player-client=web_embedded,android`;
      console.log(`[PlayerConfig] Running extraction with default client (web_embedded, android)`);
    }

    const output = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, options);

    // Build streamingData from yt-dlp formats
    const formats = (output.formats || [])
      .filter(f => f.ext === 'mp4' && f.acodec !== 'none' && f.vcodec !== 'none')
      .map(f => {
        const nominalHeight = (f.width && f.height) ? Math.min(f.width, f.height) : (f.height || 0);
        return {
          itag: f.format_id,
          url: f.url || '',
          mimeType: `video/mp4; codecs="${f.vcodec || 'avc1'}, ${f.acodec || 'mp4a'}"`,
          qualityLabel: nominalHeight ? `${nominalHeight}p` : 'auto',
          width: f.width || 0,
          height: f.height || 0,
          fps: f.fps || 30,
          contentLength: String(f.filesize || f.filesize_approx || 0),
          signatureCipher: f.url ? '' : (f.fragment_base_url ? '' : ''),
          nominalHeight
        };
      });

    // Sort by nominal quality descending
    formats.sort((a, b) => b.nominalHeight - a.nominalHeight);

    const playerResponse = {
      streamingData: {
        formats: formats,
        adaptiveFormats: [],
        expiresInSeconds: '3600',
      },
      videoDetails: {
        videoId: output.id || videoId,
        title: output.title || '',
        lengthSeconds: String(Math.floor(output.duration || 0)),
        channelId: output.channel_id || '',
        shortDescription: output.description || '',
        thumbnail: {
          thumbnails: output.thumbnails || []
        },
        viewCount: String(output.view_count || 0),
        author: output.uploader || output.channel || '',
      },
      // yt-dlp already decrypts URLs, so no signature cipher needed
      _directUrls: true,
    };

    // Store in cache for 5.5 hours (19800000 ms) to minimize yt-dlp spawning
    playerConfigCache.set(cacheKey, {
      config: playerResponse,
      expires: Date.now() + 19800000
    });

    console.log(`[PlayerConfig] âœ… Returned ${formats.length} direct formats for ${videoId}`);
    res.json(playerResponse);
  } catch (error) {
    console.error('[PlayerConfig] Error fetching player config:', error.message);
    res.status(500).json({ error: 'Failed to fetch player config', details: error.message });
  }
};

// GET YOUTUBE INNER TUBE PLAYER CONFIG (True 0% Load Proxy)
exports.getYoutubeiPlayerConfig = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).json({ error: 'Service temporarily stopped by admin. Use new /api/stream endpoints.' });
  }
  try {
    const { videoId, poToken, visitorData } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: 'Missing videoId parameter' });
    }

    const cacheKey = `innertube_${videoId}_${poToken || ''}`;
    if (playerConfigCache.has(cacheKey)) {
      const cached = playerConfigCache.get(cacheKey);
      if (Date.now() < cached.expires) {
        console.log(`[youtubeiPlayer] Serving cached InnerTube config for: ${videoId}`);
        return res.json(cached.config);
      }
    }

    const youtubeiProxy = require('../utils/youtubeiProxy');
    console.log(`[youtubeiPlayer] Fetching player config for: ${videoId}`);
    
    const userAgent = req.headers['user-agent'] || '';
    const clientIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '';

    const playerResponse = await youtubeiProxy.fetchPlayerConfig(videoId, poToken, visitorData, userAgent, clientIp);

    if (!playerResponse || (playerResponse.playabilityStatus && playerResponse.playabilityStatus.status !== 'OK')) {
      const reason = playerResponse?.playabilityStatus?.reason || 'Video is unplayable';
      console.warn(`[youtubeiPlayer] InnerTube returned unplayable/error status for ${videoId}: ${reason}`);
      return res.status(403).json({ error: reason, details: playerResponse });
    }

    // Cache the successful configuration for 5.5 hours (19800000 ms)
    playerConfigCache.set(cacheKey, {
      config: playerResponse,
      expires: Date.now() + 19800000
    });

    console.log(`[youtubeiPlayer] âœ… Returned raw InnerTube player response for ${videoId}`);
    res.json(playerResponse);
  } catch (error) {
    console.error('[youtubeiPlayer] Error fetching InnerTube config:', error.message);
    res.status(500).json({ error: 'Failed to fetch InnerTube config', details: error.message });
  }
};

// GET YOUTUBE PLAYER JS (Proxy for CORS-free browser execution)
exports.getYoutubePlayerJs = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).json({ error: 'Service temporarily stopped by admin. Use new /api/stream endpoints.' });
  }
  try {
    const jsUrl = req.query.url;
    if (!jsUrl) {
      // Serve local vendor base.js modified to include inject.js at the end of the closure
      const vendorBaseJsPath = path.join(__dirname, '../node_modules/youtube-po-token-generator/vendor/base.js');
      const injectJsPath = path.join(__dirname, '../node_modules/youtube-po-token-generator/lib/inject.js');
      
      let baseContent = fs.readFileSync(vendorBaseJsPath, 'utf8');
      const injectContent = fs.readFileSync(injectJsPath, 'utf8');
      
      // Inject inject.js at the end of the IIFE closure of base.js so it has access to local variables (bOa, g)
      baseContent = baseContent.replace(/}\s*\)\(_yt_player\);\s*$/, (matched) => `;${injectContent};${matched}`);
      
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(baseContent);
    }

    const youtubeStreamAgent = require('../utils/youtubeStreamAgent');
    const jsContent = await youtubeStreamAgent.fetchPlayerJs(jsUrl);
    
    res.setHeader('Content-Type', 'application/javascript');
    // Enable CORS caching heavily for this static asset
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(jsContent);
  } catch (error) {
    console.error('[YoutubePlayerJs] Error proxying base.js:', error.message);
    res.status(500).json({ error: 'Failed to proxy base.js', details: error.message });
  }
};

// GET YOUTUBE EMBED PROXY
exports.getYoutubeEmbedProxy = async (req, res) => {
  // [STOP BY ADMIN - TEMPORARY]
  if (true) {
    return res.status(503).send('Service temporarily stopped by admin. Use new /api/stream endpoints.');
  }
  try {
    const { fetchVisitorData } = require('youtube-po-token-generator/lib/workflow');
    const visitorData = await fetchVisitorData();
    const indexPath = path.join(__dirname, '../node_modules/youtube-po-token-generator/vendor/index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Inject window.visitorData and onPoToken, and the script tag for player JS
    const injection = `
      <script>
        window.visitorData = ${JSON.stringify(visitorData)};
        window.onPoToken = function(poToken) {
          if (window.parent) {
            window.parent.postMessage({
              type: 'YOUTUBE_PO_TOKEN',
              poToken: poToken,
              visitorData: window.visitorData
            }, '*');
          }
        };
      </script>
      <script src="/api/videos/proxy/youtube-player-js"></script>
    `;

    // Insert injection right before </body> or </html>
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${injection}</body>`);
    } else if (html.includes('</html>')) {
      html = html.replace('</html>', `${injection}</html>`);
    } else {
      html = html + injection;
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('[EmbedProxy] Error:', error.message);
    res.status(500).send('Failed to load embed proxy');
  }
};

// NOTE: getYoutubePlayerJs is already defined above at line ~1435 (downloads fresh base.js from YouTube).
// That definition is the correct one â€” this duplicate (which served old vendor base.js) has been removed.



exports.corsProxy = async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('No url provided');
  
  try {
    const fetch = (await import('node-fetch')).default;
    const AbortController = globalThis.AbortController || (await import('node-fetch')).AbortController;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    // Build clean, browser-like headers instead of forwarding raw client headers
    // YouTube blocks requests that look like bot/proxy requests based on header fingerprinting
    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Accept': req.method === 'POST' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': req.method === 'POST' ? 'empty' : 'document',
      'Sec-Fetch-Mode': req.method === 'POST' ? 'cors' : 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'no-cache',
    };

    // Forward any custom YouTube, Google or standard content headers from the original request
    for (const key in req.headers) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.startsWith('x-youtube-') || 
        lowerKey.startsWith('x-goog-') || 
        lowerKey === 'content-type' || 
        lowerKey === 'authorization' ||
        lowerKey === 'range' ||
        lowerKey === 'user-agent' // ANDROID/ANDROID_VR client requests apna UA bhejte hain
      ) {
        proxyHeaders[key] = req.headers[key];
      }
    }

    // Set fallback headers if origin/referer are not present
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      if (!proxyHeaders['Origin']) proxyHeaders['Origin'] = 'https://www.youtube.com';
      if (!proxyHeaders['Referer']) proxyHeaders['Referer'] = 'https://www.youtube.com/';
    }

    let bodyData = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        bodyData = JSON.stringify(req.body);
      } else if (typeof req.body === 'string' && req.body.length > 0) {
        bodyData = req.body;
      }
    }
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: proxyHeaders,
      body: bodyData,
      signal: controller.signal,
      compress: true // auto decompress gzip/br
    });

    clearTimeout(timeout);
    
    const responseHeaders = Object.fromEntries(response.headers.entries());
    delete responseHeaders['content-encoding']; // node-fetch decompresses, so remove this
    delete responseHeaders['content-length'];  // length changes after decompression
    delete responseHeaders['transfer-encoding']; // handled by Express
    
    res.status(response.status);
    res.set(responseHeaders);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    
    response.body.pipe(res);
  } catch (err) {
    console.error('CORS proxy error:', err.message);
    if (err.name === 'AbortError') {
      res.status(504).send('Proxy timeout');
    } else {
      res.status(500).send('Proxy error: ' + err.message);
    }
  }
};


