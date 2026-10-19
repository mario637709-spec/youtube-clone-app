// @ts-nocheck
/**
 * YouTubei.js Client-Side Integration
 * 
 * Uses the youtubei.js browser bundle to call YouTube's InnerTube API
 * DIRECTLY from the browser (no server proxy - sandbox endpoint is
 * CORS-safe). The decipher functions run 100% in the browser.
 * 
 * NOTE: www.youtube.com/youtubei/* is CORS-blocked in browsers, so we
 * map those requests to Google's own sandbox endpoint
 * (release-youtubei.sandbox.googleapis.com) which sends
 * Access-Control-Allow-Origin: *. Everything else (base.js, iframe_api)
 * passes through directly.
 */

const YT_API_SANDBOX = 'https://release-youtubei.sandbox.googleapis.com/youtubei/';
const YT_API_SANDBOX_ORIGIN = 'https://release-youtubei.sandbox.googleapis.com';

// Direct browser fetch — youtubei API calls map to the CORS-safe sandbox host
function createDirectFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // youtubei.js can construct relative URLs — resolve against the sandbox origin
    if (url.startsWith('/')) {
      url = YT_API_SANDBOX_ORIGIN + url;
    }

    // Map CORS-blocked production youtubei host to the CORS-enabled sandbox host
    if (url.includes('www.youtube.com/youtubei/') || url.includes('youtubei.googleapis.com/youtubei/')) {
      const sandboxUrl = url
        .replace('https://www.youtube.com/youtubei/', YT_API_SANDBOX)
        .replace('https://youtubei.googleapis.com/youtubei/', YT_API_SANDBOX);
      return fetch(sandboxUrl, init);
    }

    return fetch(url, init);
  };
}

let ytInstance: any = null;
let ytInstanceCreatedAt = 0;
let ytInstancePoToken = '';
let ytInstanceVisitorData = '';
const YT_INSTANCE_TTL = 30 * 60 * 1000; // 30 minutes

export async function createYtInstance(apiBase: string, poToken?: string, visitorData?: string) {
  const now = Date.now();
  const tokensChanged = ytInstancePoToken !== poToken || ytInstanceVisitorData !== visitorData;
  if (ytInstance && !tokensChanged && (now - ytInstanceCreatedAt < YT_INSTANCE_TTL)) {
    return ytInstance;
  }
  
  try {
    const { Innertube, Platform } = await import('youtubei.js/bundle/browser.js');
    
    // Override the eval to use Node.js Function() instead of browser eval
    Platform.shim.eval = async (data: any) => {
      const script = `
        var recsCache = new Map ? new Map() : {};
        var ntc = typeof Map !== 'undefined' ? new Map() : {};
        ${data.output}
      `;
      try {
        // eslint-disable-next-line no-new-func
        return new Function(script)();
      } catch (e) {
        console.error('[YouTubei] eval failed:', e);
        throw e;
      }
    };
    
    // Override fetch to call YouTube directly from the browser (sandbox host for CORS)
    Platform.shim.fetch = createDirectFetch();
    
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
    console.log(`[YouTubei Client] Instance created (${poToken ? 'with PO token' : 'NO PO token'}), player URL:`, instance?.session?.player?.url);
    return instance;
  } catch (e: any) {
    console.error('[YouTubei Client] Failed to create instance:', e.message);
    throw e;
  }
}

export async function getStreamingData(videoId: string, apiBase: string, poToken?: string, visitorData?: string) {
  try {
    const yt = await createYtInstance(apiBase, poToken, visitorData);
    if (!yt) throw new Error('No yt instance');
    
    const info = await yt.getBasicInfo(videoId);
    const streamingData = info.streaming_data;
    
    if (!streamingData) throw new Error('No streaming data');
    
    const adaptiveFormats = streamingData.adaptive_formats || [];
    const formats = streamingData.formats || [];
    
    console.log(`[YouTubei Client] Got ${formats.length} formats + ${adaptiveFormats.length} adaptive for ${videoId}`);
    
    // Check if we have cipher data
    const hasCipher = adaptiveFormats.some((f: any) => f.url || f.signature_cipher || f.cipher);
    if (!hasCipher) {
      throw new Error('No URL/cipher data in formats (bot detection?). Need a valid PO token.');
    }
    
    // Decipher all formats using youtubei.js's built-in decipher
    const decipheredFormats: Array<{
      url: string;
      mimeType: string;
      itag: number;
      height?: number;
      width?: number;
      hasAudio: boolean;
      hasVideo: boolean;
    }> = [];
    
    for (const fmt of [...formats, ...adaptiveFormats]) {
      try {
        const url = await fmt.decipher(yt.session.player);
        if (url) {
          decipheredFormats.push({
            url,
            mimeType: fmt.mime_type,
            itag: fmt.itag,
            height: fmt.height,
            width: fmt.width,
            hasAudio: !!fmt.has_audio,
            hasVideo: !!fmt.has_video
          });
        }
      } catch (e: any) {
        // Skip this format
      }
    }
    
    console.log(`[YouTubei Client] Deciphered ${decipheredFormats.length} URLs`);
    return decipheredFormats;
  } catch (e: any) {
    console.error('[YouTubei Client] getStreamingData failed:', e.message);
    throw e;
  }
}
