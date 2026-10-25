// Test: WEB_EMBEDDED_PLAYER client without PO token via youtubei.js
async function main() {
  try {
    const { Innertube, Platform } = await import('youtubei.js');

    const yt = await Innertube.create({
      generate_session_locally: true,
      retrieve_player: false,
      client_type: 'WEB_EMBEDDED',
    });

    const info = await yt.getBasicInfo('dQw4w9WgXcQ');
    const sd = info.streaming_data;
    console.log('playability:', info.playability_status?.status);
    console.log('reason:', info.playability_status?.reason);
    console.log('Formats:', sd?.formats?.length || 0, 'Adaptive:', sd?.adaptiveFormats?.length || 0);

    const adaptiveFormats = sd?.adaptiveFormats || [];
    if (adaptiveFormats.length > 0) {
      const f = adaptiveFormats.find(f => f.has_audio && !f.has_video) || adaptiveFormats[0];
      console.log('Sample format:', f.itag, f.mime_type?.split(';')[0], f.quality_label || '');
      if (f.url) console.log('URL:', f.url.substring(0, 120));
      else if (f.signature_cipher) console.log('signature_cipher present (needs decipher)');
      else console.log('NO URL and NO cipher!');
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack?.substring(0, 400));
  }
}

main();
