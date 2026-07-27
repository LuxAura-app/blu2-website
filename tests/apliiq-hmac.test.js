const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyApliiqHmac } = require('../lib/fulfillment/apliiq-hmac');

// Fixed payload + secret with an independently precomputed expected hash
// (base64(HMAC-SHA256(base64(payload), secret))) — not derived by calling
// verifyApliiqHmac itself, so this actually exercises the algorithm rather
// than testing the function against its own output.
const PAYLOAD = Buffer.from('{"order_id":"123","status":"success"}', 'utf8');
const SECRET = 'test-shared-secret';
const EXPECTED_HMAC = 'tN+CZz2WPtyNXJYf56rnb9Ci4wc1R3f7qoyAAka84Do=';

test('accepts a correctly signed payload', () => {
  assert.equal(verifyApliiqHmac(PAYLOAD, EXPECTED_HMAC, SECRET), true);
});

test('rejects a tampered payload', () => {
  const tampered = Buffer.from('{"order_id":"124","status":"success"}', 'utf8');
  assert.equal(verifyApliiqHmac(tampered, EXPECTED_HMAC, SECRET), false);
});

test('rejects the right payload signed with the wrong secret', () => {
  assert.equal(verifyApliiqHmac(PAYLOAD, EXPECTED_HMAC, 'a-different-secret'), false);
});

test('rejects a missing header', () => {
  assert.equal(verifyApliiqHmac(PAYLOAD, undefined, SECRET), false);
  assert.equal(verifyApliiqHmac(PAYLOAD, '', SECRET), false);
});

test('rejects when the secret is missing entirely', () => {
  assert.equal(verifyApliiqHmac(PAYLOAD, EXPECTED_HMAC, undefined), false);
});
