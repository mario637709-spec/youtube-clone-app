const youtubedl = require('youtube-dl-exec');
async function test() {
  try {
    const options = {
      dumpJson: true,
      extractorArgs: 'youtube:player-client=web,default'
    };
    console.log('Testing with web client...');
    const output = await youtubedl('https://www.youtube.com/watch?v=rd8gluFuWP8', options);
    console.log('Got formats:', output.formats ? output.formats.length : 'none');
  } catch(e) {
    console.error('Error:', e.message);
  }
}
test();
