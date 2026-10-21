const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');

function seed() {
  const S = Engine.defaultState();
  const eda = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const dom = Engine.addCategory(S, 'exp', { name: 'Дом' });     // без лимита
  const zp = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 });
  Engine.setLimit(S, '2026-09', eda.id, 10000);
  Engine.addTx(S, { kind: 'exp', amount: 3000, date: '2026-09-05', catId: eda.id, walletId: w.id });
  Engine.addTx(S, { kind: 'exp', amount: 1500, date: '2026-09-06', catId: dom.id, walletId: w.id });
  Engine.addTx(S, { kind: 'inc', amount: 50000, date: '2026-09-01', catId: zp.id, walletId: w.id });
  return { S, eda, dom, zp, w };
}

test('catFact считает из операций', () => {
  const { S, eda } = seed();
  assert.strictEqual(Engine.catFact(S, eda.id, '2026-09'), 3000);
});

test('summary: planned из лимитов, remaining = planned - spent', () => {
  const { S } = seed();
  const r = Engine.summary(S, '2026-09');
  assert.strictEqual(r.spent, 4500);
  assert.strictEqual(r.earned, 50000);
  assert.strictEqual(r.planned, 10000);       // только у «Еда» задан лимит
  assert.strictEqual(r.remaining, 5500);       // 10000 - 4500
});

test('monthBreakdown: категория без лимита имеет plan 0, но не тревога', () => {
  const { S, dom } = seed();
  const rows = Engine.monthBreakdown(S, '2026-09', 'exp');
  const domRow = rows.find(r => r.catId === dom.id);
  assert.strictEqual(domRow.plan, 0);
  assert.strictEqual(domRow.fact, 1500);
});

test('attention: перебор ловится, категория без лимита — нет', () => {
  const { S, eda, dom, w } = seed();
  Engine.addTx(S, { kind: 'exp', amount: 8000, date: '2026-09-06', catId: eda.id, walletId: w.id }); // 11000 > 10000
  const at = Engine.attention(S, '2026-09');
  const names = at.map(r => r.catId);
  assert.ok(names.includes(eda.id));   // перебор попал
  assert.ok(!names.includes(dom.id));  // без лимита — не тревога
});

test('monthlyTotals: факт по месяцам из операций', () => {
  const { S } = seed();
  const rows = Engine.monthlyTotals(S, 2026);
  assert.strictEqual(rows[8].fact, 4500); // сентябрь (индекс 8)
  assert.strictEqual(rows[8].plan, 10000);
});

test('daySpend: расход по дням месяца', () => {
  const { S } = seed();
  const days = Engine.daySpend(S, '2026-09');
  assert.strictEqual(days['2026-09-05'], 3000);
  assert.strictEqual(days['2026-09-06'], 1500);
});

test('feedByDay: дни с операциями, баланс на конец дня', () => {
  const { S } = seed();
  const feed = Engine.feedByDay(S, '2026-09');
  assert.ok(feed.length >= 2);
  assert.strictEqual(feed[0].date, '2026-09-06'); // новые дни сверху
});
