const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dbFirestore = require('./dbFirestore');

const SOURCE_DIR = "C:\\Users\\Vishuu'Pc\\Desktop\\Videos\\insta neche";
const SERVER_FOLDER_PATH = path.join(os.homedir(), 'Desktop', 'server');

if (!fs.existsSync(SERVER_FOLDER_PATH)) {
  fs.mkdirSync(SERVER_FOLDER_PATH, { recursive: true });
}

const filesToUpload = [
  '2025-10-14_12-20-06_UTC.mp4',
  '2025-10-15_11-29-33_UTC.mp4'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const run = async () => {
  console.log("=================================================");
  console.log("🚀 INITIALIZING UPLOAD PERFORMANCE TEST");
  console.log("=================================================");

  const videosInfo = [];

  for (const filename of filesToUpload) {
    const srcPath = path.join(SOURCE_DIR, filename);
    if (!fs.existsSync(srcPath)) {
      console.error(`❌ Source file not found: ${srcPath}`);
      continue;
    }

    const videoId = crypto.randomBytes(8).toString('base64url').substring(0, 11).replace(/[^a-zA-Z0-9_-]/g, 'x');
    const destFilename = `${videoId}_${filename}`;
    const destPath = path.join(SERVER_FOLDER_PATH, destFilename);

    console.log(`\n🎥 Preparing Video: ${filename}`);
    console.log(`📦 Copying to Server Buffer...`);
    const copyStart = Date.now();
    fs.copyFileSync(srcPath, destPath);
    const copyEnd = Date.now();
    console.log(`✅ File copied in ${((copyEnd - copyStart) / 1000).toFixed(2)}s.`);

    const videoData = {
      id: videoId,
      title: filename.replace('.mp4', ''),
      description: `Automated upload performance test for file ${filename}.`,
      videoUrl: `http://localhost:5000/api/videos/stream/${videoId}`,
      thumbnail: `http://localhost:5000/images/image.png_202606102130.jpeg`,
      category: 'Sports',
      tags: ['performance', 'test', 'upload'],
      views: 0,
      likes: 0,
      dislikes: 0,
      duration: '0:22',
      uploader: {
        id: 'classy__vishuu',
        username: 'classy__vishuu',
        channelName: 'Biker Stunds',
        avatar: 'https://ui-avatars.com/api/?name=Biker+Stunds&background=ff0000&color=fff'
      },
      isShort: true,
      storageLocation: 'Local',
      status: 'Pending',
      localPath: destPath,
      youtube_id: null,
      createdAt: new Date().toISOString()
    };

    console.log(`💾 Inserting video metadata to Database (ID: ${videoId})...`);
    await dbFirestore.createVideo(videoId, videoData);
    console.log(`✅ Database entry created successfully!`);

    videosInfo.push({
      id: videoId,
      filename,
      startTime: Date.now(),
      completed: false
    });
  }

  console.log(`\n⚡ Triggering uploader queue in this test process...`);
  const youtubeWorker = require('./youtubeWorker');
  youtubeWorker.triggerQueue();

  console.log(`\n================================================-`);
  console.log(`⏳ MONITORING UPLOAD AND PROCESSING IN REAL-TIME...`);
  console.log(`================================================-`);

  let allDone = false;
  const timeoutMs = 15 * 60 * 1000; // 15 minutes max wait
  const startWait = Date.now();

  while (!allDone && (Date.now() - startWait < timeoutMs)) {
    allDone = true;
    for (const info of videosInfo) {
      if (info.completed) continue;
      
      allDone = false;
      const doc = await dbFirestore.getVideoById(info.id);
      
      if (!doc) {
        console.warn(`[Warning] Video ID ${info.id} not found in database!`);
        continue;
      }

      if (doc.status === 'Live') {
        const timeSec = (Date.now() - info.startTime) / 1000;
        console.log(`\n🎉 SUCCESS: "${info.filename}" is now LIVE!`);
        console.log(`- Database ID: ${doc.id}`);
        console.log(`- YouTube Video ID: ${doc.youtube_id}`);
        console.log(`- Thumbnail URL: ${doc.thumbnail}`);
        console.log(`- Time Taken: ${timeSec.toFixed(2)}s (${(timeSec / 60).toFixed(2)} mins)`);
        info.completed = true;
      } else if (doc.status === 'Failed') {
        const timeSec = (Date.now() - info.startTime) / 1000;
        console.error(`\n❌ FAILED: "${info.filename}" failed upload!`);
        console.error(`- Time Elapsed: ${timeSec.toFixed(2)}s`);
        info.completed = true;
      } else {
        const elapsedSec = (Date.now() - info.startTime) / 1000;
        console.log(`⏳ [${new Date().toLocaleTimeString()}] "${info.filename}" is still in status: ${doc.status} (Elapsed: ${elapsedSec.toFixed(0)}s)`);
      }
    }

    if (!allDone) {
      await sleep(5000);
    }
  }

  if (Date.now() - startWait >= timeoutMs) {
    console.error(`\n❌ TIMEOUT: Test execution exceeded max wait time of 15 minutes.`);
  }

  console.log(`\n=================================================`);
  console.log(`🏁 PERFORMANCE MONITORING COMPLETE`);
  console.log(`=================================================`);
};

run().then(() => process.exit(0)).catch(err => {
  console.error("Test monitor crashed:", err);
  process.exit(1);
});
