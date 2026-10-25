async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const formats = info.streaming_data?.formats || [];
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    
    console.log('--- COMBINED FORMATS ---');
    formats.forEach(f => {
      console.log(`itag: ${f.itag}, quality: ${f.quality_label || f.quality}, hasUrl: ${!!f.url}, hasCipher: ${!!(f.signature_cipher || f.cipher || f.signatureCipher)}`);
    });
    
    console.log('--- ADAPTIVE FORMATS ---');
    adaptiveFormats.slice(0, 5).forEach(f => {
      console.log(`itag: ${f.itag}, mime: ${f.mime_type}, hasUrl: ${!!f.url}, hasCipher: ${!!(f.signature_cipher || f.cipher || f.signatureCipher)}`);
    });
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
