// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// browserPoToken.ts — PHASE 2: REAL PO TOKEN, 100% BROWSER ME
// ───────────────────────────────────────────────────────────────────
// WEB client (4K/60fps) ke liye poToken chahiye. Backend ka
// youtube-po-token-generator ka mechanism browser me port kiya:
//   1. visitorData  → ANDROID player response ke responseContext se
//                      (ya embed page HTML se regex)
//   2. base.js      → backend ke /s/player/* proxy se (jo inject.js
//                      already append karta hai, server.js:43-59)
//   3. browser me run → window.onPoToken callback se token capture
// Token ~2 ghante valid → localStorage cache.
// Server ka koi CPU load nahi — sirf ek static file (base.js) serve
// hoti hai, wo bhi browser cache me (max-age=86400).
// ───────────────────────────────────────────────────────────────────

import { getApiBaseUrl } from '../config';

const PO_TOKEN_TTL_MS = 90 * 60 * 1000;
const GEN_TIMEOUT_MS = 25000;

// Full API base INCLUDING the /api prefix
const apiBase = () =>
  getApiBaseUrl();

// Server origin (for /s/player/* proxy which is mounted at the server root, NOT under /api)
const serverBase = () =>
  apiBase().replace(/\/api$/, '');

const fetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const extractVisitorData = (html) => {
  const match = html.match(/"visitorData":"([^"]+)/);
  if (!match) throw new Error('visitorData not found');
  return match[1];
};

const extractPlayerId = (js) => {
  const match = js.match(/\/s\/player\/([^\/]+)\//);
  if (!match) throw new Error('player_id not found');
  return match[1];
};

// ─── PREFERRED: single backend call → { visitorData, playerId } ────
// Backend may not have this endpoint yet — returns null on 404 so the
// individual fetches below take over.
export const getPoTokenBootstrap = async (videoId = 'dQw4w9WgXcQ') => {
  try {
    const data = await fetchJson(`${apiBase()}/stream/player-bootstrap?videoId=${encodeURIComponent(videoId)}`);
    if (!data || !data.visitorData || !data.playerId) {
      throw new Error('player-bootstrap response missing visitorData/playerId');
    }
    if (data.jsUrl) {
      localStorage.setItem('yt_cached_js_url', data.jsUrl);
    } else {
      localStorage.setItem('yt_cached_js_url', `/s/player/${data.playerId}/player_ias.vflset/en_US/base.js`);
    }
    console.log(`[PoToken] player-bootstrap OK (visitorData=${data.visitorData.slice(0, 12)}..., playerId=${data.playerId})`);
    return { visitorData: data.visitorData, playerId: data.playerId };
  } catch (e) {
    console.warn('[PoToken] player-bootstrap endpoint unavailable:', e.message);
    return null;
  }
};

// ─── visitorData: backend /stream/embed proxy (direct YT embed as fallback, CORS-fails harmlessly) ──
const fetchVisitorDataFromEmbed = async (videoId = 'dQw4w9WgXcQ') => {
  try {
    const res = await fetch(`${apiBase()}/stream/embed/${videoId}?hl=en`, {
      headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
    });
    if (res.ok) {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json && json.visitorData) return json.visitorData;
      } catch {
        // plain HTML embed — fall through to regex
      }
      return extractVisitorData(text);
    }
    console.warn(`[PoToken] /stream/embed proxy HTTP ${res.status}, falling back to direct fetch`);
  } catch (e) {
    console.warn('[PoToken] /stream/embed proxy failed:', e.message);
  }

  const res = await fetch(`https://www.youtube.com/embed/${videoId}?hl=en`, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!res.ok) throw new Error(`Embed fetch HTTP ${res.status}`);
  return extractVisitorData(await res.text());
};

// ─── playerId: backend /stream/iframe-api, direct iframe_api as last fallback ──
const getPlayerId = async () => {
  const cachedJs = localStorage.getItem('yt_cached_js_url') || '';
  const cachedMatch = cachedJs.match(/\/s\/player\/([^\/]+)\//);
  if (cachedMatch) return cachedMatch[1];

  try {
    const res = await fetch(`${apiBase()}/stream/iframe-api`, {
      headers: { 'Accept': 'text/javascript' }
    });
    if (res.ok) {
      const playerId = extractPlayerId(await res.text());
      localStorage.setItem('yt_cached_js_url', `/s/player/${playerId}/player_ias.vflset/en_US/base.js`);
      console.log(`[PoToken] playerId from /stream/iframe-api proxy: ${playerId}`);
      return playerId;
    }
    console.warn(`[PoToken] /stream/iframe-api HTTP ${res.status}, falling back to direct fetch`);
  } catch (e) {
    console.warn('[PoToken] /stream/iframe-api proxy failed:', e.message);
  }

  const apiRes = await fetch('https://www.youtube.com/iframe_api', {
    headers: { 'Accept': 'text/javascript' }
  });
  if (!apiRes.ok) throw new Error(`iframe_api HTTP ${apiRes.status}`);
  const playerId = extractPlayerId(await apiRes.text());
  localStorage.setItem('yt_cached_js_url', `/s/player/${playerId}/player_ias.vflset/en_US/base.js`);
  return playerId;
};

// ─── Main generation: injected base.js ko browser me run karo ─────
const generatePoTokenInBrowser = async (playerId, visitorData) => {
  // ?vendor=1 tells the backend to serve the vendored base.js with the ytcfg
  // preload + inject.js appended (regular /s/player/* serves the real player
  // JS which Tier 1/Tier 2 decipher need to match).
  const scriptUrl = `${serverBase()}/s/player/${playerId}/player_ias.vflset/en_US/base.js?vendor=1`;
  const res = await fetch(scriptUrl);
  if (!res.ok) throw new Error(`base.js fetch failed: ${res.status}`);
  const script = await res.text();

  let playerDiv = document.getElementById('player');
  if (!playerDiv) {
    playerDiv = document.createElement('div');
    playerDiv.id = 'player';
    playerDiv.style.cssText = 'display:none;position:absolute;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(playerDiv);
  } else {
    playerDiv.innerHTML = '';
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      delete window.onPoToken;
      fn(val);
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('PO token generation timed out'));
    }, GEN_TIMEOUT_MS);

    window.onPoToken = (token) => {
      if (token && token.length > 80) {
        finish(resolve, token);
      }
    };

    window.visitorData = visitorData;

    try {
      new Function(script)();
    } catch (e) {
      finish(reject, e);
    }
  });
};

// ─── Orchestrator: cached token ho to use karo, warna generate ─────
export const getBrowserPoToken = async (fallbackVisitorData = '') => {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const cached = localStorage.getItem('yt_po_token');
    const cachedTs = parseInt(localStorage.getItem('yt_po_token_ts') || '0', 10);
    if (cached && cached.length > 80 && Date.now() - cachedTs < PO_TOKEN_TTL_MS) {
      return { poToken: cached, visitorData: localStorage.getItem('yt_po_visitor') || fallbackVisitorData };
    }

    let visitorData = fallbackVisitorData;
    let playerId = null;

    // PREFERRED: single backend call for both visitorData + playerId
    const bootstrap = await getPoTokenBootstrap();
    if (bootstrap) {
      if (!visitorData) visitorData = bootstrap.visitorData;
      playerId = bootstrap.playerId;
    }

    if (!visitorData) visitorData = await fetchVisitorDataFromEmbed();
    if (!playerId) playerId = await getPlayerId();

    const poToken = await generatePoTokenInBrowser(playerId, visitorData);

    localStorage.setItem('yt_po_token', poToken);
    localStorage.setItem('yt_po_token_ts', Date.now().toString());
    localStorage.setItem('yt_po_visitor', visitorData);

    return { poToken, visitorData };
  } catch (e) {
    console.warn('[PoToken] Browser generation failed:', e.message);
    return null;
  }
};
