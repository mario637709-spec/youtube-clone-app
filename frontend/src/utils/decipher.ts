// @ts-nocheck
export class DecipherEngine {
  constructor(jsContent) {
    this.jsContent = jsContent;
    this.engine = null;
  }

  compile() {
    // Try ES6 Player (player_es6) first
    try {
      const nIndex = this.jsContent.indexOf('var N=[');
      let nCode = '';
      if (nIndex !== -1) {
        let braceCount = 0, started = false;
        for (let i = nIndex; i < this.jsContent.length; i++) {
          const char = this.jsContent[i];
          nCode += char;
          if (char === '[') { braceCount++; started = true; }
          else if (char === ']') braceCount--;
          if (started && braceCount === 0) {
            if (this.jsContent[i+1] === ';') nCode += ';';
            break;
          }
        }
      }

      const kiIndex = this.jsContent.indexOf('Ki={');
      let kiCode = '';
      if (kiIndex !== -1) {
        let braceCount = 0, started = false;
        for (let i = kiIndex; i < this.jsContent.length; i++) {
          const char = this.jsContent[i];
          kiCode += char;
          if (char === '{') { braceCount++; started = true; }
          else if (char === '}') braceCount--;
          if (started && braceCount === 0) {
            if (this.jsContent[i+1] === ';') kiCode += ';';
            break;
          }
        }
      }

      const es6SigCallPattern = /([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\((\d+),(\d+),([a-zA-Z0-9_$]+)\((\d+),(\d+),\1\)\).+?([a-zA-Z0-9_$]+)\((\d+),(\d+),\1\)/;
      const es6Match = this.jsContent.match(es6SigCallPattern);

      if (nCode && kiCode && es6Match) {
        const biName = es6Match[5]; // inner (e.g. tN)
        const ciName = es6Match[2]; // middle (e.g. Wk)
        const dhName = es6Match[8]; // outer (e.g. hZ)

        const extractFunc = (name) => {
          const startIndex = this.jsContent.search(new RegExp(`\\b${name}\\s*=\\s*function\\s*\\(`));
          if (startIndex === -1) return '';
          let code = '', braceCount = 0, started = false;
          let inString = null, inRegex = false, escape = false;
          for (let i = startIndex; i < this.jsContent.length; i++) {
            const char = this.jsContent[i];
            code += char;
            if (escape) { escape = false; continue; }
            if (char === '\\') { escape = true; continue; }
            if (inString) {
              if (char === inString) inString = null;
              continue;
            }
            if (inRegex) {
              if (char === '/') inRegex = false;
              continue;
            }
            if (char === '"' || char === "'" || char === '`') {
              inString = char;
              continue;
            }
            if (char === '/') {
              const prev = code.length >= 2 ? code[code.length - 2] : '';
              if (' ,;([=!&|?'.includes(prev)) { inRegex = true; continue; }
            }
            if (char === '{') { braceCount++; started = true; }
            else if (char === '}') braceCount--;
            if (started && braceCount === 0) {
              if (this.jsContent[i+1] === ';') code += ';';
              break;
            }
          }
          return code;
        };

        const biCode = extractFunc(biName);
        const ciCode = extractFunc(ciName);
        const dhCode = extractFunc(dhName);

        if (biCode && ciCode && dhCode) {
          const compiledScriptCode = `
            var g = {
               pe: function(a, b) { this.message = a; },
               GB: function(a) { return {}; },
               OQ: function(a) { return a; },
               AM: function(a) { this.url = a; }
            };
            var Ki;
            ${nCode};
            ${kiCode};
            var ${biName} = ${biCode};
            var ${ciName} = ${ciCode};
            var ${dhName} = ${dhCode};
            
            return {
              decipherSig: function(s) {
                 return ${dhName}(${es6Match[9]}, ${es6Match[10]}, ${ciName}(${es6Match[3]}, ${es6Match[4]}, ${biName}(${es6Match[6]}, ${es6Match[7]}, s)));
              },
              decipherN: function(n) {
                 return n; // default to passthrough on ES6
              }
            };
          `;

          let createEngine;
          try {
            createEngine = new Function(compiledScriptCode);
            this.engine = createEngine();
            console.log('[Browser Decipher] ES6 TCE Engine successfully compiled.');
            return true;
          } catch (funcErr) {
            console.error('[Browser Decipher] SyntaxError in compiledScriptCode:', funcErr);
            console.error('FAILED SCRIPT CODE:\n', compiledScriptCode);
            throw funcErr;
          }
        }
      }
    } catch (err) {
      console.warn('[Browser Decipher] ES6 compilation failed:', err);
    }

    try {
      // 1. Try to extract using the ES5 TCE chain structure
      // A. Extract e array
      const eMatch = this.jsContent.match(/var\s+e\s*=\s*("[^"]+"|'[^']+')\.split\(";"\)/) || 
                     this.jsContent.match(/var\s+e\s*=\s*("[^"]+"|'[^']+')\.split\(';'\)/);
      
      // B. Extract sN helper object using brace counting
      const sNIndex = this.jsContent.indexOf('var sN={');
      let sNCode = '';
      if (sNIndex !== -1) {
        let braceCount = 0;
        let started = false;
        for (let i = sNIndex; i < this.jsContent.length; i++) {
          const char = this.jsContent[i];
          sNCode += char;
          if (char === '{') {
            braceCount++;
            started = true;
          } else if (char === '}') {
            braceCount--;
          }
          if (started && braceCount === 0) {
            if (this.jsContent[i+1] === ';') sNCode += ';';
            break;
          }
        }
      }

      // C. Extract Sig Call parameters and functions
      const sigCallPattern = /\.s\)\{var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.sp,([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\((\d+),(\d+),([a-zA-Z0-9_$]+)\((\d+),(\d+),[a-zA-Z0-9_$]+\.s\)\);[a-zA-Z0-9_$]+\[[a-zA-Z0-9_$]+\[\d+\]\]\([a-zA-Z0-9_$]+,([a-zA-Z0-9_$]+)\((\d+),(\d+),\1\)\)\}/;
      const sigMatch = this.jsContent.match(sigCallPattern);

      // D. Extract N Call parameters and functions
      const nCallPattern = /([a-zA-Z0-9_$]+)&&\(\1=([a-zA-Z0-9_$]+)\((\d+),(\d+),([a-zA-Z0-9_$]+)\((\d+),(\d+),\1\)\),[a-zA-Z0-9_$]+\[[a-zA-Z0-9_$]+\[\d+\]\]\([a-zA-Z0-9_$]+,([a-zA-Z0-9_$]+)\((\d+),(\d+),\1\)\)\)/;
      const nMatch = this.jsContent.match(nCallPattern);

      if (eMatch && sNCode && sigMatch && nMatch) {
        const eCode = eMatch[0];
        
        // Functions to extract using brace counting
        const biName = sigMatch[5];
        const ciName = sigMatch[2];
        const dhName = sigMatch[8];

        const extractFunc = (name) => {
          const startIndex = this.jsContent.search(new RegExp(`\\b${name}\\s*=\\s*function\\s*\\(`));
          if (startIndex === -1) return '';
          let code = '', braceCount = 0, started = false;
          let inString = null, inRegex = false, escape = false;
          for (let i = startIndex; i < this.jsContent.length; i++) {
            const char = this.jsContent[i];
            code += char;
            if (escape) { escape = false; continue; }
            if (char === '\\') { escape = true; continue; }
            if (inString) {
              if (char === inString) inString = null;
              continue;
            }
            if (inRegex) {
              if (char === '/') inRegex = false;
              continue;
            }
            if (char === '"' || char === "'" || char === '`') {
              inString = char;
              continue;
            }
            if (char === '/') {
              const prev = code.length >= 2 ? code[code.length - 2] : '';
              if (' ,;([=!&|?'.includes(prev)) { inRegex = true; continue; }
            }
            if (char === '{') { braceCount++; started = true; }
            else if (char === '}') braceCount--;
            if (started && braceCount === 0) {
              if (this.jsContent[i+1] === ';') code += ';';
              break;
            }
          }
          return code;
        };

        const biCode = extractFunc(biName);
        const ciCode = extractFunc(ciName);
        const dhCode = extractFunc(dhName);

        if (biCode && ciCode && dhCode) {
          const compiledScriptCode = `
            var g = {
               NV: function(a, b) { return a; },
               O7: function(a, b) { }
            };
            ${eCode};
            ${sNCode};
            var ${biName} = ${biCode};
            var ${ciName} = ${ciCode};
            var ${dhName} = ${dhCode};
            
            return {
              decipherSig: function(s) {
                 return ${dhName}(${sigMatch[9]}, ${sigMatch[10]}, ${ciName}(${sigMatch[3]}, ${sigMatch[4]}, ${biName}(${sigMatch[6]}, ${sigMatch[7]}, s)));
              },
              decipherN: function(n) {
                 return ${dhName}(${nMatch[9]}, ${nMatch[10]}, ${ciName}(${nMatch[3]}, ${nMatch[4]}, ${biName}(${nMatch[6]}, ${nMatch[7]}, n)));
              }
            };
          `;

          const createEngine = new Function(compiledScriptCode);
          this.engine = createEngine();
          console.log('[Browser Decipher] ES5 TCE Engine successfully compiled.');
          return true;
        }
      }
    } catch (err) {
      console.warn('[Browser Decipher] ES5 compilation failed, trying legacy patterns:', err);
    }

    try {
      // 2. Legacy fallback
      const R_REGEXP = /(var\s+([a-zA-Z0-9_$]+)\s*=\s*['"](?:[^'\\]|\\.)*['"]\.split\(['"];['"]\))/;
      const rMatch = this.jsContent.match(R_REGEXP);

      const HELPER_REGEXP_GENERIC = /var\s+([a-zA-Z0-9_$]+)\s*=\s*\{\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{[a-zA-Z0-9_$]+\[[a-zA-Z0-9_$]+\[\d+\]\]\(0,[a-zA-Z0-9_$]+\)\}\s*,\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\[0\];[\s\S]+?\}\s*,\s*[a-zA-Z0-9_$]+\s*:\s*function\([a-zA-Z0-9_$]+\)\{[\s\S]+?\}\s*\};/;
      const helperMatch = this.jsContent.match(HELPER_REGEXP_GENERIC);

      const DECIPHER_REGEXP = /([a-zA-Z0-9_$]+)\s*=\s*function\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{\s*var\s+[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\^[a-zA-Z0-9_$]+;\s*if\(\([a-zA-Z0-9_$]+\^12\)<26[\s\S]+?return\s+[a-zA-Z0-9_$]+\};/;
      const decipherMatch = this.jsContent.match(DECIPHER_REGEXP);

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
        const sigCallMatch = this.jsContent.match(sigCallRegex);
        if (sigCallMatch) {
          sigParam1 = parseInt(sigCallMatch[2], 10);
          sigParam2 = parseInt(sigCallMatch[3], 10);
        }

        const nCallRegex = new RegExp(`${decipherName}\\((\\d+),(\\d+),[a-zA-Z0-9_$]+\\(\\d+,\\d+,([a-zA-Z0-9_$]+)\\)\\)`);
        const nCallMatch = this.jsContent.match(nCallRegex);
        if (nCallMatch) {
          nParam1 = parseInt(nCallMatch[1], 10);
          nParam2 = parseInt(nCallMatch[2], 10);
        } else {
          const nCallRegexGeneric = new RegExp(`([a-zA-Z0-9_$]+)=${decipherName}\\((\\d+),(\\d+),[a-zA-Z0-9_$]+\\(\\d+,\\d+,\\1\\)\\)`);
          const nCallMatchGeneric = this.jsContent.match(nCallRegexGeneric);
          if (nCallMatchGeneric) {
            nParam1 = parseInt(nCallMatchGeneric[2], 10);
            nParam2 = parseInt(nCallMatchGeneric[3], 10);
          }
        }

        const compiledScriptCode = `
          var recsCache = new Map();
          var ntc = new Map(); 
          ${rCode};
          ${helperCode};
          var ${decipherName} = ${decipherCode};
          
          return {
            decipherSig: function(s) { return ${decipherName}(${sigParam1}, ${sigParam2}, s); },
            decipherN: function(n) { return ${decipherName}(${nParam1}, ${nParam2}, n); }
          };
        `;

        window.__LAST_COMPILED_CODE = compiledScriptCode;
        const createEngine = new Function(compiledScriptCode);
        this.engine = createEngine();
        console.log('[Browser Decipher] Legacy Engine successfully compiled.');
        return true;
      }
    } catch (err) {
      console.error('[Browser Decipher] Legacy compilation error:', err);
    }
    return false;
  }

  decipherSig(s) {
    if (this.engine && s) return this.engine.decipherSig(s);
    return s;
  }

  decipherN(n) {
    if (this.engine && n) return this.engine.decipherN(n);
    return n;
  }
}


// processFormatUrl: accepts pre-compiled engine OR jsContent (compiles once internally)
// Per warning.txt: browser does ALL decryption, server never touches CDN streams
export const processFormatUrl = async (format: any, jsContentOrEngine: string | DecipherEngine) => {
  let decipher: DecipherEngine;
  if (typeof jsContentOrEngine === 'string') {
    decipher = new DecipherEngine(jsContentOrEngine);
    decipher.compile();
  } else {
    decipher = jsContentOrEngine;
  }

  let url: string | null = format.url || null;
  const cipher = format.signatureCipher || format.cipher || format.signature_cipher;

  if (!url && cipher) {
    const cipherParams = new URLSearchParams(cipher);
    const s = cipherParams.get('s');
    const sp = cipherParams.get('sp') || 'sig';
    const baseUrl = cipherParams.get('url');
    if (!baseUrl) return null;

    const decryptedSig = decipher.decipherSig(s);
    if (!decryptedSig) return null;
    url = `${baseUrl}&${sp}=${encodeURIComponent(decryptedSig)}`;
  }

  if (!url) return null;

  try {
    const urlObj = new URL(url);
    // Transform 'n' parameter to avoid throttling (critical for smooth playback)
    const nParam = urlObj.searchParams.get('n');
    if (nParam) {
      const decryptedN = decipher.decipherN(nParam);
      if (decryptedN && decryptedN !== nParam) {
        urlObj.searchParams.set('n', decryptedN);
      }
    }
    // Remove 'spc' (Streaming Profile Check) — causes 403 without valid PO Token
    // YouTube CDN still serves content without it in most cases
    urlObj.searchParams.delete('spc');
    url = urlObj.toString();
  } catch (e) {
    // ignore URL parse errors
  }

  return url;
};

// Helper: compile engine once and process all formats efficiently
export const processAllFormats = async (formats: any[], jsContent: string) => {
  const decipher = new DecipherEngine(jsContent);
  const compiled = decipher.compile();
  if (!compiled) {
    console.warn('[Browser Decipher] Engine failed to compile — trying URL-only formats');
  }
  
  const results: string[] = [];
  for (const fmt of formats) {
    const url = await processFormatUrl(fmt, decipher);
    results.push(url || '');
  }
  return results;
};

