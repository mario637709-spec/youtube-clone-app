const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const dbFirestore = require('./dbFirestore');
const { uploadToS3 } = require('./s3');
const getPublicBaseUrl = require('./publicBaseUrl');

// Configure fluent-ffmpeg to use static binaries
ffmpeg.setFfmpegPath(ffmpegStatic);
const ffprobeStatic = require('ffprobe-static');
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Output folder for processed video qualities
const PROCESSED_DIR = path.join(__dirname, '../../videos/processed');
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Target resolutions for transcoding
const RESOLUTIONS = [
  { name: '360p', width: 640, height: 360, bitrate: '400k' },
  { name: '480p', width: 854, height: 480, bitrate: '800k' },
  { name: '720p', width: 1280, height: 720, bitrate: '1500k' },
  { name: '1080p', width: 1920, height: 1080, bitrate: '3000k' },
  { name: '4k', width: 3840, height: 2160, bitrate: '12000k' }
];

/**
 * Transcodes a video file into one specific quality
 */
const transcodeToQuality = (sourcePath, targetPath, resolution) => {
  return new Promise((resolve, reject) => {
    console.log(`[Transcoder] Starting transcoding to ${resolution.name} (${resolution.width}x${resolution.height}, ${resolution.bitrate})...`);
    
    ffmpeg(sourcePath)
      .output(targetPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(`${resolution.width}x${resolution.height}`)
      .videoBitrate(resolution.bitrate)
      .outputOptions([
        '-preset fast',      // Faster compression
        '-movflags +faststart' // Enable fast start for streaming
      ])
      .on('end', () => {
        console.log(`[Transcoder] Finished transcoding: ${resolution.name}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[Transcoder] Failed to transcode ${resolution.name}:`, err.message);
        reject(err);
      })
      .run();
  });
};

/**
 * Generate a thumbnail from the video at 5% timestamp
 */
const generateThumbnail = (sourcePath, filename, folder) => {
  return new Promise((resolve, reject) => {
    console.log(`[Transcoder] Generating thumbnail for ${filename}...`);
    
    ffmpeg(sourcePath)
      .screenshots({
        timestamps: ['5%'],
        filename: filename,
        folder: folder,
        size: '1280x720'
      })
      .on('end', () => {
        console.log(`[Transcoder] Thumbnail generated: ${filename}`);
        resolve(path.join(folder, filename));
      })
      .on('error', (err) => {
        console.error(`[Transcoder] Thumbnail generation failed:`, err.message);
        reject(err);
      });
  });
};

/**
 * Main transcoding orchestrator.
 * Processes video into multiple qualities, uploads to S3 if credentials exist,
 * and updates the video metadata in the database.
 */
const processVideoTranscoding = async (videoId, sourcePath, originalFilename) => {
  console.log(`[Transcoder] Starting processing pipeline for videoId: ${videoId}`);
  
  try {
    const videoCacheDir = path.join(PROCESSED_DIR, videoId);
    if (!fs.existsSync(videoCacheDir)) {
      fs.mkdirSync(videoCacheDir, { recursive: true });
    }

    // 1. Generate Thumbnail
    const thumbFilename = `${videoId}_thumbnail.jpg`;
    const imagesDir = path.join(__dirname, '../../images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    const localThumbPath = await generateThumbnail(sourcePath, thumbFilename, imagesDir);
    let finalThumbnailUrl = `${getPublicBaseUrl()}/images/${thumbFilename}`;

    // Upload thumbnail to S3 if bucket is configured
    if (process.env.S3_BUCKET) {
      try {
        const thumbBuffer = fs.readFileSync(localThumbPath);
        const s3ThumbUrl = await uploadToS3(thumbBuffer, 'image/jpeg', `thumbnails/${thumbFilename}`);
        finalThumbnailUrl = s3ThumbUrl;
        console.log(`[Transcoder] Uploaded thumbnail to S3: ${s3ThumbUrl}`);
        // Clean up local thumbnail
        fs.unlinkSync(localThumbPath);
      } catch (s3Err) {
        console.warn(`[Transcoder] S3 thumbnail upload failed. Using local fallback:`, s3Err.message);
      }
    }

    // 2. Transcode to each resolution
    const processedQualities = {};
    const localPaths = {};

    for (const res of RESOLUTIONS) {
      const resFilename = `${videoId}_${res.name}.mp4`;
      const resLocalPath = path.join(videoCacheDir, resFilename);

      try {
        // Transcode
        await transcodeToQuality(sourcePath, resLocalPath, res);

        let finalVideoUrl = `${getPublicBaseUrl()}/api/videos/stream/${videoId}?quality=${res.name}`;

        // Upload to S3 if configured
        if (process.env.S3_BUCKET) {
          try {
            console.log(`[Transcoder] Uploading ${res.name} to S3 bucket: ${process.env.S3_BUCKET}...`);
            const s3Url = await uploadToS3(fs.readFileSync(resLocalPath), 'video/mp4', `videos/${resFilename}`);
            finalVideoUrl = s3Url;
            console.log(`[Transcoder] Uploaded ${res.name} to S3 successfully: ${s3Url}`);
            
            // Clean up local file after uploading to S3
            fs.unlinkSync(resLocalPath);
          } catch (s3Err) {
            console.error(`[Transcoder] Failed S3 upload for ${res.name}, keeping local path.`, s3Err.message);
            // Fallback to local streaming
            localPaths[res.name] = resLocalPath;
          }
        } else {
          // Keep local path for local streaming
          localPaths[res.name] = resLocalPath;
        }

        processedQualities[res.name] = finalVideoUrl;
      } catch (transcodeErr) {
        console.error(`[Transcoder] Skipping quality ${res.name} due to failure.`, transcodeErr.message);
      }
    }

    // 3. Update video object in DB
    const updates = {
      thumbnail: finalThumbnailUrl,
      status: 'Live',
      qualities: processedQualities
    };

    // If we kept local files, store their paths so the stream route knows where to read them
    if (Object.keys(localPaths).length > 0) {
      updates.processedPaths = localPaths;
    }

    await dbFirestore.updateVideo(videoId, updates);
    console.log(`[Transcoder] Pipeline successfully finished for videoId: ${videoId}. Qualities:`, Object.keys(processedQualities));

  } catch (err) {
    console.error(`[Transcoder] Pipeline error for videoId ${videoId}:`, err.message);
    await dbFirestore.updateVideo(videoId, { status: 'Failed' });
  }
};

module.exports = {
  processVideoTranscoding,
  generateThumbnail
};
