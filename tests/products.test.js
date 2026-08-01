const { test } = require('node:test');
const assert = require('node:assert/strict');
const { flattenProductToCards, buildVariantIndexByStripePriceId } = require('../lib/product-catalog');
const productsHandler = require('../api/products');

function fakeRedisClient(products) {
  return {
    async smembers() {
      return products.map((p) => p.internalProductId);
    },
    async get(key) {
      const id = key.replace(/^product:/, '');
      const product = products.find((p) => p.internalProductId === id);
      return product ? JSON.stringify(product) : null;
    },
  };
}

/**
 * Shape of a catalog record after api/apliiq/add-product.js has upserted a
 * multi-size Apliiq payload (see tests/add-product.test.js's REAL_PAYLOAD) —
 * one product, 5 allowed-size variants, uniform $45 price.
 */
const MULTI_VARIANT_PRODUCT = {
  internalProductId: 'apliiq-5989067',
  name: 'Better Left Unsaid 2 Tee Mali V',
  description: '',
  active: true,
  provider: 'apliiq',
  imageUrls: ['https://blob.apliiq.com/fallback.jpg'],
  variants: [
    { sku: 'APQ-5989067S6A1', color: 'black', size: 's', suggestedCostPrice: 45.0, priceCents: 4500, stripePriceId: 'price_s', imageUrl: 'https://blob.apliiq.com/s.jpg' },
    { sku: 'APQ-5989067S7A1', color: 'black', size: 'm', suggestedCostPrice: 45.0, priceCents: 4500, stripePriceId: 'price_m', imageUrl: 'https://blob.apliiq.com/m.jpg' },
    { sku: 'APQ-5989067S8A1', color: 'black', size: 'l', suggestedCostPrice: 45.0, priceCents: 4500, stripePriceId: 'price_l', imageUrl: 'https://blob.apliiq.com/l.jpg' },
    { sku: 'APQ-5989067S1A1', color: 'black', size: 'xl', suggestedCostPrice: 45.0, priceCents: 4500, stripePriceId: 'price_xl', imageUrl: 'https://blob.apliiq.com/xl.jpg' },
    { sku: 'APQ-5989067S2A1', color: 'black', size: 'xxl', suggestedCostPrice: 47.5, priceCents: 4750, stripePriceId: 'price_xxl', imageUrl: 'https://blob.apliiq.com/xxl.jpg' },
  ],
};

test('flattenProductToCards tags each variant card with groupId/size/sizeLabel', () => {
  const cards = flattenProductToCards(MULTI_VARIANT_PRODUCT);

  assert.equal(cards.length, 5);
  assert.ok(cards.every((c) => c.groupId === 'apliiq-5989067'));
  assert.ok(cards.every((c) => c.baseName === 'Better Left Unsaid 2 Tee Mali V'));

  assert.deepEqual(cards.map((c) => c.size), ['s', 'm', 'l', 'xl', 'xxl']);
  assert.deepEqual(cards.map((c) => c.sizeLabel), ['S', 'M', 'L', 'XL', 'XXL']);

  // Per-variant id/priceId stay distinct so the cart and checkout can still
  // key off one exact SKU, even though the frontend now groups these into a
  // single card.
  assert.equal(new Set(cards.map((c) => c.id)).size, 5);
  assert.deepEqual(cards.map((c) => c.priceId), ['price_s', 'price_m', 'price_l', 'price_xl', 'price_xxl']);
});

test('flattenProductToCards reports uniform pricing across a group via matching priceCents', () => {
  const cards = flattenProductToCards(MULTI_VARIANT_PRODUCT);
  const uniquePrices = new Set(cards.map((c) => c.priceCents));
  // This fixture's xxl variant is genuinely priced higher than s–xl, so the
  // group is NOT uniform — shop.html should render a price range for it.
  assert.equal(uniquePrices.size, 2);
  assert.deepEqual([...uniquePrices].sort((a, b) => a - b), [4500, 4750]);
});

test('flattenProductToCards falls back to isDefaultVariant:false when Apliiq default isn\'t tracked', () => {
  const cards = flattenProductToCards(MULTI_VARIANT_PRODUCT);
  // buildVariantRecord in api/apliiq/add-product.js doesn't persist Apliiq's
  // `default` flag today, so no variant in a stored catalog record carries
  // it — shop.html's picker falls back to the smallest/first size.
  assert.ok(cards.every((c) => c.isDefaultVariant === false));
});

test('flattenProductToCards surfaces isDefaultVariant:true when a catalog record does track it', () => {
  const withDefault = {
    ...MULTI_VARIANT_PRODUCT,
    variants: MULTI_VARIANT_PRODUCT.variants.map((v, i) => ({ ...v, default: i === 2 })),
  };
  const cards = flattenProductToCards(withDefault);
  assert.deepEqual(cards.map((c) => c.isDefaultVariant), [false, false, true, false, false]);
});

test('buildVariantIndexByStripePriceId maps every active product\'s variants by their Stripe Price ID', async () => {
  const withWeights = {
    ...MULTI_VARIANT_PRODUCT,
    variants: MULTI_VARIANT_PRODUCT.variants.map((v) => ({ ...v, weight: 7.0, weightUnit: 'oz' })),
  };
  const client = fakeRedisClient([withWeights]);

  const index = await buildVariantIndexByStripePriceId(client);

  assert.equal(index.size, 5);
  assert.equal(index.get('price_s').weight, 7.0);
  assert.equal(index.get('price_xxl').sku, 'APQ-5989067S2A1');
  assert.equal(index.has('price_ghost'), false);
});

test('buildVariantIndexByStripePriceId skips inactive products, matching everything else customer-facing', async () => {
  const inactiveProduct = { ...MULTI_VARIANT_PRODUCT, internalProductId: 'apliiq-inactive', active: false };
  const client = fakeRedisClient([inactiveProduct]);

  const index = await buildVariantIndexByStripePriceId(client);

  assert.equal(index.size, 0);
});

test('buildVariantIndexByStripePriceId omits variants with no stripePriceId rather than mapping them to undefined', async () => {
  const withoutStripeIds = {
    ...MULTI_VARIANT_PRODUCT,
    variants: MULTI_VARIANT_PRODUCT.variants.map((v) => ({ ...v, stripePriceId: undefined })),
  };
  const client = fakeRedisClient([withoutStripeIds]);

  const index = await buildVariantIndexByStripePriceId(client);

  assert.equal(index.size, 0);
});

const PRESALE_PRODUCT = {
  internalProductId: 'self-blu2-presale-tee',
  name: 'Better Left Unsaid 2 — Presale Tee',
  description: 'presale copy',
  active: true,
  provider: 'self',
  isPresale: true,
  presaleEndsAt: '2026-08-31T23:59:59-04:00',
  presaleGoal: 25,
  presaleCapUnits: 50,
  variants: [{ sku: 'RT-BLU2-PRESALE', stripePriceId: 'price_presale' }],
};

test('flattenProductToCards passes presale config fields through onto the card, false/null for ordinary products', () => {
  const [presaleCard] = flattenProductToCards(PRESALE_PRODUCT);
  assert.equal(presaleCard.isPresale, true);
  assert.equal(presaleCard.presaleEndsAt, '2026-08-31T23:59:59-04:00');
  assert.equal(presaleCard.presaleGoal, 25);
  assert.equal(presaleCard.presaleCapUnits, 50);

  const [ordinaryCard] = flattenProductToCards(MULTI_VARIANT_PRODUCT);
  assert.equal(ordinaryCard.isPresale, false);
  assert.equal(ordinaryCard.presaleEndsAt, null);
});

test('buildVariantIndexByStripePriceId merges the product-level presale fields onto each variant entry', async () => {
  const client = fakeRedisClient([PRESALE_PRODUCT]);
  const index = await buildVariantIndexByStripePriceId(client);
  const variant = index.get('price_presale');
  assert.equal(variant.isPresale, true);
  assert.equal(variant.presaleCapUnits, 50);
  assert.equal(variant.presaleEndsAt, '2026-08-31T23:59:59-04:00');
});

test("api/products.js's attachPresaleStatus fills in remaining/claimed/isPresaleClosed for presale cards only", async () => {
  const cards = flattenProductToCards(PRESALE_PRODUCT).concat(flattenProductToCards(MULTI_VARIANT_PRODUCT));
  const getInventoryFn = async (sku) => {
    assert.equal(sku, 'RT-BLU2-PRESALE');
    return 32;
  };

  await productsHandler.attachPresaleStatus(cards, getInventoryFn);

  const presaleCard = cards.find((c) => c.groupId === 'self-blu2-presale-tee');
  assert.equal(presaleCard.presaleRemaining, 32);
  assert.equal(presaleCard.presaleClaimed, 18);
  assert.equal(presaleCard.isPresaleClosed, false);

  const ordinaryCard = cards.find((c) => c.groupId === 'apliiq-5989067');
  assert.equal(ordinaryCard.isPresaleClosed, undefined);
});

test("attachPresaleStatus marks isPresaleClosed true once the inventory counter hits zero", async () => {
  const cards = flattenProductToCards(PRESALE_PRODUCT);
  await productsHandler.attachPresaleStatus(cards, async () => 0);
  assert.equal(cards[0].isPresaleClosed, true);
  assert.equal(cards[0].presaleClaimed, 50);
});

/**
 * The real shape of the (corrected) presale tee: 5 size variants, each
 * with its own SKU/priceId (so cart/checkout stay per-size), but all
 * pointing `inventoryKey` at the same shared pool — see
 * scripts/create-blu2-presale-tee.js and docs/shop-architecture.md's
 * "Pooled inventory across size variants".
 */
const POOLED_PRESALE_PRODUCT = {
  internalProductId: 'self-blu2-presale-tee',
  name: 'Better Left Unsaid 2 — Presale Tee',
  description: 'presale copy',
  active: true,
  provider: 'self',
  isPresale: true,
  presaleEndsAt: '2026-08-31T23:59:59-04:00',
  presaleGoal: 25,
  presaleCapUnits: 50,
  variants: ['s', 'm', 'l', 'xl', 'xxl'].map((size) => ({
    sku: `RT-BLU2-PRESALE-${size.toUpperCase()}`,
    size,
    stripePriceId: `price_presale_${size}`,
    inventoryKey: 'RT-BLU2-PRESALE',
  })),
};

test('flattenProductToCards defaults inventoryKey to the variant SKU when unset, and honors an explicit shared key', () => {
  const [ordinaryCard] = flattenProductToCards(MULTI_VARIANT_PRODUCT);
  assert.equal(ordinaryCard.inventoryKey, ordinaryCard.providerVariantId);

  const pooledCards = flattenProductToCards(POOLED_PRESALE_PRODUCT);
  assert.equal(pooledCards.length, 5);
  assert.ok(pooledCards.every((c) => c.inventoryKey === 'RT-BLU2-PRESALE'));
  // Each size still keeps its own distinct SKU/priceId — pooling only
  // affects which inventory counter gets decremented.
  assert.equal(new Set(pooledCards.map((c) => c.providerVariantId)).size, 5);
  assert.equal(new Set(pooledCards.map((c) => c.priceId)).size, 5);
});

test('buildVariantIndexByStripePriceId carries the shared inventoryKey through onto every size variant', async () => {
  const client = fakeRedisClient([POOLED_PRESALE_PRODUCT]);
  const index = await buildVariantIndexByStripePriceId(client);
  assert.equal(index.get('price_presale_l').inventoryKey, 'RT-BLU2-PRESALE');
  assert.equal(index.get('price_presale_xxl').inventoryKey, 'RT-BLU2-PRESALE');
  assert.equal(index.get('price_presale_l').sku, 'RT-BLU2-PRESALE-L');
  assert.equal(index.get('price_presale_xxl').sku, 'RT-BLU2-PRESALE-XXL');
});

test('attachPresaleStatus reads the shared pool exactly once for 5 sibling size cards, not once per card', async () => {
  const cards = flattenProductToCards(POOLED_PRESALE_PRODUCT);
  let callCount = 0;
  const getInventoryFn = async (key) => {
    callCount += 1;
    assert.equal(key, 'RT-BLU2-PRESALE'); // never called with a per-size SKU
    return 15;
  };

  await productsHandler.attachPresaleStatus(cards, getInventoryFn);

  assert.equal(callCount, 1);
  // Every size card reports the identical shared claimed/remaining/closed
  // status — never a per-size split.
  assert.ok(cards.every((c) => c.presaleRemaining === 15));
  assert.ok(cards.every((c) => c.presaleClaimed === 35));
  assert.ok(cards.every((c) => c.isPresaleClosed === false));
});

test('attachPresaleStatus closes every size card together once the shared pool hits zero, regardless of size mix', async () => {
  const cards = flattenProductToCards(POOLED_PRESALE_PRODUCT);
  await productsHandler.attachPresaleStatus(cards, async () => 0);
  assert.ok(cards.every((c) => c.isPresaleClosed === true));
});
