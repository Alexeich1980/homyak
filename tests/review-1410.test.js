/* review-1410.test.js - адверсариальное ревью 1.0.4 (14.10.2026), находки 1-4: деньги на экране.
   Числа - из скриптов-доказательств ревьюера (tools/review-1410/p1, p8, p9, p2, p10, p7).
   1. Платёж задним числом в месяц, где уже есть более поздний платёж, второй раз брал
      недоплату процентов прошлого месяца - долг завышен на 500.
   2. Правка суммы платежа без смены даты и удаление платежа не пересчитывали проценты
      своего и следующих месяцев - проценты терялись или держалась недоплата удалённого.
   3. Отмена загрузки после правки загруженной «замороженной» операции меняла баланс;
      кошелёк, созданный загрузкой и получивший потом баланс, удалялся.
   4. «Закроется в …» не учитывал, что платёж этого месяца уже внесён. */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');
global.Engine = Engine;
const Import = require('../www/import.js');

function fresh(base) {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: base }); w.baseTs = 0;
  return { S, w };
}
const intOf = (S, ymStr) => S.tx.filter((t) => t.kind === 'debt' && t.date.startsWith(ymStr)).reduce((s, t) => s + (t.int || 0), 0);

test('ревью 14.10 №1: платёж задним числом не берёт недоплату процентов второй раз', () => {
  const { S, w } = fresh(500000);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 15, rate: 12, date: '2026-08-01', now: 0 });
  Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 500, date: '2026-09-15' });   // проценты 1000, недоплата 500
  Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-10-14' });
  const r = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 3000, date: '2026-10-05' });
  const all = S.tx.reduce((s, t) => s + (t.int || 0), 0);
  assert.strictEqual(all, 2000, 'проценты всего: сентябрь 1000 + октябрь 1000, недоплата 500 один раз (было 2500)');
  assert.strictEqual(Engine.debtBalance(S, d.id), 93500, 'остаток долга (было 94000 - завышен на 500)');
  assert.strictEqual(r.interest, 1500, 'платёж 05.10 - первый в октябре: недоплата 500 + проценты месяца 1000');
  assert.strictEqual(r.body, 1500, 'в тело - остальное платежа');
  assert.strictEqual(Engine.walletBalance(S, w.id), 500000 - 8500, 'кошелёк - на сумму платежей');
});

test('ревью 14.10 №2а: правка суммы без смены даты пересчитывает проценты месяца', () => {
  const { S, w } = fresh(100000);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 5, rate: 12, date: '2026-08-01', now: 0 });
  const a = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 600, date: '2026-09-05' }).txs[0];
  const b = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 4400, date: '2026-09-20' }).txs[0];
  Engine.editDebtTx(S, a.id, { amount: 300 });
  assert.strictEqual(intOf(S, '2026-09'), 1000, 'проценты сентября - 1000 (было 700: 300 ₽ исчезли)');
  assert.strictEqual(a.int, 300); assert.strictEqual(b.int, 700, 'недоплата 700 - во втором платеже');
  assert.strictEqual(Engine.debtBalance(S, d.id), 96300, 'остаток (было 96000)');
});

test('ревью 14.10 №2б: удаление платежа пересчитывает проценты следующих месяцев', () => {
  const { S, w } = fresh(100000);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 5, rate: 12, date: '2026-08-01', now: 0 });
  const a = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 600, date: '2026-09-05' }).txs[0];
  const b = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-10-05' }).txs[0];
  assert.strictEqual(b.int, 1400, 'до удаления: октябрь - недоплата 400 + 1000');
  Engine.deleteTx(S, a.id);
  assert.strictEqual(b.int, 1000, 'недоплата удалённого платежа осталась в октябре');
  assert.strictEqual(Engine.debtBalance(S, d.id), 96000, 'остаток (было 96400)');
});

test('ревью 14.10 №2в: правка суммы сентябрьского платежа меняет недоплату в октябре', () => {
  const { S, w } = fresh(100000);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 5, rate: 12, date: '2026-08-01', now: 0 });
  const a = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 600, date: '2026-09-05' }).txs[0];
  const b = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-10-05' }).txs[0];
  Engine.editDebtTx(S, a.id, { amount: 1000 });
  assert.strictEqual(a.int, 1000, 'сентябрь: платёж покрыл проценты целиком');
  assert.strictEqual(b.int, 1000, 'октябрь: недоплаты больше нет, только проценты месяца');
  assert.strictEqual(Engine.debtBalance(S, d.id), 96000);
});

test('ревью 14.10 №2г: платёж задним числом в прошлый месяц пересчитывает следующий', () => {
  const { S, w } = fresh(100000);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 5, rate: 12, date: '2026-08-01', now: 0 });
  const b = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-10-05' }).txs[0];
  const a = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 600, date: '2026-09-05' }).txs[0];
  assert.strictEqual(a.int, 600); assert.strictEqual(a.intLeft, 400, 'сентябрь: проценты от остатка 100 000');
  assert.strictEqual(b.int, 1400, 'октябрь: недоплата сентября 400 + 1000');
  assert.strictEqual(Engine.debtBalance(S, d.id), 96400);
});

function importOne(S, wallet) {
  const csv = 'Дата;Тип;Сумма;Категория;Кошелёк\n01.09.2026;Расход;3000;Еда;' + wallet + '\n';
  const f = Import.readFile(Buffer.from(csv, 'utf8'));
  const ex = Import.extract(f.rows, 0, Import.guessMapping(f.rows[0]), {});
  const nm = Import.names(S, ex.records);
  const pl = Import.plan(S, ex, nm, Import.defaultChoices(nm), { Engine });
  return { b: Import.apply(S, pl, { name: 'f' }, Engine), pl };
}

test('ревью 14.10 №3а: отмена загрузки после правки «замороженной» операции не трогает баланс', () => {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = Date.now() - 1000;   // баланс задан сегодня
  const { b, pl } = importOne(S, 'Карта');
  assert.strictEqual(pl.stats.frozen, 1, 'операция загрузки - до заданного баланса');
  assert.strictEqual(Engine.walletBalance(S, w.id), 10000);
  const t = S.tx.find((x) => x.imp === b.id);
  Engine.updateTx(S, t.id, { amount: 2000 });
  assert.strictEqual(Engine.walletBalance(S, w.id), 11000, 'правка 3000 → 2000 вернула 1000');
  Import.undo(S, b.id, Engine);
  assert.strictEqual(Engine.walletBalance(S, w.id), 10000, 'после отмены - как до загрузки (было 13 000)');
  // переживает копию данных / перезапуск: метка разморозки не теряется в migrate
  const S2 = Engine.migrate({}); S2.wallets = [];
  const w2 = Engine.addWallet(S2, { name: 'Карта', base: 10000 }); w2.baseTs = Date.now() - 1000;
  const r2 = importOne(S2, 'Карта');
  Engine.updateTx(S2, S2.tx.find((x) => x.imp === r2.b.id).id, { amount: 2000 });
  const M = Engine.migrate(JSON.parse(JSON.stringify(S2)));
  Import.undo(M, r2.b.id, Engine);
  assert.strictEqual(Engine.walletBalance(M, w2.id), 10000, 'после копии данных отмена снова дала не 10 000');
});

test('ревью 14.10 №3а: правка, потом «Изменить баланс» - отмена оставляет заданный баланс', () => {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = Date.now() - 1000;
  const { b } = importOne(S, 'Карта');
  Engine.updateTx(S, S.tx.find((x) => x.imp === b.id).id, { amount: 2000 });
  Engine.setWalletBase(S, w.id, 7000);
  w.baseTs = Date.now() + 1000;   // операция снова «до» заданного баланса
  Import.undo(S, b.id, Engine);
  assert.strictEqual(Engine.walletBalance(S, w.id), 7000, 'баланс, заданный вручную, сдвинулся');
});

test('ревью 14.10 №3б: отмена загрузки не удаляет кошелёк, которому задали баланс', () => {
  const S = Engine.migrate({}); S.wallets = [];
  const { b } = importOne(S, 'Сбер');
  const w = S.wallets.find((x) => x.name === 'Сбер');
  assert.ok(w, 'загрузка завела кошелёк');
  Engine.setWalletBase(S, w.id, 50000);
  const r = Import.undo(S, b.id, Engine);
  assert.strictEqual(r.wallets, 0, 'кошелёк с заданным балансом удалён');
  assert.ok(Engine.findWallet(S, w.id), 'кошелька «Сбер» нет');
  assert.strictEqual(Engine.walletBalance(S, w.id), 50000, 'баланс кошелька сдвинулся');
  // пустой кошелёк загрузки по-прежнему убирается
  const S2 = Engine.migrate({}); S2.wallets = [];
  const r2 = importOne(S2, 'Тинькофф');
  assert.strictEqual(Import.undo(S2, r2.b.id, Engine).wallets, 1, 'пустой кошелёк загрузки не убран');
  assert.strictEqual(S2.wallets.length, 0);
});

test('ревью 14.10 №4: «закроется в …» - платёж этого месяца уже внесён', () => {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'К', base: 100000 }); w.baseTs = 0;
  const now = Engine.today().slice(0, 7);
  const prev = Engine.addMonths(now, -1);
  const d = Engine.addDebt(S, { type: 'owe', name: 'Рассрочка', amount: 10000, pay: 5000, day: 1, date: prev + '-01', now: 0 });
  // до платежа: два платежа - этот месяц и следующий
  assert.strictEqual(Engine.debtStats(S).list[0].until, Engine.addMonths(now, 1));
  Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 5000, date: now + '-01' });
  assert.strictEqual(Engine.debtStatus(S, d.id).state, 'paid');
  const it = Engine.debtStats(S).list[0];
  assert.strictEqual(it.months, 1);
  assert.strictEqual(it.until, Engine.addMonths(now, 1), 'платёж этого месяца внесён - последний платёж в следующем (было: этот месяц)');
});

// Хвост №3а (отчёт агента 14.10): загруженную «замороженную» операцию УДАЛИЛИ (а не правили) -
// удаление вернуло её сумму в base, а отмена загрузки этого не откатывала (операции уже нет).
test('ревью 14.10 №3в: удаление загруженной операции, потом отмена загрузки - баланс как до загрузки', () => {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = Date.now() - 1000;
  const { b } = importOne(S, 'Карта');
  Engine.deleteTx(S, S.tx.find((x) => x.imp === b.id).id);
  Import.undo(S, b.id, Engine);
  assert.strictEqual(Engine.walletBalance(S, w.id), 10000, 'удаление + отмена загрузки сдвинули баланс');
  // правка, потом удаление, потом отмена (сдвиг правки уходил вместе с операцией) - и через копию данных
  const S2 = Engine.migrate({}); S2.wallets = [];
  const w2 = Engine.addWallet(S2, { name: 'Карта', base: 10000 }); w2.baseTs = Date.now() - 1000;
  const r2 = importOne(S2, 'Карта');
  const id2 = S2.tx.find((x) => x.imp === r2.b.id).id;
  Engine.updateTx(S2, id2, { amount: 2000 });
  Engine.deleteTx(S2, id2);
  const M = Engine.migrate(JSON.parse(JSON.stringify(S2)));
  Import.undo(M, r2.b.id, Engine);
  assert.strictEqual(Engine.walletBalance(M, w2.id), 10000, 'правка + удаление + отмена сдвинули баланс');
});

test('ревью 14.10 №3в: удаление, потом «Изменить баланс» - отмена оставляет заданный баланс', () => {
  const S = Engine.migrate({}); S.wallets = [];
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = Date.now() - 1000;
  const { b } = importOne(S, 'Карта');
  Engine.deleteTx(S, S.tx.find((x) => x.imp === b.id).id);
  Engine.setWalletBase(S, w.id, 7000);
  w.baseTs = Date.now() + 1000;
  Import.undo(S, b.id, Engine);
  assert.strictEqual(Engine.walletBalance(S, w.id), 7000, 'баланс, заданный вручную, сдвинулся');
});
