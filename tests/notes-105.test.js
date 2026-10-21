/* notes-105.test.js - 1.0.5: заметки к операциям (3 запроса покупателей) и подписи вкладки
   «Долги» (решение Алексея 14.10).
   Заметка t.note: необязательная, одна строка, trim, пустая = поля нет, не длиннее
   Engine.NOTE_MAX (100) - при записи (addTx/updateTx/payDebt/takeDebt/editDebtTx) и при загрузке
   (normalize: копия данных, восстановление, старые данные). История долга отдаёт заметку,
   выгрузка Excel пишет её в «Комментарий», загрузка своего же файла её возвращает.
   Экран (поле на экране суммы, в правке, показ в ленте/карточках, экранирование) - в self-test. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fflate = require('fflate');
const Engine = require('../www/engine.js');
const Xlsx = require('../www/xlsx.js');
const Import = require('../www/import.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 200000 });
  const cash = Engine.addWallet(S, { name: 'Наличные', base: 5000 });
  card.baseTs = 0; cash.baseTs = 0;
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  return { S, card, cash, sal, food };
}
const LONG = 'а'.repeat(250);   // ревью 1.0.5: хранится до NOTE_KEEP (200), ввод в окне - NOTE_MAX (100)

test('заметки: предел 100 знаков - одна константа движка', () => {
  assert.strictEqual(Engine.NOTE_MAX, 100);
  assert.strictEqual(Engine.cleanNote('  подарок   маме \n на день рождения  '), 'подарок маме на день рождения');
  assert.strictEqual(Engine.cleanNote('   '), '');
  assert.strictEqual(Engine.cleanNote(null), '');
  assert.strictEqual(Engine.cleanNote(42), '');
  assert.strictEqual(Engine.NOTE_KEEP, 200);
  assert.strictEqual(Engine.cleanNote(LONG).length, 200);
});

test('заметки: addTx - trim, пустая = нет поля, длинная обрезается', () => {
  const { S, card, food, sal, cash } = fresh();
  const a = Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-10-01', catId: food.id, walletId: card.id, note: '  подарок маме  ' });
  assert.strictEqual(a.note, 'подарок маме');
  const b = Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-10-01', catId: food.id, walletId: card.id, note: '   ' });
  assert.ok(!('note' in b), 'пустая заметка записана полем');
  const c = Engine.addTx(S, { kind: 'inc', amount: 500, date: '2026-10-01', catId: sal.id, walletId: card.id, note: LONG });
  assert.strictEqual(c.note.length, 200);
  const d = Engine.addTx(S, { kind: 'transfer', amount: 100, date: '2026-10-01', walletId: card.id, toWalletId: cash.id, note: 'в копилку' });
  assert.strictEqual(d.note, 'в копилку');
  const e = Engine.addTx(S, { kind: 'exp', amount: 1, date: '2026-10-01', catId: food.id, walletId: card.id });
  assert.ok(!('note' in e), 'без заметки - без поля');
});

test('заметки: updateTx ставит, обрезает и убирает заметку', () => {
  const { S, card, food } = fresh();
  const t = Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-10-01', catId: food.id, walletId: card.id });
  Engine.updateTx(S, t.id, { note: ' кофе ' });
  assert.strictEqual(t.note, 'кофе');
  Engine.updateTx(S, t.id, { note: LONG });
  assert.strictEqual(t.note.length, 200);
  Engine.updateTx(S, t.id, { note: '' });
  assert.ok(!('note' in t), 'пустая заметка не убрала поле');
  Engine.updateTx(S, t.id, { amount: 600 });
  assert.ok(!('note' in t));
  assert.strictEqual(t.amount, 600);
});

test('заметки: платёж по долгу, «взяли в долг» и правка платежа', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 100000, pay: 5000, day: 15, date: '2026-01-10', now: 0 });
  const r = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 5000, date: '2026-02-15', note: ' досрочно ' });
  assert.strictEqual(r.txs[0].note, 'досрочно');
  const k = Engine.takeDebt(S, { debtId: d.id, walletId: card.id, amount: 1000, date: '2026-02-16', note: LONG });
  assert.strictEqual(k.txs[0].note.length, 200);
  Engine.editDebtTx(S, r.txs[0].id, { amount: 5000, note: 'за февраль' });
  assert.strictEqual(r.txs[0].note, 'за февраль');
  Engine.editDebtTx(S, r.txs[0].id, { amount: 5000, note: ' ' });
  assert.ok(!('note' in r.txs[0]), 'правка платежа не убрала заметку');
  Engine.editDebtTx(S, k.txs[0].id, { amount: 1000 });
  assert.strictEqual(k.txs[0].note.length, 200, 'правка без note стёрла заметку');
  // история долга отдаёт заметку
  const h = Engine.debtHistory(S, d.id);
  assert.strictEqual(h.find((x) => x.id === k.txs[0].id).note.length, 200);
  assert.ok(!h.find((x) => x.id === r.txs[0].id).note);
});

test('заметки: загрузка данных (копия/восстановление) - trim, пустая убирается, длинная обрезается', () => {
  const { S, card, food } = fresh();
  const mk = (note) => ({ id: 'x' + Math.random(), kind: 'exp', amount: 10, date: '2026-10-01', ts: 1, catId: food.id, walletId: card.id, note });
  S.tx.push(mk('  обед  '), mk('   '), mk(LONG), mk(7), mk('строка\nвторая'));
  const T = Engine.migrate(JSON.parse(JSON.stringify(S)));
  const notes = T.tx.map((t) => t.note);
  assert.deepStrictEqual(notes, ['обед', undefined, 'а'.repeat(200), undefined, 'строка вторая']);
  // круг через JSON (копия данных → восстановление) - заметка та же
  const R = Engine.migrate(JSON.parse(JSON.stringify(T)));
  assert.deepStrictEqual(R.tx.map((t) => t.note), notes);
});

test('заметки: выгрузка Excel - колонка «Комментарий», у платежа - вместе с разбивкой процентов', () => {
  const { S, card, food } = fresh();
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-10-01', catId: food.id, walletId: card.id, note: 'подарок маме' });
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 120000, pay: 5000, day: 15, rate: 12, date: '2026-09-01', now: 0 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 5000, date: '2026-10-01', note: 'за октябрь' });
  const ops = Xlsx.rows(S, Engine).ops;
  assert.ok(ops.some((o) => o.note === 'подарок маме'), 'нет заметки расхода');
  const pay = ops.find((o) => o.type === Xlsx.TYPE.debtPay);
  assert.ok(/в счёт долга/.test(pay.note) && /за октябрь/.test(pay.note), 'платёж: ' + pay.note);
});

test('заметки: свой же файл Excel загружается обратно с заметками', () => {
  const { S, card, food, sal } = fresh();
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-10-01', catId: food.id, walletId: card.id, note: 'подарок маме' });
  Engine.addTx(S, { kind: 'inc', amount: 900, date: '2026-10-02', catId: sal.id, walletId: card.id, note: 'аванс' });
  Engine.addTx(S, { kind: 'exp', amount: 100, date: '2026-10-03', catId: food.id, walletId: card.id });
  const bytes = Xlsx.build(S, Engine, fflate);
  const info = Import.readFile(bytes, fflate);
  const h = Import.findHeader(info.rows), tpl = Import.detectTemplate(info.rows[h]);
  const ex = Import.extract(info.rows, h, tpl.map, Object.assign({ today: '2026-10-17' }, tpl.opts || {}));
  const T = Engine.migrate(Engine.defaultState());
  const nm = Import.names(T, ex.records);
  const pl = Import.plan(T, ex, nm, Import.defaultChoices(nm), { Engine });
  Import.apply(T, pl, { name: 'Хомяк.xlsx' }, Engine);
  const got = T.tx.map((t) => t.amount + ':' + (t.note || '')).sort();
  assert.deepStrictEqual(got, ['100:', '500:подарок маме', '900:аванс']);
});

test('заметки: загрузка чужой таблицы режет комментарий тем же пределом, что и движок', () => {
  // К8 ревью 1.0.5: не сверка числа в исходнике, а сама загрузка - строка таблицы → запись
  const rows = [['Дата', 'Сумма', 'Категория', 'Кошелек', 'Комментарий'],
    ['01.10.2026', '-500', 'Еда', 'Карта', 'Оплата\nтоваров   ' + 'ю'.repeat(300)]];
  const ex = Import.extract(rows, 0, { date: 0, amount: 1, cat: 2, wallet: 3, note: 4 }, { today: '2026-10-17' });
  const T = Engine.migrate(Engine.defaultState());
  const nm = Import.names(T, ex.records);
  const pl = Import.plan(T, ex, nm, Import.defaultChoices(nm), { Engine });
  Import.apply(T, pl, { name: 'x.xlsx' }, Engine);
  assert.strictEqual(T.tx.length, 1);
  assert.strictEqual(T.tx[0].note, Engine.cleanNote(rows[1][4]));
  assert.strictEqual(Array.from(T.tx[0].note).length, Engine.NOTE_KEEP, 'import.js режет не тем пределом, что хранит движок');
  assert.ok(T.tx[0].note.startsWith('Оплата товаров ю'), 'перенос строки из таблицы не схлопнут');
});

// ---------- подписи вкладки «Долги» (Алексей 14.10) ----------
test('«Долги»: подписи нагрузки - новые слова, порог из движка', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'www', 'summary.js'), 'utf8');
  const body = src.slice(src.indexOf('function loadHtml'), src.indexOf('function renderBody'));
  assert.ok(body.length > 100, 'нет loadHtml');
  assert.ok(/Долговая нагрузка на бюджет/.test(body), 'нет заголовка «Долговая нагрузка на бюджет»');
  assert.ok(/Платежи по всем долгам: /.test(body), 'нет строки «Платежи по всем долгам»');
  assert.ok(/Доходы за месяц: /.test(body), 'нет строки «Доходы за месяц»');
  assert.ok(/Долговая нагрузка выше /.test(body), 'нет «Долговая нагрузка выше»');
  assert.ok(!/Нагрузка за месяц|из доходов|'Нагрузка выше/.test(body), 'остались старые слова');
  assert.ok(!/30\s*%|30%/.test(body.replace(/\/\/.*$/gm, '')), 'порог 30% хардкодом');
  assert.ok(!/—/.test(body), 'длинное тире');
});

// ревью 1.0.5 №1/№3: комментарии 1.0.4 (до 200) не обрезаются при переходе; эмодзи на границе не рвётся
test('заметки: старый комментарий 1.0.4 (129 знаков) переживает migrate, эмодзи на границе целый', () => {
  const { S, card: w, food: c } = fresh();
  const old = 'б'.repeat(129);
  const raw = JSON.parse(JSON.stringify(S));
  raw.tx.push({ id: 'x1', kind: 'exp', amount: 10, date: '2026-09-01', ts: 1, catId: c.id, walletId: w.id, toWalletId: null, note: old });
  const M = Engine.migrate(raw);
  assert.strictEqual(M.tx.find((t) => t.id === 'x1').note, old, '1.0.5 обрезал заметку 1.0.4');
  const e = Engine.cleanNote('а'.repeat(199) + '😀' + 'хвост');
  assert.strictEqual(Array.from(e).length, 200);
  assert.ok(e.endsWith('😀'), 'эмодзи на границе разорван или потерян');
});
