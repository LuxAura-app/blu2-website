const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/admin/relink-stripe-live');
const { handleRelinkStripeLive } = handler;

function fakeStripe() {
  return {}; // never actually called in these tests — relinkProduct is stubbed
}

test('404s with "Catalog is empty" when no id given and there are no products', async () => {
  const result = await handleRelinkStripeLive(
    {},
    { stripe: fakeStripe(), listAllProducts: async () => [], getProduct: async () => null, relinkProduct: async () => ({}) }
  );
  assert.equal(result.status, 404);
  assert.match(result.body.error, /Catalog is empty/);
});

test('404s with the product id when a specific --id is not found', async () => {
  const result = await handleRelinkStripeLive(
    { id: 'apliiq-missing' },
    { stripe: fakeStripe(), listAllProducts: async () => [], getProduct: async () => null, relinkProduct: async () => ({}) }
  );
  assert.equal(result.status, 404);
  assert.match(result.body.error, /apliiq-missing/);
});

test('relinks only the requested product when ?id= is given', async () => {
  const product = { internalProductId: 'apliiq-1', variants: [] };
  const calls = [];
  const relink = async (p, opts) => {
    calls.push({ p, opts });
    return { internalProductId: p.internalProductId, mapping: [] };
  };

  const result = await handleRelinkStripeLive(
    { id: 'apliiq-1' },
    { stripe: fakeStripe(), getProduct: async (id) => (id === 'apliiq-1' ? product : null), relinkProduct: relink }
  );

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.dryRun, false);
  assert.equal(result.body.results[0].internalProductId, 'apliiq-1');
});

test('relinks every product and passes dryRun through when no id is given', async () => {
  const products = [
    { internalProductId: 'apliiq-1', variants: [] },
    { internalProductId: 'apliiq-2', variants: [] },
  ];
  const calls = [];
  const relink = async (p, opts) => {
    calls.push({ id: p.internalProductId, dryRun: opts.dryRun });
    return { internalProductId: p.internalProductId, mapping: [] };
  };

  const result = await handleRelinkStripeLive(
    { dryRun: 'true' },
    { stripe: fakeStripe(), listAllProducts: async () => products, relinkProduct: relink }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.dryRun, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.dryRun === true));
});

test('one product failing to relink is reported inline instead of aborting the rest', async () => {
  const products = [
    { internalProductId: 'apliiq-1', variants: [] },
    { internalProductId: 'apliiq-2', variants: [] },
  ];
  const relink = async (p) => {
    if (p.internalProductId === 'apliiq-1') throw new Error('boom');
    return { internalProductId: p.internalProductId, mapping: [] };
  };

  const result = await handleRelinkStripeLive(
    {},
    { stripe: fakeStripe(), listAllProducts: async () => products, relinkProduct: relink }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].error, 'boom');
  assert.equal(result.body.results[1].internalProductId, 'apliiq-2');
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
    const req = { method: 'POST', headers: { authorization: 'Bearer wrong-token' }, url: '/api/admin/relink-stripe-live' };
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
