const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchProducts } = require('../api/apliiq/product-search');

const FIXTURE_PRODUCTS = [
  {
    internalProductId: 'apliiq-1998244',
    name: 'Better Left Unsaid 2 Tee',
    imageUrls: ['https://example.com/tee.jpg'],
    active: true,
  },
  {
    internalProductId: 'apliiq-4633445',
    name: 'AFD Snapback',
    imageUrls: [],
    active: false, // inactive — must still be searchable
  },
];

function fakeCatalog(products) {
  return { listAllProducts: async () => products };
}

test('returns the documented [{ store_ProductId, name, imageUrls }] shape', async () => {
  const results = await searchProducts('', fakeCatalog(FIXTURE_PRODUCTS));
  assert.deepEqual(results, [
    { store_ProductId: 'apliiq-1998244', name: 'Better Left Unsaid 2 Tee', imageUrls: ['https://example.com/tee.jpg'] },
    { store_ProductId: 'apliiq-4633445', name: 'AFD Snapback', imageUrls: [] },
  ]);
});

test('filters case-insensitively on the search query param', async () => {
  const results = await searchProducts('snapback', fakeCatalog(FIXTURE_PRODUCTS));
  assert.equal(results.length, 1);
  assert.equal(results[0].store_ProductId, 'apliiq-4633445');
});

test('includes inactive entries — Apliiq may be searching for an unactivated product', async () => {
  const results = await searchProducts('AFD', fakeCatalog(FIXTURE_PRODUCTS));
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'AFD Snapback');
});

test('an empty search returns every catalog entry', async () => {
  const results = await searchProducts(undefined, fakeCatalog(FIXTURE_PRODUCTS));
  assert.equal(results.length, 2);
});
