// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// innertubeDecipher.ts — TIER 1: youtubei.js, DIRECT FROM DEVICE
// ───────────────────────────────────────────────────────────────────
// The library is imported DYNAMICALLY. Its circular class graph used to
// crash the watch page at startup ("Cannot access 'b' before
// initialization") when it was a static import. Now, if the chunk fails
// to initialize, the import rejects and the player simply moves on to
// Tier 2 / the official iframe.
//
// youtubei.js requests go to www.youtube.com through nativeFetch:
// CapacitorHttp on Android/iOS (device IP, no CORS), plain fetch on web.
// ───────────────────────────────────────────────────────────────────

import { nativeFetch } from './youtubeDirect';

let ytInstance = null;
let ytInstanceKey = '';
let ytInstanceCreatedAt = 0;
const INSTANCE_TTL = 30 * 60 * 1000;

const buildQualityLabel = (height) => (height ? `${height}p` : 'auto');

export const getAllDecryptedFormats = async (videoId, poToken, visitorData) => {
  try {
    const { Innertube, UniversalCache, Platform } = await import('youtubei.js/web');

    // youtubei.js needs a JS evaluator for the player's decipher code.
    if (Platform?.shim) {
      Platform.shim.eval = async (data) => {
        // eslint-disable-next-line no-new-func
        return new Function(data.output)();
      };
      Platform.shim.fetch = nativeFetch;
    }

    const instanceKey = `${poToken || ''}|${visitorData || ''}`;
    const now = Date.now();
    if (!ytInstance || ytInstanceKey !== instanceKey || now - ytInstanceCreatedAt > INSTANCE_TTL) {
      console.log('[innertubeDecipher] creating youtubei.js instance (dynamic import)', {
        hasPoToken: !!poToken,
        hasVisitorData: !!visitorData
      });
      const config = {
        generate_session_locally: true,
        retrieve_player: true,
        cache: new UniversalCache(false),
        fetch: nativeFetch
      };
      if (poToken) config.po_token = poToken;
      if (visitorData) config.visitor_data = visitorData;

      ytInstance = await Innertube.create(config);
      ytInstanceKey = instanceKey;
      ytInstanceCreatedAt = now;
    }

    const info = await ytInstance.getBasicInfo(videoId);
    const formats = info?.streaming_data?.formats || [];
    const adaptiveFormats = info?.streaming_data?.adaptive_formats || [];

    const fullQualityMap = {};
    let bestUrl = null;
    let bestQuality = null;
    let audioUrl = null;

    const processFormat = async (format, type) => {
      let url = format.url;
      if (!url && typeof format.decipher === 'function') {
        url = await format.decipher(ytInstance.session.player);
      }
      if (!url) return null;
      const height = format.height || 0;
      return {
        url,
        qualityLabel: buildQualityLabel(height),
        height,
        type
      };
    };

    // Combined (video + audio) formats first: they need no second element.
    for (const format of formats) {
      const res = await processFormat(format, 'combined');
      if (!res) continue;
      if (!bestUrl) {
        bestUrl = res.url;
        bestQuality = res.qualityLabel;
      }
      if (!fullQualityMap[res.qualityLabel]) {
        fullQualityMap[res.qualityLabel] = { url: res.url, type: 'combined' };
      }
    }

    // Adaptive video, prefer H.264 where available.
    const adaptiveVideo = adaptiveFormats.filter((f) => String(f.mime_type || '').startsWith('video/'));
    const h264Video = adaptiveVideo.filter((f) => String(f.mime_type || '').includes('avc1'));
    const videoList = h264Video.length ? h264Video : adaptiveVideo;

    for (const format of videoList) {
      const res = await processFormat(format, 'video_only');
      if (!res) continue;
      if (!fullQualityMap[res.qualityLabel] || fullQualityMap[res.qualityLabel].type !== 'combined') {
        fullQualityMap[res.qualityLabel] = { url: res.url, type: 'video_only' };
      }
      if (!bestUrl) {
        bestUrl = res.url;
        bestQuality = res.qualityLabel;
      }
    }

    // Audio, prefer AAC.
    const adaptiveAudio = adaptiveFormats.filter((f) => String(f.mime_type || '').startsWith('audio/'));
    const aacAudio = adaptiveAudio.filter((f) => String(f.mime_type || '').includes('mp4a'));
    for (const format of (aacAudio.length ? aacAudio : adaptiveAudio)) {
      const res = await processFormat(format, 'audio_only');
      if (res?.url) {
        audioUrl = res.url;
        break;
      }
    }

    if (!bestUrl) throw new Error('youtubei.js: no playable formats');

    return {
      bestUrl,
      bestQuality,
      audioUrl,
      fullQualityMap
    };
  } catch (err) {
    console.warn('[innertubeDecipher] Tier 1 unavailable:', err?.message || err);
    return null;
  }
};

export default { getAllDecryptedFormats };
