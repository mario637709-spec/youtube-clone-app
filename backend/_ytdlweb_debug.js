const ytdl = require('@distube/ytdl-core');
(async () => {
  try {
    const info = await ytdl.getInfo('LqDratPh-OI', { clients: ['WEB'] });
    const fs = [...info.formats];
    console.log('FORMATS:', fs.length);
    for (const x of fs) {
      const isVid = x.mimeType?.startsWith('video/');
      const isAud = x.mimeType?.startsWith('audio/');
      const muxed = isVid && x.hasAudio;
      if (isVid || isAud) {
        console.log(`itag=${x.itag} | ${x.qualityLabel || x.quality} | ${(x.mimeType || '').split(';')[0]} | hasUrl=${!!x.url} | muxed=${muxed} | hasAudio=${x.hasAudio} | hasVideo=${x.hasVideo}`);
      }
    }
  } catch (e) {
    console.log('ERR:', e.message);
  }
  process.exit(0);
})();
