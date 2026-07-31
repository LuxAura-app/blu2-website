const Stripe = require('stripe');
const { isAuthorizedAdminRequest } = require('../../lib/admin-auth');
const { listAllProducts, getProduct } = require('../../lib/product-catalog');
const { relinkProduct } = require('../../scripts/relink-stripe-live');

/**
 * One-time migration endpoint: relinks every variant of one (or every)
 * catalog product to a newly-created Stripe Product/Price under whatever
 * STRIPE_SECRET_KEY this deployment currently has, at each variant's
 * existing stored priceCents. Runs server-side specifically so it can use
 * the real (possibly Sensitive, CLI-unreadable) production STRIPE_SECRET_KEY
 * and Redis credentials already injected into this deployment, without
 * anyone needing to handle those values directly. See
 * scripts/relink-stripe-live.js and docs/stripe-setup.md for why this is
 * needed after switching Stripe from test mode to live mode.
 *
 * TEMPORARY — remove this route (and this file) once the catalog has been
 * relinked; it mutates live billing data and shouldn't stay reachable
 * indefinitely even behind the admin token.
 *
 * @param {Object} query { id?: string, dryRun?: 'true' }
 * @param {Object} [deps] injectable for tests
 */
async function handleRelinkStripeLive(query, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const listAll = deps.listAllProducts || listAllProducts;
  const lookupOne = deps.getProduct || getProduct;
  const relink = deps.relinkProduct || relinkProduct;

  const { id, dryRun } = query || {};
  const isDryRun = dryRun === 'true';

  const products = id ? [await lookupOne(id)] : await listAll();
  const targets = products.filter(Boolean);

  if (targets.length === 0) {
    return { status: 404, body: { error: id ? `No catalog entry found for "${id}"` : 'Catalog is empty' } };
  }

  const results = [];
  for (const product of targets) {
    try {
      results.push(await relink(product, { stripe, dryRun: isDryRun }));
    } catch (err) {
      results.push({ internalProductId: product.internalProductId, error: err.message });
    }
  }

  return { status: 200, body: { dryRun: isDryRun, results } };
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
    dryRun: url.searchParams.get('dryRun') || undefined,
  };

  const result = await handleRelinkStripeLive(query);
  res.status(result.status).json(result.body);
}

handler.handleRelinkStripeLive = handleRelinkStripeLive; // exported for tests
module.exports = handler;
