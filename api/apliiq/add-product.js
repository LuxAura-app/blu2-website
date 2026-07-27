const Stripe = require('stripe');
const { upsertProduct, deriveInternalProductIdFromVariants } = require('../../lib/product-catalog');

/**
 * Apliiq's docs don't document any authentication for Add to Store either
 * (same gap as Product Search) — the compensating control is that nothing
 * created here is ever purchasable: every entry is written `active: false`
 * and a human has to review pricing/imagery and flip it active (§11 of the
 * fulfillment spec). See docs/apliiq-webhooks.md.
 */
function validatePayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return ['Request body must be a JSON object'];
  }
  if (!body.name || typeof body.name !== 'string') {
    errors.push('Missing or invalid "name"');
  }
  if (!Array.isArray(body.variants) || body.variants.length === 0) {
    errors.push('Missing or empty "variants" array');
  } else {
    body.variants.forEach((v, i) => {
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
 * @param {Object} body the raw Add to Store payload
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

  const internalProductId = deriveInternalProductIdFromVariants(body.variants);

  let variantsWithStripe;
  try {
    variantsWithStripe = [];
    for (const variant of body.variants) {
      variantsWithStripe.push(await createStripeVariant(stripe, body, variant));
    }
  } catch (err) {
    return {
      storeProductId: null,
      hasError: true,
      errorMessages: [`Stripe product/price creation failed: ${err.message}`],
    };
  }

  await upsert(internalProductId, {
    name: body.name,
    description: body.description || '',
    imageUrls: body.imageUrls || [],
    sizes: body.sizes || [],
    colors: body.colors || [],
    variants: variantsWithStripe,
    provider: 'apliiq',
    source: 'apliiq-add-to-store',
    active: false,
  });

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
  // bodyParser (which only parses req.body as JSON when Content-Type is
  // application/json — if Apliiq sends anything else, req.body can come
  // back empty/a raw string with no error, which looks identical to a
  // genuinely-empty payload). This guarantees we see exactly what Apliiq
  // sent regardless of headers.
  const rawBody = await readRawBody(req);

  // TEMPORARY — investigating "Missing or invalid name" / "Missing or
  // empty variants array" errors from a real Add to Store attempt.
  // Remove this whole block (down to "END TEMPORARY") once the real
  // payload shape is confirmed — see docs/apliiq-webhooks.md.
  console.log('[apliiq/add-product] TEMP DEBUG content-type:', req.headers['content-type']);
  console.log('[apliiq/add-product] TEMP DEBUG content-length header:', req.headers['content-length'], 'actual bytes:', rawBody.length);
  console.log('[apliiq/add-product] TEMP DEBUG raw body:', rawBody.toString('utf8'));
  // END TEMPORARY

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
