const dbFirestore = require('../utils/dbFirestore');
const cache = require('../utils/cache');

// 1. Fetch comments for a video
exports.getComments = async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const cacheKey = `comments_${videoId}`;
    let comments = cache.getCache(cacheKey);

    if (!comments) {
      comments = await dbFirestore.getComments(videoId);
      cache.setCache(cacheKey, comments, 120); // cache for 2 minutes
    }
    
    res.json(comments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 2. Add a comment
exports.addComment = async (req, res) => {
  try {
    const { text } = req.body;
    const videoId = req.params.videoId;
    const uploaderId = req.user ? req.user.id || req.user._id : '1';
    const username = req.user ? req.user.username : 'Viewer';
    const avatar = req.user ? req.user.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}`;

    const commentData = {
      text,
      video: videoId,
      user: {
        id: uploaderId,
        username,
        avatar
      }
    };

    const newComment = await dbFirestore.addComment(commentData);
    
    // Invalidate cache
    cache.deleteCache(`comments_${videoId}`);
    
    res.status(201).json(newComment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 3. Update comment (placeholder/simplified)
exports.updateComment = async (req, res) => {
  res.json({ message: 'Comment updated successfully (Demo)' });
};

// 4. Delete comment (placeholder/simplified)
exports.deleteComment = async (req, res) => {
  res.json({ message: 'Comment removed successfully (Demo)' });
};
