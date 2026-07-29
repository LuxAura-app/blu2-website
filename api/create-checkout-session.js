const Stripe = require('stripe');
const { buildVariantIndexByStripePriceId } = require('../lib/product-catalog');

/*
 * Marketing consent UI note: Stripe Checkout has no native checkbox custom
 * field (custom_fields[].type is text/numeric/dropdown only, verified
 * against the current API reference) and consent_collection.promotions
 * neither accepts custom label copy nor documents a guaranteed default
 * (checked/unchecked) state. So the "unchecked by default" consent checkbox
 * from the spec is built as a required two-option dropdown defaulting to
 * "no" (a behavior the dropdown API *does* document), with the full
 * SMS/email disclosure copy — too long for the 50-char dropdown label —
 * placed in custom_text.submit.message instead, where the customer sees it
 * right above the pay button before submitting.
 */
const MARKETING_CONSENT_FIELD_KEY = 'marketing_consent';

// Apliiq's own published policy: a package at or above this total weight
// requires their "Upgraded Shipping" service instead of Standard.
const UPGRADED_SHIPPING_THRESHOLD_OZ = 16;

function badRequestResult(message) {
  return { status: 400, body: { error: message } };
}

/**
 * @param {Object} body raw request body — { items: [{ priceId, qty }] }
 * @param {Object} [deps] injectable for tests
 * @param {import('stripe')} [deps.stripe]
 * @param {typeof buildVariantIndexByStripePriceId} [deps.buildVariantIndex]
 * @param {string} [deps.siteUrl]
 */
async function handleCreateCheckoutSession(body, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const buildVariantIndex = deps.buildVariantIndex || buildVariantIndexByStripePriceId;

  const { items } = body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return badRequestResult('items must be a non-empty array of { priceId, qty }');
  }
  for (const item of items) {
    if (!item || typeof item.priceId !== 'string' || !Number.isInteger(item.qty) || item.qty < 1) {
      return badRequestResult('Each item needs a string priceId and a positive integer qty');
    }
  }

  // Look up every price server-side — never trust a price/amount sent by the client.
  let subtotalCents = 0;
  const lineItems = [];
  for (const item of items) {
    let price;
    try {
      price = await stripe.prices.retrieve(item.priceId);
    } catch (err) {
      return badRequestResult(`Unknown price: ${item.priceId}`);
    }
    if (!price.active || price.unit_amount == null) {
      return badRequestResult(`Price is not purchasable: ${item.priceId}`);
    }
    subtotalCents += price.unit_amount * item.qty;
    lineItems.push({ price: item.priceId, quantity: item.qty });
  }

  // Real per-variant weight (oz), stored on the Redis catalog record from
  // Apliiq's own Add to Store payload (see api/apliiq/add-product.js's
  // buildVariantRecord) — not an estimate. A cart item whose variant has no
  // stored weight (e.g. a catalog entry created/edited by hand, bypassing
  // Add to Store, or a variant deactivated after being added to someone's
  // cart) contributes 0oz here rather than failing checkout; it's logged so
  // the gap is visible without blocking a paying customer.
  const variantIndex = await buildVariantIndex();
  let totalWeightOz = 0;
  const missingWeightPriceIds = [];
  for (const item of items) {
    const variant = variantIndex.get(item.priceId);
    const weight = variant ? Number(variant.weight) : NaN;
    if (Number.isFinite(weight) && weight > 0) {
      totalWeightOz += weight * item.qty;
    } else {
      missingWeightPriceIds.push(item.priceId);
    }
  }
  if (missingWeightPriceIds.length > 0) {
    console.warn(
      `[create-checkout-session] no stored weight for price(s) ${missingWeightPriceIds.join(', ')} — ` +
        'treating as 0oz for shipping-tier purposes. Usually means the variant was created/edited without ' +
        'going through Apliiq Add to Store, so its catalog record never got a weight.'
    );
  }

  const flatShippingCents = Number(process.env.SHOP_APLIIQ_FLAT_SHIPPING_CENTS || 0);
  // Apliiq requires Upgraded Shipping at UPGRADED_SHIPPING_THRESHOLD_OZ —
  // its real cost isn't confirmed yet, so absent the env var this defaults
  // to a conservative placeholder (2x Standard). Same caveat as
  // SHOP_APLIIQ_FLAT_SHIPPING_CENTS itself: confirm the actual rate with
  // Apliiq (or from a real order invoice) and set this env var explicitly
  // before launch.
  const upgradedShippingCents = process.env.SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS
    ? Number(process.env.SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS)
    : flatShippingCents * 2;
  // Temporarily disabled (default false, not just an unreachable
  // threshold — a flag with this comment is harder to forget the reason
  // for than a giant number would be): the real Upgraded Shipping rate
  // isn't confirmed yet, so a 3+ item order that's both heavy enough for
  // the Upgraded tier AND over the free-shipping subtotal threshold could
  // currently ship at a loss of unknown size. Re-enable
  // SHOP_FREE_SHIPPING_ENABLED once SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS
  // reflects a real, confirmed Apliiq rate and the threshold has been
  // recalculated to safely cover it — see docs/shop-architecture.md.
  const freeShippingEnabled = process.env.SHOP_FREE_SHIPPING_ENABLED === 'true';
  const freeShippingThresholdCents = process.env.SHOP_FREE_SHIPPING_THRESHOLD_CENTS
    ? Number(process.env.SHOP_FREE_SHIPPING_THRESHOLD_CENTS)
    : null;

  const qualifiesForFreeShipping =
    freeShippingEnabled && freeShippingThresholdCents != null && subtotalCents >= freeShippingThresholdCents;
  const isUpgradedTier = totalWeightOz >= UPGRADED_SHIPPING_THRESHOLD_OZ;
  const shippingCents = qualifiesForFreeShipping ? 0 : isUpgradedTier ? upgradedShippingCents : flatShippingCents;
  const shippingLabel = qualifiesForFreeShipping
    ? 'Free shipping'
    : isUpgradedTier
      ? 'Upgraded shipping'
      : 'Standard shipping';

  const siteUrl = deps.siteUrl || process.env.SITE_URL;

  try {
    // Deliberately not enabling Stripe Tax (automatic_tax: { enabled: true })
    // — standard clothing is exempt from PA sales tax, and out-of-state
    // economic nexus thresholds aren't a near-term concern. Revisit this if
    // either changes: (1) non-clothing merch gets added (exemption no
    // longer applies), or (2) sales grow enough multi-state to approach a
    // state's economic nexus threshold. Until then, this is an intentional
    // decision, not an oversight to "fix".
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ['US'] },
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shippingCents, currency: 'usd' },
            display_name: shippingLabel,
          },
        },
      ],
      custom_fields: [
        {
          key: MARKETING_CONSENT_FIELD_KEY,
          label: { type: 'custom', custom: 'Get texts & emails about new drops?' },
          type: 'dropdown',
          dropdown: {
            options: [
              { label: 'No thanks', value: 'no' },
              { label: 'Yes, sign me up', value: 'yes' },
            ],
            default_value: 'no',
          },
          optional: false,
        },
      ],
      custom_text: {
        submit: {
          // Not claiming automated STOP-keyword handling here — no real
          // SMS/email marketing platform is wired up yet, so a "Reply
          // STOP" promise would be false. Once one is chosen and actual
          // STOP-keyword handling / unsubscribe links are built, update
          // this back to reference those specific mechanisms (matches the
          // same fix already made in privacy.html's marketing-use bullet).
          message:
            'Yes, send me occasional updates about new drops and shows (email and text). Msg & data rates may apply. You can opt out at any time by contacting us at titledtentatively@gmail.com.',
        },
      },
      success_url: `${siteUrl}/shop.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/shop.html?checkout=cancelled`,
    });

    return { status: 200, body: { url: session.url } };
  } catch (err) {
    console.error('create-checkout-session failed', err.type || err.name, err.message);
    return { status: 502, body: { error: 'Unable to start checkout right now.' } };
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
  const result = await handleCreateCheckoutSession(req.body, { siteUrl });
  res.status(result.status).json(result.body);
}

handler.handleCreateCheckoutSession = handleCreateCheckoutSession; // exported for tests
module.exports = handler;
