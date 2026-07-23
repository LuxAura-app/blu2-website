const { getRedisClient } = require('./redis');

const CLAIM_TTL_SECONDS = 3600; // Stripe retries for up to ~3 days; this just bounds a stuck "in_progress" claim.

function claimKey(stripeEventId) {
  return `processed:${stripeEventId}`;
}

/**
 * Atomically claims a Stripe event for processing via SET NX EX.
 * Throws on any Redis error — callers MUST treat a thrown error as "fail
 * closed" (return a non-2xx status so Stripe retries later) rather than
 * proceeding, since a duplicate physical order is worse than a delayed one.
 *
 * @param {string} stripeEventId
 * @param {import('@upstash/redis').Redis} [client] injectable for tests
 * @returns {Promise<{claimed: boolean}>} claimed=false means another
 *   attempt already owns this event — the caller should no-op with 200.
 */
async function claimEvent(stripeEventId, client = getRedisClient()) {
  const result = await client.set(claimKey(stripeEventId), 'in_progress', {
    nx: true,
    ex: CLAIM_TTL_SECONDS,
  });
  return { claimed: result === 'OK' };
}

/**
 * Marks a claimed event completed after a successful provider submission.
 * NEVER throws — the real-world order has already gone out by the time
 * this runs, so a Redis failure here must not cause a Stripe retry (which
 * could double-submit if the "in_progress" claim has since expired).
 * Returns false on failure so the caller can decide to send a human alert.
 *
 * @param {string} stripeEventId
 * @param {import('@upstash/redis').Redis} [client] injectable for tests
 * @returns {Promise<boolean>}
 */
async function completeEvent(stripeEventId, client = getRedisClient()) {
  try {
    await client.set(claimKey(stripeEventId), 'completed', { ex: CLAIM_TTL_SECONDS });
    return true;
  } catch (err) {
    console.error(
      `[idempotency] Failed to mark ${claimKey(stripeEventId)} completed after a successful ` +
        'order submission. The order already went out — this needs a manual Redis check.',
      err
    );
    return false;
  }
}

module.exports = { claimEvent, completeEvent, CLAIM_TTL_SECONDS, claimKey };
