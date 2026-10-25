const http = require('http');
const fs = require('fs');

const req = http.request('http://localhost:5000/api/videos/proxy/cors?url=' + encodeURIComponent('https://www.youtube.com/watch?v=f8rvVxDENIs'), (res) => {
  let d = '';
  res.on('data', c => d+=c);
  res.on('end', () => {
    console.log('Total HTML length:', d.length);
    fs.writeFileSync('watch_html_dump.html', d);
    
    // Check for various markers
    console.log('Has ytInitialPlayerResponse:', d.includes('ytInitialPlayerResponse'));
    console.log('Has jsUrl:', d.includes('jsUrl'));
    console.log('Has streamingData:', d.includes('streamingData'));
    console.log('Has signatureCipher:', d.includes('signatureCipher'));
    console.log('Has base.js:', d.includes('base.js'));
    
    // Check first 200 chars
    console.log('First 200 chars:', d.substring(0, 200));
  });
});
req.on('error', e => console.error('err:', e.message));
req.end();
