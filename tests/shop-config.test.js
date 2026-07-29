const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/shop-config');

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
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

test('rejects non-GET requests', async () => {
  const res = fakeRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('falls back to a conservative default when PRODUCTION_TIME_COPY is unset', async () => {
  await withEnv({ PRODUCTION_TIME_COPY: undefined }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(
      res.body.productionTimeCopy,
      'Made to order — ships within 1 week. Standard shipping typically takes an additional 2-7 business days to arrive, for a total of about 1-2 weeks.'
    );
  });
});

test('uses PRODUCTION_TIME_COPY when set', async () => {
  await withEnv({ PRODUCTION_TIME_COPY: 'Made to order — ships in 2-3 business days.' }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.productionTimeCopy, 'Made to order — ships in 2-3 business days.');
  });
});

test('supportEmail falls back to ORDER_NOTIFICATION_EMAIL when SUPPORT_EMAIL is unset', async () => {
  await withEnv({ SUPPORT_EMAIL: undefined, ORDER_NOTIFICATION_EMAIL: 'orders@example.com' }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.supportEmail, 'orders@example.com');
  });
});

test('SUPPORT_EMAIL takes priority over ORDER_NOTIFICATION_EMAIL when both are set', async () => {
  await withEnv({ SUPPORT_EMAIL: 'support@example.com', ORDER_NOTIFICATION_EMAIL: 'orders@example.com' }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.supportEmail, 'support@example.com');
  });
});

test('supportEmail is null when neither env var is set', async () => {
  await withEnv({ SUPPORT_EMAIL: undefined, ORDER_NOTIFICATION_EMAIL: undefined }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.supportEmail, null);
  });
});
