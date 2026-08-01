#!/usr/bin/env node
// One-off price change for an already-active catalog product. Stripe Prices
// are immutable, so this can't just edit the existing amount: for each
// variant it creates a new Price under that variant's existing Stripe
// Product, points the Product's default_price at the new Price, archives
// the old Price (active: false — Stripe won't let you delete a Price that's
// ever been attached to a Product), and stores the new priceCents/
// stripePriceId on the catalog record.
//
// Differs from scripts/activate-product.js (only creates Stripe objects for
// variants that don't have any yet) and scripts/relink-stripe-live.js
// (recreates the whole Stripe Product, for moving test -> live mode): this
// keeps the existing Stripe Product and just swaps which Price is current,
// so a Checkout Session already open against the old Price still completes
// normally.
//
// Usage:
//   node scripts/reprice-product.js <internalProductId> --price=45.00
//   node scripts/reprice-product.js <internalProductId> --price=45.00 --dry-run
//
// Needs STRIPE_SECRET_KEY and real Redis credentials set.

const Stripe = require('stripe');
const { getProduct, upsertProduct } = require('../lib/product-catalog');

function parseArgs(argv) {
  const args = { id: null, price: null, dryRun: false };
  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
    } else if (raw.startsWith('--price=')) {
      args.price = raw.slice('--price='.length);
    } else if (raw.startsWith('--')) {
      throw new Error(`Unrecognized flag: ${raw}`);
    } else if (!args.id) {
      args.id = raw;
    } else {
      throw new Error(`Unexpected argument: ${raw}`);
    }
  }
  return args;
}

async function repriceVariant(stripe, variant, unitAmount, currency, dryRun) {
  if (!variant.stripeProductId) {
    throw new Error(`Variant ${variant.sku} has no stripeProductId yet — run activate-product.js first.`);
  }

  const oldPriceId = variant.stripePriceId || null;

  if (dryRun) {
    return { ...variant, priceCents: unitAmount, stripePriceId: '(dry-run)' };
  }

  const stripePrice = await stripe.prices.create({
    product: variant.stripeProductId,
    currency,
    unit_amount: unitAmount,
  });

  await stripe.products.update(variant.stripeProductId, { default_price: stripePrice.id });

  if (oldPriceId) {
    await stripe.prices.update(oldPriceId, { active: false });
  }

  return { ...variant, priceCents: unitAmount, stripePriceId: stripePrice.id };
}

/**
 * @param {string} internalProductId
 * @param {string|number} priceDollars flat price applied to every variant
 * @param {Object} [deps] injectable for tests
 */
async function repriceProduct(internalProductId, priceDollars, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const lookupProduct = deps.getProduct || getProduct;
  const upsert = deps.upsert || upsertProduct;
  const dryRun = Boolean(deps.dryRun);

  const product = await lookupProduct(internalProductId);
  if (!product) {
    throw new Error(`No catalog entry found for "${internalProductId}"`);
  }

  const variants = product.variants || [];
  if (variants.length === 0) {
    throw new Error(`Catalog entry "${internalProductId}" has no variants to reprice`);
  }

  const parsed = Number(priceDollars);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--price must be a positive number, got "${priceDollars}"`);
  }
  const unitAmount = Math.round(parsed * 100);
  const currency = (product.currency || 'usd').toLowerCase();

  const mapping = [];
  const repriced = [];
  for (const variant of variants) {
    const oldPriceId = variant.stripePriceId || null;
    const updated = await repriceVariant(stripe, variant, unitAmount, currency, dryRun);
    repriced.push(updated);
    mapping.push({ sku: variant.sku, oldPriceId, newPriceId: updated.stripePriceId, unitAmount });
  }

  if (!dryRun) {
    await upsert(internalProductId, { variants: repriced });
  }

  return { internalProductId, mapping };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[reprice-product] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!args.id || !args.price) {
    console.error('Usage: node scripts/reprice-product.js <internalProductId> --price=<dollars> [--dry-run]');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await repriceProduct(args.id, args.price, { dryRun: args.dryRun });
    console.log(`[reprice-product] ${result.internalProductId}:`);
    for (const m of result.mapping) {
      console.log(`  ${m.sku}: ${m.oldPriceId || '(none)'} -> ${m.newPriceId} ($${(m.unitAmount / 100).toFixed(2)})`);
    }
  } catch (err) {
    console.error(`[reprice-product] ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { repriceProduct, parseArgs };
