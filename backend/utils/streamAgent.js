const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');

// Tell fluent-ffmpeg to use the static binary
ffmpeg.setFfmpegPath(ffmpegStatic);

const CACHE_DIR = path.join(__dirname, '../../cache/hls');
const getPublicBaseUrl = require('./publicBaseUrl');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Track active FFmpeg processes so we don't start multiple for the same video
const activeStreams = new Map();

/**
 * Gets or creates an HLS stream URL for a given YouTube video
 * @param {string} videoId Our database video ID
 * @param {string} youtubeId The actual YouTube ID
 * @returns {Promise<string>} The URL path to the .m3u8 playlist
 */
exports.getHlsUrl = async (videoId, youtubeId) => {
  const videoCacheDir = path.join(CACHE_DIR, videoId);
  const m3u8Path = path.join(videoCacheDir, 'index.m3u8');
  const streamUrl = `${getPublicBaseUrl()}/cache/hls/${videoId}/index.m3u8`;

  // 1. If it's already fully cached or currently being processed, return the URL
  if (fs.existsSync(m3u8Path)) {
    console.log(`[StreamAgent] Serving existing HLS cache for ${videoId}`);
    return streamUrl;
  }

  // 2. If an FFmpeg process is already starting up but hasn't created the m3u8 yet
  if (activeStreams.has(videoId)) {
    console.log(`[StreamAgent] Waiting for FFmpeg to initialize ${videoId}...`);
    // Wait until the m3u8 file is created by FFmpeg
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (fs.existsSync(m3u8Path)) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
    return streamUrl;
  }

  // 3. Start a new FFmpeg process to convert YouTube -> HLS
  console.log(`[StreamAgent] Starting FFmpeg HLS Conversion for ${videoId} (YouTube ID: ${youtubeId})`);
  activeStreams.set(videoId, true);

  if (!fs.existsSync(videoCacheDir)) {
    fs.mkdirSync(videoCacheDir, { recursive: true });
  }

  try {
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    
    // Instead of extracting the raw URL which causes 403 Forbidden in FFmpeg,
    // we use ytdl to download the stream and pipe it directly to FFmpeg!
    const ytdlStream = ytdl(youtubeUrl, { quality: 'highest', filter: 'audioandvideo' });

    return new Promise((resolve, reject) => {
      ffmpeg(ytdlStream)
        // Standard HLS output options
        .outputOptions([
          '-c:v copy',          // Copy video codec (no re-encoding, saves massive CPU)
          '-c:a copy',          // Copy audio codec
          '-hls_time 10',       // 10 second chunks
          '-hls_list_size 0',   // Keep all chunks in the playlist (0 = infinite)
          '-f hls'              // Output format is HLS
        ])
        .output(m3u8Path)
        .on('start', (commandLine) => {
          console.log(`[StreamAgent] FFmpeg started for ${videoId}`);
          
          // We don't wait for FFmpeg to finish! We resolve as soon as the m3u8 file is created.
          const checkInterval = setInterval(() => {
            if (fs.existsSync(m3u8Path)) {
              clearInterval(checkInterval);
              resolve(streamUrl);
            }
          }, 500);
        })
        .on('error', (err) => {
          console.error(`[StreamAgent] FFmpeg Error for ${videoId}:`, err);
          activeStreams.delete(videoId);
          reject(err);
        })
        .on('end', () => {
          console.log(`[StreamAgent] FFmpeg finished caching ${videoId}`);
          activeStreams.delete(videoId);
        })
        .run();
    });

  } catch (error) {
    activeStreams.delete(videoId);
    throw error;
  }
};
