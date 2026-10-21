/* Подсказка «из них проценты X ₽» на экране суммы считается ДО записи платежа. С 15.10 (код-ревью
   max, Р5) её считает Engine.previewPay - сама запись (payDebt) на копии этого долга, с выбранной
   датой. Раньше было отдельное правило (paySplit) без даты, и задним числом подсказка расходилась с
   записью (0 вместо 1 000). Здесь - смысл прежних проверок paySplit на новой функции: первый платёж
   месяца, платёж меньше процентов, второй платёж месяца, задним числом; плюс месяц со старой
   записью до точки отсчёта долга (её пересчёт не трогает, недоплата не теряется). */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

function setup() {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: 500000 }); w.baseTs = 0;
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 15, rate: 12, date: '2026-08-01', now: 0 });
  return { S, w, d };
}
const pv = (S, d, amount, date) => Engine.previewPay(S, { debtId: d.id, amount: amount, date: date });

test('previewPay: первый платёж месяца - проценты месяца, не больше самого платежа', () => {
  const { S, d } = setup();
  assert.deepStrictEqual(pv(S, d, 5000, '2026-09-15'), { interest: 1000, body: 4000, left: 0, over: false });
  assert.deepStrictEqual(pv(S, d, 600, '2026-09-15'), { interest: 600, body: 0, left: 400, over: false },
    'платёж меньше процентов: проценты = весь платёж, остаток процентов - в недоплату');
});

test('previewPay: второй платёж того же месяца - только недоплата, проценты месяца второй раз не берутся', () => {
  const { S, w, d } = setup();
  Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 600, date: '2026-09-05' });   // проценты 600, недоплата 400
  assert.deepStrictEqual(pv(S, d, 3000, '2026-09-20'), { interest: 400, body: 2600, left: 0, over: false });
});

test('previewPay: задним числом раньше платежа месяца - проценты месяца у него, как и запишется', () => {
  const { S, w, d } = setup();
  const late = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-09-20' }).txs[0];
  assert.strictEqual(late.int, 1000);
  const p = pv(S, d, 5000, '2026-09-05');
  assert.deepStrictEqual(p, { interest: 1000, body: 4000, left: 0, over: false });
  assert.strictEqual(late.int, 1000, 'предпросмотр тронул записанный платёж');
  const r = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-09-05' });
  assert.strictEqual(r.interest, p.interest, 'записалось не то, что показали');
});

test('payDebt: месяц со старой записью до точки отсчёта долга - недоплата процентов не теряется', () => {
  const { S, w, d } = setup();
  // запись сборки 11.10: ts раньше baseTs долга - пересчёт месяца её не трогает и в очередь не ставит
  d.baseTs = 1000;
  S.tx.push({ id: 'old1', kind: 'debt', op: 'pay', amount: 100, date: '2026-09-02', ts: 1, catId: null, walletId: w.id, toWalletId: null, debtId: d.id });
  const r = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 600, date: '2026-09-05' });
  const t = r.txs[0];
  assert.strictEqual(t.int, 600);
  assert.strictEqual(t.intLeft, 400, 'недоплата 400 должна уйти в следующий платёж');
  assert.strictEqual(S.tx[0].int, undefined, 'старую запись пересчёт тронул');
});
