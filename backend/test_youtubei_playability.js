// Test: print playability status in youtubei.js
async function main() {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    console.log('Playability status:', JSON.stringify(info.playability_status || {}));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
