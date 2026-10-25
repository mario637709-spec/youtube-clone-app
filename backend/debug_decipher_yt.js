async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    
    const clients = ['WEB', 'ANDROID', 'TV_HTML5', 'WEB_EMBEDDED'];
    
    for (const clientName of clients) {
      try {
        console.log(`--- TESTING CLIENT: ${clientName} ---`);
        const config = { generate_session_locally: true, retrieve_player: true };
        // In youtubei.js, we can override the default client in session or use getBasicInfo options
        const yt = await Innertube.create(config);
        
        // Force the client type in the session
        yt.session.context.client.clientName = clientName;
        if (clientName === 'ANDROID') {
          yt.session.context.client.clientVersion = '19.02.39';
        } else if (clientName === 'TV_HTML5') {
          yt.session.context.client.clientVersion = '7.20260101.01.00';
        } else if (clientName === 'WEB_EMBEDDED') {
          yt.session.context.client.clientName = 'WEB_EMBEDDED_PLAYER';
          yt.session.context.client.clientVersion = '1.20260101.01.00';
        }

        const info = await yt.getBasicInfo('f8rvVxDENIs');
        const formats = info.streaming_data?.formats || [];
        const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
        const formatsToTest = [...formats, ...adaptiveFormats];
        
        const hasUrl = formatsToTest.some(f => f.url);
        const hasCipher = formatsToTest.some(f => f.signature_cipher || f.cipher);
        
        console.log(`Formats count: ${formatsToTest.length}, hasUrl: ${hasUrl}, hasCipher: ${hasCipher}`);
      } catch (err) {
        console.error(`Client ${clientName} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
