const { upsertProduct, deriveInternalProductIdFromVariants, getProduct } = require('../../lib/product-catalog');

// Only these sizes are currently sold — Apliiq's full size range for this
// blank (up to 5xl) isn't offered. Any variant outside this list is
// dropped before it's ever written to the catalog, so oversized sizes
// can never end up live in Stripe or the catalog.
const ALLOWED_SIZES = ['s', 'm', 'l', 'xl', 'xxl'];

function isAllowedSize(size) {
  return ALLOWED_SIZES.includes(String(size || '').trim().toLowerCase());
}

/**
 * Apliiq's docs don't document any authentication for Add to Store either
 * (same gap as Product Search) — the compensating control is that nothing
 * created here is ever purchasable: no Stripe Product/Price exists for a
 * variant until a human runs `scripts/activate-product.js` with a real,
 * reviewed price (§11 of the fulfillment spec). See docs/apliiq-webhooks.md.
 *
 * Confirmed against a real captured payload (not just Apliiq's published
 * docs example, which doesn't match): the request body nests everything
 * under `product`, alongside a top-level `ApliiqProductIds` array —
 *   { "ApliiqProductIds": [5989067], "product": { "name": ..., "variants": [...] } }
 */
function validatePayload(body) {
  if (!body || typeof body !== 'object') {
    return ['Request body must be a JSON object'];
  }

  const product = body.product;
  if (!product || typeof product !== 'object') {
    return ['Missing "product" object'];
  }

  const errors = [];
  if (!product.name || typeof product.name !== 'string') {
    errors.push('Missing or invalid "name"');
  }
  if (!Array.isArray(product.variants) || product.variants.length === 0) {
    errors.push('Missing or empty "variants" array');
  } else {
    product.variants.forEach((v, i) => {
      if (!v || !v.sku) errors.push(`variants[${i}] is missing "sku"`);
    });
  }
  return errors;
}

/**
 * Add to Store no longer touches Stripe at all — it just records what
 * Apliiq sent. No stripeProductId/stripePriceId exists on a variant until
 * a human runs `scripts/activate-product.js` with a real, reviewed price
 * (see its header comment). `variant.price` is Apliiq's own submitted
 * price — stored as `suggestedCostPrice` purely as a reference for
 * whoever picks the activation price; it's never charged to a customer.
 *
 * Spreading `existingVariant` first means a repeated Add to Store call for
 * a SKU that's already on the catalog entry (Apliiq re-send, or a manual
 * re-trigger) refreshes informational fields (images, weight, cost price)
 * in place without disturbing anything activation may have already set
 * (`stripeProductId`, `stripePriceId`, `active`).
 */
function buildVariantRecord(variant, existingVariant) {
  return {
    ...existingVariant,
    sku: variant.sku,
    color: variant.color || null,
    size: variant.size || null,
    weight: variant.weight || null,
    weightUnit: variant.weightUnit || null,
    // Real payloads give each variant its own imageUrl (distinct per size),
    // not just a shared product-level imageUrls list — used preferentially
    // for that variant's storefront card, see flattenProductToCards.
    imageUrl: variant.imageUrl || null,
    suggestedCostPrice: Number(variant.price) || 0,
  };
}

/**
 * @param {Object} body the raw Add to Store payload — { ApliiqProductIds, product }
 * @param {Object} [deps] injectable for tests
 * @param {typeof upsertProduct} [deps.upsert]
 * @param {typeof getProduct} [deps.getProduct]
 */
async function handleAddProduct(body, deps = {}) {
  const upsert = deps.upsert || upsertProduct;
  const lookupProduct = deps.getProduct || getProduct;

  const errors = validatePayload(body);
  if (errors.length > 0) {
    return { storeProductId: null, hasError: true, errorMessages: errors };
  }

  const product = body.product;
  const apliiqProductId =
    Array.isArray(body.ApliiqProductIds) && body.ApliiqProductIds.length > 0 ? body.ApliiqProductIds[0] : null;

  // ApliiqProductIds[0] is confirmed present and stable across real Add to
  // Store calls for the same product, so it's the primary dedup key —
  // the SKU-prefix derivation is now only a fallback for the (so far
  // unobserved) case where it's missing. See docs/apliiq-webhooks.md.
  const internalProductId =
    apliiqProductId != null ? `apliiq-${apliiqProductId}` : deriveInternalProductIdFromVariants(product.variants);

  const allowedVariants = product.variants.filter((v) => isAllowedSize(v.size));
  const skippedSizes = product.variants.filter((v) => !isAllowedSize(v.size)).map((v) => v.size);
  if (skippedSizes.length > 0) {
    console.log(`[apliiq/add-product] ${internalProductId}: skipping disallowed sizes [${skippedSizes.join(', ')}]`);
  }

  if (allowedVariants.length === 0) {
    return {
      storeProductId: null,
      hasError: true,
      errorMessages: [
        `No variants within the allowed size range (${ALLOWED_SIZES.join(', ')}) — payload only had: ${product.variants
          .map((v) => v.size)
          .join(', ')}`,
      ],
    };
  }

  // Look up any existing catalog entry for this product so a repeated Add
  // to Store call (Apliiq retry, or Apliiq pushing an image/weight update)
  // updates each known SKU's record in place — by SKU only, nothing to
  // look up in Stripe at this stage — and only appends genuinely new SKUs.
  const existingProduct = await lookupProduct(internalProductId);
  const existingVariantsBySku = new Map((existingProduct?.variants || []).map((v) => [v.sku, v]));

  const variants = allowedVariants.map((variant) => buildVariantRecord(variant, existingVariantsBySku.get(variant.sku)));

  await upsert(internalProductId, {
    apliiqProductId: apliiqProductId != null ? String(apliiqProductId) : null,
    name: product.name,
    description: product.description || '',
    // Informational only, not currently used by anything — Apliiq's
    // garment-type field (e.g. "tshirts").
    type: product.type || null,
    imageUrls: product.imageUrls || [],
    sizes: product.sizes || [],
    colors: product.colors || [],
    variants,
    provider: 'apliiq',
    source: 'apliiq-add-to-store',
    // Omitted deliberately, not hardcoded `false`: upsertProduct() only
    // defaults `active` to false on first creation and otherwise leaves it
    // alone, so a re-send that updates images/weight after a human has
    // activated this product (scripts/activate-product.js) can't silently
    // flip it back to a draft.
  });

  console.log(
    `[apliiq/add-product] upserted ${internalProductId} — "${product.name}" ` +
      `(${variants.length} variant${variants.length === 1 ? '' : 's'})`
  );

  return { storeProductId: internalProductId, hasError: false, errorMessages: [] };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method not allowed');
    return;
  }

  // Read the body ourselves rather than relying on Vercel's default
  // bodyParser, which only parses req.body as JSON when Content-Type is
  // application/json — keeps this endpoint correct regardless of what
  // header Apliiq sends.
  const rawBody = await readRawBody(req);

  let body;
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
  } catch (err) {
    console.error('[apliiq/add-product] request body was not valid JSON', err.message);
    res.status(200).json({ storeProductId: null, hasError: true, errorMessages: [`Invalid JSON body: ${err.message}`] });
    return;
  }

  try {
    const result = await handleAddProduct(body);
    if (result.hasError) {
      console.error('[apliiq/add-product] failed:', result.errorMessages.join('; '));
    }
    res.status(200).json(result);
  } catch (err) {
    // Never let this throw an unhandled 500 — Apliiq's UI surfaces
    // whatever's sent back, so an error still needs to look like a normal
    // hasError response.
    console.error('[apliiq/add-product] unexpected error', err);
    res.status(200).json({ storeProductId: null, hasError: true, errorMessages: [err.message || 'Unexpected error'] });
  }
}

handler.config = { api: { bodyParser: false } };
handler.handleAddProduct = handleAddProduct; // exported for tests
module.exports = handler;
