const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbPath = path.join(__dirname, '../data/db.json');

const migrate = async () => {
  if (!fs.existsSync(dbPath)) {
    console.error('db.json not found at:', dbPath);
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/youtube-clone';
  console.log('Connecting to MongoDB at:', mongoUri);

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB successfully!');
    const db = mongoose.connection.db;

    const localData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

    // 1. Migrate Videos
    if (localData.videos) {
      const videos = Object.values(localData.videos);
      console.log(`Migrating ${videos.length} videos...`);
      for (const video of videos) {
        const videoWithId = { _id: video.id, ...video };
        await db.collection('videos').updateOne(
          { id: video.id },
          { $set: videoWithId },
          { upsert: true }
        );
      }
      console.log('Videos migration completed!');
    }

    // 2. Migrate Users
    if (localData.users) {
      const users = Object.values(localData.users);
      console.log(`Migrating ${users.length} users...`);
      for (const user of users) {
        const userWithId = { _id: String(user.id), ...user };
        await db.collection('users').updateOne(
          { id: String(user.id) },
          { $set: userWithId },
          { upsert: true }
        );
      }
      console.log('Users migration completed!');
    }

    // 3. Migrate Comments
    if (localData.comments) {
      const comments = Object.values(localData.comments);
      console.log(`Migrating ${comments.length} comments...`);
      for (const comment of comments) {
        const commentWithId = { _id: comment.id, ...comment };
        await db.collection('comments').updateOne(
          { id: comment.id },
          { $set: commentWithId },
          { upsert: true }
        );
      }
      console.log('Comments migration completed!');
    }

    // 4. Migrate Youtube Notifications
    if (localData.youtube_notifications) {
      const notifications = Object.values(localData.youtube_notifications);
      console.log(`Migrating ${notifications.length} webhook notifications...`);
      for (const notif of notifications) {
        const notifWithId = { _id: notif.videoId, ...notif };
        await db.collection('youtube_notifications').updateOne(
          { videoId: notif.videoId },
          { $set: notifWithId },
          { upsert: true }
        );
      }
      console.log('Webhook notifications migration completed!');
    }

    console.log('🎉 Database Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  }
};

migrate();
