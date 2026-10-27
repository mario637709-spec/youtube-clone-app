// @ts-nocheck
// Deprecated compatibility shim.
//
// The old implementation loaded a vendored base.js through the Render
// backend and executed it to capture a token. That proxy is gone.
// Real poTokens are now minted entirely on-device by poTokenMint.ts
// (WAA -> BotGuard -> WebPoMinter) and are content-bound to the video ID.

import { getEmbedBootstrap } from './youtubeDirect';

export const getPoTokenBootstrap = async (videoId = 'dQw4w9WgXcQ') => {
  try {
    const boot = await getEmbedBootstrap(videoId);
    const playerMatch = String(boot.jsUrl || '').match(/\/s\/player\/([^/]+)\//);
    return {
      visitorData: boot.visitorData || '',
      playerId: playerMatch ? playerMatch[1] : '',
      jsUrl: boot.jsUrl || ''
    };
  } catch {
    return null;
  }
};

export const getBrowserPoToken = async () => {
  console.warn('[browserPoToken] Deprecated — use poTokenMint.getMintedPoToken(videoId)');
  return null;
};

export default { getBrowserPoToken, getPoTokenBootstrap };
