// Test: Get raw streaming data from youtubei.js including signature ciphers
async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    
    console.log('Adaptive formats:', adaptiveFormats.length);
    console.log('Player URL:', yt.session.player?.url);
    
    // Get a video-only format
    const videoFmt = adaptiveFormats.find(f => f.has_video && !f.has_audio);
    if (videoFmt) {
      console.log('\nVideo format:');
      console.log('  itag:', videoFmt.itag);
      console.log('  mime_type:', videoFmt.mime_type);
      console.log('  has url:', !!videoFmt.url);
      console.log('  has decipher:', typeof videoFmt.decipher === 'function');
      
      // Check raw_data if available
      if (videoFmt.raw_data) {
        const raw = videoFmt.raw_data;
        console.log('  raw_data keys:', Object.keys(raw));
        if (raw.signatureCipher || raw.cipher) {
          console.log('  HAS CIPHER in raw_data!');
        }
      }
      
      // Try deciphering
      if (typeof videoFmt.decipher === 'function') {
        try {
          const url = await videoFmt.decipher(yt.session.player);
          console.log('\nDeciphered URL (first 100):', url.substring(0, 100));
        } catch(e) {
          console.error('Decipher error:', e.message);
        }
      }
    }
    
    // Check audio format
    const audioFmt = adaptiveFormats.find(f => f.has_audio && !f.has_video && f.mime_type?.includes('mp4a'));
    if (audioFmt) {
      console.log('\nAudio format:');
      console.log('  itag:', audioFmt.itag);
      console.log('  mime_type:', audioFmt.mime_type);
      console.log('  has url:', !!audioFmt.url);
      console.log('  has decipher:', typeof audioFmt.decipher === 'function');
      
      if (typeof audioFmt.decipher === 'function') {
        try {
          const url = await audioFmt.decipher(yt.session.player);
          console.log('Audio deciphered URL (first 100):', url.substring(0, 100));
        } catch(e) {
          console.error('Audio decipher error:', e.message);
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
}

main();
