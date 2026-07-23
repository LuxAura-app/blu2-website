const { buildAuthHeader } = require('./apliiq-auth');

const DEFAULT_BASE_URL = 'https://api.apliiq.com/v1'; // verified against help.apliiq.com's Create Order example
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function baseUrl() {
  return process.env.APLIIQ_API_BASE_URL || DEFAULT_BASE_URL;
}

function isTransientStatus(status) {
  return status >= 500 || status === 429;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Low-level signed request with timeout + retry-on-transient-only.
 * Never logs the Authorization header or shared secret — errors carry only
 * method/path/status, never the signed material.
 */
async function request(method, path, body) {
  const bodyString = body != null ? JSON.stringify(body) : undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const isLastAttempt = attempt === MAX_RETRIES;
    const { header } = buildAuthHeader({ body: bodyString });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: { Authorization: header, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: bodyString,
        signal: controller.signal,
      });
    } catch (networkErr) {
      clearTimeout(timeoutId);
      if (isLastAttempt) {
        throw new Error(`Apliiq API request failed on ${method} ${path}: ${networkErr.name === 'AbortError' ? 'timed out' : networkErr.message}`);
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }
    clearTimeout(timeoutId);

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      // non-JSON body — leave parsed as null, fall through with raw text below
    }

    if (res.ok) return parsed;

    if (isTransientStatus(res.status) && !isLastAttempt) {
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }

    const err = new Error(`Apliiq API error (${res.status}) on ${method} ${path}`);
    err.status = res.status;
    err.body = parsed !== null ? parsed : text;
    throw err;
  }

  throw new Error(`Apliiq API request exhausted retries on ${method} ${path}`);
}

/** Verified: POST /v1/Order, response is `{ id: <apliiq order id> }`. */
async function createOrder(payload) {
  return request('POST', '/Order', payload);
}

/**
 * UNVERIFIED. Apliiq's published docs (help.apliiq.com) confirm order
 * *creation* (POST /v1/Order) and an order-status enum, but no GET-order
 * endpoint was found for custom API integrations. This mirrors the
 * confirmed REST pattern as a best guess — do not depend on it for
 * production status monitoring until confirmed with Apliiq support. See
 * docs/apliiq-setup.md.
 */
async function getOrder(apliiqOrderId) {
  return request('GET', `/Order/${apliiqOrderId}`);
}

module.exports = { createOrder, getOrder };
