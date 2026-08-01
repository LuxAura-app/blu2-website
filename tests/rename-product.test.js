const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renameProduct, parseArgs } = require('../scripts/rename-product');

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

test('parseArgs reads id and --name', () => {
  assert.deepEqual(parseArgs(['self-blu2-presale-tee', '--name=New Name']), {
    id: 'self-blu2-presale-tee',
    name: 'New Name',
  });
});

test('parseArgs rejects an unrecognized flag', () => {
  assert.throws(() => parseArgs(['--nonsense']), /Unrecognized flag/);
});

test('updates the catalog name and returns old/new', async () => {
  const upsert = fakeUpsert();
  const product = { internalProductId: 'self-blu2-presale-tee', name: 'Better Left Unsaid 2 — Presale Tee' };

  const result = await renameProduct('self-blu2-presale-tee', 'Better Left Unsaid 2 - Embers Tee', {
    getProduct: fakeGetProduct(product),
    upsert,
  });

  assert.equal(result.oldName, 'Better Left Unsaid 2 — Presale Tee');
  assert.equal(result.newName, 'Better Left Unsaid 2 - Embers Tee');
  assert.equal(upsert.calls.length, 1);
  assert.equal(upsert.calls[0].patch.name, 'Better Left Unsaid 2 - Embers Tee');
});

test('throws for a non-existent catalog entry', async () => {
  await assert.rejects(
    () => renameProduct('does-not-exist', 'New Name', { getProduct: async () => null, upsert: fakeUpsert() }),
    /No catalog entry found/
  );
});

test('throws for an empty name', async () => {
  const product = { internalProductId: 'self-blu2-presale-tee', name: 'Old Name' };
  await assert.rejects(
    () => renameProduct('self-blu2-presale-tee', '   ', { getProduct: fakeGetProduct(product), upsert: fakeUpsert() }),
    /--name must be a non-empty string/
  );
});
