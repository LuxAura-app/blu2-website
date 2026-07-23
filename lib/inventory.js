const { getRedisClient } = require('./redis');
const alert = require('./alert');

function inventoryKey(sku) {
  return `inventory:${sku}`;
}

/**
 * Decrements stock for a `self`-fulfilled SKU after a paid order. This is
 * intentionally simple counter tracking, not a reservation/holds system —
 * see docs/shop-architecture.md for that known v1 limitation.
 *
 * Never blocks the order: the customer already paid, so a decrement that
 * would go negative still succeeds and instead fires an oversold alert to
 * ORDER_NOTIFICATION_EMAIL so a human can restock or contact the customer.
 *
 * Call only after the idempotency claim for this event has succeeded, so a
 * webhook retry can't double-decrement.
 *
 * @param {string} sku
 * @param {number} quantity positive integer to decrement by
 * @param {import('@upstash/redis').Redis} [client] injectable for tests
 * @returns {Promise<{sku: string, newCount: number, oversold: boolean}>}
 */
async function decrementInventory(sku, quantity, client = getRedisClient()) {
  const newCount = await client.decrby(inventoryKey(sku), quantity);
  const oversold = newCount < 0;

  if (oversold) {
    await alert.sendAlert(
      `Oversold: ${sku}`,
      `SKU ${sku} went to ${newCount} in stock after decrementing by ${quantity}. ` +
        'The order still shipped — restock or reach out to the customer about a delay.'
    );
  }

  return { sku, newCount, oversold };
}

/**
 * Sets (replaces) the stock count for a SKU — used by the manual
 * replenishment path, not exposed on a public route.
 * @param {string} sku
 * @param {number} count
 * @param {import('@upstash/redis').Redis} [client]
 */
async function setInventory(sku, count, client = getRedisClient()) {
  await client.set(inventoryKey(sku), count);
}

async function getInventory(sku, client = getRedisClient()) {
  const value = await client.get(inventoryKey(sku));
  return value == null ? null : Number(value);
}

module.exports = { decrementInventory, setInventory, getInventory, inventoryKey };
