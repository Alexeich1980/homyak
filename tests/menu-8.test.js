/* menu-8.test.js - 1.0.3, решение Алексея 05.10: меню сокращено до 8 плиток.
   Тема · Обновление · Настроить категории · Настроить кошельки · Звук и подсказки ·
   Копия данных · Защита входа · О приложении. Звук/вибрация/подсказки и сохранить/
   восстановить/напоминание - в подменю (ui.js openPrefs/openCopy).

   Здесь заслоны по исходникам: состав и порядок плиток в index.html, подменю зовут те же
   функции, что раньше стояли на плитках, и ни один видимый текст не ведёт по старому пути
   («меню → «Восстановить из файла»», «Бэкап в файл», «Код на вход», «Напоминать о копии»).
   Поведение на настоящем экране (тумблеры, подписи, aria) - www/selftest.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../build-lib.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ORDER = [
  ['mTheme', 'Тема'], ['mUpdate', 'Обновление'], ['mCats', 'Настроить категории'],
  ['mWallets', 'Настроить кошельки'], ['mPrefs', 'Звук и подсказки'], ['mCopy', 'Копия данных'],
  ['mLock', 'Защита входа'], ['mAbout', 'О приложении']
];

function menuTiles(html) {
  const a = html.indexOf('<div class="menu-list">');
  const b = html.indexOf('</nav>', a);
  assert.ok(a > 0 && b > a, 'в index.html нет .menu-list');
  const list = html.slice(a, b);
  const out = [];
  const re = /<button class="mi [^"]*" id="(m[A-Za-z]+)"[\s\S]*?<span class="mi-t">([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(list))) out.push([m[1], m[2]]);
  return out;
}

test('меню: ровно 8 плиток в порядке Алексея, с теми названиями', () => {
  const tiles = menuTiles(rd('www/index.html'));
  assert.deepEqual(tiles, ORDER);
});

test('меню: старых плиток (звук, вибрация, подсказки, напоминание, бэкап, восстановление) нет нигде', () => {
  const html = rd('www/index.html');
  for (const id of ['mSound', 'mHaptic', 'mHints', 'mRemind', 'mBackup', 'mRestore']) {
    assert.ok(!html.includes('id="' + id), 'в index.html осталась плитка ' + id);
    for (const f of ['ui.js', 'backup.js', 'nudges.js', 'update.js', 'lock.js']) {
      assert.ok(!new RegExp("\\$\\('" + id + "'\\)").test(rd('www/' + f)), f + ' всё ещё ищет #' + id);
    }
  }
  assert.match(html, /id="mCopyInfo">сохранить, восстановить</, 'подпись «Копия данных»');
});

test('подменю: тумблеры звук/вибрация/подсказки и копия зовут те же функции', () => {
  const ui = rd('www/ui.js');
  assert.match(ui, /\$\('mPrefs'\)\.addEventListener\('click', openPrefs\);/);
  assert.match(ui, /\$\('mCopy'\)\.addEventListener\('click', openCopy\);/);
  assert.match(ui, /PREF_TOGGLE = \{ snSound: toggleSound, snHaptic: toggleHaptic, snHints: toggleHints \}/);
  // настройки хранятся там же, где раньше: S.ui.sound / haptics / hints
  assert.match(ui, /\{ id: 'snSound', key: 'sound'/);
  assert.match(ui, /\{ id: 'snHaptic', key: 'haptics'/);
  assert.match(ui, /\{ id: 'snHints', key: 'hints'/);
  assert.match(ui, /setAttribute\('aria-pressed', on \? 'true' : 'false'\)/, 'тумблеры без aria-pressed');
  assert.match(ui, /\$\('cpSave'\)\.addEventListener\('click', function \(\) \{\s*closeDlg\(\); closeMenu\(\);\s*if \(window\.Backup && window\.Backup\.backup\) window\.Backup\.backup\(\);/);
  assert.match(ui, /\$\('cpRestore'\)\.addEventListener\('click', function \(\) \{\s*closeDlg\(\); closeMenu\(\);\s*if \(window\.Backup && window\.Backup\.pickRestore\) window\.Backup\.pickRestore\(\);/);
  assert.match(ui, /window\.Nudges\.toggleRemind\(\)/);
  const bk = rd('www/backup.js');
  assert.match(bk, /function pickRestore\(\) \{\s*var f = \$\('fileRestore'\);\s*f\.value = '';\s*away\(\);\s*f\.click\(\);/);
  assert.match(bk, /pickRestore: pickRestore/);
  const nd = rd('www/nudges.js');
  assert.match(nd, /function toggleRemind\(\) \{\s*var off = !remindOff\(\);\s*setRemindOff\(off\);/);
  assert.match(nd, /toggleRemind: toggleRemind/);
});

test('подменю - окно приложения, без системных alert/confirm, «Закрыть» - переход', () => {
  const ui = rd('www/ui.js');
  const a = ui.indexOf('function openPrefs()'), b = ui.indexOf("$('mCopy').addEventListener", a);
  const block = ui.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(block.replace(/dlg(Alert|Confirm|Prompt)\(/g, '')), 'нативный диалог в подменю');
  assert.equal((block.match(/openDlg\(/g) || []).length, 2);
  assert.equal((block.match(/\{ label: 'Закрыть', cls: 'nav' \}/g) || []).length, 2);
});

// старые пути в ВИДИМЫХ текстах: строки JS ('...') и текст разметки, не комментарии
const OLD_PATHS = [
  /меню → «Восстановить из файла»/,
  /меню и нажми «Восстановить из файла»/,
  /«Бэкап в файл»/,
  /[Бб]экап в файл/,
  /файл бэкапа|другой бэкап/,   // ревью 06.10: пункта «бэкап» в меню нет - «копия данных»
  /Код на вход/,
  /Напоминать о копии/,
  /меню → «Напоминание»/,
  /выключить в меню\./
];
function visibleStrings(src, isHtml) {
  let s = src;
  if (isHtml) {
    s = s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
    return [s];
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  return s.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
}

test('тексты: ни один видимый текст не ведёт по старому пути меню', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'www')).filter((n) => /\.(js|html)$/.test(n) && n !== 'selftest.js')) {
    const strs = visibleStrings(rd('www/' + f), f.endsWith('.html'));
    strs.forEach((str) => OLD_PATHS.forEach((re) => { if (re.test(str)) bad.push(f + ': ' + re + ' в ' + str.slice(0, 90)); }));
  }
  const notes = L.topNotes(path.join(ROOT, 'CHANGELOG.md'));
  OLD_PATHS.forEach((re) => { if (re.test(notes)) bad.push('CHANGELOG 1.0.3: ' + re); });
  assert.deepEqual(bad, []);
  // новый путь там, где ведём к восстановлению
  assert.match(rd('www/ui.js'), /меню → «Копия данных» → «Восстановить из файла»/);
  assert.match(rd('www/lock.js'), /меню → «Копия данных» → «Восстановить из файла»/);
});

test('CHANGELOG 1.0.3: новые места напоминания и короткое меню, на «ты», без длинного тире', () => {
  const notes = L.topNotes(path.join(ROOT, 'CHANGELOG.md'));
  assert.match(notes, /меню → «Копия данных» → «Напоминать раз в месяц»/);
  assert.match(notes, /меню → «Защита входа»/);
  assert.match(notes, /Меню стало короче/);
  assert.match(notes, /«Звук и подсказки»/);
  assert.match(notes, /«Копия данных»/);
  assert.equal(notes.indexOf('—'), -1);
});
