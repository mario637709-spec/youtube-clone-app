const https = require('https');

const { generate } = require('youtube-po-token-generator');

const WEB_EMBEDDED_CLIENT = {
  clientName: 'WEB_EMBEDDED_PLAYER',
  clientVersion: '1.20260807.00.00',
  clientScreen: 'EMBED',
  hl: 'en',
};

const post = (url, body, headers) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    timeout: 20000,
  }, (res) => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => resolve({ status: res.statusCode, body: raw }));
  });
  req.on('error', reject);
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.write(data);
  req.end();
});

const test = (url, start, end) => new Promise((resolve) => {
  const req = https.request(url, { headers: { Range: 'bytes=' + start + '-' + end, 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; if (n > 50000) req.destroy(); });
    res.on('end', () => resolve(res.statusCode + ' read=' + n + ' cr=' + (res.headers['content-range']||'').slice(0,45)));
    res.on('error', () => resolve('ERR(read=' + n + ')'));
  });
  req.on('error', () => resolve('FAIL'));
  req.end();
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let po;
  try {
    const { visitorData, poToken } = await generate();
    po = { visitorData, poToken };
    console.log('poToken generated OK:', poToken.slice(0, 30) + '...');
  } catch (e) {
    console.log('poToken generation FAILED:', e.message);
    return;
  }

  for (const id of ['muLA_Y-1iR0', '-GBBZid25m8']) {
    try {
      const { status, body } = await post('https://www.youtube.com/youtubei/v1/player', {
        context: {
          client: { ...WEB_EMBEDDED_CLIENT, visitorData: po.visitorData },
          thirdParty: { embedUrl: 'https://www.youtube.com/embed/' + id },
        },
        serviceIntegrityDimensions: { poToken: po.poToken },
        videoId: id,
      }, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'X-Youtube-Client-Name': '56',
        'X-Youtube-Client-Version': WEB_EMBEDDED_CLIENT.clientVersion,
        'Accept-Language': 'en-US,en;q=0.9',
      });
      const d = JSON.parse(body);
      const st = d.playabilityStatus;
      console.log(id, '→ HTTP', status, '| status:', st?.status, '| reason:', (st?.reason || '').slice(0, 60));
      if (st?.status === 'OK') {
        const f = d.streamingData?.formats?.find(x => x.url) || d.streamingData?.adaptiveFormats?.find(x => x.url);
        if (f?.url) {
          console.log('   itag:', f.itag, '| pot in URL:', f.url.includes('pot='), '| n in URL:', new URL(f.url).searchParams.has('n'));
          console.log('   range0:', await test(f.url, 0, 2097151));
          await sleep(6000);
          console.log('   deep:', await test(f.url, 104857600, 106954751));
          await sleep(6000);
          console.log('   19-21MiB:', await test(f.url, 19922944, 22020095));
        } else {
          console.log('   NO direct URL — encrypted:', JSON.stringify(Object.keys(d.streamingData || {})).slice(0, 120));
        }
      }
    } catch (e) {
      console.log(id, '→ ERR:', e.message);
    }
    await sleep(4000);
  }
})();
