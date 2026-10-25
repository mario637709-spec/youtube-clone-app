async function init() {
  const { Innertube } = await import('youtubei.js');
  return Innertube;
}

async function testClient(clientType) {
  try {
    const Innertube = await init();
    console.log(`\n--- Testing Client: ${clientType} ---`);
    // Initialize Innertube with the specific client type
    // Supported client types typically include: WEB, ANDROID, IOS, YTMUSIC, TV_EMBED, etc.
    const yt = await Innertube.create({ 
      generate_session_locally: true, 
      client_type: clientType,
      retrieve_player: true
    });
    
    // Get info for a test video (e.g., Rick Astley)
    const videoId = 'dQw4w9WgXcQ'; 
    console.log(`Fetching info for video ${videoId} using client ${clientType}...`);
    
    const info = await yt.getBasicInfo(videoId);
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    
    if (adaptiveFormats.length === 0) {
      console.log('No adaptive formats found.');
      return;
    }

    const videoFmt = adaptiveFormats.find(f => f.has_video && !f.has_audio) || adaptiveFormats[0];
    
    let url = videoFmt.url;
    
    if (!url && typeof videoFmt.decipher === 'function') {
      console.log('URL is ciphered, deciphering...');
      try {
        url = await videoFmt.decipher(yt.session.player);
      } catch (e) {
        console.error('Decipher failed:', e.message);
      }
    }

    if (url) {
      console.log('Generated URL (first 150 chars):', url.substring(0, 150));
      
      // Let's check if the URL contains an IP parameter which usually indicates IP-binding
      const urlObj = new URL(url);
      const hasIp = urlObj.searchParams.has('ip');
      console.log(`URL contains 'ip' parameter: ${hasIp ? 'YES' : 'NO'}`);
      
      // Attempt to fetch the first few bytes to see if it responds with 200 or 403
      console.log('Testing URL accessibility...');
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Range': 'bytes=0-100',
            // Some clients need user-agent spoofing too, but let's see raw fetch
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
          }
        });
        console.log(`Fetch Status: ${response.status} ${response.statusText}`);
      } catch (fetchErr) {
        console.log(`Fetch Error: ${fetchErr.message}`);
      }
    } else {
      console.log('Could not get a playable URL.');
    }
    
  } catch (err) {
    console.error(`Error with client ${clientType}:`, err.message);
  }
}

async function runTests() {
  await testClient('WEB'); // Default WEB client (often strict IP binding)
  await testClient('ANDROID'); // Android client (often less strict)
  await testClient('IOS'); // iOS client (often no cipher, direct URL)
  await testClient('TV_EMBED'); 
}

runTests();
