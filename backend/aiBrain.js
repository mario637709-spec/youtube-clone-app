const axios = require('axios');
const groqClient = require('./utils/groqClient');
const { syncChannel } = require('./utils/syncYouTubeChannel');

class AIBrain {
  constructor() {
    console.log('[AI Brain] Central AI Brain Module initialized.');
  }

  /**
   * General-purpose AI thinking method.
   * Can be invoked via HTTP request to let the server think and respond using Groq.
   * @param {string} prompt Prompt description
   * @param {string} systemPrompt Instructions for AI persona
   */
  async think(prompt, systemPrompt = "You are the AI Brain of our premium YouTube Clone application. Provide insightful, direct, and helpful solutions.") {
    console.log(`[AI Brain] Thinking request received: "${prompt.substring(0, 100)}..."`);
    
    try {
      const response = await groqClient.callGroq(systemPrompt, prompt, 0.7);
      console.log('[AI Brain] Thinking completed successfully.');
      return response;
    } catch (err) {
      console.error('[AI Brain] thinking call failed:', err.message);
      throw new Error(`AI Brain failed to think: ${err.message}`);
    }
  }

  /**
   * Rank candidate videos based on recently watched videos metadata.
   */
  async rankVideos(watchHistory, candidates) {
    return await groqClient.rankRecommendedVideos(watchHistory, candidates);
  }

  /**
   * Enrich title, category, description and tags for newly synced videos.
   */
  async enrichVideo(title, description) {
    return await groqClient.generateVideoMetadata(title, description);
  }

  /**
   * Run automated channel synchronization.
   */
  async syncChannelFeed() {
    console.log('[AI Brain] Executing periodic YouTube Channel metadata sync...');
    try {
      const result = await syncChannel();
      return result;
    } catch (err) {
      console.error('[AI Brain] YouTube channel feed sync failed:', err.message);
      throw err;
    }
  }
}

module.exports = new AIBrain();
