// Test ANDROID_VR via SANDBOX endpoint from Node
async function main() {
  const videoId = process.argv[2] || 'dQw4w9WgXcQ';
  const body = {
    videoId,
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.52.26',
        hl: 'en',
        gl: 'US',
        userAgent: 'com.google.android.apps.youtube.vr.oculus/1.52.26 (Linux; U; Android 12; eureka_user 1.52.26.0) gzip',
        osName: 'Android',
        osVersion: '12'
      }
    }
  };

  for (const url of [
    'https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player',
    'https://www.youtube.com/youtubei/v1/player',
  ]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const f = (data.streamingData?.formats || []).find(x => x.url);
      console.log(url.includes('sandbox') ? '[SANDBOX]' : '[WWW]', '| status:', res.status, '| playability:', data.playabilityStatus?.status, '| url:', !!f);
      if (f) {
        const cdn = await fetch(f.url, { headers: { Range: 'bytes=0-2048' } });
        console.log('   CDN:', cdn.status, cdn.headers.get('content-type'));
        const buf = await cdn.arrayBuffer();
        console.log('   bytes:', buf.byteLength);
        break;
      }
    } catch (e) {
      console.log(url.includes('sandbox') ? '[SANDBOX]' : '[WWW]', 'ERROR:', e.message?.substring(0, 100));
    }
  }
}

main();
