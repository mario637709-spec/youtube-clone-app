const ytdl = require('@distube/ytdl-core');

async function testClientSpoof() {
  const videoId = 'dQw4w9WgXcQ';
  console.log('--- Testing @distube/ytdl-core Clients ---\n');

  try {
    // Distube's ytdl-core has an option 'clients' to specify which clients to fetch from
    // By default it usually fetches from WEB and ANDROID and TV.
    // Let's specify explicitly
    console.log('Fetching with clients: ["IOS"]');
    const infoIos = await ytdl.getInfo(videoId, { 
        clients: ['IOS'] 
    });
    
    const formatIos = ytdl.chooseFormat(infoIos.formats, { quality: 'highest' });
    console.log('IOS Format URL (first 100):', formatIos.url.substring(0, 100));
    console.log('IOS URL contains IP binding (ip=)?:', formatIos.url.includes('ip='));
    
    console.log('\n----------------------------------------\n');
    
    console.log('Fetching with clients: ["WEB"]');
    const infoWeb = await ytdl.getInfo(videoId, { 
        clients: ['WEB'] 
    });
    
    const formatWeb = ytdl.chooseFormat(infoWeb.formats, { quality: 'highest' });
    console.log('WEB Format URL (first 100):', formatWeb.url.substring(0, 100));
    console.log('WEB URL contains IP binding (ip=)?:', formatWeb.url.includes('ip='));
    
  } catch (err) {
    console.error('Error fetching ytdl info:', err.message);
  }
}

testClientSpoof();
