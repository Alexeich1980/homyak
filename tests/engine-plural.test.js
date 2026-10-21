// Русское склонение по числу: подпись «N операций» в карточке кошелька/категории.
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

const op = (n) => n + ' ' + Engine.plural(n, 'операция', 'операции', 'операций');

test('plural: единственное число', () => {
  assert.strictEqual(op(1), '1 операция');
  assert.strictEqual(op(21), '21 операция');
  assert.strictEqual(op(101), '101 операция');
  assert.strictEqual(op(1001), '1001 операция');
});

test('plural: два-четыре', () => {
  assert.strictEqual(op(2), '2 операции');
  assert.strictEqual(op(3), '3 операции');
  assert.strictEqual(op(4), '4 операции');
  assert.strictEqual(op(22), '22 операции');
  assert.strictEqual(op(104), '104 операции');
});

test('plural: множественное и подростки 11-14', () => {
  assert.strictEqual(op(0), '0 операций');
  assert.strictEqual(op(5), '5 операций');
  assert.strictEqual(op(11), '11 операций');
  assert.strictEqual(op(12), '12 операций');
  assert.strictEqual(op(14), '14 операций');
  assert.strictEqual(op(100), '100 операций');
  assert.strictEqual(op(111), '111 операций');
});

test('plural: мусор на входе не роняет', () => {
  assert.strictEqual(Engine.plural(NaN, 'a', 'b', 'c'), 'c');
  assert.strictEqual(Engine.plural(undefined, 'a', 'b', 'c'), 'c');
  assert.strictEqual(Engine.plural(-1, 'a', 'b', 'c'), 'a');
});
