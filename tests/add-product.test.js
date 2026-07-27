const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleAddProduct } = require('../api/apliiq/add-product');

/**
 * Byte-exact real production payload, captured from Vercel logs on a live
 * Add to Store attempt (2026-07-27, deployment dpl_GNRhsPoVVnFjYznBaSiJFBtxESLj)
 * — NOT the shape described in Apliiq's published docs, which doesn't nest
 * under `product` or include `ApliiqProductIds` at all. This is the
 * confirmed real contract; docs/apliiq-webhooks.md has been updated to match.
 */
const REAL_PAYLOAD = {
  ApliiqProductIds: [5989067],
  product: {
    type: 'tshirts',
    name: 'Better Left Unsaid 2 Tee Mali V',
    currency: 'USD',
    description: '',
    imageUrls: [
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
      'https://blob.apliiq.com/sitestorage/resized-products/5989067_7120_590_900.jpg',
    ],
    replaceProduct: false,
    sizes: ['s', 'm', 'l', 'xl', 'xxl', 'xxxl', '4xl', '5xl'],
    colors: ['black'],
    variants: [
      {
        sku: 'APQ-5989067S6A1',
        price: 45.0,
        color: 'black',
        size: 's',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 7.0,
        weightUnit: 'oz',
        default: true,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S7A1',
        price: 45.0,
        color: 'black',
        size: 'm',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 7.9,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S8A1',
        price: 45.0,
        color: 'black',
        size: 'l',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 7.9,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S1A1',
        price: 45.0,
        color: 'black',
        size: 'xl',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 7.9,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S2A1',
        price: 47.5,
        color: 'black',
        size: 'xxl',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 11.0,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S21A1',
        price: 49.5,
        color: 'black',
        size: 'xxxl',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 11.9,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S61A1',
        price: 51.5,
        color: 'black',
        size: '4xl',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 15.9,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
      {
        sku: 'APQ-5989067S62A1',
        price: 53.5,
        color: 'black',
        size: '5xl',
        imageUrl: 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg',
        weight: 15.9,
        weightUnit: 'oz',
        default: false,
        width: 7.0,
        height: 1.0,
        length: 10.0,
        dimensionUnit: 'in',
      },
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

  // The real payload has 8 variants (s/m/l/xl/xxl/xxxl/4xl/5xl); only the
  // first 5 (s through xxl) are within ALLOWED_SIZES.
  assert.equal(stripe.calls.products.length, 5);
  assert.equal(stripe.calls.products[0].metadata.fulfillment_provider, 'apliiq');
  assert.equal(stripe.calls.products[0].metadata.provider_variant_id, 'APQ-5989067S6A1');

  assert.equal(stripe.calls.prices.length, 5);
  assert.equal(stripe.calls.prices[0].unit_amount, 4500);
  // Product-level currency is uppercase ("USD") in real payloads — Stripe
  // requires lowercase.
  assert.equal(stripe.calls.prices[0].currency, 'usd');
  // Last allowed size (xxl) — 47.50.
  assert.equal(stripe.calls.prices[4].unit_amount, 4750);

  assert.equal(upsert.calls.length, 1);
  const patch = upsert.calls[0].patch;
  assert.equal(upsert.calls[0].id, 'apliiq-5989067');
  assert.equal(patch.apliiqProductId, '5989067');
  assert.equal(patch.active, false);
  assert.equal(patch.source, 'apliiq-add-to-store');
  assert.equal(patch.name, 'Better Left Unsaid 2 Tee Mali V');
  assert.equal(patch.type, 'tshirts');
  assert.equal(patch.variants.length, 5);
  assert.deepEqual(
    patch.variants.map((v) => v.size),
    ['s', 'm', 'l', 'xl', 'xxl']
  );
  assert.ok(!patch.variants.some((v) => ['xxxl', '4xl', '5xl'].includes(v.size)));
  assert.equal(patch.variants[0].stripePriceId, 'price_1');
  // Per-variant imageUrl and weightUnit are captured on the stored variant
  // record (used preferentially over the product-level imageUrls list).
  assert.equal(patch.variants[0].imageUrl, 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg');
  assert.equal(patch.variants[0].weightUnit, 'oz');
  assert.equal(patch.variants[0].weight, 7.0);
});

test('oversized variants (xxxl/4xl/5xl) never reach Stripe, even individually', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const payload = {
    ApliiqProductIds: [5989067],
    product: {
      ...REAL_PAYLOAD.product,
      variants: REAL_PAYLOAD.product.variants.filter((v) => ['xxxl', '4xl', '5xl'].includes(v.size)),
    },
  };

  const result = await handleAddProduct(payload, { stripe, upsert });

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /No variants within the allowed size range/);
  assert.equal(stripe.calls.products.length, 0);
  assert.equal(upsert.calls.length, 0);
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
      variants: [{ sku: 'APQ-4633445S1A1', price: 24.5, color: 'black', size: 's', weight: 7.0 }],
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
