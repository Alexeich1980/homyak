/* import.test.js - загрузка операций из таблиц других приложений (1.0.4, www/import.js).
   Разбор: кодировки, разделители, кавычки, даты, суммы. Шаблоны: «Хомяк», CoinKeeper,
   Дзен-мани (образцы в tests/fixtures/import/, синтетика). Сопоставление колонок, дубликаты,
   валюта, отмена импорта, потолки 50/100, точка отсчёта кошелька, круговой тест
   демо → выгрузка Excel → загрузка в чистое состояние, большие файлы. */
const test = require('node:test'); const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fflate = require('fflate');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');
const Xlsx = require('../www/xlsx.js');
const Import = require('../www/import.js');
const Fx = require('./fixtures/import/make-fixtures.js');

const FX = path.join(__dirname, 'fixtures', 'import');
const TODAY = '2026-10-11';
const u8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
function fixture(name) { return new Uint8Array(fs.readFileSync(path.join(FX, name))); }

// файл → записи (как экран: шаблон или автоугадывание)
function load(bytes, mapOverride) {
  const info = Import.readFile(bytes, fflate);
  const h = Import.findHeader(info.rows), tpl = Import.detectTemplate(info.rows[h]);
  const map = mapOverride || (tpl ? tpl.map : Import.guessMapping(info.rows[h]));
  const ex = Import.extract(info.rows, h, map, Object.assign({ today: TODAY }, tpl ? tpl.opts : {}));
  return { info, h, tpl, map, ex };
}
// записи → план → запись в S (по умолчанию: известное - туда, новое - создать)
function importInto(S, ex, o) {
  o = o || {};
  const nm = Import.names(S, ex.records);
  const ch = Import.defaultChoices(nm);
  if (o.choices) o.choices(ch, nm);
  const pl = Import.plan(S, ex, nm, ch, { Engine, now: o.now });
  if (o.planOnly) return { pl, nm };
  const batch = Import.apply(S, pl, { name: o.name || 'файл.csv', now: o.now }, Engine);
  return { pl, nm, batch };
}

// ---------- кодировки ----------
test('кодировка: UTF-8 с BOM и без, Windows-1251, UTF-16', () => {
  const s = 'Дата;Сумма\n01.09.2026;-5\n';
  assert.strictEqual(Import.decode(u8('﻿' + s)).text, s);
  assert.strictEqual(Import.decode(u8('﻿' + s)).enc, 'utf-8');
  assert.strictEqual(Import.decode(u8(s)).enc, 'utf-8');
  const cp = Fx.toCp1251(s);
  const d = Import.decode(new Uint8Array(cp));
  assert.strictEqual(d.enc, 'windows-1251');
  assert.strictEqual(d.text, s);
  const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(s, 'utf16le')]);
  assert.strictEqual(Import.decode(new Uint8Array(le)).text, s);
});
test('Windows-1251: вся верхняя половина таблицы совпадает с эталонной', () => {
  const ref = new TextDecoder('windows-1251');
  for (let b = 0x80; b <= 0xFF; b++) {
    if (b === 0x98) continue;   // в 1251 этот байт не занят
    assert.strictEqual(Import.cp1251(Uint8Array.of(b)), ref.decode(Uint8Array.of(b)), 'байт 0x' + b.toString(16));
  }
  // строгий UTF-8: кириллица в 1251 почти никогда не складывается в правильный UTF-8
  assert.strictEqual(Import.decode(new Uint8Array(Fx.toCp1251('Ёлка ёжик Щука'))).text, 'Ёлка ёжик Щука');
});

// ---------- CSV ----------
test('разделитель: «;», «,», таб; служебные строки над заголовком не сбивают', () => {
  assert.strictEqual(Import.detectDelimiter('a;b;c\n1;2;3\n'), ';');
  assert.strictEqual(Import.detectDelimiter('a,b,c\n1,2,3\n'), ',');
  assert.strictEqual(Import.detectDelimiter('a\tb\tc\n1\t2\t3\n'), '\t');
  // запятые внутри сумм не перебивают «;»
  assert.strictEqual(Import.detectDelimiter('Дата;Сумма\n01.09.2026;-1,50\n02.09.2026;2,00\n'), ';');
  const zm = fs.readFileSync(path.join(FX, 'zenmoney.csv'), 'utf8');
  assert.strictEqual(Import.detectDelimiter(zm), ',');
});
test('кавычки: "" внутри, перенос строки и разделитель внутри ячейки, CRLF', () => {
  const rows = Import.parseCSV('a;b\r\n"x ""y""";"1;2"\r\n"многострочная\r\nячейка";z\r\n', ';');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x "y"', '1;2'], ['многострочная\r\nячейка', 'z']]);
  assert.deepStrictEqual(Import.parseCSV('a,b\n1,2', ','), [['a', 'b'], ['1', '2']]);   // без перевода строки в конце
});

// ---------- значения ----------
test('даты: ДД.ММ.ГГГГ, ГГГГ-ММ-ДД, с временем, ДД.ММ.ГГ, Excel-число, американский порядок', () => {
  const P = Import.parseDate;
  assert.strictEqual(P('05.09.2026'), '2026-09-05');
  assert.strictEqual(P('5.9.2026'), '2026-09-05');
  assert.strictEqual(P('05.09.26'), '2026-09-05');
  assert.strictEqual(P('2026-09-05'), '2026-09-05');
  assert.strictEqual(P('2026-09-05T13:45:00'), '2026-09-05');
  assert.strictEqual(P('2026-09-05 13:45'), '2026-09-05');
  assert.strictEqual(P('05.09.2026 13:45:10'), '2026-09-05');
  assert.strictEqual(P('05/09/2026'), '2026-09-05');
  assert.strictEqual(P('9/5/26', 'mdy'), '2026-09-05');
  assert.strictEqual(P(46270), '2026-09-05');            // число из ячейки Excel
  assert.strictEqual(P('46270'), '2026-09-05');          // то же, текстом в CSV
  assert.strictEqual(P(46270.75), '2026-09-05');         // со временем дня
  assert.strictEqual(Import.serialToDate(Xlsx.excelDate('2026-01-31')), '2026-01-31');
  assert.strictEqual(P('31.09.2026'), null);
  assert.strictEqual(P('29.02.2026'), null);
  assert.strictEqual(P('вчера'), null);
  assert.strictEqual(P(''), null);
  assert.strictEqual(P(123), null);                      // маленькое число - не дата
  assert.strictEqual(Import.dateOrder(['13.01.2026', '02.03.2026']), 'dmy');
  assert.strictEqual(Import.dateOrder(['1/13/26', '2/3/26']), 'mdy');
  assert.strictEqual(Import.dateOrder(['1/2/26']), 'mdy');   // через «/» без подсказки - как CoinKeeper
  assert.strictEqual(Import.dateOrder(['01.02.2026']), 'dmy');
  assert.strictEqual(Import.dateOrder(['12.31.2026', '01.02.2026']), 'mdy');   // второе число > 12 - это день
});
test('суммы: разряды, неразрывные пробелы, запятая/точка, минус, ₽/руб', () => {
  const A = Import.parseAmount;
  assert.strictEqual(A('1 250,40'), 1250.4);
  assert.strictEqual(A('1\u00a0250,40'), 1250.4);
  assert.strictEqual(A('1 250.40'), 1250.4);
  assert.strictEqual(A('-1 250,40'), -1250.4);
  assert.strictEqual(A('−500'), -500);
  assert.strictEqual(A('+95 000,00'), 95000);
  assert.strictEqual(A('500-'), -500);
  assert.strictEqual(A('(500,00)'), -500);
  assert.strictEqual(A('1 500 ₽'), 1500);
  assert.strictEqual(A('99,90 руб.'), 99.9);
  assert.strictEqual(A('120 р.'), 120);
  assert.strictEqual(A('1,234.56'), 1234.56);
  assert.strictEqual(A('1.234,56'), 1234.56);
  assert.strictEqual(A('1,234,567'), 1234567);
  assert.strictEqual(A('3,000'), 3000);                  // три цифры после знака - разряды
  assert.strictEqual(A('1.500'), 1500);
  assert.strictEqual(A('3,00'), 3);
  assert.strictEqual(A('0,125'), 0.13);
  assert.strictEqual(A(250.5), 250.5);
  assert.ok(Number.isNaN(A('')));
  assert.ok(Number.isNaN(A('сто')));
  assert.ok(Number.isNaN(A('12abc')));
  assert.ok(Number.isNaN(A('1.2.3,4.5')));
});
test('тип по слову, рубль по коду валюты', () => {
  assert.strictEqual(Import.parseType('Расход'), 'exp');
  assert.strictEqual(Import.parseType('расходы'), 'exp');
  assert.strictEqual(Import.parseType('Expense'), 'exp');
  assert.strictEqual(Import.parseType('Доход'), 'inc');
  assert.strictEqual(Import.parseType('Income'), 'inc');
  assert.strictEqual(Import.parseType('Перевод'), 'transfer');
  assert.strictEqual(Import.parseType('Корректировка'), 'fix');
  assert.strictEqual(Import.parseType('interest'), null);   // не «in»
  assert.strictEqual(Import.parseType(''), '');
  ['', 'RUB', 'rur', '₽', 'руб.', 'Руб', '643'].forEach((v) => assert.ok(Import.isRub(v), v));
  ['USD', 'EUR', '$', 'KZT'].forEach((v) => assert.ok(!Import.isRub(v), v));
});

// ---------- шаблоны ----------
test('шаблон «Хомяк» (xlsx): корректировки не операции, переводы - переводы', () => {
  const { info, tpl, ex } = load(fixture('homyak.xlsx'));
  assert.strictEqual(info.kind, 'xlsx');
  assert.strictEqual(info.sheet, 'Операции');
  assert.strictEqual(tpl.id, 'homyak');
  assert.deepStrictEqual(ex.records.map((r) => r.kind + ':' + r.amount + ':' + r.date).join(' '),
    'inc:90000:2026-08-05 exp:1234.5:2026-08-06 exp:450:2026-08-06 transfer:3000:2026-08-07 exp:2100:2026-09-01');
  assert.deepStrictEqual(ex.skipped.map((s) => s.why), ['fix']);   // стартовый остаток «Карты»
  const tr = ex.records[3];
  assert.strictEqual(tr.wallet, 'Карта'); assert.strictEqual(tr.to, 'Наличные'); assert.strictEqual(tr.cat, '');
});
test('шаблон «Хомяк» в CSV (таблицу пересохранили в Excel как CSV ; 1251)', () => {
  const csv = Xlsx.HEAD_OPS.join(';') + '\r\n05.08.2026;Расход;1 234,50;Продукты;Карта;;\r\n06.08.2026;Корректировка;10 000;;Карта;;Остаток\r\n';
  const { tpl, ex } = load(new Uint8Array(Fx.toCp1251(csv)));
  assert.strictEqual(tpl.id, 'homyak');
  assert.strictEqual(ex.records.length, 1);
  assert.strictEqual(ex.records[0].amount, 1234.5);
  assert.deepStrictEqual(ex.skipped.map((s) => s.why), ['fix']);
});
// 1.0.4: выгрузка «Хомяка» с долгами - операции с долгами пропускаются (импорт долги не
// создаёт), проценты - обычный расход, в долг не превращается и кошелька «Ипотека» не заводит
test('шаблон «Хомяк» с долгами: «Платёж по долгу» и др. пропускаются, проценты - расход', () => {
  ['Платёж по долгу', 'платеж по долгу', 'Взято в долг', 'Дано в долг', 'Возврат долга'].forEach((w) => assert.strictEqual(Import.parseType(w), 'debt', w));
  const csv = Xlsx.HEAD_OPS.join(';') + '\r\n' +
    '15.07.2026;Расход;10 000;Проценты по долгам;Карта;;\r\n' +
    '15.07.2026;Платёж по долгу;20 000;;Карта;Ипотека;\r\n' +
    '02.08.2026;Взято в долг;2 500;;Ипотека;Наличные;\r\n' +
    '03.08.2026;Дано в долг;1 000;;Наличные;Саша;\r\n' +
    '10.08.2026;Возврат долга;6 000;;Саша;Карта;\r\n';
  const { tpl, ex } = load(new Uint8Array(Fx.toCp1251(csv)));
  assert.strictEqual(tpl.id, 'homyak');
  assert.deepStrictEqual(ex.records.map((r) => r.kind + ':' + r.cat + ':' + r.amount), ['exp:Проценты по долгам:10000']);
  assert.deepStrictEqual(ex.skipped.map((x) => x.why), ['debt', 'debt', 'debt', 'debt']);
});
test('шаблон CoinKeeper: «Из»/«В» по типу, M/d/yy, валюта, незнакомый тип', () => {
  const { tpl, ex } = load(fixture('coinkeeper.csv'));
  assert.strictEqual(tpl.id, 'coinkeeper');
  const r = ex.records;
  assert.deepStrictEqual(r.map((x) => [x.date, x.kind, x.amount, x.cat, x.wallet, x.to]), [
    ['2026-09-01', 'inc', 85000, 'Зарплата', 'Тинькофф', ''],
    ['2026-09-02', 'exp', 2350.5, 'Продукты', 'Тинькофф', ''],
    ['2026-09-03', 'exp', 480, 'Кафе', 'Наличные', ''],
    ['2026-09-05', 'transfer', 5000, '', 'Тинькофф', 'Наличные'],
    ['2026-09-14', 'exp', 62, 'Транспорт', 'Тинькофф', ''],
    ['2026-09-20', 'inc', 3000, 'Подработка', 'Наличные', '']
  ]);
  assert.strictEqual(r[1].note, 'Пятёрочка - Семья, Дом');   // заметка и метки
  assert.deepStrictEqual(ex.skipped.map((s) => s.why), ['currency', 'type']);
});
test('шаблон Дзен-мани: служебные строки, пара расход/доход, перевод, валюта', () => {
  const { tpl, h, ex } = load(fixture('zenmoney.csv'));
  assert.strictEqual(tpl.id, 'zenmoney');
  assert.ok(h > 0, 'заголовок не первой строкой');
  assert.deepStrictEqual(ex.records.map((x) => [x.kind, x.amount, x.cat, x.wallet, x.to]), [
    ['inc', 120000, 'Зарплата', 'Сбер карта', ''],
    ['exp', 250, 'Еда / Кофе', 'Сбер карта', ''],
    ['exp', 3410.9, 'Продукты', 'Сбер карта', ''],
    ['transfer', 10000, '', 'Сбер карта', 'Наличные'],
    ['exp', 180, 'Еда / Кофе', 'Наличные', '']
  ]);
  assert.strictEqual(ex.records[1].note, 'Кофейня Зерно');
  assert.deepStrictEqual(ex.skipped.map((s) => s.why), ['currency']);
});
test('не узнан: автоугадывание колонок по заголовкам (таб, BOM, знак суммы)', () => {
  const { tpl, map, ex } = load(fixture('generic-bank.tsv'));
  assert.strictEqual(tpl, null);
  assert.deepStrictEqual(map, { date: 0, note: 1, cat: 2, amount: 3, currency: 4 });
  assert.deepStrictEqual(ex.records.map((x) => [x.date, x.kind, x.amount, x.cat]),
    [['2026-09-05', 'exp', 1250.4, 'Супермаркеты'], ['2026-09-06', 'inc', 95000, 'Поступления']]);
  assert.deepStrictEqual(ex.skipped.map((s) => s.why).sort(), ['amount', 'currency', 'date']);
});
test('не узнан: своя таблица 1251 - без ручного сопоставления ничего, с ним всё', () => {
  const b = fixture('own-cp1251.csv');
  const auto = load(b);
  assert.strictEqual(auto.info.enc, 'windows-1251');
  assert.strictEqual(auto.info.delim, ';');
  assert.strictEqual(auto.tpl, null);
  assert.strictEqual(auto.map.date, undefined, 'дату по «Когда» не угадать');
  // человек выбрал колонки на экране сопоставления
  const man = load(b, { date: 0, amount: 1, cat: 2, wallet: 3, note: 4 });
  assert.deepStrictEqual(man.ex.records.map((x) => [x.kind, x.amount, x.cat, x.wallet, x.note]), [
    ['exp', 1500, 'Продукты', 'Карта', 'обычная "закупка"'],
    ['exp', 320, 'Кафе', 'Наличные', 'обед, с коллегами'],
    ['inc', 45000, 'Зарплата', 'Карта', ''],
    ['exp', 99.9, 'Подписки', 'Карта', 'музыка']
  ]);
  // пара «Расход / Доход» вместо суммы со знаком
  const pair = Import.extract([['Дата', 'Расход', 'Доход'], ['01.09.2026', '100', ''], ['02.09.2026', '', '50'], ['03.09.2026', '', '']], 0,
    Import.guessMapping(['Дата', 'Расход', 'Доход']), { today: TODAY });
  assert.deepStrictEqual(pair.records.map((x) => x.kind + x.amount), ['exp100', 'inc50']);
  assert.deepStrictEqual(pair.skipped.map((s) => s.why), ['amount']);
});
test('правило знака и переводы по «куда»; дата в будущем; сумма больше миллиарда', () => {
  const rows = [['Дата', 'Сумма', 'Счёт', 'Куда'],
    ['01.09.2026', '-100', 'Карта', ''],
    ['01.09.2026', '200', 'Карта', ''],
    ['01.09.2026', '300', 'Карта', 'Наличные'],
    ['01.09.2026', '400', 'Карта', 'карта'],     // «куда» = тот же кошелёк - не перевод
    ['12.10.2026', '-5', 'Карта', ''],            // завтра
    ['01.09.2026', '-2 000 000 000', 'Карта', '']];
  const map = Import.guessMapping(rows[0]);
  assert.deepStrictEqual(map, { date: 0, amount: 1, wallet: 2, to: 3 });
  const ex = Import.extract(rows, 0, map, { today: TODAY });
  assert.deepStrictEqual(ex.records.map((x) => x.kind + x.amount), ['exp100', 'inc200', 'transfer300', 'inc400']);
  assert.deepStrictEqual(ex.skipped.map((s) => s.why), ['future', 'big']);
});

// ---------- сопоставление названий, запись, дубликаты ----------
function baseState() {
  const S = Engine.defaultState();
  Engine.addCategory(S, 'exp', { name: 'Продукты' });
  Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 }); w.baseTs = 0;
  return Engine.migrate(S);
}
test('названия: известные - к существующим (регистр, ё/е), новые - создать', () => {
  const S = baseState();
  const ex = load(fixture('coinkeeper.csv')).ex;
  const nm = Import.names(S, ex.records);
  const prod = nm.cats.find((c) => c.name === 'Продукты');
  assert.strictEqual(prod.match, S.categories.exp[0].id);
  const sal = nm.cats.find((c) => c.name === 'Зарплата');
  assert.strictEqual(sal.match, S.categories.inc[0].id);
  assert.strictEqual(nm.cats.find((c) => c.name === 'Кафе').match, null);
  assert.strictEqual(nm.wallets.find((w) => w.name === 'Тинькофф').match, null);
  const S2 = baseState(); S2.wallets[0].name = 'ТИНЬКОФФ';
  assert.strictEqual(Import.names(S2, ex.records).wallets.find((w) => w.name === 'Тинькофф').match, S2.wallets[0].id);
  // пустой кошелёк - «не указан», по умолчанию первый кошелёк приложения
  const g = load(fixture('generic-bank.tsv')).ex;
  const nw = Import.names(S, g.records).wallets;
  assert.strictEqual(nw.length, 1);
  assert.ok(nw[0].empty);
  assert.strictEqual(nw[0].match, S.wallets[0].id);
});
test('запись: операции с меткой партии, новые категории/кошельки, выбор «отнести к существующей»', () => {
  const S = baseState();
  const ex = load(fixture('coinkeeper.csv')).ex;
  const { pl, batch } = importInto(S, ex, { choices: (ch, nm) => {
    const cafe = nm.cats.find((c) => c.name === 'Кафе');
    ch.cat[cafe.key] = S.categories.exp[0].id;    // «Кафе» → «Продукты»
  } });
  assert.strictEqual(batch.count, 6);
  assert.strictEqual(S.tx.filter((t) => t.imp === batch.id).length, 6);
  assert.deepStrictEqual(pl.newCats.exp.map((c) => c.name), ['Транспорт']);
  assert.deepStrictEqual(pl.newCats.inc.map((c) => c.name), ['Подработка']);
  assert.deepStrictEqual(pl.newWallets.map((w) => w.name).sort(), ['Наличные', 'Тинькофф']);
  const cafeTx = S.tx.find((t) => t.amount === 480);
  assert.strictEqual(cafeTx.catId, S.categories.exp[0].id);
  const tr = S.tx.find((t) => t.kind === 'transfer');
  assert.strictEqual(Engine.findWallet(S, tr.walletId).name, 'Тинькофф');
  assert.strictEqual(Engine.findWallet(S, tr.toWalletId).name, 'Наличные');
  assert.strictEqual(S.tx.find((t) => t.amount === 2350.5).note, 'Пятёрочка - Семья, Дом');
  // состояние переживает сохранение и загрузку (migrate) и бэкап
  const back = Engine.importJSON(Engine.exportJSON(S));
  assert.strictEqual(back.imports.length, 1);
  assert.strictEqual(back.tx.filter((t) => t.imp === batch.id).length, 6);
  // заметка уходит в выгрузку Excel
  assert.ok(Xlsx.rows(S, Engine).ops.some((o) => o.note === 'Пятёрочка - Семья, Дом'));
});
test('дубликаты: повторная загрузка того же файла ничего не задваивает', () => {
  const S = baseState();
  const ex = load(fixture('zenmoney.csv')).ex;
  const first = importInto(S, ex);
  assert.strictEqual(first.batch.count, 5);
  const n = S.tx.length, cats = S.categories.exp.length, wals = S.wallets.length;
  const again = importInto(S, ex, { planOnly: true });
  assert.strictEqual(again.pl.add.length, 0);
  assert.strictEqual(again.pl.why.dup, 5);
  assert.strictEqual(again.pl.newCats.exp.length + again.pl.newWallets.length, 0, 'новые названия на одних дубликатах');
  Import.apply(S, again.pl, { name: 'снова' }, Engine);
  assert.strictEqual(S.tx.length, n);
  assert.strictEqual(S.categories.exp.length, cats);
  assert.strictEqual(S.wallets.length, wals);
});
test('дубликаты: две одинаковые траты в файле и одна в приложении - добавится одна', () => {
  const S = baseState();
  const cat = S.categories.exp[0], w = S.wallets[0];
  Engine.addTx(S, { kind: 'exp', amount: 150, date: '2026-09-02', catId: cat.id, walletId: w.id });
  const rows = [['Дата', 'Сумма', 'Категория', 'Кошелёк'], ['02.09.2026', '-150', 'Продукты', 'Карта'], ['02.09.2026', '-150', 'Продукты', 'Карта'],
    ['02.09.2026', '-150', 'Продукты', 'Наличные'], ['03.09.2026', '-150', 'Продукты', 'Карта']];
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), { today: TODAY });
  const { pl } = importInto(S, ex, { planOnly: true });
  assert.strictEqual(pl.why.dup, 1);
  assert.strictEqual(pl.add.length, 3);
  // явная галочка «не пропускать» (keepDup) - добавятся все
  const nm = Import.names(S, ex.records);
  assert.strictEqual(Import.plan(S, ex, nm, Import.defaultChoices(nm), { Engine, keepDup: true }).add.length, 4);
});
test('валюта: строки не в рублях пропускаются с причиной', () => {
  const rows = [['Дата', 'Сумма', 'Валюта'], ['01.09.2026', '-10', 'USD'], ['01.09.2026', '-10', 'RUB'], ['01.09.2026', '-10', ''], ['01.09.2026', '-10', 'EUR']];
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), { today: TODAY });
  assert.strictEqual(ex.records.length, 2);
  assert.deepStrictEqual(ex.skipped.map((s) => s.why), ['currency', 'currency']);
});

// ---------- отмена ----------
test('отмена последнего импорта: ровно его операции и созданные им пустые категории/кошельки', () => {
  const S = baseState();
  const own = Engine.addTx(S, { kind: 'exp', amount: 77, date: '2026-09-01', catId: S.categories.exp[0].id, walletId: S.wallets[0].id });
  const snap = JSON.stringify(S);
  const ex = load(fixture('coinkeeper.csv')).ex;
  const { batch } = importInto(S, ex);
  assert.deepStrictEqual(Import.lastBatch(S), { id: batch.id, at: batch.at, name: 'файл.csv', count: 6 });
  // после импорта хозяин сам внёс трату в созданную импортом категорию «Кафе»
  const cafe = S.categories.exp.find((c) => c.name === 'Кафе');
  const mine = Engine.addTx(S, { kind: 'exp', amount: 33, date: '2026-09-10', catId: cafe.id, walletId: S.wallets[0].id });
  const r = Import.undo(S, batch.id, Engine);
  assert.strictEqual(r.tx, 6);
  assert.ok(S.tx.find((t) => t.id === own.id) && S.tx.find((t) => t.id === mine.id), 'тронули свои операции хозяина');
  assert.ok(S.categories.exp.find((c) => c.id === cafe.id), '«Кафе» с операцией хозяина удалили');
  assert.ok(!S.categories.exp.find((c) => c.name === 'Транспорт'), 'пустая категория импорта осталась');
  assert.ok(!S.wallets.find((w) => w.name === 'Тинькофф'), 'пустой кошелёк импорта остался');
  assert.strictEqual(Import.lastBatch(S), null);
  // без своей траты - ровно как было
  const S2 = Engine.migrate(JSON.parse(snap));
  const b2 = importInto(S2, ex).batch;
  Import.undo(S2, b2.id, Engine);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Engine.migrate(S2))), JSON.parse(JSON.stringify(Engine.migrate(JSON.parse(snap)))));
});
test('отменить можно только последнюю партию; удалённые руками операции - не в счёт', () => {
  const S = baseState();
  const b1 = importInto(S, load(fixture('coinkeeper.csv')).ex).batch;
  const b2 = importInto(S, load(fixture('zenmoney.csv')).ex).batch;
  assert.strictEqual(Import.lastBatch(S).id, b2.id);
  S.tx = S.tx.filter((t) => t.imp !== b2.id);   // хозяин удалил всё из второй партии сам
  assert.strictEqual(Import.lastBatch(S), null, 'первая партия не должна стать «последней»');
  assert.ok(b1.id);
});

// ---------- потолки Полного доступа ----------
test('потолки: до 50 кошельков и 100 категорий расходов - сверх честно не записываем', () => {
  const S = baseState();
  for (let i = 1; i < 49; i++) Engine.addWallet(S, { name: 'W' + i });
  for (let i = 1; i < 99; i++) Engine.addCategory(S, 'exp', { name: 'C' + i });
  assert.strictEqual(Engine.walletsActiveCount(S), 49);
  assert.strictEqual(Engine.expCatsActiveCount(S), 99);
  const rows = [['Дата', 'Сумма', 'Категория', 'Кошелёк'], ['01.09.2026', '-1', 'Новая1', 'Новый1'], ['01.09.2026', '-1', 'Новая2', 'Новый2']];
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), { today: TODAY });
  const { pl, nm } = importInto(S, ex, { planOnly: true });
  assert.deepStrictEqual(pl.over, { wallets: 1, exp: 1, inc: 0 });
  assert.throws(() => Import.apply(S, pl, {}, Engine), /over/);
  // отнесли одно новое к существующему - помещается
  const ch = Import.defaultChoices(nm);
  ch.cat[nm.cats[1].key] = S.categories.exp[0].id;
  ch.wallet[nm.wallets[1].key] = S.wallets[0].id;
  const ok = Import.plan(S, ex, nm, ch, { Engine });
  assert.strictEqual(ok.over, null);
  Import.apply(S, ok, {}, Engine);
  assert.strictEqual(Engine.walletsActiveCount(S), 50);
  assert.strictEqual(Engine.expCatsActiveCount(S), 100);
});

// ---------- точка отсчёта кошелька ----------
test('точка отсчёта: операции раньше дня «Изменить баланс» баланс не двигают, позже - двигают', () => {
  const S = baseState();
  const w = S.wallets[0];
  const now = new Date(2026, 9, 11, 15, 0, 0).getTime();       // 11.10.2026 15:00
  w.base = 5000; w.baseTs = new Date(2026, 9, 1, 12, 0, 0).getTime();   // баланс задан 01.10 в полдень
  const rows = [['Дата', 'Сумма', 'Категория', 'Кошелёк'],
    ['15.09.2026', '-1000', 'Продукты', 'Карта'],    // до точки отсчёта - уже в балансе
    ['30.09.2026', '+300', 'Зарплата', 'Карта'],     // до точки отсчёта
    ['01.10.2026', '-200', 'Продукты', 'Карта'],     // в день точки отсчёта - как ручной ввод
    ['10.10.2026', '-50', 'Продукты', 'Карта']];
  const ex = Import.extract(rows, 0, Import.guessMapping(rows[0]), { today: TODAY });
  const { pl } = importInto(S, ex, { now });
  assert.strictEqual(pl.stats.frozen, 2);
  assert.deepStrictEqual(pl.stats.frozenWallets, ['Карта']);
  assert.strictEqual(Engine.walletBalance(S, w.id), 5000 - 200 - 50);
  // замороженная операция в аналитике есть (факт сентября), в балансе - нет
  assert.strictEqual(Engine.summary(S, '2026-09').spent, 1000);
  const old = S.tx.find((t) => t.amount === 1000);
  assert.ok(Engine.isFrozen(S, old));
  // ts - конец дня операции, не позже «сейчас»; порядок файла внутри дня сохранён
  assert.ok(old.ts <= Import.endOfDay('2026-09-15') && old.ts > Import.endOfDay('2026-09-14'));
  assert.ok(S.tx.every((t) => t.ts <= now));
  // новый кошелёк из импорта: баланс - вся история из файла с нуля
  const S2 = baseState();
  const rows2 = [['Дата', 'Сумма', 'Кошелёк'], ['01.01.2025', '+1000', 'Новый'], ['01.06.2025', '-250', 'Новый']];
  importInto(S2, Import.extract(rows2, 0, Import.guessMapping(rows2[0]), { today: TODAY }), { now });
  const nw = S2.wallets.find((x) => x.name === 'Новый');
  assert.strictEqual(nw.baseTs, 0);
  assert.strictEqual(Engine.walletBalance(S2, nw.id), 750);
  // отмена импорта балансы не портит: base не трогали ни импорт, ни отмена
  const S3 = baseState(); S3.wallets[0].base = 5000; S3.wallets[0].baseTs = w.baseTs;
  const b3 = importInto(S3, ex, { now }).batch;
  Import.undo(S3, b3.id, Engine);
  assert.strictEqual(S3.wallets[0].base, 5000);
  assert.strictEqual(Engine.walletBalance(S3, S3.wallets[0].id), 5000);
});
test('импорт двигает баланс так же, как ручной ввод (сегодняшняя операция)', () => {
  const S = baseState(), w = S.wallets[0];
  w.base = 1000; w.baseTs = Date.now() - 60000;
  const manual = Engine.migrate(JSON.parse(JSON.stringify(S)));
  Engine.addTx(manual, { kind: 'exp', amount: 120, date: Engine.today(), catId: manual.categories.exp[0].id, walletId: manual.wallets[0].id });
  const rows = [['Дата', 'Сумма', 'Категория', 'Кошелёк'], [Engine.today(), '-120', 'Продукты', 'Карта']];
  importInto(S, Import.extract(rows, 0, Import.guessMapping(rows[0])));
  assert.strictEqual(Engine.walletBalance(S, w.id), Engine.walletBalance(manual, manual.wallets[0].id));
  assert.strictEqual(Engine.walletBalance(S, w.id), 880);
});

// ---------- круговой тест ----------
test('круг: демо → выгрузка Excel → загрузка в чистое → те же операции, месяцы и статьи', () => {
  const D = Engine.migrate(Seed.demoState(Engine));
  // перевод и заметка в данных - тоже должны доехать
  const bytes = Xlsx.build(D, Engine, fflate);
  const { tpl, ex } = load(bytes);
  assert.strictEqual(tpl.id, 'homyak');
  const T = Engine.migrate(Engine.defaultState());
  const { pl, batch } = importInto(T, ex);
  const live = D.tx.filter((t) => t.amount > 0);
  assert.strictEqual(batch.count, live.length, 'число операций');
  // корректировки - по одной на кошелёк с остатком, не объяснённым операциями
  const fixes = Xlsx.rows(D, Engine).ops.filter((o) => o.type === Xlsx.TYPE.fix).length;
  assert.ok(fixes > 0);
  assert.strictEqual(pl.why.fix, fixes, 'корректировки не пропущены как «корректировка»');
  assert.strictEqual(pl.skipped.length, fixes, 'пропущено что-то кроме корректировок');
  // суммы по месяцам и по статьям (по названию) - те же
  const months = [...new Set(live.map((t) => t.date.slice(0, 7)))];
  months.forEach((m) => {
    const a = Engine.summary(D, m), b = Engine.summary(T, m);
    assert.strictEqual(b.spent, a.spent, m + ' расходы');
    assert.strictEqual(b.earned, a.earned, m + ' доходы');
    ['exp', 'inc'].forEach((kind) => {
      const by = (S) => { const o = {}; Engine.monthBreakdown(S, m, kind).forEach((r) => { if (r.fact) o[r.name] = r.fact; }); return o; };
      assert.deepStrictEqual(by(T), by(D), m + ' ' + kind + ' по статьям');
    });
  });
  // переводы - те же суммы между теми же кошельками (по именам)
  const trs = (S) => S.tx.filter((t) => t.kind === 'transfer').map((t) => Engine.findWallet(S, t.walletId).name + '>' + Engine.findWallet(S, t.toWalletId).name + ':' + t.amount).sort();
  assert.deepStrictEqual(trs(T), trs(D));
  // баланс нового кошелька = баланс исходного минус его корректировка (стартовый остаток)
  const fixBy = {};
  Xlsx.rows(D, Engine).ops.filter((o) => o.type === Xlsx.TYPE.fix).forEach((o) => { fixBy[o.wallet] = (fixBy[o.wallet] || 0) + o.amount; });
  D.wallets.forEach((w) => {
    const tw = T.wallets.find((x) => x.name === w.name);
    if (!tw) { assert.strictEqual(Engine.walletTxCount(D, w.id), 0, w.name + ' пропал'); return; }
    assert.strictEqual(Engine.walletBalance(T, tw.id), Math.round((Engine.walletBalance(D, w.id) - (fixBy[w.name] || 0)) * 100) / 100, w.name);
  });
  // и повторная загрузка того же файла - ноль новых
  assert.strictEqual(importInto(T, ex, { planOnly: true }).pl.add.length, 0);
});

// ---------- большие файлы ----------
test('большие файлы: отказ больше 10 МБ и 50 000 строк; .xls - отказ; пустой файл', () => {
  assert.throws(() => Import.readFile(new Uint8Array(Import.MAX_BYTES + 1), fflate), /big/);
  let s = 'Дата;Сумма\n';
  for (let i = 0; i < Import.MAX_ROWS + 1; i++) s += '01.09.2026;-1\n';
  assert.throws(() => Import.readFile(u8(s), fflate), /rows/);
  assert.throws(() => Import.readFile(Uint8Array.of(0xD0, 0xCF, 0x11, 0xE0, 0, 0), fflate), /xls/);
  assert.throws(() => Import.readFile(u8('\n\n;;\n'), fflate), /empty/);
  assert.throws(() => Import.readFile(Uint8Array.of(0x50, 0x4B, 3, 4, 9, 9), fflate), /xlsx/);
});
test('10 000 строк: разбор, план и запись быстрее 2 секунд', () => {
  let s = 'Дата;Сумма;Категория;Кошелёк;Комментарий\n';
  const cats = ['Продукты', 'Кафе', 'Транспорт', 'Дом', 'Зарплата'];
  for (let i = 0; i < 10000; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + (i % 600) * 86400000).toISOString().slice(0, 10);
    const c = cats[i % 5];
    s += d.split('-').reverse().join('.') + ';' + (c === 'Зарплата' ? '+50 000,00' : '-' + (100 + i % 900) + ',50') + ';' + c + ';' + (i % 3 ? 'Карта' : 'Наличные') + ';строка ' + i + '\n';
  }
  const S = baseState();
  const t0 = Date.now();
  const { ex } = load(u8(s));
  const { batch } = importInto(S, ex);
  const ms = Date.now() - t0;
  assert.strictEqual(batch.count, 10000);
  assert.ok(ms < 2000, 'долго: ' + ms + ' мс');
  const t1 = Date.now();
  assert.strictEqual(importInto(S, ex, { planOnly: true }).pl.why.dup, 10000);
  assert.ok(Date.now() - t1 < 2000, 'повторный план долго');
});

// ---------- состояние ----------
test('normalize: партии и метки импорта переживают загрузку, мусор - нет', () => {
  const S = Engine.migrate({ wallets: [], tx: [{ id: 'a', kind: 'exp', amount: 1, date: '2026-09-01', imp: 'i1', note: 'x' },
    { id: 'b', kind: 'exp', amount: 1, date: '2026-09-01', imp: 5, note: {} }],
    imports: [{ id: 'i1', at: 1, name: 'f', count: 1, cats: ['c', 3], wallets: 'x' }, { nope: 1 }, 'мусор'] });
  assert.deepStrictEqual(S.imports, [{ id: 'i1', at: 1, name: 'f', count: 1, cats: ['c'], wallets: [] }]);
  assert.strictEqual(S.tx[0].imp, 'i1'); assert.strictEqual(S.tx[0].note, 'x');
  assert.ok(!('imp' in S.tx[1]) && !('note' in S.tx[1]));
  assert.deepStrictEqual(Engine.defaultState().imports, []);
});

// Решение 13.10: названия чужих приложений на экране не показываем. Шаблон узнаётся как
// раньше, но подпись - «выгрузка другого приложения» / «выгрузка «Хомяка»»; ни в одной
// видимой строке www/ (строковые литералы JS и текст HTML без комментариев) их нет.
test('импорт: названия чужих приложений не видны на экране', () => {
  assert.strictEqual(load(fixture('coinkeeper.csv')).tpl.title, 'выгрузка другого приложения');
  assert.strictEqual(load(fixture('zenmoney.csv')).tpl.title, 'выгрузка другого приложения');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'www', 'import-ui.js'), 'utf8');
  assert.match(ui, /'Формат распознан: ' \+ cur\.tpl\.title \+ '\.'/);
  const NAMES = /CoinKeeper|Coinkeeper|Дзен-мани|Дзен мани|Дзен-Мани|ZenMoney|Zenmoney/;
  const www = path.join(__dirname, '..', 'www');
  const bad = [];
  fs.readdirSync(www).filter((f) => /\.(js|html)$/.test(f) && f !== 'selftest.js').forEach((f) => {
    let s = fs.readFileSync(path.join(www, f), 'utf8');
    s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    const lits = s.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`|>[^<]+</g) || [];
    lits.forEach((l) => { if (NAMES.test(l)) bad.push(f + ': ' + l.slice(0, 80)); });
  });
  assert.deepStrictEqual(bad, [], 'название чужого приложения в видимой строке');
});
