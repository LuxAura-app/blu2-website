const { Redis } = require('@upstash/redis');

// Vercel's own "Vercel KV" product was discontinued (migrated to Upstash in
// Dec 2024); a Redis integration installed from the Vercel Marketplace
// injects its own env var names, which vary by provider/integration
// version. These are the names seen in practice — confirm the real ones in
// the Vercel project's Environment Variables settings after installing and
// adjust this list if neither pair matches. See docs/shop-architecture.md.
const URL_ENV_CANDIDATES = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'REDIS_REST_URL'];
const TOKEN_ENV_CANDIDATES = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_TOKEN'];

function firstDefined(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

let client = null;

function getRedisClient() {
  if (client) return client;

  const url = firstDefined(URL_ENV_CANDIDATES);
  const token = firstDefined(TOKEN_ENV_CANDIDATES);

  if (!url || !token) {
    throw new Error(
      `Redis is not configured: checked [${URL_ENV_CANDIDATES.join(', ')}] for a REST URL and ` +
        `[${TOKEN_ENV_CANDIDATES.join(', ')}] for a REST token, found neither a complete pair. ` +
        'Install a Redis integration from the Vercel Marketplace on this project, then confirm ' +
        'the actual injected env var names and update lib/redis.js if needed.'
    );
  }

  client = new Redis({ url, token });
  return client;
}

/** Test-only: forces the next getRedisClient() call to rebuild the client. */
function resetRedisClientForTests() {
  client = null;
}

module.exports = { getRedisClient, resetRedisClientForTests };
