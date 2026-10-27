// Configure public DNS servers and prefer IPv4 to avoid local ISP DNS resolution failures and IPv6 connection timeouts
const dns = require('dns');
if (!process.env.RENDER && !process.env.VERCEL) {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    if (dns.setDefaultResultOrder) {
      dns.setDefaultResultOrder('ipv4first');
    }
  } catch (e) {}
}
const fs = require('fs');
const path = require('path');
const customTempDir = path.join(__dirname, 'tmp', 'yt-dlp-temp');
if (!fs.existsSync(customTempDir)) {
  fs.mkdirSync(customTempDir, { recursive: true });
}
process.env.TEMP = customTempDir;
process.env.TMP = customTempDir;
process.env.TMPDIR = customTempDir;

process.env.YTDL_NO_UPDATE = 'true';

// Prevent process crashes on network/stream disconnects
process.on('uncaughtException', (err) => {
  console.error('[Process] ⚠️ Uncaught Exception intercepted:', err.message, err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] ⚠️ Unhandled Rejection intercepted at:', promise, 'reason:', reason);
});



const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const { runIngester } = require('./utils/videoIngester');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

// Scan and ingest local videos (Local PC only)
if (!process.env.RENDER && !process.env.VERCEL) {
  try {
    runIngester();
  } catch (e) {
    console.warn('[Ingester] Skipped:', e.message);
  }
  try {
    const youtubeWorker = require('./utils/youtubeWorker');
    youtubeWorker.triggerQueue();
  } catch (e) {
    console.warn('[Worker] Skipped:', e.message);
  }
}

const app = express();

// Serve static videos folder
app.use('/videos', express.static(path.join(__dirname, '../videos')));

// Serve static images folder
app.use('/images', express.static(path.join(__dirname, '../images')));

// Serve HLS stream cache
app.use('/cache/hls', express.static(path.join(__dirname, '../cache/hls'), {
    setHeaders: (res, filePath) => {
        // Set proper CORS and content types for HLS streaming
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (filePath.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (filePath.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/MP2T');
        }
    }
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'application/xml' })); // Support parsing raw Atom XML feeds from WebSub

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'YouTube Clone API is running...',
    streamingSystem: 'device-direct-only',
    serverVideoBytes: false,
    proxies: false
  });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/webhooks', require('./routes/webhook'));
app.use('/api/events', require('./routes/events'));
app.use('/api/feed', require('./routes/feed'));

// Client-direct mode: only health + analytics remain.
// The retired playback/proxy endpoints return 410 Gone.
app.use('/api/stream', require('./streaming/routes'));

const PORT = process.env.PORT || 5000;

if (process.env.VERCEL) {
  // In Vercel serverless environment, just export the app
  console.log("Running in Vercel Serverless mode");
  module.exports = app;
} else {
  // In traditional hosting (local, render, etc.), listen on PORT and run background jobs
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Boot warm-up (background): 543MB JSON parse + rank code paths ko
    // pehle request se pehle garam karo taaki pehla user 19s+ cold
    // feed na jhele. Non-blocking — server turant serve karta hai.
    if (!process.env.RENDER && !process.env.VERCEL) {
      setTimeout(() => {
        (async () => {
          try {
            console.log('[Warmup] Pre-loading video DB snapshot...');
            const { readAllVideos } = require('./utils/dbJson');
            const { rankFeed, setFeedCache } = require('./utils/recommendationEngine');
            const { videos } = readAllVideos();
            const list = Object.values(videos);
            console.log(`[Warmup] DB ready: ${list.length} videos`);
            const ranked = rankFeed(list, null);
            setFeedCache('feed_global_all', ranked, 1800);
            console.log('[Warmup] Rank paths warmed and feed_global_all primed');
          } catch (err) {
            console.error('[Warmup] failed:', err.message);
          }
        })();
      }, 2000);
    }
    
    // Start the Self-Healing Microservice Agent
    const selfHealer = require('./jobs/selfHealer');
    selfHealer.start();
    
    // Background YouTube Channel syncing agent orchestrator
    const aiBrain = require('./aiBrain');
    let isSyncing = false;

    const DISABLE_BG_AGENTS = process.env.DISABLE_BG_AGENTS === 'true' || !!process.env.RENDER || !!process.env.VERCEL;

    const runBackgroundSync = async () => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        console.log('[Background Agent] AI Brain initiating check for new YouTube videos...');
        await aiBrain.syncChannelFeed();
      } catch (err) {
        console.error('[Background Agent] Automated YouTube sync failed:', err.message);
      } finally {
        isSyncing = false;
      }
    };

    // Run initial sync 5 seconds after server startup, then every 30 minutes
    // (skippable via DISABLE_BG_AGENTS=true — the deepCrawler already fills db.json)
    if (!DISABLE_BG_AGENTS) {
      setTimeout(runBackgroundSync, 5000);
      setInterval(runBackgroundSync, 30 * 60 * 1000);
    } else {
      console.log('[Background Agent] Automated YouTube sync DISABLED (DISABLE_BG_AGENTS=true)');
    }

    // Background YouTube Webhook Processor Agent
    const youtubeWebhookAgent = require('./utils/youtubeWebhookAgent');
    let isProcessingWebhooks = false;

    const runWebhookProcessor = async () => {
      if (isProcessingWebhooks) return;
      isProcessingWebhooks = true;
      try {
        console.log('[Background Agent] Webhook Processor checking for pending notifications...');
        await youtubeWebhookAgent.processPendingNotifications();
      } catch (err) {
        console.error('[Background Agent] Webhook processing failed:', err.message);
      } finally {
        isProcessingWebhooks = false;
      }
    };

    // Run webhook processor 10 seconds after server startup, then every 1 minute
    if (!DISABLE_BG_AGENTS) {
      setTimeout(runWebhookProcessor, 10000);
      setInterval(runWebhookProcessor, 60000);
    } else {
      console.log('[Background Agent] Webhook Processor DISABLED (DISABLE_BG_AGENTS=true)');
    }

    // Background WebSub Channel Subscription Auto-Renewal Agent
    const subscribeChannels = require('./utils/subscribeChannels');
    
    const runSubscriptionRenewal = async () => {
      try {
        console.log('[Background Agent] Initiating automatic WebSub subscription renewal...');
        await subscribeChannels.runSubscriptionLoop();
      } catch (err) {
        console.error('[Background Agent] WebSub subscription renewal failed:', err.message);
      }
    };

    // Run initial subscription 15 seconds after server startup, then every 2 days
    // (WebSub hub subscriptions expire ~3 days — 2-day cycle is a safe margin
    //  for 100 channels)
    if (!DISABLE_BG_AGENTS) {
      setTimeout(runSubscriptionRenewal, 15000);
      setInterval(runSubscriptionRenewal, 2 * 24 * 60 * 60 * 1000);
    } else {
      console.log('[Background Agent] WebSub renewal DISABLED (DISABLE_BG_AGENTS=true)');
    }
  });
}


