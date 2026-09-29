const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');

test('defaultState: categories и limits, без plans/paired/startYM', () => {
  const S = Engine.defaultState();
  assert.deepStrictEqual(S.categories, { exp: [], inc: [] });
  assert.deepStrictEqual(S.limits, {});
  assert.ok(!('plans' in S));
  assert.ok(!('paired' in S));
  assert.ok(!('startYM' in S));
  assert.ok(!('history' in S));
  assert.ok(!('pendingRemovals' in S));
});

test('normalize чинит битые categories/limits', () => {
  const S = Engine.migrate({ categories: { exp: 'x' }, limits: { 'bad': 5, '2026-09': { c1: 'no', c2: 300 } } });
  assert.deepStrictEqual(S.categories.exp, []);
  assert.deepStrictEqual(S.categories.inc, []);
  assert.ok(!('bad' in S.limits));
  assert.strictEqual(S.limits['2026-09'].c2, 300);
  assert.ok(!('c1' in S.limits['2026-09']));
});

test('migrate никогда не бросает на мусоре', () => {
  assert.doesNotThrow(() => Engine.migrate(null));
  assert.doesNotThrow(() => Engine.migrate('нет'));
  assert.doesNotThrow(() => Engine.migrate({ categories: 123, limits: 'x', tx: 5, wallets: null }));
});
