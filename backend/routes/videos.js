const express = require('express');
const router = express.Router();
const {
  getVideos,
  getShorts,
  getVideoById,
  getRelatedVideos,
  uploadVideo,
  updateVideo,
  deleteVideo,
  streamVideo,
  getStreamUrl,
  uploadChunk,
  uploadComplete,
  decryptSignature,
  getDirectStreamConfig,
  getYoutubePlayerConfig,
  getYoutubeiPlayerConfig,
  getYoutubeEmbedProxy,
  getYoutubePlayerJs,
  corsProxy
} = require('../controllers/videoController');
const { protect, optionalProtect } = require('../middleware/auth');
const multer = require('multer');

const os = require('os');
const upload = multer({
  dest: os.tmpdir(), // Use system temp directory for large uploads
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5 GB limit
});


router.route('/proxy/youtube-embed-proxy').get(getYoutubeEmbedProxy);
router.route('/proxy/youtube-player-js').get(getYoutubePlayerJs);
router.route('/proxy/decrypt-signature').post(decryptSignature);
router.route('/proxy/youtube-player-config').get(getYoutubePlayerConfig);
router.route('/proxy/cors').all(corsProxy);
router.route('/direct-config/:id').get(getDirectStreamConfig);
router.route('/proxy/youtubei-player').post(getYoutubeiPlayerConfig);

router.route('/stream/:id').get(streamVideo);
router.route('/stream-url/:id').get(getStreamUrl);
router.route('/shorts').get(optionalProtect, getShorts);
router.route('/upload-chunk').post(protect, upload.single('chunk'), uploadChunk);
router.route('/upload-complete').post(protect, upload.fields([{ name: 'thumbnail', maxCount: 1 }]), uploadComplete);

router.route('/')
  .get(optionalProtect, getVideos)
  .post(protect, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), uploadVideo);
router.route('/:id').get(optionalProtect, getVideoById).put(protect, updateVideo).delete(protect, deleteVideo);
router.route('/:id/related').get(optionalProtect, getRelatedVideos);

module.exports = router;
