const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseCount = (text) => {
  if (!text) return 0;
  const cleaned = String(text).replace(/,/g, '').trim();
  const m = cleaned.match(/^([\d.]+)\s*([KMB]?)/i);
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') return Math.round(num * 1e3);
  if (suffix === 'M') return Math.round(num * 1e6);
  if (suffix === 'B') return Math.round(num * 1e9);
  return Math.round(num);
};

(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await axios.get('https://www.youtube.com/results', {
        params: { search_query: 'indian youtuber', sp: 'EgIQAg%3D%3D' },
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 25000,
      });
      console.log('status:', res.status, 'html len:', res.data.length);
      const m = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
      if (!m) { console.log('NO ytInitialData — bot check?'); continue; }
      const data = JSON.parse(m[1]);
      const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      let n = 0;
      for (const section of contents) {
        const items = section?.itemSectionRenderer?.contents || [];
        for (const item of items) if (item.channelRenderer) n++;
      }
      console.log('channelRenderer count:', n);
      break;
    } catch (err) {
      console.log('ERR:', err.message);
      await sleep(3000);
    }
  }
})();