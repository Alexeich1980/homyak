/* app-name-case.test.js - название приложения в видимых текстах с большой буквы: «Хомяк».
   Замечание Алексея 13.10: «хомяк объясняет экраны» в «Звук и подсказки». Строчная буква
   допустима только про картинку-хомяка в шапке («хомяк сверху слева»). Комментарии не в счёт. */
const test = require('node:test'); const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');

const WWW = path.join(__dirname, '..', 'www');
const FILES = fs.readdirSync(WWW).filter((f) => /\.(js|html)$/.test(f) && f !== 'selftest.js');
const ALLOWED = /хомяк сверху слева/;

// построчно: строка-комментарий (//, /*, *, <!--) пропускается, хвост «// ...» отрезается.
// Многострочные /* */ в коде «Хомяка» пишутся с « *» или отступом - их ловит проверка начала
// строки; глобальная вырезка /* */ ломалась о регулярки со «*/» внутри строк.
function stripComments(src) {
  let inBlock = false;
  return src.split('\n').map((l) => {
    const t = l.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return ''; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('<!--')) return '';
    return l.replace(/(^|[^:'"\\])\/\/ .*$/, '$1');
  }).join('\n');
}

test('название «Хомяк» в видимых текстах - с большой буквы', () => {
  const bad = [];
  for (const f of FILES) {
    const lines = stripComments(fs.readFileSync(path.join(WWW, f), 'utf8')).split('\n');
    lines.forEach((l, i) => {
      if (/(^|[^А-Яа-яЁё])хомяк/.test(l) && !ALLOWED.test(l)) bad.push(f + ':' + (i + 1) + ' ' + l.trim().slice(0, 90));
    });
  }
  assert.deepStrictEqual(bad, [], 'строчное «хомяк» в тексте:\n' + bad.join('\n'));
});
