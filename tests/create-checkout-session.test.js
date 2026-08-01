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

// Matches the real production default: free shipping is temporarily
// disabled (SHOP_FREE_SHIPPING_ENABLED unset/false) until the real
// Upgraded Shipping rate is confirmed — see docs/shop-architecture.md.
const SHIPPING_ENV = {
  SHOP_APLIIQ_FLAT_SHIPPING_CENTS: '500',
  SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS: undefined,
  SHOP_FREE_SHIPPING_THRESHOLD_CENTS: '10000',
  SHOP_FREE_SHIPPING_ENABLED: undefined,
};

const FREE_SHIPPING_ENV = { ...SHIPPING_ENV, SHOP_FREE_SHIPPING_ENABLED: 'true' };

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

test('the free-shipping threshold overrides the standard tier when SHOP_FREE_SHIPPING_ENABLED is true', async () => {
  await withEnv(FREE_SHIPPING_ENV, async () => {
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

test('the free-shipping threshold overrides the upgraded tier too, when enabled', async () => {
  await withEnv(FREE_SHIPPING_ENV, async () => {
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

test('SHOP_FREE_SHIPPING_ENABLED defaults to false — a cart over the free-shipping subtotal threshold is still charged Standard shipping', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(10000) }); // $100 — would meet the threshold, if enabled
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 1 }] }, // 7oz — standard tier by weight
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.fixed_amount.amount, 500);
    assert.equal(shippingOption.display_name, 'Standard shipping');
  });
});

test('SHOP_FREE_SHIPPING_ENABLED disabled — a cart over the threshold AND in the upgraded weight tier is still charged Upgraded shipping, not free', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(10000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 3 }] }, // 21oz (upgraded tier) and $300 (over the free-shipping threshold, if it applied)
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    // This is exactly the margin-risk scenario the flag exists to prevent —
    // must charge Upgraded, never silently fall through to free.
    assert.equal(shippingOption.fixed_amount.amount, 1000);
    assert.equal(shippingOption.display_name, 'Upgraded shipping');
  });
});

test('explicitly setting SHOP_FREE_SHIPPING_ENABLED to a non-"true" value also keeps shipping charged', async () => {
  await withEnv({ ...SHIPPING_ENV, SHOP_FREE_SHIPPING_ENABLED: 'false' }, async () => {
    const stripe = fakeStripe({ price_s: priceObj(10000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex(VARIANTS), siteUrl: 'https://example.com' }
    );

    assert.equal(result.status, 200);
    const shippingOption = stripe.sessionsCreated[0].shipping_options[0].shipping_rate_data;
    assert.equal(shippingOption.fixed_amount.amount, 500);
    assert.equal(shippingOption.display_name, 'Standard shipping');
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

/* ────────────────────────────────────────────
   PRESALE CLOSING — enforced here, not just hidden in shop.html. A closed
   presale must be rejected even though the price itself is still a
   perfectly valid, active Stripe Price (Stripe has no concept of "presale
   closed" — that's purely this app's Redis-backed state).
──────────────────────────────────────────── */
const FAR_FUTURE = '2099-01-01T00:00:00Z';
const FAR_PAST = '2000-01-01T00:00:00Z';

function presaleVariant(overrides) {
  return {
    price_presale: {
      sku: 'RT-BLU2-PRESALE',
      isPresale: true,
      presaleCapUnits: 50,
      presaleEndsAt: FAR_FUTURE,
      stripePriceId: 'price_presale',
      ...overrides,
    },
  };
}

test('rejects checkout for a presale SKU whose inventory has hit the unit cap, even before the deadline', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_presale: priceObj(4000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_presale', qty: 1 }] },
      {
        stripe,
        buildVariantIndex: fakeVariantIndex(presaleVariant({})),
        getInventory: async () => 0, // cap hit
        siteUrl: 'https://example.com',
      }
    );
    assert.equal(result.status, 400);
    assert.match(result.body.error, /presale is closed/);
    assert.equal(stripe.sessionsCreated.length, 0);
  });
});

test('rejects checkout for a presale SKU past its deadline, even with units still remaining', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_presale: priceObj(4000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_presale', qty: 1 }] },
      {
        stripe,
        buildVariantIndex: fakeVariantIndex(presaleVariant({ presaleEndsAt: FAR_PAST })),
        getInventory: async () => 40, // plenty of stock left
        siteUrl: 'https://example.com',
      }
    );
    assert.equal(result.status, 400);
    assert.match(result.body.error, /presale is closed/);
    assert.equal(stripe.sessionsCreated.length, 0);
  });
});

test('allows checkout for a presale SKU that is still open (stock left, deadline in the future)', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_presale: priceObj(4000) });
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_presale', qty: 1 }] },
      {
        stripe,
        buildVariantIndex: fakeVariantIndex(presaleVariant({})),
        getInventory: async () => 12,
        siteUrl: 'https://example.com',
      }
    );
    assert.equal(result.status, 200);
    assert.equal(stripe.sessionsCreated.length, 1);
  });
});

test('a non-presale item is never checked against inventory/deadline at all', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_s: priceObj(4500) });
    let inventoryChecked = false;
    const result = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_s', qty: 1 }] },
      {
        stripe,
        buildVariantIndex: fakeVariantIndex(VARIANTS),
        getInventory: async () => {
          inventoryChecked = true;
          return 0;
        },
        siteUrl: 'https://example.com',
      }
    );
    assert.equal(result.status, 200);
    assert.equal(inventoryChecked, false);
  });
});

/* ────────────────────────────────────────────
   SHARED POOL ACROSS SIZE VARIANTS — the presale tee's real shape (5
   sizes, one 50-unit cap). Two distinct variants (different SKU,
   different priceId) that share `inventoryKey` must be checked against
   the identical remaining count, since that's the same Redis counter
   `api/stripe-webhook.js` decrements for either one.
──────────────────────────────────────────── */
function pooledSizeVariants(overrides) {
  const shared = { isPresale: true, presaleCapUnits: 50, presaleEndsAt: FAR_FUTURE, inventoryKey: 'RT-BLU2-PRESALE', ...overrides };
  return {
    price_presale_l: { ...shared, sku: 'RT-BLU2-PRESALE-L', stripePriceId: 'price_presale_l' },
    price_presale_xxl: { ...shared, sku: 'RT-BLU2-PRESALE-XXL', stripePriceId: 'price_presale_xxl' },
  };
}

test('an order for size L and an order for size XXL are both checked against the same shared inventory key, not their own SKUs', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_presale_l: priceObj(4000), price_presale_xxl: priceObj(4000) });
    const seenKeys = [];
    const getInventoryFn = async (key) => {
      seenKeys.push(key);
      return 10;
    };

    const lResult = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_presale_l', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex(pooledSizeVariants({})), getInventory: getInventoryFn, siteUrl: 'https://example.com' }
    );
    const xxlResult = await handleCreateCheckoutSession(
      { items: [{ priceId: 'price_presale_xxl', qty: 1 }] },
      { stripe, buildVariantIndex: fakeVariantIndex(pooledSizeVariants({})), getInventory: getInventoryFn, siteUrl: 'https://example.com' }
    );

    assert.equal(lResult.status, 200);
    assert.equal(xxlResult.status, 200);
    // Both requests looked up the exact same shared key — never
    // 'RT-BLU2-PRESALE-L' or 'RT-BLU2-PRESALE-XXL' individually.
    assert.deepEqual(seenKeys, ['RT-BLU2-PRESALE', 'RT-BLU2-PRESALE']);
  });
});

test('a cart with both an L and an XXL of the same presale looks the shared pool up once, and rejects both if it is closed', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_presale_l: priceObj(4000), price_presale_xxl: priceObj(4000) });
    let callCount = 0;
    const result = await handleCreateCheckoutSession(
      {
        items: [
          { priceId: 'price_presale_l', qty: 1 },
          { priceId: 'price_presale_xxl', qty: 1 },
        ],
      },
      {
        stripe,
        buildVariantIndex: fakeVariantIndex(pooledSizeVariants({})),
        getInventory: async () => {
          callCount += 1;
          return 0; // shared pool exhausted
        },
        siteUrl: 'https://example.com',
      }
    );

    assert.equal(result.status, 400);
    assert.match(result.body.error, /presale is closed/);
    assert.equal(stripe.sessionsCreated.length, 0);
    // Deduped: one shared key, looked up once for the whole cart, not once per line item.
    assert.equal(callCount, 1);
  });
});

test('a cart with both an L and an XXL of the same presale is allowed through when the shared pool still has room', async () => {
  await withEnv(SHIPPING_ENV, async () => {
    const stripe = fakeStripe({ price_presale_l: priceObj(4000), price_presale_xxl: priceObj(4000) });
    const result = await handleCreateCheckoutSession(
      {
        items: [
          { priceId: 'price_presale_l', qty: 1 },
          { priceId: 'price_presale_xxl', qty: 1 },
        ],
      },
      {
        stripe,
        buildVariantIndex: fakeVariantIndex(pooledSizeVariants({})),
        getInventory: async () => 2, // 2 left in the shared pool, enough for both lines' presence check
        siteUrl: 'https://example.com',
      }
    );

    assert.equal(result.status, 200);
    assert.equal(stripe.sessionsCreated.length, 1);
  });
});
