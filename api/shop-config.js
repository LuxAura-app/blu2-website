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
    // Full sentence(s), not just a day-range fragment, so wording/structure
    // can change without a code change — just update the env var. Apliiq's
    // own stated production average is ~1 week; the "2-7 business days"
    // transit estimate is a reasonable guess, not from official carrier/
    // Apliiq documentation, so tighten both once real orders give actual
    // observed production + transit times.
    productionTimeCopy:
      process.env.PRODUCTION_TIME_COPY ||
      'Made to order — ships within 1 week. Standard shipping typically takes an additional 2-7 business days to arrive, for a total of about 1-2 weeks.',
    // Falls back to the existing internal order-alert address (see
    // lib/alert.js) so this works with zero extra config — set
    // SUPPORT_EMAIL explicitly once a dedicated public-facing support
    // address exists that's distinct from the internal alert recipient.
    supportEmail: process.env.SUPPORT_EMAIL || process.env.ORDER_NOTIFICATION_EMAIL || null,
    // Presale estimated-ship disclaimer, shown next to price on any
    // isPresale product card — env-driven for the same reason as
    // productionTimeCopy: this is a placeholder until Royal Tees Printing's
    // real quoted turnaround is confirmed, and needs to change without a
    // code deploy once it is.
    presaleShipEstimateCopy: process.env.PRESALE_SHIP_ESTIMATE_COPY || 'Ships in 4-6 weeks',
  });
};
