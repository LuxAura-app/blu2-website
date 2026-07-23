const providers = new Map();

/** @param {import('./types').FulfillmentProvider} provider */
function registerFulfillmentProvider(provider) {
  providers.set(provider.name, provider);
}

/**
 * @param {import('./types').FulfillmentProviderName} name
 * @returns {import('./types').FulfillmentProvider}
 */
function getFulfillmentProvider(name) {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Fulfillment provider not registered: ${name}`);
  if (!provider.isConfigured()) {
    throw new Error(`Fulfillment provider not configured: ${name}`);
  }
  return provider;
}

module.exports = { registerFulfillmentProvider, getFulfillmentProvider };
