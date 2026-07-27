const Stripe = require('stripe');
const { upsertProduct, deriveInternalProductIdFromVariants } = require('../../lib/product-catalog');

/**
 * Apliiq's docs don't document any authentication for Add to Store either
 * (same gap as Product Search) — the compensating control is that nothing
 * created here is ever purchasable: every entry is written `active: false`
 * and a human has to review pricing/imagery and flip it active (§11 of the
 * fulfillment spec). See docs/apliiq-webhooks.md.
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
 * One Stripe Product + Price per variant, matching this build's existing
 * "one sellable SKU = one Stripe Price" convention (docs/stripe-setup.md).
 * The payload's `price` is Apliiq's cost/suggested price, used only as a
 * starting `unit_amount` — never presented to customers without review,
 * since the catalog entry stays `active: false` until a human flips it.
 */
async function createStripeVariant(stripe, product, variant) {
  const label = [variant.color, variant.size].filter(Boolean).join(' / ');
  const stripeProduct = await stripe.products.create({
    name: label ? `${product.name} — ${label}` : product.name,
    metadata: {
      fulfillment_provider: 'apliiq',
      provider_variant_id: variant.sku,
    },
  });

  const unitAmount = Math.round((Number(variant.price) || 0) * 100);
  const stripePrice = await stripe.prices.create({
    product: stripeProduct.id,
    currency: 'usd',
    unit_amount: unitAmount,
  });

  return {
    sku: variant.sku,
    color: variant.color || null,
    size: variant.size || null,
    weight: variant.weight || null,
    priceCents: unitAmount,
    stripeProductId: stripeProduct.id,
    stripePriceId: stripePrice.id,
  };
}

/**
 * @param {Object} body the raw Add to Store payload — { ApliiqProductIds, product }
 * @param {Object} [deps] injectable for tests
 * @param {import('stripe')} [deps.stripe]
 * @param {typeof upsertProduct} [deps.upsert]
 */
async function handleAddProduct(body, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const upsert = deps.upsert || upsertProduct;

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

  let variantsWithStripe;
  try {
    variantsWithStripe = [];
    for (const variant of product.variants) {
      variantsWithStripe.push(await createStripeVariant(stripe, product, variant));
    }
  } catch (err) {
    return {
      storeProductId: null,
      hasError: true,
      errorMessages: [`Stripe product/price creation failed: ${err.message}`],
    };
  }

  await upsert(internalProductId, {
    apliiqProductId: apliiqProductId != null ? String(apliiqProductId) : null,
    name: product.name,
    description: product.description || '',
    imageUrls: product.imageUrls || [],
    sizes: product.sizes || [],
    colors: product.colors || [],
    variants: variantsWithStripe,
    provider: 'apliiq',
    source: 'apliiq-add-to-store',
    active: false,
  });

  console.log(
    `[apliiq/add-product] upserted ${internalProductId} — "${product.name}" ` +
      `(${variantsWithStripe.length} variant${variantsWithStripe.length === 1 ? '' : 's'})`
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
