/* glow-105.test.js - 1.0.5: подсветка экрана (решение Алексея 17.10, вид - Рабочий стол/
   Хомяк-подсветка-вид.png). Мягкое свечение от краёв к центру: красное - ОДИН раз, когда расход
   переводит категорию через лимит в текущем месяце; зелёное - запись дохода. Выключатель
   «Подсветка экрана» в «Звук и подсказки» (S.ui.glow, по умолчанию вкл, переживает копию
   данных). prefers-reduced-motion: reduce - не показываем.
   Здесь - чистое решение «когда» (www/glow.js) и заслоны по исходникам; поведение на настоящем
   экране (запись через экран суммы, класс оверлея, тумблер) - www/selftest.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');
const Glow = require('../www/glow.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('pick: красная - каждая новая трата сверх лимита в текущем месяце (Алексей 17.10)', () => {
  assert.equal(Glow.pick('exp', 'warn', 'over', true), 'over');
  assert.equal(Glow.pick('exp', 'ok', 'over', true), 'over');
  assert.equal(Glow.pick('exp', 'none', 'over', true), 'over', 'первая же трата сверх лимита');
  assert.equal(Glow.pick('exp', 'over', 'over', true), 'over', 'следующие траты сверх лимита - тоже красная');
  assert.equal(Glow.pick('exp', undefined, 'over', true), 'over', 'новая трата, уровень «до» неизвестен');
  assert.equal(Glow.pick('exp', 'over', 'over', true, true), null, 'правка в уже перерасходной категории (дата, заметка) - не мигает');
  assert.equal(Glow.pick('exp', 'over', 'ok', true, true), null, 'правка вернула в лимит');
  assert.equal(Glow.pick('exp', 'ok', 'warn', true), null, 'впритык (ровно лимит) - не перерасход');
  assert.equal(Glow.pick('exp', 'none', 'none', true), null, 'категория без лимита');
  assert.equal(Glow.pick('exp', 'warn', 'over', false), null, 'запись задним числом в прошлый месяц');
});

test('pick: зелёная - запись дохода; переводы и долги - без подсветки', () => {
  assert.equal(Glow.pick('inc', 'none', 'inc', true), 'inc');
  assert.equal(Glow.pick('inc', null, null, false), 'inc', 'доход любой датой');
  assert.equal(Glow.pick('inc', null, null, true, true), null, 'правка дохода - не новая запись');
  assert.equal(Glow.pick('exp', 'warn', 'over', true, true), 'over', 'правка суммы увела за лимит');
  ['transfer', 'debtpay', 'debttake', 'debt', '', null].forEach(k =>
    assert.equal(Glow.pick(k, 'warn', 'over', true), null, String(k)));
});

test('allowed: выключатель и «меньше движения»', () => {
  assert.equal(Glow.allowed({ glow: true }, false), true);
  assert.equal(Glow.allowed({}, false), true, 'по умолчанию (поля нет) - вкл');
  assert.equal(Glow.allowed({ glow: false }, false), false);
  assert.equal(Glow.allowed({ glow: true }, true), false, 'prefers-reduced-motion: reduce');
  assert.equal(Glow.allowed(null, false), true);
});

test('S.ui.glow: по умолчанию вкл, переживает копию данных и старое состояние', () => {
  assert.equal(Engine.defaultState().ui.glow, true);
  assert.equal(Engine.migrate({ ui: { glow: false } }).ui.glow, false, 'выключенная подсветка включилась после восстановления');
  assert.equal(Engine.migrate({ ui: {} }).ui.glow, true, 'старое состояние без поля');
  assert.equal(Engine.migrate({ ui: { glow: 'да' } }).ui.glow, true);
  const S = Engine.defaultState(); S.ui.glow = false;
  assert.equal(Engine.migrate(JSON.parse(JSON.stringify(S))).ui.glow, false, 'круг через JSON (файл копии)');
});

test('оверлей: один элемент, не мешает касаниям, ниже замка, гаснет при «меньше движения»', () => {
  const html = rd('www/index.html');
  assert.equal((html.match(/id="glow"/g) || []).length, 1);
  assert.match(html, /<div id="glow" aria-hidden="true"><\/div>/);
  assert.ok(html.indexOf('<script src="glow.js"></script>') > 0 &&
    html.indexOf('<script src="glow.js"></script>') < html.indexOf('<script src="ui.js"></script>'), 'glow.js грузится не до ui.js');
  const css = rd('www/style.css');
  const a = css.indexOf('#glow {'), b = css.indexOf('}', a);
  assert.ok(a > 0, 'нет правила #glow');
  const r = css.slice(a, b);
  assert.match(r, /pointer-events: none/);
  assert.match(r, /position: fixed; inset: 0/);
  const z = +(/z-index: (\d+)/.exec(r) || [])[1];
  assert.ok(z > 64 && z < 999, 'z-index ' + z + ': должен быть над окнами (64) и под приветствием (999) и замком (1000)');
  assert.match(r, /opacity: 0/);
  assert.match(css, /#glow\[data-glow="over"\] \{ --glow: 240, 90, 80; \}/);
  assert.match(css, /#glow\[data-glow="inc"\] \{ --glow: 62, 210, 140; \}/);
  assert.match(css, /rgba\(var\(--glow\), \.75\)/, 'пик 0,75');
  assert.match(css, /18vw/, 'край ~18% ширины');
  assert.match(css, /#glow\.on \{ animation: glowPulse \.6s ease-in-out 1; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*#glow \{ display: none; \}/);
  assert.ok(!/filter:\s*blur/.test(r), 'тяжёлый фильтр на оверлее');
});

test('ui.js: строка «Подсветка экрана», уровень ДО записи, то же событие, что звук', () => {
  const ui = rd('www/ui.js');
  assert.match(ui, /\{ id: 'snGlow', key: 'glow', t: 'Подсветка экрана'/);
  assert.match(ui, /PREF_TOGGLE = \{ snSound: toggleSound, snHaptic: toggleHaptic, snHints: toggleHints, snGlow: toggleGlow \}/);
  const a = ui.indexOf('function amSave()'), b = ui.indexOf('\n}\n', a);
  const s = ui.slice(a, b);
  const pre = s.indexOf('var before = txLevel(op.kind, op.catId, mo);');
  assert.ok(pre > 0 && pre < s.indexOf('Engine.addTx('), 'уровень категории не снят до записи');
  assert.match(s, /soundTx\(op\.kind, op\.catId, mo, before\);/);
  const sh = rd('www/sheet.js');
  const e = sh.indexOf('var before = UI.txLevel(');
  assert.ok(e > 0 && e < sh.indexOf('Engine.updateTx(UI.S, id, patch);'), 'правка: уровень не снят до правки');
  assert.match(sh, /UI\.soundTx\(t\.kind, patch\.catId \|\| t\.catId, Engine\.ym\(dt\), before, true\);/);
});
