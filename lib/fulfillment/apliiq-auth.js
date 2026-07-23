const crypto = require('crypto');

/*
 * Apliiq's HMAC auth scheme, verified against help.apliiq.com/portal/en/kb/articles/authentication:
 *   Header: "Authorization: x-apliiq-auth {RTS}:{SIG}:{APPID}:{STATE}"
 *   SIG = base64(HMAC-SHA256(APPId + RTS + STATE + base64(body), SharedSecret))
 *   RTS = unix seconds, STATE = a random nonce, body is base64'd (empty string if none).
 * The docs explicitly warn never to transmit the shared secret itself — this module never
 * logs `sharedSecret` or the concatenated string that gets signed.
 */

function base64Body(body) {
  if (body == null || body === '') return '';
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  return Buffer.from(str, 'utf8').toString('base64');
}

function randomNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * @param {Object} [opts]
 * @param {string|Object} [opts.body] request body (object gets JSON-stringified); omit for none
 * @param {string} [opts.appId] defaults to APLIIQ_APP_ID
 * @param {string} [opts.sharedSecret] defaults to APLIIQ_SHARED_SECRET
 * @param {string} [opts.timestamp] override for tests; defaults to current unix seconds
 * @param {string} [opts.nonce] override for tests; defaults to a random nonce
 * @returns {{ header: string, timestamp: string, nonce: string }}
 */
function buildAuthHeader({
  body,
  appId = process.env.APLIIQ_APP_ID,
  sharedSecret = process.env.APLIIQ_SHARED_SECRET,
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = randomNonce(),
} = {}) {
  if (!appId || !sharedSecret) {
    throw new Error('APLIIQ_APP_ID and APLIIQ_SHARED_SECRET must be set to sign Apliiq requests.');
  }

  const encodedBody = base64Body(body);
  const toSign = `${appId}${timestamp}${nonce}${encodedBody}`;
  const signature = crypto.createHmac('sha256', sharedSecret).update(toSign, 'utf8').digest('base64');

  return {
    header: `x-apliiq-auth ${timestamp}:${signature}:${appId}:${nonce}`,
    timestamp,
    nonce,
  };
}

module.exports = { buildAuthHeader };
