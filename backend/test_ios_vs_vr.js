// Compare: IOS URL vs ANDROID_VR URL against CDN
async function main() {
  const videoId = process.argv[2] || 'dQw4w9WgXcQ';
  const { Innertube } = await import('youtubei.js');

  // IOS
  try {
    const yt = await Innertube.create({
      generate_session_locally: true,
      retrieve_player: false,
      client_type: 'IOS',
    });
    const info = await yt.getBasicInfo(videoId);
    const sd = info.streaming_data;
    console.log('IOS playability:', info.playability_status?.status, '| formats:', sd?.formats?.length || 0, '| adaptive:', sd?.adaptiveFormats?.length || 0);
    const f = [...(sd?.formats || []), ...(sd?.adaptiveFormats || [])].find(x => x.url);
    if (f) {
      const res = await fetch(f.url, { headers: { Range: 'bytes=0-2048' } });
      console.log('IOS CDN:', res.status, res.headers.get('content-type'));
      const buf = await res.arrayBuffer();
      console.log('IOS bytes:', buf.byteLength);
    }
  } catch (e) {
    console.log('IOS FAILED:', e.message?.substring(0, 100));
  }

  // ANDROID_VR
  try {
    const yt = await Innertube.create({
      generate_session_locally: true,
      retrieve_player: false,
      client_type: 'ANDROID_VR',
    });
    const info = await yt.getBasicInfo(videoId);
    const sd = info.streaming_data;
    const f = [...(sd?.formats || []), ...(sd?.adaptiveFormats || [])].find(x => x.url);
    if (f) {
      const res = await fetch(f.url, { headers: { Range: 'bytes=0-2048' } });
      console.log('VR CDN:', res.status, res.headers.get('content-type'));
      const buf = await res.arrayBuffer();
      console.log('VR bytes:', buf.byteLength);
    }
  } catch (e) {
    console.log('VR FAILED:', e.message?.substring(0, 100));
  }
}

main();
