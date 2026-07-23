// Phase 2 scaffold — not required to be configured at launch. Intended for
// true all-over-print, cut-and-sew, posters, art prints, and anything
// outside Apliiq's catalog. See docs/printful-setup.md to activate later;
// activating this should never require touching the storefront, cart, or
// Stripe code, only registering real order-mapping logic here.

function isConfigured() {
  return Boolean(process.env.PRINTFUL_API_KEY);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error('Printful is not configured — set PRINTFUL_API_KEY to activate it. See docs/printful-setup.md.');
  }
}

async function createOrder() {
  assertConfigured();
  throw new Error('Printful order submission is not implemented yet. See docs/printful-setup.md.');
}

async function getOrder() {
  assertConfigured();
  throw new Error('Printful order lookup is not implemented yet. See docs/printful-setup.md.');
}

function normalizeStatus(raw) {
  return raw;
}

module.exports = {
  name: 'printful',
  isConfigured,
  createOrder,
  getOrder,
  normalizeStatus,
};
