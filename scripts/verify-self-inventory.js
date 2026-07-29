#!/usr/bin/env node
// One-off LOCAL VERIFICATION script — NOT part of the permanent test
// suite (`node --test`). tests/inventory.test.js already covers
// decrementInventory's logic against a fully mocked Redis client; this
// script instead exercises the exact same call api/stripe-webhook.js's
// submitProviderGroup makes for a `self` provider group
// (`decrementInventory(item.sku, item.quantity)`, once per line item)
// against your REAL configured Redis + Resend, so you can watch a
// genuine oversold alert email actually land in ORDER_NOTIFICATION_EMAIL's
// inbox rather than just asserting a mock was called.
//
// Named verify- rather than test- deliberately: node --test's default
// file discovery matches **/test-*.js, so a literal test-self-inventory.js
// gets auto-executed by `node --test` as if it were a real test — which
// would run this against live Redis/Resend as a side effect of the normal
// suite (confirmed empirically while building this). Keep this prefix if
// you ever rename it.
//
// Needs real Redis credentials (see lib/redis.js) and RESEND_API_KEY /
// ORDER_NOTIFICATION_EMAIL set in the environment you run this in — see
// docs/shop-testing.md. Safe to run against production Redis: everything
// it writes lives under one clearly-marked test product ID / SKU, and
// both are deleted in a `finally` block (so cleanup runs even if a
// decrement call throws), not just on the happy path.
//
// Usage:
//   node scripts/verify-self-inventory.js

const { getRedisClient } = require('../lib/redis');
const { upsertProduct, productKey, PRODUCTS_INDEX_KEY } = require('../lib/product-catalog');
const { setInventory, getInventory, decrementInventory, inventoryKey } = require('../lib/inventory');

const TEST_PRODUCT_ID = 'test-self-product';
const TEST_SKU = 'TEST-SELF-SKU';
const STARTING_STOCK = 2;

async function cleanup(client) {
  await client.del(productKey(TEST_PRODUCT_ID));
  await client.srem(PRODUCTS_INDEX_KEY, TEST_PRODUCT_ID);
  await client.del(inventoryKey(TEST_SKU));
  console.log(`[verify-self-inventory] cleaned up "${TEST_PRODUCT_ID}" / "${TEST_SKU}"`);
}

async function main() {
  const client = getRedisClient();

  console.log(
    `[verify-self-inventory] creating temporary catalog entry "${TEST_PRODUCT_ID}" ` +
      `(sku "${TEST_SKU}", starting stock ${STARTING_STOCK})`
  );
  await upsertProduct(
    TEST_PRODUCT_ID,
    {
      name: 'Test Self-Fulfilled Product (safe to ignore — deleted automatically)',
      description: 'Throwaway fixture created by scripts/verify-self-inventory.js',
      provider: 'self',
      source: 'verify-self-inventory-script',
      active: true,
      variants: [{ sku: TEST_SKU, size: null, color: null }],
    },
    client
  );
  await setInventory(TEST_SKU, STARTING_STOCK, client);

  try {
    // Mirrors 3 separate self-item purchases of qty 1 each — the same
    // shape as 3 calls to decrementInventory(item.sku, item.quantity) in
    // api/stripe-webhook.js. First two succeed (2 -> 1 -> 0); the third
    // pushes stock negative, exercising the oversold/alert path.
    for (let i = 1; i <= 3; i++) {
      const before = await getInventory(TEST_SKU, client);
      const result = await decrementInventory(TEST_SKU, 1, client);
      const outcome = result.oversold
        ? 'OVERSOLD — alert email sent to ORDER_NOTIFICATION_EMAIL, order still "shipped" (not blocked)'
        : 'ok';
      console.log(`[verify-self-inventory] purchase #${i}: ${before} -> ${result.newCount} (${outcome})`);
    }
  } finally {
    await cleanup(client);
  }

  console.log('[verify-self-inventory] done — check ORDER_NOTIFICATION_EMAIL for the oversold alert from purchase #3.');
}

main().catch((err) => {
  console.error('[verify-self-inventory] failed', err);
  process.exitCode = 1;
});
