const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/admin/rename-product');
const { handleRenameProduct } = handler;

test('400s when id is missing', async () => {
  const result = await handleRenameProduct({ name: 'New Name' }, { getProduct: async () => null, renameProduct: async () => ({}) });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /id query param is required/);
});

test('400s when name is missing', async () => {
  const result = await handleRenameProduct(
    { id: 'self-blu2-presale-tee' },
    { getProduct: async () => ({ internalProductId: 'self-blu2-presale-tee' }), renameProduct: async () => ({}) }
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /name query param is required/);
});

test('404s when the catalog entry does not exist', async () => {
  const result = await handleRenameProduct(
    { id: 'nope', name: 'New Name' },
    { getProduct: async () => null, renameProduct: async () => ({}) }
  );
  assert.equal(result.status, 404);
  assert.match(result.body.error, /nope/);
});

test('renames the requested product', async () => {
  const product = { internalProductId: 'self-blu2-presale-tee' };
  const calls = [];
  const rename = async (id, name) => {
    calls.push({ id, name });
    return { internalProductId: id, oldName: 'Old Name', newName: name };
  };

  const result = await handleRenameProduct(
    { id: 'self-blu2-presale-tee', name: 'Better Left Unsaid 2 - Embers Tee' },
    { getProduct: async (id) => (id === product.internalProductId ? product : null), renameProduct: rename }
  );

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Better Left Unsaid 2 - Embers Tee');
  assert.equal(result.body.newName, 'Better Left Unsaid 2 - Embers Tee');
});

test('surfaces a rename failure as a 500 with the error message', async () => {
  const product = { internalProductId: 'self-blu2-presale-tee' };
  const result = await handleRenameProduct(
    { id: 'self-blu2-presale-tee', name: 'New Name' },
    {
      getProduct: async () => product,
      renameProduct: async () => {
        throw new Error('boom');
      },
    }
  );
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'boom');
});

test('handler rejects non-POST requests', async () => {
  const req = { method: 'GET' };
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
    },
    json(body) {
      this.body = body;
    },
  };

  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('handler rejects requests without a valid admin bearer token', async () => {
  const original = process.env.ADMIN_REPORT_TOKEN;
  process.env.ADMIN_REPORT_TOKEN = 'correct-token';
  try {
    const req = { method: 'POST', headers: { authorization: 'Bearer wrong-token' }, url: '/api/admin/rename-product' };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
      },
    };

    await handler(req, res);
    assert.equal(res.statusCode, 401);
  } finally {
    if (original === undefined) delete process.env.ADMIN_REPORT_TOKEN;
    else process.env.ADMIN_REPORT_TOKEN = original;
  }
});
