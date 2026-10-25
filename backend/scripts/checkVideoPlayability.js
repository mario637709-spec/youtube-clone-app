const axios = require('axios');

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.52.26',
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.52.26 (Linux; U; Android 12; eureka_user 1.52.26.0) gzip',
  osName: 'Android',
  osVersion: '12',
};

const ENDPOINTS = [
  'https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player',
  'https://www.youtube.com/youtubei/v1/player',
];

async function checkVideo(videoId) {
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await axios.post(endpoint, {
        context: { client: ANDROID_VR_CLIENT },
        videoId,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ANDROID_VR_CLIENT.userAgent,
          'X-Youtube-Client-Name': '28',
          'X-Youtube-Client-Version': ANDROID_VR_CLIENT.clientVersion,
        },
        timeout: 5000,
      });
      const data = response.data;
      const playability = data?.playabilityStatus;
      const status = playability?.status || 'UNKNOWN';
      const reason = playability?.reason || playability?.errorScreen?.playerErrorMessageRenderer?.reason?.runs?.map(r => r.text).join(' ') || '';
      return { status, reason };
    } catch (e) {
      // try next endpoint
    }
  }
  return { status: 'ERROR', reason: 'all endpoints failed' };
}

(async () => {
  const videoId = process.argv[2] || 'eQAK2H9Tiz8';
  const result = await checkVideo(videoId);
  console.log(JSON.stringify(result, null, 2));
})();
