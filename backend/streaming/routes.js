/**
 * streaming/routes.js — CLIENT-DIRECT ONLY
 *
 * As of 2026-10, every YouTube player request, base.js download and
 * video byte is handled by the user's device (CapacitorHttp + native
 * fetch). The server must never proxy video traffic again.
 *
 * Only health + source analytics remain here. The old endpoints are
 * kept as explicit 410 Gone responses so old APK builds fail fast
 * instead of hanging on a proxy that no longer exists.
 */

const express = require('express');
const router = express.Router();

const bySource = Object.create(null);

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'device-direct-only',
    serverVideoBytes: false,
    proxies: false,
    timestamp: new Date().toISOString()
  });
});

router.get('/stats', (req, res) => {
  res.json({ mode: 'device-direct-only', bySource });
});

router.post('/report', (req, res) => {
  const { videoId, source } = req.body || {};
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'source is required' });
  }
  bySource[source] = (bySource[source] || 0) + 1;
  res.json({ ok: true, videoId: videoId || null, source });
});

const retired = (req, res) => {
  res.status(410).json({
    error: 'This endpoint was removed. YouTube playback is fetched directly by the device.',
    code: 'DIRECT_ONLY'
  });
};

// Retired playback/proxy endpoints.
router.all('/auto/:videoId', retired);
router.all('/proxy/:videoId', retired);
router.all('/url/:videoId', retired);
router.all('/piped/:videoId', retired);
router.all('/invidious/:videoId', retired);
router.all('/embed/:videoId', retired);
router.all('/iframe-api', retired);
router.all('/player-bootstrap', retired);
router.all('/pot', retired);

module.exports = router;
