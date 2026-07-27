const { findOrderByProviderOrderId, updateOrderRecord } = require('../../lib/order-log');
const { verifyApliiqHmac } = require('../../lib/fulfillment/apliiq-hmac');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Apliiq's docs point to the same article as Fulfillment for this endpoint
 * without giving a distinct example payload — no confirmed field names
 * exist for it. Built defensively: verify HMAC the same way, try a few
 * plausible id-shaped fields to find the matching order, and store the
 * full raw payload rather than acting on any specific field, until Apliiq
 * support confirms the real shape (see docs/apliiq-webhooks.md).
 */
function extractOrderId(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.order_id,
    body.id,
    body.orderId,
    body.order_number,
    body.fulfillment && body.fulfillment.order_id,
  ];
  for (const candidate of candidates) {
    if (candidate != null) return String(candidate);
  }
  return null;
}

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
    body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const orderId = extractOrderId(body);
  const record = orderId ? await findOrderByProviderOrderId('apliiq', orderId) : null;

  if (!record) {
    // Informational/logged only — no order_id-shaped field found, or no
    // matching order. Not treated as an error since this endpoint's shape
    // isn't confirmed yet.
    console.log('[apliiq/warehouse-shipment-complete] received (no order match)', JSON.stringify(body));
    res.status(200).json({ ok: true });
    return;
  }

  const previous = (record.warehouseShipmentComplete && record.warehouseShipmentComplete.history) || [];
  await updateOrderRecord(record.stripeSessionId, {
    warehouseShipmentComplete: {
      receivedAt: Date.now(),
      history: [...previous, body],
    },
  });

  console.log('[apliiq/warehouse-shipment-complete] recorded on order', record.stripeSessionId);
  res.status(200).json({ ok: true });
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;
