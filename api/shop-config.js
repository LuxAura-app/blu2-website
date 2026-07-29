// Public, unauthenticated — read-only display config for shop.html, kept
// separate from api/products.js so that endpoint's response stays a plain
// array of cards. Nothing here touches Stripe/Redis/Apliiq; it just lets a
// few pieces of customer-facing copy be tuned via env var (and redeployed)
// instead of hardcoded in shop.html.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method not allowed');
    return;
  }

  res.status(200).json({
    // Apliiq's own stated average is ~1 week; "5-7 business days" is a
    // conservative placeholder default, not a confirmed SLA — set
    // PRODUCTION_TIME_DAYS once real fulfillment timing data comes in
    // from actual orders and adjust this default (or just always set the
    // env var) accordingly.
    productionTimeDays: process.env.PRODUCTION_TIME_DAYS || '5-7 business days',
    // Falls back to the existing internal order-alert address (see
    // lib/alert.js) so this works with zero extra config — set
    // SUPPORT_EMAIL explicitly once a dedicated public-facing support
    // address exists that's distinct from the internal alert recipient.
    supportEmail: process.env.SUPPORT_EMAIL || process.env.ORDER_NOTIFICATION_EMAIL || null,
  });
};
