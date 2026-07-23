const apliiqClient = require('./apliiq-client');

function isConfigured() {
  return Boolean(process.env.APLIIQ_APP_ID && process.env.APLIIQ_SHARED_SECRET && process.env.APLIIQ_STORE_ID);
}

/**
 * Best-effort first/last name split — our internal FulfillmentAddress only
 * carries a single `name` field, but Apliiq's shipping_address wants
 * first_name/last_name separately. Documented limitation, not exact for
 * multi-word surnames/single-word names.
 */
function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/**
 * Maps our FulfillmentOrderRequest to Apliiq's Create Order payload, per
 * the verified schema (help.apliiq.com/portal/en/kb/articles/create-order).
 * `province`/`country` (full names) are approximated with our stored
 * code/abbreviation, since FulfillmentAddress only tracks stateCode/
 * countryCode — province_code/country_code (the fields Apliiq documents as
 * required for US shipments) are correct.
 */
function buildApliiqOrderPayload(request) {
  const { firstName, lastName } = splitName(request.recipient.name);

  return {
    id: request.externalReference,
    number: request.externalReference,
    name: `Order ${request.externalReference}`,
    order_number: request.externalReference,
    line_items: request.items.map((item) => ({
      id: item.internalOrderItemId,
      title: item.name || item.sku || item.providerVariantId,
      quantity: item.quantity,
      price: Number((item.retailPriceCents / 100).toFixed(2)),
      sku: item.sku || item.providerVariantId,
    })),
    shipping_address: {
      first_name: firstName,
      last_name: lastName,
      address1: request.recipient.address1,
      city: request.recipient.city,
      zip: request.recipient.postalCode,
      province: request.recipient.stateCode || '',
      province_code: request.recipient.stateCode || '',
      country: request.recipient.countryCode,
      country_code: request.recipient.countryCode,
    },
  };
}

/**
 * @param {import('./types').FulfillmentOrderRequest} request
 * @returns {Promise<import('./types').FulfillmentOrderResult>}
 */
async function createOrder(request) {
  const payload = buildApliiqOrderPayload(request);
  const response = await apliiqClient.createOrder(payload);
  return {
    provider: 'apliiq',
    providerOrderId: String(response.id),
    providerStatus: 'New',
  };
}

/**
 * UNVERIFIED — see apliiq-client.js's getOrder for why. Wrapped so a
 * failure here reads as "Apliiq order status unavailable" rather than a
 * confusing raw HTTP error, until this endpoint is confirmed.
 * @param {string} providerOrderId
 */
async function getOrder(providerOrderId) {
  const response = await apliiqClient.getOrder(providerOrderId);
  return {
    provider: 'apliiq',
    providerOrderId,
    providerStatus: normalizeStatus(response && response.status),
  };
}

const KNOWN_STATUSES = [
  'New',
  'Preparing To Release',
  'Ready To Release',
  'In Production',
  'On Hold',
  'Payment Pending',
  'Ready To Ship',
  'Shipped',
];

/** Passes through Apliiq's documented status strings; unrecognized values are kept as-is rather than dropped. */
function normalizeStatus(raw) {
  if (!raw) return 'Unknown';
  const match = KNOWN_STATUSES.find((s) => s.toLowerCase() === String(raw).toLowerCase());
  return match || raw;
}

module.exports = {
  name: 'apliiq',
  isConfigured,
  createOrder,
  getOrder,
  normalizeStatus,
  buildApliiqOrderPayload, // exported for tests
};
