const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relinkProduct, parseArgs } = require('../scripts/relink-stripe-live');

function fakeStripe() {
  const calls = { products: [], prices: [], productUpdates: [] };
  return {
    calls,
    products: {
      create: async (args) => {
        calls.products.push(args);
        return { id: `prod_live_${calls.products.length}` };
      },
      update: async (id, args) => {
        calls.productUpdates.push({ id, args });
        return { id };
      },
    },
    prices: {
      create: async (args) => {
        calls.prices.push(args);
        return { id: `price_live_${calls.prices.length}` };
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

test('parseArgs reads an optional id and --dry-run', () => {
  assert.deepEqual(parseArgs(['apliiq-1', '--dry-run']), { id: 'apliiq-1', dryRun: true });
  assert.deepEqual(parseArgs([]), { id: null, dryRun: false });
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.throws(() => parseArgs(['--nonsense']), /Unrecognized flag/);
});

test('relinks every variant even when a stripeProductId already exists, using stored priceCents', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'apliiq-1',
    name: 'Better Left Unsaid 2 Tee',
    currency: 'usd',
    provider: 'apliiq',
    active: true,
    variants: [
      {
        sku: 'APQ-1S1',
        size: 's',
        color: 'black',
        priceCents: 4500,
        stripeProductId: 'prod_test_old',
        stripePriceId: 'price_test_old',
      },
      {
        sku: 'APQ-1S2',
        size: 'm',
        color: 'black',
        priceCents: 4500,
        stripeProductId: 'prod_test_old2',
        stripePriceId: 'price_test_old2',
      },
    ],
  };

  const result = await relinkProduct(product, { stripe, upsert });

  assert.equal(stripe.calls.products.length, 2);
  assert.equal(stripe.calls.prices.length, 2);
  assert.ok(stripe.calls.prices.every((p) => p.unit_amount === 4500));
  assert.equal(stripe.calls.productUpdates.length, 2);

  assert.equal(result.mapping[0].oldPriceId, 'price_test_old');
  assert.equal(result.mapping[0].newPriceId, 'price_live_1');
  assert.equal(result.mapping[1].oldPriceId, 'price_test_old2');
  assert.equal(result.mapping[1].newPriceId, 'price_live_2');

  assert.equal(upsert.calls.length, 1);
  const patch = upsert.calls[0].patch;
  assert.equal(patch.variants[0].stripeProductId, 'prod_live_1');
  assert.equal(patch.variants[0].stripePriceId, 'price_live_1');
  assert.equal(patch.variants[0].priceCents, 4500); // unchanged
  // active is intentionally omitted from the patch so upsertProduct() preserves whatever it already was.
  assert.equal('active' in patch, false);
});

test('--dry-run creates nothing and writes nothing', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'apliiq-1',
    name: 'Test Product',
    variants: [{ sku: 'APQ-1S1', size: 's', priceCents: 4500, stripePriceId: 'price_test_old' }],
  };

  const result = await relinkProduct(product, { stripe, upsert, dryRun: true });

  assert.equal(stripe.calls.products.length, 0);
  assert.equal(stripe.calls.prices.length, 0);
  assert.equal(upsert.calls.length, 0);
  assert.equal(result.mapping[0].newPriceId, '(dry-run)');
});

test('throws if a variant has no valid stored priceCents to relink at', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'apliiq-1',
    name: 'Test Product',
    variants: [{ sku: 'APQ-1S1', size: 's', priceCents: null }],
  };

  await assert.rejects(() => relinkProduct(product, { stripe, upsert }), /no valid stored priceCents/);
  assert.equal(upsert.calls.length, 0);
});
