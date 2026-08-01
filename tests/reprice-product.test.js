const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repriceProduct, parseArgs } = require('../scripts/reprice-product');

function fakeStripe() {
  const calls = { prices: [], productUpdates: [], priceUpdates: [] };
  return {
    calls,
    products: {
      update: async (id, args) => {
        calls.productUpdates.push({ id, args });
        return { id };
      },
    },
    prices: {
      create: async (args) => {
        calls.prices.push(args);
        return { id: `price_new_${calls.prices.length}` };
      },
      update: async (id, args) => {
        calls.priceUpdates.push({ id, args });
        return { id };
      },
    },
  };
}

function fakeGetProduct(product) {
  return async (id) => (id === product.internalProductId ? product : null);
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

test('parseArgs reads id, --price, and --dry-run', () => {
  assert.deepEqual(parseArgs(['self-blu2-presale-tee', '--price=45.00', '--dry-run']), {
    id: 'self-blu2-presale-tee',
    price: '45.00',
    dryRun: true,
  });
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.throws(() => parseArgs(['--nonsense']), /Unrecognized flag/);
});

test('creates a new Price per variant, repoints default_price, archives the old Price', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'self-blu2-presale-tee',
    currency: 'usd',
    variants: [
      { sku: 'RT-BLU2-PRESALE-S', size: 's', priceCents: 4000, stripeProductId: 'prod_s', stripePriceId: 'price_s_old' },
      { sku: 'RT-BLU2-PRESALE-M', size: 'm', priceCents: 4000, stripeProductId: 'prod_m', stripePriceId: 'price_m_old' },
    ],
  };

  const result = await repriceProduct('self-blu2-presale-tee', '45.00', {
    stripe,
    getProduct: fakeGetProduct(product),
    upsert,
  });

  assert.equal(stripe.calls.prices.length, 2);
  assert.ok(stripe.calls.prices.every((p) => p.unit_amount === 4500));
  assert.equal(stripe.calls.productUpdates.length, 2);
  assert.equal(stripe.calls.productUpdates[0].args.default_price, 'price_new_1');
  assert.equal(stripe.calls.priceUpdates.length, 2);
  assert.equal(stripe.calls.priceUpdates[0].id, 'price_s_old');
  assert.equal(stripe.calls.priceUpdates[0].args.active, false);

  assert.equal(result.mapping[0].oldPriceId, 'price_s_old');
  assert.equal(result.mapping[0].newPriceId, 'price_new_1');
  assert.equal(result.mapping[0].unitAmount, 4500);

  assert.equal(upsert.calls.length, 1);
  const patch = upsert.calls[0].patch;
  assert.equal(patch.variants[0].priceCents, 4500);
  assert.equal(patch.variants[0].stripePriceId, 'price_new_1');
  assert.equal(patch.variants[0].stripeProductId, 'prod_s'); // unchanged — same Stripe Product
});

test('a variant with no prior stripePriceId is not archived, just given a new Price', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'self-blu2-presale-tee',
    currency: 'usd',
    variants: [{ sku: 'RT-BLU2-PRESALE-S', size: 's', priceCents: null, stripeProductId: 'prod_s', stripePriceId: null }],
  };

  await repriceProduct('self-blu2-presale-tee', '45.00', { stripe, getProduct: fakeGetProduct(product), upsert });

  assert.equal(stripe.calls.priceUpdates.length, 0);
});

test('--dry-run creates nothing, archives nothing, writes nothing', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'self-blu2-presale-tee',
    currency: 'usd',
    variants: [{ sku: 'RT-BLU2-PRESALE-S', size: 's', priceCents: 4000, stripeProductId: 'prod_s', stripePriceId: 'price_s_old' }],
  };

  const result = await repriceProduct('self-blu2-presale-tee', '45.00', {
    stripe,
    getProduct: fakeGetProduct(product),
    upsert,
    dryRun: true,
  });

  assert.equal(stripe.calls.prices.length, 0);
  assert.equal(stripe.calls.priceUpdates.length, 0);
  assert.equal(upsert.calls.length, 0);
  assert.equal(result.mapping[0].newPriceId, '(dry-run)');
});

test('throws if a variant has no stripeProductId yet', async () => {
  const stripe = fakeStripe();
  const upsert = fakeUpsert();
  const product = {
    internalProductId: 'self-blu2-presale-tee',
    currency: 'usd',
    variants: [{ sku: 'RT-BLU2-PRESALE-S', size: 's', priceCents: null, stripeProductId: null }],
  };

  await assert.rejects(
    () => repriceProduct('self-blu2-presale-tee', '45.00', { stripe, getProduct: fakeGetProduct(product), upsert }),
    /no stripeProductId yet/
  );
  assert.equal(upsert.calls.length, 0);
});

test('throws for a non-existent catalog entry', async () => {
  await assert.rejects(
    () => repriceProduct('does-not-exist', '45.00', { stripe: fakeStripe(), getProduct: async () => null, upsert: fakeUpsert() }),
    /No catalog entry found/
  );
});

test('throws for a non-positive price', async () => {
  const product = { internalProductId: 'self-blu2-presale-tee', variants: [{ sku: 'x', stripeProductId: 'prod_x' }] };
  await assert.rejects(
    () => repriceProduct('self-blu2-presale-tee', '-5', { stripe: fakeStripe(), getProduct: fakeGetProduct(product), upsert: fakeUpsert() }),
    /--price must be a positive number/
  );
});
