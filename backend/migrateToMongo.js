require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const migrate = async () => {
  if (!process.env.MONGO_URI) {
    console.error("ERROR: MONGO_URI is not set in your .env file!");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected successfully!");

  const dbPath = path.join(__dirname, 'data', 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.error("ERROR: data/db.json not found!");
    process.exit(1);
  }

  console.log("Reading data/db.json...");
  const rawData = fs.readFileSync(dbPath, 'utf8');
  const db = JSON.parse(rawData);

  const collections = ['users', 'videos', 'comments', 'youtube_notifications'];

  for (const col of collections) {
    if (db[col]) {
      const items = Object.values(db[col]);
      console.log(`Found ${items.length} items in ${col}. Migrating...`);

      const dbCol = mongoose.connection.db.collection(col);
      
      let insertedCount = 0;
      for (const item of items) {
        // Ensure the MongoDB _id matches the JSON id for consistency
        const id = item.id;
        const mongoData = { _id: id, ...item };
        
        try {
          await dbCol.updateOne({ id: id }, { $set: mongoData }, { upsert: true });
          insertedCount++;
        } catch (e) {
          console.error(`Error migrating item ${id} in ${col}:`, e.message);
        }
      }
      console.log(`Successfully migrated ${insertedCount} items to MongoDB collection: ${col}`);
    }
  }

  console.log("Migration Complete!");
  process.exit(0);
};

migrate().catch(console.error);
