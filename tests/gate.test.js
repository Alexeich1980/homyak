const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');

test('free-гейт: 2 кошелька', () => {
  const S = Engine.defaultState();
  assert.strictEqual(Engine.canAddWallet(S, false), true);
  Engine.addWallet(S, { name: 'W1' });
  Engine.addWallet(S, { name: 'W2' });
  assert.strictEqual(Engine.walletsActiveCount(S), 2);
  assert.strictEqual(Engine.canAddWallet(S, false), false);
  assert.strictEqual(Engine.canAddWallet(S, true), true); // полный доступ снимает лимит
});

test('free-гейт: 8 расходных категорий; доход не режется', () => {
  const S = Engine.defaultState();
  for (let i = 0; i < 8; i++) Engine.addCategory(S, 'exp', { name: 'C' + i });
  assert.strictEqual(Engine.expCatsActiveCount(S), 8);
  assert.strictEqual(Engine.canAddExpCat(S, false), false);
  assert.strictEqual(Engine.canAddExpCat(S, true), true);
  // доходные не участвуют в лимите расходных
  for (let i = 0; i < 5; i++) Engine.addCategory(S, 'inc', { name: 'I' + i });
  assert.strictEqual(Engine.canAddExpCat(S, false), false);
});

test('архивная категория не занимает место в лимите', () => {
  const S = Engine.defaultState();
  const cats = [];
  for (let i = 0; i < 8; i++) cats.push(Engine.addCategory(S, 'exp', { name: 'C' + i }));
  Engine.archiveCategory(S, cats[0].id);
  assert.strictEqual(Engine.expCatsActiveCount(S), 7);
  assert.strictEqual(Engine.canAddExpCat(S, false), true);
});

test('free-гейт дохода: 1 источник бесплатно, полный доступ снимает', () => {
  const E = require('../www/engine.js');
  const S = E.defaultState();
  assert.strictEqual(E.FREE.incCats, 1);
  E.addCategory(S, 'inc', { name: 'Зарплата' });
  assert.strictEqual(E.canAddIncCat(S, false), false);   // 2-й источник — только по полному доступу
  assert.strictEqual(E.canAddIncCat(S, true), true);
});

test('предохранитель HARD 100/50/50 действует даже на полном доступе', () => {
  const E = require('../www/engine.js');
  assert.deepStrictEqual(E.HARD, { wallets: 50, expCats: 100, incCats: 50 });
  const S = E.defaultState();
  for (let i = 0; i < 100; i++) E.addCategory(S, 'exp', { name: 'E' + i });
  assert.strictEqual(E.canAddExpCat(S, true), false);   // полный доступ, но упор в предохранитель
  for (let i = 0; i < 50; i++) E.addCategory(S, 'inc', { name: 'I' + i });
  assert.strictEqual(E.canAddIncCat(S, true), false);
  for (let i = 0; i < 50; i++) E.addWallet(S, { name: 'W' + i });
  assert.strictEqual(E.canAddWallet(S, true), false);
});
