// Test: inspect raw streaming data keys in youtubei.js response
async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    
    // Let's look at the raw player response
    const rawResponse = info.page?.[1]?.response || info.page?.[0]?.response || info.page || {};
    console.log('Raw response keys:', Object.keys(rawResponse));
    if (rawResponse.streamingData) {
      console.log('Raw streamingData keys:', Object.keys(rawResponse.streamingData));
      const rawAdaptive = rawResponse.streamingData.adaptiveFormats || [];
      console.log('Raw adaptive formats count:', rawAdaptive.length);
      if (rawAdaptive.length > 0) {
        const first = rawAdaptive[0];
        console.log('First raw adaptive format fields:', Object.keys(first));
        console.log('First raw adaptive signatureCipher:', first.signatureCipher ? first.signatureCipher.substring(0, 100) : null);
        console.log('First raw adaptive url:', first.url ? first.url.substring(0, 100) : null);
        console.log('First raw adaptive cipher:', first.cipher ? first.cipher.substring(0, 100) : null);
      }
    } else {
      console.log('No streamingData in rawResponse');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
