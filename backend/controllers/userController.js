const dbFirestore = require('../utils/dbFirestore');

exports.getUserAnalytics = async (req, res) => {
  try {
    // Fallback to default user ID '1' if not authenticated (simplifying frontend demo)
    const userId = req.user ? req.user.id || req.user._id : '1';
    
    // Fetch all videos
    const videos = await dbFirestore.getVideos();
    
    // Filter videos uploaded by the user
    const userVideos = videos.filter(v => v.uploader && String(v.uploader.id) === String(userId));
    
    // Compute analytics
    const totalViews = userVideos.reduce((sum, v) => sum + (v.views || 0), 0);
    const totalLikes = userVideos.reduce((sum, v) => sum + (v.likes || 0), 0);
    
    res.json({
      totalUploads: userVideos.length,
      totalViews,
      totalLikes,
      videos: userVideos
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { channelName, email, username, settings, likedVideos, dislikedVideos } = req.body;
    
    if (email && email.toLowerCase() !== req.user.email.toLowerCase()) {
      const emailExists = await dbFirestore.getUserByEmail(email);
      if (emailExists) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }
    
    const updates = {};
    if (channelName) updates.channelName = channelName;
    if (email) updates.email = email.toLowerCase();
    if (username) updates.username = username;
    if (settings) updates.settings = settings;
    if (likedVideos) updates.likedVideos = likedVideos;
    if (dislikedVideos) updates.dislikedVideos = dislikedVideos;
    
    // Auto-update avatar when channelName changes
    if (channelName) {
      updates.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}&background=ff0000&color=fff`;
    }
    
    const updatedUser = await dbFirestore.updateUser(userId, updates);
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toggleSubscribe = async (req, res) => {
  try {
    const channelId = req.params.id;
    const currentUserId = req.user.id || req.user._id;

    if (channelId === currentUserId) {
      return res.status(400).json({ message: 'You cannot subscribe to yourself' });
    }

    const channel = await dbFirestore.getUserById(channelId);
    if (!channel) {
      return res.status(404).json({ message: 'Channel not found' });
    }

    const currentUser = await dbFirestore.getUserById(currentUserId);

    const subscribers = channel.subscribers || [];
    const subscriptions = currentUser.subscriptions || [];

    const isSubbed = subscribers.includes(currentUserId);
    let updatedSubscribers;
    let updatedSubscriptions;

    if (isSubbed) {
      // Unsubscribe
      updatedSubscribers = subscribers.filter(id => id !== currentUserId);
      updatedSubscriptions = subscriptions.filter(id => id !== channelId);
    } else {
      // Subscribe
      updatedSubscribers = [...subscribers, currentUserId];
      updatedSubscriptions = [...subscriptions, channelId];
    }

    await dbFirestore.updateUser(channelId, { subscribers: updatedSubscribers });
    const updatedMe = await dbFirestore.updateUser(currentUserId, { subscriptions: updatedSubscriptions });

    // RTDB mirror (dual index) — best effort, API ko slow nahi karta
    try {
      const notify = require('../utils/notify');
      notify.setSub(currentUserId, channelId, !isSubbed).catch(() => {});
    } catch {}

    res.json({
      subscribed: !isSubbed,
      subscribersCount: updatedSubscribers.length,
      user: updatedMe
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
