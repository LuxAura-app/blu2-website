const { test } = require('node:test');
const assert = require('node:assert/strict');
const apliiqProvider = require('../lib/fulfillment/apliiq-provider');
const { buildAuthHeader } = require('../lib/fulfillment/apliiq-auth');

const fixtureRequest = {
  externalReference: 'BLU2-cs_test_abc-APLIIQ',
  provider: 'apliiq',
  recipient: {
    name: 'Jane Q Doe',
    address1: '123 Main St',
    address2: 'Apt 4',
    city: 'Brooklyn',
    stateCode: 'NY',
    countryCode: 'US',
    postalCode: '11201',
    phone: '+15551234567',
    email: 'jane@example.com',
  },
  items: [
    { internalOrderItemId: 'li_1', providerVariantId: 'APQ-12345678S1A1', sku: 'APQ-12345678S1A1', name: 'BLU2 Tee', quantity: 2, retailPriceCents: 4500 },
    { internalOrderItemId: 'li_2', providerVariantId: 'APQ-99999999S2A2', sku: 'APQ-99999999S2A2', name: 'BLU2 Hoodie', quantity: 1, retailPriceCents: 6500 },
  ],
};

test('order-level fields map to the externalReference on all three id-ish fields', () => {
  const payload = apliiqProvider.buildApliiqOrderPayload(fixtureRequest);
  assert.equal(payload.id, fixtureRequest.externalReference);
  assert.equal(payload.number, fixtureRequest.externalReference);
  assert.equal(payload.order_number, fixtureRequest.externalReference);
});

test('line items map quantity, price in dollars, and sku correctly', () => {
  const payload = apliiqProvider.buildApliiqOrderPayload(fixtureRequest);
  assert.equal(payload.line_items.length, 2);
  assert.deepEqual(payload.line_items[0], {
    id: 'li_1',
    title: 'BLU2 Tee',
    quantity: 2,
    price: 45,
    sku: 'APQ-12345678S1A1',
  });
  assert.equal(payload.line_items[1].price, 65);
});

test('shipping address splits name into first/last and carries required US fields', () => {
  const payload = apliiqProvider.buildApliiqOrderPayload(fixtureRequest);
  assert.deepEqual(payload.shipping_address, {
    first_name: 'Jane Q',
    last_name: 'Doe',
    address1: '123 Main St',
    city: 'Brooklyn',
    zip: '11201',
    province: 'NY',
    province_code: 'NY',
    country: 'US',
    country_code: 'US',
  });
});

test('a single-word recipient name has no last name rather than throwing', () => {
  const payload = apliiqProvider.buildApliiqOrderPayload({
    ...fixtureRequest,
    recipient: { ...fixtureRequest.recipient, name: 'Cher' },
  });
  assert.equal(payload.shipping_address.first_name, 'Cher');
  assert.equal(payload.shipping_address.last_name, '');
});

test('status normalization passes through known Apliiq statuses case-insensitively', () => {
  assert.equal(apliiqProvider.normalizeStatus('shipped'), 'Shipped');
  assert.equal(apliiqProvider.normalizeStatus('In Production'), 'In Production');
  assert.equal(apliiqProvider.normalizeStatus(null), 'Unknown');
});

test('status normalization keeps an unrecognized value rather than dropping it', () => {
  assert.equal(apliiqProvider.normalizeStatus('Some New Status Apliiq Adds Later'), 'Some New Status Apliiq Adds Later');
});

test('buildAuthHeader produces the documented "x-apliiq-auth RTS:SIG:APPID:STATE" shape', () => {
  const { header, timestamp, nonce } = buildAuthHeader({
    appId: 'app123',
    sharedSecret: 'shh',
    timestamp: '1700000000',
    nonce: 'fixed-nonce',
    body: '{"hello":"world"}',
  });
  assert.match(header, /^x-apliiq-auth \d+:[A-Za-z0-9+/=]+:app123:fixed-nonce$/);
  assert.equal(timestamp, '1700000000');
  assert.equal(nonce, 'fixed-nonce');
});

test('buildAuthHeader is deterministic for the same inputs (same signature each time)', () => {
  const opts = { appId: 'app123', sharedSecret: 'shh', timestamp: '1700000000', nonce: 'fixed-nonce', body: 'x' };
  const first = buildAuthHeader(opts);
  const second = buildAuthHeader(opts);
  assert.equal(first.header, second.header);
});

test('buildAuthHeader changes the signature when the shared secret changes', () => {
  const base = { appId: 'app123', timestamp: '1700000000', nonce: 'fixed-nonce', body: 'x' };
  const a = buildAuthHeader({ ...base, sharedSecret: 'secret-a' });
  const b = buildAuthHeader({ ...base, sharedSecret: 'secret-b' });
  assert.notEqual(a.header, b.header);
});

test('buildAuthHeader throws a clear error when credentials are missing', () => {
  assert.throws(() => buildAuthHeader({ appId: '', sharedSecret: '' }), /APLIIQ_APP_ID and APLIIQ_SHARED_SECRET/);
});
