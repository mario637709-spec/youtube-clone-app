// Test: print raw page JSON from youtubei.js
async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    
    // Let's get the raw page JSON
    const rawString = JSON.stringify(info.page?.[0] || {});
    console.log('Raw page JSON length:', rawString.length);
    
    // Search for itag in the raw JSON
    const index = rawString.indexOf('"itag":315');
    if (index !== -1) {
      console.log('Found itag:315 in raw JSON, snippet:', rawString.substring(index - 100, index + 300));
    } else {
      console.log('Could not find itag:315 in raw JSON');
      // Search for any itag
      const anyItag = rawString.indexOf('"itag":');
      if (anyItag !== -1) {
        console.log('Found an itag, snippet:', rawString.substring(anyItag - 50, anyItag + 200));
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
