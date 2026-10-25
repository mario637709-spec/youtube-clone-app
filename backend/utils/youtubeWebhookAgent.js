const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dbFirestore = require('./dbFirestore');
const { bucket, isRealFirebase } = require('../config/firebase');
const aiBrain = require('../aiBrain');
const getPublicBaseUrl = require('./publicBaseUrl');
const { getChannelByChannelId } = require('./channelRegistry');

/**
 * Subscribes to the WebSub Hub for a specific channel.
 * @param {string} channelId YouTube channel ID to subscribe to
 */
const subscribeChannel = async (channelId) => {
  try {
    const hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
    const callbackUrl = process.env.WEB_CALLBACK_URL || `${getPublicBaseUrl()}/api/webhooks/youtube`;
    const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

    console.log(`[Webhook Agent] Subscribing to channel: ${channelId} at Hub...`);

    const params = new URLSearchParams();
    params.append('hub.callback', callbackUrl);
    params.append('hub.topic', topicUrl);
    params.append('hub.mode', 'subscribe');
    params.append('hub.verify', 'async');

    const res = await axios.post(hubUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log(`[Webhook Agent] WebSub Hub subscription request submitted for ${channelId}. Response Status: ${res.status}`);
    return true;
  } catch (err) {
    console.error(`[Webhook Agent] Failed to subscribe channel ${channelId}:`, err.message);
    return false;
  }
};

/**
 * Periodically processes pending YouTube WebSub notifications.
 */
const processPendingNotifications = async () => {
  try {
    // 1. Fetch pending notifications from database (bypasses direct Mongoose/MongoDB)
    const pendingList = await dbFirestore.getPendingNotifications(5);
    if (!pendingList || pendingList.length === 0) {
      return;
    }

    console.log(`[Webhook Agent] Processing ${pendingList.length} pending video notifications...`);

    for (const notification of pendingList) {
      const { videoId, channelId, title } = notification;

      try {
        // Check if video is already processed/exists in main videos database
        const existingVideo = await dbFirestore.getVideoById(videoId);
        if (existingVideo) {
          console.log(`[Webhook Agent] Video ${videoId} already exists in main database. Marking notification processed.`);
          await dbFirestore.updateNotification(videoId, {
            status: 'Processed',
            processedAt: new Date().toISOString()
          });
          continue;
        }

        // 2. Fetch High-Quality YouTube Thumbnail (maxresdefault.jpg ~15KB is pre-compressed by YouTube)
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        console.log(`[Webhook Agent] Fetching thumbnail: ${thumbnailUrl}`);
        
        const response = await axios.get(thumbnailUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');

        let finalThumbnailUrl = '';

        // 3. Upload to Firebase Storage or save to Local Fallback Folder
        if (isRealFirebase && bucket) {
          try {
            console.log(`[Webhook Agent] Uploading thumbnail to Firebase Storage: thumbnails/${videoId}.jpg`);
            const file = bucket.file(`thumbnails/${videoId}.jpg`);
            await file.save(imageBuffer, {
              metadata: {
                contentType: 'image/jpeg'
              }
            });
            try {
              await file.makePublic();
              finalThumbnailUrl = `https://storage.googleapis.com/${bucket.name}/thumbnails/${videoId}.jpg`;
            } catch (pubErr) {
              // Fallback to signature link
              const [url] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
              finalThumbnailUrl = url;
            }
          } catch (firebaseErr) {
            console.warn(`[Webhook Agent] Firebase storage upload failed. Falling back to local thumbnail storage. Error:`, firebaseErr.message);
            // Save locally in images folder
            const imagesDir = path.join(__dirname, '../..', 'images');
            if (!fs.existsSync(imagesDir)) {
              fs.mkdirSync(imagesDir, { recursive: true });
            }
            const localPath = path.join(imagesDir, `${videoId}_thumbnail.jpg`);
            fs.writeFileSync(localPath, imageBuffer);
            finalThumbnailUrl = `${getPublicBaseUrl()}/images/${videoId}_thumbnail.jpg`;
            console.log(`[Webhook Agent] Saved thumbnail locally (fallback): ${localPath}`);
          }
        } else {
          // Save locally in images folder
          const imagesDir = path.join(__dirname, '../..', 'images');
          if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
          }
          const localPath = path.join(imagesDir, `${videoId}_thumbnail.jpg`);
          fs.writeFileSync(localPath, imageBuffer);
          finalThumbnailUrl = `${getPublicBaseUrl()}/images/${videoId}_thumbnail.jpg`;
          console.log(`[Webhook Agent] Saved thumbnail locally: ${localPath}`);
        }

        // 4. Enrich metadata using Groq AI (via AIBrain)
        let enriched = null;
        try {
          enriched = await aiBrain.enrichVideo(title, 'Watch this newly uploaded channel video!');
        } catch (enrichErr) {
          console.warn(`[Webhook Agent] Metadata enrichment failed, using default properties.`, enrichErr.message);
        }

        const finalDescription = enriched ? enriched.description : `Watch this new upload on our YouTube Clone!`;
        const finalCategory = enriched ? enriched.category : 'General';
        const finalTags = enriched ? enriched.tags : ['new', 'realtime', 'websub'];

        const channelMeta = getChannelByChannelId(channelId);

        // 5. Index the video document in the DB
        const newVideo = {
          id: videoId,
          youtube_id: videoId,
          title: title,
          description: finalDescription,
          category: channelMeta ? channelMeta.category : finalCategory,
          tags: channelMeta
            ? [channelMeta.category.toLowerCase(), 'youtube', channelMeta.handle, 'websub']
            : finalTags,
          visibility: 'public',
          uploader: {
            id: channelId,
            username: channelMeta ? channelMeta.handle : `channel_${channelId.substring(0, 8)}`,
            channelName: channelMeta ? channelMeta.name : `YouTube Channel (${channelId.substring(0, 6)})`,
            avatar: channelMeta
              ? `https://ui-avatars.com/api/?name=${encodeURIComponent(channelMeta.name)}&background=ff0000&color=fff`
              : `https://ui-avatars.com/api/?name=${encodeURIComponent(channelId)}&background=ff0000&color=fff`
          },
          views: 0,
          likes: 0,
          dislikes: 0,
          duration: '5:00', // Webhook XML does not specify duration, using default placeholder
          isShort: false,
          thumbnail: finalThumbnailUrl,
          videoUrl: `${getPublicBaseUrl()}/api/videos/stream/${videoId}`,
          storageLocation: 'YouTube',
          status: 'Live',
          createdAt: new Date().toISOString()
        };

        await dbFirestore.createVideo(videoId, newVideo);
        console.log(`[Webhook Agent] âœ… Successfully indexed video in main DB: "${title}" [${videoId}]`);

        // 6. Update notification status to 'Processed'
        await dbFirestore.updateNotification(videoId, {
          status: 'Processed',
          processedAt: new Date().toISOString()
        });

      } catch (innerErr) {
        console.error(`[Webhook Agent] Error processing notification for video ${videoId}:`, innerErr.message);
        await dbFirestore.updateNotification(videoId, {
          status: 'Failed',
          errorDetails: innerErr.message
        });
      }
    }

  } catch (err) {
    console.error('[Webhook Agent] Error in background polling processor:', err.message);
  }
};

module.exports = {
  subscribeChannel,
  processPendingNotifications
};

