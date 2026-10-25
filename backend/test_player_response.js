const http = require('http');

const req = http.request('http://localhost:5000/api/videos/proxy/cors?url=' + encodeURIComponent('https://www.youtube.com/watch?v=f8rvVxDENIs'), (res) => {
  let d = '';
  res.on('data', c => d+=c);
  res.on('end', () => {
    // Try multiple patterns to find ytInitialPlayerResponse
    const match = d.match(/ytInitialPlayerResponse\s*=\s*(\{)/);
    if (!match) { console.log('No ytInitialPlayerResponse found in HTML!'); return; }
    
    let braceCount = 0, start = d.indexOf('ytInitialPlayerResponse') + 'ytInitialPlayerResponse'.length;
    // Find the opening {
    while (d[start] !== '{') start++;
    let end = start;
    for (; end < d.length; end++) {
      if (d[end] === '{') braceCount++;
      else if (d[end] === '}') braceCount--;
      if (braceCount === 0) { end++; break; }
    }
    
    try {
      const j = JSON.parse(d.substring(start, end));
      console.log('Playability:', j.playabilityStatus?.status, 'Has streamingData:', !!j.streamingData, 'Formats:', (j.streamingData?.formats?.length||0), 'Adaptive:', (j.streamingData?.adaptiveFormats?.length||0));
      if (j.streamingData?.adaptiveFormats?.length) {
        const f = j.streamingData.adaptiveFormats[0];
        console.log('First adaptive mimeType:', f.mimeType, 'Has url:', !!f.url, 'Has cipher:', !!(f.signatureCipher||f.cipher));
        if (f.signatureCipher) {
          const p = new URLSearchParams(f.signatureCipher);
          console.log('Cipher s length:', (p.get('s') || '').length);
        }
        if (f.url) console.log('URL (first 80):', f.url.substring(0, 80));
      }
    } catch(e) {
      console.error('Parse error:', e.message);
    }
  });
});
req.on('error', e => console.error('err:', e.message));
req.end();
