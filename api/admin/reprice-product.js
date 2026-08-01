const Stripe = require('stripe');
const { isAuthorizedAdminRequest } = require('../../lib/admin-auth');
const { getProduct } = require('../../lib/product-catalog');
const { repriceProduct } = require('../../scripts/reprice-product');

/**
 * One-time price change endpoint: creates a new Stripe Price for every
 * variant of one catalog product (reusing each variant's existing Stripe
 * Product), points that Product's default_price at it, archives the old
 * Price, and updates the catalog record. Runs server-side specifically so
 * it can use the real production STRIPE_SECRET_KEY and Redis credentials
 * already injected into this deployment — those are marked Sensitive in
 * Vercel and therefore not retrievable via `vercel env pull`. See
 * scripts/reprice-product.js and docs/stripe-setup.md.
 *
 * TEMPORARY — remove this route (and this file) once the price change has
 * run; it mutates live billing data and shouldn't stay reachable
 * indefinitely even behind the admin token.
 *
 * @param {Object} query { id: string, price: string, dryRun?: 'true' }
 * @param {Object} [deps] injectable for tests
 */
async function handleRepriceProduct(query, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const lookupOne = deps.getProduct || getProduct;
  const reprice = deps.repriceProduct || repriceProduct;

  const { id, price, dryRun } = query || {};
  const isDryRun = dryRun === 'true';

  if (!id) {
    return { status: 400, body: { error: 'id query param is required' } };
  }
  if (!price) {
    return { status: 400, body: { error: 'price query param is required' } };
  }

  const product = await lookupOne(id);
  if (!product) {
    return { status: 404, body: { error: `No catalog entry found for "${id}"` } };
  }

  try {
    const result = await reprice(id, price, { stripe, dryRun: isDryRun });
    return { status: 200, body: { dryRun: isDryRun, ...result } };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method not allowed');
    return;
  }

  if (!isAuthorizedAdminRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const query = {
    id: url.searchParams.get('id') || undefined,
    price: url.searchParams.get('price') || undefined,
    dryRun: url.searchParams.get('dryRun') || undefined,
  };

  const result = await handleRepriceProduct(query);
  res.status(result.status).json(result.body);
}

handler.handleRepriceProduct = handleRepriceProduct; // exported for tests
module.exports = handler;
