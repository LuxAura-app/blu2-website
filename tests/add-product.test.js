const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleAddProduct } = require('../api/apliiq/add-product');

/**
 * Real production shape, captured from Vercel logs on a live Add to Store
 * attempt — NOT the shape described in Apliiq's published docs, which
 * doesn't nest under `product` or include `ApliiqProductIds` at all. This
 * is the confirmed real contract; docs/apliiq-webhooks.md has been updated
 * to match. (The exact variant/image values below weren't part of what was
 * pasted back — only the top-level shape was — so those are representative
 * rather than byte-for-byte captured; the structural shape is what this
 * test is verifying.)
 */
const REAL_PAYLOAD = {
  ApliiqProductIds: [5989067],
  product: {
    name: 'Better Left Unsaid 2 Tee',
    description: 'Heavyweight tee, full front print.',
    imageUrls: ['https://example.com/tee-black.jpg'],
    sizes: ['S', 'M'],
    colors: ['Black'],
    variants: [
      { sku: 'APQ-5989067S1A1', price: 24.5, color: 'Black', size: 'S', weight: 0.4 },
      { sku: 'APQ-5989067S2A1', price: 24.5, color: 'Black', size: 'M', weight: 0.4 },
    ],
  },
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

test('maps the real captured Add to Store payload to one Stripe Product/Price per variant, always active:false', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();

  const result = await handleAddProduct(REAL_PAYLOAD, { stripe, upsert });

  assert.equal(result.hasError, false);
  assert.deepEqual(result.errorMessages, []);
  // ApliiqProductIds[0] is the primary dedup key now, not the SKU prefix.
  assert.equal(result.storeProductId, 'apliiq-5989067');

  assert.equal(stripe.calls.products.length, 2);
  assert.equal(stripe.calls.products[0].metadata.fulfillment_provider, 'apliiq');
  assert.equal(stripe.calls.products[0].metadata.provider_variant_id, 'APQ-5989067S1A1');

  assert.equal(stripe.calls.prices.length, 2);
  assert.equal(stripe.calls.prices[0].unit_amount, 2450);
  assert.equal(stripe.calls.prices[0].currency, 'usd');

  assert.equal(upsert.calls.length, 1);
  assert.equal(upsert.calls[0].id, 'apliiq-5989067');
  assert.equal(upsert.calls[0].patch.apliiqProductId, '5989067');
  assert.equal(upsert.calls[0].patch.active, false);
  assert.equal(upsert.calls[0].patch.source, 'apliiq-add-to-store');
  assert.equal(upsert.calls[0].patch.name, 'Better Left Unsaid 2 Tee');
  assert.equal(upsert.calls[0].patch.variants.length, 2);
  assert.equal(upsert.calls[0].patch.variants[0].stripePriceId, 'price_1');
});

test('falls back to the SKU-prefix derivation when ApliiqProductIds is absent', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  // Deliberately a different numeric prefix than REAL_PAYLOAD's
  // ApliiqProductIds (5989067), so a passing test proves the fallback
  // path actually ran rather than coincidentally matching.
  const payload = {
    product: {
      ...REAL_PAYLOAD.product,
      variants: [{ sku: 'APQ-4633445S1A1', price: 24.5, color: 'Black', size: 'S', weight: 0.4 }],
    },
  };

  const result = await handleAddProduct(payload, { stripe, upsert });

  assert.equal(result.hasError, false);
  assert.equal(result.storeProductId, 'apliiq-4633445');
  assert.equal(upsert.calls[0].patch.apliiqProductId, null);
});

test('a payload missing the "product" object returns hasError:true instead of throwing', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();

  const result = await handleAddProduct({ ApliiqProductIds: [123] }, { stripe, upsert });

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /product/);
  assert.equal(result.storeProductId, null);
  assert.equal(stripe.calls.products.length, 0);
  assert.equal(upsert.calls.length, 0);
});

test('a payload with missing required fields returns hasError:true instead of throwing', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();

  const result = await handleAddProduct(
    { ApliiqProductIds: [123], product: { name: '', variants: [] } },
    { stripe, upsert }
  );

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
    { ApliiqProductIds: [123], product: { name: 'Test Product', variants: [{ price: 10 }] } },
    { stripe, upsert }
  );

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /sku/);
});
