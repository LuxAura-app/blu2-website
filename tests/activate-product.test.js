const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activateProduct, parseArgs } = require('../scripts/activate-product');

function fakeStripe() {
  const calls = { products: [], prices: [], productUpdates: [] };
  return {
    calls,
    products: {
      create: async (args) => {
        calls.products.push(args);
        return { id: `prod_${calls.products.length}` };
      },
      update: async (id, args) => {
        calls.productUpdates.push({ id, args });
        return { id };
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

function fakeGetProduct(record) {
  return async () => record;
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

test('parseArgs reads the id, --activate, and --price=<dollars>', () => {
  const args = parseArgs(['apliiq-5989067', '--activate', '--price=45.00']);
  assert.deepEqual(args, { id: 'apliiq-5989067', activate: true, price: '45.00' });
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.throws(() => parseArgs(['apliiq-5989067', '--nonsense']), /Unrecognized flag/);
});

test('first-time activation requires --price and creates one Stripe Product+Price per variant, all at the flat price', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = {
    name: 'Better Left Unsaid 2 Tee',
    currency: 'USD',
    provider: 'apliiq',
    active: false,
    variants: [
      { sku: 'APQ-1S1', size: 's', color: 'black', suggestedCostPrice: 45.0 },
      { sku: 'APQ-1S2', size: 'm', color: 'black', suggestedCostPrice: 45.0 },
      { sku: 'APQ-1S3', size: 'xxl', color: 'black', suggestedCostPrice: 47.5 },
    ],
  };
  const getProduct = fakeGetProduct(record);

  const result = await activateProduct('apliiq-1', '45.00', { stripe, getProduct, upsert });

  assert.equal(result.createdCount, 3);
  assert.equal(result.totalVariants, 3);
  assert.equal(stripe.calls.products.length, 3);
  assert.equal(stripe.calls.prices.length, 3);
  // Flat price applies to every variant, ignoring the xxl variant's higher
  // suggestedCostPrice — no per-variant pricing.
  assert.ok(stripe.calls.prices.every((p) => p.unit_amount === 4500));
  assert.ok(stripe.calls.prices.every((p) => p.currency === 'usd'));
  // Each new Price is set as its Product's default price.
  assert.equal(stripe.calls.productUpdates.length, 3);
  assert.equal(stripe.calls.productUpdates[0].args.default_price, 'price_1');

  assert.equal(upsert.calls.length, 1);
  const patch = upsert.calls[0].patch;
  assert.equal(patch.active, true);
  assert.equal(patch.variants.length, 3);
  assert.ok(patch.variants.every((v) => v.priceCents === 4500));
  assert.ok(patch.variants.every((v) => v.stripeProductId && v.stripePriceId));
});

test('activation without --price throws when any variant is still missing Stripe objects', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = {
    name: 'Test Product',
    variants: [{ sku: 'APQ-1S1', size: 's' }],
  };
  const getProduct = fakeGetProduct(record);

  await assert.rejects(
    () => activateProduct('apliiq-1', null, { stripe, getProduct, upsert }),
    /pass --price=<dollars>/
  );
  assert.equal(stripe.calls.products.length, 0);
  assert.equal(upsert.calls.length, 0);
});

test('re-running --activate after every variant already has Stripe objects creates nothing and needs no --price', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = {
    name: 'Test Product',
    active: true,
    variants: [
      { sku: 'APQ-1S1', size: 's', stripeProductId: 'prod_existing', stripePriceId: 'price_existing', priceCents: 4500 },
    ],
  };
  const getProduct = fakeGetProduct(record);

  const result = await activateProduct('apliiq-1', null, { stripe, getProduct, upsert });

  assert.equal(result.createdCount, 0);
  assert.equal(stripe.calls.products.length, 0);
  assert.equal(stripe.calls.prices.length, 0);
  const patch = upsert.calls[0].patch;
  assert.equal(patch.active, true);
  assert.equal(patch.variants[0].stripeProductId, 'prod_existing');
});

test('a re-activation only creates Stripe objects for a newly-appended variant, leaving existing ones untouched', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = {
    name: 'Test Product',
    currency: 'usd',
    active: true,
    variants: [
      { sku: 'APQ-1S1', size: 's', stripeProductId: 'prod_existing', stripePriceId: 'price_existing', priceCents: 4500 },
      { sku: 'APQ-1S2', size: 'm', suggestedCostPrice: 45.0 }, // appended later by a re-sent Add to Store
    ],
  };
  const getProduct = fakeGetProduct(record);

  const result = await activateProduct('apliiq-1', '45.00', { stripe, getProduct, upsert });

  assert.equal(result.createdCount, 1);
  assert.equal(stripe.calls.products.length, 1);
  assert.equal(stripe.calls.products[0].metadata.provider_variant_id, 'APQ-1S2');

  const patch = upsert.calls[0].patch;
  assert.equal(patch.variants[0].stripeProductId, 'prod_existing'); // untouched
  assert.equal(patch.variants[1].stripeProductId, 'prod_1'); // newly created
});

test('throws for an unknown internalProductId instead of creating anything', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const getProduct = fakeGetProduct(null);

  await assert.rejects(() => activateProduct('apliiq-missing', '45.00', { stripe, getProduct, upsert }), /No catalog entry/);
  assert.equal(stripe.calls.products.length, 0);
});

test('sets metadata.inventory_key only when a variant declares one, leaving ordinary variants unaffected', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = {
    name: 'BLU2 — Presale Tee',
    internalProductId: 'self-blu2-presale-tee',
    provider: 'self',
    variants: [
      { sku: 'RT-BLU2-PRESALE-L', size: 'l', inventoryKey: 'RT-BLU2-PRESALE' },
      { sku: 'RT-BLU2-PRESALE-XXL', size: 'xxl', inventoryKey: 'RT-BLU2-PRESALE' },
    ],
  };
  const getProduct = fakeGetProduct(record);

  await activateProduct('self-blu2-presale-tee', '40.00', { stripe, getProduct, upsert });

  assert.equal(stripe.calls.products.length, 2);
  // Two different SKUs/sizes, but both point at the same shared pool key.
  assert.equal(stripe.calls.products[0].metadata.inventory_key, 'RT-BLU2-PRESALE');
  assert.equal(stripe.calls.products[1].metadata.inventory_key, 'RT-BLU2-PRESALE');
  assert.equal(stripe.calls.products[0].metadata.provider_variant_id, 'RT-BLU2-PRESALE-L');
  assert.equal(stripe.calls.products[1].metadata.provider_variant_id, 'RT-BLU2-PRESALE-XXL');
  assert.equal(stripe.calls.products[0].metadata.internal_product_id, 'self-blu2-presale-tee');
  assert.equal(stripe.calls.products[0].metadata.size, 'l');
  assert.equal(stripe.calls.products[1].metadata.size, 'xxl');
});

test('an ordinary variant with no inventoryKey gets no metadata.inventory_key at all', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = {
    name: 'Test Product',
    internalProductId: 'apliiq-1',
    variants: [{ sku: 'APQ-1S1', size: 's' }],
  };
  const getProduct = fakeGetProduct(record);

  await activateProduct('apliiq-1', '45.00', { stripe, getProduct, upsert });

  assert.equal('inventory_key' in stripe.calls.products[0].metadata, false);
});

test('rejects a non-numeric --price', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const record = { name: 'Test Product', variants: [{ sku: 'APQ-1S1', size: 's' }] };
  const getProduct = fakeGetProduct(record);

  await assert.rejects(
    () => activateProduct('apliiq-1', 'not-a-number', { stripe, getProduct, upsert }),
    /--price must be a positive number/
  );
});
