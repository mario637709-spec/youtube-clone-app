// Test clients without PO token
async function main() {
  const videoId = process.argv[2] || 'dQw4w9WgXcQ';
  const { Innertube } = await import('youtubei.js');

  const clients = ['ANDROID_VR', 'TV', 'TV_EMBEDDED', 'IOS'];

  for (const clientType of clients) {
    try {
      const yt = await Innertube.create({
        generate_session_locally: true,
        retrieve_player: false,
        client_type: clientType,
      });
      const info = await yt.getBasicInfo(videoId);
      const sd = info.streaming_data;
      console.log(`[${clientType}] playability:`, info.playability_status?.status, '| reason:', info.playability_status?.reason, '| formats:', sd?.formats?.length || 0, '| adaptive:', sd?.adaptiveFormats?.length || 0);
      const af = sd?.adaptiveFormats || [];
      if (af.length > 0) {
        const f = af.find(f => f.has_audio && !f.has_video) || af[0];
        if (f.url) console.log(`[${clientType}] URL ok:`, f.url.substring(0, 100));
        else console.log(`[${clientType}] no direct url (cipher: ${!!f.signature_cipher})`);
      }
    } catch (err) {
      console.log(`[${clientType}] FAILED:`, err.message?.substring(0, 120));
    }
  }
}

main();
