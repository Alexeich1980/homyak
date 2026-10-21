// Размер плитки: чистые функции подбора кольца и его геометрии.
// Всё, что рисует плитку в ui.js/style.css, считается отсюда — значит проверяется тут.
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

const GAP = 2;   // .page { gap: 6px 2px } — зазор между колонками

test('ringSize: кольцо тянется за шириной колонки', () => {
  // узкий телефон (360): колонка ~79 px
  assert.equal(Engine.ringSize(324, GAP), 56);
  // широкий (412): колонка ~92 px
  assert.equal(Engine.ringSize(374, GAP), 64);
});

test('ringSize: границы 54…68 не пробиваются', () => {
  assert.equal(Engine.ringSize(100, GAP), Engine.RING_MIN, 'узкая сетка — пол 54');
  assert.equal(Engine.ringSize(0, GAP), Engine.RING_MIN, 'нулевая ширина — пол 54');
  assert.equal(Engine.ringSize(2000, GAP), Engine.RING_MAX, 'планшетная ширина — потолок 68');
  assert.equal(Engine.ringSize(NaN, GAP), Engine.RING_MIN, 'мусор — пол 54');
});

test('ringSize: ровно 0.70 ширины колонки', () => {
  // колонка 100 px: (406 - 3*2)/4 = 100 → 70
  assert.equal(Engine.ringSize(406, GAP), 68, 'выше потолка — 68');
  // колонка 90 → 63
  assert.equal(Engine.ringSize(366, GAP), 63);
});

test('ringGeom: геометрия выводится из размера, зашитых чисел нет', () => {
  const g = Engine.ringGeom(54);
  assert.equal(g.sw, 4.5, 'обводка при 54');
  assert.equal(g.r, 24.75, 'радиус при 54');
  assert.ok(Math.abs(g.circ - 155.51) < 0.01, 'длина окружности при 54: ' + g.circ);
  assert.equal(g.ico, 27, 'глиф — половина кольца');
  const b = Engine.ringGeom(64);
  assert.ok(b.r > g.r && b.sw > g.sw && b.circ > g.circ, 'на большем кольце всё больше');
  assert.equal(b.ico, 32, 'глиф — половина кольца и на 64');
  assert.equal(Engine.ringGeom(10).size, Engine.RING_MIN, 'ниже 54 геометрию не считаем');
});

test('ringGeom: радиус лежит по середине обводки', () => {
  [54, 58, 63, 68].forEach(s => {
    const g = Engine.ringGeom(s);
    assert.ok(Math.abs((g.r * 2 + g.sw) - s) < 0.01, 'диаметр по внешнему краю при ' + s);
    assert.ok(Math.abs(g.circ - 2 * Math.PI * g.r) < 0.01, 'длина окружности при ' + s);
  });
});

test('ringFit: места хватает — берём идеальный размер', () => {
  // 412: колонка 92 → 64; четыре ряда по (64 + 42) + 3*6 = 442
  const r = Engine.ringFit({ gridW: 374, gapX: GAP, rows: 4, label: 42, gap: 6, avail: 460 });
  assert.equal(r, 64);
});

test('ringFit: места мало — шаг вниз по 2 px', () => {
  // при avail 430 идеальные 64 не встают (442), 62 — тоже (434), 60 — да (426)
  const r = Engine.ringFit({ gridW: 374, gapX: GAP, rows: 4, label: 42, gap: 6, avail: 430 });
  assert.equal(r, 60);
  assert.equal((64 - r) % 2, 0, 'шаг ровно по 2 px');
  assert.ok(4 * (r + 42) + 3 * 6 <= 430, 'подобранный размер действительно влезает');
  assert.ok(4 * (r + 2 + 42) + 3 * 6 > 430, 'на два пикселя больше уже не влезало');
});

test('ringFit: ниже 54 не опускаемся никогда', () => {
  assert.equal(Engine.ringFit({ gridW: 374, gapX: GAP, rows: 4, label: 42, gap: 6, avail: 100 }),
    Engine.RING_MIN);
  assert.equal(Engine.ringFit({ gridW: 374, gapX: GAP, rows: 4, label: 42, gap: 6, avail: 0 }),
    Engine.RING_MIN);
});

test('ringFit: узкая сетка не даёт кольцу вырасти', () => {
  assert.equal(Engine.ringFit({ gridW: 324, gapX: GAP, rows: 4, label: 42, gap: 6, avail: 900 }), 56);
});

test('ringRows: сколько рядов помещается', () => {
  // ряд 54 + 42 + 6 = 102
  assert.equal(Engine.ringRows({ ring: 54, label: 42, gap: 6, avail: 402, max: 4 }), 4);
  assert.equal(Engine.ringRows({ ring: 54, label: 42, gap: 6, avail: 401, max: 4 }), 3);
  assert.equal(Engine.ringRows({ ring: 54, label: 42, gap: 6, avail: 5000, max: 4 }), 4, 'больше цели не рисуем');
  assert.equal(Engine.ringRows({ ring: 54, label: 42, gap: 6, avail: 0, max: 4 }), 1, 'меньше ряда не бывает');
});

test('раскладка телефона Алексея: четыре ряда на 360×760 и на 412×840', () => {
  // label и avail сняты с живой раскладки в обеих темах (см. QA-прогон st.js)
  const cases = [
    { name: '360×760', gridW: 324, avail: 404 },
    { name: '412×840', gridW: 374, avail: 470 }
  ];
  cases.forEach(c => {
    const r = Engine.ringFit({ gridW: c.gridW, gapX: GAP, rows: 4, label: 42, gap: 6, avail: c.avail });
    assert.ok(r >= Engine.RING_MIN && r <= Engine.RING_MAX, c.name + ': кольцо вне границ ' + r);
    assert.equal(Engine.ringRows({ ring: r, label: 42, gap: 6, avail: c.avail, max: 4 }), 4,
      c.name + ': четыре ряда не влезли при кольце ' + r);
  });
});
