const { Innertube, UniversalCache } = require('youtubei.js');
async function test() {
  const yt = await Innertube.create({ cache: new UniversalCache(false) });
  const player = yt.session.player;
  console.log('Player keys:', Object.keys(player));
  console.log('Player sig_decipher_sc:', player.sig_decipher_sc ? 'Exists' : 'No');
  console.log('Player ntoken_decipher_sc:', player.ntoken_decipher_sc ? 'Exists' : 'No');
  
  // Also try printing any property that has 'decipher' in its name
  for (const key in player) {
    if (key.includes('decipher') || key.includes('sc') || key.includes('sig')) {
      console.log(`Key ${key}:`, typeof player[key]);
    }
  }
}
test();
