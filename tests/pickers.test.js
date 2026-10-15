'use strict';
/* Заслон регламента RuStore-приложений (этап 2, решение Алексея 14.10.2026): выбор даты,
   времени и значения из списка - только своё окно в стиле приложения (www/picker.js), не
   системные окна Android. В www/ (кроме самопроверки) не должно быть <input type="date|time|
   month|datetime-local|week"> и <select>. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WWW = path.join(__dirname, '..', 'www');
const files = fs.readdirSync(WWW)
  .filter((f) => (/\.js$/.test(f) || f === 'index.html') && f !== 'selftest.js');

const BAD = [
  [/type\s*=\s*\\?["']?(date|time|month|week|datetime-local)\b/i, 'системное поле даты/времени'],
  [/<select[\s>]/i, '<select> - системный список'],
  [/createElement\(\s*['"]select['"]\s*\)/i, "createElement('select')"],
  [/\.type\s*=\s*['"](date|time|month|week|datetime-local)['"]/i, 'поле даты, созданное кодом'],
];

test('в www/ нет системных окон даты, времени и списка', () => {
  assert.ok(files.length > 10, 'не нашли файлов www');
  const hits = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(WWW, f), 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      for (const [re, what] of BAD) if (re.test(ln)) hits.push(f + ':' + (i + 1) + ' ' + what + ': ' + ln.trim().slice(0, 120));
    });
  }
  assert.deepStrictEqual(hits, []);
});

test('своё окно выбора подключено и стоит после ui.js', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const ui = html.indexOf('<script src="ui.js">'), pk = html.indexOf('<script src="picker.js">');
  assert.ok(pk > ui && ui > 0, 'picker.js не подключён после ui.js');
  const src = fs.readFileSync(path.join(WWW, 'picker.js'), 'utf8');
  assert.match(src, /'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'/, 'неделя не с понедельника');
});
