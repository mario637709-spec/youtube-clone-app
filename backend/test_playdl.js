const play = require('play-dl');

async function testStream() {
  try {
    const stream = await play.stream('https://www.youtube.com/watch?v=rd8gluFuWP8', { quality: 1 });
    console.log('Stream object:', typeof stream.stream, 'type:', stream.type);
    console.log('Success!');
  } catch (error) {
    console.error('Play-dl error:', error);
  }
}
testStream();
