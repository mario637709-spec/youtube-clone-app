const { subscribeChannel } = require('./youtubeWebhookAgent');
const { CHANNELS } = require('../config/indianChannels');
const { resolveChannelId } = require('./channelRegistry');

/**
 * Iterates through all 100 configured Indian channels and renews their
 * WebSub subscriptions (pubsubhubbub.appspot.com).
 */
const runSubscriptionLoop = async () => {
  console.log(`[Subscription Manager] Starting WebSub Hub subscriptions for ${CHANNELS.length} channels...`);

  let subscribed = 0;
  let failed = 0;
  const failedList = [];

  for (const ch of CHANNELS) {
    const channelId = await resolveChannelId(ch.handle);
    if (!channelId) {
      failed++;
      failedList.push(`@${ch.handle} (unresolved)`);
      continue;
    }
    try {
      const success = await subscribeChannel(channelId);
      if (success) {
        subscribed++;
        console.log(`[Subscription Manager] ✅ WebSub submitted for @${ch.handle} [${channelId}] (${ch.category})`);
      } else {
        failed++;
        failedList.push(`@${ch.handle} [${channelId}] (hub rejected)`);
      }
    } catch (err) {
      failed++;
      failedList.push(`@${ch.handle} [${channelId}] (${err.message})`);
    }
    // Subtle delay to prevent rate-limiting at the Hub
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`[Subscription Manager] ✅ ${subscribed}/${CHANNELS.length} subscribed, ${failed} failed.`);
  if (failedList.length > 0) {
    console.warn('[Subscription Manager] Failed channels:', failedList.join(', '));
  }
  return { subscribed, failed, total: CHANNELS.length, failedList };
};

// Execute if run directly from command line
if (require.main === module) {
  runSubscriptionLoop()
    .then((r) => {
      console.log(`[Subscription Manager] Run complete: ${r.subscribed}/${r.total} subscribed.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Subscription Manager] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  CHANNELS,
  runSubscriptionLoop,
};
