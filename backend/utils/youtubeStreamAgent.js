// youtube-dl-exec removed — replaced by lightweight youtubei.js (pure JS, zero CPU overhead)
const axios = require('axios');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Configure connection pool agents for high concurrency and keep-alive support
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1000,
  freeSocketTimeout: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 1000,
  freeSocketTimeout: 30000,
});

class ConcurrencyLimiter {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

/**
 * YouTube Stream Agent
 * Bypasses YouTube's player by extracting the raw .mp4 media URL using yt-dlp
 * and piping it securely to the client to avoid IP-mismatch 403 blocks.
 *
 * NOW UPGRADED: Supports high-performance signature/n-code decryption for client-side streaming.
 */
class YouTubeStreamAgent {
  constructor() {
    this.urlCache = new Map();
    this.decipherCache = new Map();
    this.ncodeCache = new Map();
    this.decipherEngineCache = new Map();
    this.activeExtractions = new Map();
    this.limiter = new ConcurrencyLimiter(3);
  }

  async getRawStreamUrl(youtubeId, quality, poToken, visitorData, isAudio = false, clientIp = null) {
    this.currentClientIp = clientIp;
    const cacheKey = `${youtubeId}_${quality || 'auto'}_${isAudio ? 'audio' : 'video'}`;
    const cached = this.urlCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      console.log(`[YouTubeAgent] Serving cached raw URL for: ${cacheKey}`);
      return cached.url;
    }

    if (this.activeExtractions.has(cacheKey)) {
      console.log(`[YouTubeAgent] Coalescing concurrent extraction for: ${cacheKey}`);
      return this.activeExtractions.get(cacheKey);
    }

    const extractionPromise = (async () => {
      try {
        console.log(`[YouTubeAgent] Fast extracting raw URL for: ${youtubeId} (${quality || 'auto'}, isAudio: ${isAudio})`);

        // 1. Distube ytdl-core DISABLED — its decipher/n-code parser is broken
        //    (YouTube changes base.js frequently, ytdl-core can't keep up)
        //    Returns URLs with invalid signatures → 403 Forbidden
        //    Using youtubei.js instead (has its own working JS interpreter)

        // 2. InnerTube proxy DISABLED — same issue as ytdl-core
        //    The in-memory signature/n-code decryption can't keep up
        //    with YouTube's frequent base.js changes, resulting in 403s

        // 3. Option 1 (IOS Spoofing): Using ytdl-core with IOS client
        // IOS client often returns direct URLs (no decipher needed) and might have more lenient CDN IP rules.
        console.log(`[YouTubeAgent] Fetching raw URL via ytdl-core (IOS Client) for: ${youtubeId}`);
        const ytdl = require('@distube/ytdl-core');
        
        const info = await ytdl.getInfo(youtubeId, {
          clients: ['IOS'] // Force IOS client spoofing
        });
        
        let selectedFormat = null;
        if (isAudio) {
          selectedFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
        } else {
          if (quality && quality !== 'auto') {
            const h = parseInt(quality.replace('p', ''), 10);
            selectedFormat = info.formats.find(f => f.height === h && f.hasVideo && f.hasAudio) || 
                             info.formats.find(f => f.height === h && f.hasVideo);
          }
          if (!selectedFormat) {
            selectedFormat = ytdl.chooseFormat(info.formats, { quality: 'highest' });
          }
        }

        if (!selectedFormat) {
           throw new Error('ytdl-core (IOS): no suitable format found.');
        }

        let streamUrl = selectedFormat.url;
        if (!streamUrl) {
          throw new Error('ytdl-core (IOS) could not extract direct stream url.');
        }
        
        console.log(`[YouTubeAgent] ytdl-core successfully fetched IOS url for: ${youtubeId}`);

        // Remove 'spc' (Streaming Profile Check) parameter — causes 403 blocks in the browser
        try {
          const cleanUrl = new URL(streamUrl);
          cleanUrl.searchParams.delete('spc');
          streamUrl = cleanUrl.toString();
        } catch (e) {
          // ignore url parsing errors
        }

        this.urlCache.set(cacheKey, {
          url: streamUrl,
          expires: Date.now() + 3600000
        });
        return streamUrl;
      } catch (err) {
        console.error('[YouTubeAgent] All extraction layers failed:', err.message);
        throw err;
      } finally {
        this.activeExtractions.delete(cacheKey);
      }
    })();

    this.activeExtractions.set(cacheKey, extractionPromise);
    return extractionPromise;
  }


  async getPipedStreamUrl(youtubeId, quality, isAudio = false) {
    const cacheKey = `piped_${youtubeId}_${quality || 'auto'}_${isAudio ? 'audio' : 'video'}`;
    const cached = this.urlCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      console.log(`[YouTubeAgent] Serving cached Piped URL for: ${cacheKey}`);
      return cached.url;
    }

    const PIPED_INSTANCES = [
      'https://pipedapi.lunar.icu',
      'https://pipedapi.kavin.rocks',
      'https://api.piped.yt',
      'https://piped-api.garudalinux.org',
      'https://piped-api.privacydev.net'
    ];

    let errorMsg = '';
    for (const instance of PIPED_INSTANCES) {
      try {
        console.log(`[PipedAgent] Fetching streams from instance: ${instance} for video: ${youtubeId} (isAudio: ${isAudio})`);
        const response = await axios.get(`${instance}/streams/${youtubeId}`, { timeout: 4000 });
        
        if (response.data) {
          if (isAudio) {
            const streams = response.data.audioStreams || [];
            if (streams.length > 0) {
              console.log(`[PipedAgent] Found audio stream URL on ${instance}`);
              this.urlCache.set(cacheKey, {
                url: streams[0].url,
                expires: Date.now() + 45 * 60 * 1000
              });
              return streams[0].url;
            }
          } else if (Array.isArray(response.data.videoStreams)) {
            // Filter combined streams (video + audio)
            const streams = response.data.videoStreams.filter(s => s.videoOnly === false);
            
            if (streams.length === 0) {
              streams.push(...response.data.videoStreams);
            }
    
            if (streams.length > 0) {
              // Quality matching
              let targetStream = null;
              if (quality && quality !== 'auto') {
                const height = parseInt(quality.replace('p', ''), 10);
                targetStream = streams.find(s => s.quality === quality || s.quality === `${quality}p` || s.quality === `${height}p` || s.quality === String(height));
              }
              if (!targetStream) {
                targetStream = streams[0]; // fallback to first stream (highest quality)
              }
    
              console.log(`[PipedAgent] Found stream URL on ${instance}: Quality ${targetStream.quality}`);
              // Cache it for 45 minutes
              this.urlCache.set(cacheKey, {
                url: targetStream.url,
                expires: Date.now() + 45 * 60 * 1000
              });
              return targetStream.url;
            }
          }
        }
      } catch (err) {
        console.warn(`[PipedAgent] Instance ${instance} failed:`, err.message);
        errorMsg = err.message;
      }
    }

    throw new Error(`All public Piped instances failed: ${errorMsg}`);
  }

  async pipeStream(youtubeId, req, res) {
    try {
      const quality = req.query.quality;
      const type = req.query.type;
      const poToken = req.query.poToken;
      const visitorData = req.query.visitorData;
      
      const isAudio = type === 'audio';
      let rawUrl;
      try {
        rawUrl = await this.getRawStreamUrl(youtubeId, quality, poToken, visitorData, isAudio);
      } catch (extractErr) {
        console.warn(`[YouTubeAgent] Direct extraction failed for ${youtubeId}, trying Piped fallback... Error:`, extractErr.message);
        try {
          rawUrl = await this.getPipedStreamUrl(youtubeId, quality, isAudio);
        } catch (pipedErr) {
          console.warn(`[YouTubeAgent] Piped fallback also failed:`, pipedErr.message);
        }
      }

      if (rawUrl) {
        // YouTube CDN URLs are IP-bound to the user's IP at request time.
        // Proxying through backend causes 403 because server IP != user's browser IP.
        // SOLUTION: Redirect browser directly to CDN URL — browser hits CDN with correct IP.
        console.log(`[YouTubeAgent] Redirecting to direct CDN URL (avoiding IP-mismatch 403): ${rawUrl.substring(0, 80)}...`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        return res.redirect(302, rawUrl);
      }

      // Last resort: try ytdl-core direct pipe
      const ytdl = require('@distube/ytdl-core');
      
      console.log(`[YouTubeAgent] Fallback: Piping stream using ytdl-core for: ${youtubeId}`);
      
      const streamOptions = {
        quality: isAudio ? 'highestaudio' : 'highest',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }
      };

      if (req.headers.range) {
        streamOptions.range = req.headers.range;
      }

      const stream = ytdl(youtubeId, streamOptions);
      
      stream.on('response', (response) => {
        res.status(response.statusCode);
        const headersToForward = [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'cache-control'
        ];
        
        headersToForward.forEach(h => {
          if (response.headers[h]) {
            res.setHeader(h, response.headers[h]);
          }
        });
      });

      stream.on('error', (err) => {
        console.error('[YouTubeAgent] ytdl-core proxy error:', err.message);
        if (!res.headersSent) res.status(500).send('Error proxying stream');
      });

      stream.pipe(res);
    } catch (error) {
      console.error('[YouTubeAgent] Stream proxy error:', error.message);
      if (!res.headersSent) {
        res.status(500).send('Error proxying YouTube stream');
      }
    }
  }

  // --- SIGNATURE OFFLOADING & DECRYPTION ENGINE ---

  async fetchPlayerJs(jsUrl) {
    const cacheDir = path.join(__dirname, '../data/player-cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const safeName = encodeURIComponent(jsUrl).substring(0, 150) + '.js';
    const cacheFilePath = path.join(cacheDir, safeName);

    // Try to read from cache (valid for 24 hours)
    if (fs.existsSync(cacheFilePath)) {
      const stats = fs.statSync(cacheFilePath);
      if (Date.now() - stats.mtimeMs < 24 * 60 * 60 * 1000) {
        return fs.readFileSync(cacheFilePath, 'utf8');
      }
    }

    console.log(`[YouTubeAgent] Fetching player JS: ${jsUrl}`);
    const response = await axios.get(jsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    
    const jsContent = response.data;
    fs.writeFileSync(cacheFilePath, jsContent, 'utf8');
    return jsContent;
  }

  async getDecipherEngine(jsUrl) {
    if (this.decipherEngineCache.has(jsUrl)) {
      return this.decipherEngineCache.get(jsUrl);
    }

    try {
      const jsContent = await this.fetchPlayerJs(jsUrl);

      // 1. Extract R array
      const R_REGEXP = /(var\s+([a-zA-Z0-9_$]+)\s*=\s*['"](?:[^'\\]|\\.)*['"]\.split\(['"];['"]\))/;
      const rMatch = jsContent.match(R_REGEXP);

      // 2. Extract helper object
      const HELPER_REGEXP_GENERIC = /var\s+([a-zA-Z0-9_$]+)\s*=\s*\{\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{[a-zA-Z0-9_$]+\[[a-zA-Z0-9_$]+\[\d+\]\]\(0,[a-zA-Z0-9_$]+\)\}\s*,\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\[0\];[\s\S]+?\}\s*,\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+\)\{[\s\S]+?\}\s*\};/;
      const helperMatch = jsContent.match(HELPER_REGEXP_GENERIC);

      // 3. Extract decipher function
      const DECIPHER_REGEXP = /([a-zA-Z0-9_$]+)\s*=\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{\s*var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\^[a-zA-Z0-9_$]+;\s*if\(\([a-zA-Z0-9_$]+\^12\)<26[\s\S]+?return\s+[a-zA-Z0-9_$]+\};/;
      const decipherMatch = jsContent.match(DECIPHER_REGEXP);

      if (rMatch && helperMatch && decipherMatch) {
        const rCode = rMatch[1];
        const helperCode = helperMatch[0];
        const decipherName = decipherMatch[1];
        const decipherCode = decipherMatch[0];

        let sigParam1 = 2;
        let sigParam2 = 6296;
        let nParam1 = 1;
        let nParam2 = 6299;

        const sigCallRegex = new RegExp(`([a-zA-Z0-9_$]+)\\((\\d+),(\\d+),[a-zA-Z0-9_$]+\\(\\d+,\\d+,[a-zA-Z0-9_$]+\\.s\\)\\)`);
        const sigCallMatch = jsContent.match(sigCallRegex);
        if (sigCallMatch) {
          sigParam1 = parseInt(sigCallMatch[2], 10);
          sigParam2 = parseInt(sigCallMatch[3], 10);
        }

        const nCallRegex = new RegExp(`${decipherName}\\((\\d+),(\\d+),[a-zA-Z0-9_$]+\\(\\d+,\\d+,([a-zA-Z0-9_$]+)\\)\\)`);
        const nCallMatch = jsContent.match(nCallRegex);
        if (nCallMatch) {
          nParam1 = parseInt(nCallMatch[1], 10);
          nParam2 = parseInt(nCallMatch[2], 10);
        } else {
          const nCallRegexGeneric = new RegExp(`([a-zA-Z0-9_$]+)=${decipherName}\\((\\d+),(\\d+),[a-zA-Z0-9_$]+\\(\\d+,\\d+,\\1\\)\\)`);
          const nCallMatchGeneric = jsContent.match(nCallRegexGeneric);
          if (nCallMatchGeneric) {
            nParam1 = parseInt(nCallMatchGeneric[2], 10);
            nParam2 = parseInt(nCallMatchGeneric[3], 10);
          }
        }

        const compiledScriptCode = `
          ${rCode};
          ${helperCode};
          var ${decipherName} = ${decipherCode};
          
          function decipherSig(s) {
            return ${decipherName}(${sigParam1}, ${sigParam2}, s);
          }
          
          function decipherN(n) {
            return ${decipherName}(${nParam1}, ${nParam2}, n);
          }
        `;

        const script = new vm.Script(compiledScriptCode);
        const context = vm.createContext({});
        script.runInContext(context);

        const engine = {
          decipherSig: (s) => {
            context.sig = s;
            return vm.runInContext(`decipherSig(sig)`, context);
          },
          decipherN: (n) => {
            context.ncode = n;
            return vm.runInContext(`decipherN(ncode)`, context);
          }
        };

        this.decipherEngineCache.set(jsUrl, engine);
        console.log(`[SigDecrypt] Successfully compiled and cached decipher engine for: ${jsUrl}`);
        return engine;
      }
    } catch (e) {
      console.error("[SigDecrypt] Error building decipher engine:", e.message);
    }

    console.warn("[SigDecrypt] Falling back to bypass decipher/ncode");
    const fallbackEngine = {
      decipherSig: (s) => s,
      decipherN: (n) => n
    };
    this.decipherEngineCache.set(jsUrl, fallbackEngine);
    return fallbackEngine;
  }

  async decryptSignature(s, n, jsUrl) {
    if (!jsUrl) {
      jsUrl = 'https://www.youtube.com/s/player/e6e76cf0/player_ias.vflset/en_US/base.js';
    }
    
    if (jsUrl.startsWith('//')) {
      jsUrl = 'https:' + jsUrl;
    } else if (jsUrl.startsWith('/')) {
      jsUrl = 'https://www.youtube.com' + jsUrl;
    }

    let decryptedSig = s;
    let decryptedN = n;

    try {
      const engine = await this.getDecipherEngine(jsUrl);

      if (s) {
        decryptedSig = engine.decipherSig(s);
      }

      if (n) {
        decryptedN = engine.decipherN(n);
      }
    } catch (err) {
      console.error('[YouTubeAgent] Decryption failed, using fallback:', err.message);
    }

    return {
      sig: decryptedSig,
      n: decryptedN
    };
  }

  async getPlayerConfig(videoId, clientIp) {
    try {
      console.log(`[YouTubeAgent] Fetching player config for video ${videoId} using ytdl-core`);
      const ytdl = require('@distube/ytdl-core');
      const info = await ytdl.getBasicInfo(videoId);
      
      return {
        streamingData: info.player_response.streamingData,
        assets: {
          js: info.html5player
        }
      };
    } catch (err) {
      console.error('[YouTubeAgent] Error fetching player config using ytdl-core:', err.message);
      throw err;
    }
  }
}

module.exports = new YouTubeStreamAgent();
