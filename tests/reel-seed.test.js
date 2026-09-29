const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');

// Строим состояние персоны на текущем месяце (todayStr=сегодня), чтобы даты фактов
// не оказались в будущем относительно реального дня прогона тестов.
function build(persona) {
  return Engine.migrate(Seed.reelState(Engine, persona, Engine.today()));
}
const YM = Engine.ym(Engine.today());
function catByName(S, name) { return Engine.listCategories(S, 'exp').find(c => c.name === name); }
function level(S, c) { return Engine.fill(Engine.catFact(S, c.id, YM), Engine.catLimit(S, c.id, YM)); }
function walletByName(S, name) { return S.wallets.find(w => w.name === name); }

// профиль уровней категорий персоны: сколько зелёных / оранжевых / красных
function levelCounts(S) {
  const acc = { ok: 0, warn: 0, over: 0, none: 0 };
  Engine.listCategories(S, 'exp').forEach(c => { acc[level(S, c).level]++; });
  return acc;
}

test('reel персона 1 «Кофе»: «Кафе» в зелёной зоне и остаётся зелёной после расхода ~200', () => {
  const S = build(1);
  const cafe = catByName(S, 'Кафе');
  assert.ok(cafe, 'категория «Кафе» есть');
  assert.strictEqual(level(S, cafe).level, 'ok');   // старт зелёный
  // сцена: кофе ~200 ₽ с Наличных
  const cash = walletByName(S, 'Наличные');
  assert.ok(cash, 'кошелёк «Наличные» для перетаскивания есть');
  Engine.addTx(S, { kind: 'exp', amount: 200, date: Engine.today(), catId: cafe.id, walletId: cash.id });
  assert.strictEqual(level(S, cafe).level, 'ok');   // после расхода всё ещё зелёный
  assert.ok(walletByName(S, 'Карта'), 'кошелёк «Карта» есть');
});

test('reel персона 1: наполненный экран — 10-12 категорий, микс зелёный/оранжевый/красный', () => {
  const S = build(1);
  const n = Engine.listCategories(S, 'exp').length;
  assert.ok(n >= 10 && n <= 12, 'категорий расходов 10-12, факт: ' + n);
  const c = levelCounts(S);
  assert.ok(c.ok >= 4, 'несколько зелёных, факт: ' + c.ok);
  assert.ok(c.warn >= 2, 'пара оранжевых 80-99%, факт: ' + c.warn);
  assert.ok(c.over >= 1, 'хотя бы одна красная, факт: ' + c.over);
  // кошельки и источник дохода
  assert.ok(S.wallets.length >= 3, 'кошельков 3+, факт: ' + S.wallets.length);
  const salary = Engine.listCategories(S, 'inc').find(x => x.name === 'Зарплата');
  assert.ok(salary, 'источник дохода «Зарплата» есть');
  assert.ok(Engine.catFact(S, salary.id, YM) > 0, 'по зарплате есть поступление');
});

test('reel персона 2 «Парфюм»: «Красота» красная, ровно 153%, рядом зелёные', () => {
  const S = build(2);
  const kr = catByName(S, 'Красота');
  assert.ok(kr, 'категория «Красота» есть');
  assert.strictEqual(Engine.catFact(S, kr.id, YM), 9200);
  assert.strictEqual(Engine.catLimit(S, kr.id, YM), 6000);
  const f = level(S, kr);
  assert.strictEqual(f.level, 'over');              // красный (доля >= 100%)
  assert.strictEqual(Math.round(f.ratio * 100), 153);
  const greens = Engine.listCategories(S, 'exp').filter(c => level(S, c).level === 'ok');
  assert.ok(greens.length >= 2, 'есть хотя бы 2 зелёные для контраста');
});

test('reel персона 2: наполненный экран — 10-12 категорий, микс уровней, ровно одна красная (Красота)', () => {
  const S = build(2);
  const n = Engine.listCategories(S, 'exp').length;
  assert.ok(n >= 10 && n <= 12, 'категорий расходов 10-12, факт: ' + n);
  const cnt = levelCounts(S);
  assert.ok(cnt.ok >= 4, 'несколько зелёных, факт: ' + cnt.ok);
  assert.ok(cnt.warn >= 2, 'пара оранжевых, факт: ' + cnt.warn);
  assert.strictEqual(cnt.over, 1, 'красная ровно одна — «Красота»');
  assert.ok(S.wallets.length >= 3, 'кошельков 3+, факт: ' + S.wallets.length);
});

test('reel персона 3 «Дом»: перевод 30000 Зарплатная → Кредитка гасит долг в ноль', () => {
  const S = build(3);
  const salary = walletByName(S, 'Зарплатная карта');
  const credit = walletByName(S, 'Кредитка');
  assert.ok(salary && credit);
  assert.strictEqual(Engine.walletBalance(S, salary.id), 85000);
  assert.strictEqual(Engine.walletBalance(S, credit.id), -30000);
  Engine.addTx(S, { kind: 'transfer', amount: 30000, date: Engine.today(),
    walletId: salary.id, toWalletId: credit.id });
  assert.strictEqual(Engine.walletBalance(S, credit.id), 0);      // долг ровно в ноль
  assert.strictEqual(Engine.walletBalance(S, salary.id), 55000);
});

test('reel персона 3: сводка даёт разброс зелёный/оранжевый/красный', () => {
  const S = build(3);
  const levels = Engine.listCategories(S, 'exp').map(c => level(S, c).level);
  assert.ok(levels.includes('ok'), 'есть зелёная');
  assert.ok(levels.includes('warn'), 'есть оранжевая');
  assert.ok(levels.includes('over'), 'есть красная');
});

test('reel персона 3: наполненный экран — 10-12 категорий, зарплата на Зарплатной = 85000', () => {
  const S = build(3);
  const n = Engine.listCategories(S, 'exp').length;
  assert.ok(n >= 10 && n <= 12, 'категорий расходов 10-12, факт: ' + n);
  const c = levelCounts(S);
  assert.ok(c.ok >= 3 && c.warn >= 2 && c.over >= 1, 'разброс уровней: ' + JSON.stringify(c));
  // источник дохода даёт ровно баланс Зарплатной 85000 (база 0 + поступление 85000)
  const salary = Engine.listCategories(S, 'inc').find(x => x.name === 'Зарплата');
  assert.ok(salary && Engine.catFact(S, salary.id, YM) === 85000, 'по зарплате поступление 85000');
});

test('reelState помечает onboarded (кадр не закрыт приветствием) и не ставит demo-плашку', () => {
  const S = build(1);
  assert.strictEqual(S.ui.onboarded, true);
  assert.ok(!S.ui.demo, 'reel не поднимает плашку «Очистить демо»');
});
