// Разряды: единственный форматтер сумм и обратный разбор.
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

const NB = ' ';   // неразрывный пробел — разделитель разрядов во всём приложении

test('fmt: разряды и знак', () => {
  assert.strictEqual(Engine.NBSP, NB);
  assert.strictEqual(Engine.fmt(0), '0');
  assert.strictEqual(Engine.fmt(999), '999');
  assert.strictEqual(Engine.fmt(1000), '1' + NB + '000');
  assert.strictEqual(Engine.fmt(1234567), '1' + NB + '234' + NB + '567');
  assert.strictEqual(Engine.fmt(-5000), '−5' + NB + '000');
  assert.strictEqual(Engine.fmt(-1), '−1');
});

test('fmt: копейки только когда они есть', () => {
  assert.strictEqual(Engine.fmt(12.5), '12,50');
  assert.strictEqual(Engine.fmt(1234.56), '1' + NB + '234,56');
  assert.strictEqual(Engine.fmt(1000.0), '1' + NB + '000');
  assert.strictEqual(Engine.fmt(-0.4), '−0,40');
  assert.strictEqual(Engine.fmt(0.004), '0');           // до копейки не дотягивает — и минуса нет
  assert.strictEqual(Engine.fmt(-0.004), '0');
  assert.strictEqual(Engine.fmt(9.999), '10');          // копейки схлопнулись в рубль
});

test('fmt: мусор на входе не роняет', () => {
  assert.strictEqual(Engine.fmt(NaN), '0');
  assert.strictEqual(Engine.fmt(null), '0');
  assert.strictEqual(Engine.fmt(undefined), '0');
  assert.strictEqual(Engine.fmt(Infinity), '0');
  assert.strictEqual(Engine.fmt('2500'), '2' + NB + '500');
});

test('fmtTyped: набранное на клавиатуре с разрядами', () => {
  assert.strictEqual(Engine.fmtTyped('12500'), '12' + NB + '500');
  assert.strictEqual(Engine.fmtTyped('1200,5'), '1' + NB + '200,5');
  assert.strictEqual(Engine.fmtTyped('12500+300'), '12' + NB + '500+300');
  assert.strictEqual(Engine.fmtTyped('1000×12'), '1' + NB + '000×12');
  assert.strictEqual(Engine.fmtTyped('1500,'), '1' + NB + '500,');   // запятую только что нажали
  assert.strictEqual(Engine.fmtTyped(''), '');
  assert.strictEqual(Engine.fmtTyped(null), '');
});

test('parseNum: показанное число читается обратно', () => {
  assert.strictEqual(Engine.parseNum('1' + NB + '234'), 1234);
  assert.strictEqual(Engine.parseNum('1 234'), 1234);
  assert.strictEqual(Engine.parseNum('−5' + NB + '000'), -5000);     // типографский минус
  assert.strictEqual(Engine.parseNum('-5000'), -5000);
  assert.strictEqual(Engine.parseNum('12,50'), 12.5);
  assert.strictEqual(Engine.parseNum('0'), 0);
  assert.ok(Number.isNaN(Engine.parseNum('')));
  assert.ok(Number.isNaN(Engine.parseNum('   ')));
  assert.ok(Number.isNaN(Engine.parseNum('ерунда')));
  assert.ok(Number.isNaN(Engine.parseNum(null)));
});

test('fmt ↔ parseNum: круг замыкается', () => {
  [0, 999, 1000, 1234567, -5000, 12.5, -1234.56].forEach((v) => {
    assert.strictEqual(Engine.parseNum(Engine.fmt(v)), v, 'значение ' + v);
  });
});
