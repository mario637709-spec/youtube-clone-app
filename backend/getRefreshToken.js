const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

const getAccessToken = (oAuth2Client) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:');
  console.log(authUrl);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      console.log('\n\n✅ SUCCESS! Paste the following REFRESH_TOKEN in your .env file:\n');
      console.log(`REFRESH_TOKEN=${token.refresh_token}\n`);
    });
  });
};

if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
  console.log("❌ Please add CLIENT_ID and CLIENT_SECRET to your .env file first!");
} else {
  getAccessToken(oAuth2Client);
}
