const crypto = require('crypto');

/**
 * Verifies the `x-apliiq-hmac` header on Fulfillment and Warehouse
 * Shipment Complete requests, per Apliiq's documented (if oddly-named)
 * scheme:
 *
 *   hmac-value = base64_encode(HMACSHA256(base64_encode(payload), SHARED_SECRET))
 *
 * Apliiq's own doc calls the algorithm "HMACSHA265", which doesn't exist —
 * this implements HMAC-SHA256 as the only sensible reading, flagged as
 * unconfirmed with their support in docs/apliiq-webhooks.md.
 *
 * Which secret Apliiq actually signs with is also unconfirmed — no inbound
 * signing example ties it to a specific credential name. This build reuses
 * `APLIIQ_SHARED_SECRET` (the same one used for outbound auth in
 * apliiq-auth.js) since that's the only shared secret Apliiq issues;
 * flagged as an assumption, not a confirmed fact, in docs/apliiq-webhooks.md.
 *
 * @param {Buffer} rawBody the exact bytes received, before JSON.parse
 * @param {string | undefined} headerValue the `x-apliiq-hmac` header
 * @param {string} secret
 * @returns {boolean}
 */
function verifyApliiqHmac(rawBody, headerValue, secret) {
  if (!headerValue || !secret || !rawBody) return false;

  const base64Payload = Buffer.from(rawBody).toString('base64');
  const expected = crypto.createHmac('sha256', secret).update(base64Payload).digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(headerValue, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { verifyApliiqHmac };
