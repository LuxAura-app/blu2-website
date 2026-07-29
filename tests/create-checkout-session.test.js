const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleCreateCheckoutSession } = require('../api/create-checkout-session');

function fakeStripe(pricesById) {
  const sessionsCreated = [];
  return {
    sessionsCreated,
    prices: {
      async retrieve(id) {
        const price = pricesById[id];
        if (!price) throw new Error(`No such price: ${id}`);
        return price;
      },
    },
    checkout: {
      sessions: {
        async create(params) {
          sessionsCreated.push(params);
          return { url: 'https://checkout.stripe.com/test_session' };
        },
      },
    },
  };
}

function fakeVariantIndex(entries) {
  return async () => new Map(Object.entries(entries));
}

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
}

const SHIPPING_ENV = {
  SHOP_APLIIQ_FLAT_SHIPPING_CENTS: '500',
  SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS: undefined,
  SHOP_FREE_SHIPPING_THRESHOLD_CENTS: '10000',
};

// A single tee variant weighs 7oz per the real captured Apliiq payload
// (tests/add-product.test.js's REAL_PAYLOAD) — used here as the stand-in
// "real stored weight" rather than inventing a different number.
const VARIANTS = {
  price_s: { sku: 'APQ-S', weight: 7.0, weightUnit: 'oz', stripePriceId: 'price_s' },
  price_m: { sku: 'APQ-M', weight: 7.9, weightUnit: 'oz', stripePriceId: 'price_m' },
  price_no_weight: { sku: 'APQ-NOWEIGHT', stripePriceId: 'price_no_weight' }, // no weight field at all
  // Deliberately cheap despite being heavy, so weight-tier tests don't
  // accidentally cross the $100 free-shipping threshold too.
  price_heavy_cheap: { sku: 'APQ-HEAVY', weight: 20.0, weightUnit: 'oz', stripePriceId: 'price_heavy_cheap' },
};

function priceObj(cents) {
  return { active: true, unit_amount: cents };
}

test('a cart under 16oz total gets the standard shipping rate', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(4500) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 1 }] }, // 7oz total — under 16oz
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.fixed_amount.amount, 500);
    assert.equal(shippingOption.display_name, 'Standard shipping');
  });
});

test('a cart at or above 16oz total gets the upgraded shipping rate', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_heavy_cheap: priceObj(1000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_heavy_cheap', qty: 1 }] }, // 20oz — at/above 16oz, well under the $100 free-shipping threshold
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    // No SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS set — defaults to 2x the $5 flat rate.
    assert.equal(shippingOption.fixed_amount.amount, 1000);
    assert.equal(shippingOption.display_name, 'Upgraded shipping');
  });
});

test('exactly 16oz (the threshold itself) counts as the upgraded tier', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_m: priceObj(4500) });
    const exact16 = { price_m: { ...VARIANTS.price_m, weight: 8.0 } };
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_m', qty: 2 }] }, // 2 x 8oz = 16oz exactly
      { stripe, buildVariantIndex: fakeVariantIndex(exact16), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.display_name, 'Upgraded shipping');
  });
});

test('the free-shipping threshold overrides the standard tier', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(10000) }); // $100 — meets the $100 free-shipping threshold
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 1 }] }, // 7oz — would otherwise be standard tier
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.fixed_amount.amount, 0);
    assert.equal(shippingOption.display_name, 'Free shipping');
  });
});

test('the free-shipping threshold overrides the upgraded tier too', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(10000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 3 }] }, // 21oz (upgraded tier by weight) but $300 (over free-shipping threshold)
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.fixed_amount.amount, 0);
    assert.equal(shippingOption.display_name, 'Free shipping');
  });
});

test('respects SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS when explicitly set instead of defaulting to 2x', async () => {
  await withEnv({ ...SHIPPING_ENV, SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS: '1250' }, async () => {
    const stripe = fakeStripe({ price_heavy_cheap: priceObj(1000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_heavy_cheap', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.fixed_amount.amount, 1250);
  });
});

test('a variant with no stored weight contributes 0oz instead of crashing checkout', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_no_weight: priceObj(4500) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_no_weight', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    // 0oz treated as under the 16oz threshold — standard tier, not a crash.
    assert.equal(shippingOption.display_name, 'Standard shipping');
    assert.equal(shippingOption.fixed_amount.amount, 500);
  });
});

test('a cart item whose priceId has no catalog entry at all is treated the same as 0oz', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(4500) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex({}), siteUrl: 'https://example.com' } // empty index
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.display_name, 'Standard shipping');
  });
});

test('rejects an empty items array', async () => {
  const result = await handleCreateCheckoutSession({ items: [] }, {});
  assert.equal(result.status, 400);
});

test('rejects an item with a non-positive qty', async () => {
  const result = await handleCreateCheckoutSession({ items: [{ priceId: 'price_s', qty: 0 }] }, {});
  assert.equal(result.status, 400);
});

test('rejects an unknown price', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({});
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_ghost', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Unknown price/);
  });
});
