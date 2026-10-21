/* calc-amount.test.js — калькулятор в поле суммы правки операции (просьба Алексея 29.09.2026):
   Engine.calcAmount считает + − × ÷ сам, без eval; sheet.js сохраняет сумму через него,
   ui.js вешает ряд кнопок-знаков. */
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const Engine = require('../www/engine.js');
const NB = Engine.NBSP;

test('calcAmount: обычная сумма в формате приложения', () => {
  assert.strictEqual(Engine.calcAmount('1' + NB + '200'), 1200);
  assert.strictEqual(Engine.calcAmount(Engine.fmt(12000.5)), 12000.5);
  assert.strictEqual(Engine.calcAmount('350,75'), 350.75);
});

test('calcAmount: четыре действия и их порядок', () => {
  assert.strictEqual(Engine.calcAmount('150+300'), 450);
  assert.strictEqual(Engine.calcAmount('1000−250'), 750);
  assert.strictEqual(Engine.calcAmount('1000-250'), 750);
  assert.strictEqual(Engine.calcAmount('150×3'), 450);
  assert.strictEqual(Engine.calcAmount('150*3'), 450);
  assert.strictEqual(Engine.calcAmount('900÷2'), 450);
  assert.strictEqual(Engine.calcAmount('900/2'), 450);
  assert.strictEqual(Engine.calcAmount('100+50×2'), 200, 'умножение раньше сложения');
  assert.strictEqual(Engine.calcAmount('100−20÷4'), 95, 'деление раньше вычитания');
  assert.strictEqual(Engine.calcAmount('1' + NB + '200+300'), 1500, 'разряды в выражении');
  assert.strictEqual(Engine.calcAmount('10÷3'), 3.33, 'до копеек');
  assert.strictEqual(Engine.calcAmount('0,1+0,2'), 0.3);
});

test('calcAmount: висящий знак отбрасывается, брак - NaN', () => {
  assert.strictEqual(Engine.calcAmount('150+'), 150);
  assert.ok(Number.isNaN(Engine.calcAmount('')));
  assert.ok(Number.isNaN(Engine.calcAmount('abc')));
  assert.ok(Number.isNaN(Engine.calcAmount('100÷0')), 'деление на ноль');
  assert.ok(Number.isNaN(Engine.calcAmount('1.2.3')));
  assert.ok(Number.isNaN(Engine.calcAmount('5+×3')), 'два знака подряд');
  assert.ok(Number.isNaN(Engine.calcAmount('alert(1)')));
  assert.strictEqual(Engine.calcAmount('-50'), -50, 'минус впереди - отрицательное, сохранение его отвергнет');
});

test('hasCalcOp: действие есть / минус в начале - не действие', () => {
  assert.strictEqual(Engine.hasCalcOp('150+300'), true);
  assert.strictEqual(Engine.hasCalcOp('900÷2'), true);
  assert.strictEqual(Engine.hasCalcOp('1' + NB + '200'), false);
  assert.strictEqual(Engine.hasCalcOp('-50'), false);
});

test('правка операции: поле с кнопками-знаками, сохранение через calcAmount', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'www', 'sheet.js'), 'utf8');
  const edit = src.slice(src.indexOf('function editTx('), src.indexOf('function repeatTx('));
  ['+', '−', '×', '÷', '='].forEach(k => assert.ok(edit.includes('data-op="' + k + '"'), 'нет кнопки ' + k));
  assert.ok(edit.includes("UI.calcInput($('etAmount'), $('etOps'), $('etRes'))"), 'калькулятор не подключён к полю');
  const save = src.slice(src.indexOf('function saveEditTx('), src.indexOf('// ---------- связки'));
  assert.ok(save.includes('Engine.calcAmount('), 'сохранение не считает выражение');
  assert.ok(!save.includes('Engine.parseNum('), 'сохранение снова читает сумму без калькулятора');
});
