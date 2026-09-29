/* Удаление кошелька: владелец убрал прежний трёхкнопочный выбор. Теперь ровно две
   кнопки «Удалить»/«Отмена», а «Скрыть» живёт только в самой форме кошелька.
   Тут сторожим исходники: если старый третий выбор («Удалить всё равно», варианты
   «Убрать только иконку»/«Стереть все операции») где-то воскреснет, тест упадёт. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WWW = path.join(__dirname, '..', 'www');
const DEAD = ['Удалить всё равно', 'Убрать только иконку', 'Стереть все операции'];

function jsFiles() {
  return fs.readdirSync(WWW).filter(f => f.endsWith('.js')).map(f => path.join(WWW, f));
}

test('в исходниках нет строк убранного трёхкнопочного выбора удаления', () => {
  jsFiles().forEach(file => {
    const src = fs.readFileSync(file, 'utf8');
    DEAD.forEach(str => {
      assert.equal(src.indexOf(str), -1,
        'в ' + path.basename(file) + ' осталась мёртвая строка: «' + str + '»');
    });
  });
});

test('поток удаления кошелька собран как confirm на две кнопки', () => {
  const src = fs.readFileSync(path.join(WWW, 'edit.js'), 'utf8');
  const at = src.indexOf('function deleteWalletFlow');
  assert.ok(at > 0, 'нет функции deleteWalletFlow');
  const body = src.slice(at, at + 900);
  assert.ok(body.indexOf('UI.dlgConfirm(') >= 0, 'удаление больше не через dlgConfirm');
  assert.ok(body.indexOf("okLabel: 'Удалить'") >= 0, 'нет кнопки «Удалить»');
  assert.ok(body.indexOf('Удалить кошелёк «') >= 0, 'нет короткого вопроса для пустого кошелька');
  assert.ok(body.indexOf('Хочешь сохранить историю - нажми «Скрыть»') >= 0,
    'нет напоминания про «Скрыть» в окне удаления с историей');
  assert.ok(body.indexOf('сотрутся насовсем') >= 0, 'окно не говорит, что операции сотрутся насовсем');
  // автономная модель: ни «Бюджета», ни «синка» в тексте быть не должно
  assert.equal(body.indexOf('Бюджет'), -1, 'в тексте удаления остался «Бюджет»');
  assert.equal(body.indexOf('синк'), -1, 'в тексте удаления остался «синк»');
  // третьей кнопки в этом окне быть не должно
  assert.equal(body.indexOf('UI.openDlg('), -1, 'удаление снова открывает многокнопочное окно');
});
