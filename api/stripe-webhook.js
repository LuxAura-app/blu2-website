const Stripe = require('stripe');
const { claimEvent, completeEvent } = require('../lib/idempotency');
const { writeOrderRecord, updateOrderRecord } = require('../lib/order-log');
const { decrementInventory } = require('../lib/inventory');
const { groupItemsByProvider } = require('../lib/fulfillment/grouping');
const { getFulfillmentProvider } = require('../lib/fulfillment');
const alert = require('../lib/alert');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const MARKETING_CONSENT_FIELD_KEY = 'marketing_consent';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildRecipientAddress(session) {
  const shipping = session.shipping_details || {};
  const address = shipping.address || {};
  const customer = session.customer_details || {};
  return {
    name: shipping.name || customer.name || '',
    address1: address.line1 || '',
    address2: address.line2 || undefined,
    city: address.city || '',
    stateCode: address.state || undefined,
    countryCode: address.country || '',
    postalCode: address.postal_code || '',
    phone: customer.phone || undefined,
    email: customer.email || '',
  };
}

function readMarketingConsent(session) {
  const field = (session.custom_fields || []).find((f) => f.key === MARKETING_CONSENT_FIELD_KEY);
  return Boolean(field && field.dropdown && field.dropdown.value === 'yes');
}

function buildFulfillmentItems(lineItems) {
  return (lineItems ? lineItems.data : []).map((li) => {
    const product = li.price.product;
    const metadata = (product && typeof product === 'object' && product.metadata) || {};
    const sku = metadata.sku || metadata.provider_variant_id || (product && product.id) || li.id;
    return {
      internalOrderItemId: li.id,
      provider: metadata.fulfillment_provider || 'self',
      providerVariantId: metadata.provider_variant_id || null,
      sku,
      // Which inventory:{key} counter to decrement — defaults to this
      // item's own SKU (today's behavior for every single-SKU product),
      // but scripts/activate-product.js sets metadata.inventory_key
      // explicitly when a variant pools stock with siblings under a
      // shared key instead (e.g. the presale tee's 5 sizes all sharing
      // one RT-BLU2-PRESALE counter). See docs/shop-architecture.md.
      inventoryKey: metadata.inventory_key || sku,
      groupId: metadata.internal_product_id || null,
      size: metadata.size || null,
      name: (product && product.name) || li.description || 'Item',
      quantity: li.quantity,
      retailPriceCents: li.price.unit_amount,
    };
  });
}

/**
 * Submits one provider's group of items and never lets a failure here
 * affect any other group (§12 failure isolation) — caught, logged with a
 * greppable prefix, and alerted, but the loop in the handler keeps going.
 */
async function submitProviderGroup(providerName, items, session, externalReferencePrefix) {
  const externalReference = `${externalReferencePrefix}-${providerName.toUpperCase()}`;
  const recipient = buildRecipientAddress(session);

  try {
    const provider = getFulfillmentProvider(providerName);
    const result = await provider.createOrder({
      externalReference,
      provider: providerName,
      recipient,
      items: items.map((item) => ({
        internalOrderItemId: item.internalOrderItemId,
        providerVariantId: item.providerVariantId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        retailPriceCents: item.retailPriceCents,
      })),
    });

    if (providerName === 'self') {
      for (const item of items) {
        // Decrements the shared pool key (item.inventoryKey), not
        // necessarily this item's own SKU — a presale order for size L and
        // one for size XXL both resolve to the same key and draw from the
        // same counter, per the campaign's shared 50-unit cap.
        await decrementInventory(item.inventoryKey, item.quantity);
      }
    }

    return { providerName, ok: true, result };
  } catch (err) {
    console.error(`[stripe-webhook] fulfillment group failed provider=${providerName} order=${session.id}`, err);
    await alert.sendAlert(
      `Fulfillment submission failed: ${providerName}`,
      `Order ${session.id} (${externalReference}) failed to submit to ${providerName}: ${err.message}\n\n` +
        'This group needs manual follow-up. Other provider groups in this order, if any, were not affected.'
    );
    return { providerName, ok: false, error: err.message };
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method not allowed');
    return;
  }

  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed', err.message);
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  if (event.type !== 'checkout.session.completed') {
    res.status(200).end();
    return;
  }

  let claim;
  try {
    claim = await claimEvent(event.id);
  } catch (err) {
    // Fail closed: can't confirm this is the first attempt, so let Stripe retry later
    // rather than risk a duplicate physical order.
    console.error('[stripe-webhook] idempotency claim failed (Redis error) — failing closed', err);
    res.status(503).send('Temporarily unavailable');
    return;
  }

  if (!claim.claimed) {
    // Another attempt already owns this event.
    res.status(200).end();
    return;
  }

  const sessionSummary = event.data.object;
  if (sessionSummary.payment_status !== 'paid') {
    res.status(200).end();
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionSummary.id, {
    expand: ['line_items.data.price.product'],
  });

  const items = buildFulfillmentItems(session.line_items);
  const groups = groupItemsByProvider(items);

  const orderRefPrefix = process.env.ORDER_REF_PREFIX || 'ORDER';
  const externalReferencePrefix = `${orderRefPrefix}-${session.id}`;
  const customerDetails = session.customer_details || {};

  await writeOrderRecord({
    stripeSessionId: session.id,
    name: customerDetails.name || '',
    email: customerDetails.email || '',
    phone: customerDetails.phone || '',
    marketingConsent: readMarketingConsent(session),
    // sku/groupId/size are additive on top of the original shape (older
    // stored records simply won't have them) — groupId/size are what
    // api/admin/presale-tally.js sums by, once a presale campaign closes.
    items: items.map((i) => ({
      name: i.name,
      qty: i.quantity,
      unitPriceCents: i.retailPriceCents,
      provider: i.provider,
      sku: i.sku,
      groupId: i.groupId,
      size: i.size,
    })),
    totalCents: session.amount_total,
    currency: session.currency,
  });

  const results = [];
  for (const [providerName, groupItems] of groups.entries()) {
    results.push(await submitProviderGroup(providerName, groupItems, session, externalReferencePrefix));
  }

  const providerOrderIds = {};
  for (const r of results) {
    if (r.ok) providerOrderIds[r.providerName] = r.result.providerOrderId;
  }
  if (Object.keys(providerOrderIds).length > 0) {
    await updateOrderRecord(session.id, { providerOrderIds });
  }

  const completed = await completeEvent(event.id);
  if (!completed) {
    await alert.sendAlert(
      'Idempotency completion write failed',
      `Order ${session.id} (event ${event.id}) processed successfully but the Redis "completed" ` +
        'write failed. Manually verify Redis state to avoid a duplicate submission on a Stripe retry.'
    );
  }

  res.status(200).end();
}

handler.config = { api: { bodyParser: false } };
handler.buildFulfillmentItems = buildFulfillmentItems; // exported for tests
module.exports = handler;
