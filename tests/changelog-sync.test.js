/* Т4: верхняя запись CHANGELOG рассинхронилась (0.4.6 из легаси-«Хомяка» над версией
   0.1.x). topNotes() кладёт верхний раздел в «что нового» канала - он обязан соответствовать
   текущей версии. Проверяем: верхний раздел = package.json version, из линии 0.1.x,
   заметки непусты и не тянут легаси-0.4.6. Историю 0.2.0-0.4.6 не трогаем. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../build-lib.js');
const pkg = require('../package.json');

const CHANGELOG = path.join(__dirname, '..', 'CHANGELOG.md');

test('верхняя запись CHANGELOG соответствует текущей версии (линия 0.1.x)', () => {
  const txt = fs.readFileSync(CHANGELOG, 'utf8');
  // «## X (в работе)» - копилка следующей версии (номер ещё не поднят): её пропускаем
  const head = txt.match(/^##\s+(?!.*\(в работе\)\s*$)(.*)$/m);
  assert.ok(head, 'в CHANGELOG нет ни одного раздела ##');
  const firstVer = head[1].trim();
  // линия RuStore-«Хомяка»: 0.1.x (до стора) и 1.x+ (стор); легаси 0.2-0.4.x сверху не бывает
  assert.ok(/^(0\.1\.|[1-9]\d*\.)/.test(firstVer), 'верхний раздел не из линии 0.1.x/1.x, а «' + firstVer + '»');
  assert.equal(firstVer, pkg.version, 'верхняя запись «' + firstVer + '» разошлась с package.json «' + pkg.version + '»');
});

test('topNotes отдаёт заметки текущего релиза, а не легаси-0.4.6', () => {
  const notes = L.topNotes(CHANGELOG);
  assert.ok(notes.length > 0, 'topNotes пуст');
  assert.equal(notes.indexOf('0.4.6'), -1, 'topNotes тянет легаси-раздел 0.4.6');
  // заметки = тело верхнего раздела (правки этого релиза), без чужих разделов;
  // проверка не привязана к словам конкретного релиза (раньше - «кнопк|операци» от 0.1.7)
  assert.equal(/^##\s/m.test(notes), false, 'topNotes захватил следующий раздел');
  assert.ok(/^- \S/m.test(notes), 'в заметках нет ни одного пункта «- ...»');
  // человеческая пунктуация: без длинного тире в видимых заметках
  assert.equal(notes.indexOf('—'), -1, 'в заметках длинное тире «—»');
});

// Независимый пересчёт «верхнего раздела»: построчно, без регулярок topNotes - всё между
// первой и второй строкой, начинающейся с «## ». Ловит регрессии нарезки в topNotes
// (захват заголовка, потеря первой/последней строки, выход за второй раздел).
test('topNotes = текст между первым и вторым заголовком «##» (пересчёт построчно)', () => {
  const lines = fs.readFileSync(CHANGELOG, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const heads = [];
  lines.forEach((l, i) => { if (l.slice(0, 3) === '## ' && !/\(в работе\)\s*$/.test(l)) heads.push(i); });
  assert.ok(heads.length >= 2, 'в CHANGELOG меньше двух разделов «## » - сверять нарезку не на чем');
  const expected = lines.slice(heads[0] + 1, heads[1]).join('\n').trim();
  const got = L.topNotes(CHANGELOG).replace(/\r\n/g, '\n');
  assert.ok(expected.length > 0, 'верхний раздел пуст');
  assert.equal(got, expected);
});

// 1.0.4: раздел «(в работе)» стоит только над текущей версией и только со СЛЕДУЮЩИМ номером
// (иначе пометку забыли снять на выпуске, и «что нового» показало бы старый раздел).
test('CHANGELOG: раздел «(в работе)» - не выше одного и с номером новее package.json', () => {
  const txt = fs.readFileSync(CHANGELOG, 'utf8');
  const wip = txt.match(/^##\s+(\S+)\s+\(в работе\)\s*$/gm) || [];
  assert.ok(wip.length <= 1, 'разделов «(в работе)» больше одного');
  if (!wip.length) return;
  const v = /^##\s+(\S+)/.exec(wip[0])[1];
  const n = (x) => x.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
  assert.ok(n(v) > n(pkg.version), 'раздел «' + v + ' (в работе)» не новее версии ' + pkg.version + ' - снимите пометку');
  assert.ok(txt.indexOf(wip[0]) < txt.search(/^##\s+(?!.*\(в работе\))/m), 'раздел «(в работе)» не сверху');
  assert.equal(L.topNotes(CHANGELOG).indexOf('(в работе)'), -1);
});
