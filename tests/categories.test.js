const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');

test('addCategory кладёт в нужный список с order по хвосту', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда', icon: 'food', color: 'red' });
  const b = Engine.addCategory(S, 'exp', { name: 'Дом' });
  assert.strictEqual(S.categories.exp.length, 2);
  assert.strictEqual(a.order, 0); assert.strictEqual(b.order, 1);
  assert.strictEqual(a.name, 'Еда'); assert.strictEqual(a.icon, 'food');
  assert.strictEqual(b.icon, 'dot'); // дефолтная иконка
});

test('addCategory в доход не смешивается с расходом', () => {
  const S = Engine.defaultState();
  Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  assert.strictEqual(S.categories.inc.length, 1);
  assert.strictEqual(S.categories.exp.length, 0);
  assert.strictEqual(Engine.catKind(S, S.categories.inc[0].id), 'inc');
});

test('archiveCategory убирает из активного списка; includeArchived видит', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.archiveCategory(S, a.id);
  assert.strictEqual(Engine.listCategories(S, 'exp').length, 0);
  assert.strictEqual(Engine.listCategories(S, 'exp', { includeArchived: true }).length, 1);
  Engine.archiveCategory(S, a.id, false); // вернуть
  assert.strictEqual(Engine.listCategories(S, 'exp').length, 1);
});

test('updateCategory меняет имя/иконку, id не трогает', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.updateCategory(S, a.id, { name: 'Продукты', icon: 'cart', id: 'hack' });
  assert.strictEqual(S.categories.exp[0].name, 'Продукты');
  assert.strictEqual(S.categories.exp[0].icon, 'cart');
  assert.strictEqual(S.categories.exp[0].id, a.id);
});

test('listCategories соблюдает порядок из ui.order', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'A' });
  const b = Engine.addCategory(S, 'exp', { name: 'B' });
  Engine.reorderCategories(S, 'exp', [b.id, a.id]);
  const names = Engine.listCategories(S, 'exp').map(c => c.name);
  assert.deepStrictEqual(names, ['B', 'A']);
});
