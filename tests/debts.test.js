/* debts.test.js - учёт долгов 1.0.4 (www/engine.js, концепция docs/1.0.4-dolgi-koncepciya.md).
   Платёж с процентами и без, проценты один раз за календарный месяц, досрочка и второй
   платёж - в тело, взятие в долг, «мне должны», погашение и архив, удаление, чистый
   капитал, долговая нагрузка (досрочка не раздувает, порог 30%, нет доходов), подсветка и
   просрочка по датам (31-е в феврале), план напоминаний, миграция старых данных, free-лимит. */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 200000 });
  const cash = Engine.addWallet(S, { name: 'Наличные', base: 5000 });
  card.baseTs = 0; cash.baseTs = 0;
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  return { S, card, cash, sal, food };
}
function owe(S, o) {
  return Engine.addDebt(S, Object.assign({ type: 'owe', name: 'Ипотека', amount: 1000000, pay: 30000, day: 15, date: '2026-01-10', now: 0 }, o || {}));
}
// платежи с процентами (с 13.10 проценты - поле int самого платежа, не расход)
const intTx = (S, id) => S.tx.filter((t) => t.kind === 'debt' && t.int > 0 && t.debtId === id);

test('долги: платёж без ставки - целиком в тело, деньги уходят из кошелька, «В кошельках» без долга', () => {
  const { S, card } = fresh();
  const d = owe(S, { rate: null });
  const r = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  assert.deepStrictEqual([r.interest, r.body], [0, 30000]);
  assert.strictEqual(Engine.debtBalance(S, d.id), 970000);
  assert.strictEqual(Engine.walletBalance(S, card.id), 170000);
  assert.strictEqual(Engine.walletsTotal(S), 175000, 'долг в «В кошельках» не входит');
  assert.strictEqual(Engine.summary(S, '2026-02').spent, 0, 'тело платежа - не расход');
  assert.strictEqual(r.txs.length, 1);
  assert.ok(!r.txs[0].grp, 'одна запись - без группы');
  assert.strictEqual(intTx(S, d.id).length, 0);
});

test('долги: ставка - проценты остаток × ставка / 12 внутри платежа (не расход), остальное в тело', () => {
  const { S, card } = fresh();
  const cats0 = S.categories.exp.length;
  const d = owe(S, { rate: 12 });   // 1 000 000 × 12% / 12 = 10 000
  const r = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  assert.deepStrictEqual([r.interest, r.body], [10000, 20000]);
  assert.strictEqual(Engine.debtBalance(S, d.id), 980000, 'долг уменьшился на тело (платёж минус проценты)');
  assert.strictEqual(Engine.walletBalance(S, card.id), 170000, 'из кошелька ушёл весь платёж');
  assert.strictEqual(r.txs.length, 1, 'платёж - одна запись');
  assert.strictEqual(S.tx.length, 1);
  const t = S.tx[0];
  assert.deepStrictEqual([t.kind, t.op, t.amount, t.int], ['debt', 'pay', 30000, 10000]);
  assert.ok(!t.grp && !t.catId, 'без группы и категории');
  assert.ok(!S.tx.some((x) => x.kind === 'exp'), 'расхода с процентами нет');
  assert.strictEqual(S.categories.exp.length, cats0, 'категория не создана');
  assert.ok(!S.categories.exp.some((c) => c.name === 'Проценты по долгам'), 'категории «Проценты по долгам» нет');
  assert.strictEqual(Engine.summary(S, '2026-02').spent, 0, 'проценты не входят в «Потрачено»');
  assert.strictEqual(Engine.monthlyTotals(S, '2026')[1].fact, 0, 'и в расходы месяца (динамика)');
  // второй долг со ставкой - тоже без категории
  const d2 = owe(S, { name: 'Кредит', amount: 120000, pay: 5000, rate: 10 });
  Engine.payDebt(S, { debtId: d2.id, walletId: card.id, amount: 5000, date: '2026-02-16' });
  assert.ok(!S.categories.exp.some((c) => c.name === 'Проценты по долгам'));
  assert.strictEqual(Engine.walletBalance(S, card.id), 165000);
  assert.strictEqual(Engine.debtBalance(S, d2.id), 116000, '120 000 - (5 000 - 1 000 процентов)');
});

test('долги: проценты один раз за календарный месяц - второй платёж и досрочка целиком в тело', () => {
  const { S, card } = fresh();
  const d = owe(S, { rate: 12 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  const r2 = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 50000, date: '2026-02-20' });
  assert.deepStrictEqual([r2.interest, r2.body], [0, 50000], 'второй платёж месяца - без процентов');
  assert.strictEqual(Engine.debtBalance(S, d.id), 930000);
  // следующий месяц - снова проценты, от нового остатка
  const r3 = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-03-15' });
  assert.strictEqual(r3.interest, 9300);
  assert.strictEqual(r3.body, 20700);
  // досрочка сразу в первом платеже месяца: проценты те же, всё сверх - в тело
  const r4 = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 100000, date: '2026-04-01' });
  assert.strictEqual(r4.interest, Math.round(909300 * 0.01 * 100) / 100);
  assert.strictEqual(r4.body, Math.round((100000 - r4.interest) * 100) / 100);
  assert.strictEqual(intTx(S, d.id).length, 3, 'проценты - по одному разу в феврале, марте, апреле');
  // проценты больше самого платежа - весь платёж в проценты, тело 0, одна запись
  const S2 = fresh().S, w2 = S2.wallets[0];
  const big = owe(S2, { amount: 1000000, pay: 1000, rate: 24 });   // проценты 20 000
  const r5 = Engine.payDebt(S2, { debtId: big.id, walletId: w2.id, amount: 1000, date: '2026-02-15' });
  assert.deepStrictEqual([r5.interest, r5.body, r5.txs.length], [1000, 0, 1]);
  assert.strictEqual(Engine.debtBalance(S2, big.id), 1000000);
  // разбивка до записи (экран суммы показывает её заранее) = то, что запишется (Engine.previewPay, Р5 15.10)
  const S3 = fresh().S, d3 = owe(S3, { rate: 12 });
  assert.deepStrictEqual(Engine.previewPay(S3, { debtId: d3.id, amount: 30000, date: '2026-05-15' }), { interest: 10000, body: 20000, left: 0, over: false });
});

test('долги: взял в долг (долг → кошелёк), «мне должны» - одолжил и вернули; переплата - отказ', () => {
  const { S, card } = fresh();
  const d = owe(S, { rate: null });
  Engine.takeDebt(S, { debtId: d.id, walletId: card.id, amount: 50000, date: '2026-02-01' });
  assert.strictEqual(Engine.debtBalance(S, d.id), 1050000);
  assert.strictEqual(Engine.walletBalance(S, card.id), 250000);
  assert.throws(() => Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 1050000.01, date: '2026-02-02' }), /over/);
  assert.throws(() => Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 0, date: '2026-02-02' }), /amount/);
  assert.throws(() => Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 10, date: '2999-01-01' }), /date-future/);
  const o = Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 10000, now: 0, date: '2026-01-01' });
  assert.strictEqual(o.pay, 0); assert.strictEqual(o.day, null);
  Engine.payDebt(S, { debtId: o.id, walletId: card.id, amount: 5000, date: '2026-02-03' });   // одолжил ещё
  assert.strictEqual(Engine.debtBalance(S, o.id), 15000);
  assert.strictEqual(Engine.walletBalance(S, card.id), 245000);
  assert.strictEqual(intTx(S, o.id).length, 0, 'у «мне должны» процентов нет');
  Engine.takeDebt(S, { debtId: o.id, walletId: card.id, amount: 15000, date: '2026-02-04' });   // вернули
  assert.strictEqual(Engine.debtBalance(S, o.id), 0);
  assert.strictEqual(Engine.walletBalance(S, card.id), 260000);
  assert.throws(() => Engine.takeDebt(S, { debtId: o.id, walletId: card.id, amount: 1, date: '2026-02-05' }), /over/);
});

test('долги: погашен → «Отметить погашенным» → архив; пока не ноль - нельзя; удаление платежа целиком', () => {
  const { S, card } = fresh();
  const d = owe(S, { amount: 30000, rate: null });
  assert.throws(() => Engine.archiveDebt(S, d.id), /not-zero/);
  const r = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  d.remind = true;
  Engine.archiveDebt(S, d.id);
  assert.ok(d.archived && Engine.isDate(d.archivedDate) && !d.remind);
  assert.strictEqual(Engine.debtsActive(S).length, 0, 'архивный - не на главном');
  assert.strictEqual(Engine.debtHistory(S, d.id).length, 1, 'история цела');
  Engine.archiveDebt(S, d.id, false);
  assert.ok(!d.archived);
  // платёж со ставкой - одна запись: удаление возвращает весь платёж в кошелёк, тело - в долг
  const S2 = fresh(), d2 = owe(S2.S, { rate: 12 });
  const p = Engine.payDebt(S2.S, { debtId: d2.id, walletId: S2.card.id, amount: 30000, date: '2026-02-15' });
  Engine.deleteTx(S2.S, p.txs[0].id);
  assert.strictEqual(S2.S.tx.length, 0, 'платёж удалён целиком');
  assert.strictEqual(Engine.debtBalance(S2.S, d2.id), 1000000);
  assert.strictEqual(Engine.walletBalance(S2.S, S2.card.id), 200000);
  assert.ok(r.txs.length === 1);
});

test('долги: история платежей - тело и проценты одной строкой, новые сверху', () => {
  const { S, card } = fresh();
  const d = owe(S, { rate: 12 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 5000, date: '2026-02-20' });
  const h = Engine.debtHistory(S, d.id);
  assert.strictEqual(h.length, 2);
  assert.deepStrictEqual([h[0].date, h[0].total, h[0].body, h[0].interest], ['2026-02-20', 5000, 5000, 0]);
  assert.deepStrictEqual([h[1].date, h[1].total, h[1].body, h[1].interest], ['2026-02-15', 30000, 20000, 10000]);
  const pr = Engine.debtProgress(S, d.id);
  assert.strictEqual(pr.was, 1000000);
  assert.strictEqual(pr.left, 975000);
  assert.strictEqual(Math.round(pr.share * 1000) / 1000, 0.025);
});

test('долги: «Поправить остаток» - новая точка отсчёта; правка платежа/ставки/дня с проверкой', () => {
  const { S, card } = fresh();
  const d = owe(S, { rate: 12 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  Engine.setDebtBase(S, d.id, 990000, Date.now() + 10);   // банк начислил пени
  assert.strictEqual(Engine.debtBalance(S, d.id), 990000);
  // удаление «замороженного» платежа: деньги кошельку вернулись, остаток долга - по банку + тело
  const id = S.tx.find((t) => t.kind === 'debt').id;
  Engine.deleteTx(S, id);
  assert.strictEqual(Engine.walletBalance(S, card.id), 200000);
  assert.strictEqual(Engine.debtBalance(S, d.id), 1010000);
  assert.throws(() => Engine.updateDebt(S, d.id, { pay: 0 }), /pay/);
  assert.throws(() => Engine.updateDebt(S, d.id, { day: 32 }), /day/);
  assert.throws(() => Engine.updateDebt(S, d.id, { rate: 101 }), /rate/);
  assert.strictEqual(d.pay, 30000, 'неудачная правка ничего не записала');
  Engine.updateDebt(S, d.id, { name: 'Ипотека Сбер', pay: 31000, day: 31, rate: 0 });
  assert.deepStrictEqual([d.name, d.pay, d.day, d.rate], ['Ипотека Сбер', 31000, 31, null]);
  assert.throws(() => Engine.setDebtBase(S, d.id, -1), /amount/);
});

test('долги: кошелёк с операциями по долгам не удаляется; удаление долга не меняет балансов кошельков', () => {
  const { S, card, cash } = fresh();
  const d = owe(S, { rate: 12 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  Engine.takeDebt(S, { debtId: d.id, walletId: cash.id, amount: 1000, date: '2026-02-16' });
  const wBefore = [Engine.walletBalance(S, card.id), Engine.walletBalance(S, cash.id)];
  // кошелёк с платежом по долгу молча не удаляется: история долга (сроки, проценты) цела
  const dBefore = Engine.debtBalance(S, d.id), n0 = S.tx.length;
  assert.strictEqual(Engine.walletDebtTxCount(S, cash.id), 1);
  assert.strictEqual(Engine.walletDebtTxCount(S, card.id), 1, 'платёж с процентами - одна запись');
  assert.throws(() => Engine.deleteWallet(S, cash.id), /debt-ops/);
  assert.throws(() => Engine.deleteWallet(S, card.id), /debt-ops/);
  assert.ok(Engine.findWallet(S, cash.id) && S.tx.length === n0, 'кошелёк или операции пропали');
  assert.strictEqual(Engine.debtBalance(S, d.id), dBefore);
  assert.strictEqual(Engine.debtHistory(S, d.id).length, 2);
  // кошелёк без долговых операций удаляется как раньше
  const spare = Engine.addWallet(S, { name: 'Пустой', base: 0 });
  assert.strictEqual(Engine.deleteWallet(S, spare.id).name, 'Пустой');
  Engine.deleteTx(S, S.tx.find((t) => t.kind === 'debt' && t.op === 'take').id);
  Engine.deleteWallet(S, cash.id);   // долговых операций больше нет - можно
  // удаление долга: кошелёк прежний (весь платёж с процентами вшит в base), операций не осталось
  const r = Engine.deleteDebt(S, d.id);
  assert.strictEqual(r.removed, 1);
  assert.ok(wBefore[1] !== undefined);
  assert.strictEqual(Engine.walletBalance(S, card.id), wBefore[0]);
  assert.strictEqual(S.debts.length, 0);
  assert.strictEqual(S.tx.length, 0, 'платёж ушёл целиком, расходов-процентов нет');
});

test('долги: чистый капитал = кошельки + мне должны - я должен, на конец каждого месяца', () => {
  const { S, card, sal } = fresh();
  Engine.addTx(S, { kind: 'inc', amount: 100000, date: '2026-01-20', walletId: card.id, catId: sal.id });
  const d = owe(S, { rate: null, date: '2026-01-10' });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 7000, date: '2026-02-01', now: 0 });
  S.tx.forEach((t) => { t.ts = 1; });
  const jan = Engine.netCapital(S, '2026-01'), feb = Engine.netCapital(S, '2026-02');
  assert.deepStrictEqual([jan.wallets, jan.owed, jan.owe, jan.net], [305000, 0, 1000000, -695000]);
  assert.deepStrictEqual([feb.wallets, feb.owed, feb.owe, feb.net], [275000, 7000, 970000, -688000]);
  const dec = Engine.netCapital(S, '2025-12');   // долги ещё не заведены
  assert.deepStrictEqual([dec.owed, dec.owe], [0, 0]);
  const ser = Engine.netCapitalSeries(S, '2026-02', 3);
  assert.deepStrictEqual(ser.map((x) => x.ym), ['2025-12', '2026-01', '2026-02']);
  // скрытый кошелёк в капитал не входит (как в «В кошельках»)
  S.wallets[1].hidden = true;
  assert.strictEqual(Engine.netCapital(S, '2026-02').wallets, 270000);
});

test('долги: нагрузка = ежемесячные платежи / доходы; досрочка не раздувает; порог строго > 30%; нет доходов', () => {
  const { S, card, sal } = fresh();
  const d = owe(S, { rate: null, pay: 30000 });
  Engine.addTx(S, { kind: 'inc', amount: 100000, date: '2026-02-05', walletId: card.id, catId: sal.id });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  let L = Engine.debtLoad(S, '2026-02');
  assert.deepStrictEqual([L.pay, L.income, L.ratio, L.high], [30000, 100000, 0.3, false], 'ровно 30% - ещё не красный');
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 200000, date: '2026-02-20' });   // досрочка
  L = Engine.debtLoad(S, '2026-02');
  assert.strictEqual(L.pay, 30000, 'досрочка нагрузку не раздувает');
  Engine.updateDebt(S, d.id, { pay: 30100 }, '2026-02');
  // ревью 12.10 №1: срок февраля закрыт, март - тоже (досрочка 20.02 в окне мартовского срока) -
  // новый платёж действует с апреля, закрытые месяцы - по прежнему
  assert.strictEqual(Engine.debtLoad(S, '2026-02').pay, 30000, 'закрытый февраль - по прежнему платежу');
  assert.strictEqual(Engine.debtLoad(S, '2026-03').pay, 30000, 'закрытый заранее март - по прежнему платежу');
  Engine.addTx(S, { kind: 'inc', amount: 100000, date: '2026-04-05', walletId: card.id, catId: sal.id });
  assert.strictEqual(Engine.debtLoad(S, '2026-04').high, true, 'больше 30% - красный');
  assert.strictEqual(Engine.debtLoad(S, '2026-04').pct, 30.1);
  const apr = Engine.debtLoad(S, '2026-05');
  assert.strictEqual(apr.ratio, null, 'нет доходов - ratio null');
  assert.strictEqual(apr.high, false);
  assert.strictEqual(Engine.debtLoad(S, '2025-12').list.length, 0, 'до заведения долга нагрузки нет');
  // «мне должны» и погашенный в прошлом месяце долг в нагрузку не входят
  Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 5000, date: '2026-01-01', now: 0 });
  const k = owe(S, { name: 'Рассрочка', amount: 6000, pay: 6000, date: '2026-01-01' });
  Engine.payDebt(S, { debtId: k.id, walletId: card.id, amount: 6000, date: '2026-02-10' });
  Engine.archiveDebt(S, k.id);
  k.archivedDate = '2026-02-10';
  assert.deepStrictEqual(Engine.debtLoad(S, '2026-02').list.map((x) => x.name).sort(), ['Ипотека', 'Рассрочка'], 'в месяце последнего платежа - ещё в нагрузке');
  assert.deepStrictEqual(Engine.debtLoad(S, '2026-03').list.map((x) => x.name), ['Ипотека']);
  assert.ok(!Engine.hasOweDebts(Engine.defaultState()));
  assert.ok(Engine.hasOweDebts(S));
});

test('долги: дата платежа 29-31 в коротком месяце = последний день; подсветка и просрочка по датам', () => {
  assert.strictEqual(Engine.dueDate('2027-02', 31), '2027-02-28');
  assert.strictEqual(Engine.dueDate('2028-02', 31), '2028-02-29', 'високосный');
  assert.strictEqual(Engine.dueDate('2026-04', 31), '2026-04-30');
  assert.strictEqual(Engine.dueDate('2026-04', 15), '2026-04-15');
  const { S, card } = fresh();
  const d = owe(S, { day: 31, date: '2025-12-01' });
  const st = (day) => Engine.debtStatus(S, d.id, day);
  // январь: месяц после заведения, платёж не записан
  assert.deepStrictEqual([st('2026-01-30').state, st('2026-01-31').state], ['soon', 'soon'], 'в сам день - ещё не просрочка');
  assert.deepStrictEqual(st('2026-02-01'), { state: 'overdue', ym: '2026-01', due: '2026-01-31', missed: ['2026-01'] }, 'на следующий день - просрочка января');
  // февраль: дата - 28-е
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-01-31' });
  assert.strictEqual(st('2026-02-01').state, 'soon', 'январь оплачен, февраль впереди');
  assert.strictEqual(st('2026-02-28').state, 'soon');
  assert.deepStrictEqual(st('2026-03-01'), { state: 'overdue', ym: '2026-02', due: '2026-02-28', missed: ['2026-02'] }, '1 марта - просрочка февраля (31-е → 28-е)');
  // платёж в марте (с опозданием) закрывает февраль, а срок марта ещё впереди
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-03-02' });
  assert.strictEqual(st('2026-03-05').state, 'soon', 'поздний платёж за февраль - не платёж за март');
  // месяц заведения просрочкой не считается
  const S2 = fresh().S, d2 = owe(S2, { day: 5, date: '2026-10-01' });
  assert.strictEqual(Engine.debtStatus(S2, d2.id, '2026-10-03').state, 'soon');
  assert.strictEqual(Engine.debtStatus(S2, d2.id, '2026-10-20').state, 'none', 'завели в этом месяце - не просрочка');
  assert.strictEqual(Engine.debtStatus(S2, d2.id, '2026-11-06').state, 'overdue');
  // «мне должны», погашенный, архивный - ничего не подсвечивается
  const o = Engine.addDebt(S2, { type: 'owed', name: 'Саша', amount: 100, date: '2026-01-01', now: 0 });
  assert.strictEqual(Engine.debtStatus(S2, o.id, '2026-11-06').state, 'none');
  Engine.setDebtBase(S2, d2.id, 0);
  assert.strictEqual(Engine.debtStatus(S2, d2.id, '2026-11-06').state, 'none');
});

test('долги: план напоминаний - за день и в день, 10:00, 12 месяцев, без сумм; оплаченный месяц пропускаем', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 31, date: '2026-01-01', pay: 30000 });
  assert.deepStrictEqual(Engine.reminderPlan(S, new Date(2026, 9, 5).getTime(), 12), [], 'тумблер выключен - ничего');
  d.remind = true;
  const now = new Date(2026, 9, 5, 12, 0).getTime();
  const plan = Engine.reminderPlan(S, now, 12);
  assert.strictEqual(plan.length, 24);
  const at = (e) => { const x = new Date(e.at); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') + ' ' + x.getHours() + ':' + String(x.getMinutes()).padStart(2, '0'); };
  assert.deepStrictEqual(plan.slice(0, 4).map(at), ['2026-10-30 10:00', '2026-10-31 10:00', '2026-11-29 10:00', '2026-11-30 10:00']);
  assert.strictEqual(plan[0].title, 'Завтра платёж по долгу «Ипотека»');
  assert.strictEqual(plan[1].title, 'Сегодня платёж по долгу «Ипотека»');
  plan.forEach((e) => {
    assert.ok(!/\d/.test(e.title + e.text), 'в тексте уведомления нет чисел (сумм): ' + e.title);
    assert.ok(e.at > now);
    assert.ok(/вы|запишите|отметьте/i.test(e.text));
  });
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i].at >= plan[i - 1].at, 'по времени');
  // октябрь оплачен - октябрьских напоминаний нет, с ноября как обычно (долг заведён 1 октября:
  // платежи за пропущенные прошлые сроки тут не путают картину; заведи его в сентябре - платёж
  // 07.10 закрыл бы мягкий сентябрьский срок, ревью 12.10 №2)
  d.createdDate = '2026-10-01';
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-10-07' });
  const p2 = Engine.reminderPlan(S, now, 12);
  assert.strictEqual(p2.length, 22);
  assert.strictEqual(at(p2[0]), '2026-11-29 10:00');
  // день платежа сегодня, 9:00 - «сегодня» ещё впереди, «завтра» (вчера) - уже нет
  const S3 = fresh().S, d3 = owe(S3, { day: 15, date: '2026-01-01' }); d3.remind = true;
  const p3 = Engine.reminderPlan(S3, new Date(2027, 2, 15, 9, 0).getTime(), 1);
  assert.deepStrictEqual(p3.map(at), ['2027-03-15 10:00']);
  // «мне должны» с датой возврата - два события; без даты - ни одного; архив - ни одного
  const o = Engine.addDebt(S3, { type: 'owed', name: 'Саша', amount: 500, due: '2027-04-01', date: '2026-01-01', now: 0 }); o.remind = true;
  const p4 = Engine.reminderPlan(S3, new Date(2027, 2, 15, 9, 0).getTime(), 1).filter((e) => e.id.indexOf(o.id) === 0);
  assert.deepStrictEqual(p4.map(at), ['2027-03-31 10:00', '2027-04-01 10:00']);
  assert.strictEqual(p4[0].title, 'Завтра срок возврата долга «Саша»');
  Engine.setDebtBase(S3, d3.id, 0); Engine.archiveDebt(S3, d3.id);
  assert.strictEqual(Engine.reminderPlan(S3, new Date(2027, 2, 15, 9, 0).getTime(), 12).filter((e) => e.id.indexOf(d3.id) === 0).length, 0);
});

test('долги: миграция - старые данные без долгов, мусор в долгах, копия туда и обратно', () => {
  // данные 1.0.3: ключа debts нет, операции трёх видов
  const old = { ver: 1, wallets: [{ id: 'w1', name: 'Карта', base: 100, baseTs: 0 }],
    tx: [{ id: 't1', kind: 'exp', amount: 10, date: '2026-09-01', ts: 1, walletId: 'w1', catId: 'c1' },
         { id: 't2', kind: 'transfer', amount: 5, date: '2026-09-02', ts: 2, walletId: 'w1', toWalletId: 'w2' }],
    categories: { exp: [{ id: 'c1', name: 'Еда' }], inc: [] }, ui: { theme: 'light' } };
  const S = Engine.migrate(JSON.parse(JSON.stringify(old)));
  assert.deepStrictEqual(S.debts, []);
  assert.deepStrictEqual(S.tx.map((t) => t.kind), ['exp', 'transfer']);
  assert.ok(S.tx.every((t) => !('op' in t) && !('debtId' in t) && !('int' in t)));
  assert.strictEqual(Engine.walletBalance(S, 'w1'), 85);
  assert.deepStrictEqual(S.ui.debtWarn, {});
  // мусор: не массив, не объект, дубль id, кривые поля
  assert.deepStrictEqual(Engine.migrate({ wallets: [], tx: [], debts: 'x' }).debts, []);
  const g = Engine.migrate({ wallets: [], tx: [{ id: 'a', kind: 'debt', amount: 5, date: '2026-01-01' }, { id: 'b', kind: 'exp', amount: 1, date: '2026-01-01', int: 'yes', op: 'pay' }],
    debts: [null, 5, { id: 'd1', type: 'zzz', base: 'x', pay: -1, day: 99, rate: 500, remind: 'yes', archived: 1, due: 'вчера' }, { id: 'd1', name: 'дубль' }],
    ui: { debtWarn: { 'd1|2026-01': true, x: 5 } } });
  assert.strictEqual(g.debts.length, 1);
  assert.deepStrictEqual(Object.assign({}, g.debts[0], { createdDate: 'x' }), { id: 'd1', name: 'Долг', type: 'owe', base: 0, baseTs: 0, start: 0,
    pay: 0, day: null, rate: null, due: null, remind: false, order: 0, archived: false, archivedDate: null, closeAdj: false, createdDate: 'x', adj: [], payHist: [], rateHist: [] });
  assert.deepStrictEqual([g.tx[0].kind, g.tx[0].op, g.tx[0].debtId], ['debt', 'pay', '']);
  assert.ok(!('int' in g.tx[1]) && !('op' in g.tx[1]), 'метки долга у обычного расхода - вон');
  assert.deepStrictEqual(g.ui.debtWarn, { 'd1|2026-01': true });
  // копия в файл и обратно - долги и платежи на месте
  const f = fresh(), d = owe(f.S, { rate: 12 });
  Engine.payDebt(f.S, { debtId: d.id, walletId: f.card.id, amount: 30000, date: '2026-02-15' });
  d.remind = true;
  const back = Engine.importJSON(Engine.exportJSON(f.S));
  assert.deepStrictEqual(back.debts, f.S.debts);
  assert.strictEqual(Engine.debtBalance(back, d.id), 980000);
  assert.strictEqual(Engine.walletBalance(back, f.card.id), 170000);
  assert.strictEqual(back.tx.filter((t) => t.grp).length, 0);
  assert.deepStrictEqual(back.tx.map((t) => [t.kind, t.amount, t.int]), [['debt', 30000, 10000]]);
  // долги не массивом - файл битый (schema)
  const bad = JSON.parse(Engine.exportJSON(f.S)); bad.state.debts = {};
  assert.throws(() => Engine.importJSON(JSON.stringify(bad)), /schema/);
});

test('долги: free - один долг, архивный не считается, полный доступ - до предохранителя', () => {
  const S = Engine.defaultState();
  assert.strictEqual(Engine.FREE.debts, 1);
  assert.ok(Engine.canAddDebt(S, false));
  const d = owe(S, { amount: 0 });
  assert.ok(!Engine.canAddDebt(S, false), 'второй долг в free - нельзя');
  assert.ok(Engine.canAddDebt(S, true), 'в полном доступе - можно');
  Engine.archiveDebt(S, d.id);
  assert.ok(Engine.canAddDebt(S, false), 'погашенный в архиве лимит не занимает');
  for (let i = 0; i < Engine.HARD.debts; i++) owe(S, { name: 'Д' + i, amount: 0 });
  assert.ok(!Engine.canAddDebt(S, true), 'предохранитель и в полном доступе');
});

test('долги: перенос плиток - кошелёк ↔ долг; лента и «остаток на конец дня» с платежами', () => {
  assert.ok(Engine.dropAllowed('wallet', 'debt'));
  assert.ok(Engine.dropAllowed('debt', 'wallet'));
  assert.ok(!Engine.dropAllowed('debt', 'debt'));
  assert.ok(!Engine.dropAllowed('debt', 'exp'));
  assert.ok(!Engine.dropAllowed('inc', 'debt'));
  assert.ok(Engine.amountReady({ kind: 'debtpay', walletId: 'w', debtId: 'd' }));
  assert.ok(!Engine.amountReady({ kind: 'debtpay', walletId: null, debtId: 'd' }));
  const { S, card } = fresh();
  const d = owe(S, { rate: 12 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  Engine.takeDebt(S, { debtId: d.id, walletId: card.id, amount: 1000, date: '2026-02-16' });
  const days = Engine.feedByDay(S, '2026-02');
  assert.strictEqual(days[0].balanceEnd, Engine.walletsTotal(S));
  assert.strictEqual(days[1].balanceEnd, Engine.walletsTotal(S) - 1000, 'взятие в долг двигает «В кошельках»');
  assert.strictEqual(days[1].change, 0, 'платёж по долгу (и его проценты) - не расход дня');
  assert.strictEqual(Engine.walletsTotalAt(S, '2026-02-14'), 205000);
});

// Решение 13.10: «Долг погашен» при ненулевом остатке - остаток 0 событием с датой (прошлые
// месяцы не меняются) + архив; история платежей цела.
test('долги: «Долг погашен» при остатке > 0 - обнуление с даты, архив, капитал прошлых месяцев тот же', () => {
  const { S, card } = fresh();
  const d = owe(S, { amount: 100000, rate: null });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-02-15' });
  const febNet = Engine.netCapital(S, '2026-02').net, febOwe = Engine.netCapital(S, '2026-02').owe;
  assert.strictEqual(febOwe, 70000);
  Engine.closeDebt(S, d.id, '2026-03-20', 1);
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  assert.ok(d.archived, 'не ушёл в архив');
  assert.strictEqual(Engine.netCapital(S, '2026-02').net, febNet, 'капитал февраля изменился');
  assert.strictEqual(Engine.netCapital(S, '2026-02').owe, 70000, 'долг на конец февраля изменился');
  assert.strictEqual(Engine.netCapital(S, '2026-03').owe, 0, 'на конец марта долга нет');
  assert.strictEqual(Engine.debtHistory(S, d.id).filter((r) => r.total).length >= 1, true, 'история платежей пропала');
  assert.strictEqual(Engine.closeDebt(S, d.id, '2026-03-21'), null, 'архивный закрыли второй раз');
  // «мне должны» - так же
  const z = fresh();
  const o = Engine.addDebt(z.S, { type: 'owed', name: 'Саша', amount: 15000, date: '2026-01-10', now: 0 });
  Engine.closeDebt(z.S, o.id, '2026-03-01', 1);
  assert.ok(o.archived && Engine.debtBalance(z.S, o.id) === 0);
  assert.strictEqual(Engine.netCapital(z.S, '2026-02').owed, 15000, '«мне должны» на конец февраля изменилось');
});

// Решение 13.10: проценты - часть платежа. Данные сборок 1.0.4 до 13.10 (проценты расходом в
// категории «Проценты по долгам» + тело отдельной записью) сливаются при загрузке.
function oldState(extra) {
  const S = {
    ver: 1,
    wallets: [{ id: 'w1', name: 'Карта', base: 100000, baseTs: 0, order: 0 }],
    categories: { exp: [{ id: 'cF', name: 'Еда', order: 0 }, { id: 'cI', name: 'Проценты по долгам', icon: 'percent', color: 'graphite', order: 1 },
      { id: 'cZ', name: 'Кафе', order: 2 }], inc: [] },
    icons: { cI: 'percent' },
    debts: [{ id: 'd1', name: 'Кредит', type: 'owe', base: 1000000, baseTs: 0, start: 1000000, pay: 30000, day: 15, rate: 12,
      createdDate: '2026-01-10', adj: [], payHist: [{ ym: '2026-01', pay: 30000 }] }],
    tx: [
      // пара одной группой: проценты 10 000 расходом + тело 20 000
      { id: 'i1', kind: 'exp', amount: 10000, date: '2026-02-15', ts: 5, walletId: 'w1', catId: 'cI', debtId: 'd1', int: true, intLeft: 0, grp: 'g1' },
      { id: 'b1', kind: 'debt', op: 'pay', amount: 20000, date: '2026-02-15', ts: 5, walletId: 'w1', debtId: 'd1', grp: 'g1' },
      // пара без группы (той же датой и ts): проценты 9 800 + тело 20 200
      { id: 'i2', kind: 'exp', amount: 9800, date: '2026-03-15', ts: 7, walletId: 'w1', catId: 'cI', debtId: 'd1', int: true },
      { id: 'b2', kind: 'debt', op: 'pay', amount: 20200, date: '2026-03-15', ts: 7, walletId: 'w1', debtId: 'd1' },
      // проценты без тела: платёж 1 000 меньше процентов, 8 598 недоплачено
      { id: 'i3', kind: 'exp', amount: 1000, date: '2026-04-15', ts: 9, walletId: 'w1', catId: 'cI', debtId: 'd1', int: true, intLeft: 8598 },
      { id: 'e1', kind: 'exp', amount: 500, date: '2026-04-16', ts: 10, walletId: 'w1', catId: 'cF' }
    ],
    limits: {},
    ui: { order: { exp: ['cF', 'cI', 'cZ'], inc: [] } }
  };
  return Object.assign(S, extra || {});
}

test('миграция 13.10: пара «проценты расходом + тело» сливается в один платёж, сироты-проценты - в платёж', () => {
  const S = Engine.migrate(JSON.parse(JSON.stringify(oldState())));
  assert.deepStrictEqual(S.tx.map((t) => [t.id, t.kind, t.op, t.amount, t.int, t.intLeft]), [
    ['b1', 'debt', 'pay', 30000, 10000, undefined],
    ['b2', 'debt', 'pay', 30000, 9800, undefined],
    ['i3', 'debt', 'pay', 1000, 1000, 8598],
    ['e1', 'exp', undefined, 500, undefined, undefined]]);
  assert.ok(S.tx.every((t) => !('grp' in t)), 'группы больше не нужны');
  assert.strictEqual(S.tx[2].catId, null, 'сирота-проценты без категории');
  // старая модель: кошелёк минус всё (проценты + тело + расход), долг минус только тела - то же
  assert.strictEqual(Engine.walletBalance(S, 'w1'), 100000 - 30000 - 30000 - 1000 - 500, 'кошелёк тот же, что до миграции');
  assert.strictEqual(Engine.debtBalance(S, 'd1'), 1000000 - 20000 - 20200, 'долг тот же: уменьшают только тела');
  assert.strictEqual(Engine.summary(S, '2026-02').spent, 0, 'проценты февраля больше не расход');
  assert.strictEqual(Engine.summary(S, '2026-04').spent, 500, 'в апреле - только свой расход');
  assert.deepStrictEqual(Engine.debtHistory(S, 'd1').map((r) => [r.total, r.body, r.interest]),
    [[1000, 0, 1000], [30000, 20200, 9800], [30000, 20000, 10000]]);
  assert.strictEqual(Engine.previewPay(S, { debtId: 'd1', amount: 100, date: '2026-04-30' }).left, 8498, 'недоплата 8 598 переехала в платёж');
  // категория без операций и лимитов убрана вместе с порядком и иконкой
  assert.deepStrictEqual(S.categories.exp.map((c) => [c.id, c.order]), [['cF', 0], ['cZ', 1]]);
  assert.deepStrictEqual(S.ui.order.exp, ['cF', 'cZ']);
  assert.ok(!('cI' in S.icons));
  assert.strictEqual(S.ui.intCatDone, true);
  // следующий платёж: недоплата + проценты мая, как раньше
  const r = Engine.payDebt(S, { debtId: 'd1', walletId: 'w1', amount: 30000, date: '2026-05-15' });
  assert.strictEqual(r.interest, Math.round((8598 + 959800 * 0.01) * 100) / 100);
  assert.ok(!S.categories.exp.some((c) => c.name === 'Проценты по долгам'), 'и новый платёж категорию не заводит');
});

test('миграция 13.10 идемпотентна: повторный прогон и копия данных ничего не меняют', () => {
  const S1 = Engine.migrate(JSON.parse(JSON.stringify(oldState())));
  const S2 = Engine.migrate(JSON.parse(JSON.stringify(S1)));
  assert.deepStrictEqual(S2, S1);
  const back = Engine.importJSON(Engine.exportJSON(S1));
  assert.deepStrictEqual(back.tx, S1.tx);
  assert.deepStrictEqual(back.categories, S1.categories);
  assert.strictEqual(Engine.walletBalance(back, 'w1'), Engine.walletBalance(S1, 'w1'));
  assert.strictEqual(Engine.debtBalance(back, 'd1'), Engine.debtBalance(S1, 'd1'));
});

test('миграция 13.10: категория процентов остаётся, если в ней свои траты или лимит; заведённая позже - не трогается', () => {
  // свой расход в категории (не проценты долга) - категория остаётся
  const own = oldState();
  own.tx.push({ id: 'u1', kind: 'exp', amount: 300, date: '2026-04-20', ts: 11, walletId: 'w1', catId: 'cI' });
  const S1 = Engine.migrate(own);
  assert.ok(S1.categories.exp.some((c) => c.id === 'cI'), 'своя трата - категория на месте');
  assert.strictEqual(Engine.catFact(S1, 'cI', '2026-04'), 300, 'в ней только своя трата, проценты ушли в платёж');
  assert.ok(S1.ui.order.exp.includes('cI'));
  // лимит на категории - остаётся
  const S2 = Engine.migrate(oldState({ limits: { '2026-04': { cI: 15000 } } }));
  assert.ok(S2.categories.exp.some((c) => c.id === 'cI'), 'лимит - категория на месте');
  // уборка один раз: категория с тем же именем, заведённая потом человеком, остаётся
  const S3 = Engine.migrate(oldState());
  Engine.addCategory(S3, 'exp', { name: 'Проценты по долгам' });
  const S4 = Engine.migrate(JSON.parse(JSON.stringify(S3)));
  assert.strictEqual(S4.categories.exp.filter((c) => c.name === 'Проценты по долгам').length, 1);
});

// Решение 14.10 (вариант А): «Долг погашен» с кошелька - платёж payoff на весь остаток целиком в
// тело (остаток уже «к полному погашению»): долг ровно 0, кошелёк ровно минус остаток, хотя у
// месяца есть проценты. Удаление другого платежа месяца не отдаёт проценты закрывающему платежу.
// Флаг payoff переживает загрузку (migrate) и не прилипает к чужим записям.
test('долги 14.10: закрывающий платёж payoff - весь в тело, долг 0, кошелёк минус остаток, пересчёт месяца его не трогает', () => {
  const { S, card } = fresh();
  const d = owe(S, { amount: 100000, rate: 12, pay: 10000 });
  const a = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 10000, date: '2026-03-05' });
  assert.ok(a.interest > 0, 'сценарий: у первого платежа месяца есть проценты');
  // второй месяц: проценты месяца ещё не уплачены - обычный платёж их бы отделил
  const left = Engine.debtBalance(S, d.id), w0 = Engine.walletBalance(S, card.id);
  assert.ok(Engine.previewPay(S, { debtId: d.id, amount: 1000, date: '2026-04-10' }).interest > 0, 'сценарий: проценты апреля к оплате');
  const b = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 1000, date: '2026-04-02' });
  const left2 = Engine.debtBalance(S, d.id), w1 = Engine.walletBalance(S, card.id);
  const p = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: left2, date: '2026-04-10', payoff: true });
  assert.deepStrictEqual([p.interest, p.body], [0, left2], 'закрывающий платёж отделил проценты');
  assert.strictEqual(Engine.debtBalance(S, d.id), 0, 'долг не ноль');
  assert.strictEqual(Engine.walletBalance(S, card.id), Math.round((w1 - left2) * 100) / 100, 'кошелёк не минус остаток');
  assert.ok(p.txs[0].payoff === true && !p.txs[0].int, 'нет флага payoff');
  Engine.archiveDebt(S, d.id);
  // загрузка: флаг цел, у обычного платежа его нет
  const S2 = Engine.migrate(JSON.parse(JSON.stringify(S)));
  const t2 = S2.tx.filter((t) => t.id === p.txs[0].id)[0];
  assert.ok(t2.payoff === true, 'payoff потерялся при загрузке');
  assert.ok(!S2.tx.filter((t) => t.id === b.txs[0].id)[0].payoff, 'payoff у обычного платежа');
  // удалили апрельский платёж до закрытия - проценты апреля не переезжают на закрывающий
  const bBody = Math.round((1000 - (b.txs[0].int || 0)) * 100) / 100;
  Engine.deleteTx(S, b.txs[0].id);
  assert.ok(!p.txs[0].int, 'пересчёт месяца отдал проценты закрывающему платежу');
  assert.strictEqual(Engine.debtBalance(S, d.id), bBody, 'остаток после удаления - не тело удалённого платежа');
  assert.ok(left > 0 && w0 > 0);
  // «мне должны» payoff не трогает (возврат - takeDebt), флаг не ставится
  const z = fresh();
  const o = Engine.addDebt(z.S, { type: 'owed', name: 'Саша', amount: 5000, date: '2026-01-10', now: 0 });
  const r = Engine.payDebt(z.S, { debtId: o.id, walletId: z.card.id, amount: 100, date: '2026-02-01', payoff: true });
  assert.ok(!r.txs[0].payoff, 'payoff у «мне должны»');
});
