const fs = require('fs');
const path = require('path');

const jsContent = fs.readFileSync(path.join(__dirname, 'videoController.js'), 'utf8');

const regex = /getYoutubePlayerJs/g;
let match;
while (match = regex.exec(jsContent)) {
    console.log(`Found getYoutubePlayerJs at index ${match.index}`);
    console.log(jsContent.substring(match.index - 50, match.index + 200));
}
