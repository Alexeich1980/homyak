/* debts-review.test.js - починка учёта долгов по адверсариальному ревью 1.0.4 (12.10.2026).
   Сроки платежей: платёж ↔ срок (оплата заранее за 25 дней, опоздание, два пропуска подряд,
   досрочка сроки вперёд не закрывает); правка платежа без переплаты; «Поправить остаток» -
   событие с датой (прошлые месяцы не меняются), нагрузка по платежу того месяца, миграция
   данных сборки 11.10; порог нагрузки по показанному числу; недоплаченные проценты копятся;
   платёж раньше заведения долга - отказ. Сценарии - из скриптов ревью (advrev104/s1.js). */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 500000 });
  card.baseTs = 0;
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  return { S, card, sal };
}
function owe(S, o) {
  return Engine.addDebt(S, Object.assign({ type: 'owe', name: 'Кредит', amount: 100000, pay: 10000, day: 1, date: '2026-08-10', now: 0 }, o || {}));
}
const pay = (S, d, w, amount, date) => Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount, date });
const st = (S, d, day) => Engine.debtStatus(S, d.id, day);

// ---------- В1+2: модель сроков ----------
test('сроки: оплата заранее 30.09 за срок 01.10 - это октябрь, ложной просрочки нет (ревью s1 #1)', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 1 });
  pay(S, d, card, 10000, '2026-09-01');
  pay(S, d, card, 10000, '2026-09-30');
  assert.deepStrictEqual(st(S, d, '2026-10-02'), { state: 'paid', ym: '2026-10', due: '2026-10-01' });
  const terms = Engine.debtTerms(S, d.id, '2026-10');
  assert.deepStrictEqual(terms.map((t) => [t.ym, t.paid, t.paidOn]), [['2026-09', true, '2026-09-01'], ['2026-10', true, '2026-09-30']]);
  // напоминаний об уже закрытом октябре нет - первое про ноябрь
  d.remind = true;
  const plan = Engine.reminderPlan(S, new Date(2026, 8, 30, 12).getTime(), 3);
  assert.ok(plan.every((e) => e.id.indexOf('|2026-10-01|') < 0), 'напоминание о закрытом сроке');
  assert.strictEqual(plan[0].id.split('|')[1], '2026-11-01');
});

test('сроки: поздний платёж за сентябрь (05.10) закрывает сентябрь, октябрь потом - просрочка (ревью s1 #2)', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 20 });
  pay(S, d, card, 10000, '2026-08-20');   // мягкий срок месяца заведения
  assert.deepStrictEqual(st(S, d, '2026-10-03'), { state: 'overdue', ym: '2026-09', due: '2026-09-20', missed: ['2026-09'] });
  pay(S, d, card, 10000, '2026-10-05');
  assert.strictEqual(st(S, d, '2026-10-06').state, 'soon', 'сентябрь закрыт, октябрь впереди');
  assert.deepStrictEqual(st(S, d, '2026-10-25'), { state: 'overdue', ym: '2026-10', due: '2026-10-20', missed: ['2026-10'] }, 'просрочка октября не спрятана');
  d.remind = true;
  const plan = Engine.reminderPlan(S, new Date(2026, 9, 6, 12).getTime(), 3).map((p) => p.id.split('|').slice(1).join('|'));
  assert.deepStrictEqual(plan.slice(0, 2), ['2026-10-20|b', '2026-10-20|d'], 'напоминание об октябре пропало');
});

test('сроки: обычный ход - платёж в срок закрывает свой месяц, до даты - мягкая подсветка, в сам день не просрочка', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 15, date: '2026-01-20' });
  assert.strictEqual(st(S, d, '2026-01-25').state, 'none', 'месяц заведения: срок 15-го уже прошёл до заведения');
  assert.strictEqual(st(S, d, '2026-02-03').state, 'soon');
  assert.strictEqual(st(S, d, '2026-02-15').state, 'soon', 'в сам день - ещё не просрочка');
  pay(S, d, card, 10000, '2026-02-15');
  assert.strictEqual(st(S, d, '2026-02-16').state, 'paid');
  pay(S, d, card, 10000, '2026-03-14');
  pay(S, d, card, 10000, '2026-04-15');
  assert.strictEqual(st(S, d, '2026-04-20').state, 'paid');
  assert.strictEqual(st(S, d, '2026-05-01').state, 'soon');
  assert.deepStrictEqual(Engine.debtTerms(S, d.id, '2026-04').slice(0, 3).map((t) => t.paid), [true, true, true]);
  // две половинки одного платежа закрывают срок вместе
  pay(S, d, card, 4000, '2026-05-10');
  assert.strictEqual(st(S, d, '2026-05-12').state, 'soon', 'неполный платёж срок не закрывает');
  pay(S, d, card, 6000, '2026-05-14');
  assert.strictEqual(st(S, d, '2026-05-16').state, 'paid');
});

test('сроки: два пропуска подряд - оба в просрочке, поздний платёж гасит самый ранний', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 10, date: '2026-01-15' });
  pay(S, d, card, 10000, '2026-02-10');
  const s1 = st(S, d, '2026-04-11');
  assert.deepStrictEqual(s1, { state: 'overdue', ym: '2026-04', due: '2026-04-10', missed: ['2026-03', '2026-04'] });
  pay(S, d, card, 10000, '2026-04-12');   // за март
  assert.deepStrictEqual(st(S, d, '2026-04-13').missed, ['2026-04'], 'платёж ушёл не в самый ранний срок');
  pay(S, d, card, 10000, '2026-04-20');   // за апрель
  assert.strictEqual(st(S, d, '2026-04-21').state, 'paid');
});

test('сроки: досрочка одной суммой гасит тело, но следующие сроки не закрывает; окно цикла - строго после прошлого срока', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 15, date: '2026-01-20', amount: 300000 });
  pay(S, d, card, 50000, '2026-02-14');     // платёж + досрочка одной суммой
  assert.strictEqual(Engine.debtBalance(S, d.id), 250000, 'тело погашено целиком');
  assert.strictEqual(st(S, d, '2026-02-20').state, 'paid');
  assert.deepStrictEqual(st(S, d, '2026-03-16'), { state: 'overdue', ym: '2026-03', due: '2026-03-15', missed: ['2026-03'] }, 'досрочка закрыла срок вперёд');
  // второй платёж в сам день февральского срока - ещё цикл февраля: мартовский срок не закрывает
  const S2 = fresh(), d2 = owe(S2.S, { day: 15, date: '2026-01-20', amount: 300000 });
  pay(S2.S, d2, S2.card, 10000, '2026-02-15');
  pay(S2.S, d2, S2.card, 40000, '2026-02-15');
  assert.strictEqual(Engine.debtTerms(S2.S, d2.id, '2026-03')[1].paid, false, 'платёж в день прошлого срока закрыл следующий');
  // на следующий день после срока - уже цикл марта: платёж засчитан заранее
  pay(S2.S, d2, S2.card, 10000, '2026-02-16');
  assert.strictEqual(Engine.debtTerms(S2.S, d2.id, '2026-03')[1].paid, true, 'платёж в цикле марта не засчитан');
  // первый срок: окно - с дня заведения долга
  const S4 = fresh(), d4 = owe(S4.S, { day: 15, date: '2026-01-20' });
  pay(S4.S, d4, S4.card, 10000, '2026-01-20');
  assert.strictEqual(Engine.debtTerms(S4.S, d4.id, '2026-02')[0].paid, true, 'платёж в день заведения не закрыл первый срок');
  // новый платёж действует с месяца правки: срок закрывает платёж своего месяца
  const S3 = fresh(), d3 = owe(S3.S, { day: 15, date: '2026-01-20' });
  Engine.updateDebt(S3.S, d3.id, { pay: 20000 }, '2026-03');
  pay(S3.S, d3, S3.card, 10000, '2026-02-15');
  pay(S3.S, d3, S3.card, 10000, '2026-03-15');
  assert.deepStrictEqual(Engine.debtTerms(S3.S, d3.id, '2026-03').slice(0, 2).map((t) => [t.pay, t.paid]), [[10000, true], [20000, false]]);
});

test('сроки: день платежа 28-е, платят 1-го того же месяца - срок 28-го закрыт, просрочки нет', () => {
  const { S, card } = fresh();
  const d = owe(S, { day: 28, date: '2026-07-05' });
  pay(S, d, card, 10000, '2026-07-28');   // мягкий срок месяца заведения
  pay(S, d, card, 10000, '2026-08-01');
  pay(S, d, card, 10000, '2026-09-01');
  assert.deepStrictEqual(st(S, d, '2026-09-29'), { state: 'paid', ym: '2026-09', due: '2026-09-28' });
  assert.strictEqual(st(S, d, '2026-08-29').state, 'paid');
  assert.deepStrictEqual(Engine.debtTerms(S, d.id, '2026-09').slice(0, 3).map((t) => [t.ym, t.paid, t.paidOn]),
    [['2026-07', true, '2026-07-28'], ['2026-08', true, '2026-08-01'], ['2026-09', true, '2026-09-01']]);
  // пропустили октябрь (ничего 1-го не заплатили) - 29.10 просрочка
  assert.deepStrictEqual(st(S, d, '2026-10-29'), { state: 'overdue', ym: '2026-10', due: '2026-10-28', missed: ['2026-10'] });
});

// ---------- В3: правка платежа ----------
test('правка платежа: переплата «я должен» - отказ (тот же заслон, что у записи), проценты учитываются', () => {
  const { S, card } = fresh();
  const d = owe(S, { name: 'Друг', amount: 5000, pay: 5000, day: 15, date: '2026-07-01' });
  const r = pay(S, d, card, 3000, '2026-10-01');
  assert.throws(() => Engine.editDebtTx(S, r.txs[0].id, { amount: 50000 }), (e) => e.message === 'over' && e.max === 5000);
  assert.strictEqual(Engine.debtBalance(S, d.id), 2000, 'неудачная правка что-то записала');
  Engine.editDebtTx(S, r.txs[0].id, { amount: 5000 });
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  assert.strictEqual(Engine.walletBalance(S, card.id), 495000);
  // со ставкой: сумма в окне - весь платёж; проценты прежние, тело = остальное
  const T = fresh(), k = owe(T.S, { amount: 120000, pay: 20000, day: 15, rate: 12, date: '2026-07-01' });
  const p = pay(T.S, k, T.card, 20000, '2026-10-05');   // проценты 1200, тело 18800
  const body = p.txs[0];
  // предел тела - остаток без этого платежа (120 000), с процентами - 121 200 всего
  assert.throws(() => Engine.editDebtTx(T.S, body.id, { amount: 121200.01 }), /over/);
  Engine.editDebtTx(T.S, body.id, { amount: 121200, date: '2026-09-15' });
  assert.strictEqual(Engine.debtBalance(T.S, k.id), 0);
  assert.deepStrictEqual(T.S.tx.map((t) => [t.kind, t.amount, t.int, t.date]), [['debt', 121200, 1200, '2026-09-15']],
    'одна запись: весь платёж, проценты внутри');
  assert.strictEqual(Engine.walletBalance(T.S, T.card.id), 500000 - 121200, 'кошелёк - на весь платёж');
  Engine.editDebtTx(T.S, body.id, { amount: 21200 });
  assert.strictEqual(Engine.debtBalance(T.S, k.id), 100000, 'проценты те же, тело 20 000');
  assert.strictEqual(Engine.walletBalance(T.S, T.card.id), 500000 - 21200);
  // «мне должны»: вернули больше, чем должны, - отказ и при правке
  const o = Engine.addDebt(T.S, { type: 'owed', name: 'Саша', amount: 1000, date: '2026-07-01', now: 0 });
  const back = Engine.takeDebt(T.S, { debtId: o.id, walletId: T.card.id, amount: 500, date: '2026-10-01' });
  assert.throws(() => Engine.editDebtTx(T.S, back.txs[0].id, { amount: 1500 }), /over/);
  Engine.editDebtTx(T.S, back.txs[0].id, { amount: 1000 });
  assert.strictEqual(Engine.debtBalance(T.S, o.id), 0);
});

// ---------- В6: «Поправить остаток» - событие с датой; нагрузка по платежу того месяца ----------
test('правка остатка - событие с датой: остаток, капитал и нагрузка прошлых месяцев не меняются', () => {
  const { S, card, sal } = fresh();
  const d = owe(S, { amount: 100000, pay: 10000, day: 15, date: '2026-07-01' });
  Engine.addTx(S, { kind: 'inc', amount: 100000, catId: sal.id, walletId: card.id, date: '2026-08-05' });
  pay(S, d, card, 10000, '2026-08-15');
  const aug = Engine.netCapital(S, '2026-08').net, balAug = Engine.debtBalanceAt(S, d.id, '2026-08-31');
  Engine.setDebtBase(S, d.id, 95000, Date.now(), '2026-10-12');   // пени +5000 сегодня
  assert.strictEqual(Engine.debtBalance(S, d.id), 95000);
  assert.strictEqual(Engine.netCapital(S, '2026-08').net, aug, 'капитал августа переписан правкой сегодня');
  assert.strictEqual(Engine.debtBalanceAt(S, d.id, '2026-08-31'), balAug);
  assert.strictEqual(Engine.debtBalanceAt(S, d.id, '2026-10-11'), 90000);
  assert.strictEqual(Engine.debtBalanceAt(S, d.id, '2026-10-12'), 95000);
  // правка в ноль сегодня: долг в августе был и в нагрузке остаётся (ревью s1 #9)
  Engine.setDebtBase(S, d.id, 0, Date.now(), '2026-10-12');
  assert.strictEqual(d.adj.length, 1, 'правки одного дня - одной записью');
  assert.strictEqual(Engine.debtLoad(S, '2026-08').pay, 10000);
  // платёж поменяли в октябре - август считается по прежнему платежу
  Engine.setDebtBase(S, d.id, 90000, Date.now(), '2026-10-12');
  Engine.updateDebt(S, d.id, { pay: 40000 }, '2026-10');
  assert.strictEqual(Engine.debtLoad(S, '2026-08').pay, 10000, 'нагрузка августа по новому платежу');
  assert.strictEqual(Engine.debtLoad(S, '2026-10').pay, 40000);
  assert.deepStrictEqual(d.payHist, [{ ym: '2026-07', pay: 10000 }, { ym: '2026-10', pay: 40000 }]);
  assert.strictEqual(Engine.payAt(d, '2026-09'), 10000);
  // копия в файл и обратно - правки и история платежа на месте
  const back = Engine.importJSON(Engine.exportJSON(S));
  assert.deepStrictEqual(back.debts, S.debts);
  assert.strictEqual(Engine.debtBalanceAt(back, d.id, '2026-08-31'), balAug);
});

test('миграция данных сборки 11.10: точка отсчёта «Поправить остаток» → правка с датой, остаток тот же', () => {
  // так хранила сборка 11.10: base/baseTs переставлены правкой, платёж до неё «вшит» в base
  const T0 = Date.UTC(2026, 6, 1), T1 = Date.UTC(2026, 9, 11, 12);
  const old = { wallets: [{ id: 'w1', name: 'Карта', base: 100000, baseTs: 0 }],
    tx: [{ id: 'p1', kind: 'debt', op: 'pay', amount: 10000, date: '2026-08-15', ts: T0 + 1000, walletId: 'w1', debtId: 'd1' },
         { id: 'p2', kind: 'debt', op: 'pay', amount: 10000, date: '2026-10-12', ts: T1 + 1000, walletId: 'w1', debtId: 'd1' }],
    debts: [{ id: 'd1', name: 'Кредит', type: 'owe', base: 95000, baseTs: T1, start: 100000, pay: 10000, day: 15, createdDate: '2026-07-01' }],
    categories: { exp: [], inc: [] } };
  const S = Engine.migrate(JSON.parse(JSON.stringify(old)));
  const d = S.debts[0];
  assert.strictEqual(Engine.debtBalance(S, 'd1'), 85000, 'остаток после миграции другой');
  assert.deepStrictEqual([d.base, d.baseTs], [100000, 0]);
  assert.deepStrictEqual(d.adj, [{ date: new Date(T1).getFullYear() + '-10-11', delta: 5000, ts: 0 }]);
  assert.strictEqual(Engine.debtBalanceAt(S, 'd1', '2026-08-31'), 90000, 'август: после платежа, без правки октября');
  assert.deepStrictEqual(d.payHist, [{ ym: '2026-07', pay: 10000 }]);
  assert.ok(!('_legacy' in d));
  // повторная миграция ничего не меняет
  assert.deepStrictEqual(Engine.migrate(JSON.parse(JSON.stringify(S))).debts, S.debts);
  // долг без правок переезжает как был
  const plain = Engine.migrate({ wallets: [], tx: [], debts: [{ id: 'd2', type: 'owe', base: 5000, baseTs: T0, start: 5000, pay: 1000, day: 1, createdDate: '2026-07-01' }] });
  assert.deepStrictEqual([plain.debts[0].base, plain.debts[0].adj, Engine.debtBalance(plain, 'd2')], [5000, [], 5000]);
});

// ---------- М3: порог нагрузки по показанному числу ----------
test('нагрузка: проценты с одним знаком, красный строго больше показанных 30,0 %', () => {
  const { S, card, sal } = fresh();
  const d = owe(S, { pay: 30004, date: '2026-07-01' });
  Engine.addTx(S, { kind: 'inc', amount: 100000, catId: sal.id, walletId: card.id, date: '2026-08-05' });
  let L = Engine.debtLoad(S, '2026-08');
  assert.deepStrictEqual([L.pct, L.high], [30, false], '30,004 % показываем «30 %» - и не красный');
  Engine.updateDebt(S, d.id, { pay: 30400 }, '2026-08');
  L = Engine.debtLoad(S, '2026-08');
  assert.deepStrictEqual([L.pct, L.high], [30.4, true]);
  Engine.updateDebt(S, d.id, { pay: 30000 }, '2026-08');
  assert.deepStrictEqual([Engine.debtLoad(S, '2026-08').pct, Engine.debtLoad(S, '2026-08').high], [30, false]);
  assert.strictEqual(Engine.debtLoad(S, '2026-09').pct, null, 'нет доходов');
});

// ---------- М5: недоплаченные проценты копятся ----------
test('проценты: платёж меньше процентов месяца - недоплата переносится на следующий платёж', () => {
  const { S, card } = fresh();
  const d = owe(S, { amount: 1000000, pay: 30000, day: 15, rate: 12, date: '2026-01-10' });   // 10 000 в месяц
  const a = pay(S, d, card, 4000, '2026-02-15');
  assert.deepStrictEqual([a.interest, a.body], [4000, 0]);
  assert.strictEqual(S.tx.find((t) => t.int).intLeft, 6000);
  assert.strictEqual(Engine.previewPay(S, { debtId: d.id, amount: 8000, date: '2026-02-20' }).interest, 6000, 'недоплата пропала');
  // второй платёж того же месяца сначала добирает недоплату
  const b = pay(S, d, card, 8000, '2026-02-20');
  assert.deepStrictEqual([b.interest, b.body], [6000, 2000]);
  // в следующем месяце: недоплата (если есть) + проценты месяца
  const c = pay(S, d, card, 1000, '2026-03-15');   // остаток 998 000 → 9 980 процентов
  assert.deepStrictEqual([c.interest, c.body], [1000, 0]);
  const e = pay(S, d, card, 30000, '2026-04-15');
  assert.strictEqual(e.interest, 8980 + 9980, 'март недоплачен на 8 980 - в апрель вместе с процентами апреля');
  // удаление платежа - недоплата снова та, что была до него
  Engine.deleteTx(S, e.txs[0].id);
  assert.strictEqual(Engine.previewPay(S, { debtId: d.id, amount: 30000, date: '2026-04-15' }).interest, 8980 + 9980);
});

// ---------- М6: платёж раньше заведения долга ----------
test('платёж датой раньше заведения долга - отказ (те платежи уже в остатке)', () => {
  const { S, card } = fresh();
  const d = owe(S, { rate: 12, day: 15, date: '2026-10-11' });
  assert.throws(() => pay(S, d, card, 10000, '2026-09-15'), /before-created/);
  assert.throws(() => Engine.takeDebt(S, { debtId: d.id, walletId: card.id, amount: 100, date: '2026-10-10' }), /before-created/);
  assert.strictEqual(S.tx.length, 0);
  const r = pay(S, d, card, 10000, '2026-10-11');   // в сам день заведения - можно
  assert.throws(() => Engine.editDebtTx(S, r.txs[0].id, { amount: 10000, date: '2026-10-01' }), /before-created/);
  assert.ok(S.tx.every((t) => t.date === '2026-10-11'));
});
