/* credit.test.js - отметка «Кредитная карта» у кошелька (1.0.4, решение 12.10.2026, упрощение
   13.10.2026, docs/1.0.4-dolgi-koncepciya.md, раздел «Кредитная карта»). Кредитка остаётся
   кошельком: «день платежа по карте» (необязательный), напоминание накануне и в день в 10:00
   (только пока карта в минусе), просрочки и баннера у кредитки нет никогда, «Капитал и
   обязательства» - минус кредиток отдельной строкой без задвоения капитала, в нагрузку не
   входит, отметка в free не ограничена, переживает копию данных. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 100000 });
  const cc = Engine.addWallet(S, { name: 'Кредитка', base: 0 });
  card.baseTs = 0; cc.baseTs = 0;
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  return { S, card, cc, food, sal };
}
function spend(S, w, amount, date, food) { return Engine.addTx(S, { kind: 'exp', amount, date, walletId: w.id, catId: food.id }); }
function topUp(S, from, to, amount, date) { return Engine.addTx(S, { kind: 'transfer', amount, date, walletId: from.id, toWalletId: to.id }); }

test('кредитка: отметка, день платежа, напоминание - поля и проверки', () => {
  const { S, cc } = fresh();
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 15, remind: true });
  assert.deepStrictEqual([cc.credit, cc.payDay, cc.remind], [true, 15, true]);
  // без дня платежа напоминание не включается
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: null, remind: true });
  assert.deepStrictEqual([cc.payDay, cc.remind], [null, false]);
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 20, remind: false });
  assert.deepStrictEqual([cc.payDay, cc.remind], [20, false]);
  assert.ok(!('creditDate' in cc), 'дата отметки (нужна была только просрочке) не пишется');
  assert.throws(() => Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 32 }), /day/);
  assert.throws(() => Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 2.5 }), /day/);
  // снятая отметка - полей нет вовсе
  Engine.setWalletCredit(S, cc.id, { credit: false });
  assert.deepStrictEqual(['credit', 'payDay', 'remind', 'creditDate'].filter((k) => k in cc), []);
});

test('кредитка: миграция и копия данных сохраняют отметку, мусор и старое поле чистятся', () => {
  const { S, cc, card } = fresh();
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 31, remind: true });
  const back = Engine.importJSON(Engine.exportJSON(S));
  const w = Engine.findWallet(back, cc.id);
  assert.deepStrictEqual([w.credit, w.payDay, w.remind], [true, 31, true]);
  assert.ok(!('credit' in Engine.findWallet(back, card.id)), 'обычный кошелёк без полей кредитки');
  // мусор: день вне 1-31 → нет дня и нет напоминания; не true - отметки нет;
  // creditDate из сборки 12.10 (копия с телефона) - убирается
  const raw = JSON.parse(JSON.stringify(S));
  raw.wallets[1].payDay = 40; raw.wallets[0].credit = 'yes'; raw.wallets[0].payDay = 5; raw.wallets[1].creditDate = '2026-06-01';
  const m = Engine.migrate(raw);
  assert.deepStrictEqual([m.wallets[1].payDay, m.wallets[1].remind], [null, false]);
  assert.ok(!('creditDate' in m.wallets[1]), 'старая дата отметки осталась');
  assert.ok(!('credit' in m.wallets[0]) && !('payDay' in m.wallets[0]));
});

// Упрощение 13.10: у кредитки баннера просрочки нет никогда - ни в движке (нет статуса),
// ни на экране (баннер долга знает только долги). Покупка, пропущенный день платежа,
// минус месяцами - всё равно молчим; остаётся только напоминание.
test('кредитка: баннера просрочки нет никогда - ни статуса в движке, ни ветки на экране', () => {
  assert.strictEqual(Engine.creditStatus, undefined, 'в движке снова считается просрочка кредитки');
  const d = fs.readFileSync(path.join(__dirname, '..', 'www', 'debts.js'), 'utf8');
  const pw = /function pendingWarn\(todayStr\) \{([\s\S]*?)\n\}/.exec(d);
  assert.ok(pw, 'нет pendingWarn');
  assert.ok(!/wallets|credit/.test(pw[1].replace(/\/\/[^\n]*/g, '')), 'баннер снова смотрит на кошельки/кредитки');
  assert.ok(d.indexOf('Карта не погашена') < 0, 'текст баннера кредитки вернулся');
  // минус месяцами после дня платежа - статус долгов про кредитку ничего не знает
  const { S, cc, food } = fresh();
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 5, remind: true });
  spend(S, cc, 10000, '2026-01-10', food);
  assert.deepStrictEqual(Engine.debtsActive(S), [], 'кредитка попала в долги');
});

test('кредитка: 31-е в коротком месяце - напоминание на последний день', () => {
  const { S, cc, food } = fresh();
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 31, remind: true });
  spend(S, cc, 5000, '2026-01-10', food);
  const plan = Engine.reminderPlan(S, new Date(2026, 1, 1, 12, 0, 0).getTime(), 2);
  assert.deepStrictEqual(plan.map((e) => e.id.split('|')[1]).filter((x, i, a) => a.indexOf(x) === i), ['2026-02-28', '2026-03-31']);
});

test('кредитка: напоминания накануне и в день в 10:00, только пока карта в минусе, без сумм', () => {
  const { S, card, cc, food } = fresh();
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 15, remind: true }, '2026-06-01');
  const now = new Date(2026, 6, 1, 12, 0, 0).getTime();
  assert.strictEqual(Engine.reminderPlan(S, now, 12).length, 0, 'карта не в минусе - напоминать не о чем');
  spend(S, cc, 12345, '2026-06-30', food);
  const plan = Engine.reminderPlan(S, now, 12);
  assert.strictEqual(plan.length, 24, '12 месяцев × накануне и в день');
  assert.deepStrictEqual(plan.slice(0, 2).map((e) => e.id), [cc.id + '|2026-07-15|b', cc.id + '|2026-07-15|d']);
  assert.strictEqual(plan[0].at, new Date(2026, 6, 14, 10, 0, 0).getTime());
  assert.strictEqual(plan[1].at, new Date(2026, 6, 15, 10, 0, 0).getTime());
  assert.strictEqual(plan[0].title, 'Завтра платёж по кредитной карте «Кредитка»');
  assert.strictEqual(plan[1].title, 'Сегодня платёж по кредитной карте «Кредитка»');
  plan.forEach((e) => assert.ok(!/\d/.test(e.text) && !/12\s?345/.test(e.title), 'сумма в напоминании: ' + e.title + ' / ' + e.text));
  // выключили напоминание / скрыли / закрыли минус - плана нет
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 15, remind: false }, '2026-06-01');
  assert.strictEqual(Engine.reminderPlan(S, now, 12).length, 0);
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 15, remind: true }, '2026-06-01');
  Engine.updateWallet(S, cc.id, { hidden: true });
  assert.strictEqual(Engine.reminderPlan(S, now, 12).length, 0);
  Engine.updateWallet(S, cc.id, { hidden: false });
  topUp(S, card, cc, 12345, '2026-07-01');
  assert.strictEqual(Engine.reminderPlan(S, now, 12).length, 0);
});

test('кредитка: капитал - минус отдельной строкой, без задвоения; нагрузка без кредиток', () => {
  const { S, card, cc, food, sal } = fresh();
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 15 }, '2026-06-01');
  Engine.addTx(S, { kind: 'inc', amount: 100000, date: '2026-07-01', walletId: card.id, catId: sal.id });
  spend(S, cc, 30000, '2026-07-10', food);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 50000, pay: 5000, day: 20, date: '2026-07-01', now: 0 });
  const c = Engine.netCapital(S, '2026-07');
  assert.strictEqual(c.wallets, 170000, 'в кошельках уже с минусом кредитки');
  assert.strictEqual(c.credit, -30000);
  assert.strictEqual(c.own, 200000);
  assert.strictEqual(c.net, 120000, 'капитал = 170 000 - 50 000, минус кредитки второй раз не вычтен');
  assert.strictEqual(c.own + c.credit + c.owed - c.owe, c.net, 'строки складываются в капитал');
  // июнь: карта ещё не в минусе
  assert.strictEqual(Engine.netCapital(S, '2026-06').credit, 0);
  // кредитка с плюсом - не долг
  topUp(S, card, cc, 40000, '2026-07-11');
  assert.strictEqual(Engine.netCapital(S, '2026-07').credit, 0);
  // нагрузка: только ежемесячный платёж кредита
  const L = Engine.debtLoad(S, '2026-07');
  assert.deepStrictEqual(L.list.map((x) => x.id), [d.id]);
  assert.strictEqual(L.pay, 5000);
});

test('кредитка: free - отметка не ограничена, кредитка не долг', () => {
  const { S, card, cc } = fresh();
  Engine.setWalletCredit(S, card.id, { credit: true, payDay: 1, remind: true });
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 2, remind: true });
  assert.ok(card.credit && cc.credit, 'две кредитки в free');
  assert.ok(Engine.canAddDebt(S, false), 'кредитки не занимают бесплатный долг');
  assert.strictEqual(Engine.walletsActiveCount(S), 2, 'кредитка считается обычным кошельком');
  assert.ok(Engine.hasCreditCards(S));
  Engine.updateWallet(S, card.id, { hidden: true }); Engine.updateWallet(S, cc.id, { hidden: true });
  assert.ok(!Engine.hasCreditCards(S), 'скрытые кредитки «Капитал и обязательства» не открывают');
});
