const https = require('https');

const CLIENTS = [
  { name: 'ANDROID', clientName: 'ANDROID', clientVersion: '19.09.37', userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', osName: 'Android', osVersion: '11', clientId: 3 },
  { name: 'ANDROID_EMBEDDED', clientName: 'ANDROID_EMBEDDED_PLAYER', clientVersion: '19.09.37', userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', osName: 'Android', osVersion: '11', clientId: 55 },
  { name: 'TVHTML5', clientName: 'TVHTML5', clientVersion: '7.20250704.22.00', userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version', osName: 'Linux', osVersion: '6.1', clientId: 7 },
  { name: 'TVHTML5_SIMPLY', clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version', osName: 'Linux', osVersion: '6.1', clientId: 85 },
  { name: 'MWEB', clientName: 'MWEB', clientVersion: '2.20240708.00.00', userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36', osName: 'Android', osVersion: '12', clientId: 62 },
  { name: 'WEB_EMBED', clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20260807.00.00', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', clientId: 56, screen: 'EMBED' },
  { name: 'ANDROID_VR', clientName: 'ANDROID_VR', clientVersion: '1.52.26', userAgent: 'com.google.android.apps.youtube.vr.oculus/1.52.26 (Linux; U; Android 12; eureka_user 1.52.26.0) gzip', osName: 'Android', osVersion: '12', clientId: 28 },
  { name: 'IOS', clientName: 'IOS', clientVersion: '20.42.4', userAgent: 'com.google.ios.youtube/20.42.4 (iPhone17,2; U; CPU iOS 18_3_1 like Mac OS X)', osName: 'iPhone', osVersion: '18.3.1', clientId: 5 },
  { name: 'WEB_MUSIC', clientName: 'WEB_REMIX', clientVersion: '1.20260807.01.00', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', clientId: 67 },
];

const post = (url, body, headers) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    timeout: 15000,
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
    res.on('end', () => resolve(res.statusCode));
    res.on('error', () => resolve('ERR' + n));
  });
  req.on('error', () => resolve('FAIL'));
  req.end();
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  for (const c of CLIENTS) {
    try {
      const ctx = { client: { clientName: c.clientName, clientVersion: c.clientVersion, hl: 'en' } };
      if (c.screen) ctx.client.clientScreen = c.screen;
      if (c.userAgent) {
        ctx.client.osName = c.osName;
        ctx.client.osVersion = c.osVersion;
      }
      const { status, body } = await post('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', { context: ctx, videoId: 'muLA_Y-1iR0' }, {
        'User-Agent': c.userAgent,
        'X-Youtube-Client-Name': String(c.clientId),
        'X-Youtube-Client-Version': c.clientVersion,
        'Content-Type': 'application/json',
      });
      let d;
      try { d = JSON.parse(body); } catch { console.log(c.name.padEnd(20), 'HTTP', status, 'non-JSON'); continue; }
      const st = d.playabilityStatus;
      const f = d.streamingData?.formats?.find(x => x.url) || d.streamingData?.adaptiveFormats?.find(x => x.url);
      const hasUrl = !!f?.url;
      const n = f?.url ? new URL(f.url).searchParams.has('n') : null;
      console.log(c.name.padEnd(20), '| status:', (st?.status || '?').padEnd(10), '| reason:', (st?.reason || st?.errorScreen?.playerErrorMessageRenderer?.reason || '-').slice(0, 35), '| url:', hasUrl, n === null ? '' : 'n=' + n);
      if (st?.status === 'OK' && hasUrl) {
        const r0 = await test(f.url, 0, 2097151);
        await sleep(5000);
        const rD = await test(f.url, 104857600, 106954751);
        console.log('        deep-range:', r0 + ' (0MiB)', rD + ' (100MiB)');
        await sleep(5000);
      }
    } catch (e) {
      console.log(c.name.padEnd(20), 'ERR:', e.message.slice(0, 50));
    }
    await sleep(2000);
  }
})();
