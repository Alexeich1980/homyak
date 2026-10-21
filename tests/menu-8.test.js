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

function notes103() {
  // заметки 1.0.3 - свой раздел CHANGELOG, а не верхний (с выходом 1.0.4 верхний - 1.0.4)
  const t = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const a = t.indexOf('## 1.0.3\n'); const b = t.indexOf('\n## ', a + 1);
  return t.slice(a, b < 0 ? undefined : b).split('\n').slice(1).join('\n').trim();
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
  assert.match(html, /id="mCopyInfo">копия, таблица Excel</, 'подпись «Копия данных»');
});

test('подменю: тумблеры звук/вибрация/подсказки и копия зовут те же функции', () => {
  const ui = rd('www/ui.js');
  assert.match(ui, /\$\('mPrefs'\)\.addEventListener\('click', openPrefs\);/);
  assert.match(ui, /\$\('mCopy'\)\.addEventListener\('click', openCopy\);/);
  assert.match(ui, /PREF_TOGGLE = \{ snSound: toggleSound, snHaptic: toggleHaptic, snHints: toggleHints, snGlow: toggleGlow \}/);   // 1.0.5: + подсветка
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
  // openPrefs, openTable («Таблица Excel», 11.10), openCopy
  assert.equal((block.match(/openDlg\(/g) || []).length, 3);
  assert.equal((block.match(/\{ label: 'Закрыть', cls: 'nav' \}/g) || []).length, 3);
});

// 11.10, решение Алексея: «Выгрузить в Excel» и «Загрузить из таблицы» - одна строка
// «Таблица Excel» в «Копии данных», её окно возвращает в «Копию данных».
test('«Копия данных»: выгрузка и загрузка - одна строка «Таблица Excel» со своим окном', () => {
  const ui = rd('www/ui.js');
  const a = ui.indexOf('function openCopy()'), b = ui.indexOf("$('mPrefs').addEventListener", a);
  const copy = ui.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.match(copy, /'<div class="set-list set-gap">' \+ tableRowHtml\(\) \+ setRowHtml\('cpRemind'/, 'в «Копии данных» не строка «Таблица Excel» + напоминание');
  assert.ok(!/excelRowHtml|importRowHtml|undoImportRowHtml|cpExcel|cpImport|cpUndoImport/.test(copy), 'в «Копии данных» остались отдельные строки выгрузки/загрузки/отмены');
  assert.match(copy, /\$\('cpTable'\)\.addEventListener\('click', openTable\);/);
  // замок у строки - только если в бесплатной версии нечего отменять (отмена импорта - для всех)
  assert.match(ui, /actRowHtml\('cpTable', 'c-teal', EXCEL_IC, 'Таблица Excel', 'выгрузить или загрузить', !hasFull\(\) && !lastImport\(\)\)/);
  const t = ui.slice(ui.indexOf('function openTable()'), a);
  assert.match(t, /if \(!full && !lastImport\(\)\) \{ if \(window\.UI\.paywall\) window\.UI\.paywall\(openCopy\); return; \}/, 'окно таблицы без замка «Полного доступа»');
  assert.equal((t.match(/if \(!hasFull\(\)\) \{ dlgOnClose = null; if \(window\.UI\.paywall\) window\.UI\.paywall\(openTable\); return; \}/g) || []).length, 2, 'в бесплатной версии «Выгрузить»/«Загрузить» не закрыты замком');
  assert.ok(!/paywall/.test(t.slice(t.indexOf("var un = $('tbUndoImport')"))), 'отмена импорта закрыта замком');
  assert.match(t, /title: 'Таблица Excel'/);
  assert.match(t, /onClose: openCopy,/, '«назад»/фон не возвращают в «Копию данных»');
  for (const id of ['tbExport', 'tbImport', 'tbUndoImport']) assert.ok(t.includes("'" + id + "'"), 'в окне таблицы нет #' + id);
  assert.match(t, /window\.Backup\.exportXlsx\(\)/);
  assert.match(t, /window\.ImportUI\.pick\(\)/);
  assert.match(t, /window\.ImportUI\.askUndo\(\)/);
  // раздел 1.0.4 (пока «в работе» - topNotes его пропускает): пути через «Таблицу Excel»
  const cl = rd('CHANGELOG.md'), n0 = cl.indexOf('## 1.0.4'), notes = cl.slice(n0, cl.indexOf('\n## ', n0 + 5));
  assert.ok(n0 > 0, 'в CHANGELOG нет раздела 1.0.4');
  // текст 1.0.4 согласован владельцем 13.10: путь до окна «Таблица Excel», в нём выгрузка и загрузка
  assert.match(notes, /меню → «Копия данных» → «Таблица Excel»\./);
  assert.match(notes, /Выгрузка операций/);
  assert.match(notes, /Загрузка из таблиц других приложений/);
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
  const notes = notes103();
  assert.match(notes, /меню → «Копия данных» → «Напоминать раз в месяц»/);
  assert.match(notes, /меню → «Защита входа»/);
  assert.match(notes, /Меню стало короче/);
  assert.match(notes, /«Звук и подсказки»/);
  assert.match(notes, /«Копия данных»/);
  assert.equal(notes.indexOf('—'), -1);
});
