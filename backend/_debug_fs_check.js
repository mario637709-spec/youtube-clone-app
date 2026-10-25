const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/youtube_clone?directConnection=true");
  const col = mongoose.connection.db.collection("users");
  const users = await col.find({ email: { $in: ["bkjhwwjeqj@gmail.com", "vishnusaini3vs@gmail.com", "vishnusaini3vsbb@gmail.com", "test@test.com"] } }).toArray();
  for (const u of users) console.log(`MONGO HAS: ${u.email} => ${u.id} (${Object.keys(u).length} fields)`);
  await mongoose.disconnect();
  process.exit(0);
})();
