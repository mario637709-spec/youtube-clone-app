// Deep test ANDROID_VR
async function main() {
  const videoId = process.argv[2] || 'dQw4w9WgXcQ';
  const { Innertube } = await import('youtubei.js');

  const yt = await Innertube.create({
    generate_session_locally: true,
    retrieve_player: false,
    client_type: 'ANDROID_VR',
  });
  const info = await yt.getBasicInfo(videoId);
  const sd = info.streaming_data;
  console.log('playability:', info.playability_status?.status);
  console.log('formats:', sd?.formats?.length || 0, '| adaptive:', sd?.adaptiveFormats?.length || 0);
  for (const f of sd?.formats || []) {
    console.log(`  itag=${f.itag} mime=${f.mime_type?.split(';')[0]} url=${!!f.url} cipher=${!!f.signature_cipher}`);
  }
  for (const f of (sd?.adaptiveFormats || []).slice(0, 8)) {
    console.log(`  itag=${f.itag} mime=${f.mime_type?.split(';')[0]} url=${!!f.url} cipher=${!!f.signature_cipher} q=${f.quality_label || ''}`);
  }
  const first = sd?.formats?.[0];
  if (first?.url) console.log('SAMPLE URL:', first.url.substring(0, 150));
}

main();
