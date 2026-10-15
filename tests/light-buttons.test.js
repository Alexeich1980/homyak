/* Светлая тема: второстепенные кнопки (.btn.ghost, .chip, «назад к месяцу») на белом листе
   должны быть видны как кнопки - грань не прозрачная и заметная, у .btn.ghost есть тень.
   Причина: окно «Что добавить» (Алексей 14.10) - серые плашки без грани сливались с листом. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'style.css'), 'utf8');

function lightBlock() {
  const i = css.indexOf('body[data-theme="light"] {');
  assert.ok(i >= 0, 'есть блок светлой темы');
  return css.slice(i, css.indexOf('\n}', i));
}

test('светлая тема: грань второстепенных кнопок видна (альфа >= .15)', () => {
  const m = lightBlock().match(/--btn-ghost-bd:\s*([^;]+);/);
  assert.ok(m, '--btn-ghost-bd задан в светлой теме');
  const v = m[1].trim();
  assert.notEqual(v, 'transparent', 'грань не прозрачная');
  const a = v.match(/rgba\([^)]*,\s*([\d.]+)\)/);
  assert.ok(a, 'грань rgba: ' + v);
  assert.ok(parseFloat(a[1]) >= 0.15, 'альфа грани ' + a[1] + ' < .15 - кнопка сольётся с белым');
});

test('светлая тема: у .btn.ghost есть тень', () => {
  assert.match(css, /body\[data-theme="light"\] \.btn\.ghost \{[^}]*box-shadow:\s*var\(--tile-shadow\)/);
});
