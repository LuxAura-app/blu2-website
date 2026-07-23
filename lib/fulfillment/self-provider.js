const { Resend } = require('resend');
const { resolveFromAddress } = require('../alert');

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_NOTIFICATION_EMAIL);
}

function renderItemLines(items) {
  return items
    .map((item) => `  - ${item.quantity} x ${item.name || item.sku || item.providerVariantId} ($${(item.retailPriceCents / 100).toFixed(2)})`)
    .join('\n');
}

function renderAddress(recipient) {
  const lines = [
    recipient.name,
    recipient.company,
    recipient.address1,
    recipient.address2,
    `${recipient.city}, ${recipient.stateCode || ''} ${recipient.postalCode}`.trim(),
    recipient.countryCode,
    recipient.phone,
    recipient.email,
  ].filter(Boolean);
  return lines.join('\n  ');
}

/**
 * @param {import('./types').FulfillmentOrderRequest} request
 * @returns {Promise<import('./types').FulfillmentOrderResult>}
 */
async function createOrder(request) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: resolveFromAddress('Orders'),
    to: process.env.ORDER_NOTIFICATION_EMAIL,
    subject: `New self-fulfilled order — ${request.externalReference}`,
    text: [
      `Order reference: ${request.externalReference}`,
      '',
      'Items:',
      renderItemLines(request.items),
      '',
      'Ship to:',
      `  ${renderAddress(request.recipient)}`,
    ].join('\n'),
  });

  return {
    provider: 'self',
    providerOrderId: request.externalReference,
    providerStatus: 'notified',
  };
}

async function getOrder() {
  throw new Error('self fulfillment has no remote order status to fetch — notification email is the only record.');
}

function normalizeStatus(raw) {
  return raw;
}

module.exports = {
  name: 'self',
  isConfigured,
  createOrder,
  getOrder,
  normalizeStatus,
};
