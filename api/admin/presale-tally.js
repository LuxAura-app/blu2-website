const { listOrdersInRange } = require('../../lib/order-log');
const { isAuthorizedAdminRequest, parseDateRange } = require('../../lib/admin-auth');

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(bySize) {
  const rows = Object.entries(bySize).map(([size, qty]) => [size, qty].map(csvEscape).join(','));
  return ['size,qty', ...rows].join('\n');
}

/**
 * Sums ordered quantity by size for one presale (or any grouped product),
 * ignoring every other item in the order. This is a straight per-item sum
 * of what was actually paid for — it does not read the shared inventory
 * pool (`lib/inventory.js`) at all, so it stays correct even if the
 * counter and the order log were ever to drift (e.g. a manual Redis
 * correction after an oversold alert).
 * @param {Array<Object>} orders from listOrdersInRange
 * @param {string} groupId
 */
function buildTally(orders, groupId) {
  const bySize = {};
  let totalUnits = 0;
  const orderIds = new Set();

  for (const order of orders) {
    for (const item of order.items || []) {
      if (item.groupId !== groupId) continue;
      const sizeLabel = item.size ? String(item.size).toUpperCase() : 'UNSPECIFIED';
      bySize[sizeLabel] = (bySize[sizeLabel] || 0) + item.qty;
      totalUnits += item.qty;
      orderIds.add(order.stripeSessionId);
    }
  }

  return { groupId, totalUnits, orderCount: orderIds.size, bySize };
}

// Bearer-token gated, same as the other /api/admin/* endpoints. Handed to
// whichever print shop ends up doing the run once a presale closes — the
// CSV output (size,qty rows) is meant to be pasted straight into a print
// order, not just for internal viewing.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method not allowed');
    return;
  }

  if (!isAuthorizedAdminRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const groupId = url.searchParams.get('groupId');
  if (!groupId) {
    res.status(400).json({ error: 'groupId query param is required' });
    return;
  }

  // Defaults to all-time (unlike orders-report.js's 30-day default) — a
  // presale campaign can easily span longer than 30 days, and silently
  // truncating the tally handed to a print shop would be a real problem,
  // not just a display quirk.
  const { from, to } = parseDateRange(req, 0);
  const orders = await listOrdersInRange(from, to);
  const tally = buildTally(orders, groupId);

  if (url.searchParams.get('format') === 'csv') {
    // groupId is caller-controlled (query param) — slugify before it goes
    // into a response header, matching contacts-export.js's storeSlug
    // pattern, rather than reflecting it raw.
    const groupSlug = groupId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${groupSlug}-tally.csv"`);
    res.status(200).send(toCsv(tally.bySize));
    return;
  }

  res.status(200).json({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...tally });
};

module.exports.buildTally = buildTally; // exported for tests
