const fs = require('fs');
const path = require('path');
const { db, bucket, isRealFirebase } = require('../config/firebase');
const { readDb } = require('./dbJson');

const VIDEOS_DIR = path.join(__dirname, '../../videos');
const IMAGES_DIR = path.join(__dirname, '../../images');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const runMigration = async () => {
  console.log('--- STARTING FIREBASE MIGRATION ---');
  if (!isRealFirebase) {
    console.error('Error: Firebase is not initialized. Please verify firebaseServiceAccount.json.');
    process.exit(1);
  }

  let localData;
  try {
    localData = readDb();
  } catch (err) {
    console.error('Failed to read local database:', err.message);
    process.exit(1);
  }

  const videos = Object.values(localData.videos || {});
  console.log(`Found ${videos.length} videos in local db.json to migrate.`);

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const indexStr = `[${i + 1}/${videos.length}]`;
    console.log(`\n${indexStr} Processing video: "${video.title}" (ID: ${video.id})`);

    try {
      // 1. Check if already exists in Firestore
      const docRef = db.collection('videos').doc(video.id);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        console.log(`-> Already exists in Firestore. Skipping upload.`);
        skipCount++;
        continue;
      }

      // 2. Upload Video File
      const videoFilename = video.filename || `${video.id}_video.mp4`;
      const localVideoPath = path.join(VIDEOS_DIR, videoFilename);

      if (!fs.existsSync(localVideoPath)) {
        console.error(`-> Local video file not found at: ${localVideoPath}. Skipping.`);
        failCount++;
        continue;
      }

      console.log(`-> Uploading video file to Cloud Storage...`);
      const storageVideoPath = `videos/${video.id}_${videoFilename.replace(/\s+/g, '_')}`;
      
      await bucket.upload(localVideoPath, {
        destination: storageVideoPath,
        metadata: {
          contentType: 'video/mp4'
        }
      });

      const [videoUrl] = await bucket.file(storageVideoPath).getSignedUrl({
        action: 'read',
        expires: '03-09-2491'
      });
      console.log(`-> Video uploaded. Signed URL obtained.`);

      // 3. Upload Thumbnail File
      let thumbnailUrl = video.thumbnail;
      if (video.thumbnail && video.thumbnail.includes('/images/')) {
        try {
          const urlParts = video.thumbnail.split('/images/');
          const thumbFilename = decodeURIComponent(urlParts[urlParts.length - 1]);
          const localThumbPath = path.join(IMAGES_DIR, thumbFilename);

          if (fs.existsSync(localThumbPath)) {
            console.log(`-> Uploading thumbnail image to Cloud Storage...`);
            const storageThumbPath = `thumbnails/${video.id}_${thumbFilename.replace(/\s+/g, '_')}`;
            
            await bucket.upload(localThumbPath, {
              destination: storageThumbPath,
              metadata: {
                contentType: 'image/jpeg'
              }
            });

            const [signedThumbUrl] = await bucket.file(storageThumbPath).getSignedUrl({
              action: 'read',
              expires: '03-09-2491'
            });
            thumbnailUrl = signedThumbUrl;
            console.log(`-> Thumbnail uploaded. Signed URL obtained.`);
          }
        } catch (thumbErr) {
          console.warn(`-> Failed to upload thumbnail: ${thumbErr.message}. Using fallback.`);
        }
      }

      // 4. Create Firestore Document
      const firestoreData = {
        ...video,
        videoUrl,
        thumbnail: thumbnailUrl,
        updatedAt: new Date().toISOString()
      };
      
      // Remove local filename property to keep Firestore clean
      delete firestoreData.filename;

      await docRef.set(firestoreData);
      console.log(`-> Firestore document created successfully!`);
      successCount++;

      // Pause briefly between uploads to prevent network throttling
      await sleep(500);

    } catch (err) {
      console.error(`-> Failed to process video ${video.id}:`, err.message);
      failCount++;
    }
  }

  console.log('\n--- MIGRATION RUN COMPLETE ---');
  console.log(`Successfully Migrated: ${successCount}`);
  console.log(`Already Exist (Skipped): ${skipCount}`);
  console.log(`Failed: ${failCount}`);
  console.log('------------------------------');
  process.exit(0);
};

runMigration();
