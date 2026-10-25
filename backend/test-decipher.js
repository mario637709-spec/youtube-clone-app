const fs = require('fs');
const https = require('https');

https.get('https://www.youtube.com/watch?v=muLA_Y-1iR0', (res) => {
    let html = '';
    res.on('data', d => html += d);
    res.on('end', () => {
        const jsUrlMatch = html.match(/"jsUrl":"([^"]+)"/);
        if (!jsUrlMatch) return console.error('No jsUrl found');
        const jsUrl = 'https://www.youtube.com' + jsUrlMatch[1];
        console.log('Found jsUrl:', jsUrl);
        https.get(jsUrl, (jsRes) => {
            let jsContent = '';
            jsRes.on('data', d => jsContent += d);
            jsRes.on('end', () => {
                const R_REGEXP = /(var\s+([a-zA-Z0-9_$]+)\s*=\s*['"](?:[^'\\]|\\.)*['"]\.split\(['"];['"]\))/;
                const rMatch = jsContent.match(R_REGEXP);

                const HELPER_REGEXP_GENERIC = /var\s+([a-zA-Z0-9_$]+)\s*=\s*\{\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{[a-zA-Z0-9_$]+\[[a-zA-Z0-9_$]+\[\d+\]\]\(0,[a-zA-Z0-9_$]+\)\}\s*,\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\[0\];[\s\S]+?\}\s*,\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+\)\{[\s\S]+?\}\s*\};/;
                const helperMatch = jsContent.match(HELPER_REGEXP_GENERIC);

                const DECIPHER_REGEXP = /([a-zA-Z0-9_$]+)\s*=\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{\s*var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\^[a-zA-Z0-9_$]+;\s*if\(\([a-zA-Z0-9_$]+\^12\)<26[\s\S]+?return\s+[a-zA-Z0-9_$]+\};/;
                const decipherMatch = jsContent.match(DECIPHER_REGEXP);

                if (rMatch && helperMatch && decipherMatch) {
                    const compiledScriptCode = `
                      var recsCache = new Map(); // Polyfill
                      var ntc = new Map(); 
                      ${rMatch[1]};
                      ${helperMatch[0]};
                      var ${decipherMatch[1]} = ${decipherMatch[0]};
                      
                      return {
                        decipherSig: function(s) { return ${decipherMatch[1]}(2, 6296, s); },
                        decipherN: function(n) { return ${decipherMatch[1]}(1, 6299, n); }
                      };
                    `;
                    try {
                        const createEngine = new Function(compiledScriptCode);
                        const engine = createEngine();
                        console.log('Engine compiled successfully!');
                        console.log('Decipher N test:', engine.decipherN('12345'));
                    } catch (err) {
                        console.error('Compilation error:', err);
                    }
                } else {
                    console.log('Regex failed:', { rMatch: !!rMatch, helperMatch: !!helperMatch, decipherMatch: !!decipherMatch });
                    // To help debug, let's look for recsCache in jsContent
                    console.log('Is recsCache in jsContent?', jsContent.includes('recsCache'));
                }
            });
        });
    });
});
