// Test: inspect raw format data from youtubei.js
async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    
    console.log('Total adaptive formats:', adaptiveFormats.length);
    
    if (adaptiveFormats.length > 0) {
      const f = adaptiveFormats[0];
      console.log('Format fields:');
      console.log('  url:', f.url ? f.url.substring(0, 80) : null);
      console.log('  signature_cipher:', f.signature_cipher ? f.signature_cipher.substring(0, 100) : null);
      console.log('  cipher:', f.cipher ? f.cipher.substring(0, 100) : null);
      console.log('  itag:', f.itag);
      console.log('  mime_type:', f.mime_type);
      
      // Show all defined properties
      const defined = Object.entries(f).filter(([k, v]) => v !== undefined && v !== null && v !== false && v !== 0 && k !== 'has_audio' && k !== 'has_video' && k !== 'has_text');
      console.log('\nAll defined non-zero fields:', defined.map(([k]) => k).join(', '));
    }
    
    // Check if the player data is available
    console.log('\nPlayer data:', {
      url: yt.session.player?.url,
      hasData: !!yt.session.player?.data,
      dataType: typeof yt.session.player?.data
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
