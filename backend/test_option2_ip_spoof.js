// test_option2_ip_spoof.js
const { Innertube } = require('youtubei.js');
const spoofedIP = '8.8.8.8'; // Using Google's public DNS IP for testing

// Monkey-patch global fetch to inject X-Forwarded-For
const originalFetch = global.fetch;
global.fetch = async (...args) => {
    let [url, config] = args;
    
    // Check if the request is going to YouTube API
    if (typeof url === 'string' && url.includes('youtubei/v1/player')) {
        config = config || {};
        config.headers = config.headers || {};
        // Inject IP spoofing headers
        config.headers['X-Forwarded-For'] = spoofedIP;
        // config.headers['Client-IP'] = spoofedIP; 
        console.log(`\n[+] Intercepted InnerTube request. Injecting IP: ${spoofedIP}`);
    }
    
    return originalFetch(url, config);
};

async function runTest() {
    console.log('--- Testing Option 2 (IP Spoofing via X-Forwarded-For) ---');
    console.log(`Target Spoof IP: ${spoofedIP}\n`);
    
    try {
        // Initialize youtubei.js
        console.log('Initializing youtubei.js (WEB client)...');
        const yt = await Innertube.create({ generate_session_locally: true });
        
        const videoId = 'dQw4w9WgXcQ'; // Rick Astley
        console.log(`Fetching formats for video: ${videoId}...`);
        
        const info = await yt.getBasicInfo(videoId);
        
        const formats = info.streaming_data?.formats || [];
        const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
        const allFormats = [...formats, ...adaptiveFormats];
        
        if (allFormats.length > 0) {
            const sampleFormat = allFormats.find(f => f.has_video) || allFormats[0];
            
            // Extract URL from direct URL or cipher
            let streamUrl = sampleFormat.url;
            
            if (!streamUrl && sampleFormat.signature_cipher) {
                console.log('Format is ciphered, extracting raw cipher URL string...');
                // The cipher is a query string containing url=...
                const params = new URLSearchParams(sampleFormat.signature_cipher);
                streamUrl = params.get('url');
            } else if (!streamUrl && sampleFormat.decipher) {
               // Sometimes youtubei wraps it
               streamUrl = await sampleFormat.decipher(yt.session.player);
            }
            
            if (streamUrl) {
                console.log('\n[+] Got Stream URL (first 100 chars):');
                console.log(streamUrl.substring(0, 100));
                
                // Parse the URL and check the 'ip=' parameter
                try {
                    const parsedUrl = new URL(streamUrl);
                    const ipBound = parsedUrl.searchParams.get('ip');
                    
                    console.log(`\n=== RESULTS ===`);
                    if (ipBound) {
                        console.log(`YouTube bound this URL to IP : ${ipBound}`);
                        if (ipBound === spoofedIP) {
                            console.log(`✅ SUCCESS! Option 2 works! YouTube accepted our spoofed IP (${spoofedIP}).`);
                        } else {
                            console.log(`❌ FAILED! YouTube ignored our spoofed IP and used the server's real IP (${ipBound}).`);
                        }
                    } else {
                        console.log(`No 'ip=' parameter found in the URL.`);
                    }
                } catch(e) {
                    console.log('Could not parse URL:', e.message);
                }
            } else {
                console.log('Could not extract a stream URL from the format.');
            }
        } else {
            console.log('No formats found for this video.');
        }
    } catch (err) {
        console.error('Error during test:', err);
    }
}

runTest();
