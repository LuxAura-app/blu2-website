const { listActiveProducts, flattenProductToCards } = require('../lib/product-catalog');

// Public, unauthenticated — this is just the storefront's own catalog, no
// customer/payment data. shop.html fetches this on load instead of a
// hardcoded PRODUCTS array (see docs/shop-architecture.md).
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const products = await listActiveProducts();
    const cards = products.flatMap((p) => flattenProductToCards(p));
    res.status(200).json(cards);
  } catch (err) {
    console.error('[api/products] failed to load catalog', err);
    res.status(500).json({ error: 'Could not load products' });
  }
};
