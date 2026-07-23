const { test } = require('node:test');
const assert = require('node:assert/strict');
const { claimEvent, completeEvent, claimKey } = require('../api/lib/idempotency');

function makeFakeRedis({ setImpl } = {}) {
  const store = new Map();
  return {
    store,
    async set(key, value, opts) {
      if (setImpl) return setImpl(key, value, opts, store);
      if (opts && opts.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
  };
}

test('first claim on a fresh event succeeds', async () => {
  const redis = makeFakeRedis();
  const result = await claimEvent('evt_1', redis);
  assert.equal(result.claimed, true);
  assert.equal(redis.store.get(claimKey('evt_1')), 'in_progress');
});

test('a second claim on the same event id no-ops rather than re-processing', async () => {
  const redis = makeFakeRedis();
  await claimEvent('evt_2', redis);
  const second = await claimEvent('evt_2', redis);
  assert.equal(second.claimed, false);
});

test('a Redis error during claim propagates so the caller can fail closed', async () => {
  const redis = {
    async set() {
      throw new Error('network timeout');
    },
  };
  await assert.rejects(() => claimEvent('evt_3', redis), /network timeout/);
});

test('completeEvent does not throw even if the underlying write fails', async () => {
  const redis = {
    async set() {
      throw new Error('redis unavailable');
    },
  };
  const ok = await completeEvent('evt_4', redis);
  assert.equal(ok, false);
});

test('completeEvent returns true and updates the key on success', async () => {
  const redis = makeFakeRedis();
  await claimEvent('evt_5', redis);
  const ok = await completeEvent('evt_5', redis);
  assert.equal(ok, true);
  assert.equal(redis.store.get(claimKey('evt_5')), 'completed');
});
