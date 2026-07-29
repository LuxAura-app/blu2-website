const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    badRequest(res, 'items must be a non-empty array of { priceId, qty }');
    return;
  }
  for (const item of items) {
    if (!item || typeof item.priceId !== 'string' || !Number.isInteger(item.qty) || item.qty < 1) {
      badRequest(res, 'Each item needs a string priceId and a positive integer qty');
      return;
    }
  }

  // Look up every price server-side — never trust a price/amount sent by the client.
  let subtotalCents = 0;
  let totalQty = 0;
  const lineItems = [];
  for (const item of items) {
    let price;
    try {
      price = await stripe.prices.retrieve(item.priceId);
    } catch (err) {
      badRequest(res, `Unknown price: ${item.priceId}`);
      return;
    }
    if (!price.active || price.unit_amount == null) {
      badRequest(res, `Price is not purchasable: ${item.priceId}`);
      return;
    }
    subtotalCents += price.unit_amount * item.qty;
    totalQty += item.qty;
    lineItems.push({ price: item.priceId, quantity: item.qty });
  }

  const flatShippingCents = Number(process.env.SHOP_APLIIQ_FLAT_SHIPPING_CENTS || 0);
  const additionalItemCents = Number(process.env.SHOP_APLIIQ_ADDITIONAL_ITEM_CENTS || 0);
  const freeShippingThresholdCents = process.env.SHOP_FREE_SHIPPING_THRESHOLD_CENTS
    ? Number(process.env.SHOP_FREE_SHIPPING_THRESHOLD_CENTS)
    : null;

  const qualifiesForFreeShipping = freeShippingThresholdCents != null && subtotalCents >= freeShippingThresholdCents;
  const shippingCents = qualifiesForFreeShipping
    ? 0
    : flatShippingCents + additionalItemCents * Math.max(0, totalQty - 1);

  const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;

  try {
    // Deliberately not enabling Stripe Tax (automatic_tax: { enabled: true })
    // — standard clothing is exempt from PA sales tax, and out-of-state
    // economic nexus thresholds aren't a near-term concern at current
    // volume. Revisit this if either changes: (1) non-clothing merch gets
    // added (exemption no longer applies), or (2) sales grow enough
    // multi-state to approach a state's economic nexus threshold. Until
    // then, this is an intentional decision, not an oversight to "fix".
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
            display_name: qualifiesForFreeShipping ? 'Free shipping' : 'Standard shipping',
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
          message:
            'Yes, send me occasional updates about new drops and shows (email and text). Msg & data rates may apply. Reply STOP to opt out any time.',
        },
      },
      success_url: `${siteUrl}/shop.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/shop.html?checkout=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session failed', err.type || err.name, err.message);
    res.status(502).json({ error: 'Unable to start checkout right now.' });
  }
};
