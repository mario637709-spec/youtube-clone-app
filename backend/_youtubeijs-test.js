const https = require('https');

const test = (url, start, end) => new Promise((resolve) => {
  const req = https.request(url, { headers: { Range: 'bytes=' + start + '-' + end, 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; if (n > 50000) req.destroy(); });
    res.on('end', () => resolve(res.statusCode + ' read=' + n + ' cr=' + (res.headers['content-range'] || '').slice(0, 45)));
    res.on('error', () => resolve('ERR(read=' + n + ')'));
  });
  req.on('error', () => resolve('FAIL'));
  req.end();
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { Innertube } = require('youtubei.js');
  const yt = await Innertube.create({ retrieve_player: true });

  for (const id of ['muLA_Y-1iR0', '-GBBZid25m8']) {
    try {
      const info = await yt.getInfo(id);
      const sd = info.streaming_data;
      if (!sd || !sd.formats || sd.formats.length === 0) { console.log(id, 'no streaming_data'); continue; }
      const f = sd.formats.find(f => f.has_video && f.has_audio) || sd.formats[0];
      console.log(id, '| format itag:', f.itag, '| has url field:', !!f.url);
      let url = null;
      try {
        url = f.decipher(yt.session.player);
        console.log('   deciphered:', url.slice(0, 60));
      } catch (e) {
        console.log('   decipher ERR:', e.message.slice(0, 60), '| raw url:', (f.url || '').slice(0, 60));
        url = f.url;
      }
      if (!url) continue;
      const q = new URL(url);
      console.log('   has pot:', q.searchParams.has('pot'), '| has n:', q.searchParams.has('n'), '| has pot param value len:', (q.searchParams.get('pot') || '').length);
      const r0 = await test(url, 0, 2097151);
      await sleep(5000);
      const rD = await test(url, 104857600, 106954751);
      await sleep(5000);
      const rM = await test(url, 19922944, 22020095);
      console.log('   range0:', r0, '| deep100M:', rD, '| 19-21M:', rM);
    } catch (e) {
      console.log(id, 'ERR:', e.message.slice(0, 100));
    }
  }
})();
