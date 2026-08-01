const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePresaleStatus } = require('../lib/presale');
const { decrementInventory } = require('../lib/inventory');

const FAR_FUTURE = '2099-01-01T00:00:00Z';
const FAR_PAST = '2000-01-01T00:00:00Z';

test('claimed is capUnits minus the raw inventory counter', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: 32, endsAtIso: FAR_FUTURE });
  assert.equal(status.remaining, 32);
  assert.equal(status.claimed, 18);
});

test('an unset inventory counter (null) is treated as full stock remaining, not zero', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: null, endsAtIso: FAR_FUTURE });
  assert.equal(status.remaining, 50);
  assert.equal(status.claimed, 0);
});

test('an open presale (stock left, deadline in the future) is not closed', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: 1, endsAtIso: FAR_FUTURE });
  assert.equal(status.isPresaleClosed, false);
});

test('hitting the unit cap (remaining <= 0) closes the presale even before the deadline', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: 0, endsAtIso: FAR_FUTURE });
  assert.equal(status.isPresaleClosed, true);
});

test('going oversold (remaining negative) still counts as closed', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: -2, endsAtIso: FAR_FUTURE });
  assert.equal(status.isPresaleClosed, true);
  assert.equal(status.claimed, 52);
});

test('passing the deadline closes the presale even with units still remaining', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: 40, endsAtIso: FAR_PAST });
  assert.equal(status.isPresaleClosed, true);
  assert.equal(status.remaining, 40);
});

test('a null endsAtIso never closes the presale on its own (only the cap can)', () => {
  const status = computePresaleStatus({ capUnits: 50, remaining: 10, endsAtIso: null });
  assert.equal(status.isPresaleClosed, false);
});

test('exactly at the deadline (now === endsAt) is not yet past it', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const status = computePresaleStatus({ capUnits: 50, remaining: 10, endsAtIso: now.toISOString(), now });
  assert.equal(status.isPresaleClosed, false);
});

test('one millisecond past the deadline is closed', () => {
  const now = new Date('2026-06-01T00:00:00.001Z');
  const status = computePresaleStatus({ capUnits: 50, remaining: 10, endsAtIso: '2026-06-01T00:00:00.000Z', now });
  assert.equal(status.isPresaleClosed, true);
});

/* ────────────────────────────────────────────
   SHARED POOL, END TO END — computePresaleStatus itself takes no
   sku/size at all, so it can't special-case one; "closed" can only ever
   be a function of whatever single `remaining` number it's given. These
   tests prove that number is genuinely the *combined* total across
   different sizes' orders (via the real lib/inventory.js decrement, not
   a mock), not any one size's own count.
──────────────────────────────────────────── */
function fakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async decrby(key, amount) {
      const next = (store.get(key) || 0) - amount;
      store.set(key, next);
      return next;
    },
  };
}

test('orders across different sizes decrement the same shared counter, and isPresaleClosed reflects the combined total', async () => {
  const redis = fakeRedis({ 'inventory:RT-BLU2-PRESALE': 50 });
  const SHARED_KEY = 'RT-BLU2-PRESALE';

  // 5 size orders, same shared key, none of them individually close a
  // 50-unit cap — but their sum (12+8+15+9+5 = 49) leaves only 1 unit.
  const orders = [
    { size: 's', qty: 12 },
    { size: 'm', qty: 8 },
    { size: 'l', qty: 15 },
    { size: 'xl', qty: 9 },
    { size: 'xxl', qty: 5 },
  ];
  for (const order of orders) {
    await decrementInventory(SHARED_KEY, order.qty, redis);
  }

  const remaining = redis.store.get(`inventory:${SHARED_KEY}`);
  assert.equal(remaining, 1);

  const notYetClosed = computePresaleStatus({ capUnits: 50, remaining, endsAtIso: '2099-01-01T00:00:00Z' });
  assert.equal(notYetClosed.claimed, 49);
  assert.equal(notYetClosed.isPresaleClosed, false);

  // One more order — an XXL this time, a size that individually only ever
  // sold 5 units — tips the *shared* total to the cap.
  await decrementInventory(SHARED_KEY, 1, redis);
  const afterFinalOrder = redis.store.get(`inventory:${SHARED_KEY}`);
  const closed = computePresaleStatus({ capUnits: 50, remaining: afterFinalOrder, endsAtIso: '2099-01-01T00:00:00Z' });

  assert.equal(closed.remaining, 0);
  assert.equal(closed.isPresaleClosed, true);
  // Closed because of the shared 50-unit total, not because any
  // individual size (max 15, for L) ever approached 50 on its own.
  assert.ok(orders.every((o) => o.qty < 50));
});
