/* debts-review-c.test.js - короткое ревью 1.0.4 (13.10), движок:
   №1 «Долг погашен» с остатком: обнуление - отдельная запись {close:true}, видна в истории
      (debtCloseEvents), «Отменить»/«Вернуть из архива» снимают ровно её (reopenDebt, closedLeft),
      правка остатка того же дня с ней не сливается, копия данных её не теряет;
   №2 архивный долг с остатком не ноль (удалили его платёж, копия данных) - снова на экране
      (reopenNonZero; normalize зовёт его при загрузке). */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 200000 });
  card.baseTs = 0;
  const d = Engine.addDebt(S, { type: 'owe', name: 'Рассрочка', amount: 50000, pay: 5000, day: 5, date: '2026-01-10', now: 0 });
  const p = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 5000, date: '2026-02-05' });
  return { S, card, d, p };
}

test('№1: «Долг погашен» с остатком - запись обнуления видна в истории с датой и суммой', () => {
  const { S, d } = fresh();
  Engine.closeDebt(S, d.id, '2026-03-20', 1);
  assert.ok(d.archived && d.closeAdj, 'не в архиве или нет отметки обнуления');
  assert.deepStrictEqual(Engine.debtCloseEvents(S, d.id), [{ date: '2026-03-20', ts: 1, left: 45000 }]);
  assert.strictEqual(Engine.closedLeft(S, d.id), 45000);
});

test('№1: «Отменить»/«Вернуть из архива» снимают обнуление - остаток как был', () => {
  const { S, d } = fresh();
  const capFeb = Engine.netCapital(S, '2026-02').net;
  Engine.closeDebt(S, d.id, '2026-03-20', 1);
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  assert.strictEqual(Engine.reopenDebt(S, d.id), 45000, 'reopenDebt вернул не тот остаток');
  assert.ok(!d.archived && !d.closeAdj, 'остался в архиве');
  assert.strictEqual(Engine.debtBalance(S, d.id), 45000, 'остаток не вернулся');
  assert.deepStrictEqual(Engine.debtCloseEvents(S, d.id), [], 'строка «Отмечен погашенным» осталась');
  assert.strictEqual(Engine.netCapital(S, '2026-03').owe, 45000, 'конец марта: долг не вернулся');
  assert.strictEqual(Engine.netCapital(S, '2026-02').net, capFeb);
});

test('№1: правка остатка того же дня не сливается с обнулением, возврат снимает только его', () => {
  const { S, d } = fresh();
  Engine.setDebtBase(S, d.id, 40000, 1, '2026-03-20');           // банк насчитал меньше
  Engine.closeDebt(S, d.id, '2026-03-20', 2);
  assert.strictEqual(d.adj.length, 2, 'обнуление слилось с правкой того же дня');
  Engine.reopenDebt(S, d.id);
  assert.strictEqual(Engine.debtBalance(S, d.id), 40000, 'возврат снял и правку остатка');
  // и наоборот: после обнуления (возвращён автоматически) правка того же дня - отдельной записью
  Engine.closeDebt(S, d.id, '2026-03-20', 3);
  Engine.archiveDebt(S, d.id, false);
  Engine.setDebtBase(S, d.id, 1000, 4, '2026-03-20');
  assert.ok(d.adj[d.adj.length - 2].close && !d.adj[d.adj.length - 1].close, 'правка влилась в обнуление');
});

test('№1: закрыт при нуле - возвращать нечего; копия данных хранит обнуление', () => {
  const { S, d, card } = fresh();
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 45000, date: '2026-03-05' });
  Engine.closeDebt(S, d.id, '2026-03-20', 1);
  assert.ok(d.archived && !d.closeAdj, 'отметка обнуления при нуле');
  assert.strictEqual(Engine.closedLeft(S, d.id), 0);
  assert.strictEqual(Engine.reopenDebt(S, d.id), 0);
  assert.strictEqual(Engine.debtBalance(S, d.id), 0);
  // копия данных
  const z = fresh();
  Engine.closeDebt(z.S, z.d.id, '2026-03-20', 1);
  const M = Engine.migrate(JSON.parse(JSON.stringify(z.S)));
  const md = Engine.findDebt(M, z.d.id);
  assert.ok(md.archived && md.closeAdj, 'копия потеряла архив/отметку');
  assert.strictEqual(Engine.closedLeft(M, md.id), 45000, 'копия потеряла запись обнуления');
  assert.strictEqual(Engine.reopenDebt(M, md.id), 45000);
});

test('№2: удалили платёж архивного долга - долг снова на экране (reopenNonZero)', () => {
  const { S, d, p, card } = fresh();
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 45000, date: '2026-03-05' });
  Engine.archiveDebt(S, d.id);
  assert.deepStrictEqual(Engine.reopenNonZero(S), [], 'закрытый при нуле вернулся');
  Engine.deleteTx(S, p.txs[0].id);
  assert.strictEqual(Engine.debtBalance(S, d.id), 5000);
  assert.deepStrictEqual(Engine.reopenNonZero(S), ['Рассрочка']);
  assert.ok(!d.archived, 'архивный долг с остатком не вернулся');
  assert.ok(Engine.debtsActive(S).some((x) => x.id === d.id), 'нет среди активных');
});

test('№2: копия данных с архивным долгом, у которого остаток не ноль, - долг активный', () => {
  const { S, d } = fresh();
  d.archived = true; d.archivedDate = '2026-03-01';   // испорченная копия: архив при остатке 45 000
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  const md = Engine.findDebt(M, d.id);
  assert.ok(!md.archived && md.archivedDate === null, 'копия оставила долг с остатком в архиве');
  // отметка обнуления без записи обнуления - снимается
  const z = fresh();
  Engine.closeDebt(z.S, z.d.id, '2026-03-20', 1);
  const raw = JSON.parse(JSON.stringify(z.S));
  raw.debts[0].adj = [];
  raw.debts[0].base = 0; raw.debts[0].start = 0;
  raw.tx = raw.tx.filter((t) => t.debtId !== z.d.id);
  const M2 = Engine.migrate(raw);
  assert.strictEqual(M2.debts[0].closeAdj, false, 'отметка без записи обнуления осталась');
});
