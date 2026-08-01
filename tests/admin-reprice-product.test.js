const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/admin/reprice-product');
const { handleRepriceProduct } = handler;

function fakeStripe() {
  return {}; // never actually called in these tests — repriceProduct is stubbed
}

test('400s when id is missing', async () => {
  const result = await handleRepriceProduct(
    { price: '45.00' },
    { stripe: fakeStripe(), getProduct: async () => null, repriceProduct: async () => ({}) }
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /id query param is required/);
});

test('400s when price is missing', async () => {
  const result = await handleRepriceProduct(
    { id: 'self-blu2-presale-tee' },
    { stripe: fakeStripe(), getProduct: async () => ({ internalProductId: 'self-blu2-presale-tee' }), repriceProduct: async () => ({}) }
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /price query param is required/);
});

test('404s when the catalog entry does not exist', async () => {
  const result = await handleRepriceProduct(
    { id: 'nope', price: '45.00' },
    { stripe: fakeStripe(), getProduct: async () => null, repriceProduct: async () => ({}) }
  );
  assert.equal(result.status, 404);
  assert.match(result.body.error, /nope/);
});

test('reprices the requested product and passes dryRun through', async () => {
  const product = { internalProductId: 'self-blu2-presale-tee', variants: [] };
  const calls = [];
  const reprice = async (id, price, opts) => {
    calls.push({ id, price, opts });
    return { internalProductId: id, mapping: [{ sku: 'RT-BLU2-PRESALE-S', oldPriceId: 'price_old', newPriceId: 'price_new', unitAmount: 4500 }] };
  };

  const result = await handleRepriceProduct(
    { id: 'self-blu2-presale-tee', price: '45.00', dryRun: 'true' },
    { stripe: fakeStripe(), getProduct: async (id) => (id === product.internalProductId ? product : null), repriceProduct: reprice }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.dryRun, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'self-blu2-presale-tee');
  assert.equal(calls[0].price, '45.00');
  assert.equal(calls[0].opts.dryRun, true);
  assert.equal(result.body.mapping[0].newPriceId, 'price_new');
});

test('surfaces a reprice failure as a 500 with the error message', async () => {
  const product = { internalProductId: 'self-blu2-presale-tee', variants: [] };
  const result = await handleRepriceProduct(
    { id: 'self-blu2-presale-tee', price: '45.00' },
    {
      stripe: fakeStripe(),
      getProduct: async () => product,
      repriceProduct: async () => {
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
    const req = { method: 'POST', headers: { authorization: 'Bearer wrong-token' }, url: '/api/admin/reprice-product' };
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
