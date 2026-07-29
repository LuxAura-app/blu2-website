#!/usr/bin/env node
// Flips a draft catalog entry (written by api/apliiq/add-product.js, always
// `active: false`) live. Add to Store no longer creates any Stripe
// Product/Price — this script is now the only place real, chargeable
// Stripe objects get created, and only after a human has picked a price.
//
// Usage:
//   node scripts/activate-product.js <internalProductId> --activate --price=45.00
//
// One flat price is applied across every variant of the product (no
// per-variant pricing — not needed today, keep it simple). For each
// variant that doesn't already have a stripeProductId, this creates a real
// Stripe Product + Price at --price, sets that Price as the Product's
// default price, and stores the resulting IDs on the catalog entry. Then
// the whole entry is set `active: true`.
//
// --price is only required the first time — i.e. whenever at least one
// variant is still missing its Stripe objects (a brand-new product, or a
// new SKU appended to an already-active one by a later Add to Store
// re-send). Re-running against a product where every variant already has a
// stripeProductId recreates nothing; --price can be omitted.
//
// Needs STRIPE_SECRET_KEY and real Redis credentials set — see
// docs/shop-testing.md.

const Stripe = require('stripe');
const { getProduct, upsertProduct } = require('../lib/product-catalog');

function parseArgs(argv) {
  const args = { id: null, activate: false, price: null };
  for (const raw of argv) {
    if (raw === '--activate') {
      args.activate = true;
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

/**
 * One Stripe Product + Price per variant, matching the existing "one
 * sellable SKU = one Stripe Price" convention (docs/stripe-setup.md).
 */
async function createStripeVariant(stripe, product, variant, unitAmount, currency) {
  const label = [variant.color, variant.size].filter(Boolean).join(' / ');
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
    priceCents: unitAmount,
    stripeProductId: stripeProduct.id,
    stripePriceId: stripePrice.id,
  };
}

/**
 * @param {string} internalProductId
 * @param {string|number|null} priceDollars flat price applied to every
 *   variant still missing Stripe objects; required only when at least one
 *   variant needs them
 * @param {Object} [deps] injectable for tests
 */
async function activateProduct(internalProductId, priceDollars, deps = {}) {
  const stripe = deps.stripe || new Stripe(process.env.STRIPE_SECRET_KEY);
  const lookupProduct = deps.getProduct || getProduct;
  const upsert = deps.upsert || upsertProduct;

  const product = await lookupProduct(internalProductId);
  if (!product) {
    throw new Error(`No catalog entry found for "${internalProductId}"`);
  }

  const variants = product.variants || [];
  if (variants.length === 0) {
    throw new Error(`Catalog entry "${internalProductId}" has no variants to activate`);
  }

  const needsCreation = variants.filter((v) => !v.stripeProductId);

  let unitAmount = null;
  if (needsCreation.length > 0) {
    if (priceDollars == null) {
      throw new Error(
        `${needsCreation.length} variant(s) on "${internalProductId}" have no Stripe Product/Price yet ` +
          `(${needsCreation.map((v) => v.sku).join(', ')}) — pass --price=<dollars> to activate them.`
      );
    }
    const parsed = Number(priceDollars);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--price must be a positive number, got "${priceDollars}"`);
    }
    unitAmount = Math.round(parsed * 100);
  }

  const currency = (product.currency || 'usd').toLowerCase();
  const updatedVariants = [];
  let createdCount = 0;

  for (const variant of variants) {
    if (variant.stripeProductId) {
      updatedVariants.push(variant);
      continue;
    }
    updatedVariants.push(await createStripeVariant(stripe, product, variant, unitAmount, currency));
    createdCount += 1;
  }

  await upsert(internalProductId, { variants: updatedVariants, active: true });

  return { internalProductId, createdCount, totalVariants: variants.length };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[activate-product] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!args.id || !args.activate) {
    console.error('Usage: node scripts/activate-product.js <internalProductId> --activate --price=<dollars>');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await activateProduct(args.id, args.price);
    console.log(
      `[activate-product] ${result.internalProductId}: created Stripe Product/Price for ` +
        `${result.createdCount}/${result.totalVariants} variant(s); catalog entry is now active.`
    );
  } catch (err) {
    console.error(`[activate-product] ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { activateProduct, parseArgs };
