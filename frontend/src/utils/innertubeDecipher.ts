// @ts-nocheck
// youtubei.js has circular class references (class YTNode) that fail in Next.js Turbopack
// client bundles with "ReferenceError: Cannot access 'b' before initialization".
// Decryption is handled cleanly via backend proxy stream (/stream/auto/:id) and direct Google CDN streams.

export const getAllDecryptedFormats = async (videoId, poToken, visitorData) => {
  return null;
};

export default { getAllDecryptedFormats };
