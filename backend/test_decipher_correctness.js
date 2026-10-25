const fs = require('fs');
const path = require('path');

class DecipherEngine {
  constructor(jsContent) {
    this.jsContent = jsContent;
    this.engine = null;
  }

  compile() {
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
             return n;
          }
        };
      `;

      const createEngine = new Function(compiledScriptCode);
      this.engine = createEngine();
      return true;
    }
    return false;
  }

  decipherSig(s) {
    return this.engine.decipherSig(s);
  }
}

async function main() {
  try {
    const jsUrl = 'https://www.youtube.com/s/player/0053e6c9/player_es6.vflset/en_US/base.js';
    const res = await fetch(jsUrl);
    const jsContent = await res.text();
    const engine = new DecipherEngine(jsContent);
    engine.compile();

    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true, retrieve_player: true });
    
    const info = await yt.getBasicInfo('f8rvVxDENIs');
    const formats = info.streaming_data?.adaptive_formats || [];
    
    console.log('Total adaptive formats:', formats.length);
    const cipheredFormat = formats.find(f => !f.url && f.decipher);
    
    if (!cipheredFormat) {
      console.log('No ciphered formats found in Innertube parsed response!');
      return;
    }
    
    console.log('Resolving stream URL via Innertube...');
    const ytUrl = await cipheredFormat.decipher(yt.session.player);
    console.log('Innertube Deciphered URL (first 120 chars):', ytUrl.substring(0, 120));
    
    const cipher = cipheredFormat.signature_cipher || cipheredFormat.cipher;
    if (!cipher) {
      console.log('Could not find raw cipher in format.');
      return;
    }
    
    const params = new URLSearchParams(cipher);
    const s = params.get('s');
    
    console.log('Original signature s (length ' + s.length + '):', s);
    const decrypted = engine.decipherSig(s);
    console.log('Decrypted signature (length ' + decrypted.length + '):', decrypted);
    
    const ytUrlObj = new URL(ytUrl);
    const ytSig = ytUrlObj.searchParams.get('sig');
    console.log('Innertube signature (length ' + ytSig.length + '):', ytSig);
    
    if (decrypted === ytSig) {
      console.log('MATCH SUCCESS! Manual decipher matches Innertube output!');
    } else {
      console.log('MISMATCH! Manual decipher does NOT match Innertube!');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
