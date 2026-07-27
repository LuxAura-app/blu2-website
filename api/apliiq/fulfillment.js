const { findOrderByProviderOrderId, updateOrderRecord } = require('../../lib/order-log');
const { verifyApliiqHmac } = require('../../lib/fulfillment/apliiq-hmac');
const alert = require('../../lib/alert');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Documented payload (help.apliiq.com — Fulfillment):
 * {
 *   "fulfillment": {
 *     "order_id": "1569438492",
 *     "status": "success",
 *     "tracking_company": "USPS",
 *     "tracking_numbers": ["9400111699000516881728"],
 *     "tracking_urls": [],
 *     "line_items": [{ "id": "...", "quantity": 1, "sku": "APQ-...", "name": "..." }]
 *   }
 * }
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method not allowed');
    return;
  }

  const rawBody = await readRawBody(req);

  if (!verifyApliiqHmac(rawBody, req.headers['x-apliiq-hmac'], process.env.APLIIQ_SHARED_SECRET)) {
    res.status(401).send('Unauthorized');
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const fulfillment = body && body.fulfillment;
  if (!fulfillment || fulfillment.order_id == null) {
    res.status(400).json({ error: 'Missing fulfillment.order_id' });
    return;
  }

  const orderId = String(fulfillment.order_id);
  const record = await findOrderByProviderOrderId('apliiq', orderId);

  if (!record) {
    console.error('[apliiq/fulfillment] no matching order found for order_id', orderId);
    res.status(200).json({ ok: true });
    return;
  }

  const previousTracking = (record.tracking && record.tracking.apliiq) || {};
  const trackingNumbers = fulfillment.tracking_numbers || [];
  // Dedup guard: only alert the first time tracking numbers show up for
  // this order, so duplicate/retried delivery doesn't re-notify.
  const alreadyNotified = Array.isArray(previousTracking.trackingNumbers) && previousTracking.trackingNumbers.length > 0;

  await updateOrderRecord(record.stripeSessionId, {
    providerStatus: {
      ...(record.providerStatus || {}),
      apliiq: fulfillment.status || (record.providerStatus && record.providerStatus.apliiq),
    },
    tracking: {
      ...(record.tracking || {}),
      apliiq: {
        trackingNumbers,
        trackingCompany: fulfillment.tracking_company || null,
        trackingUrls: fulfillment.tracking_urls || [],
      },
    },
  });

  if (trackingNumbers.length > 0 && !alreadyNotified) {
    await alert.sendNotice(
      `Order shipped: ${record.stripeSessionId}`,
      `Apliiq order ${orderId} fulfillment recorded. Tracking: ${trackingNumbers.join(', ')} ` +
        `(${fulfillment.tracking_company || 'unknown carrier'}).`
    );
  }

  res.status(200).json({ ok: true });
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;
