const { db } = require("./config/firebase");
const deletedIds = ["30f6292952c80aee", "1413b455301354cc", "7f2af7b76af8c309", "44fc70e1652cafd5"];
(async () => {
  // 1. Collection counts
  for (const col of ["videos", "comments", "users", "guest_profiles", "youtube_notifications", "playlists"]) {
    const snap = await db.collection(col).limit(1).get().catch((e) => null);
    console.log(`collection "${col}" -> reachable: ${!!snap}`);
  }
  // full counts via separate queries
  const counts = {};
  for (const col of ["videos", "comments", "users", "guest_profiles", "youtube_notifications"]) {
    const data = await db.collection(col).select().limit(100000).get().catch((e) => { console.log(col, "ERR", e.message); return null; });
    if (data) counts[col] = data.size;
  }
  console.log("COUNTS:", JSON.stringify(counts));

  // 2. Sample videos — do they have URL/thumbnail/views/likes?
  const vsnap = await db.collection("videos").limit(5).get();
  let v = 0;
  vsnap.forEach((d) => {
    const x = d.data();
    if (v < 3) {
      console.log(`VIDEO[${d.id}] title=${String(x.title).substring(0,30)} | url=${!!x.videoUrl} | thumb=${!!x.thumbnail} | views=${x.views} | likes=${Array.isArray(x.likes) ? x.likes.length : x.likes} | uploader=${x.uploader ? (x.uploader.id||x.uploader.username) : "none"} | storage=${x.storageLocation}`);
    }
    v++;
  });
  console.log("  total videos sampled:", v);

  // 3. Do any videos reference the deleted user ids?
  const delSet = new Set(deletedIds);
  let videosByDeleted = 0; const videoSample2 = [];
  const allV = await db.collection("videos").select().limit(100000).get();
  const allVideosDocs = [];
  allV.forEach((d) => allVideosDocs.push(d));
  // fetch uploader fields for matches (select() only ids — need full fetch for those)
  for (const d of allVideosDocs) {
    const full = await d.ref.get();
    const u = full.data().uploader || {};
    if (delSet.has(String(u.id || u._id))) { videosByDeleted++; if (videoSample2.length < 5) videoSample2.push(full.id); }
  }
  console.log("VIDEOS with uploader.id in DELETED set:", videosByDeleted, videoSample2);

  // 4. Comments referencing deleted users
  let commentsByDeleted = 0;
  const csnap = await db.collection("comments").limit(100000).get();
  let cTotal = 0;
  const cPromises = [];
  csnap.forEach((d) => { cTotal++; cPromises.push(d.ref.get()); });
  for (const d of cPromises) {
    const c = (await d).data();
    const author = String(c.userId || c.user || (c.userData && c.userData.id) || "");
    const authorName = String(c.username || (c.userData && c.userData.username) || (c.user && c.user.username) || "");
    if (delSet.has(author)) commentsByDeleted++;
  }
  console.log("COMMENTS total:", cTotal, "| by deleted users:", commentsByDeleted);

  // 5. Subscriptions/subscribers on remaining users pointing to deleted ids
  let refs = 0;
  const usnap = await db.collection("users").limit(100000).get();
  const uDocs = [];
  usnap.forEach((d) => uDocs.push(d));
  for (const d of uDocs) {
    const full = await d.ref.get();
    const data = full.data();
    const subs = (data.subscriptions || []).filter((x) => delSet.has(String(x)));
    const subsb = (data.subscribers || []).filter((x) => delSet.has(String(x)));
    if (subs.length || subsb.length) { refs++; console.log(`USER ${d.id}: subscriptions->deleted:${subs.length} subscribers->deleted:${subsb.length}`); }
  }
  console.log("REMAINING USERS:", uDocs.length, "| with refs to deleted:", refs);

  // 6. deleted user's watchHistory/interests? (not needed — docs gone)
  process.exit(0);
})();
