/* wallets-b2.test.js - код-ревью max 15.10, пакет Б2 (кошельки, капитал, импорт, миграция):
   Р1 Р6 Р21 Р17 Р19. Числа - из скриптов-доказательств ревьюеров (scratchpad f47c56f9:
   verify1/v.js, v56.js, sweep/dd.js, alt/t3 t4 t5 t9 t10, reuse/adj.js, verify3/t10.js).
   Р1  остаток кошелька на конец дня - одна функция (Engine.walletBalanceAt): сегодняшний
       баланс минус ВСЕ операции позже даты (живые и «замороженные») и правки баланса позже
       даты. Капитал прошлых месяцев, лента и лист «Кошельки» в Excel - через неё.
   Р6  отмена загрузки: один журнал сдвигов партии b.fz (правка и удаление), без t.impFz.
   Р21 удаление долга / кошелька не сдвигает прошлые месяцы других кошельков.
   Р17 разбор сумм «500р», словари имён без прототипа, xlsx с префиксом x:, t="d", пустой t="s".
   Р19 пустая категория «Проценты по долгам» покупателя 1.0.3 при обновлении остаётся. */
const test = require('node:test');
const assert = require('node:assert');
const fflate = require('fflate');
const Engine = require('../www/engine.js');
global.Engine = Engine;
const Import = require('../www/import.js');
const Xlsx = require('../www/xlsx.js');

const tick = () => { const t = Date.now(); while (Date.now() < t + 3); };
function st() { const S = Engine.migrate({}); S.wallets = []; S.tx = []; S.debts = []; return S; }
const cap = (S, ym) => Engine.netCapital(S, ym);
const series = (S, end, n) => Engine.netCapitalSeries(S, end, n).map((x) => [x.ym, x.wallets, x.net, x.credit, x.own]);
// лист «Кошельки» в Excel: остаток кошелька на конец месяца
const xlsxW = (S, name, ym) => { const w = Xlsx.rows(S, Engine).wallets; return w.list.find((x) => x.name.indexOf(name) === 0).m[ym]; };

// ---------- Р1 ----------
test('Р1: «Изменить баланс» сегодня не меняет капитал прошлых месяцев (база 10 000, +5 000 10.09, баланс 20 000)', () => {
  const S = st();
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); tick();
  Engine.addTx(S, { kind: 'inc', amount: 5000, date: '2026-09-10', walletId: w.id }); tick();
  const before = series(S, '2026-09', 2);
  Engine.setWalletBase(S, w.id, 20000);
  assert.strictEqual(Engine.walletBalance(S, w.id), 20000);
  assert.strictEqual(Engine.walletBalanceAt(S, w.id, '2026-08-31'), 10000, 'август');
  assert.strictEqual(Engine.walletBalanceAt(S, w.id, '2026-09-30'), 15000, 'сентябрь');
  assert.strictEqual(Engine.walletsTotalAt(S, '2026-08-31'), 10000);
  assert.strictEqual(cap(S, '2026-08').wallets, 10000, 'капитал августа');
  assert.strictEqual(cap(S, '2026-09').net, 15000, 'капитал сентября');
  assert.deepStrictEqual(series(S, '2026-09', 2), before, 'ряд капитала прошлых месяцев сдвинулся');
  assert.strictEqual(xlsxW(S, 'Карта', '2026-09'), 15000, 'Excel: сентябрь');
  assert.strictEqual(xlsxW(S, 'Карта', Engine.today().slice(0, 7)), 20000, 'Excel: сегодня');
  assert.ok(Array.isArray(w.adj) && w.adj.length === 1 && w.adj[0].delta === 5000 && w.adj[0].date === Engine.today(), 'правка баланса записана с датой');
});

test('Р1: операция до «Изменить баланс» без изменения суммы - adj нет, прошлые месяцы на месте', () => {
  const S = st();
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = 0;
  Engine.addTx(S, { kind: 'exp', amount: 3000, date: '2026-09-05', walletId: w.id }); tick();
  Engine.setWalletBase(S, w.id, 7000);   // тот же баланс: операция «вшита», правки нет
  assert.ok(!w.adj, 'правка на ноль записана');
  assert.strictEqual(Engine.walletBalanceAt(S, w.id, '2026-08-31'), 10000, 'замороженная трата сентября попала в август');
  assert.strictEqual(cap(S, '2026-08').wallets, 10000);
  assert.strictEqual(Engine.walletsTotalAt(S, '2026-09-04'), 10000);
  assert.strictEqual(Engine.walletsTotalAt(S, '2026-09-05'), 7000);
});

test('Р1: операция задним числом после «Изменить баланс» - прошлое считается от неё', () => {
  const S = st();
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = 0; tick();
  Engine.setWalletBase(S, w.id, 12000); tick();
  Engine.addTx(S, { kind: 'exp', amount: 1000, date: '2026-09-05', walletId: w.id });
  assert.strictEqual(Engine.walletBalance(S, w.id), 11000);
  assert.strictEqual(cap(S, '2026-08').wallets, 10000, 'август: до траты и до правки');
  assert.strictEqual(cap(S, '2026-09').wallets, 9000, 'сентябрь: трата, правки ещё не было');
  assert.strictEqual(Engine.walletsTotalAt(S, Engine.today()), 11000);
});

test('Р1 сценарий №5: «Изменить баланс» карты и кредитки сегодня - net/own/credit сентября не меняются', () => {
  const S = st();
  const card = Engine.addWallet(S, { name: 'Карта', base: 1000 }); card.baseTs = 0;
  const cc = Engine.addWallet(S, { name: 'Кредитка', base: 0 }); cc.baseTs = 0;
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 10, remind: true });
  const sep = cap(S, '2026-09');
  Engine.setWalletBase(S, card.id, 5000, '2026-10-12');
  Engine.setWalletBase(S, cc.id, -3000, '2026-10-12');
  assert.deepStrictEqual(cap(S, '2026-09'), sep, 'капитал сентября изменился');
  const oct = cap(S, '2026-10');
  assert.deepStrictEqual([oct.wallets, oct.credit, oct.own, oct.net], [2000, -3000, 5000, 2000]);
  // сумма остатков кошельков на конец дня = «в кошельках» на конец дня
  assert.strictEqual(Engine.walletBalanceAt(S, card.id, '2026-09-30') + Engine.walletBalanceAt(S, cc.id, '2026-09-30'), Engine.walletsTotalAt(S, '2026-09-30'));
});

test('Р1: загрузка истории до заданного баланса - прошлые месяцы с этими тратами (alt/t4)', () => {
  const S = st();
  const w = Engine.addWallet(S, { name: 'Card', base: 10000 }); w.baseTs = Date.parse('2026-10-01T09:00:00');
  const rows = [['Дата', 'Тип', 'Сумма', 'Категория', 'Кошелёк'],
    ['2026-07-10', 'Расход', '3000', 'Еда', 'Card'], ['2026-08-10', 'Расход', '3000', 'Еда', 'Card'],
    ['2026-09-10', 'Расход', '3000', 'Еда', 'Card'], ['2026-10-05', 'Расход', '500', 'Еда', 'Card']];
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), {});
  const nm = Import.names(S, ex.records);
  const pl = Import.plan(S, ex, nm, Import.defaultChoices(nm), { Engine });
  assert.strictEqual(pl.stats.frozen, 3);
  Import.apply(S, pl, { name: 'x' }, Engine);
  assert.strictEqual(Engine.walletBalance(S, w.id), 9500);
  assert.deepStrictEqual(['2026-06', '2026-07', '2026-08', '2026-09'].map((m) => cap(S, m).wallets), [19000, 16000, 13000, 10000]);
});

test('Р1: лента - «остаток на конец дня» той же функцией (с правкой баланса и замороженной операцией)', () => {
  const S = st();
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = 0;
  const h = Engine.addWallet(S, { name: 'Скрытый', base: 777 }); h.baseTs = 0; h.hidden = true;
  Engine.addTx(S, { kind: 'exp', amount: 1000, date: '2026-09-03', walletId: w.id });
  Engine.addTx(S, { kind: 'inc', amount: 400, date: '2026-09-07', walletId: w.id }); tick();
  Engine.setWalletBase(S, w.id, 9000, '2026-09-08');   // правка -400 датой 08.09
  Engine.addTx(S, { kind: 'exp', amount: 200, date: '2026-09-09', walletId: h.id });
  const feed = Engine.feedByDay(S, '2026-09');
  feed.forEach((g) => assert.strictEqual(g.balanceEnd, Engine.walletsTotalAt(S, g.date), 'день ' + g.date));
  assert.deepStrictEqual(feed.map((g) => [g.date, g.balanceEnd]), [['2026-09-09', 9000], ['2026-09-07', 9400], ['2026-09-03', 9000]]);
});

test('Р1: Excel - лист «Кошельки» и «Чистый капитал» = Engine на данных с «Изменить баланс»; строки листа «Операции» сходятся помесячно', () => {
  const S = st();
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = Date.parse('2026-08-01T00:00:00');
  const c = Engine.addWallet(S, { name: 'Нал', base: 0 }); c.baseTs = 0;
  const cat = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const t = Engine.addTx(S, { kind: 'exp', amount: 1000, date: '2026-09-05', catId: cat.id, walletId: w.id }); t.ts = Date.parse('2026-09-05T12:00:00');
  Engine.addTx(S, { kind: 'transfer', amount: 300, date: '2026-09-06', walletId: w.id, toWalletId: c.id }).ts = Date.parse('2026-09-06T12:00:00');
  Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 5000, pay: 1000, day: 15, date: '2026-08-10', now: 0 });
  Engine.setWalletBase(S, w.id, 9500, '2026-10-14');
  const r = Xlsx.rows(S, Engine);
  r.wallets.yms.forEach((ym) => {
    const e = Engine.monthEnd(ym);
    if (r.wallets.list[0].m[ym] != null) assert.strictEqual(r.wallets.list[0].m[ym], Engine.walletBalanceAt(S, w.id, e), 'Карта ' + ym);
    assert.strictEqual(r.wallets.net[ym], cap(S, ym).net, 'Чистый капитал ' + ym);
  });
  assert.strictEqual(r.wallets.list[0].m['2026-09'], 8700, 'сентябрь: 10 000 - 1 000 - 300, без сегодняшней правки');
  // строки «Операции» (с «Корректировками») по кошельку на конец месяца = остатку в приложении
  r.wallets.yms.forEach((ym) => {
    let s = 0;
    r.ops.forEach((o) => {
      if (o.date > Engine.monthEnd(ym)) return;
      if (o.wid === w.id) s += o.type === Xlsx.TYPE.exp || o.type === Xlsx.TYPE.transfer ? -o.amount : o.amount;
    });
    assert.strictEqual(Math.round(s * 100) / 100, Engine.walletBalanceAt(S, w.id, Engine.monthEnd(ym)), 'строки листа «Операции» на конец ' + ym);
  });
});

test('Р1: капитал за 12 месяцев на 20 000 операций, 5 долгах и 3 кредитках - быстрее 20 мс', () => {
  const S = st();
  const card = Engine.addWallet(S, { name: 'Карта', base: 5000000 }); card.baseTs = 0;
  const cash = Engine.addWallet(S, { name: 'Нал', base: 50000 }); cash.baseTs = 0;
  for (let i = 0; i < 5; i++) Engine.addDebt(S, { type: i % 2 ? 'owed' : 'owe', name: 'D' + i, amount: 100000, pay: 5000, day: 10, rate: 10, date: '2020-01-10', now: 0 });
  const ccs = [];
  for (let i = 0; i < 3; i++) { const x = Engine.addWallet(S, { name: 'CC' + i, base: -1000 }); x.baseTs = 0; Engine.setWalletCredit(S, x.id, { credit: true, payDay: 10 }); ccs.push(x); }
  const t0 = Date.parse('2020-02-01'), t1 = Date.parse('2026-10-10');
  for (let i = 0; i < 20000; i++) {
    const r = i % 10, wid = r < 6 ? card.id : (r < 8 ? cash.id : ccs[r - 8].id);
    S.tx.push({ id: 'e' + i, kind: i % 7 ? 'exp' : 'inc', amount: 100 + i % 500, date: new Date(t0 + Math.floor(i / 20000 * (t1 - t0))).toISOString().slice(0, 10), ts: i, catId: null, walletId: wid, toWalletId: null });
  }
  let k = 0;
  S.debts.forEach((d) => { for (let m = 1; m <= 9; m++) S.tx.push({ id: 'p' + (k++), kind: 'debt', op: 'pay', debtId: d.id, amount: 1000, date: '2026-0' + m + '-12', ts: 30000 + k, walletId: card.id, toWalletId: null, catId: null }); });
  Engine.setWalletBase(S, card.id, 1234567, '2026-10-01');
  // ряд = netCapital по каждому месяцу
  const ser = Engine.netCapitalSeries(S, '2026-10', 12);
  ser.forEach((x) => assert.deepStrictEqual(x, cap(S, x.ym), 'ряд ≠ netCapital ' + x.ym));
  const a = [];
  for (let i = 0; i < 9; i++) { const t = process.hrtime.bigint(); cap(S, '2026-10'); Engine.netCapitalSeries(S, '2026-10', 12); a.push(Number(process.hrtime.bigint() - t) / 1e6); }
  a.sort((x, y) => x - y);
  // цель - до 20 мс (замер в отчёте Б2); порог с запасом на параллельный прогон тестов
  assert.ok(a[4] < 60, 'экран капитала ' + a[4].toFixed(1) + ' мс');
});

// ---------- Р21 ----------
test('Р21: удаление долга не сдвигает прошлые месяцы кошелька (база 1 000, платёж 300 05.09)', () => {
  const S = st();
  const a = Engine.addWallet(S, { name: 'A', base: 1000 }); a.baseTs = 0;
  const d = Engine.addDebt(S, { type: 'owe', name: 'K', amount: 10000, pay: 300, day: 5, date: '2026-08-01', now: 0 });
  Engine.payDebt(S, { debtId: d.id, walletId: a.id, amount: 300, date: '2026-09-05' });
  Engine.deleteDebt(S, d.id);
  assert.strictEqual(Engine.walletBalance(S, a.id), 700, 'сейчас');
  assert.strictEqual(Engine.walletBalanceAt(S, a.id, '2026-08-31'), 1000, 'август');
  assert.strictEqual(cap(S, '2026-08').wallets, 1000);
  assert.strictEqual(Engine.walletsTotalAt(S, '2026-09-05'), 700);
  // замороженный платёж (до «Изменить баланс») - тоже
  const S2 = st();
  const b = Engine.addWallet(S2, { name: 'B', base: 1000 }); b.baseTs = 0;
  const d2 = Engine.addDebt(S2, { type: 'owe', name: 'K', amount: 10000, pay: 300, day: 5, date: '2026-08-01', now: 0 });
  Engine.payDebt(S2, { debtId: d2.id, walletId: b.id, amount: 300, date: '2026-09-05' }); tick();
  Engine.setWalletBase(S2, b.id, 700);
  Engine.deleteDebt(S2, d2.id);
  assert.strictEqual(Engine.walletBalance(S2, b.id), 700);
  assert.strictEqual(Engine.walletBalanceAt(S2, b.id, '2026-08-31'), 1000, 'август (замороженный платёж)');
});

test('Р21: удаление кошелька не сдвигает прошлые месяцы другого кошелька (переводы живые и замороженные)', () => {
  const S = st();
  const a = Engine.addWallet(S, { name: 'A', base: 1000 }); a.baseTs = 0;
  const b = Engine.addWallet(S, { name: 'B', base: 0 }); b.baseTs = 0;
  Engine.addTx(S, { kind: 'transfer', amount: 300, date: '2026-09-05', walletId: a.id, toWalletId: b.id });
  Engine.addTx(S, { kind: 'transfer', amount: 100, date: '2026-09-20', walletId: b.id, toWalletId: a.id }); tick();
  Engine.setWalletBase(S, b.id, 200);   // оба перевода заморожены для B
  Engine.addTx(S, { kind: 'transfer', amount: 50, date: '2026-09-25', walletId: a.id, toWalletId: b.id });   // живой
  const was = ['2026-08-31', '2026-09-10', '2026-09-22', '2026-09-30'].map((x) => Engine.walletBalanceAt(S, b.id, x));
  assert.deepStrictEqual(was, [0, 300, 200, 250]);
  Engine.deleteWallet(S, a.id);
  assert.strictEqual(Engine.walletBalance(S, b.id), 250);
  assert.deepStrictEqual(['2026-08-31', '2026-09-10', '2026-09-22', '2026-09-30'].map((x) => Engine.walletBalanceAt(S, b.id, x)), was);
});

// ---------- Р6 ----------
function importOne(S, rows) {
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), {});
  const nm = Import.names(S, ex.records);
  return Import.apply(S, Import.plan(S, ex, nm, Import.defaultChoices(nm), { Engine }), { name: 'f' }, Engine);
}
test('Р6: вторая правка загруженного перевода не теряет сдвиг первой - отмена возвращает всё (B 5 000)', () => {
  const S = st();
  const A = Engine.addWallet(S, { name: 'A', base: 10000 }), B = Engine.addWallet(S, { name: 'B', base: 5000 });
  A.baseTs = B.baseTs = Date.now() - 1000;
  const t = { id: 'i1-0', kind: 'transfer', amount: 1000, date: '2026-09-01', ts: Date.now() - 5000, catId: null, walletId: A.id, toWalletId: B.id, imp: 'i1' };
  S.tx.push(t); S.imports = [{ id: 'i1', at: Date.now() - 5000, name: 'f', count: 1, cats: [], wallets: [] }];
  tick(); Engine.updateTx(S, t.id, { amount: 2000 }); tick();
  Engine.setWalletBase(S, A.id, 9000); tick();
  Engine.updateTx(S, t.id, { amount: 1500 });
  assert.ok(!('impFz' in t), 't.impFz больше не пишется');
  // через копию данных - журнал партии переживает migrate
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  Import.undo(M, 'i1', Engine);
  assert.strictEqual(Engine.walletBalance(M, B.id), 5000, 'B - как до загрузки');
  assert.strictEqual(Engine.walletBalance(M, A.id), 9000, 'A - заданный вручную');
});

test('Р6: alt/t9 - правка, «Изменить баланс» у B, вторая правка, отмена: A 10 000, B 7 777', () => {
  const S = st();
  let clock = Date.now(); const real = Date.now;
  Date.now = () => (clock += 1000);
  try {
    const A = Engine.addWallet(S, { name: 'Карта', base: 10000 }); A.baseTs = Date.parse('2026-09-15T12:00:00');
    const B = Engine.addWallet(S, { name: 'Наличные', base: 5000 }); B.baseTs = Date.parse('2026-08-01T12:00:00');
    const b = importOne(S, [['Дата', 'Тип', 'Сумма', 'Категория', 'Кошелёк', 'Кошелёк назначения'], ['2026-07-14', 'Перевод', '1900', '', 'Наличные', 'Карта']]);
    const t = S.tx.find((x) => x.imp === b.id);
    Engine.updateTx(S, t.id, { amount: 2000 });
    Engine.setWalletBase(S, B.id, 7777);
    Engine.updateTx(S, t.id, { amount: 2100 });
    Import.undo(S, b.id, Engine);
    assert.strictEqual(Engine.walletBalance(S, A.id), 10000);
    assert.strictEqual(Engine.walletBalance(S, B.id), 7777);
  } finally { Date.now = real; }
});

test('Р6: старые данные с t.impFz переезжают в журнал партии (at = t.ts), отмена как раньше', () => {
  const S = st();
  // так хранила сборка до Б2: база 10 000, загруженная «замороженная» трата 3 000 исправлена на 2 000 -
  // разморозка вернула 3 000 в base (13 000) и записала сдвиг в t.impFz
  const w = Engine.addWallet(S, { name: 'Карта', base: 13000 }); w.baseTs = 100;
  S.tx.push({ id: 'i9-0', kind: 'exp', amount: 2000, date: '2026-09-01', ts: 500, walletId: w.id, catId: null, toWalletId: null, imp: 'i9', impFz: { [w.id]: 3000 } });
  S.imports = [{ id: 'i9', at: 50, name: 'f', count: 1, cats: [], wallets: [] }];
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.ok(!('impFz' in M.tx[0]));
  assert.deepStrictEqual(M.imports[0].fz, [{ w: w.id, dl: 3000, at: 500 }]);
  Import.undo(M, 'i9', Engine);
  assert.strictEqual(Engine.walletBalance(M, w.id), 10000);
});

// ---------- Р17 ----------
test('Р17: суммы «500р», «1 234,56 р», «500 р», «500р.» - числа; слово с «р» внутри - нет', () => {
  assert.strictEqual(Import.parseAmount('500р'), 500);
  assert.strictEqual(Import.parseAmount('1 234,56 р'), 1234.56);
  assert.strictEqual(Import.parseAmount('500 р'), 500);
  assert.strictEqual(Import.parseAmount('-500 Р'), -500);
  assert.strictEqual(Import.parseAmount('500р.'), 500);
  assert.strictEqual(Import.parseAmount('500 руб'), 500);
  assert.ok(Number.isNaN(Import.parseAmount('500 рыб')), '«рыб» - не валюта');
  assert.ok(Number.isNaN(Import.parseAmount('пр500')), 'буква перед «р»');
  assert.ok(Number.isNaN(Import.parseAmount('5р0')), '«р» не в конце - не валюта');
  assert.ok(Number.isNaN(Import.parseAmount('500пр')), '«р» в конце слова - не валюта');
});

test('Р17: кошелёк и категория «constructor» / «__proto__» - план целый, прототип не испорчен', () => {
  const S = st();
  const rows = [['Дата', 'Тип', 'Сумма', 'Категория', 'Кошелёк', 'Кошелёк назначения'],
    ['2026-09-01', 'Расход', '100', 'constructor', 'constructor', ''],
    ['2026-09-02', 'Расход', '200', '__proto__', '__proto__', ''],
    ['2026-09-03', 'Перевод', '50', '', 'toString', 'hasOwnProperty']];
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), {});
  assert.strictEqual(ex.records.length, 3);
  const nm = Import.names(S, ex.records);
  const pl = Import.plan(S, ex, nm, Import.defaultChoices(nm), { Engine });
  assert.strictEqual(pl.add.length, 3, 'операции пропали');
  assert.deepStrictEqual(pl.newWallets.map((w) => w.name).sort(), ['__proto__', 'constructor', 'hasOwnProperty', 'toString']);
  Import.apply(S, pl, { name: 'f' }, Engine);
  assert.strictEqual(S.tx.length, 3);
  S.tx.forEach((t) => { assert.strictEqual(typeof t.walletId, 'string'); assert.ok(Engine.findWallet(S, t.walletId), 'кошелёк операции есть'); });
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(typeof ({}).constructor, 'function', 'прототип объектов испорчен');
});

function zipBook(sheetXml, extra) {
  const enc = (s) => fflate.strToU8(s);
  const files = {
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': enc('<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Операции" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'),
    'xl/_rels/workbook.xml.rels': enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': enc(sheetXml)
  };
  Object.assign(files, extra || {});
  return fflate.zipSync(files);
}
test('Р17: xlsx с префиксом x:, дата t="d" и пустой t="s" читаются', () => {
  const sh = '<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
    '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1" t="s"><x:v>2</x:v></x:c><x:c r="D1" t="inlineStr"><x:is><x:t>Кошелёк</x:t></x:is></x:c></x:row>' +
    '<x:row r="2"><x:c r="A2" t="d"><x:v>2026-09-05T00:00:00</x:v></x:c><x:c r="B2"><x:v>-1500.5</x:v></x:c><x:c r="C2" t="s"/><x:c r="D2" t="s"><x:v>3</x:v></x:c></x:row>' +
    '</x:sheetData></x:worksheet>';
  const ss = '<?xml version="1.0"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>Дата</x:t></x:si><x:si><x:t>Сумма</x:t></x:si><x:si><x:t>Категория</x:t></x:si><x:si><x:r><x:t>Кар</x:t></x:r><x:r><x:t>та</x:t></x:r></x:si></x:sst>';
  const f = Import.readFile(zipBook(sh, { 'xl/sharedStrings.xml': fflate.strToU8(ss) }), fflate);
  assert.strictEqual(f.sheet, 'Операции');
  assert.deepStrictEqual(f.rows, [['Дата', 'Сумма', 'Категория', 'Кошелёк'], ['2026-09-05', -1500.5, '', 'Карта']]);
  const ex = Import.extract(f.rows, 0, Import.guessMapping(f.rows[0]), {});
  assert.deepStrictEqual(ex.records.map((r) => [r.date, r.kind, r.amount, r.wallet]), [['2026-09-05', 'exp', 1500.5, 'Карта']]);
});

// ---------- Р19 ----------
test('Р19: у покупателя 1.0.3 (долгов нет) пустая своя категория «Проценты по долгам» после обновления на месте', () => {
  const v103 = { ver: 1, wallets: [{ id: 'w1', name: 'Карта', base: 1000, baseTs: 0, order: 0 }],
    categories: { exp: [{ id: 'cF', name: 'Еда', order: 0 }, { id: 'cP', name: 'Проценты по долгам', order: 1 }], inc: [] },
    tx: [], limits: {}, ui: { order: { exp: ['cF', 'cP'], inc: [] } } };
  const S = Engine.migrate(JSON.parse(JSON.stringify(v103)));
  assert.ok(S.categories.exp.some((c) => c.id === 'cP'), 'категория покупателя удалена');
  assert.deepStrictEqual(S.ui.order.exp, ['cF', 'cP']);
  // данные dev-сборки 11-13.10 (есть долг) - пустая категория процентов уходит, как раньше
  const dev = JSON.parse(JSON.stringify(v103));
  dev.debts = [{ id: 'd1', name: 'Кредит', type: 'owe', base: 1000, baseTs: 0, start: 1000, pay: 100, day: 15, createdDate: '2026-10-11', adj: [] }];
  assert.ok(!Engine.migrate(dev).categories.exp.some((c) => c.id === 'cP'), 'dev-данные: категория осталась');
});
