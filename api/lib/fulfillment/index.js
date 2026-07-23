// Registers every implemented fulfillment provider. Requiring this module
// (rather than registry.js directly) guarantees registration has happened
// before getFulfillmentProvider() is called anywhere.
const registry = require('./registry');
const selfProvider = require('./self-provider');

registry.registerFulfillmentProvider(selfProvider);

// apliiq-provider / printful-provider are registered here once they land.

module.exports = registry;
