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

function fakeUpsert() {
  const calls = [];
  const fn = async (id, patch) => {
    calls.push({ id, patch });
    return { ...patch, internalProductId: id };
  };
  fn.calls = calls;
  return fn;
}

function fakeGetProduct(record) {
  const calls = [];
  const fn = async (id) => {
    calls.push(id);
    return record;
  };
  fn.calls = calls;
  return fn;
}

test('maps the real captured Add to Store payload straight into the catalog, no Stripe involved, always drafted', async () => {
  const upsert = fakeUpsert();
  const getProduct = fakeGetProduct(null);

  const result = await handleAddProduct(REAL_PAYLOAD, { upsert, getProduct });

  assert.equal(result.hasError, false);
  assert.deepEqual(result.errorMessages, []);
  // ApliiqProductIds[0] is the primary dedup key now, not the SKU prefix.
  assert.equal(result.storeProductId, 'apliiq-5989067');

  assert.equal(upsert.calls.length, 1);
  const patch = upsert.calls[0].patch;
  assert.equal(upsert.calls[0].id, 'apliiq-5989067');
  assert.equal(patch.apliiqProductId, '5989067');
  // active is omitted from the patch entirely (upsertProduct defaults new
  // entries to false) — never hardcoded, see api/apliiq/add-product.js.
  assert.equal('active' in patch, false);
  assert.equal(patch.source, 'apliiq-add-to-store');
  assert.equal(patch.name, 'Better Left Unsaid 2 Tee Mali V');
  assert.equal(patch.type, 'tshirts');

  // The real payload has 8 variants (s/m/l/xl/xxl/xxxl/4xl/5xl); only the
  // first 5 (s through xxl) are within ALLOWED_SIZES.
  assert.equal(patch.variants.length, 5);
  assert.deepEqual(
    patch.variants.map((v) => v.size),
    ['s', 'm', 'l', 'xl', 'xxl']
  );
  assert.ok(!patch.variants.some((v) => ['xxxl', '4xl', '5xl'].includes(v.size)));

  // No Stripe objects exist yet — activation (scripts/activate-product.js)
  // is solely responsible for creating those.
  assert.ok(!('stripeProductId' in patch.variants[0]));
  assert.ok(!('stripePriceId' in patch.variants[0]));

  // Apliiq's submitted price is stored as reference-only cost pricing.
  assert.equal(patch.variants[0].suggestedCostPrice, 45.0);
  assert.equal(patch.variants[4].suggestedCostPrice, 47.5);

  // Per-variant imageUrl and weightUnit are captured on the stored variant
  // record (used preferentially over the product-level imageUrls list).
  assert.equal(patch.variants[0].imageUrl, 'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg');
  assert.equal(patch.variants[0].weightUnit, 'oz');
  assert.equal(patch.variants[0].weight, 7.0);
});

test('oversized variants (xxxl/4xl/5xl) never reach the catalog, even individually', async () => {
  const upsert = fakeUpsert();
  const payload = {
    ApliiqProductIds: [5989067],
    product: {
      ...REAL_PAYLOAD.product,
      variants: REAL_PAYLOAD.product.variants.filter((v) => ['xxxl', '4xl', '5xl'].includes(v.size)),
    },
  };

  const result = await handleAddProduct(payload, { upsert });

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /No variants within the allowed size range/);
  assert.equal(upsert.calls.length, 0);
});

test('falls back to the SKU-prefix derivation when ApliiqProductIds is absent', async () => {
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

  const result = await handleAddProduct(payload, { upsert, getProduct: fakeGetProduct(null) });

  assert.equal(result.hasError, false);
  assert.equal(result.storeProductId, 'apliiq-4633445');
  assert.equal(upsert.calls[0].patch.apliiqProductId, null);
});

test('a payload missing the "product" object returns hasError:true instead of throwing', async () => {
  const upsert = fakeUpsert();

  const result = await handleAddProduct({ ApliiqProductIds: [123] }, { upsert });

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /product/);
  assert.equal(result.storeProductId, null);
  assert.equal(upsert.calls.length, 0);
});

test('a payload with missing required fields returns hasError:true instead of throwing', async () => {
  const upsert = fakeUpsert();

  const result = await handleAddProduct(
    { ApliiqProductIds: [123], product: { name: '', variants: [] } },
    { upsert }
  );

  assert.equal(result.hasError, true);
  assert.ok(result.errorMessages.length > 0);
  assert.equal(result.storeProductId, null);
  assert.equal(upsert.calls.length, 0);
});

test('a variant missing a sku is reported without throwing', async () => {
  const upsert = fakeUpsert();

  const result = await handleAddProduct(
    { ApliiqProductIds: [123], product: { name: 'Test Product', variants: [{ price: 10 }] } },
    { upsert, getProduct: fakeGetProduct(null) }
  );

  assert.equal(result.hasError, true);
  assert.match(result.errorMessages[0], /sku/);
});

test('a repeated Add to Store call for a known SKU updates its fields in place, not a new entry', async () => {
  const upsert = fakeUpsert();
  const existingRecord = {
    variants: [
      { sku: 'APQ-5989067S6A1', color: 'black', size: 's', weight: 6.5, weightUnit: 'oz', imageUrl: 'https://old.example/img.jpg', suggestedCostPrice: 40.0 },
    ],
  };
  const getProduct = fakeGetProduct(existingRecord);

  const payload = {
    ApliiqProductIds: [5989067],
    product: {
      ...REAL_PAYLOAD.product,
      variants: [REAL_PAYLOAD.product.variants[0]], // s, weight 7.0, price 45.00 — refreshed values
    },
  };

  const result = await handleAddProduct(payload, { upsert, getProduct });

  assert.equal(result.hasError, false);
  assert.equal(getProduct.calls[0], 'apliiq-5989067');

  const patch = upsert.calls[0].patch;
  assert.equal(patch.variants.length, 1);
  assert.equal(patch.variants[0].weight, 7.0);
  assert.equal(patch.variants[0].suggestedCostPrice, 45.0);
  assert.equal(
    patch.variants[0].imageUrl,
    'https://blob.apliiq.com/sitestorage/resized-products/5989067_7119_590_900.jpg'
  );
});

test('a re-send for a SKU that has already been activated preserves its Stripe IDs', async () => {
  const upsert = fakeUpsert();
  const existingRecord = {
    active: true,
    variants: [
      {
        sku: 'APQ-5989067S6A1',
        color: 'black',
        size: 's',
        weight: 7.0,
        weightUnit: 'oz',
        suggestedCostPrice: 45.0,
        stripeProductId: 'prod_live_s',
        stripePriceId: 'price_live_s',
      },
    ],
  };
  const getProduct = fakeGetProduct(existingRecord);

  const payload = {
    ApliiqProductIds: [5989067],
    product: {
      ...REAL_PAYLOAD.product,
      variants: [REAL_PAYLOAD.product.variants[0]],
    },
  };

  const result = await handleAddProduct(payload, { upsert, getProduct });

  assert.equal(result.hasError, false);
  const patch = upsert.calls[0].patch;
  assert.equal(patch.variants[0].stripeProductId, 'prod_live_s');
  assert.equal(patch.variants[0].stripePriceId, 'price_live_s');
  // active isn't in the patch at all — upsertProduct() leaves the
  // already-true value alone rather than this handler resetting it.
  assert.equal('active' in patch, false);
});

test('a brand-new SKU on an already-known product is appended alongside the existing one', async () => {
  const upsert = fakeUpsert();
  const existingRecord = {
    variants: [
      { sku: 'APQ-5989067S6A1', color: 'black', size: 's', weight: 7.0, weightUnit: 'oz', suggestedCostPrice: 45.0 },
    ],
  };
  const getProduct = fakeGetProduct(existingRecord);

  const payload = {
    ApliiqProductIds: [5989067],
    product: {
      ...REAL_PAYLOAD.product,
      // s (already known) + m (new to this catalog entry)
      variants: [REAL_PAYLOAD.product.variants[0], REAL_PAYLOAD.product.variants[1]],
    },
  };

  const result = await handleAddProduct(payload, { upsert, getProduct });

  assert.equal(result.hasError, false);
  const patch = upsert.calls[0].patch;
  assert.equal(patch.variants.length, 2);
  assert.deepEqual(patch.variants.map((v) => v.sku), ['APQ-5989067S6A1', 'APQ-5989067S7A1']);
});
