// Test: Get raw streaming data from youtubei.js including signature ciphers
// and manually decipher using our own Node.js implementation
async function main() {
  try {
    const { Innertube, Platform } = await import('youtubei.js');
    
    // Override the eval to debug what's going wrong
    const origEval = Platform.shim.eval;
    Platform.shim.eval = async (data) => {
      console.log('Platform.shim.eval called with data keys:', Object.keys(data || {}));
      console.log('Output length:', data?.output?.length);
      try {
        const result = await origEval(data);
        console.log('eval succeeded!', typeof result);
        return result;
      } catch(e) {
        console.error('eval failed:', e.message.substring(0, 200));
        // Try our own implementation
        const script = `
          var recsCache = new Map();
          var ntc = new Map();
          ${data.output}
        `;
        return new Function(script)();
      }
    };
    
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    console.log('Player URL:', yt.session.player?.url);
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    
    console.log('Adaptive formats:', adaptiveFormats.length);
    
    const audioFmt = adaptiveFormats.find(f => f.has_audio && !f.has_video && f.mime_type?.includes('mp4a'));
    if (audioFmt && typeof audioFmt.decipher === 'function') {
      try {
        const url = await audioFmt.decipher(yt.session.player);
        console.log('Audio URL (first 100):', url.substring(0, 100));
        console.log('SUCCESS!');
      } catch(e) {
        console.error('Decipher error:', e.message);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack?.substring(0, 500));
  }
}

main();
