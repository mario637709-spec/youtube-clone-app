// Test: Generate a PO token using youtube-po-token-generator and use it with youtubei.js
async function main() {
  try {
    const poTokenGen = require('youtube-po-token-generator');
    
    console.log('Generating PO token...');
    const result = await poTokenGen.generate();
    
    console.log('PO Token result:');
    console.log('  visitorData:', result.visitorData ? result.visitorData.substring(0, 50) + '...' : null);
    console.log('  poToken:', result.poToken ? result.poToken.substring(0, 50) + '...' : null);
    
    if (!result.poToken) {
      console.log('No PO token generated!');
      return;
    }
    
    console.log('\nNow trying to get streaming data with PO token...');
    const { Innertube, Platform } = await import('youtubei.js');
    
    Platform.shim.eval = async (data) => {
      const script = `
        var recsCache = new Map();
        var ntc = new Map();
        ${data.output}
      `;
      return new Function(script)();
    };
    
    const yt = await Innertube.create({
      generate_session_locally: true,
      retrieve_player: true,
      po_token: result.poToken,
      visitor_data: result.visitorData
    });
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    const formats = info.streaming_data?.formats || [];
    
    console.log('Formats:', formats.length, 'Adaptive:', adaptiveFormats.length);
    
    if (adaptiveFormats.length > 0) {
      const f = adaptiveFormats[0];
      console.log('First adaptive:');
      console.log('  url:', f.url ? f.url.substring(0, 80) : null);
      console.log('  signature_cipher:', f.signature_cipher ? f.signature_cipher.substring(0, 100) : null);
    }
    
    // Try deciphering audio
    const audioFmt = adaptiveFormats.find(f => f.has_audio && !f.has_video);
    if (audioFmt && typeof audioFmt.decipher === 'function') {
      try {
        const url = await audioFmt.decipher(yt.session.player);
        console.log('\nAudio URL:', url.substring(0, 100));
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
