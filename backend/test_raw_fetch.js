async function fetchPlayer(clientName, videoId) {
  const url = `https://www.youtube.com/youtubei/v1/player`;
  
  // Minimal payload
  const payload = {
    context: {
      client: {
        clientName: clientName,
        clientVersion: clientName === 'ANDROID' ? '19.01.35' : (clientName === 'IOS' ? '19.01.1' : '2.20240105.01.00'),
        hl: 'en',
        gl: 'US'
      }
    },
    videoId: videoId,
    playbackContext: {
      contentPlaybackContext: {
        signatureTimestamp: 19732 // Approximate, doesn't matter for just getting the format list
      }
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      console.log(`[${clientName}] HTTP Error: ${res.status}`);
      return;
    }
    
    const data = await res.json();
    const formats = data.streamingData?.adaptiveFormats || data.streamingData?.formats || [];
    
    if (formats.length === 0) {
      console.log(`[${clientName}] No formats returned. (Could be missing fields or invalid client version)`);
      return;
    }
    
    // Check first format
    const f = formats[0];
    const streamUrl = f.url || f.signatureCipher || f.cipher;
    
    if (!streamUrl) {
      console.log(`[${clientName}] No URL or Cipher found.`);
      return;
    }
    
    let isCiphered = streamUrl.includes('signatureCipher=') || streamUrl.includes('cipher=') || !f.url;
    let urlToCheck = f.url || streamUrl;
    
    // Does the URL contain 'ip=' ?
    const hasIp = urlToCheck.includes('ip=') || urlToCheck.includes('%26ip%3D');
    
    console.log(`[${clientName}] Success!`);
    console.log(`- Is Ciphered? ${isCiphered ? 'YES' : 'NO'}`);
    console.log(`- Contains IP binding (ip=)? ${hasIp ? 'YES' : 'NO'}`);
    
    if (!isCiphered && hasIp) {
      // Decode and extract the IP just to see
      try {
        const decoded = decodeURIComponent(urlToCheck);
        const ipMatch = decoded.match(/[&?]ip=([^&]+)/);
        if (ipMatch) {
          console.log(`- Bound to IP: ${ipMatch[1]}`);
        }
      } catch(e) {}
    }
    
  } catch (err) {
    console.error(`[${clientName}] Fetch error:`, err.message);
  }
}

async function run() {
  const videoId = 'dQw4w9WgXcQ';
  console.log('Testing YouTube InnerTube API Clients...\n');
  
  await fetchPlayer('WEB', videoId);
  console.log('-------------------------');
  await fetchPlayer('ANDROID', videoId);
  console.log('-------------------------');
  await fetchPlayer('IOS', videoId);
  console.log('-------------------------');
  await fetchPlayer('TVHTML5', videoId);
}

run();
