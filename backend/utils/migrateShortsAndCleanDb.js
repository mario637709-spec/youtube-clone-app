const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const ytdl = require('@distube/ytdl-core');

const dbPath = path.join(__dirname, '../data/db.json');
const ytdlpPath = path.join(__dirname, '../node_modules/youtube-dl-exec/bin/yt-dlp.exe');

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

const parseDurationToSeconds = (durationStr) => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
};

const formatSeconds = (durationSec) => {
  const m = Math.floor(durationSec / 60);
  const s = Math.floor(durationSec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const fetchSingleVideoScrapeFallback = async (videoId) => {
  const TIMEOUT = 1500;
  const pipedRequests = PIPED_INSTANCES.map(instance =>
    axios.get(`${instance}/streams/${videoId}`, { timeout: TIMEOUT })
      .then(res => {
        if (res.data && res.data.title) {
          return {
            durationSeconds: res.data.duration || 0,
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
        return {
          durationSeconds: res.data.lengthSeconds || 0,
        };
      }
      return Promise.reject(new Error('No title'));
    })
  );

  try {
    return await Promise.any([...pipedRequests, ...invidiousRequests]);
  } catch (e) {
    return null;
  }
};

const fetchWithYtdlCore = (videoId) => {
  return new Promise((resolve) => {
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        resolve(null);
      }
    }, 6000); // 6 seconds timeout
    
    ytdl.getInfo(videoId)
      .then(info => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        
        const durationSec = parseInt(info.videoDetails.lengthSeconds, 10) || 0;
        const formats = info.formats || [];
        const videoFormats = formats.filter(f => f.width && f.height);
        let isPortrait = false;
        let width = 0;
        let height = 0;
        if (videoFormats.length > 0) {
          width = videoFormats[0].width;
          height = videoFormats[0].height;
          isPortrait = width < height;
        }
        resolve({
          isPortrait,
          durationSec,
          width,
          height
        });
      })
      .catch(err => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
};

const checkVideoProperties = async (videoId) => {
  // Try ytdl-core first as it is super fast and doesn't suffer from pyinstaller unpack errors
  const ytdlResult = await fetchWithYtdlCore(videoId);
  if (ytdlResult) {
    return ytdlResult;
  }
  
  // Fallback to yt-dlp if ytdl-core fails
  return new Promise((resolve) => {
    if (!fs.existsSync(ytdlpPath)) {
      return resolve(null);
    }
    const cmd = `"${ytdlpPath}" --force-ipv4 --print "%(width)s,%(height)s,%(duration)s" --no-warnings https://www.youtube.com/watch?v=${videoId}`;
    exec(cmd, { timeout: 15000 }, (err, stdout) => {
      if (!stdout || stdout.trim() === '') return resolve(null);
      try {
        const parts = stdout.trim().split(',');
        const width = parseInt(parts[0], 10);
        const height = parseInt(parts[1], 10);
        const durationSec = Math.round(parseFloat(parts[2]) || 0);
        
        resolve({
          isPortrait: !isNaN(width) && !isNaN(height) && width < height,
          durationSec,
          width,
          height
        });
      } catch (e) {
        resolve(null);
      }
    });
  });
};

const runCleanup = async () => {
  if (!fs.existsSync(dbPath)) {
    console.error('db.json not found at:', dbPath);
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const videos = Object.values(db.videos || {});
  console.log(`[Cleanup] Scanning ${videos.length} videos from db.json...`);

  let modifiedCount = 0;
  const queryQueue = [];

  // Identify videos that need verification
  for (const video of videos) {
    if (video.storageLocation !== 'YouTube') continue; // Skip local/GDrive mock videos
    const text = `${video.title} ${video.description || ''}`.toLowerCase();
    const tags = video.tags || [];
    const hasShortsHashtag = text.includes('#shorts') || text.includes('#short') || tags.some(t => typeof t === 'string' && t.toLowerCase().includes('short'));
    const durationSec = parseDurationToSeconds(video.duration);
    
    // Check if the URL has short structures
    const urlText = `${video.videoUrl || ''} ${video.youtube_id || ''} ${video.id || ''}`.toLowerCase();
    const hasShortsUrl = urlText.includes('/shorts/') || urlText.includes('/short/');

    let isShort = video.isShort;
    
    // Rule 1: Hashtag or Shorts URL means it is 100% a short
    if ((hasShortsHashtag || hasShortsUrl) && !isShort) {
      video.isShort = true;
      video.duration = '0:00'; // hide timer for shorts
      modifiedCount++;
      console.log(`[Cleanup] Classified via hashtag/URL: "${video.title}" -> Short`);
      continue;
    }

    // Rule 2: If duration is 0:00 or short duration (< 180s) and not marked as short, verify
    const isZero = video.duration === '0:00' || video.duration === '00' || !video.duration;
    if (!video.isShort && (isZero || (durationSec > 0 && durationSec < 180))) {
      queryQueue.push(video);
    }
  }

  console.log(`[Cleanup] Queue contains ${queryQueue.length} candidate videos for aspect ratio & duration verification.`);

  // Process sequentially to avoid 429 rate limiting
  for (let i = 0; i < queryQueue.length; i++) {
    const video = queryQueue[i];
    console.log(`[Cleanup] [${i + 1}/${queryQueue.length}] Verifying: "${video.title}" [${video.youtube_id || video.id}]`);
    
    let result = null;
    
    // Try fast Piped/Invidious scraper first
    const scrapeResult = await fetchSingleVideoScrapeFallback(video.youtube_id || video.id);
    if (scrapeResult && scrapeResult.durationSeconds > 180) {
      // It is a long landscape video, skip yt-dlp!
      result = {
        isPortrait: false,
        durationSec: scrapeResult.durationSeconds,
        width: 1920,
        height: 1080
      };
    } else {
      // Fallback to sequential yt-dlp (to check aspect ratio) or if scrape failed
      result = await checkVideoProperties(video.youtube_id || video.id);
    }

    if (result) {
      if (result.isPortrait) {
        video.isShort = true;
        video.duration = '0:00';
        console.log(`[Cleanup] 📱 Classified as Short (${result.width}x${result.height}): "${video.title}"`);
      } else {
        video.isShort = false;
        if (result.durationSec > 0) {
          video.duration = formatSeconds(result.durationSec);
        }
        console.log(`[Cleanup] 🖥️ Corrected long video duration (${video.duration}): "${video.title}"`);
      }
      modifiedCount++;
    } else {
      console.log(`[Cleanup] ❌ Failed to verify video: "${video.title}"`);
    }

    // Save progressive changes
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    
    // 800ms gap to respect API rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[Cleanup] 🎉 Completed! Modified/Corrected ${modifiedCount} videos.`);
};

runCleanup();
