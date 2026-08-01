const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVariants, SHARED_INVENTORY_KEY, SIZES } = require('../scripts/create-blu2-presale-tee');

test('buildVariants produces one variant per size, all sharing the same inventoryKey', () => {
  const variants = buildVariants(undefined);
  assert.equal(variants.length, SIZES.length);
  assert.deepEqual(
    variants.map((v) => v.sku),
    ['RT-BLU2-PRESALE-S', 'RT-BLU2-PRESALE-M', 'RT-BLU2-PRESALE-L', 'RT-BLU2-PRESALE-XL', 'RT-BLU2-PRESALE-XXL']
  );
  assert.ok(variants.every((v) => v.inventoryKey === SHARED_INVENTORY_KEY));
});

test('buildVariants carries over stripeProductId/stripePriceId from a matching prior run (idempotent re-activation)', () => {
  const existing = [
    { sku: 'RT-BLU2-PRESALE-L', size: 'l', inventoryKey: SHARED_INVENTORY_KEY, stripeProductId: 'prod_l', stripePriceId: 'price_l', priceCents: 4000 },
  ];

  const variants = buildVariants(existing);
  const lVariant = variants.find((v) => v.sku === 'RT-BLU2-PRESALE-L');

  assert.equal(lVariant.stripeProductId, 'prod_l');
  assert.equal(lVariant.stripePriceId, 'price_l');
  // Every other size still has no Stripe objects yet — nothing to carry over.
  assert.ok(variants.filter((v) => v.sku !== 'RT-BLU2-PRESALE-L').every((v) => !v.stripeProductId));
});

test('buildVariants drops a variant from an earlier, differently-shaped run instead of carrying it forward', () => {
  // The original (incorrect) build: one flat SKU, no size.
  const staleSingleSku = [{ sku: 'RT-BLU2-PRESALE', stripeProductId: 'prod_old', stripePriceId: 'price_old' }];

  const variants = buildVariants(staleSingleSku);

  assert.equal(variants.length, 5);
  assert.ok(variants.every((v) => v.sku !== 'RT-BLU2-PRESALE')); // the old flat SKU is gone
  assert.ok(variants.every((v) => !v.stripeProductId)); // nothing carried over — all fresh
});
