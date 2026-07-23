const { findOrderByProviderOrderId, getOrderRecord, updateOrderRecord } = require('../lib/order-log');
const alert = require('../lib/alert');

/*
 * UNVERIFIED whether Apliiq will ever call this endpoint. No generic
 * webhook/callback URL registration was found in Apliiq's published docs
 * for custom (non-Shopify/Etsy/WooCommerce-plugin) integrations — every
 * tracking-push doc found describes automatic behavior specific to their
 * Shopify app. Built defensively so it's ready if/when Apliiq support
 * confirms a callback can be registered — ask them directly and update
 * docs/apliiq-setup.md once confirmed.
 *
 * Token-protected via a query param rather than a signed webhook, since no
 * inbound signing scheme is documented either.
 */

function isAuthorized(req) {
  const configuredToken = process.env.APLIIQ_FULFILLMENT_WEBHOOK_TOKEN;
  if (!configuredToken) return false;
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token') === configuredToken;
}

/** Payload shape is unknown/untyped — validate before use, accept a few plausible field name variants. */
function extractPayload(body) {
  if (!body || typeof body !== 'object') return null;

  const orderNumber = body.order_number || body.number || body.external_reference || null;
  const apliiqOrderId = body.id != null ? String(body.id) : body.order_id != null ? String(body.order_id) : null;
  const status = body.status || body.order_status || null;
  const trackingNumber = body.tracking_number || body.tracking || null;
  const carrier = body.carrier || body.shipping_carrier || null;
  const trackingUrl = body.tracking_url || null;

  if (!apliiqOrderId && !orderNumber) return null; // nothing to identify the order by

  return { orderNumber, apliiqOrderId, status, trackingNumber, carrier, trackingUrl };
}

/** externalReference is `${ORDER_REF_PREFIX}-{stripeSessionId}-APLIIQ` — pull the session id back out. */
function sessionIdFromOrderNumber(orderNumber) {
  const parts = orderNumber.split('-');
  if (parts.length < 3) return null;
  return parts.slice(1, -1).join('-');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method not allowed');
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).send('Unauthorized');
    return;
  }

  const payload = extractPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Unrecognized payload shape' });
    return;
  }

  let record = null;
  if (payload.apliiqOrderId) {
    record = await findOrderByProviderOrderId('apliiq', payload.apliiqOrderId);
  }
  if (!record && payload.orderNumber) {
    const sessionId = sessionIdFromOrderNumber(payload.orderNumber);
    if (sessionId) record = await getOrderRecord(sessionId);
  }

  if (!record) {
    console.error('[apliiq-webhook] no matching order found for payload', payload);
    res.status(200).end(); // acknowledge anyway — nothing useful for Apliiq to retry
    return;
  }

  const previousStatus = record.providerStatus && record.providerStatus.apliiq;
  const wasAlreadyShipped = previousStatus === 'Shipped';

  await updateOrderRecord(record.stripeSessionId, {
    providerStatus: { ...(record.providerStatus || {}), apliiq: payload.status || previousStatus },
    tracking: {
      ...(record.tracking || {}),
      apliiq: { trackingNumber: payload.trackingNumber, carrier: payload.carrier, trackingUrl: payload.trackingUrl },
    },
  });

  // Dedup guard so repeated/duplicate webhook delivery doesn't re-notify on every retry.
  if (payload.status === 'Shipped' && !wasAlreadyShipped) {
    await alert.sendNotice(
      `Order shipped: ${record.stripeSessionId}`,
      `Apliiq order ${payload.apliiqOrderId || payload.orderNumber} shipped. ` +
        `Tracking: ${payload.trackingNumber || 'n/a'} (${payload.carrier || 'unknown carrier'}).`
    );
  }

  res.status(200).end();
};
