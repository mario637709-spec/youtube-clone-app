// @ts-nocheck
/**
 * YouTubei.js client-side integration.
 *
 * All requests go DIRECTLY to www.youtube.com from the device through
 * nativeFetch (CapacitorHttp on Android/iOS, plain fetch on web).
 * There is no sandbox-host mapping and no Render proxy.
 *
 * Kept as a thin compatibility helper; VideoPlayer uses
 * innertubeDecipher.ts for Tier 1.
 */

import { nativeFetch } from './youtubeDirect';

let ytInstance = null;
let ytInstanceCreatedAt = 0;
let ytInstancePoToken = '';
let ytInstanceVisitorData = '';
const YT_INSTANCE_TTL = 30 * 60 * 1000;

export async function createYtInstance(apiBase, poToken, visitorData) {
  const now = Date.now();
  const tokensChanged = ytInstancePoToken !== poToken || ytInstanceVisitorData !== visitorData;
  if (ytInstance && !tokensChanged && now - ytInstanceCreatedAt < YT_INSTANCE_TTL) {
    return ytInstance;
  }

  const { Innertube, Platform } = await import('youtubei.js/bundle/browser.js');

  if (Platform?.shim) {
    Platform.shim.eval = async (data) => {
      // eslint-disable-next-line no-new-func
      return new Function(data.output)();
    };
    Platform.shim.fetch = nativeFetch;
  }

  const instance = await Innertube.create({
    generate_session_locally: true,
    retrieve_player: true,
    ...(poToken ? { po_token: poToken } : {}),
    ...(visitorData ? { visitor_data: visitorData } : {})
  });

  ytInstance = instance;
  ytInstanceCreatedAt = now;
  ytInstancePoToken = poToken || '';
  ytInstanceVisitorData = visitorData || '';
  return instance;
}

export async function getStreamingData(videoId, apiBase, poToken, visitorData) {
  const yt = await createYtInstance(apiBase, poToken, visitorData);
  const info = await yt.getBasicInfo(videoId);
  const streamingData = info.streaming_data;
  if (!streamingData) throw new Error('No streaming data');

  const formats = [...(streamingData.formats || []), ...(streamingData.adaptive_formats || [])];
  const decipheredFormats = [];
  for (const fmt of formats) {
    try {
      const url = await fmt.decipher(yt.session.player);
      if (!url) continue;
      decipheredFormats.push({
        url,
        mimeType: fmt.mime_type,
        itag: fmt.itag,
        height: fmt.height,
        width: fmt.width,
        hasAudio: !!fmt.has_audio,
        hasVideo: !!fmt.has_video
      });
    } catch {
      // skip unplayable format
    }
  }
  return decipheredFormats;
}

export default { createYtInstance, getStreamingData };
