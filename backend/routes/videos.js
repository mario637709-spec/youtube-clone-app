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
  uploadChunk,
  uploadComplete
} = require('../controllers/videoController');
const { protect, optionalProtect } = require('../middleware/auth');
const multer = require('multer');

const os = require('os');
const upload = multer({
  dest: os.tmpdir(), // Use system temp directory for large uploads
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5 GB limit
});

// Local uploads only. YouTube playback is never proxied: the device
// fetches the player response and streams googlevideo directly.
router.route('/stream/:id').get(streamVideo);
router.route('/shorts').get(optionalProtect, getShorts);
router.route('/upload-chunk').post(protect, upload.single('chunk'), uploadChunk);
router.route('/upload-complete').post(protect, upload.fields([{ name: 'thumbnail', maxCount: 1 }]), uploadComplete);

router.route('/')
  .get(optionalProtect, getVideos)
  .post(protect, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), uploadVideo);
router.route('/:id').get(optionalProtect, getVideoById).put(protect, updateVideo).delete(protect, deleteVideo);
router.route('/:id/related').get(optionalProtect, getRelatedVideos);

module.exports = router;
