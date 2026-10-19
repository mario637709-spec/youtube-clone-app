const fs = require('fs');
const https = require('https');

async function downloadBaseJs() {
  return new Promise((resolve, reject) => {
    https.get('https://www.youtube.com/iframe_api', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/s\/player\/[a-zA-Z0-9_-]+\/player_ias\.vflset\/en_US\/base\.js/);
        if (match) {
          const jsUrl = 'https://www.youtube.com/' + match[0];
          https.get(jsUrl, (res2) => {
            let jsData = '';
            res2.on('data', chunk => jsData += chunk);
            res2.on('end', () => resolve(jsData));
          });
        } else {
          reject('Could not find base.js');
        }
      });
    });
  });
}

async function testDecipher() {
  const jsContent = await downloadBaseJs();
  console.log('Downloaded base.js length:', jsContent.length);

  // 1. Extract R array
  const R_REGEXP = /(var\s+([a-zA-Z0-9_$]+)\s*=\s*['"](?:[^'\\]|\\.)*['"]\.split\(['"];['"]\))/;
  const rMatch = jsContent.match(R_REGEXP);
  
  // 3. Extract decipher function name and code
  const DECIPHER_REGEXP = /([a-zA-Z0-9_$]+)\s*=\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{\s*var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\^[a-zA-Z0-9_$]+;\s*if\(\([a-zA-Z0-9_$]+\^12\)<26/;
  const decipherMatch = jsContent.match(DECIPHER_REGEXP);
  
  console.log('rMatch:', !!rMatch);
  console.log('decipherMatch:', !!decipherMatch);
}
testDecipher();
