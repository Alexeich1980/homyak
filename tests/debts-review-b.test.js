/* debts-review-b.test.js - второе адверсариальное ревью 1.0.4 (12.10.2026), движок:
   1) смена ежемесячного платежа не «открывает» закрытые сроки (действует со следующего
      незакрытого); 2) мягкий срок месяца заведения закрывается платежом до следующего срока и
      не «перепрыгивается»; 3) кредитка: просрочка - минус на день погашения, не покрытый
      последующими пополнениями (покупки после дня погашения не в счёт); 4) удаление платежа с
      процентами - проценты месяца переходят на оставшийся первый платёж; 5) «Изменить баланс»
      кредитки - событие с датой, прошлый день погашения не трогает; 6) перенос даты платежа -
      проценты пересчитаны в обоих месяцах. Сценарии - из скриптов ревью (advrev104b/e1.js, e2.js). */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 500000 });
  card.baseTs = 0;
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  return { S, card, food };
}
const pay = (S, d, w, amount, date) => Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount, date });
// проценты платежей (с 13.10 - поле int самого платежа)
const ints = (S) => S.tx.filter((t) => t.int > 0).map((t) => t.date + ':' + t.int).sort();
function creditCard(S, payDay) {
  const cc = Engine.addWallet(S, { name: 'Кредитка', base: 0 });
  cc.baseTs = 0;
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay, remind: true }, '2026-08-01');
  return cc;
}

// ---------- №1: смена платежа ----------
test('№1 смена платежа после оплаты месяца: октябрь остаётся закрытым, новый платёж - с ноября', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 300000, pay: 10000, day: 5, date: '2026-07-01', now: 0 });
  for (const m of ['07', '08', '09', '10']) pay(S, d, card, 10000, '2026-' + m + '-05');
  Engine.updateDebt(S, d.id, { pay: 12000 }, '2026-10');
  assert.deepStrictEqual(Engine.debtStatus(S, d.id, '2026-10-20'), { state: 'paid', ym: '2026-10', due: '2026-10-05' });
  assert.strictEqual(Engine.payAt(d, '2026-10'), 10000, 'закрытый октябрь - по прежнему платежу');
  assert.strictEqual(Engine.payAt(d, '2026-11'), 12000);
  const nov = Engine.debtTerms(S, d.id, '2026-11').find((t) => t.ym === '2026-11');
  assert.deepStrictEqual([nov.pay, nov.paid], [12000, false]);
  // обратно 10000 - тоже без «открытия» октября
  Engine.updateDebt(S, d.id, { pay: 10000 }, '2026-10');
  assert.strictEqual(Engine.debtStatus(S, d.id, '2026-10-20').state, 'paid');
});

test('№1 смена платежа: незакрытый срок этого месяца - уже по новому; оплаченный заранее август - тоже закрыт', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 300000, pay: 10000, day: 15, date: '2026-06-20', now: 0 });
  // июль ещё не оплачен - новый платёж действует с июля
  Engine.updateDebt(S, d.id, { pay: 8000 }, '2026-07');
  pay(S, d, card, 8000, '2026-07-10');
  assert.strictEqual(Engine.debtStatus(S, d.id, '2026-07-16').state, 'paid', '8000 закрывают июль по новому платежу');
  // август оплачен заранее (16.07, после июльского срока) - правка в июле не трогает и его
  pay(S, d, card, 8000, '2026-07-16');
  Engine.updateDebt(S, d.id, { pay: 9000 }, '2026-07');
  const t = Engine.debtTerms(S, d.id, '2026-09');
  assert.deepStrictEqual(t.map((x) => [x.ym, x.pay, x.paid]), [['2026-07', 8000, true], ['2026-08', 8000, true], ['2026-09', 9000, false]]);
});

// ---------- №2: мягкий срок месяца заведения ----------
test('№2 мягкий срок: платёж 06.10 при дне 5 (заведён 01.10) закрывает октябрь, ноябрь открыт с напоминаниями', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 100000, pay: 10000, day: 5, date: '2026-10-01', now: 0 });
  pay(S, d, card, 10000, '2026-10-06');
  const t = Engine.debtTerms(S, d.id, '2026-11');
  assert.deepStrictEqual(t.map((x) => [x.ym, x.soft, x.paid, x.paidOn]), [['2026-10', true, true, '2026-10-06'], ['2026-11', false, false, null]]);
  assert.deepStrictEqual(Engine.debtStatus(S, d.id, '2026-11-07'), { state: 'overdue', ym: '2026-11', due: '2026-11-05', missed: ['2026-11'] });
  d.remind = true;
  const plan = Engine.reminderPlan(S, new Date(2026, 9, 6, 12).getTime(), 2).map((p) => p.id.split('|').slice(1).join('|'));
  assert.deepStrictEqual(plan, ['2026-11-05|b', '2026-11-05|d']);
});

test('№2 мягкий срок: платежа до следующего срока не было - пропускается без просрочки, платёж в день срока - следующего месяца', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 100000, pay: 10000, day: 5, date: '2026-07-01', now: 0 });
  pay(S, d, card, 10000, '2026-08-05');
  const t = Engine.debtTerms(S, d.id, '2026-08');
  assert.deepStrictEqual(t.slice(0, 2).map((x) => [x.ym, x.paid]), [['2026-07', false], ['2026-08', true]]);
  assert.strictEqual(Engine.debtStatus(S, d.id, '2026-08-10').state, 'paid');
});

// ---------- №3: кредитка - просрочки нет (упрощение 13.10 отменило расчёт «минуса на день погашения») ----------
test('№3 кредитка: статуса просрочки у кредитки нет - движок его не считает', () => {
  assert.strictEqual(Engine.creditStatus, undefined, 'просрочка кредитки вернулась в движок');
});

// ---------- №4: удаление платежа с процентами ----------
test('№4 два платежа в месяце, удалили первый (с процентами) - проценты переходят на оставшийся', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 100000, pay: 10000, day: 15, rate: 10, date: '2026-10-01', now: 0 });
  const a = pay(S, d, card, 10000, '2026-10-10');
  const b = pay(S, d, card, 10000, '2026-10-10');
  assert.deepStrictEqual([a.interest, b.interest], [833.33, 0]);
  const cardBefore = Engine.walletBalance(S, card.id);
  Engine.deleteTx(S, a.txs[0].id);
  assert.deepStrictEqual(ints(S), ['2026-10-10:833.33']);
  assert.strictEqual(Engine.debtBalance(S, d.id), 90833.33, 'тело оставшегося платежа = 10000 - проценты');
  assert.strictEqual(Engine.walletBalance(S, card.id), cardBefore + 10000, 'кошелёк вернул только удалённый платёж');
  const h = Engine.debtHistory(S, d.id);
  assert.deepStrictEqual(h.map((r) => [r.total, r.interest, r.body]), [[10000, 833.33, 9166.67]], 'одна строка: тело + проценты');
  assert.deepStrictEqual(S.tx.filter((t) => t.debtId === d.id).map((t) => [t.kind, t.amount, t.int]), [['debt', 10000, 833.33]],
    'платёж - одна запись, проценты внутри');
});

// ---------- №5: «Изменить баланс» кредитки ----------
test('№5 кредитка: «Изменить баланс» сегодня не меняет остаток и капитал прошлых дней', () => {
  const { S } = fresh();
  const cc = creditCard(S, 10);
  Engine.setWalletBase(S, cc.id, -3000, '2026-10-12');
  assert.strictEqual(Engine.walletBalance(S, cc.id), -3000);
  assert.strictEqual(Engine.walletBalanceAt(S, cc.id, '2026-10-10'), 0, 'на 10-е карта была в нуле');
  assert.strictEqual(Engine.netCapital(S, '2026-09').credit, 0, 'сентябрьский капитал без сегодняшней правки');
  // правка раньше дня - в нём учтена
  const z = fresh(), c2 = creditCard(z.S, 10);
  Engine.setWalletBase(z.S, c2.id, -3000, '2026-10-08');
  assert.strictEqual(Engine.walletBalanceAt(z.S, c2.id, '2026-10-10'), -3000);
  // правка переживает копию данных
  const back = Engine.migrate(JSON.parse(JSON.stringify(z.S)));
  assert.deepStrictEqual(back.wallets.find((w) => w.id === c2.id).adj, [{ date: '2026-10-08', delta: -3000 }]);
});

// ---------- №6: перенос даты платежа в другой месяц ----------
test('№6 перенос октябрьского платежа в сентябрь: проценты только в первом платеже сентября, у октября - нет', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 120000, pay: 20000, day: 15, rate: 12, date: '2026-07-01', now: 0 });
  pay(S, d, card, 20000, '2026-09-15');
  const b = pay(S, d, card, 20000, '2026-10-05');
  assert.deepStrictEqual(ints(S), ['2026-09-15:1200', '2026-10-05:1012']);
  Engine.editDebtTx(S, b.txs[0].id, { amount: 20000, date: '2026-09-20' });
  assert.deepStrictEqual(ints(S), ['2026-09-15:1200']);
  assert.strictEqual(Engine.debtBalance(S, d.id), 81200, '120000 - 18800 - 20000');
});

test('№6 перенос первого платежа сентября (с процентами) в октябрь: проценты октября - в нём, второй октябрьский - без процентов', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 120000, pay: 20000, day: 15, rate: 12, date: '2026-07-01', now: 0 });
  const a = pay(S, d, card, 20000, '2026-09-15');
  pay(S, d, card, 20000, '2026-10-05');
  Engine.editDebtTx(S, a.txs[0].id, { amount: 20000, date: '2026-10-01' });
  assert.deepStrictEqual(ints(S), ['2026-10-01:1200'], 'остаток до 01.10 = 120000 → 1200; 05.10 - уже без процентов');
  assert.strictEqual(Engine.debtBalance(S, d.id), 81200);
});

test('№6 перенос из месяца, где остался другой платёж: проценты переходят на него, в новом месяце - на первый', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'К', amount: 120000, pay: 20000, day: 15, rate: 12, date: '2026-07-01', now: 0 });
  const a = pay(S, d, card, 20000, '2026-09-15');
  pay(S, d, card, 20000, '2026-09-20');
  pay(S, d, card, 20000, '2026-10-05');
  Engine.editDebtTx(S, a.txs[0].id, { amount: 20000, date: '2026-10-01' });
  assert.deepStrictEqual(ints(S), ['2026-09-20:1200', '2026-10-01:1012'], 'сентябрь: 120000 → 1200; октябрь: 101200 → 1012');
  assert.strictEqual(Engine.debtBalance(S, d.id), 62212);
});
