/**
 * @typedef {'apliiq' | 'printful' | 'self'} FulfillmentProviderName
 *
 * @typedef {Object} FulfillmentAddress
 * @property {string} name
 * @property {string} [company]
 * @property {string} address1
 * @property {string} [address2]
 * @property {string} city
 * @property {string} [stateCode]
 * @property {string} countryCode
 * @property {string} postalCode
 * @property {string} [phone]
 * @property {string} email
 *
 * @typedef {Object} FulfillmentOrderItem
 * @property {string} internalOrderItemId
 * @property {string} providerVariantId
 * @property {string} [sku]
 * @property {string} [name] display/product name, used by provider payloads and notification emails
 * @property {number} quantity
 * @property {number} retailPriceCents
 *
 * @typedef {Object} FulfillmentOrderRequest
 * @property {string} externalReference
 * @property {FulfillmentProviderName} provider
 * @property {FulfillmentAddress} recipient
 * @property {FulfillmentOrderItem[]} items
 *
 * @typedef {Object} FulfillmentOrderResult
 * @property {FulfillmentProviderName} provider
 * @property {string} providerOrderId
 * @property {string} providerStatus
 *
 * @typedef {Object} FulfillmentProvider
 * @property {FulfillmentProviderName} name
 * @property {() => boolean} isConfigured
 * @property {(request: FulfillmentOrderRequest) => Promise<FulfillmentOrderResult>} createOrder
 * @property {(providerOrderId: string) => Promise<FulfillmentOrderResult>} getOrder
 * @property {(raw: string) => string} normalizeStatus
 */

module.exports = {}; // typedefs only, no runtime export needed
