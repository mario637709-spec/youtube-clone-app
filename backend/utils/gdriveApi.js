const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

if (process.env.REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
  driveService = google.drive({ version: 'v3', auth: oauth2Client });
  console.log('[GDrive] Google Drive OAuth API Initialized successfully.');
} else {
  console.warn('[GDrive] WARNING: REFRESH_TOKEN not found in .env. Google Drive overflow will fail!');
}

// 1. UPLOAD TO GOOGLE DRIVE
const uploadToDrive = async (filePath, filename, mimetype) => {
  if (!driveService) throw new Error("Google Drive is not configured.");

  console.log(`[GDrive] Uploading ${filename} to 5TB Google Drive Overflow...`);
  
  const fileMetadata = { 
    name: filename,
    // VERY IMPORTANT: Upload to the shared 5TB folder instead of the bot's 15GB drive
    parents: process.env.GDRIVE_FOLDER_ID ? [process.env.GDRIVE_FOLDER_ID] : [] 
  };
  const media = {
    mimeType: mimetype,
    body: fs.createReadStream(filePath),
  };

  try {
    const response = await driveService.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    console.log(`[GDrive] Upload successful! GDrive ID: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error('[GDrive] Upload Error:', error);
    throw error;
  }
};

// 2. DOWNLOAD FROM GOOGLE DRIVE (To Local PC)
const downloadFromDrive = async (fileId, destPath) => {
  if (!driveService) throw new Error("Google Drive is not configured.");

  console.log(`[GDrive] Downloading video ${fileId} back to Local PC buffer...`);
  
  return new Promise(async (resolve, reject) => {
    try {
      const dest = fs.createWriteStream(destPath);
      const res = await driveService.files.get(
        { fileId: fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      res.data
        .on('end', () => {
          console.log(`[GDrive] Download complete. File saved to Local PC.`);
          resolve(true);
        })
        .on('error', err => {
          console.error('[GDrive] Download Stream Error:', err);
          reject(err);
        })
        .pipe(dest);
    } catch (error) {
      console.error('[GDrive] Download Error:', error);
      reject(error);
    }
  });
};

// 3. DELETE FROM GOOGLE DRIVE
const deleteFromDrive = async (fileId) => {
  if (!driveService) return;

  try {
    await driveService.files.delete({ fileId: fileId });
    console.log(`[GDrive] Deleted file ${fileId} from Google Drive.`);
  } catch (error) {
    console.error(`[GDrive] Failed to delete file ${fileId}:`, error.message);
  }
};

module.exports = {
  uploadToDrive,
  downloadFromDrive,
  deleteFromDrive,
  isConfigured: () => driveService !== null
};
