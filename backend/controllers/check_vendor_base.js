const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../node_modules/youtube-po-token-generator/vendor/base.js');
console.log('Exists:', fs.existsSync(filePath));
if (fs.existsSync(filePath)) {
    console.log('Size:', fs.statSync(filePath).size);
}
