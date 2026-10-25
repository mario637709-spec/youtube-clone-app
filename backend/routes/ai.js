const express = require('express');
const router = express.Router();
const aiBrain = require('../aiBrain');
const { protect, optionalProtect } = require('../middleware/auth');

/**
 * @route POST /api/ai/ask
 * @desc Let the server AI Brain think and respond to general prompts
 * @access Public (or optionalProtect to know which user is asking)
 */
router.post('/ask', optionalProtect, async (req, res) => {
  try {
    const { prompt, systemPrompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: 'Prompt field is required' });
    }

    console.log(`[AI API] Prompt received from ${req.user ? req.user.username : 'anonymous user'}`);
    
    // Call the AI Brain
    const response = await aiBrain.think(prompt, systemPrompt);
    
    res.json({
      success: true,
      answer: response,
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
    });

  } catch (error) {
    console.error('[AI API] Error in /ask:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route POST /api/ai/sync
 * @desc Force trigger the YouTube Sync agent via AI Brain
 * @access Protected (Uploader/Admin only, but here protect is fine)
 */
router.post('/sync', protect, async (req, res) => {
  try {
    console.log(`[AI API] Force sync triggered by ${req.user.username}`);
    
    // Trigger the central AI Brain sync method
    const syncResult = await aiBrain.syncChannelFeed();
    
    res.json({
      success: true,
      message: 'YouTube sync completed successfully',
      details: syncResult
    });
  } catch (error) {
    console.error('[AI API] Error in /sync:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
