const express = require('express');
const router = express.Router();
const dbFirestore = require('../utils/dbFirestore');

// 1. GET: WebSub Verification Endpoint (Google Hub sends challenge here)
router.get('/youtube', (req, res) => {
  const mode = req.query['hub.mode'];
  const topic = req.query['hub.topic'];
  const challenge = req.query['hub.challenge'];
  
  console.log(`[Webhook Verification] Mode: ${mode}, Topic: ${topic}`);

  if (mode && challenge && (mode === 'subscribe' || mode === 'unsubscribe')) {
    console.log(`[Webhook Verification] Echoing challenge: ${challenge}`);
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook Verification] Invalid verification request parameters');
  res.status(404).send('Not Found');
});

// 2. POST: YouTube XML Atom Feed Notification Endpoint
router.post('/youtube', async (req, res) => {
  // Respond immediately to Google Hub to avoid timeout retries (Google expects 2xx fast)
  res.status(202).send('Accepted');

  try {
    const rawBody = req.body;
    if (!rawBody || typeof rawBody !== 'string') {
      console.warn('[Webhook Notification] Empty or invalid request payload received');
      return;
    }

    // Parse XML using lightweight regex to avoid external dependency installations
    const videoIdMatch = rawBody.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || rawBody.match(/<id>yt:video:([^<]+)<\/id>/);
    const channelIdMatch = rawBody.match(/<yt:channelId>([^<]+)<\/yt:channelId>/) || rawBody.match(/<uri>https:\/\/www\.youtube\.com\/channel\/([^<]+)<\/uri>/);
    const titleMatch = rawBody.match(/<title>([^<]+)<\/title>/);

    const videoId = videoIdMatch ? videoIdMatch[1].trim() : null;
    const channelId = channelIdMatch ? channelIdMatch[1].trim() : null;
    const title = titleMatch ? titleMatch[1].trim() : null;

    if (!videoId || !channelId || !title) {
      console.log('[Webhook Notification] XML parsed elements are incomplete. Skipping. Raw matches:', { videoId, channelId, title });
      return;
    }

    console.log(`[Webhook Notification] Received video upload from YouTube: "${title}" [${videoId}]`);

    // Check if notification already exists in DB to prevent double inserts
    // We can do a quick check in db.json or Firestore by calling a helper
    // Or we can just let createNotification override or check it.
    // Let's check if the video metadata or notification already exists in the video DB:
    const existingVideo = await dbFirestore.getVideoById(videoId);
    if (existingVideo) {
      console.log(`[Webhook Notification] Video ID ${videoId} already exists in main database. Skipping.`);
      return;
    }

    // Save notification to DB in 'Pending' status
    await dbFirestore.createNotification(videoId, {
      channelId,
      title
    });

    console.log(`[Webhook Notification] Success: Logged pending notification for video ${videoId}`);

  } catch (err) {
    console.error('[Webhook Notification] Error handling push callback:', err.message);
  }
});

module.exports = router;
