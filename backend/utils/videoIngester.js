const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDb, writeDb } = require('./dbJson');
const getPublicBaseUrl = require('./publicBaseUrl');

const VIDEOS_DIR = path.join(__dirname, '../../videos');

// Helper to generate deterministic 11-char YouTube ID
const generateUniqueId = (filename) => {
  return crypto
    .createHash('md5')
    .update(filename)
    .digest('base64url')
    .substring(0, 11)
    .replace(/[^a-zA-Z0-9_-]/g, 'x'); // YouTube-like character set
};

// Helper to clean filename into readable Title
const cleanTitle = (filename) => {
  let name = path.parse(filename).name;
  
  // Remove trailing UUIDs, timestamps or hash patterns
  name = name.replace(/_\d{12}$/, ''); // e.g. _202606091103
  name = name.replace(/-\d{12}$/, '');
  name = name.replace(/_\d{8}_\d{4}$/, '');
  name = name.replace(/_[a-f0-9]{8}$/, '');
  name = name.replace(/_bg$/, '');
  
  // Replace underscores, hyphens, and brackets with spaces
  name = name.replace(/[_\-\(\)]+/g, ' ');
  
  // Title case formatting
  return name
    .trim()
    .split(' ')
    .map(word => {
      if (!word) return '';
      // keep abbreviations capitalized
      if (word.toUpperCase() === 'POV' || word.toUpperCase() === 'HD' || word.toUpperCase() === 'UI') {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
};

// Helper to determine category based on filename keywords
const getCategory = (title, filename) => {
  const text = (title + ' ' + filename).toLowerCase();
  
  if (text.includes('bike') || text.includes('riding') || text.includes('biking') || text.includes('trail') || text.includes('ride') || text.includes('climbing') || text.includes('downhill') || text.includes('sports')) {
    return 'Sports';
  }
  if (text.includes('brain') || text.includes('lungs') || text.includes('heart') || text.includes('oxygen') || text.includes('skeleton') || text.includes('science') || text.includes('education') || text.includes('carbon')) {
    return 'Education';
  }
  if (text.includes('tech') || text.includes('cyberpunk') || text.includes('setup') || text.includes('laboratory') || text.includes('greenhouse')) {
    return 'Tech';
  }
  if (text.includes('gaming') || text.includes('game') || text.includes('play') || text.includes('challenge')) {
    return 'Gaming';
  }
  if (text.includes('music') || text.includes('song') || text.includes('whisk')) {
    return 'Music';
  }
  
  // Fallbacks
  const categories = ['Gaming', 'Music', 'Live', 'Sports', 'News', 'Education', 'Tech'];
  return categories[Math.floor(Math.random() * categories.length)];
};

// Helper to generate descriptive tags
const getTags = (title, category) => {
  const tags = [category];
  const words = title.split(' ');
  words.forEach(word => {
    if (word.length > 3 && !['with', 'along', 'from', 'this', 'that', 'these', 'those'].includes(word.toLowerCase())) {
      tags.push(word);
    }
  });
  return [...new Set(tags)].slice(0, 6);
};

// Available mock channels matching frontend setup
const mockChannels = [
  { id: 1, name: 'Tech Explorer', avatar: 'https://ui-avatars.com/api/?name=Tech+Explorer&background=random' },
  { id: 2, name: 'Gaming World', avatar: 'https://ui-avatars.com/api/?name=Gaming+World&background=random' },
  { id: 3, name: 'Adventure Seekers', avatar: 'https://ui-avatars.com/api/?name=Adventure+Seekers&background=random' },
  { id: 4, name: 'Mystery Hunter', avatar: 'https://ui-avatars.com/api/?name=Mystery+Hunter&background=random' },
  { id: 5, name: 'Urban Legends', avatar: 'https://ui-avatars.com/api/?name=Urban+Legends&background=random' },
  { id: 6, name: 'Epic Builds', avatar: 'https://ui-avatars.com/api/?name=Epic+Builds&background=random' },
  { id: 7, name: 'Thrill Zone', avatar: 'https://ui-avatars.com/api/?name=Thrill+Zone&background=random' },
  { id: 8, name: 'Discovery Plus', avatar: 'https://ui-avatars.com/api/?name=Discovery+Plus&background=random' },
  { id: 9, name: 'Challenge Master', avatar: 'https://ui-avatars.com/api/?name=Challenge+Master&background=random' },
  { id: 10, name: 'Vault Hunter', avatar: 'https://ui-avatars.com/api/?name=Vault+Hunter&background=random' }
];

const runIngester = () => {
  console.log('Running Video Ingester...');
  
  if (!fs.existsSync(VIDEOS_DIR)) {
    console.error(`Videos directory not found at: ${VIDEOS_DIR}`);
    return;
  }
  
  const files = fs.readdirSync(VIDEOS_DIR).filter(file => file.endsWith('.mp4'));
  console.log(`Found ${files.length} mp4 video files.`);
  
  const db = readDb();
  if (!db.videos) db.videos = {};
  
  const IMAGES_DIR = path.join(__dirname, '../../images');
  let imageFiles = [];
  if (fs.existsSync(IMAGES_DIR)) {
    imageFiles = fs.readdirSync(IMAGES_DIR).filter(file => file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.jpg'));
  }
  
  let addedCount = 0;
  let updatedCount = 0;
  
  files.forEach(file => {
    const videoId = generateUniqueId(file);
    const title = cleanTitle(file);
    const category = getCategory(title, file);
    const tags = getTags(title, category);
    
    // Choose random mock channel
    const channel = mockChannels[Math.floor(Math.random() * mockChannels.length)];
    
    // Generate actual thumbnail from local video using FFmpeg instead of random YouTube image fallback
    const thumbFilename = `${videoId}_thumbnail.jpg`;
    const localThumbPath = path.join(IMAGES_DIR, thumbFilename);
    const thumbnail = `${getPublicBaseUrl()}/images/${thumbFilename}`;

    if (!fs.existsSync(localThumbPath)) {
      try {
        const { generateThumbnail } = require('./videoTranscoder');
        const videoPath = path.join(VIDEOS_DIR, file);
        generateThumbnail(videoPath, thumbFilename, IMAGES_DIR)
          .then(() => console.log(`[Ingester] ✅ Generated actual thumbnail for local video: ${title}`))
          .catch(err => console.error(`[Ingester] ❌ Failed to generate thumbnail for ${title}:`, err.message));
      } catch (err) {
        console.warn(`[Ingester] Failed to load/run videoTranscoder:`, err.message);
      }
    }

    // Check if video already exists in db to preserve user likes, comments, views
    if (db.videos[videoId]) {
      // Keep existing properties but update name/url if changed
      db.videos[videoId].title = title;
      db.videos[videoId].videoUrl = `${getPublicBaseUrl()}/videos/${encodeURIComponent(file)}`;
      db.videos[videoId].thumbnail = thumbnail;
      db.videos[videoId].category = category;
      db.videos[videoId].tags = tags;
      updatedCount++;
    } else {
      // Create new video object with random statistics
      const views = Math.floor(Math.random() * 980000) + 1500;
      const likesCount = Math.floor(views * (Math.random() * 0.08 + 0.02)); // 2% to 10% of views
      const dislikesCount = Math.floor(likesCount * 0.05); // 5% of likes
      
      const minutes = Math.floor(Math.random() * 3) + 0;
      const seconds = Math.floor(Math.random() * 50) + 10;
      const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      db.videos[videoId] = {
        id: videoId,
        filename: file,
        title: title,
        description: `Experience the amazing details of ${title}. Filmed in high quality, this video shows creative concepts, immersive environments, and stunning visualizations. Category: ${category}.`,
        videoUrl: `${getPublicBaseUrl()}/videos/${encodeURIComponent(file)}`,
        thumbnail: thumbnail,
        views: views,
        likes: likesCount,
        dislikes: dislikesCount,
        duration: duration,
        category: category,
        tags: tags,
        uploader: {
          id: channel.id,
          username: channel.name,
          channelName: channel.name,
          avatar: channel.avatar
        },
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)).toISOString() // Random date within last year
      };
      addedCount++;
    }
  });
  
  writeDb(db);
  console.log(`Video Ingester complete. Added: ${addedCount}, Updated: ${updatedCount}, Total: ${Object.keys(db.videos).length}`);
};

module.exports = {
  runIngester,
  generateUniqueId
};
