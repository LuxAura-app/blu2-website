const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { decrementInventory } = require('../lib/inventory');
const alert = require('../lib/alert');

function makeFakeRedis(initial = {}) {
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

afterEach(() => {
  mock.restoreAll();
});

test('normal decrement reduces stock and does not alert', async () => {
  mock.method(alert, 'sendAlert', async () => true);
  const redis = makeFakeRedis({ 'inventory:BLU2-TEE-M': 10 });

  const result = await decrementInventory('BLU2-TEE-M', 3, redis);

  assert.equal(result.newCount, 7);
  assert.equal(result.oversold, false);
  assert.equal(alert.sendAlert.mock.callCount(), 0);
});

test('a decrement that would go below zero still succeeds and fires an oversold alert', async () => {
  mock.method(alert, 'sendAlert', async () => true);
  const redis = makeFakeRedis({ 'inventory:BLU2-TEE-M': 2 });

  const result = await decrementInventory('BLU2-TEE-M', 5, redis);

  assert.equal(result.newCount, -3);
  assert.equal(result.oversold, true);
  assert.equal(alert.sendAlert.mock.callCount(), 1);
  const [subject] = alert.sendAlert.mock.calls[0].arguments;
  assert.match(subject, /Oversold: BLU2-TEE-M/);
});

test('decrementing an untracked SKU starts from zero', async () => {
  mock.method(alert, 'sendAlert', async () => true);
  const redis = makeFakeRedis();

  const result = await decrementInventory('NEW-SKU', 1, redis);

  assert.equal(result.newCount, -1);
  assert.equal(result.oversold, true);
});
