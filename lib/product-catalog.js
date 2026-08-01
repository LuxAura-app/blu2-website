const crypto = require('crypto');
const { getRedisClient } = require('./redis');

const PRODUCTS_INDEX_KEY = 'products:index';

function productKey(internalProductId) {
  return `product:${internalProductId}`;
}

function parseRecord(raw) {
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getProduct(internalProductId, client = getRedisClient()) {
  return parseRecord(await client.get(productKey(internalProductId)));
}

/**
 * Merge-writes a catalog entry. `active` only defaults to `false` on first
 * creation — an update that omits `active` never resets an already-active
 * product back to a draft. `createdAt` is set once; `updatedAt` always
 * bumps. Adds the id to `products:index` (a Set) so Product Search and
 * `scripts/validate-products.js` can enumerate every entry, active or not.
 * @param {string} internalProductId
 * @param {Object} patch
 * @param {import('@upstash/redis').Redis} [client] injectable for tests
 */
async function upsertProduct(internalProductId, patch, client = getRedisClient()) {
  const existing = await getProduct(internalProductId, client);
  const now = Date.now();

  const merged = {
    ...existing,
    ...patch,
    internalProductId,
    active: patch.active !== undefined ? patch.active : existing ? existing.active : false,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  await client.set(productKey(internalProductId), JSON.stringify(merged));
  await client.sadd(PRODUCTS_INDEX_KEY, internalProductId);
  return merged;
}

async function listAllProducts(client = getRedisClient()) {
  const ids = await client.smembers(PRODUCTS_INDEX_KEY);
  const records = await Promise.all(ids.map((id) => getProduct(id, client)));
  return records.filter(Boolean);
}

async function listActiveProducts(client = getRedisClient()) {
  const all = await listAllProducts(client);
  return all.filter((p) => p.active === true);
}

/**
 * Maps every active catalog entry's variants by their Stripe Price ID, so
 * checkout can look up each cart line's real stored `weight`/`weightUnit`
 * (from Apliiq's Add to Store payload, see api/apliiq/add-product.js)
 * without a separate Redis round trip per line item. Scoped to active
 * products only, matching everything else customer-facing — a variant
 * missing here (deactivated after being added to a cart, or never given a
 * stripePriceId) simply won't be in the returned Map; callers should treat
 * that as "unknown weight," not throw.
 * @param {import('@upstash/redis').Redis} [client] injectable for tests
 * @returns {Promise<Map<string, Object>>} stripePriceId -> variant record
 */
async function buildVariantIndexByStripePriceId(client = getRedisClient()) {
  const products = await listActiveProducts(client);
  const index = new Map();
  for (const product of products) {
    for (const variant of product.variants || []) {
      if (!variant.stripePriceId) continue;
      // Presale fields live on the product record, not the variant — merged
      // on here so a single stripePriceId -> variant lookup (as
      // api/create-checkout-session.js already does for weight) is enough
      // for it to also enforce presale closing, without a second Redis
      // round trip or duplicating this "which fields count as presale"
      // list in two places.
      index.set(variant.stripePriceId, {
        ...variant,
        isPresale: Boolean(product.isPresale),
        presaleEndsAt: product.presaleEndsAt || null,
        presaleCapUnits: product.presaleCapUnits != null ? product.presaleCapUnits : null,
      });
    }
  }
  return index;
}

const APLIIQ_SKU_PATTERN = /^APQ-(\d+)S\d+A\d+$/i;

/**
 * Keys a catalog entry by the shared numeric prefix in Apliiq's
 * `APQ-{digits}S{n}A{n}`-style SKUs, so a re-sent Add to Store payload for
 * the same product updates one entry instead of creating a duplicate.
 * Interim strategy — see docs/apliiq-webhooks.md for why: Apliiq's docs
 * don't confirm whether `store_ProductId` is expected to persist across
 * calls, so this doesn't rely on it at all.
 * @param {Array<{sku?: string}>} variants
 */
function deriveInternalProductIdFromVariants(variants) {
  for (const variant of variants || []) {
    const match = APLIIQ_SKU_PATTERN.exec(variant && variant.sku);
    if (match) return `apliiq-${match[1]}`;
  }

  // No variant matched the expected SKU shape — fall back to a stable hash
  // of the sorted SKU list so repeated submissions of the same payload
  // still land on one entry.
  const skus = (variants || []).map((v) => v && v.sku).filter(Boolean).sort();
  const hash = crypto.createHash('sha1').update(skus.join('|')).digest('hex').slice(0, 12);
  return `apliiq-unmatched-${hash}`;
}

/**
 * Maps one catalog record's `variants[]` into the flat card shape
 * `api/products.js` returns — still one entry per variant (so `id`/`priceId`
 * stay per-SKU, which the cart and checkout key off of), but each entry now
 * carries explicit `groupId`/`size`/`sizeLabel`/`isDefaultVariant` fields so
 * `shop.html` can group same-product variants into a single card with a size
 * picker client-side, instead of parsing them out of `id`/`name` strings.
 * See docs/shop-architecture.md.
 * @param {Object} product
 */
function flattenProductToCards(product) {
  const variants = product.variants || [];
  return variants.map((variant) => {
    const suffix = [variant.color, variant.size].filter(Boolean).join(' / ');
    const priceCents = variant.priceCents != null ? variant.priceCents : Math.round((Number(variant.price) || 0) * 100);
    const size = variant.size ? String(variant.size).toLowerCase() : null;

    return {
      id: `${product.internalProductId}-${variant.sku}`,
      groupId: product.internalProductId,
      baseName: product.name,
      name: suffix ? `${product.name} — ${suffix}` : product.name,
      desc: product.description || '',
      priceCents,
      priceId: variant.stripePriceId || null,
      badge: product.badge || null,
      // Prefer the variant's own image (real Apliiq payloads give each
      // variant a distinct imageUrl) over the product-level fallback, so
      // e.g. a size-only variant grid doesn't render 8 identical cards.
      image: variant.imageUrl || (product.imageUrls && product.imageUrls[0]) || null,
      placeholderWord: product.placeholderWord || product.name,
      fulfillmentProvider: product.provider || 'apliiq',
      providerVariantId: variant.sku,
      // Which `inventory:{key}` counter (lib/inventory.js) this variant's
      // stock actually lives under. Defaults to the variant's own SKU
      // (today's behavior for every existing product — one SKU, one
      // pool), but a variant can set an explicit `inventoryKey` to pool
      // stock with sibling variants instead — e.g. the presale tee's 5
      // sizes all sharing one `RT-BLU2-PRESALE` counter rather than 5
      // independent 50-unit pools. See docs/shop-architecture.md.
      inventoryKey: variant.inventoryKey || variant.sku,
      size,
      sizeLabel: size ? size.toUpperCase() : null,
      // Apliiq's payload marks exactly one variant `default: true` per
      // product, but that field isn't currently persisted by
      // api/apliiq/add-product.js's buildVariantRecord — so this is almost
      // always false today, and shop.html falls back to the
      // smallest/first size when no variant in a group has it set.
      isDefaultVariant: Boolean(variant.default),
      active: Boolean(product.active),
      // Presale campaign fields (optional — undefined/false for every
      // ordinary catalog entry). `api/products.js` fills in the
      // inventory-derived remaining/claimed/isPresaleClosed fields on top
      // of these at request time, since that needs a Redis read this
      // synchronous function deliberately doesn't do.
      isPresale: Boolean(product.isPresale),
      presaleEndsAt: product.presaleEndsAt || null,
      presaleGoal: product.presaleGoal != null ? product.presaleGoal : null,
      presaleCapUnits: product.presaleCapUnits != null ? product.presaleCapUnits : null,
    };
  });
}

module.exports = {
  productKey,
  getProduct,
  upsertProduct,
  listAllProducts,
  listActiveProducts,
  buildVariantIndexByStripePriceId,
  deriveInternalProductIdFromVariants,
  flattenProductToCards,
  PRODUCTS_INDEX_KEY,
};
