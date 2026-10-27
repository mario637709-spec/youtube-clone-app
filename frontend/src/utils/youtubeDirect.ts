// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// youtubeDirect.ts — DIRECT-TO-YOUTUBE TRANSPORT (NO BACKEND PROXY)
// ───────────────────────────────────────────────────────────────────
// Native (Capacitor Android/iOS): CapacitorHttp uses the DEVICE network
// stack, so requests use the user's IP and bypass browser CORS.
// Web: normal fetch (YouTube will usually block CORS; caller falls back
// to the official iframe player).
//
// Nothing in this file talks to the Render backend.
// ───────────────────────────────────────────────────────────────────

const YT_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const EMBED_CACHE_TTL = 30 * 60 * 1000;
const BASE_JS_CACHE_TTL = 30 * 60 * 1000;

let capacitorModulePromise = null;
const getCapacitorModule = () => {
  if (!capacitorModulePromise) capacitorModulePromise = import('@capacitor/core');
  return capacitorModulePromise;
};

export const isNativePlatform = () => {
  try {
    if (typeof window === 'undefined') return false;
    const cap = window.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') {
      const p = cap.getPlatform();
      return p === 'android' || p === 'ios';
    }
  } catch {
    // ignore
  }
  return false;
};

const toHeaderObject = (headers) => {
  const out = {};
  if (!headers) return out;
  try {
    if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => {
        if (value != null) out[key] = String(value);
      });
    } else if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (pair && pair[0] != null && pair[1] != null) out[pair[0]] = String(pair[1]);
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        if (value != null) out[key] = String(value);
      }
    }
  } catch {
    // ignore malformed headers
  }
  return out;
};

// fetch-compatible function. On native it routes through CapacitorHttp.
export const nativeFetch = async (input, init = {}) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input?.url || String(input);

  if (!isNativePlatform()) {
    return fetch(input, init);
  }

  const { CapacitorHttp } = await getCapacitorModule();
  const method = String(
    init?.method || (typeof input !== 'string' && input?.method) || 'GET'
  ).toUpperCase();

  const headers = {
    ...toHeaderObject(typeof input !== 'string' ? input?.headers : null),
    ...toHeaderObject(init?.headers)
  };

  let data = init?.body;
  if (data == null && typeof input !== 'string' && input?.body) data = input.body;

  if (data != null && typeof data !== 'string') {
    try {
      if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
        data = data.toString();
      } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        data = await data.text();
      } else if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(data);
      } else if (typeof data === 'object') {
        data = JSON.stringify(data);
      } else {
        data = String(data);
      }
    } catch {
      data = String(data);
    }
  }

  const nativeResponse = await CapacitorHttp.request({
    url,
    method,
    headers,
    data,
    responseType: 'text',
    connectTimeout: 20000,
    readTimeout: 30000
  });

  const body = nativeResponse?.data == null
    ? ''
    : typeof nativeResponse.data === 'string'
      ? nativeResponse.data
      : JSON.stringify(nativeResponse.data);

  const responseHeaders = {};
  for (const [key, value] of Object.entries(nativeResponse?.headers || {})) {
    if (value != null) responseHeaders[key] = String(value);
  }

  return new Response(body, {
    status: nativeResponse?.status || 200,
    headers: responseHeaders
  });
};

export const fetchWithTimeout = async (url, init = {}, timeoutMs = 15000) => {
  if (!isNativePlatform()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  // CapacitorHttp has its own connect/read timeouts; keep the signature
  // identical so callers do not need platform branches.
  return nativeFetch(url, init);
};

const readJson = async (res) => {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const readText = async (res) => {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

// ─── Embed page bootstrap (visitorData + player jsUrl + sts) ───────
const embedCache = new Map(); // videoId -> { data, expires }
let genericBootstrap = null;

const parseEmbedBootstrap = (html) => {
  const visitorMatch = html.match(/"visitorData":"([^"]+)/);
  const jsMatch = html.match(/"jsUrl":"([^"]+)"/) || html.match(/"PLAYER_JS_URL":"([^"]+)"/);
  const stsMatch = html.match(/"sts":(\d+)/);

  let jsUrl = jsMatch ? jsMatch[1].replace(/\\\//g, '/') : '';
  if (jsUrl) {
    if (jsUrl.startsWith('/')) jsUrl = `https://www.youtube.com${jsUrl}`;
    else if (!/^https?:\/\//.test(jsUrl)) jsUrl = `https://www.youtube.com/${jsUrl}`;
  }

  return {
    visitorData: visitorMatch ? visitorMatch[1] : '',
    jsUrl,
    sts: stsMatch ? parseInt(stsMatch[1], 10) : 0
  };
};

export const getEmbedBootstrap = async (videoId = 'dQw4w9WgXcQ') => {
  const now = Date.now();
  const cached = embedCache.get(videoId);
  if (cached && now < cached.expires) return cached.data;

  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?hl=en&autoplay=0`,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      15000
    );
    const html = await readText(res);
    const data = parseEmbedBootstrap(html);
    if (data.visitorData || data.jsUrl) {
      embedCache.set(videoId, { data, expires: now + EMBED_CACHE_TTL });
      genericBootstrap = { ...data, savedAt: now };
      try {
        if (data.jsUrl) localStorage.setItem('yt_cached_js_url', data.jsUrl);
        if (data.sts) localStorage.setItem('yt_cached_sts', String(data.sts));
        if (data.visitorData) localStorage.setItem('yt_cached_visitor_data', data.visitorData);
      } catch {
        // storage may be unavailable
      }
      return data;
    }
  } catch (e) {
    console.warn('[youtubeDirect] embed bootstrap failed:', e?.message || e);
  }

  // Last known good values from this session or a previous one.
  try {
    const jsUrl = localStorage.getItem('yt_cached_js_url') || '';
    const sts = parseInt(localStorage.getItem('yt_cached_sts') || '0', 10);
    const visitorData = localStorage.getItem('yt_cached_visitor_data') || '';
    if (jsUrl || visitorData) return { visitorData, jsUrl, sts: sts || 0 };
  } catch {
    // ignore
  }

  if (genericBootstrap) return genericBootstrap.data || genericBootstrap;
  return { visitorData: '', jsUrl: '', sts: 0 };
};

// ─── base.js (signature / n-param decipher source) ─────────────────
let baseJsCache = { url: '', text: '', expires: 0 };

export const getBaseJs = async (jsUrl) => {
  if (!jsUrl) throw new Error('No base.js URL');
  const url = jsUrl.startsWith('http') ? jsUrl : `https://www.youtube.com${jsUrl}`;
  if (baseJsCache.url === url && baseJsCache.text && Date.now() < baseJsCache.expires) {
    return baseJsCache.text;
  }
  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: '*/*',
      Referer: 'https://www.youtube.com/'
    }
  }, 20000);
  const text = await readText(res);
  if (!text || text.length < 1000) throw new Error('base.js response too small');
  baseJsCache = { url, text, expires: Date.now() + BASE_JS_CACHE_TTL };
  return text;
};

// ─── InnerTube player request ──────────────────────────────────────
const CLIENT_IDS = {
  WEB: '1',
  MWEB: '2',
  ANDROID: '3',
  IOS: '5',
  ANDROID_VR: '28',
  WEB_EMBEDDED_PLAYER: '56'
};

export const youtubePlayerRequest = async ({ body, clientName, clientVersion, videoId }) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Youtube-Client-Name': CLIENT_IDS[clientName] || '3',
    'X-Youtube-Client-Version': clientVersion || '2.20260101.00.00',
    Origin: 'https://www.youtube.com',
    Referer: videoId ? `https://www.youtube.com/watch?v=${videoId}` : 'https://www.youtube.com/'
  };

  if (clientName.startsWith('ANDROID')) {
    headers['User-Agent'] = body?.context?.client?.userAgent
      || 'com.google.android.youtube/21.03.36 (Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';
    headers['X-GOOG-API-FORMAT-VERSION'] = '2';
  } else {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  }

  const res = await fetchWithTimeout(YT_PLAYER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, 15000);

  return readJson(res);
};

export const describePlayability = (data) => {
  const status = data?.playabilityStatus?.status || 'UNKNOWN';
  const reason = data?.playabilityStatus?.reason || '';
  return reason ? `${status}: ${reason}` : status;
};

export default {
  nativeFetch,
  fetchWithTimeout,
  isNativePlatform,
  getEmbedBootstrap,
  getBaseJs,
  youtubePlayerRequest,
  describePlayability
};
