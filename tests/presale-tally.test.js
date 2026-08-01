const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTally } = require('../api/admin/presale-tally');

function order({ stripeSessionId, items }) {
  return { stripeSessionId, items };
}

test('buildTally sums qty by size, filtered to the given groupId', () => {
  const orders = [
    order({
      stripeSessionId: 'cs_1',
      items: [
        { groupId: 'self-blu2-presale-tee', size: 'l', qty: 2 },
        { groupId: 'self-blu2-presale-tee', size: 'xxl', qty: 1 },
      ],
    }),
    order({
      stripeSessionId: 'cs_2',
      items: [{ groupId: 'self-blu2-presale-tee', size: 'l', qty: 1 }],
    }),
  ];

  const tally = buildTally(orders, 'self-blu2-presale-tee');

  assert.deepEqual(tally.bySize, { L: 3, XXL: 1 });
  assert.equal(tally.totalUnits, 4);
  assert.equal(tally.orderCount, 2);
  assert.equal(tally.groupId, 'self-blu2-presale-tee');
});

test('buildTally ignores items from a different groupId in the same order', () => {
  const orders = [
    order({
      stripeSessionId: 'cs_1',
      items: [
        { groupId: 'self-blu2-presale-tee', size: 'm', qty: 1 },
        { groupId: 'apliiq-5989067', size: 'm', qty: 1 },
      ],
    }),
  ];

  const tally = buildTally(orders, 'self-blu2-presale-tee');

  assert.deepEqual(tally.bySize, { M: 1 });
  assert.equal(tally.totalUnits, 1);
});

test('buildTally labels a missing size as UNSPECIFIED rather than dropping the item', () => {
  const orders = [order({ stripeSessionId: 'cs_1', items: [{ groupId: 'g1', size: null, qty: 3 }] })];
  const tally = buildTally(orders, 'g1');
  assert.deepEqual(tally.bySize, { UNSPECIFIED: 3 });
});

test('buildTally counts orderCount as distinct sessions, not line items', () => {
  const orders = [
    order({
      stripeSessionId: 'cs_1',
      items: [
        { groupId: 'g1', size: 's', qty: 1 },
        { groupId: 'g1', size: 'm', qty: 1 },
      ],
    }),
  ];
  const tally = buildTally(orders, 'g1');
  assert.equal(tally.orderCount, 1);
  assert.equal(tally.totalUnits, 2);
});

test('buildTally returns an empty tally for a groupId with no matching orders', () => {
  const tally = buildTally([], 'nonexistent');
  assert.deepEqual(tally.bySize, {});
  assert.equal(tally.totalUnits, 0);
  assert.equal(tally.orderCount, 0);
});
