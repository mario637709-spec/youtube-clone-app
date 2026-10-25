const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
(async () => {
  const res = await axios.get('https://www.youtube.com/results', {
    params: { search_query: 'indian youtuber', sp: 'EgIQAg%3D%3D' },
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    timeout: 25000,
  });
  const match = res.data.match(/var\s+ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!match) { console.log('no ytInitialData'); return; }
  const data = JSON.parse(match[1]);
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items.slice(0, 4)) {
      console.log('KEYS:', Object.keys(item).join(','));
      const inner = Object.values(item)[0];
      console.log('  inner keys:', Object.keys(inner || {}).join(','));
      if (inner && inner.navigationEndpoint) {
        console.log('  nav:', JSON.stringify(inner.navigationEndpoint.browseEndpoint || inner.navigationEndpoint).slice(0, 200));
      }
    }
  }
})().catch((e) => console.error('ERR', e.message));