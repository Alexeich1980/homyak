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
  const head = txt.match(/^##\s+(.*)$/m);
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
