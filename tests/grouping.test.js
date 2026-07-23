const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupItemsByProvider } = require('../lib/fulfillment/grouping');

test('groups items by provider, preserving order within each group', () => {
  const items = [
    { id: 'a', provider: 'apliiq' },
    { id: 'b', provider: 'self' },
    { id: 'c', provider: 'apliiq' },
    { id: 'd', provider: 'printful' },
  ];

  const groups = groupItemsByProvider(items);

  assert.equal(groups.size, 3);
  assert.deepEqual(groups.get('apliiq').map((i) => i.id), ['a', 'c']);
  assert.deepEqual(groups.get('self').map((i) => i.id), ['b']);
  assert.deepEqual(groups.get('printful').map((i) => i.id), ['d']);
});

test('an unsupported/unknown provider value gets its own group rather than being dropped', () => {
  const items = [{ id: 'x', provider: 'unknown-provider' }];
  const groups = groupItemsByProvider(items);
  assert.equal(groups.size, 1);
  assert.deepEqual(groups.get('unknown-provider').map((i) => i.id), ['x']);
});

test('empty input returns an empty map', () => {
  const groups = groupItemsByProvider([]);
  assert.equal(groups.size, 0);
});
