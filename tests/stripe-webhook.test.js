const { test } = require('node:test');
const assert = require('node:assert/strict');
// api/stripe-webhook.js constructs `new Stripe(process.env.STRIPE_SECRET_KEY)`
// at module load time, which throws immediately if that env var is unset —
// harmless here since these tests only exercise buildFulfillmentItems (a
// pure function that never calls the Stripe API), but the module can't even
// be required without a truthy value present first.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_for_tests';
const handler = require('../api/stripe-webhook');
const { decrementInventory } = require('../lib/inventory');

function fakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async decrby(key, amount) {
      const next = (store.get(key) || 0) - amount;
      store.set(key, next);
      return next;
    },
  };
}

function stripeLineItem({ priceId, quantity, unitAmount, productMetadata, productName, productId }) {
  return {
    id: `li_${priceId}`,
    quantity,
    price: {
      unit_amount: unitAmount,
      product: { id: productId, name: productName, metadata: productMetadata },
    },
  };
}

test('buildFulfillmentItems defaults inventoryKey to the resolved sku when metadata.inventory_key is absent', () => {
  const items = handler.buildFulfillmentItems({
    data: [
      stripeLineItem({
        priceId: 'price_s',
        quantity: 1,
        unitAmount: 4500,
        productId: 'prod_s',
        productName: 'BLU2 Tee — S',
        productMetadata: { fulfillment_provider: 'apliiq', provider_variant_id: 'APQ-S' },
      }),
    ],
  });

  assert.equal(items[0].sku, 'APQ-S');
  assert.equal(items[0].inventoryKey, 'APQ-S');
});

test('buildFulfillmentItems reads groupId/size/inventoryKey off the presale metadata scripts/activate-product.js writes', () => {
  const items = handler.buildFulfillmentItems({
    data: [
      stripeLineItem({
        priceId: 'price_presale_l',
        quantity: 1,
        unitAmount: 4000,
        productId: 'prod_presale_l',
        productName: 'Better Left Unsaid 2 — Presale Tee — l',
        productMetadata: {
          fulfillment_provider: 'self',
          provider_variant_id: 'RT-BLU2-PRESALE-L',
          internal_product_id: 'self-blu2-presale-tee',
          size: 'l',
          inventory_key: 'RT-BLU2-PRESALE',
        },
      }),
      stripeLineItem({
        priceId: 'price_presale_xxl',
        quantity: 2,
        unitAmount: 4000,
        productId: 'prod_presale_xxl',
        productName: 'Better Left Unsaid 2 — Presale Tee — xxl',
        productMetadata: {
          fulfillment_provider: 'self',
          provider_variant_id: 'RT-BLU2-PRESALE-XXL',
          internal_product_id: 'self-blu2-presale-tee',
          size: 'xxl',
          inventory_key: 'RT-BLU2-PRESALE',
        },
      }),
    ],
  });

  const [lItem, xxlItem] = items;
  assert.equal(lItem.sku, 'RT-BLU2-PRESALE-L');
  assert.equal(lItem.size, 'l');
  assert.equal(xxlItem.sku, 'RT-BLU2-PRESALE-XXL');
  assert.equal(xxlItem.size, 'xxl');

  // Different SKUs, different sizes — but the SAME inventoryKey and groupId.
  assert.equal(lItem.inventoryKey, 'RT-BLU2-PRESALE');
  assert.equal(xxlItem.inventoryKey, 'RT-BLU2-PRESALE');
  assert.equal(lItem.groupId, 'self-blu2-presale-tee');
  assert.equal(xxlItem.groupId, 'self-blu2-presale-tee');
});

test('an order for size L and an order for size XXL decrement the exact same shared counter, not two independent ones', async () => {
  // Mirrors api/stripe-webhook.js's submitProviderGroup loop:
  //   for (const item of items) { await decrementInventory(item.inventoryKey, item.quantity); }
  // — using the real decrementInventory (lib/inventory.js), not a mock, so
  // this is a genuine proof of the shared-counter behavior, not just an
  // assertion that the right arguments were passed.
  const items = handler.buildFulfillmentItems({
    data: [
      stripeLineItem({
        priceId: 'price_presale_l',
        quantity: 1,
        unitAmount: 4000,
        productId: 'prod_presale_l',
        productName: 'Presale Tee — l',
        productMetadata: {
          fulfillment_provider: 'self',
          provider_variant_id: 'RT-BLU2-PRESALE-L',
          size: 'l',
          inventory_key: 'RT-BLU2-PRESALE',
        },
      }),
      stripeLineItem({
        priceId: 'price_presale_xxl',
        quantity: 3,
        unitAmount: 4000,
        productId: 'prod_presale_xxl',
        productName: 'Presale Tee — xxl',
        productMetadata: {
          fulfillment_provider: 'self',
          provider_variant_id: 'RT-BLU2-PRESALE-XXL',
          size: 'xxl',
          inventory_key: 'RT-BLU2-PRESALE',
        },
      }),
    ],
  });

  const redis = fakeRedis({ 'inventory:RT-BLU2-PRESALE': 50 });

  for (const item of items) {
    await decrementInventory(item.inventoryKey, item.quantity, redis);
  }

  // One shared counter, decremented by both orders combined (1 + 3 = 4),
  // not two separate per-size counters that would each still show 49/47.
  assert.equal(redis.store.get('inventory:RT-BLU2-PRESALE'), 46);
  assert.equal(redis.store.has('inventory:RT-BLU2-PRESALE-L'), false);
  assert.equal(redis.store.has('inventory:RT-BLU2-PRESALE-XXL'), false);
});
