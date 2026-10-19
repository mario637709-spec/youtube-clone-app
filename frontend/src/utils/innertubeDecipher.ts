// @ts-nocheck
import { Innertube, UniversalCache, Platform } from 'youtubei.js/web';
import { getApiBaseUrl } from '../config';

let ytInstance = null;

// Provide JS evaluator so youtubei.js can decipher URLs in the browser
Platform.shim.eval = async (data) => {
  // eslint-disable-next-line no-new-func
  return new Function(data.output)();
};
// Map CORS-blocked production youtubei hosts to Google's CORS-enabled sandbox host
const YT_API_SANDBOX = 'https://release-youtubei.sandbox.googleapis.com/youtubei/';
const YT_API_SANDBOX_ORIGIN = 'https://release-youtubei.sandbox.googleapis.com';

const backendBase = () => getApiBaseUrl();

const sandboxFetch = async (input, init) => {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input && input.url) {
    url = input.url;
  } else if (input && input.href) {
    url = input.href;
  } else {
    url = String(input);
  }

  // youtubei.js can construct relative URLs (e.g. '/youtubei/v1/player') — resolve
  // them against the sandbox host since there's no document origin to resolve with.
  if (url.startsWith('/')) {
    url = YT_API_SANDBOX_ORIGIN + url;
  }

  if (url.includes('www.youtube.com/youtubei/') || url.includes('youtubei.googleapis.com/youtubei/')) {
    url = url
      .replace('https://www.youtube.com/youtubei/', YT_API_SANDBOX)
      .replace('https://youtubei.googleapis.com/youtubei/', YT_API_SANDBOX);
  }

  // iframe_api (playerId source) is CORS-blocked from the browser — route it
  // through the backend's CORS-safe proxy.
  if (url.includes('www.youtube.com/iframe_api')) {
    url = `${backendBase()}/stream/iframe-api`;
  }

  // base.js (/s/player/...) is CORS-blocked from the browser — the backend's
  // /s/player proxy serves base.js + inject.js with CORS headers.
  const sPlayerMatch = url.match(/https:\/\/www\.youtube\.com(\/s\/player\/[^"']*)/);
  if (sPlayerMatch) {
    url = `${backendBase().replace(/\/api$/, '')}${sPlayerMatch[1]}`;
  }

  // Direct browser fetch — no server proxy. googlevideo
  // URLs pass through as-is; only the CORS-blocked youtubei API is sandbox-mapped.
  // youtubei.js sometimes attaches a body to GET/HEAD Requests — strip it, since
  // the browser rejects GET/HEAD-with-body.
  // youtubei.js sometimes passes a Request object + separate init that only
  // carries the body (no method) — fetch() would default that to GET and reject
  // a GET-with-body. Merge the Request's method/headers into the init.
  let method = '';
  if (typeof input !== 'string' && input && input.method) method = String(input.method).toUpperCase();
  if (init && init.method) method = String(init.method).toUpperCase();
  let reqInit = init;
  if (typeof input !== 'string' && input && input.method && reqInit && !reqInit.method) {
    reqInit = { ...reqInit, method: String(input.method).toUpperCase() };
  }
  if (typeof input !== 'string' && input && input.headers && input.headers.forEach) {
    const headers = new Headers(reqInit && reqInit.headers);
    input.headers.forEach((v, k) => {
      if (!headers.has(k)) headers.set(k, v);
    });
    reqInit = { ...(reqInit || {}), headers };
  }
  if ((!method || method === 'GET' || method === 'HEAD') && reqInit && reqInit.body) {
    const { body, ...cleanInit } = reqInit;
    reqInit = cleanInit;
  }
  if (url.includes('alt=json')) {
    console.warn('[innertubeDecipher] DEBUG alt=json call:', {
      url,
      inputCtor: typeof input === 'string' ? 'string' : (input && input.constructor ? input.constructor.name : typeof input),
      method,
      initMethod: init ? init.method : null,
      hasInitBody: !!(init && init.body),
      initBodyCtor: init && init.body ? (init.body.constructor ? init.body.constructor.name : typeof init.body) : null,
      reqInitHasBody: !!(reqInit && reqInit.body)
    });
  }
  // googleapis sandbox sends Access-Control-Allow-Origin: * which forbids
  // credentials:'include' — force 'omit' for cross-origin requests.
  const isCrossOrigin = !url.startsWith(window.location.origin);
  if (isCrossOrigin) {
    if (reqInit && reqInit.credentials && reqInit.credentials !== 'omit') {
      reqInit = { ...reqInit, credentials: 'omit' };
    } else if (!reqInit) {
      reqInit = { credentials: 'omit' };
    } else if (typeof input !== 'string' && input && input.credentials && input.credentials !== 'omit') {
      reqInit = { ...reqInit, credentials: 'omit' };
    }
  }
  try {
    return await fetch(url, reqInit);
  } catch (err) {
    console.warn('[innertubeDecipher] sandboxFetch failed for:', url, err);
    throw err;
  }
};

// Route ALL of youtubei.js's internal fetches through the same sandbox mapper
// (session bootstrap, decipher, etc. may use Platform.shim.fetch).
Platform.shim.fetch = async (input, init) => sandboxFetch(input, init);

export const getAllDecryptedFormats = async (videoId, poToken, visitorData) => {
  try {
    if (!ytInstance || ytInstance.lastPoToken !== poToken) {
      console.log('[innertubeDecipher] Initializing youtubei.js/web in browser...', {
        hasPoToken: !!poToken,
        hasVisitorData: !!visitorData,
        poTokenPrefix: poToken ? poToken.slice(0, 15) : null
      });

      const config = {
        generate_session_locally: true,
        retrieve_player: true,
        cache: new UniversalCache(false),
        fetch: sandboxFetch
      };

      if (poToken) config.po_token = poToken;
      if (visitorData) config.visitor_data = visitorData;

      ytInstance = await Innertube.create(config);
      ytInstance.lastPoToken = poToken;
    }

    const info = await ytInstance.getBasicInfo(videoId);
    const formats = info.streaming_data?.formats || [];
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];

    let fullQualityMap = {};
    let bestUrl = null;
    let bestQuality = null;
    let audioUrl = null;

    const processFormat = async (f, type) => {
      let url = f.url;
      if (!url && f.decipher) {
        url = await f.decipher(ytInstance.session.player);
      }
      if (url) {
        const nominalHeight = (f.width && f.height) ? Math.min(f.width, f.height) : (f.height || 0);
        const qualityLabel = nominalHeight ? `${nominalHeight}p` : 'auto';
        return { url, qualityLabel, nominalHeight, type };
      }
      return null;
    };

    // Process combined formats
    for (const f of formats) {
      const res = await processFormat(f, 'combined');
      if (res) {
        if (!bestUrl) {
          bestUrl = res.url;
          bestQuality = res.qualityLabel;
        }
        fullQualityMap[res.qualityLabel] = { url: res.url, type: 'combined' };
      }
    }

    // Process adaptive formats
    for (const f of adaptiveFormats) {
      const isVideo = f.mime_type && f.mime_type.startsWith('video/');
      const isAudio = f.mime_type && f.mime_type.startsWith('audio/');
      
      if (isVideo) {
        const res = await processFormat(f, 'video_only');
        if (res && (!fullQualityMap[res.qualityLabel] || fullQualityMap[res.qualityLabel].type !== 'combined')) {
          fullQualityMap[res.qualityLabel] = { url: res.url, type: 'video_only' };
        }
      } else if (isAudio && !audioUrl) {
        const res = await processFormat(f, 'audio_only');
        if (res) audioUrl = res.url;
      }
    }

    if (!bestUrl) {
      throw new Error('youtubei.js: no valid playable formats found');
    }

    return {
      bestUrl,
      bestQuality,
      audioUrl,
      fullQualityMap
    };
  } catch (err) {
    console.error('[innertubeDecipher] Failed to extract formats:', err.message, {
      hasPoToken: !!poToken,
      hasVisitorData: !!visitorData,
      hint: poToken ? 'Token present — sandbox may have rejected it' : 'No PO token — WEB client player requests will likely be rejected by Google'
    });
    return null; // Return null so VideoPlayer can fallback to backend stream
  }
};
