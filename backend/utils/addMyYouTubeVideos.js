/**
 * addMyYouTubeVideos.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * âœ… YE SCRIPT KYA KARTA HAI:
 *    Apni YouTube pe uploaded videos ko DB mein register karta hai
 *    taaki wo teri website pe dikhe aur play ho sake.
 *
 * âœ… BANDWIDTH:
 *    Video YouTube CDN se stream hoti hai â€” teri server bandwidth
 *    BILKUL USE NAHI HOGI. 80 dost ek saath dekhe â€” koi problem nahi.
 *
 * âœ… PROCESS:
 *    Koi yt-dlp, koi download, koi heavy process NAHI.
 *    Client ka browser khud signature decrypt karta hai (VideoPlayer.tsx
 *    mein innertube/decipher pehle se bana hua hai).
 *
 * ðŸ“ USAGE:
 *    1. Neeche MY_YOUTUBE_VIDEOS array mein apni videos add karo
 *    2. Terminal mein run karo:
 *       cd backend && node utils/addMyYouTubeVideos.js
 *
 * ðŸŽ¯ VIDEO ID KAISE MILEGA:
 *    YouTube Studio â†’ apni video â†’ URL mein ?v= ke baad wala 11 char ID
 *    Example: https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *                                                ^^^^^^^^^^^ = VIDEO ID
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

require('dotenv').config();
const crypto = require('crypto');
const dbFirestore = require('./dbFirestore');

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸŽ¬ APNI VIDEOS YAHAN ADD KARO â€” SIRF YT VIDEO ID CHAHIYE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const MY_YOUTUBE_VIDEOS = [
  {
    youtubeId: 'REPLACE_WITH_YOUR_VIDEO_ID_1',   // â† YouTube Video ID (11 chars)
    title: 'Meri Pehli Video',                    // â† Title
    description: 'Is video ka description yahan likhho',
    category: 'General',                          // â† Category
    duration: '5:30',                             // â† Approximate duration (MM:SS)
    isShort: false,                               // â† true if it's a YouTube Short
    thumbnail: null,                              // â† null = YouTube ka default thumbnail
    uploaderName: 'Your Channel Name',            // â† Apna channel name
    uploaderId: 'your_channel_id',                // â† Optional, apna YT channel ID
  },
  {
    youtubeId: 'REPLACE_WITH_YOUR_VIDEO_ID_2',
    title: 'Doosri Video',
    description: 'Doosri video ka description',
    category: 'Tutorial',
    duration: '10:15',
    isShort: false,
    thumbnail: null,
    uploaderName: 'Your Channel Name',
    uploaderId: 'your_channel_id',
  },
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Aur videos add karte jao is format mein:
  // {
  //   youtubeId: 'XXXXXXXXXX',    â† 11-char YouTube video ID
  //   title: 'Video Title',
  //   description: 'Description',
  //   category: 'General',
  //   duration: '3:45',
  //   isShort: false,
  //   thumbnail: null,
  //   uploaderName: 'Channel Name',
  //   uploaderId: 'channel_id',
  // },
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UPLOADER INFO â€” Apna naam/avatar yahan set karo (optional)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const DEFAULT_UPLOADER = {
  id: 'my_channel',
  username: 'My Channel',
  channelName: 'My Channel',
  avatar: 'https://ui-avatars.com/api/?name=My+Channel&background=ff0000&color=fff',
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN SCRIPT â€” Mat chhedo isko
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const generateDbId = () =>
  crypto.randomBytes(8).toString('base64url').substring(0, 11).replace(/[^a-zA-Z0-9_-]/g, 'x');

const getThumbnail = (ytId) =>
  `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`;

const run = async () => {
  console.log('');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('ðŸš€  YouTube Videos â†’ Database Registrar');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`ðŸ“‹ Total videos to register: ${MY_YOUTUBE_VIDEOS.length}`);
  console.log('');

  // Validate entries
  const invalidEntries = MY_YOUTUBE_VIDEOS.filter(
    (v) => !v.youtubeId || v.youtubeId.length !== 11 || v.youtubeId.startsWith('REPLACE')
  );
  if (invalidEntries.length > 0) {
    console.error('âŒ ERROR: Kuch entries mein valid YouTube ID nahi hai!');
    console.error('   In entries ko fix karo:');
    invalidEntries.forEach((v, i) => {
      console.error(`   [${i}] youtubeId="${v.youtubeId}" title="${v.title}"`);
    });
    console.error('');
    console.error('   YouTube ID 11 characters ka hota hai jaise: dQw4w9WgXcQ');
    process.exit(1);
  }

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < MY_YOUTUBE_VIDEOS.length; i++) {
    const entry = MY_YOUTUBE_VIDEOS[i];
    const dbId = generateDbId();
    const thumbnail = entry.thumbnail || getThumbnail(entry.youtubeId);

    console.log(`[${i + 1}/${MY_YOUTUBE_VIDEOS.length}] Processing: "${entry.title}" (YT: ${entry.youtubeId})`);

    try {
      // Check if this youtube_id already exists to avoid duplicates
      const existing = await dbFirestore.getVideoById(entry.youtubeId).catch(() => null);
      if (existing) {
        console.log(`   âš ï¸  Skipping â€” already exists in DB (ID: ${existing.id})`);
        skipCount++;
        continue;
      }

      const videoData = {
        id: dbId,
        youtube_id: entry.youtubeId,                    // â† Core field for playback
        title: entry.title,
        description: entry.description || '',
        videoUrl: `https://www.youtube.com/watch?v=${entry.youtubeId}`,
        thumbnail,
        category: entry.category || 'General',
        tags: [entry.category || 'General'],
        views: 0,
        likes: 0,
        dislikes: 0,
        duration: entry.duration || '0:00',
        isShort: entry.isShort || false,
        status: 'Live',                                   // â† Already live on YT
        storageLocation: 'YouTube',                       // â† Key: server will proxy via YT
        localPath: null,
        gdriveId: null,
        uploadProgress: 100,
        uploadStatus: 'Live on YouTube',
        uploader: {
          id: entry.uploaderId || DEFAULT_UPLOADER.id,
          username: entry.uploaderName || DEFAULT_UPLOADER.username,
          channelName: entry.uploaderName || DEFAULT_UPLOADER.channelName,
          avatar: DEFAULT_UPLOADER.avatar,
        },
        createdAt: new Date().toISOString(),
      };

      await dbFirestore.createVideo(dbId, videoData);
      console.log(`   âœ… Registered! DB ID: ${dbId}`);
      successCount++;

    } catch (err) {
      console.error(`   âŒ Error: ${err.message}`);
      errorCount++;
    }
  }

  console.log('');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('ðŸ“Š RESULT SUMMARY');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`âœ… Successfully registered : ${successCount} videos`);
  console.log(`âš ï¸  Skipped (duplicate)    : ${skipCount} videos`);
  console.log(`âŒ Errors                  : ${errorCount} videos`);
  console.log('');
  if (successCount > 0) {
    console.log('ðŸŽ‰ Done! Apni website reload karo â€” videos homepage pe dikhenge.');
    console.log('   Video play karne pe YouTube CDN se stream hogi â€” teri bandwidth ZERO!');
  }
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script crash:', err);
    process.exit(1);
  });

