// Test: Get raw streaming data from youtubei.js and check if it has cipher data
async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const formats = info.streaming_data?.formats || [];
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    
    console.log('Formats:', formats.length, 'Adaptive:', adaptiveFormats.length);
    
    if (formats.length > 0) {
      const f = formats[0];
      console.log('Format[0]: itag=' + f.itag + ' mimeType=' + f.mime_type + ' has url=' + !!f.url);
      // Check if raw data has cipher
      const raw = f;
      console.log('Raw keys:', Object.keys(raw).filter(k => k.includes('cipher') || k.includes('sign') || k.includes('url')));
    }
    
    // Access the underlying raw player data
    const raw = info.page?.[1]?.response?.streamingData || info.page?.[0]?.player_config || info.basic_info;
    console.log('Player URL:', yt.session.player?.url);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
