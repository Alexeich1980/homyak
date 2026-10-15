/* debts-b1.test.js - код-ревью max 15.10, пакет Б1 (движок долгов): Р2 Р3 Р4 Р5 Р7 Р8 Р9 Р13.
   Числа - из скриптов-доказательств ревьюеров (scratchpad f47c56f9: verify1/v.js, v3.js, v56.js,
   verify2/v.js).
   Р2  ставка с историей (rateHist): смена ставки не пересчитывает прошлые месяцы по новой;
       правка остатка того же дня ПОСЛЕ платежа не входит в остаток перед ним.
   Р3  один путь записи долга (commitDebt): перенос даты, правка «взял ещё» вниз, удаление
       «взял ещё» - остаток меньше нуля = отказ 'over', всё как было.
   Р4  отказ в переплате - точное восстановление разбивки (снимок), не повторный пересчёт.
   Р5  подсказка «из них проценты» = то, что запишется (Engine.previewPay тем же пересчётом).
   Р7  правка суммы/даты закрывающего платежа снимает payoff.
   Р8  «закроется в» - платёж месяца, с которого считаем (payAt(d, from)).
   Р9  платёж в месяце после мягкого срока идёт в свой месяц, не закрывает мягкий.
   Р13 «Весь остаток» (payoff) задним числом раньше последней операции долга - обычный платёж. */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

const tick = () => { const t = Date.now(); while (Date.now() < t + 3); };
function fresh() {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000000 }); w.baseTs = 0;
  return { S, w };
}
function owe(S, amount, rate, date, extra) {
  return Engine.addDebt(S, Object.assign({ type: 'owe', name: 'Кредит', amount: amount, pay: 10000, day: 15, rate: rate, date: date, now: 0 }, extra || {}));
}
function pay(S, d, w, amount, date, more) {
  tick();
  return Engine.payDebt(S, Object.assign({ debtId: d.id, walletId: w.id, amount: amount, date: date }, more || {})).txs[0];
}
function err(f) { try { f(); return null; } catch (e) { return e.message; } }

// ---------- Р2 ставка с историей ----------
test('Р2 смена ставки 12% → 24% с октября: пересохранение платежей августа и сентября не меняет их проценты (81 910, не 83 840)', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  const p1 = pay(S, d, w, 10000, '2026-08-15');
  const p2 = pay(S, d, w, 10000, '2026-09-15');
  assert.strictEqual(Engine.debtBalance(S, d.id), 81910);
  Engine.updateDebt(S, d.id, { rate: 24 }, '2026-10');
  assert.deepStrictEqual(d.rateHist, [{ ym: '2026-07', rate: 12 }, { ym: '2026-10', rate: 24 }]);
  Engine.editDebtTx(S, p2.id, { amount: 10000 });
  Engine.editDebtTx(S, p1.id, { amount: 10000 });
  assert.deepStrictEqual([p1.int, p2.int], [1000, 910], 'прошлые месяцы пересчитаны по новой ставке');
  assert.strictEqual(Engine.debtBalance(S, d.id), 81910);
  // октябрь - уже по новой ставке: 81 910 × 24% / 12
  const p3 = pay(S, d, w, 10000, '2026-10-15');
  assert.strictEqual(p3.int, 1638.2);
  assert.strictEqual(Engine.rateAt(d, '2026-09'), 12);
  assert.strictEqual(Engine.rateAt(d, '2026-10'), 24);
});

test('Р2 ставку убрали с ноября - октябрь с процентами, ноябрь без; история в копии данных сохраняется', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  Engine.updateDebt(S, d.id, { rate: '' }, '2026-09');
  const p = pay(S, d, w, 10000, '2026-08-15');
  const q = pay(S, d, w, 10000, '2026-09-15');
  assert.deepStrictEqual([p.int, q.int], [1000, undefined]);
  const S2 = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.deepStrictEqual(Engine.findDebt(S2, d.id).rateHist, [{ ym: '2026-07', rate: 12 }, { ym: '2026-09', rate: 0 }]);
});

test('Р2 миграция: у долга без rateHist история = месяц заведения и текущая ставка; мусор отбрасывается', () => {
  const raw = { debts: [
    { id: 'd1', type: 'owe', name: 'К', base: 1000, pay: 100, day: 5, rate: 12.5, createdDate: '2026-03-10', adj: [] },
    { id: 'd2', type: 'owe', name: 'Б', base: 1000, pay: 100, day: 5, rate: 10, createdDate: '2026-03-10', adj: [],
      rateHist: [{ ym: '2026-05', rate: 20 }, { ym: 'x', rate: 5 }, { ym: '2026-04', rate: -1 }, { ym: '2026-03', rate: 10 }, { ym: '2026-04', rate: 300 }] },
    { id: 'd3', type: 'owed', name: 'С', base: 500, rate: 7, createdDate: '2026-03-10', adj: [] }
  ] };
  const S = Engine.migrate(raw);
  assert.deepStrictEqual(S.debts[0].rateHist, [{ ym: '2026-03', rate: 12.5 }]);
  assert.deepStrictEqual(S.debts[1].rateHist, [{ ym: '2026-03', rate: 10 }, { ym: '2026-05', rate: 20 }]);
  assert.deepStrictEqual(S.debts[2].rateHist, [], '«мне должны» - процентов нет, истории тоже');
});

test('Р2 правка остатка того же дня после платежа не входит в остаток перед ним (94 000, не 94 040)', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  const p = pay(S, d, w, 10000, '2026-10-10');
  assert.strictEqual(Engine.debtBalance(S, d.id), 91000);
  tick();
  Engine.setDebtBase(S, d.id, 95000, Date.now(), '2026-10-10');
  const q = pay(S, d, w, 1000, '2026-10-10');
  assert.strictEqual(p.int, 1000);
  assert.strictEqual(q.int, undefined);
  assert.strictEqual(Engine.debtBalance(S, d.id), 94000);
});

test('Р2 правка остатка задним числом до платежа месяца пересчитывает его проценты, остаток ровно заданный', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  const p = pay(S, d, w, 10000, '2026-10-10');
  tick();
  Engine.setDebtBase(S, d.id, 101000, Date.now(), '2026-10-05');
  assert.ok(p.int > 1090 && p.int < 1100, 'проценты платежа не пересчитаны после правки остатка: ' + p.int);
  assert.strictEqual(Engine.debtBalance(S, d.id), 101000);
});

// ---------- Р3 один путь записи ----------
test('Р3 перенос даты платежа в месяц с процентами, остаток ушёл бы в минус - отказ, всё как было', () => {
  const { S, w } = fresh();
  const d = owe(S, 10000, 12, '2026-07-01');
  const b = pay(S, d, w, 5100, '2026-08-20');
  const a = pay(S, d, w, 5050, '2026-09-05');
  assert.deepStrictEqual([b.int, a.int, Engine.debtBalance(S, d.id)], [100, 50, 0]);
  assert.strictEqual(err(() => Engine.editDebtTx(S, a.id, { amount: 5050, date: '2026-08-25' })), 'over');
  assert.deepStrictEqual([a.date, b.int, a.int, Engine.debtBalance(S, d.id)], ['2026-09-05', 100, 50, 0]);
});

test('Р3 правка «взял ещё» вниз и удаление «взял ещё» - остаток ушёл бы в минус (−4 000/−5 000) - отказ', () => {
  const { S, w } = fresh();
  const d = owe(S, 10000, 0, '2026-07-01');
  tick();
  const tk = Engine.takeDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-08-01' }).txs[0];
  pay(S, d, w, 15000, '2026-09-01');
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  const e = (() => { try { Engine.editDebtTx(S, tk.id, { amount: 1000 }); } catch (x) { return x; } })();
  assert.strictEqual(e && e.message, 'over');
  assert.strictEqual(tk.amount, 5000);
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  const wb = Engine.walletBalance(S, w.id), n = S.tx.length;
  assert.strictEqual(err(() => Engine.deleteTx(S, tk.id)), 'over');
  assert.strictEqual(S.tx.length, n, 'операция удалилась');
  assert.strictEqual(Engine.walletBalance(S, w.id), wb);
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
});

test('Р3 «мне должны»: удалить «дали ещё», после которого вернули всё, нельзя; переплата возврата - отказ с e.max', () => {
  const { S, w } = fresh();
  const d = Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 1000, date: '2026-07-01', now: 0 });
  const more = pay(S, d, w, 500, '2026-08-01');
  tick();
  Engine.takeDebt(S, { debtId: d.id, walletId: w.id, amount: 1500, date: '2026-09-01' });
  assert.strictEqual(err(() => Engine.deleteTx(S, more.id)), 'over');
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  const S2 = fresh().S, d2 = Engine.addDebt(S2, { type: 'owed', name: 'Б', amount: 1000, date: '2026-07-01', now: 0 });
  const e = (() => { try { Engine.takeDebt(S2, { debtId: d2.id, walletId: null, amount: 1200, date: '2026-08-01' }); } catch (x) { return x; } })();
  assert.strictEqual(e && e.message, 'over');
  assert.strictEqual(e.max, 1000);
  assert.strictEqual(S2.tx.length, 0);
});

test('Р3 удалить «взял ещё», когда остаток остаётся не меньше нуля, можно', () => {
  const { S, w } = fresh();
  const d = owe(S, 10000, 12, '2026-07-01');
  tick();
  const tk = Engine.takeDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-08-01' }).txs[0];
  pay(S, d, w, 5000, '2026-09-01');
  assert.strictEqual(Engine.deleteTx(S, tk.id), true);
  assert.strictEqual(Engine.debtBalance(S, d.id), 5100);
});

// ---------- Р4 точный откат ----------
test('Р4 отказ в переплате восстанавливает разбивку из снимка, а не пересчётом (91 000 остаётся)', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  const p = pay(S, d, w, 10000, '2026-10-01');
  Engine.updateDebt(S, d.id, { rate: 24 }, '2026-11');
  assert.strictEqual(err(() => pay(S, d, w, 500000, '2026-10-05')), 'over');
  assert.deepStrictEqual([p.int, Engine.debtBalance(S, d.id), S.tx.length], [1000, 91000, 1]);
  // разбивка в данных не совпадает с пересчётом (старые данные) - отказ её не трогает
  p.int = 1500;
  assert.strictEqual(err(() => pay(S, d, w, 500000, '2026-10-05')), 'over');
  assert.strictEqual(p.int, 1500, 'отказ пересчитал чужую разбивку');
  const e = (() => { try { pay(S, d, w, 100000, '2026-10-05'); } catch (x) { return x; } })();
  assert.strictEqual(e.message, 'over');
  assert.strictEqual(e.max, 91000, 'e.max - сколько можно внести этой датой');
});

// ---------- Р5 предпросмотр ----------
test('Р5 previewPay: платёж задним числом в начало месяца - проценты месяца у него (1 000, как запишется), S не меняется', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  const p = pay(S, d, w, 10000, '2026-10-10');
  const snap = JSON.stringify(S);
  const pv = Engine.previewPay(S, { debtId: d.id, amount: 10000, date: '2026-10-01' });
  assert.strictEqual(JSON.stringify(S), snap, 'предпросмотр изменил данные');
  const q = pay(S, d, w, 10000, '2026-10-01');
  assert.strictEqual(pv.interest, q.int);
  assert.strictEqual(pv.interest, 1000);
  assert.strictEqual(p.int, undefined);
});

test('Р5 previewPay: первый платёж месяца, меньше процентов, второй платёж месяца', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-08-01');
  assert.deepStrictEqual(Engine.previewPay(S, { debtId: d.id, amount: 5000, date: '2026-09-15' }), { interest: 1000, body: 4000, left: 0, over: false });
  assert.deepStrictEqual(Engine.previewPay(S, { debtId: d.id, amount: 600, date: '2026-09-15' }), { interest: 600, body: 0, left: 400, over: false });
  pay(S, d, w, 600, '2026-09-05');
  assert.deepStrictEqual(Engine.previewPay(S, { debtId: d.id, amount: 3000, date: '2026-09-20' }), { interest: 400, body: 2600, left: 0, over: false });
  assert.strictEqual(Engine.previewPay(S, { debtId: d.id, amount: 300000, date: '2026-09-20' }).over, true);
  assert.strictEqual(Engine.previewPay(S, { debtId: d.id, amount: 3000, date: '2026-09-20', payoff: true }).interest, 0, 'закрывающий - без процентов');
  assert.strictEqual(Engine.paySplit, undefined, 'отдельное правило подсказки вернулось');
  assert.strictEqual(Engine.interestDue, undefined, 'отдельное правило подсказки вернулось');
});

// ---------- Р7 payoff после правки ----------
test('Р7 правка суммы закрывающего платежа 120 000 → 20 000 - обычный платёж, проценты месяца на месте (101 200)', () => {
  const { S, w } = fresh();
  const d = owe(S, 120000, 12, '2026-07-01');
  const p = pay(S, d, w, 120000, '2026-09-15', { payoff: true });
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  Engine.editDebtTx(S, p.id, { amount: 20000 });
  assert.strictEqual(p.payoff, undefined);
  assert.strictEqual(p.int, 1200);
  assert.strictEqual(Engine.debtBalance(S, d.id), 101200);
});

test('Р7 правка только кошелька закрывающего платежа - остаётся закрывающим', () => {
  const { S, w } = fresh();
  const w2 = Engine.addWallet(S, { name: 'Б', base: 1000000 }); w2.baseTs = 0;
  const d = owe(S, 120000, 12, '2026-07-01');
  const p = pay(S, d, w, 120000, '2026-09-15', { payoff: true });
  Engine.editDebtTx(S, p.id, { amount: 120000, walletId: w2.id });
  assert.strictEqual(p.payoff, true);
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
});

test('Р7 долг без ставки со старой записью с процентами: правка суммы держит проценты (не больше суммы), тело не в минус', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, null, '2026-07-01');
  const p = pay(S, d, w, 10000, '2026-08-15');
  p.int = 1000;   // запись до 13.10: проценты внутри платежа, ставку потом убрали - пересчёта нет
  Engine.editDebtTx(S, p.id, { amount: 600 });
  assert.deepStrictEqual([p.int, p.intLeft], [600, 400]);
  assert.strictEqual(Engine.debtBalance(S, d.id), 100000);
});

// ---------- Р8 «закроется в» ----------
test('Р8 платёж увеличен со следующего месяца - «закроется в» по новому платежу', () => {
  const { S, w } = fresh();
  const cur = Engine.today().slice(0, 7), prev = Engine.addMonths(cur, -1), next = Engine.addMonths(cur, 1);
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 90000, pay: 10000, day: 1, date: prev + '-01', now: 0 });
  pay(S, d, w, 10000, cur + '-01');
  Engine.updateDebt(S, d.id, { pay: 20000 }, cur);
  assert.deepStrictEqual(d.payHist, [{ ym: prev, pay: 10000 }, { ym: next, pay: 20000 }]);
  const it = Engine.debtStats(S).list[0];
  assert.strictEqual(it.months, 4);
  assert.strictEqual(it.until, Engine.addMonths(next, 3));
  assert.strictEqual(it.pay, 20000);
});

// ---------- Р9 мягкий срок ----------
test('Р9 долг заведён 03.09, день 5, платёж 03.10 - октябрь оплачен, 06.10 нет просрочки', () => {
  const { S, w } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 90000, pay: 10000, day: 5, date: '2026-09-03', now: 0 });
  pay(S, d, w, 10000, '2026-10-03');
  const t = Engine.debtTerms(S, d.id, '2026-10');
  assert.deepStrictEqual(t.slice(0, 2).map((x) => [x.ym, x.soft, x.paid]), [['2026-09', true, false], ['2026-10', false, true]]);
  assert.strictEqual(Engine.debtStatus(S, d.id, '2026-10-06').state, 'paid');
  // платёж в месяце заведения после мягкого срока - по-прежнему мягкий срок
  const S2 = fresh().S, d2 = Engine.addDebt(S2, { type: 'owe', name: 'К', amount: 90000, pay: 10000, day: 5, date: '2026-09-03', now: 0 });
  Engine.payDebt(S2, { debtId: d2.id, walletId: null, amount: 10000, date: '2026-09-20' });
  assert.deepStrictEqual(Engine.debtTerms(S2, d2.id, '2026-10').slice(0, 2).map((x) => x.paid), [true, false]);
});

// ---------- Р13 «Весь остаток» задним числом ----------
test('Р13 закрывающий платёж датой раньше последнего платежа - обычный платёж, не отказ на ту же сумму', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  pay(S, d, w, 5000, '2026-10-15');
  const rest = Engine.debtBalance(S, d.id);
  assert.strictEqual(rest, 96000);
  let t = null;
  assert.strictEqual(err(() => { t = pay(S, d, w, rest, '2026-09-15', { payoff: true }); }), null);
  assert.strictEqual(t.payoff, undefined, 'закрывающий раньше последней операции');
  assert.strictEqual(Engine.debtLastDate(S, d.id), '2026-10-15');
  assert.ok(Engine.debtBalance(S, d.id) >= 0);
  // в день последнего платежа и позже - закрывающий, долг ровно 0
  const S2 = fresh(), d2 = owe(S2.S, 100000, 12, '2026-07-01');
  pay(S2.S, d2, S2.w, 5000, '2026-10-15');
  const t2 = pay(S2.S, d2, S2.w, 96000, '2026-10-15', { payoff: true });
  assert.strictEqual(t2.payoff, true);
  assert.strictEqual(Engine.debtBalance(S2.S, d2.id), 0);
});

// ---------- найдено по ходу: платежи одного дня в одну миллисекунду ----------
test('два платежа одного дня с одним временем записи - проценты месяца у записанного первым, не по случайному id', () => {
  const { S, w } = fresh();
  const d = owe(S, 100000, 12, '2026-07-01');
  const a = pay(S, d, w, 10000, '2026-10-10');
  const b = pay(S, d, w, 10000, '2026-10-10');
  b.ts = a.ts; a.id = 'tz'; b.id = 'ta';   // id второго «меньше» - раньше сортировка отдавала проценты ему
  Engine.editDebtTx(S, a.id, { amount: 10000 });
  assert.deepStrictEqual([a.int, b.int], [1000, undefined]);
});
