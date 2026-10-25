const { exec } = require('child_process');
const path = require('path');
const os = require('os');

const CHROME_PROFILE_DIR = path.join(os.homedir(), 'Desktop', 'server-bot-profile');

console.log('=============================================');
console.log('1. Launching Normal Chrome Profile (Anti-Bot Bypass)...');
console.log(`Profile Path: ${CHROME_PROFILE_DIR}`);
console.log('=============================================');

// Using Windows 'start chrome' to launch the actual user browser, completely bypassing Puppeteer detection
const command = `start chrome --user-data-dir="${CHROME_PROFILE_DIR}" "https://studio.youtube.com"`;

exec(command, (err) => {
  if (err) {
    console.error('Failed to launch Chrome. Please ensure Chrome is installed.', err);
    return;
  }
  
  console.log('\n✅ NORMAL BROWSER OPENED!');
  console.log('👉 Since this is a normal browser, Google will NOT block your login.');
  console.log('👉 Please log into your YouTube account now.');
  console.log('👉 Once logged in and you see the Studio dashboard, just close the browser.');
  console.log('👉 Press Ctrl+C in this terminal when you are done.\n');
});
