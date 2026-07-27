const { listAllProducts } = require('../../lib/product-catalog');

/**
 * @param {string} search
 * @param {Object} [deps] injectable for tests
 * @param {typeof listAllProducts} [deps.listAllProducts]
 */
async function searchProducts(search, deps = {}) {
  const list = deps.listAllProducts || listAllProducts;
  const needle = (search || '').trim().toLowerCase();

  const products = await list();
  return products
    .filter((p) => !needle || (p.name || '').toLowerCase().includes(needle))
    .map((p) => ({
      store_ProductId: p.internalProductId,
      name: p.name,
      imageUrls: p.imageUrls || [],
    }));
}

/**
 * GET /api/apliiq/product-search?search=<text>
 *
 * Apliiq's docs don't document any authentication for this endpoint (no
 * signature header, nothing) — unlike Fulfillment/Warehouse Shipment
 * Complete, which document `x-apliiq-hmac`. Until Apliiq support confirms
 * otherwise, this is kept read-only and low-sensitivity: it only ever
 * returns name/image, and searches the full catalog (active *and*
 * inactive) since Apliiq may be searching for a product that hasn't been
 * activated yet. See docs/apliiq-webhooks.md.
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const matches = await searchProducts(url.searchParams.get('search'));
    res.status(200).json(matches);
  } catch (err) {
    console.error('[apliiq/product-search] failed', err);
    res.status(500).json([]);
  }
}

handler.searchProducts = searchProducts; // exported for tests
module.exports = handler;
