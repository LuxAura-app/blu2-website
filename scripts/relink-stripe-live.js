#!/usr/bin/env node
// One-time fixup for switching a project's Stripe account from test mode to
// live mode. Test-mode and live-mode Products/Prices are entirely separate
// objects in Stripe — flipping STRIPE_SECRET_KEY from sk_test_... to
// sk_live_... does NOT migrate them, and the Redis catalog
// (lib/product-catalog.js) keeps holding the old test-mode
// stripeProductId/stripePriceId on every variant. Checkout then calls
// stripe.prices.retrieve() with the live key against a price ID that only
// ever existed in test mode, which fails with "No such price" —
// api/create-checkout-session.js surfaces that as "Unknown price: <id>".
//
// This script re-creates a real Stripe Product + Price (live, since it uses
// whatever STRIPE_SECRET_KEY is currently set) for every variant of every
// targeted catalog entry, at that variant's existing stored `priceCents`
// (no re-entering a price), and overwrites stripeProductId/stripePriceId on
// the catalog record. Unlike scripts/activate-product.js, this always
// recreates — that's the point here — so only run it when you actually mean
// to repoint at a new Stripe mode/account.
//
// Usage:
//   node scripts/relink-stripe-live.js                  # every product in the catalog
//   node scripts/relink-stripe-live.js apliiq-5989067    # just one
//   node scripts/relink-stripe-live.js --dry-run         # preview, no writes
//
// Needs STRIPE_SECRET_KEY (the new live key) and real Redis credentials set.
// The old test-mode Stripe Products/Prices are left alone in test mode —
// harmless, just orphaned there.

const Stripe = require('stripe');
const { listAllProducts, getProduct, upsertProduct } = require('../lib/product-catalog');

function parseArgs(argv) {
  const args = { id: null, dryRun: false };
  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
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

/** Mirrors scripts/activate-product.js's createStripeVariant, minus the flat-price input. */
async function relinkVariant(stripe, product, variant, currency, dryRun) {
  const label = [variant.color, variant.size].filter(Boolean).join(' / ');
  const unitAmount = variant.priceCents;

  if (!Number.isInteger(unitAmount) || unitAmount <= 0) {
    throw new Error(
      `Variant ${variant.sku} on "${product.internalProductId}" has no valid stored priceCents ` +
        `(${variant.priceCents}) — can't relink without an amount to charge.`
    );
  }

  if (dryRun) {
    return { ...variant, stripeProductId: '(dry-run)', stripePriceId: '(dry-run)' };
  }

  const stripeProduct = await stripe.products.create({
    name: label ? `${product.name} — ${label}` : product.name,
    metadata: {
      fulfillment_provider: product.provider || 'apliiq',
      provider_variant_id: variant.sku,
    },
  });

  const stripePrice = await stripe.prices.create({
    product: stripeProduct.id,
    currency,
    unit_amount: unitAmount,
  });

  await stripe.products.update(stripeProduct.id, { default_price: stripePrice.id });

  return {
    ...variant,
    stripeProductId: stripeProduct.id,
    stripePriceId: stripePrice.id,
  };
}

/**
 * @param {Object} product a catalog record (from lib/product-catalog.js)
 * @param {Object} [deps] injectable for tests
 */
async function relinkProduct(product, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const upsert = deps.upsert || upsertProduct;
  const dryRun = Boolean(deps.dryRun);

  const variants = product.variants || [];
  const currency = (product.currency || 'usd').toLowerCase();

  const relinked = [];
  const mapping = [];
  for (const variant of variants) {
    const oldPriceId = variant.stripePriceId || null;
    const updated = await relinkVariant(stripe, product, variant, currency, dryRun);
    relinked.push(updated);
    mapping.push({ sku: variant.sku, oldPriceId, newPriceId: updated.stripePriceId });
  }

  if (!dryRun) {
    await upsert(product.internalProductId, { variants: relinked });
  }

  return { internalProductId: product.internalProductId, mapping };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[relink-stripe-live] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const products = args.id ? [await getProduct(args.id)] : await listAllProducts();
  const targets = products.filter(Boolean);

  if (targets.length === 0) {
    console.error(args.id ? `No catalog entry found for "${args.id}"` : 'Catalog is empty — nothing to relink.');
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log('[relink-stripe-live] --dry-run: no Stripe objects will be created, no Redis writes.\n');
  }

  for (const product of targets) {
    try {
      const result = await relinkProduct(product, { dryRun: args.dryRun });
      console.log(`[relink-stripe-live] ${result.internalProductId}:`);
      for (const m of result.mapping) {
        console.log(`  ${m.sku}: ${m.oldPriceId || '(none)'} -> ${m.newPriceId}`);
      }
    } catch (err) {
      console.error(`[relink-stripe-live] ${product.internalProductId} failed: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { relinkProduct, parseArgs };
