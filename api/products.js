const { listActiveProducts, flattenProductToCards } = require('../lib/product-catalog');
const { getInventory } = require('../lib/inventory');
const { computePresaleStatus } = require('../lib/presale');

/**
 * Fills in the inventory-derived presale fields `flattenProductToCards`
 * deliberately leaves out (it's synchronous, no Redis access) — one
 * `getInventory` read per distinct `inventoryKey`, not per card. A
 * multi-size presale (e.g. the tee's S/M/L/XL/XXL) has 5 cards that all
 * share one pooled `inventoryKey`, so this dedupes concurrent lookups for
 * the same key into a single in-flight read (the `Map` caches the
 * *promise*, not just the resolved value, so cards racing in the same
 * `Promise.all` still only trigger one real `getInventory` call) —
 * guaranteeing every sibling size card also reports identical
 * remaining/claimed/isPresaleClosed, never a per-size split. Mutates
 * `cards` in place.
 * @param {Array<Object>} cards
 * @param {typeof getInventory} [getInventoryFn] injectable for tests
 */
async function attachPresaleStatus(cards, getInventoryFn = getInventory) {
  const remainingByKey = new Map();

  await Promise.all(
    cards
      .filter((card) => card.isPresale)
      .map(async (card) => {
        const key = card.inventoryKey || card.providerVariantId;
        if (!remainingByKey.has(key)) {
          remainingByKey.set(key, getInventoryFn(key));
        }
        const remaining = await remainingByKey.get(key);

        const status = computePresaleStatus({
          capUnits: card.presaleCapUnits,
          remaining,
          endsAtIso: card.presaleEndsAt,
        });
        card.presaleRemaining = status.remaining;
        card.presaleClaimed = status.claimed;
        card.isPresaleClosed = status.isPresaleClosed;
      })
  );
}

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
    await attachPresaleStatus(cards);
    res.status(200).json(cards);
  } catch (err) {
    console.error('[api/products] failed to load catalog', err);
    res.status(500).json({ error: 'Could not load products' });
  }
};

module.exports.attachPresaleStatus = attachPresaleStatus; // exported for tests
