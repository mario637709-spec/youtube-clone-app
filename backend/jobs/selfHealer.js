const youtubeDl = require('youtube-dl-exec');
const fs = require('fs');

/**
 * Self-Healing Microservice Agent
 * Automatically updates the decipher engine (yt-dlp) to adapt to YouTube's base.js changes.
 */
class SelfHealerAgent {
  constructor() {
    this.intervalHours = 12; // Check twice a day
  }

  async start() {
    console.log('[SelfHealer Agent] 🛡️ Initialized. Monitoring YouTube security updates...');
    this.runUpdateCheck();
    
    setInterval(() => {
      this.runUpdateCheck();
    }, this.intervalHours * 60 * 60 * 1000);
  }

  async runUpdateCheck() {
    console.log('[SelfHealer Agent] 🔍 Checking for yt-dlp binary updates...');
    try {
      // yt-dlp has a built-in update command
      const output = await youtubeDl('', { update: true });
      console.log('[SelfHealer Agent] ✅ Update Check Complete:', output || 'Already up to date.');
    } catch (error) {
      if (error.message.includes('up to date')) {
        console.log('[SelfHealer Agent] ✅ Engine is already up to date with latest YouTube base.js signatures.');
      } else {
        console.warn('[SelfHealer Agent] ⚠️ Update attempt logged:', error.message.split('\n')[0]);
      }
    }
  }
}

module.exports = new SelfHealerAgent();
