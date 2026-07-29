const { test } = require('node:test');
const assert = require('node:assert/strict');
const { flattenProductToCards, buildVariantIndexByStripePriceId } = require('../lib/product-catalog');

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
