const axios = require('axios');

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// Parse list of API keys for rotation
const getApiKeysList = () => {
  const keysStr = process.env.GROQ_API_KEYS;
  if (!keysStr) {
    return [process.env.GROQ_API_KEY || ''];
  }
  return keysStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
};

let activeKeyIndex = 0;

/**
 * Send request to Groq chat completions endpoint with automatic key rotation failover
 */
const callGroq = async (systemMessage, userPrompt, temperature = 0.3, responseFormat = null) => {
  const keysList = getApiKeysList();
  let attempts = 0;

  while (attempts < keysList.length) {
    const currentKey = keysList[activeKeyIndex];
    try {
      const payload = {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userPrompt }
        ],
        temperature: temperature,
      };

      if (responseFormat) {
        payload.response_format = responseFormat;
      }

      console.log(`[Groq Client] Making API call using key index: ${activeKeyIndex}/${keysList.length - 1}`);

      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${currentKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      const status = error.response ? error.response.status : null;
      const isRateLimit = status === 429 || status === 402;
      const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;

      if (isRateLimit) {
        console.warn(`[Groq Client] API Key index ${activeKeyIndex} exhausted (status ${status}). Switching to next key...`);
        activeKeyIndex = (activeKeyIndex + 1) % keysList.length;
        attempts++;
      } else {
        console.error('[Groq Client] Request failed with non-quota error:', errorMessage);
        throw error;
      }
    }
  }

  throw new Error('[Groq Client] All provided API keys in rotation loop are exhausted.');
};

/**
 * Rank candidate videos using the user's watch history and interests
 */
const rankRecommendedVideos = async (watchHistory, candidates) => {
  if (!candidates || candidates.length === 0) return candidates;
  if (!watchHistory || watchHistory.length === 0) {
    console.log('[AI Brain] No watch history for user, serving base candidate ordering.');
    return candidates;
  }

  // Format watch history & candidates for prompt
  const historyText = watchHistory
    .slice(0, 8)
    .map(h => `- Title: "${h.title}", Category: "${h.category}", Tags: [${h.tags ? h.tags.join(', ') : ''}]`)
    .join('\n');

  const candidatesText = candidates
    .map((c, idx) => `[${idx}] Title: "${c.title}", Category: "${c.category}", Tags: [${c.tags ? c.tags.join(', ') : ''}]`)
    .join('\n');

  const systemMessage = `You are the core recommendation algorithm AI brain of a premium video platform like YouTube.
Your job is to analyze the user's recent watch history and rank the candidate videos based on predicted user engagement, relevance, and preferences.
You must respond with a JSON object containing a "ranking" key whose value is an array of candidate indices (integers) in descending order of recommendation relevance.
Optionally, include a short "reason" key with a 1-sentence personalized summary of why these were chosen (e.g. "We think you will love these gaming clips based on your watch history").
Do not explain your reasoning or output any markup other than valid JSON.`;

  const userPrompt = `Recently Watched Videos:
${historyText}

Candidate Videos to Rank:
${candidatesText}

Task: Rank the candidate videos from most relevant to least relevant for this user.
Return the result as a JSON object:
{
  "ranking": [index_0, index_1, ...],
  "reason": "..."
}`;

  try {
    const content = await callGroq(systemMessage, userPrompt, 0.2, { type: "json_object" });
    const result = JSON.parse(content);
    
    if (result && Array.isArray(result.ranking)) {
      const ordered = [];
      const seen = new Set();
      
      for (const idx of result.ranking) {
        const index = parseInt(idx, 10);
        if (!isNaN(index) && candidates[index] && !seen.has(index)) {
          // Attach the custom reason or general tag
          const candidateCopy = { ...candidates[index] };
          candidateCopy.ai_score_boost = true;
          candidateCopy.recommendationReason = result.reason || "Recommended based on your preferences";
          ordered.push(candidateCopy);
          seen.add(index);
        }
      }

      // Append any candidates that weren't ranked by the AI
      candidates.forEach((c, idx) => {
        if (!seen.has(idx)) {
          ordered.push(c);
        }
      });

      console.log(`[AI Brain] Ranked ${candidates.length} candidates using AI. Top pick: "${ordered[0]?.title}"`);
      return ordered;
    }
  } catch (error) {
    console.error('[AI Brain] Failed to rank candidates with AI, using fallback:', error.message);
  }

  return candidates;
};

/**
 * Auto-generate enriched metadata, tags, and category for YouTube imported videos
 */
const generateVideoMetadata = async (title, originalDescription) => {
  const systemMessage = `You are a professional YouTube SEO optimizer.
Analyze the video title and optional description, and return a JSON object with:
- "enrichedDescription": a compelling, formatted, search-optimized description.
- "category": choose the most fitting category (e.g., "Gaming", "Sports", "Tech", "Education", "Music", "Comedy", "Travel", "Entertainment").
- "tags": a JSON array of 5-8 relevant SEO tags.
Response format must be a JSON object only. Do not output markdown code blocks or additional explanation text.`;

  const userPrompt = `Title: "${title}"
Original Description: "${originalDescription || ''}"

Generate the SEO optimized details in JSON format.`;

  try {
    const content = await callGroq(systemMessage, userPrompt, 0.5, { type: "json_object" });
    const metadata = JSON.parse(content);
    return {
      description: metadata.enrichedDescription || originalDescription || '',
      category: metadata.category || 'Entertainment',
      tags: Array.isArray(metadata.tags) ? metadata.tags : ['imported', 'youtube']
    };
  } catch (error) {
    console.error('[AI Brain] Failed to enrich video metadata with AI:', error.message);
    return null;
  }
};

module.exports = {
  rankRecommendedVideos,
  generateVideoMetadata,
  callGroq
};
