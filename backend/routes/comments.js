const express = require('express');
const router = express.Router();
const {
  getComments,
  addComment,
  updateComment,
  deleteComment,
} = require('../controllers/commentController');
const { protect } = require('../middleware/auth');

router.route('/:videoId').get(getComments).post(protect, addComment);
router.route('/:id').put(protect, updateComment).delete(protect, deleteComment);

module.exports = router;
