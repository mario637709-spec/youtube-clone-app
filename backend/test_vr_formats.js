// Check all formats ANDROID_VR returns (any adaptive/quality?)
async function main() {
  const videoId = process.argv[2] || 'dQw4w9WgXcQ';
  const { Innertube } = await import('youtubei.js');

  const yt = await Innertube.create({
    generate_session_locally: true,
    retrieve_player: false,
    client_type: 'ANDROID_VR',
  });
  const info = await yt.getBasicInfo(videoId, 'ANDROID_VR');
  const sd = info.streaming_data;
  console.log('formats:', sd?.formats?.length || 0);
  for (const f of sd?.formats || []) {
    console.log(`  itag=${f.itag} mime=${f.mime_type?.split(';')[0]} url=${!!f.url} cipher=${!!f.signature_cipher} q=${f.quality_label || f.quality || ''} h=${f.height || 0}`);
  }
  console.log('adaptive:', sd?.adaptiveFormats?.length || 0);
  for (const f of (sd?.adaptiveFormats || []).slice(0, 15)) {
    console.log(`  itag=${f.itag} mime=${f.mime_type?.split(';')[0]} url=${!!f.url} cipher=${!!f.signature_cipher} q=${f.quality_label || ''} h=${f.height || 0} a=${f.has_audio} v=${f.has_video}`);
  }
}

main();
