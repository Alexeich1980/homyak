/* sound.js — звуки на события. Проверяем ровно то, что можно проверить без браузера:
   белый список имён и обещание «никогда не бросать». Сами файлы кладут отдельно,
   их может не быть — и это нормальный режим работы. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Sound = require('../www/sound.js');

test('белый список: ровно четыре денежных события и ничего сверх', () => {
  assert.deepEqual(Sound.NAMES, ['expense', 'income', 'transfer', 'over']);
  Sound.NAMES.forEach(n => assert.equal(Sound.isName(n), true, 'не признал своё имя: ' + n));
});

test('чужое имя не признаётся — в том числе похожее на путь к файлу', () => {
  ['', 'Expense', 'expense.mp3', 'sounds/expense', '../../etc/passwd', 'ping', null, undefined, 0, {}]
    .forEach(n => assert.equal(Sound.isName(n), false, 'признал чужое: ' + JSON.stringify(n)));
});

test('play() не бросает и без браузера честно отвечает false', () => {
  // в node нет ни Audio, ни window: звука быть не может, но и падения тоже
  assert.equal(Sound.play('expense'), false);
  assert.equal(Sound.play('нетакого'), false);
  assert.equal(Sound.play(), false);
  assert.equal(Sound.play({ toString() { throw new Error('злой аргумент'); } }), false);
});

test('расширения и папка заданы одним местом', () => {
  assert.deepEqual(Sound.EXT, ['mp3', 'ogg'], 'mp3 основной, ogg запасной');
  assert.equal(Sound.DIR, 'sounds/');
});
