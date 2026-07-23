/**
 * Groups paid line items by provider so each provider gets exactly one
 * order submission per checkout, never mixed.
 * @param {Array<{provider: import('./types').FulfillmentProviderName}>} items
 * @returns {Map<import('./types').FulfillmentProviderName, Array>}
 */
function groupItemsByProvider(items) {
  const groups = new Map();
  for (const item of items) {
    const list = groups.get(item.provider) || [];
    list.push(item);
    groups.set(item.provider, list);
  }
  return groups;
}

module.exports = { groupItemsByProvider };
