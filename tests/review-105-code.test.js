/* review-105-code.test.js - код-ревью max 1.0.5 (17.10, diff 39e6745..ce76553), пункты К1-К14.
   Здесь - всё, что проверяется без экрана (движок, иконки, импорт, подсветка, заслоны по
   исходникам). Экран (правка только заметки, предел поля, курсор, «Повторить», архивная
   категория, кнопка «Заметка» в обеих темах) - www/selftest.js, блок «ревью 1.0.5 К…».
   Сверка подбора иконок с 1.0.4 целиком - tests/icons-golden.test.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');
const Icons = require('../www/icons.js');
const Import = require('../www/import.js');
const Glow = require('../www/glow.js');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wwwJs = () => fs.readdirSync(WWW).filter((f) => f.endsWith('.js'));

// ---------- К1: никаких lookbehind и именованных групп ----------
// WebView 60-61 (Android 7-8 без обновлений) не разбирает (?<…): весь файл не грузится -
// для icons.js это пустой экран.
test('К1: в www/*.js нет (?< (lookbehind, именованные группы) - старый WebView их не разбирает', () => {
  const bad = [];
  wwwJs().forEach((f) => {
    rd('www/' + f).split('\n').forEach((l, i) => { if (l.indexOf('(?<') >= 0) bad.push(f + ':' + (i + 1)); });
  });
  assert.deepEqual(bad, []);
});

test('К1: «р» в конце суммы при загрузке таблиц - по-прежнему валюта, не часть слова', () => {
  assert.equal(Import.parseAmount('500р'), 500);
  assert.equal(Import.parseAmount('1 234,56 р'), 1234.56);
  assert.equal(Import.parseAmount('-300Р'), -300);
  assert.equal(Import.parseAmount('700 руб.'), 700);
  assert.ok(isNaN(Import.parseAmount('сорок пр')), '«пр» - не рубли');
});

// ---------- К6: кириллические \b ----------
// \b в JS знает только латиницу: «газ\b» на «Газ» не срабатывает никогда.
test('К6: нет \\b рядом с кириллицей в www/*.js', () => {
  const bad = [];
  wwwJs().forEach((f) => {
    const src = rd('www/' + f);
    let i = -1;
    while ((i = src.indexOf('\\b', i + 1)) >= 0) {
      const before = src.slice(Math.max(0, i - 12), i).replace(/[)\]?*+]+$/, '');
      const after = src.slice(i + 2, i + 4);
      if (/[а-яё]$/i.test(before) || /^[(\[]?[а-яё]/i.test(after)) bad.push(f + ':' + src.slice(0, i).split('\n').length);
    }
  });
  assert.deepEqual(bad, []);
});

test('К6: короткие слова получают свои иконки', () => {
  const e = (n) => Icons.guessKind(n, 'exp');
  [['Еда', 'food'], ['Еды', 'food'], ['Газ', 'wrench'], ['Свет и газ', 'wrench'], ['Зал', 'sport'],
   ['Тренажёрный зал', 'sport'], ['Сад', 'baby'], ['Садик', 'baby'], ['Цветы', 'heart'], ['Лента', 'cart']
  ].forEach(([n, k]) => assert.equal(e(n), k, n));
  assert.equal(Icons.guessKind('Своё дело', 'inc'), 'bizup');
  assert.equal(Icons.guessKind('Мир', 'wallet'), 'card');
  assert.equal(Icons.guessKind('Карта Мир', 'wallet'), 'card');
  // похожие слова не перехвачены
  ['Газпромбанк', 'Газета', 'Зала ожидания нет', 'Садовод'].forEach((n) => assert.ok(['wrench', 'sport', 'baby'].indexOf(e(n)) < 0, n + ' -> ' + e(n)));
  [['Газпромбанк', 'wallet', 'card'], ['Залог', 'exp', null], ['Садовник', 'exp', null], ['Мирный', 'wallet', 'wallet']]
    .forEach(([n, kind, k]) => {
      const g = Icons.guessKind(n, kind);
      if (k) assert.equal(g, k, n); else assert.ok(g !== 'sport' && g !== 'baby', n + ' -> ' + g);
    });
});

// ---------- К3: иконка только своего вида ----------
const EXP_NAMES = ('Продукты питания|Детские товары|Детский сад|Детское питание|Детская одежда|Детские игрушки|' +
  'Детские кружки|Детский лагерь|Детские расходы|Детсад|Садик|Подгузники|Социальные сети|Пенсионные взносы|' +
  'НПФ взносы|Пенсия родителям|Пенсия маме|Помощь маме|Льготные лекарства|Декретный отпуск|Кешбэк-сервис|' +
  'Кэшбэк сервис|Пособие по уходу|Выплаты по кредиту|Зарплата няне|Консультации юриста|Аренда|Сдача анализов|' +
  'Курсы|Подписки|Крипта|Фриланс|Продажа|Гонорар|Бизнес|Дивиденды|Возврат|Прочее|Своё дело|Пособия|Кешбэк').split('|');
const INC_NAMES = ('Зарплата мужа|Детские пособия|Детские выплаты|Пособие на ребёнка|Социальный налоговый вычет|' +
  'Возврат НДФЛ|Продажа детских вещей|Сдача квартиры|Доход от бара|Бар (доход)|Сигареты (перепродажа)|' +
  'Комиссия агента|Обслуживание клиентов|Подписчики|Стриминг донаты|Игры (выигрыш)|Кино (подработка)|' +
  'Страховая выплата|Такси (подработка)|Ремонт квартир|Ремонт|Бензин|Еда|Транспорт|Магазин|Красота|Мебель|' +
  'Телевизор|Алкоголь|Штраф|Налоговый вычет|Чаевые|Алименты').split('|');

test('К3: расход не получает иконку только-дохода, доход - только-расхода', () => {
  const bad = [];
  EXP_NAMES.forEach((n) => { const k = Icons.guessKind(n, 'exp'); if (Icons.SETS.exp.indexOf(k) < 0) bad.push('exp ' + n + ' -> ' + k); });
  INC_NAMES.forEach((n) => { const k = Icons.guessKind(n, 'inc'); if (Icons.SETS.inc.indexOf(k) < 0) bad.push('inc ' + n + ' -> ' + k); });
  assert.deepEqual(bad, []);
  // чужая таблица по-прежнему помогает, если ключ есть в своём наборе
  assert.equal(Icons.guessKind('Выплата долга', 'inc'), 'percent');
  assert.equal(Icons.guessKind('Курсы', 'exp'), 'education');
  // запасная своего вида
  assert.equal(Icons.guessKind('Пенсия маме', 'exp'), Icons.fallback('exp'));
  assert.equal(Icons.guessKind('Страховая выплата', 'inc'), Icons.fallback('inc'));
  // старое API категорий (вид не известен) - как было: доходные тоже находятся
  assert.equal(Icons.guess('Пенсия'), 'pension');
});

test('К3: детское - «Дети»; «социальн» в доходах - только выплаты/пособия/помощь/контракт', () => {
  ['Детские товары', 'Детский сад', 'Детсад', 'Садик', 'Детский садик', 'Детское питание', 'Детские расходы', 'Дети']
    .forEach((n) => assert.equal(Icons.guessKind(n, 'exp'), 'baby', n));
  const i = (n) => Icons.guessKind(n, 'inc');
  ['Социальные выплаты', 'Соц. выплаты', 'Социальная помощь', 'Социальное пособие', 'Социальный контракт', 'Пособия']
    .forEach((n) => assert.equal(i(n), 'benefit', n));
  ['Социальные сети', 'Социальный налоговый вычет', 'Социальная реклама'].forEach((n) => assert.notEqual(i(n), 'benefit', n));
});

// ---------- К7: порядок правил ----------
test('К7: стиральная/посудомоечная машина - бытовая техника; спорт-/суши-бар - не алкоголь; электроника - техника', () => {
  const e = (n) => Icons.guessKind(n, 'exp');
  ['Стиральная машина', 'Посудомоечная машина', 'Посудомойка'].forEach((n) => assert.equal(e(n), 'tv', n));
  ['Спорт-бар', 'Фитнес-бар', 'Суши-бар', 'Салат-бар', 'Протеиновый бар', 'Протеиновые батончики']
    .forEach((n) => assert.notEqual(e(n), 'wine', n));
  ['Бар', 'Бары', 'Бары и клубы', 'Пиво', 'Вино'].forEach((n) => assert.equal(e(n), 'wine', n));
  assert.equal(e('Электроника'), 'laptop');
  ['Электричество', 'Электроэнергия', 'ЖКХ'].forEach((n) => assert.equal(e(n), 'wrench', n));
  assert.equal(e('Машина'), 'car');
});

// ---------- К2: правка только заметки ----------
function frozenState() {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 10000 }); w.baseTs = 0;
  const w2 = Engine.addWallet(S, { name: 'Нал', base: 1000 }); w2.baseTs = 0;
  const c = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const t = Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-09-01', catId: c.id, walletId: w.id });
  t.ts = 1000;
  const t2 = Engine.addTx(S, { kind: 'exp', amount: 70, date: '2026-09-01', catId: c.id, walletId: w.id });
  t2.ts = 2000;
  Engine.setWalletBase(S, w.id, 9430);   // «Изменить баланс»: обе операции вшиты в base
  return { S, w, w2, c, t, t2 };
}

test('К2: noteOnlyEdit - заметка единственное, что поменялось', () => {
  const { t, w, w2, c } = frozenState();
  const same = { amount: 500, date: t.date, walletId: w.id, catId: c.id, note: 'x' };
  assert.equal(Engine.noteOnlyEdit(t, same), true);
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { amount: '500' })), true, 'сумма строкой');
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { amount: 500.004 })), true, 'копейки после округления');
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { amount: 501 })), false);
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { date: '2026-09-02' })), false);
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { walletId: w2.id })), false);
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { catId: 'zzz' })), false);
  assert.equal(Engine.noteOnlyEdit(t, Object.assign({}, same, { toWalletId: w2.id })), false);
  assert.equal(Engine.noteOnlyEdit(null, same), false);
});

test('К2: setTxNote у операции до «Изменить баланс» - ts, base, лента и баланс не сдвигаются', () => {
  const { S, w, t, t2 } = frozenState();
  const feed0 = S.tx.slice().sort(Engine.byNewest).map((x) => x.id);
  const base0 = w.base, bal0 = Engine.walletBalance(S, w.id), ts0 = t.ts;
  const r = Engine.setTxNote(S, t.id, '  подарок \n маме ');
  assert.equal(r, t);
  assert.equal(t.note, 'подарок маме');
  assert.equal(t.ts, ts0, 'ts сдвинут - операция «разморожена»');
  assert.equal(w.base, base0, 'base кошелька сдвинут');
  assert.equal(Engine.walletBalance(S, w.id), bal0);
  assert.deepEqual(S.tx.slice().sort(Engine.byNewest).map((x) => x.id), feed0, 'порядок в ленте поменялся');
  assert.ok(Engine.isFrozen(S, t), 'операция перестала быть вшитой');
  Engine.setTxNote(S, t.id, '   ');
  assert.ok(!('note' in t), 'пустая заметка осталась полем');
  assert.equal(Engine.setTxNote(S, 'нет-такой', 'x'), null);
  assert.equal(t2.ts, 2000);
});

test('К2: setTxNote у платежа по долгу - проценты и недоплата процентов не пересчитываются', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 500000 }); w.baseTs = 0;
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 300000, pay: 15000, day: 10, rate: 18, date: '2026-03-01', now: 0 });
  const ids = [];
  ['2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10'].forEach((dt, i) => {
    const r = Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: i === 1 ? 900 : 15000, date: dt });
    r.txs[0].ts = 1000 * (i + 1);
    ids.push(r.txs[0].id);
    if (i === 2) Engine.setDebtBase(S, d.id, Engine.debtBalance(S, d.id) - 1234);
  });
  Engine.setWalletBase(S, w.id, Engine.walletBalance(S, w.id));
  const snap = () => JSON.stringify(S.tx.map((t) => [t.id, t.amount, t.ts, t.int || 0, t.intLeft || 0, !!t.payoff]));
  const s0 = snap(), b0 = Engine.debtBalance(S, d.id), wb0 = w.base;
  ids.forEach((id) => Engine.setTxNote(S, id, 'заметка'));
  assert.equal(snap(), s0, 'платежи сдвинулись');
  assert.equal(Engine.debtBalance(S, d.id), b0);
  assert.equal(w.base, wb0);
  ids.forEach((id) => assert.equal(Engine.findTx(S, id).note, 'заметка'));
});

test('К2: правка формы зовёт setTxNote, а не updateTx/editDebtTx, когда поменялась только заметка', () => {
  const src = rd('www/sheet.js');
  const body = src.slice(src.indexOf('function saveEditTx'), src.indexOf('function saveEditDebt'));
  const ni = body.indexOf('Engine.noteOnlyEdit(t, patch)'), si = body.indexOf('Engine.setTxNote(');
  assert.ok(ni > 0 && si > ni, 'нет ветки «только заметка»');
  assert.ok(body.indexOf('saveEditDebt(') > ni && body.indexOf('Engine.updateTx(') > ni, 'ветка «только заметка» после записи суммы');
});

// ---------- К8: импорт пишет заметку правилом движка ----------
test('К8: загрузка таблицы - заметка через Engine.cleanNote (одна строка, предел движка)', () => {
  const S = Engine.migrate(Engine.defaultState());
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 });
  const c = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const long = 'Оплата\nтоваров   и услуг ' + 'я'.repeat(300);
  const pl = { over: false, newCats: { exp: [], inc: [] }, newWallets: [],
    add: [{ date: '2026-09-01', kind: 'exp', amount: 10, catRef: c.id, walletRef: w.id, toRef: null, note: long, ts: 1 },
          { date: '2026-09-01', kind: 'exp', amount: 11, catRef: c.id, walletRef: w.id, toRef: null, note: '  \n ', ts: 2 }] };
  Import.apply(S, pl, { name: 'x.xlsx' }, Engine);
  const a = S.tx.find((t) => t.amount === 10), b = S.tx.find((t) => t.amount === 11);
  assert.equal(a.note, Engine.cleanNote(long));
  assert.equal(Array.from(a.note).length, Engine.NOTE_KEEP);
  assert.ok(!('note' in b), 'пустая заметка из таблицы записана полем');
  assert.ok(!/var NOTE_MAX/.test(rd('www/import.js')), 'в import.js остался свой предел заметки');
});

// ---------- К9: заметки бесплатно, флага нет ----------
test('К9: NOTES_FREE / notesAllowed убраны', () => {
  const bad = wwwJs().filter((f) => /NOTES_FREE|notesAllowed/.test(rd('www/' + f)));
  assert.deepEqual(bad, []);
});

// ---------- К11: cleanNote без лишней работы ----------
test('К11: cleanNote - чистая короткая заметка без replace и Array.from, результат прежний', () => {
  function ref(v) {
    if (typeof v !== 'string') return '';
    const s = v.replace(/\s+/g, ' ').trim(), ch = Array.from(s);
    return ch.length > 200 ? ch.slice(0, 200).join('').trim() : s;
  }
  const rep0 = String.prototype.replace, af0 = Array.from;
  let reps = 0, afs = 0;
  try {
    String.prototype.replace = function () { reps++; return rep0.apply(this, arguments); };
    Array.from = function () { afs++; return af0.apply(this, arguments); };
    for (let i = 0; i < 100; i++) Engine.cleanNote('Оплата товаров и услуг. ПЯТЁРОЧКА 1234 #' + i);
  } finally { String.prototype.replace = rep0; Array.from = af0; }
  assert.equal(reps, 0, 'replace на чистой заметке');
  assert.equal(afs, 0, 'Array.from на короткой заметке');
  const pool = [' ', '  ', 'a', 'я', 'b'].concat([0x09, 0x0a, 0x0b, 0xa0, 0x2028, 0x3000, 0xfeff, 0xd83d].map((c) => String.fromCharCode(c)), [String.fromCodePoint(0x1F600)]);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 20000; k++) {
    let s = ''; const n = Math.floor(rnd() * 260);
    for (let i = 0; i < n; i++) s += pool[Math.floor(rnd() * pool.length)];
    assert.equal(Engine.cleanNote(s), ref(s), JSON.stringify(s));
  }
  [null, 5, undefined, '', ' ', 'x'.repeat(250), '\u{1F600}'.repeat(250)].forEach((v) => assert.equal(Engine.cleanNote(v), ref(v)));
});

// ---------- К14: подсветка без уровня «до» ----------
test('К14: Glow.pick без уровня «до» при правке - красной нет', () => {
  // с 17.10 новая трата сверх лимита красная всегда (Алексей); К14 стережёт правку
  assert.equal(Glow.pick('exp', undefined, 'over', true, true), null);
  assert.equal(Glow.pick('exp', 'warn', 'over', true, true), 'over');
  assert.equal(Glow.pick('exp', null, 'over', true, true), 'over', 'категория без уровня (null) - явный переход');
});

test('К14: self-test зовёт soundTx с уровнем «до» (4 аргумента и больше)', () => {
  const src = rd('www/selftest.js');
  const bad = [];
  const re = /UI\.soundTx\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(src))) if (m[1].split(',').length < 4) bad.push(m[0]);
  assert.deepEqual(bad, []);
});
