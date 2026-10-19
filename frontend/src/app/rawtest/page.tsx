"use client";
// @ts-nocheck
// ───────────────────────────────────────────────────────────────────
// /rawtest — BROWSER-SIDE RAW URL GENERATION TEST (Tier 0)
// youtubei.js browser me chalta hai. www.youtube.com ke CORS-blocked
// fetches (config/iframe_api/base.js = chhote JS/JSON) backend ke
// /api/videos/proxy/cors se aate hain. Sandbox (release-youtubei.)
// direct browser se (CORS:*). VIDEO BYTES KABHI SERVER SE NAHI JATE.
// ───────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { Innertube } from 'youtubei.js';
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { parseLooseJSON } from 'bgutils-js/utils';
import { getApiBaseUrl } from '@/config';

const PROXY_BASE = `${getApiBaseUrl()}/videos/proxy/cors?url=`;

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

// ─── Custom fetch: youtube.com → backend proxy, baaki direct ──────
const smartFetch = (input, init) => {
  let url;
  let method = init?.method;
  if (typeof input === 'string') url = input;
  else if (input?.url) {
    url = input.url;
    method = method || input.method;
  } else if (input?.href) {
    url = input.href;
    method = method || input.method;
  } else return fetch(input, init);
  console.log('[smartFetch] →', url.slice(0, 90), '| method:', method);
  if (url.includes('www.youtube.com') || url.includes('youtubei.googleapis.com') || url.includes('www.google.com')) {
    const proxied = PROXY_BASE + encodeURIComponent(url);
    const newInit = { ...(init || {}), method, credentials: 'omit' };
    return fetch(proxied, newInit);
  }
  return fetch(url, init);
};

export default function RawTestPage() {
  const [log, setLog] = useState([]);
  const [videoId, setVideoId] = useState('muLA_Y-1iR0');
  const [videoEl, setVideoEl] = useState(null);

  const add = (msg) => {
    setLog((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const testUrl = async (url, label, offset = 104857600, end = null) => {
    try {
      const e = end ?? offset + 2097152 - 1;
      const r = await fetch(
        `${PROXY_BASE}${encodeURIComponent(url)}`,
        { headers: { Range: `bytes=${offset}-${e}` } }
      );
      const body = await r.text();
      add(`${label}: status=${r.status} bytes=${body.length}`);
    } catch (e) {
      add(`${label}: ERR ${e.message.slice(0, 60)}`);
    }
  };

  const makeSession = async () => {
    add('⏳ Creating Innertube session (config/player via backend proxy)...');

    // Player id (iframe_api) bhi CORS-blocked hai — pehle proxy se fetch karke
    // player_id nikalte hain, taaki Innertube session isko direct fetch na kare.
    let playerId = null;
    try {
      const iframeApiRes = await fetch(
        `${PROXY_BASE}${encodeURIComponent('https://www.youtube.com/iframe_api')}`
      );
      const js = await iframeApiRes.text();
      add(`✅ iframe_api: status=${iframeApiRes.status} len=${js.length}`);
      const m = js.match(/player\\(\/([\w-]+))/);
      playerId = m ? m[2] : null;
      add(`✅ regex match: ${m ? m[1] : 'null'} | sample: ${js.slice(30, 90)}`);
      add(`✅ player_id=${playerId}`);
    } catch (e) {
      add(`⚠️ iframe_api fetch failed: ${e.message.slice(0, 50)}`);
    }

    const yt = await Innertube.create({
      retrieve_player: true,
      lang: 'en',
      generate_session_locally: true,
      retrieve_innertube_config: false,
      player_id: playerId,
      fetch: smartFetch,
    });
    add('✅ Innertube session OK');
    return yt;
  };

  // ─── poToken minting (BgUtils, browser me VM run karke) ──────────
  const mintPoToken = async (yt, contentBinding) => {
    const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

    // WAA Create endpoint se fresh challenge (DEV article wala flow)
    add('⏳ Fetching attestation challenge (WAA Create)...');
    const challengeRes = await smartFetch('https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/Create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify([REQUEST_KEY]),
    });
    if (!challengeRes.ok) throw new Error(`WAA Create: ${challengeRes.status}`);
    const rawData = await challengeRes.json();
    const bg = parseChallengeRaw(rawData);
    if (!bg?.program) throw new Error('No challenge program in WAA response');
    add(`✅ Challenge: globalName=${bg.global_name} program.len=${bg.program?.length}`);

    let interpreterJs = null;
    const wrappedJs = bg.interpreter_javascript?.private_do_not_access_or_else_safe_script_wrapped_value;
    const wrappedUrl = bg.interpreter_url?.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
    if (wrappedJs) {
      interpreterJs = wrappedJs;
    } else if (wrappedUrl) {
      add(`⏳ Fetching interpreter script (${wrappedUrl.slice(0, 60)})...`);
      const res = await smartFetch(`https:${wrappedUrl}`);
      interpreterJs = await res.text();
    }
    if (!interpreterJs) throw new Error('No interpreter script');
    const globalName = bg.global_name || bg.globalName;
    add(`✅ Interpreter loaded (${interpreterJs.length} bytes), globalName=${globalName}`);

    const globalObject = window;
    if (!globalObject[globalName]) {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.id = globalName;
      script.textContent = interpreterJs;
      document.head.appendChild(script);
    }
    if (!globalObject[globalName]) throw new Error('VM did not register after script run');
    add('✅ BotGuard VM loaded');

    const botGuardClient = await BotGuardClient.create({
      program: bg.program,
      globalName,
      globalObject,
      userInteractionElement: document.body,
    });
    add('✅ BotGuardClient ready');

    const webPoSignalOutput = [];
    add('⏳ Running VM snapshot (BotGuard checks)...');
    const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput }, 15000);
    add(`✅ Snapshot done | bgResponse=${typeof botguardResponse === 'string' ? botguardResponse.slice(0, 40) : typeof botguardResponse} | poSignal.len=${webPoSignalOutput.length}`);

    const requestKey = bg.request_key || 'O43z0dpjhgX20SCx4KAo';
    const payload = [requestKey, botguardResponse];
    const integrityResponse = await smartFetch('https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT', {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify(payload),
    });
    if (!integrityResponse.ok) throw new Error(`GenerateIT: ${integrityResponse.status}`);
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await integrityResponse.json();
    add(`✅ Integrity token (ttl=${estimatedTtlSecs}s)`);

    const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput);
    add(`⏳ Minting poToken bound to "${contentBinding}"...`);
    const poToken = await minter.mintAsWebsafeString(contentBinding);
    add(`✅ poToken len=${poToken.length}`);
    return poToken;
  };

  const run = async () => {
    setLog([]);
    try {
      const yt = await makeSession();
      add(`✅ Session OK — minting poToken first (pot ke bina response me URL nahi aata)...`);
      const poToken = await mintPoToken(yt, videoId);

      add('⏳ Creating pot-bound session + getInfo...');
      const yt2 = await Innertube.create({
        retrieve_player: true,
        lang: 'en',
        generate_session_locally: true,
        retrieve_innertube_config: false,
        player_id: yt.session.player?.player_id,
        po_token: poToken,
        fetch: smartFetch,
      });
      let info = await yt2.getInfo(videoId, { retrieve_player: true, client: 'IOS' });
      add(`✅ playability (IOS): ${info.playability_status?.status}`);

      for (let attempt = 2; attempt <= 4; attempt++) {
        const hasMuxedUrl = info.streaming_data?.formats?.some((f) => typeof f.url === 'string');
        const hasAnyUrl = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])]
          .some((f) => typeof f.url === 'string');
        if (hasMuxedUrl || hasAnyUrl) break;
        add(`⚠️ No URL in response (attempt ${attempt}/4) — retrying getInfo...`);
        await new Promise((r) => setTimeout(r, 1500));
        info = await yt2.getInfo(videoId, { retrieve_player: true, client: 'IOS' });
      }

      // ── sab clients probe (spc/high-quality URL ke liye) ──
      for (const probeClient of ['ANDROID', 'ANDROID_MUSIC', 'ANDROID_VR', 'YTMUSIC_ANDROID', 'YTSTUDIO_ANDROID', 'WEB_EMBEDDED', 'IOS']) {
        try {
          const tvInfo = await yt2.getInfo(videoId, { retrieve_player: true, client: probeClient });
          const tvSd = tvInfo.streaming_data;
          const tvAll = [...(tvSd?.formats || []), ...(tvSd?.adaptive_formats || [])];
          const tvWithUrl = tvAll.filter((f) => typeof f.url === 'string');
          const best = tvWithUrl
            .filter((f) => f.mime_type?.startsWith('video/'))
            .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          add(`📺 ${probeClient}: play=${tvInfo.playability_status?.status} total=${tvAll.length} withUrl=${tvWithUrl.length} best=${best ? `itag=${best.itag} w=${best.width}` : 'none'} sabr=${!!tvSd?.server_abr_streaming_url}`);
          if (best) {
            const pq = new URL(best.url);
            add(`📺 ${probeClient} best params: spc=${pq.searchParams.has('spc')} pot=${pq.searchParams.has('pot')} clen=${pq.searchParams.get('clen')} mime=${best.mime_type?.slice(0, 15)}`);
          }
        } catch (e) {
          add(`📺 ${probeClient} probe FAILED: ${e.message.slice(0, 80)}`);
        }
      }

      // ── ANDROID adaptive formats: raw signature_cipher decipher + deep test ──
      {
        let adInfo = null;
        try {
          adInfo = await yt2.getInfo(videoId, { retrieve_player: true, client: 'ANDROID' });
        } catch (e) {
          add(`🔐 ANDROID getInfo FAILED: ${e.message.slice(0, 80)}`);
        }
        if (adInfo) {
          const adAll = [...(adInfo.streaming_data?.formats || []), ...(adInfo.streaming_data?.adaptive_formats || [])];
          const ciphered = adAll.filter((f) => f.signature_cipher || f.cipher);
          add(`🔐 ANDROID adaptive: total=${adAll.length} ciphered=${ciphered.length}`);
          if (adAll[1]) add(`🔐 format[1] keys: ${Object.keys(adAll[1]).join(',')}`);
          if (adAll[0]) add(`🔐 format[0] keys: ${Object.keys(adAll[0]).join(',')}`);
          const f1 = adAll[1] || adAll[0];
          if (f1) add(`🔐 f1 url=${typeof f1.url} sig_cipher=${JSON.stringify(f1.signature_cipher)?.slice(0, 120)} cipher=${JSON.stringify(f1.cipher)?.slice(0, 120)}`);
          const adBest = ciphered.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          if (adBest) {
            try {
              const decUrl = await adBest.decipher(yt2.session?.player);
              const dq = new URL(decUrl);
              add(`🔐 ANDROID decipher ok: itag=${adBest.itag} w=${adBest.width} spc=${dq.searchParams.has('spc')} pot=${dq.searchParams.has('pot')} clen=${dq.searchParams.get('clen')} len=${decUrl.length}`);
              for (const off of [104857600, 500000000, 1000000000, 2000000000]) {
                await testUrl(decUrl, `🔐 AD-deep${Math.round(off / 1000000)}M`, off);
              }
            } catch (e) {
              add(`🔐 decipher FAILED: ${e.message.slice(0, 100)}`);
            }
          } else {
            add(`🔐 no ciphered formats (all url?)`);
          }
        }
      }

      // ── WEB client + pot: muxed formats (itag=22 720p) deep test ──
      {
        let webInfo = null;
        try {
          webInfo = await yt2.getInfo(videoId, { retrieve_player: true, client: 'WEB' });
        } catch (e) {
          add(`🌐 WEB getInfo FAILED: ${e.message.slice(0, 80)}`);
        }
        if (webInfo) {
          const muxed = webInfo.streaming_data?.formats || [];
          add(`🌐 WEB muxed: ${muxed.length} | play=${webInfo.playability_status?.status}`);
          for (const f of muxed) {
            try {
              const u = await f.decipher(yt2.session?.player);
              const uq = new URL(u);
              add(`🌐 WEB muxed itag=${f.itag} w=${f.width} spc=${uq.searchParams.has('spc')} pot=${uq.searchParams.has('pot')} clen=${uq.searchParams.get('clen')}`);
              for (const off of [104857600, 500000000]) {
                await testUrl(u, `🌐 W-${f.itag}-deep${Math.round(off / 1000000)}M`, off);
              }
            } catch (e) {
              add(`🌐 WEB muxed itag=${f.itag} FAILED: ${e.message.slice(0, 80)}`);
            }
          }
        }
      }

      const sd = info.streaming_data;
      if (!sd) { add('❌ No streaming_data'); return; }

      // ── ANDROID_VR spc URL deep test (full access?!) ──
      let vrBest = null;
      for (let i = 0; i < 3 && !vrBest; i++) {
        try {
          const vrInfo = await yt2.getInfo(videoId, { retrieve_player: true, client: 'ANDROID_VR' });
          const vrAll = [...(vrInfo.streaming_data?.formats || []), ...(vrInfo.streaming_data?.adaptive_formats || [])];
          vrBest = vrAll
            .filter((f) => typeof f.url === 'string' && f.mime_type?.startsWith('video/'))
            .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          if (!vrBest) add(`🎯 ANDROID_VR attempt ${i + 1}: play=${vrInfo.playability_status?.status} no url`);
        } catch (e) {
          add(`🎯 ANDROID_VR attempt ${i + 1} FAILED: ${e.message.slice(0, 80)}`);
        }
        if (!vrBest) await new Promise((r) => setTimeout(r, 2000));
      }
      if (vrBest) {
        add(`🎯 ANDROID_VR itag=${vrBest.itag} w=${vrBest.width} clen=${new URL(vrBest.url).searchParams.get('clen')}`);
        for (const off of [104857600, 500000000, 1000000000, 2000000000]) {
          await testUrl(vrBest.url, `🎯 VR-deep${Math.round(off / 1000000)}M`, off);
        }
      }
      add(`📄 info keys: ${Object.keys(info).join(',')}`);
      add(`📄 sd keys: ${Object.keys(sd).join(',')}`);
      add(`📄 formats.length=${sd.formats?.length} adaptive.length=${sd.adaptive_formats?.length} dashUrl=${!!sd.dash_manifest_url}`);
      add(`📄 formats[0] keys: ${sd.formats?.[0] ? Object.keys(sd.formats[0]).join(',') : 'none'}`);

      const all = [...(sd.formats || []), ...(sd.adaptive_formats || [])];
      const muxed = all.find((f) => f.has_video && f.has_audio && typeof f.url === 'string');
      const video =
        all.find((f) => f.mime_type?.startsWith('video/') && f.width > 500 && (typeof f.url === 'string' || !!f.signatureCipher)) ||
        all.find((f) => f.mime_type?.startsWith('video/')) ||
        all[0];

      add(`✅ Total formats: ${all.length} | video itag=${video?.itag} mime=${video?.mime_type?.slice(0, 25)}`);
      const videoFmts = all.filter((f) => f.mime_type?.startsWith('video/') && !f.has_audio);
      const withUrl = all.filter((f) => typeof f.url === 'string');
      const withCipher = all.filter((f) => !!f.signatureCipher);
      const prog = all.find((f) => f.mime_type?.includes('video') && f.mime_type?.includes('audio'));
      add(`📊 total=${all.length} withUrl=${withUrl.length} withCipher=${withCipher.length} muxedUrl=${prog ? typeof prog.url : 'n/a'}`);
      if (withUrl[0]) add(`🔗 firstWithUrl itag=${withUrl[0].itag}`);
      if (withCipher[0]) add(`🔐 firstWithCipher itag=${withCipher[0].itag}`);
      add(`🔍 video: url=${typeof video?.url} cipher=${!!video?.signatureCipher} decipherData=${!!video?.decipher_data?.s?.length}`);

      add('⏳ Resolving URL...');
      let decUrl;
      if (typeof video?.url === 'string') {
        decUrl = video.url;
        add(`✅ Direct URL (no decipher needed) itag=${video.itag}`);
      } else {
        decUrl = await video.decipher(yt.session.player);
        add('✅ Deciphered URL');
      }
      add(`✅ URL len=${decUrl.length}`);

      const q = new URL(decUrl);
      add(`✅ URL params: pot=${q.searchParams.has('pot')} n=${q.searchParams.has('n')} spc=${q.searchParams.has('spc')} clen=${q.searchParams.get('clen')}`);

      // ── quality-tier cap test: 360p vs 720p vs 1080p vs 4K deep ──
      const tiers = [
        ['360p-muxed', all.find((f) => f.itag === 18)],
        ['720p', all.find((f) => f.mime_type?.startsWith('video/') && f.width >= 1280 && f.width < 1600)],
        ['1080p', all.find((f) => f.mime_type?.startsWith('video/') && f.width >= 1920 && f.width < 2560)],
        ['2160p', all.find((f) => f.mime_type?.startsWith('video/') && f.width >= 3840)],
      ];
      for (const [label, fmt] of tiers) {
        if (!fmt) { add(`🔬 ${label}: not found`); continue; }
        const u = typeof fmt.url === 'string' ? fmt.url : await fmt.decipher(yt.session.player).catch(() => null);
        if (!u) { add(`🔬 ${label}: no url`); continue; }
        const uq = new URL(u);
        add(`🔬 ${label}: itag=${fmt.itag} spc=${uq.searchParams.has('spc')} clen=${uq.searchParams.get('clen')} mime=${fmt.mime_type?.slice(0, 12)}`);
        await testUrl(u, `🔬 ${label}-deep100M`, 104857600);
        await testUrl(u, `🔬 ${label}-deep500M`, 500000000);
      }

      await testUrl(decUrl, '🟠 deep100M (no pot)');
      for (const off of [150000000, 200000000, 250000000, 300000000, 400000000, 500000000]) {
        await testUrl(decUrl, `🟠 deep${Math.round(off / 1000000)}M (no pot)`, off);
      }

      // ── poToken mint + pot injection ─────────────────────────────
      try {
        add('🪙 === Minting poToken ===');
        const poToken = await mintPoToken(yt, videoId);
        const potUrl = `${decUrl}&pot=${encodeURIComponent(poToken)}`;
        const q2 = new URL(potUrl);
        add(`✅ pot attached: pot=${q2.searchParams.has('pot')} potlen=${poToken.length}`);
        // SAME pot as session (issuing request) — sab offsets
        for (const off of [104857600, 150000000, 180000000, 195000000, 200000000, 210000000, 250000000, 500000000, 1000000000]) {
          await testUrl(potUrl, `🟣 deep${Math.round(off / 1000000)}M (same-pot)`, off);
        }
        // end-based cap check: start=100M size=150MB => end=250M
        await testUrl(potUrl, '🟣 cross150M (100M→250M)', 104857600, 104857600 + 157286400 - 1);
        // start-based cap check: start=199M size=1MB => end=200M
        await testUrl(potUrl, '🟣 edge199M (199M→200M)', 208666624, 209715199);
        // fresh pot (issuing-context se alag token)
        const poToken2 = await mintPoToken(yt, videoId);
        const potUrl2 = `${decUrl}&pot=${encodeURIComponent(poToken2)}`;
        add(`✅ fresh pot attached: potlen=${poToken2.length}`);
        await testUrl(potUrl2, '🟡 deep250M (fresh-pot)', 250000000);
      } catch (e) {
        add(`❌ poToken mint failed: ${e.message.slice(0, 200)}`);
        console.error(e);
      }

      const audio = all.find((f) => f.mime_type?.startsWith('audio/'));
      if (audio) {
        add(`⏳ Audio itag=${audio.itag} — deciphering...`);
        const aUrl = await audio.decipher(yt.session.player);
        await testUrl(aUrl, '🔵 audio deep100M');
      }

      add('✅ DONE');
    } catch (e) {
      add(`❌ ERROR: ${e.message}`);
      console.error(e);
    }
  };

  const play = async () => {
    try {
      const yt = await makeSession();
      add('⏳ Minting poToken for direct playback...');
      const poToken = await mintPoToken(yt, videoId);
      add(`✅ poToken minted (${poToken.length} chars)`);

      const yt2 = await Innertube.create({
        retrieve_player: true,
        lang: 'en',
        generate_session_locally: true,
        retrieve_innertube_config: false,
        player_id: yt.session.player?.player_id,
        po_token: poToken,
        fetch: smartFetch,
      });

      add('⏳ Fetching info with ANDROID client (for muxed itag=18 mp4)...');
      let info = await yt2.getInfo(videoId, { retrieve_player: true, client: 'ANDROID' });
      let all = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])];
      let chosen = all.find((f) => f.itag === 18 && typeof f.url === 'string') ||
                   all.find((f) => f.has_video && f.has_audio && typeof f.url === 'string');

      if (!chosen) {
        add('⏳ ANDROID muxed not found, trying IOS client...');
        info = await yt2.getInfo(videoId, { retrieve_player: true, client: 'IOS' });
        all = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])];
        chosen = all.find((f) => typeof f.url === 'string' && f.mime_type?.startsWith('video/')) || all[0];
      }

      if (!chosen) throw new Error('No playable format found');

      let directUrl = typeof chosen.url === 'string' ? chosen.url : await chosen.decipher(yt2.session.player);
      if (poToken && !directUrl.includes('&pot=') && !directUrl.includes('?pot=')) {
        directUrl += `&pot=${encodeURIComponent(poToken)}`;
      }

      add(`▶️ Playing itag=${chosen.itag} (${chosen.width || 'auto'}x${chosen.height || 'auto'}) directly in <video> tag...`);
      add(`🔗 URL: ${directUrl.slice(0, 100)}...`);
      setVideoEl(directUrl);
    } catch (e) {
      add(`❌ PLAY ERROR: ${e.message}`);
      console.error(e);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', maxWidth: 800 }}>
      <h2>🎬 Frontend Raw URL Generator Test</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={videoId}
          onChange={(e) => setVideoId(e.target.value)}
          style={{ padding: 8, width: 200 }}
        />
        <button onClick={run} style={{ padding: 8 }}>🚀 Generate URL</button>
        <button onClick={play} style={{ padding: 8 }}>▶️ Play</button>
      </div>
      {videoEl && (
        <video
          src={videoEl}
          controls
          style={{ width: '100%', maxHeight: 300, background: '#000', marginBottom: 12 }}
          onError={(e) => add(`🎥 Video element error: ${e.currentTarget.error?.message}`)}
          onLoadedMetadata={(e) => add(`🎥 Loaded: ${e.currentTarget.duration}s`)}
        />
      )}
      <div style={{ background: '#111', color: '#0f0', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 12, minHeight: 300 }}>
        {log.length === 0 ? 'Logs yahan aayenge...' : log.join('\n')}
      </div>
    </div>
  );
}
