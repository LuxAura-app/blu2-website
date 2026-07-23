const { getRedisClient } = require('./redis');

function orderKey(stripeSessionId) {
  return `order:${stripeSessionId}`;
}

function parseRecord(raw) {
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * Writes the initial order record and indexes it for reporting.
 * @param {Object} record
 * @param {string} record.stripeSessionId
 * @param {string} record.name
 * @param {string} record.email
 * @param {string} [record.phone]
 * @param {boolean} record.marketingConsent
 * @param {Array<{name: string, qty: number, unitPriceCents: number, provider: string}>} record.items
 * @param {number} record.totalCents
 * @param {string} record.currency
 * @param {Object<string, string>} [record.providerOrderIds] keyed by provider name
 * @param {number} [record.timestamp] ms epoch; defaults to now
 * @param {import('@upstash/redis').Redis} [client] injectable for tests
 */
async function writeOrderRecord(record, client = getRedisClient()) {
  const timestamp = record.timestamp || Date.now();
  const payload = { ...record, providerOrderIds: record.providerOrderIds || {}, timestamp };

  await client.set(orderKey(record.stripeSessionId), JSON.stringify(payload));
  await client.zadd('orders:index', { score: timestamp, member: record.stripeSessionId });
  if (record.marketingConsent) {
    await client.zadd('contacts:index', { score: timestamp, member: record.stripeSessionId });
  }
  return payload;
}

/**
 * Merges a partial update (e.g. a provider order ID, a tracking update)
 * into an existing order record. No-ops (returns null) if the record
 * doesn't exist, since a webhook may race ahead of the initial write.
 * @param {string} stripeSessionId
 * @param {Object} patch
 * @param {import('@upstash/redis').Redis} [client]
 */
async function updateOrderRecord(stripeSessionId, patch, client = getRedisClient()) {
  const existing = parseRecord(await client.get(orderKey(stripeSessionId)));
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await client.set(orderKey(stripeSessionId), JSON.stringify(updated));
  return updated;
}

async function getOrderRecord(stripeSessionId, client = getRedisClient()) {
  return parseRecord(await client.get(orderKey(stripeSessionId)));
}

/**
 * Scans the orders index for a record whose stored provider order ID
 * matches. There's no secondary index for this (kept simple per spec §5),
 * so it's O(orders-in-range) — fine at storefront volumes, not at scale.
 * @param {string} provider
 * @param {string} providerOrderId
 * @param {import('@upstash/redis').Redis} [client]
 */
async function findOrderByProviderOrderId(provider, providerOrderId, client = getRedisClient()) {
  const sessionIds = await client.zrange('orders:index', 0, -1);
  for (const sessionId of sessionIds) {
    const record = await getOrderRecord(sessionId, client);
    if (record && record.providerOrderIds && record.providerOrderIds[provider] === providerOrderId) {
      return record;
    }
  }
  return null;
}

async function listOrdersInRange(fromTimestamp, toTimestamp, client = getRedisClient()) {
  const sessionIds = await client.zrange('orders:index', fromTimestamp, toTimestamp, { byScore: true });
  const records = await Promise.all(sessionIds.map((id) => getOrderRecord(id, client)));
  return records.filter(Boolean);
}

async function listConsentedContactsInRange(fromTimestamp, toTimestamp, client = getRedisClient()) {
  const sessionIds = await client.zrange('contacts:index', fromTimestamp, toTimestamp, { byScore: true });
  const records = await Promise.all(sessionIds.map((id) => getOrderRecord(id, client)));
  return records.filter(Boolean);
}

module.exports = {
  writeOrderRecord,
  updateOrderRecord,
  getOrderRecord,
  findOrderByProviderOrderId,
  listOrdersInRange,
  listConsentedContactsInRange,
  orderKey,
};
