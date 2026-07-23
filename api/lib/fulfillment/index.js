// Registers every implemented fulfillment provider. Requiring this module
// (rather than registry.js directly) guarantees registration has happened
// before getFulfillmentProvider() is called anywhere.
const registry = require('./registry');
const selfProvider = require('./self-provider');
const apliiqProvider = require('./apliiq-provider');

registry.registerFulfillmentProvider(selfProvider);
registry.registerFulfillmentProvider(apliiqProvider);

// printful-provider is registered here once it lands.

module.exports = registry;
