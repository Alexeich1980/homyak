const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');

test('demoState: 5 кошельков, 17 расходных категорий, метка demo', () => {
  const S = Engine.migrate(Seed.demoState(Engine, '2026-09-07'));
  assert.strictEqual(S.wallets.length, 5);
  assert.strictEqual(Engine.listCategories(S, 'exp').length, 17);
  assert.ok(Engine.listCategories(S, 'inc').length >= 3);
  assert.strictEqual(S.ui.demo, true);
  assert.ok(S.tx.some(t => Engine.ym(t.date) === '2026-09'));
  assert.ok(S.tx.some(t => Engine.ym(t.date) === '2026-08'));
  const anyLimit = Engine.listCategories(S, 'exp').some(c => Engine.catLimit(S, c.id, '2026-09') !== null);
  const anyUnset = Engine.listCategories(S, 'exp').some(c => Engine.catLimit(S, c.id, '2026-09') === null);
  assert.ok(anyLimit && anyUnset);
});

test('demoState даёт непустые лента/сводку/динамику', () => {
  const S = Engine.migrate(Seed.demoState(Engine, '2026-09-07'));
  assert.ok(Engine.feedByDay(S, '2026-09').length > 0);
  assert.ok(Engine.summary(S, '2026-09').spent > 0);
  const monthly = Engine.monthlyTotals(S, 2026);
  assert.ok(monthly[8].fact > 0 && monthly[7].fact > 0); // сентябрь и август
});

test('demoState: есть категория с перебором (зона внимания)', () => {
  const S = Engine.migrate(Seed.demoState(Engine, '2026-09-07'));
  assert.ok(Engine.attention(S, '2026-09').length >= 1);
});

test('presetState = 8 расходных + доход + 2 кошелька, без операций и без метки demo', () => {
  const S = Engine.migrate(Seed.presetState(Engine));
  assert.strictEqual(Engine.listCategories(S, 'exp').length, 8);
  assert.ok(Engine.listCategories(S, 'inc').length >= 1);
  assert.strictEqual(S.wallets.length, 2);
  assert.strictEqual(S.tx.length, 0);
  assert.ok(!S.ui.demo);
});

test('presetState укладывается в бесплатные лимиты', () => {
  const S = Engine.migrate(Seed.presetState(Engine));
  assert.strictEqual(Engine.canAddExpCat(S, false), false); // ровно 8 — упор
  assert.strictEqual(Engine.canAddWallet(S, false), false); // ровно 2 — упор
});
