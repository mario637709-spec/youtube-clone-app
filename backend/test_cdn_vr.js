// Test: fetch ANDROID_VR URL from CDN — does it return bytes?
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
  const f = sd?.formats?.[0];
  if (!f?.url) { console.log('no url'); return; }
  console.log('URL:', f.url.substring(0, 120));

  // Try IPv4 forced
  const url = new URL(f.url);
  url.host = url.host.replace(/\.googlevideo\.com/, '.googlevideo.com');
  const forced = new URL(f.url);
  const ipv6 = forced.searchParams.get('ip')?.startsWith('2401') || forced.searchParams.get('ip')?.includes(':');
  console.log('is IPv6 in URL:', ipv6);

  // Fetch with range to check bytes
  const res = await fetch(f.url, {
    headers: { Range: 'bytes=0-2048', 'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.52.26 (Linux; U; Android 12; eureka_user 1.52.26.0) gzip' }
  });
  console.log('CDN status:', res.status);
  console.log('content-type:', res.headers.get('content-type'));
  console.log('content-range:', res.headers.get('content-range'));
  const buf = await res.arrayBuffer();
  console.log('bytes received:', buf.byteLength);
}

main();
