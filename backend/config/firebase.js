const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

let db = null;
let bucket = null;
let isRealFirebase = false;

const serviceAccountPath = path.join(__dirname, './firebaseServiceAccount.json');
const forceLocalDb = process.env.FORCE_LOCAL_DB === 'true';

try {
  let serviceAccount = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
    } catch (e) {
      console.warn('Could not parse FIREBASE_SERVICE_ACCOUNT env var:', e.message);
    }
  }
  
  if (!serviceAccount && fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
  }

  if (serviceAccount && !forceLocalDb) {
    const projectId = serviceAccount.project_id;
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET
      || `${projectId}.firebasestorage.app`;

    const app = initializeApp({
      credential: cert(serviceAccount),
      storageBucket
    });
    
    db = getFirestore(app);
    bucket = getStorage(app).bucket();
    isRealFirebase = true;
    console.log(`[Firebase] Admin SDK initialized successfully! Project: ${projectId}, Storage bucket: ${storageBucket}`);
  } else {
    console.warn('[Firebase] Service account not available or FORCE_LOCAL_DB=true. Using local database emulator.');
  }
} catch (error) {
  console.warn('[Firebase] Could not initialize Firebase Admin SDK:', error.message, '. Using local database emulator.');
}

module.exports = {
  db,
  bucket,
  isRealFirebase
};
