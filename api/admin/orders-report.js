const { listOrdersInRange } = require('../lib/order-log');
const { isAuthorizedAdminRequest, parseDateRange } = require('../lib/admin-auth');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function buildReport(orders) {
  let revenueCents = 0;
  const unitsByProduct = {};
  const revenueByProvider = {};
  const orderIdsByProvider = {};

  for (const order of orders) {
    revenueCents += order.totalCents || 0;
    for (const item of order.items || []) {
      unitsByProduct[item.name] = (unitsByProduct[item.name] || 0) + item.qty;
      revenueByProvider[item.provider] = (revenueByProvider[item.provider] || 0) + item.qty * item.unitPriceCents;
      (orderIdsByProvider[item.provider] = orderIdsByProvider[item.provider] || new Set()).add(order.stripeSessionId);
    }
  }

  const ordersByProvider = Object.fromEntries(
    Object.entries(orderIdsByProvider).map(([provider, ids]) => [provider, ids.size])
  );

  return { orderCount: orders.length, revenueCents, unitsByProduct, revenueByProvider, ordersByProvider };
}

// Simple by design — see docs/reporting.md for the documented upgrade path
// (export these Redis records into Postgres/Supabase) if deeper analytics
// are ever needed.
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

  const { from, to } = parseDateRange(req, Date.now() - THIRTY_DAYS_MS);
  const orders = await listOrdersInRange(from, to);
  const report = buildReport(orders);

  res.status(200).json({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...report });
};
