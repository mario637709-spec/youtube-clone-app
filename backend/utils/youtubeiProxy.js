const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Fetch player configuration by directly fetching the YouTube Watch HTML page.
 * This completely bypasses the BotGuard / PO token requirements imposed by the
 * youtubei/v1/player API endpoint, providing the raw streamingData and jsUrl instantly.
 */
exports.fetchPlayerConfig = async (videoId, poToken, visitorData, userAgent = '', clientIp = '') => {
  const headers = {
    'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  if (clientIp) {
    headers['X-Forwarded-For'] = clientIp;
  }

  try {
    // 1. Fetch HTML to get the latest base.js URL
    const htmlResponse = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: headers,
      timeout: 10000
    });

    const html = htmlResponse.data;
    let jsUrl = '';
    const jsMatch = html.match(/"jsUrl":"([^"]+)"/) || html.match(/"js":"([^"]+)"/) || html.match(/"PLAYER_JS_URL":"([^"]+)"/);
    if (jsMatch) {
      jsUrl = jsMatch[1].startsWith('/') ? `https://www.youtube.com${jsMatch[1]}` : jsMatch[1];
    } else {
      const manualMatch = html.match(/\/s\/player\/[^\/]+\/player_ias\.vflset\/[^\/]+\/base\.js/);
      if (manualMatch) jsUrl = `https://www.youtube.com${manualMatch[0]}`;
    }

    let playerResponse;
    let apiKey = '';
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    if (apiKeyMatch) {
      apiKey = apiKeyMatch[1];
    }
    
    let sts = 20000;
    const stsMatch = html.match(/"sts":(\d+)/);
    if (stsMatch) sts = parseInt(stsMatch[1], 10);

    // 2. If PO Token is provided, fetch via the youtubei API to unlock BotGuard streams
    if (poToken && visitorData && apiKey) {
      console.log(`[youtubeiProxy] Using PO Token for API request with API Key and sts=${sts}...`);

      // Try WEB client first (most compatible with PO tokens)
      const webClientVersion = '2.20250606.01.00';
      let apiResponse;
      try {
        apiResponse = await axios.post(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
          context: {
            client: {
              hl: 'en',
              gl: 'US',
              clientName: 'WEB',
              clientVersion: webClientVersion,
              visitorData: visitorData,
              userAgent: headers['User-Agent']
            }
          },
          videoId: videoId,
          playbackContext: {
            contentPlaybackContext: {
              signatureTimestamp: sts,
              html5Preference: 'HTML5_PREF_WANTS'
            }
          },
          serviceIntegrityDimensions: {
            poToken: poToken
          }
        }, {
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            'Origin': 'https://www.youtube.com',
            'Referer': `https://www.youtube.com/watch?v=${videoId}`,
            'X-Youtube-Client-Name': '1',
            'X-Youtube-Client-Version': webClientVersion
          }
        });

        // Validate response is playable
        if (apiResponse.data?.playabilityStatus?.status !== 'OK') {
          throw new Error(`WEB client returned: ${apiResponse.data?.playabilityStatus?.status || 'unknown'}`);
        }
      } catch (webErr) {
        console.warn(`[youtubeiProxy] WEB client failed (${webErr.message}), trying ANDROID client...`);
        // ANDROID client does NOT require PO Token and bypasses BotGuard
        apiResponse = await axios.post('https://www.youtube.com/youtubei/v1/player', {
          context: {
            client: {
              hl: 'en',
              gl: 'US',
              clientName: 'ANDROID',
              clientVersion: '19.44.38',
              androidSdkVersion: 34,
              userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
              osName: 'Android',
              osVersion: '14'
            }
          },
          videoId: videoId,
          params: 'CgIQBg==',  // Required for ANDROID to get streaming data
          playbackContext: {
            contentPlaybackContext: {
              signatureTimestamp: sts,
              html5Preference: 'HTML5_PREF_WANTS'
            }
          }
        }, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
            'X-Youtube-Client-Name': '3',
            'X-Youtube-Client-Version': '19.44.38'
          }
        });
      }
      
      playerResponse = apiResponse.data;
    } else {
      // Fallback to extracting from HTML if no PO Token or API Key
      const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
      if (!match) throw new Error('ytInitialPlayerResponse not found in HTML');
      playerResponse = JSON.parse(match[1]);
    }

    // Attach base.js URL to the payload
    if (jsUrl) {
      playerResponse.assets = { js: jsUrl };
    }

    return playerResponse;
  } catch (error) {
    console.error('[youtubeiProxy] Failed to extract config:', error.message);
    throw error;
  }
};
