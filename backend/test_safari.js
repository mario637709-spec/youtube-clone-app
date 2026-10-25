// Test web_safari + TV clients
async function main() {
  const videoId = process.argv[2] || 'dQw4w9WgXcQ';
  const { Innertube } = await import('youtubei.js');

  for (const clientType of ['WEB_SAFARI', 'MWEB', 'TV_SIMPLY']) {
    try {
      const yt = await Innertube.create({
        generate_session_locally: true,
        retrieve_player: false,
        client_type: clientType,
      });
      const info = await yt.getBasicInfo(videoId);
      const sd = info.streaming_data;
      console.log(`[${clientType}] playability:`, info.playability_status?.status, '| reason:', info.playability_status?.reason, '| formats:', sd?.formats?.length || 0, '| adaptive:', sd?.adaptiveFormats?.length || 0, '| hls:', !!sd?.hls_manifest_url);
      for (const f of (sd?.formats || []).slice(0, 5)) {
        console.log(`  itag=${f.itag} mime=${f.mime_type?.split(';')[0]} url=${!!f.url} cipher=${!!f.signature_cipher} q=${f.quality_label || f.quality || ''}`);
      }
      if (sd?.hls_manifest_url) console.log('  HLS:', sd.hls_manifest_url.substring(0, 120));
    } catch (err) {
      console.log(`[${clientType}] FAILED:`, err.message?.substring(0, 120));
    }
  }
}

main();
