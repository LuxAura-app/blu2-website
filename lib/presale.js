/**
 * Pure derivation of a presale's public status from its catalog config and
 * current inventory count — no Redis/Stripe access here, so it's cheap to
 * unit test and safe to call from both `api/products.js` (display) and
 * `api/create-checkout-session.js` (server-side enforcement), keeping the
 * two in permanent agreement instead of duplicating the "closed" logic.
 *
 * @param {Object} params
 * @param {number} params.capUnits total presale-unit hard cap (e.g. 50)
 * @param {number|null} params.remaining raw `lib/inventory.js` counter value
 *   for the SKU — `null` when the counter hasn't been initialized yet
 *   (treated as "full stock remaining", i.e. `capUnits`)
 * @param {string|null} params.endsAtIso ISO timestamp the presale closes at
 * @param {Date} [params.now] injectable for tests
 * @returns {{ remaining: number, claimed: number, isPresaleClosed: boolean }}
 */
function computePresaleStatus({ capUnits, remaining, endsAtIso, now = new Date() }) {
  const effectiveRemaining = remaining == null ? capUnits : remaining;
  const claimed = capUnits - effectiveRemaining;
  const isPastDeadline = Boolean(endsAtIso) && now.getTime() > new Date(endsAtIso).getTime();
  const isPresaleClosed = effectiveRemaining <= 0 || isPastDeadline;

  return { remaining: effectiveRemaining, claimed, isPresaleClosed };
}

module.exports = { computePresaleStatus };
