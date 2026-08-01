const { isAuthorizedAdminRequest } = require('../../lib/admin-auth');
const { getProduct } = require('../../lib/product-catalog');
const { renameProduct } = require('../../scripts/rename-product');

/**
 * One-time catalog metadata edit endpoint: updates a product's display
 * `name` in Redis. Runs server-side so it can use the real production
 * Redis credentials already injected into this deployment — those are
 * marked Sensitive in Vercel and therefore not retrievable via
 * `vercel env pull`. See scripts/rename-product.js.
 *
 * TEMPORARY — remove this route (and this file) once the rename has run;
 * it mutates the live catalog and shouldn't stay reachable indefinitely
 * even behind the admin token.
 *
 * @param {Object} query { id: string, name: string }
 * @param {Object} [deps] injectable for tests
 */
async function handleRenameProduct(query, deps = {}) {
  const lookupOne = deps.getProduct || getProduct;
  const rename = deps.renameProduct || renameProduct;

  const { id, name } = query || {};

  if (!id) {
    return { status: 400, body: { error: 'id query param is required' } };
  }
  if (!name) {
    return { status: 400, body: { error: 'name query param is required' } };
  }

  const product = await lookupOne(id);
  if (!product) {
    return { status: 404, body: { error: `No catalog entry found for "${id}"` } };
  }

  try {
    const result = await rename(id, name, deps);
    return { status: 200, body: result };
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
    name: url.searchParams.get('name') || undefined,
  };

  const result = await handleRenameProduct(query);
  res.status(result.status).json(result.body);
}

handler.handleRenameProduct = handleRenameProduct; // exported for tests
module.exports = handler;
