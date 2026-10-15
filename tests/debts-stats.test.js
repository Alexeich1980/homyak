/* debts-stats.test.js - вкладка «Долги» в аналитике (Алексей 13.10): сколько должен сейчас,
   сколько выплачено (в счёт долга и процентами) и прогноз погашения каждого долга «я должен». */
const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');

function base() {
  const S = Engine.defaultState();
  S.startYM = '2026-01';
  const w = Engine.addWallet(S, { name: 'Карта', base: 1000000 }); w.baseTs = 0;
  return { S, w };
}

test('прогноз погашения: ставка, без ставки, платёж меньше процентов', () => {
  assert.strictEqual(Engine.payoffMonths(120000, 10000, 0), 12, 'без ставки - остаток / платёж');
  assert.strictEqual(Engine.payoffMonths(120001, 10000, 0), 13, 'хвост - ещё месяц');
  const n = Engine.payoffMonths(300000, 15000, 18);
  assert.ok(n > 20 && n < 26, 'со ставкой 18% дольше 20 мес: ' + n);
  assert.strictEqual(Engine.payoffMonths(100000, 1000, 18), null, 'платёж 1000 не покрывает проценты 1500');
  assert.strictEqual(Engine.payoffMonths(0, 1000, 18), 0, 'нечего гасить');
});

test('debtStats: должен сейчас, выплачено тело + проценты, «мне должны» и архив не в остатке', () => {
  const { S, w } = base();
  const a = Engine.addDebt(S, { type: 'owe', name: 'Авто', amount: 300000, pay: 15000, day: 20, rate: 12, now: 0, date: '2026-01-01' });
  Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 5000, now: 0, date: '2026-01-01' });
  const r = Engine.payDebt(S, { debtId: a.id, walletId: w.id, amount: 15000, date: Engine.today() });
  const D = Engine.debtStats(S);
  assert.strictEqual(D.any, true);
  assert.strictEqual(D.interest, r.interest, 'проценты = записанные в платеже');
  assert.ok(r.interest > 0, 'со ставкой в платеже есть проценты');
  assert.strictEqual(D.body, 15000 - r.interest, 'в счёт долга = платёж - проценты');
  assert.strictEqual(D.paid, 15000, 'выплачено = весь платёж');
  assert.strictEqual(D.total, Engine.debtBalance(S, a.id), 'должен = остаток «я должен», без «мне должны»');
  assert.strictEqual(D.list.length, 1);
  assert.strictEqual(D.list[0].left, D.total);
  assert.ok(D.list[0].until && !D.list[0].never, 'есть месяц погашения');
  Engine.closeDebt(S, a.id, Engine.today());
  const D2 = Engine.debtStats(S);
  assert.strictEqual(D2.total, 0, 'закрытый долг не в «должен сейчас»');
  assert.strictEqual(D2.paid, 15000, 'выплаченное по закрытому долгу остаётся');
});

test('debtStats: только «мне должны» - any=false (вкладки «Долги» нет)', () => {
  const { S } = base();
  Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 5000, now: 0, date: '2026-01-01' });
  assert.strictEqual(Engine.debtStats(S).any, false);
});
