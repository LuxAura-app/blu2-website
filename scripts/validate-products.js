#!/usr/bin/env node
// Reads the Redis product catalog and, per §11 of the fulfillment spec,
// prints every activation problem it finds rather than stopping at the
// first. Run manually or in CI: `node scripts/validate-products.js`
// (set STRIPE_SECRET_KEY to also validate priceId against live Stripe;
// requires real Redis credentials to be set — see lib/redis.js).
const Stripe = require('stripe');
const { listAllProducts, flattenProductToCards } = require('../lib/product-catalog');

const VALID_PROVIDERS = ['apliiq', 'printful', 'self'];

function isPlaceholder(value) {
  return !value || /^REPLACE_WITH_/.test(value);
}

function providerConfigured(provider) {
  if (provider === 'apliiq') {
    return Boolean(process.env.APLIIQ_APP_ID && process.env.APLIIQ_SHARED_SECRET && process.env.APLIIQ_STORE_ID);
  }
  if (provider === 'printful') {
    return Boolean(process.env.PRINTFUL_API_KEY);
  }
  if (provider === 'self') {
    return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_NOTIFICATION_EMAIL);
  }
  return false;
}

async function validateCard(card, stripe) {
  const problems = [];
  // Draft/inactive cards (active: false) are expected to be incomplete per
  // §6 — only flag them as blocking once someone actually flips active: true.
  const severity = card.active ? 'ERROR' : 'INFO';

  if (!VALID_PROVIDERS.includes(card.fulfillmentProvider)) {
    problems.push(`unsupported fulfillmentProvider "${card.fulfillmentProvider}"`);
  } else if (!providerConfigured(card.fulfillmentProvider)) {
    problems.push(`fulfillmentProvider "${card.fulfillmentProvider}" is not configured (missing env vars)`);
  }

  if (['apliiq', 'printful'].includes(card.fulfillmentProvider) && isPlaceholder(card.providerVariantId)) {
    problems.push('providerVariantId is missing or still a REPLACE_WITH_ placeholder');
  }

  if (isPlaceholder(card.priceId)) {
    problems.push('priceId is missing or still a REPLACE_WITH_ placeholder (no Stripe Price created yet)');
  } else if (stripe) {
    try {
      const price = await stripe.prices.retrieve(card.priceId);
      if (!price.active) problems.push(`Stripe price ${card.priceId} exists but is not active`);
    } catch (err) {
      problems.push(`Stripe price ${card.priceId} could not be retrieved: ${err.message}`);
    }
  }

  if (!card.image) {
    problems.push('no product image set');
  }

  return problems.map((problem) => ({ id: card.id, severity, problem }));
}

async function main() {
  const products = await listAllProducts();
  const cards = products.flatMap((p) => flattenProductToCards(p));

  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  if (!stripe) {
    console.warn('STRIPE_SECRET_KEY not set — skipping live Stripe price checks.\n');
  }

  // Dead config check: SHOP_APLIIQ_ADDITIONAL_ITEM_CENTS (a flat per-extra-
  // item shipping surcharge) was removed when api/create-checkout-session.js
  // switched to real weight-tiered shipping (SHOP_APLIIQ_FLAT_SHIPPING_CENTS /
  // SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS) — it's no longer read anywhere.
  // Warn rather than silently ignore it, so a still-configured value in
  // Vercel doesn't sit there looking load-bearing when it isn't.
  if (process.env.SHOP_APLIIQ_ADDITIONAL_ITEM_CENTS) {
    console.warn(
      'SHOP_APLIIQ_ADDITIONAL_ITEM_CENTS is set but unused — api/create-checkout-session.js ' +
        'now calculates shipping by weight tier (SHOP_APLIIQ_FLAT_SHIPPING_CENTS / ' +
        'SHOP_APLIIQ_UPGRADED_SHIPPING_CENTS) instead of a flat per-extra-item surcharge. ' +
        'Safe to remove this env var from Vercel.\n'
    );
  }

  if (cards.length === 0) {
    console.log('Catalog is empty — nothing to validate yet.');
    return;
  }

  const allIssues = [];
  for (const card of cards) {
    allIssues.push(...(await validateCard(card, stripe)));
  }

  if (allIssues.length === 0) {
    console.log(`All ${cards.length} catalog entries passed validation.`);
    return;
  }

  for (const issue of allIssues) {
    console.log(`[${issue.severity}] ${issue.id}: ${issue.problem}`);
  }

  const errorCount = allIssues.filter((i) => i.severity === 'ERROR').length;
  console.log(`\n${allIssues.length} issue(s) found (${errorCount} blocking).`);
  if (errorCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
