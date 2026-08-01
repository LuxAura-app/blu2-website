#!/usr/bin/env node
// One-off launch script for the Royal Tees Printing presale tee — the
// first `self`-fulfilled, non-Apliiq product in the catalog. Apliiq
// products get their draft catalog entry written by the Add to Store
// webhook (api/apliiq/add-product.js); a `self` product has no equivalent
// inbound source, so this script is that entry point instead: it writes
// the draft catalog record, seeds its shared inventory counter to the
// hard cap, then calls the same scripts/activate-product.js
// `activateProduct()` used for every other product to create the real
// Stripe Products/Prices and flip it live.
//
// Five size variants (S/M/L/XL/XXL), same as the flagship Apliiq tee, but
// unlike Apliiq's per-size pools this is ONE shared 50-unit cap across all
// five — every size decrements the same `inventory:{RT-BLU2-PRESALE}`
// counter (see the `inventoryKey` field below, and
// docs/shop-architecture.md's "Presale campaigns" section). An earlier
// build of this script shipped a single flat SKU with no sizing at all —
// that was built from a stale version of the spec; this replaces it.
//
// Run once to launch the campaign:
//   node scripts/create-blu2-presale-tee.js
//
// Safe to re-run: upsertProduct merge-writes (won't reset `active` once
// true), buildVariants() below carries over any already-created
// stripeProductId/stripePriceId for a size whose SKU still matches (so
// activateProduct() skips recreating it), and setInventory only runs when
// the shared counter is still unset — a restock or partial sell-through is
// never clobbered. A size SKU from a prior mismatched run (e.g. the old
// single-SKU build) is simply dropped, not carried over, since it no
// longer matches this product's variant shape.
//
// Needs STRIPE_SECRET_KEY and real Redis credentials — see
// docs/shop-testing.md. PRESALE_PRICE_CENTS defaults to 4000 ($40.00);
// PRESALE_ENDS_AT/PRESALE_GOAL/PRESALE_CAP_UNITS default to this
// campaign's real parameters but can be overridden for a future presale
// reusing this script as a template.

const { getProduct, upsertProduct } = require('../lib/product-catalog');
const { getInventory, setInventory } = require('../lib/inventory');
const { activateProduct } = require('./activate-product');

const INTERNAL_PRODUCT_ID = 'self-blu2-presale-tee';

// The shared inventory pool key — every size variant's SKU is derived from
// this same prefix, but they all point their `inventoryKey` back at this
// one constant, not their own SKU.
const SHARED_INVENTORY_KEY = 'RT-BLU2-PRESALE';
const SIZES = ['s', 'm', 'l', 'xl', 'xxl'];

const PRESALE_ENDS_AT = process.env.PRESALE_ENDS_AT || '2026-08-31T23:59:59-04:00';
const PRESALE_GOAL = Number(process.env.PRESALE_GOAL || 25);
const PRESALE_CAP_UNITS = Number(process.env.PRESALE_CAP_UNITS || 50);
// NOT hardcoded per the campaign spec — real Royal Tees per-unit cost is
// still pending a quote, so confirm margin against this before launch.
const PRESALE_PRICE_CENTS = Number(process.env.PRESALE_PRICE_CENTS || 4000);

const DESCRIPTION = [
  "The front catches the moment it happens — a rose going up in flame, the fire climbing off the petals and bending itself into letters, spelling out the words as they burn: BETTER LEFT UNSAID 2. It's not text printed next to the art. It's the art becoming the text.",
  'Flip it, and the fire\'s already gone out. The back is the morning after — scattered embers, petals turned to ash and drifting soot, still faintly glowing where the heat hasn\'t fully left them. Beneath it: "Some things better left unsaid are better off in the past" — Mali V. One story, front to back — the burn, then the aftermath.',
  'Printed on the same 7.5oz heavyweight, oversized cut as the rest of the BLU2 line — built to hold its shape and its color, not just look good in a photo.',
].join('\n\n');

/**
 * One variant per size, all pooled under SHARED_INVENTORY_KEY. Carries
 * over stripeProductId/stripePriceId/priceCents from a matching prior run
 * (same SKU) so a re-run doesn't recreate Stripe objects; a variant from
 * an earlier, differently-shaped run (no matching SKU) is dropped.
 * @param {Array<Object>} [existingVariants]
 */
function buildVariants(existingVariants) {
  const existingBySku = new Map((existingVariants || []).map((v) => [v.sku, v]));
  return SIZES.map((size) => {
    const sku = `${SHARED_INVENTORY_KEY}-${size.toUpperCase()}`;
    return {
      ...(existingBySku.get(sku) || {}),
      sku,
      size,
      inventoryKey: SHARED_INVENTORY_KEY,
    };
  });
}

async function main() {
  const existing = await getProduct(INTERNAL_PRODUCT_ID);

  await upsertProduct(INTERNAL_PRODUCT_ID, {
    name: 'Better Left Unsaid 2 — Presale Tee',
    description: DESCRIPTION,
    provider: 'self',
    currency: 'usd',
    isPresale: true,
    presaleEndsAt: PRESALE_ENDS_AT,
    presaleGoal: PRESALE_GOAL,
    presaleCapUnits: PRESALE_CAP_UNITS,
    variants: buildVariants(existing && existing.variants),
  });
  console.log(
    `[create-blu2-presale-tee] catalog entry "${INTERNAL_PRODUCT_ID}" written with ${SIZES.length} size variants ` +
      '(still inactive until every variant has a Stripe Product/Price).'
  );

  const currentStock = await getInventory(SHARED_INVENTORY_KEY);
  if (currentStock == null) {
    await setInventory(SHARED_INVENTORY_KEY, PRESALE_CAP_UNITS);
    console.log(`[create-blu2-presale-tee] shared inventory pool "${SHARED_INVENTORY_KEY}" initialized to ${PRESALE_CAP_UNITS}.`);
  } else {
    console.log(`[create-blu2-presale-tee] shared inventory pool "${SHARED_INVENTORY_KEY}" already set (${currentStock}) — left untouched.`);
  }

  const priceDollars = (PRESALE_PRICE_CENTS / 100).toFixed(2);
  const result = await activateProduct(INTERNAL_PRODUCT_ID, priceDollars);
  console.log(
    `[create-blu2-presale-tee] activated: created Stripe Product/Price for ${result.createdCount}/${result.totalVariants} variant(s) ` +
      `at $${priceDollars} — catalog entry is now active.`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[create-blu2-presale-tee] failed', err);
    process.exitCode = 1;
  });
}

module.exports = { buildVariants, SHARED_INVENTORY_KEY, SIZES }; // exported for tests
