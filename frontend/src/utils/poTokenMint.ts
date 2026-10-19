// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// poTokenMint.ts — WAA/BotGuard poToken minting, 100% BROWSER ME
// ───────────────────────────────────────────────────────────────────
// VERIFIED WORKING (9 Aug 2026): WAA Create (jnn-pa, CORS-free) →
// challenge (globalName=trayride) → interpreter VM → BotGuardClient
// snapshot (poSignal.len=1) → GenerateIT (ttl=43200) → WebPoMinter
// → poToken len=116. Is token se ANDROID_VR itag=315 (4K) URL milta
// hai jo FULL FILE serve karta hai (deep2000M=206)!
//
// jnn-pa.googleapis.com CORS: * — direct fetch, proxy nahi chahiye.
// Token ~12h valid → localStorage cache.
// ───────────────────────────────────────────────────────────────────

import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { getApiBaseUrl } from '../config';

const WAA_BASE = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa';
const WAA_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const DEFAULT_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

const PO_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const parseChallengeRaw = (rawData) => {
  let challengeData = [];
  if (rawData.length > 1 && typeof rawData[1] === 'string') {
    const buffer = Uint8Array.from(atob(rawData[1]), (c) => c.charCodeAt(0));
    const descrambled = new TextDecoder().decode(buffer.map((b) => b + 97));
    challengeData = JSON.parse(descrambled || '[]');
  } else if (rawData.length && typeof rawData[0] === 'object') {
    challengeData = rawData[0];
  }
  const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName, , clientExperimentsStateBlob] = challengeData;
  const privateDoNotAccessOrElseSafeScriptWrappedValue = Array.isArray(wrappedScript) ? wrappedScript.find((v) => v && typeof v === 'string') : undefined;
  const privateDoNotAccessOrElseTrustedResourceUrlWrappedValue = Array.isArray(wrappedUrl) ? wrappedUrl.find((v) => v && typeof v === 'string') : undefined;
  const bg = {
    message_id: messageId,
    interpreter_hash: interpreterHash,
    program,
    global_name: globalName,
    client_experiments_state_blob: clientExperimentsStateBlob,
  };
  if (privateDoNotAccessOrElseSafeScriptWrappedValue) {
    bg.interpreter_javascript = { private_do_not_access_or_else_safe_script_wrapped_value: privateDoNotAccessOrElseSafeScriptWrappedValue };
  }
  if (privateDoNotAccessOrElseTrustedResourceUrlWrappedValue) {
    bg.interpreter_url = { private_do_not_access_or_else_trusted_resource_url_wrapped_value: privateDoNotAccessOrElseTrustedResourceUrlWrappedValue };
  }
  return bg;
};

const waaFetch = async (endpoint, body) => {
  const res = await fetch(`${WAA_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': WAA_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WAA ${endpoint}: ${res.status}`);
  return res.json();
};

// ─── Fresh mint (fast path: WAA challenge direct se) ───────────────
const mintFresh = async (contentBinding, onLog) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('browser only');

  // 1. Challenge fetch (jnn-pa CORS-free, direct)
  onLog?.('⏳ WAA Create...');
  const rawData = await waaFetch('Create', [DEFAULT_REQUEST_KEY]);
  const bg = parseChallengeRaw(rawData);
  if (!bg?.program) throw new Error('No challenge program in WAA response');
  onLog?.(`✅ Challenge: globalName=${bg.global_name} program.len=${bg.program?.length}`);

  // 2. Interpreter script (embedded JS ya URL se)
  let interpreterJs = null;
  const wrappedJs = bg.interpreter_javascript?.private_do_not_access_or_else_safe_script_wrapped_value;
  const wrappedUrl = bg.interpreter_url?.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
  if (wrappedJs) {
    interpreterJs = wrappedJs;
  } else if (wrappedUrl) {
    const res = await fetch(`https:${wrappedUrl}`);
    interpreterJs = await res.text();
  }
  if (!interpreterJs) throw new Error('No interpreter script');

  // 3. BotGuard VM (globalName global)
  const globalObject = window;
  const globalName = bg.global_name || bg.globalName;
  if (!globalObject[globalName]) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.id = globalName;
    script.textContent = interpreterJs;
    document.head.appendChild(script);
  }
  if (!globalObject[globalName]) throw new Error('VM did not register after script run');

  const botGuardClient = await BotGuardClient.create({
    program: bg.program,
    globalName,
    globalObject,
    userInteractionElement: document.body,
  });

  // 4. Snapshot → poSignal
  const webPoSignalOutput = [];
  const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput }, 15000);
  if (webPoSignalOutput.length !== 1) {
    throw new Error(`poSignal empty (len=${webPoSignalOutput.length})`);
  }
  onLog?.(`✅ Snapshot done | poSignal.len=${webPoSignalOutput.length}`);

  // 5. Integrity token
  const requestKey = bg.request_key || DEFAULT_REQUEST_KEY;
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
    await waaFetch('GenerateIT', [requestKey, botguardResponse]);
  onLog?.(`✅ Integrity token (ttl=${estimatedTtlSecs}s)`);

  // 6. Mint poToken bound to content
  const minter = await WebPoMinter.create(
    { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
    webPoSignalOutput
  );
  const poToken = await minter.mintAsWebsafeString(contentBinding);
  onLog?.(`✅ poToken len=${poToken.length}`);
  return poToken;
};

// ─── Server-side fallback mint (youtube-po-token-generator) ───────
// Browser WAA (jnn-pa) mint kabhi kabhi fail/hang hota hai
// (ERR_CONNECTION_RESET) aur ANDROID_VR 4K pe HTTP 500 de sakta hai.
// Backend /api/stream/pot verified kaam karta hai (itag=315 4K).
const mintViaBackend = async (onLog) => {
  onLog?.('⏳ Backend PO token mint...');
  const apiBase = getApiBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${apiBase}/stream/pot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Backend mint HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.poToken) throw new Error('Backend mint returned no token');
    onLog?.(`✅ Backend poToken len=${data.poToken.length}`);
    return data.poToken;
  } finally {
    clearTimeout(timer);
  }
};

// ─── 2026-08-15 SPEED FIX ───────────────────────────────────────────
// Problem: har video ke liye full WAA challenge (~4-6s) chalti thi
// (WAA Create → interpreter VM → BotGuard snapshot → GenerateIT) —
// ye SAB video-independent hai. Sirf `minter.mintAsWebsafeString(binding)`
// content-bound hai. Ab challenge/integrity-token ek baar mint karke
// in-memory + localStorage me cache karte hain; har naye video ke liye
// sirf fast re-bind (WebPoMinter.create + mintAsWebsafeString, ~200ms)
// hota hai. Cold extraction 13-15s → ~3-5s.
let sharedMintSession = null;
let sharedSessionExpiresAt = 0;
let sharedSessionPromise = null;
const SESSION_CACHE_KEY = 'yt_mint_session';

const getSharedSession = async (onLog) => {
  const now = Date.now();
  if (sharedMintSession && now < sharedSessionExpiresAt) {
    return sharedMintSession;
  }
  // Single-flight: multiple parallel calls (VideoPlayer + prewarm) ek
  // hi WAA challenge share karein, nahi to 4-6 baar 4-6s lagta hai.
  if (sharedSessionPromise) {
    return sharedSessionPromise;
  }
  sharedSessionPromise = doSharedSession(onLog).finally(() => {
    sharedSessionPromise = null;
  });
  return sharedSessionPromise;
};

const doSharedSession = async (onLog) => {
  // NOTE: webPoSignalOutput[0] ek FUNCTION hai jo localStorage me JSON
  // se kabhi restore nahi hota — isliye cross-page persistence impossible.
  // Per-video token cache (yt_mint_pot_*) hi reload-safe hai.

  // ── Full WAA challenge (ek hi baar) ──
  onLog?.('⏳ WAA Create (shared session)...');
  const rawData = await waaFetch('Create', [DEFAULT_REQUEST_KEY]);
  const bg = parseChallengeRaw(rawData);
  if (!bg?.program) throw new Error('No challenge program in WAA response');
  onLog?.(`✅ Challenge: globalName=${bg.global_name} program.len=${bg.program?.length}`);

  let interpreterJs = null;
  const wrappedJs = bg.interpreter_javascript?.private_do_not_access_or_else_safe_script_wrapped_value;
  const wrappedUrl = bg.interpreter_url?.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
  if (wrappedJs) {
    interpreterJs = wrappedJs;
  } else if (wrappedUrl) {
    const res = await fetch(`https:${wrappedUrl}`);
    interpreterJs = await res.text();
  }
  if (!interpreterJs) throw new Error('No interpreter script');

  const globalObject = window;
  const globalName = bg.global_name || bg.globalName;
  if (!globalObject[globalName]) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.id = globalName;
    script.textContent = interpreterJs;
    document.head.appendChild(script);
  }
  if (!globalObject[globalName]) throw new Error('VM did not register after script run');

  const botGuardClient = await BotGuardClient.create({
    program: bg.program,
    globalName,
    globalObject,
    userInteractionElement: document.body,
  });

  const webPoSignalOutput = [];
  const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput }, 15000);
  if (webPoSignalOutput.length !== 1) {
    throw new Error(`poSignal empty (len=${webPoSignalOutput.length})`);
  }
  onLog?.(`✅ Snapshot done | poSignal.len=${webPoSignalOutput.length}`);

  const requestKey = bg.request_key || DEFAULT_REQUEST_KEY;
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
    await waaFetch('GenerateIT', [requestKey, botguardResponse]);
  onLog?.(`✅ Integrity token (ttl=${estimatedTtlSecs}s)`);

  const session = {
    integrityToken,
    estimatedTtlSecs,
    mintRefreshThreshold,
    websafeFallbackToken,
    webPoSignalOutput,
    ttlSecs: estimatedTtlSecs,
    savedAt: now,
  };
  sharedMintSession = session;
  sharedSessionExpiresAt = now + (estimatedTtlSecs * 1000);
  return session;
};

// ─── Orchestrator: shared session + fast per-video re-bind ─────────
export const getMintedPoToken = async (contentBinding = 'dQw4w9WgXcQ', onLog = null) => {
  try {
    // Per-video token cache (already-minted bindings)
    const cacheKey = `yt_mint_pot_${contentBinding}`;
    const cached = localStorage.getItem(cacheKey);
    const cachedTs = parseInt(localStorage.getItem(`${cacheKey}_ts`) || '0', 10);
    if (cached && cached.length > 80 && Date.now() - cachedTs < PO_TOKEN_TTL_MS) {
      return cached;
    }

    // 1. FAST: shared session se re-bind (full WAA sirf 1 baar)
    let poToken = null;
    try {
      const session = await getSharedSession(onLog);
      const minter = await WebPoMinter.create(
        { integrityToken: session.integrityToken, estimatedTtlSecs: session.estimatedTtlSecs, mintRefreshThreshold: session.mintRefreshThreshold, websafeFallbackToken: session.websafeFallbackToken },
        session.webPoSignalOutput
      );
      poToken = await minter.mintAsWebsafeString(contentBinding);
      onLog?.(`✅ Re-bound poToken len=${poToken.length} (shared session)`);
    } catch (e) {
      console.warn('[poTokenMint] shared-session mint failed, full WAA retry:', e.message);
      sharedMintSession = null;
    }

    // 2. Full WAA fresh mint (session hi fail hui ho to)
    if (!poToken) {
      try {
        poToken = await mintFresh(contentBinding, onLog);
      } catch (e) {
        console.warn('[poTokenMint] WAA mint failed, trying backend:', e.message);
      }
    }

    // 3. Fallback: server-side mint (verified reliable)
    if (!poToken) {
      poToken = await mintViaBackend(onLog);
    }

    if (!poToken) return null;
    localStorage.setItem(cacheKey, poToken);
    localStorage.setItem(`${cacheKey}_ts`, Date.now().toString());
    return poToken;
  } catch (e) {
    console.warn('[poTokenMint] Failed:', e.message);
    return null;
  }
};
