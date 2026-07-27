const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleAddProduct } = require('../api/apliiq/add-product');

// Shape per the fields Apliiq's Add to Store docs describe (name,
// description, imageUrls, sizes, colors, variants[] with sku/price/color/
// size/weight) — the exact real payload isn't independently confirmed
// beyond field names (see docs/apliiq-webhooks.md), so this fixture is
// built from the documented field list, not a captured live example.
const FIXTURE_PAYLOAD = {
  store_ProductId: null,
  name: 'Better Left Unsaid 2 Tee',
  description: 'Heavyweight tee, full front print.',
  imageUrls: ['https://example.com/tee-black.jpg'],
  sizes: ['S', 'M'],
  colors: ['Black'],
  variants: [
    { sku: 'APQ-1998244S1A1', price: 24.5, color: 'Black', size: 'S', weight: 0.4 },
    { sku: 'APQ-1998244S2A1', price: 24.5, color: 'Black', size: 'M', weight: 0.4 },
  ],
};

function fakeStripe() {
  const calls = { products: [], prices: [] };
  return {
    calls,
    products: {
      create: async (args) => {
        calls.products.push(args);
        return { id: `prod_${calls.products.length}` };
      },
    },
    prices: {
      create: async (args) => {
        calls.prices.push(args);
        return { id: `price_${calls.prices.length}` };
      },
    },
  };
}

function fakeUpsert() {
  const calls = [];
  const fn = async (id, patch) => {
    calls.push({ id, patch });
    return { ...patch, internalProductId: id };
  };
  fn.calls = calls;
  return fn;
}

test('maps a fixture Add to Store payload to one Stripe Product/Price per variant, always active:false', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();

  const result = await handleAddProduct(FIXTURE_PAYLOAD, { stripe, upsert });

  assert.equal(result.hasError, false);
  assert.deepEqual(result.errorMessages, []);
  assert.equal(result.storeProductId, 'apliiq-1998244');

  assert.equal(stripe.calls.products.length, 2);
  assert.equal(stripe.calls.products[0].metadata.fulfillment_provider, 'apliiq');
  assert.equal(stripe.calls.products[0].metadata.provider_variant_id, 'APQ-1998244S1A1');

  assert.equal(stripe.calls.prices.length, 2);
  assert.equal(stripe.calls.prices[0].unit_amount, 2450);
  assert.equal(stripe.calls.prices[0].currency, 'usd');

  assert.equal(upsert.calls.length, 1);
  assert.equal(upsert.calls[0].id, 'apliiq-1998244');
  assert.equal(upsert.calls[0].patch.active, false);
  assert.equal(upsert.calls[0].patch.source, 'apliiq-add-to-store');
  assert.equal(upsert.calls[0].patch.variants.length, 2);
  assert.equal(upsert.calls[0].patch.variants[0].stripePriceId, 'price_1');
});

test('a payload missing required fields returns hasError:true instead of throwing', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();

  const result = await handleAddProduct({ name: '', variants: [] }, { stripe, upsert });

  assert.equal(result.hasError, true);
  assert.ok(result.errorMessages.length > 0);
  assert.equal(result.storeProductId, null);
  assert.equal(stripe.calls.products.length, 0);
  assert.equal(upsert.calls.length, 0);
});

test('a variant missing a sku is reported without throwing', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();

  const result = await handleAddProduct(
    { name: 'Test Product', variants: [{ price: 10 }] },
    { stripe, upsert }
  );

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /sku/);
});
