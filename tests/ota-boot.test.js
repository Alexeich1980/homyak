/* Заслон от кирпича: логика boot.js. Настоящий откат трогает WebView телефона, а вот
   решение «откатываться или нет» — чистая функция от трёх ключей localStorage,
   и проверяется она здесь, без браузера. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Boot = require('../www/boot.js');
const Update = require('../www/update.js');

// подставной localStorage: обычный объект
function store(obj) {
  const bag = Object.assign({}, obj);
  return {
    bag,
    get: (k) => (Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null)
  };
}

const T = Boot.K_TRY, OK = Boot.K_OK;

test('меток нет — обычный запуск, ничего не делаем', () => {
  const s = store({});
  assert.equal(Boot.decide(s.get, '0.3.0').action, 'none');
});

test('первый запуск новой сборки — взводим счётчик, не откатываемся', () => {
  const s = store({ [T]: JSON.stringify({ version: '0.3.1', ts: 111, boots: 0 }) });
  const d = Boot.decide(s.get, '0.3.1');
  assert.equal(d.action, 'arm');
  assert.deepEqual(d.mark, { version: '0.3.1', ts: 111, boots: 1, sha256: '' });
});

test('второй запуск без подтверждения — сборка не заводится, откат', () => {
  const s = store({ [T]: JSON.stringify({ version: '0.3.1', ts: 111, boots: 1 }) });
  const d = Boot.decide(s.get, '0.3.1');
  assert.equal(d.action, 'revert');
  assert.equal(d.version, '0.3.1');
});

test('сборка уже подтвердила, что живая — метка снимается, откат не нужен', () => {
  const s = store({
    [T]: JSON.stringify({ version: '0.3.1', boots: 1 }),
    [OK]: '0.3.1'
  });
  assert.equal(Boot.decide(s.get, '0.3.1').action, 'clear');
});

test('метка про другую сборку (уже откатились) — просто убираем', () => {
  const s = store({ [T]: JSON.stringify({ version: '0.3.1', boots: 1 }) });
  assert.equal(Boot.decide(s.get, '0.3.0').action, 'clear');
});

test('подтверждение от ДРУГОЙ версии не спасает битую сборку', () => {
  const s = store({
    [T]: JSON.stringify({ version: '0.3.1', boots: 1 }),
    [OK]: '0.3.0'
  });
  assert.equal(Boot.decide(s.get, '0.3.1').action, 'revert');
});

test('испорченная метка — убираем, а не падаем', () => {
  ['не json', '{}', '[]', 'null', '{"boots":5}'].forEach(raw => {
    const s = store({ [T]: raw });
    assert.equal(Boot.decide(s.get, '0.3.1').action, 'clear', raw);
  });
});

test('метка без счётчика считается первым запуском', () => {
  const s = store({ [T]: JSON.stringify({ version: '0.3.1' }) });
  const d = Boot.decide(s.get, '0.3.1');
  assert.equal(d.action, 'arm');
  assert.equal(d.mark.boots, 1);
});

test('localStorage недоступен (приватный режим) — не мешаем запуску', () => {
  const boom = () => { throw new Error('нет доступа'); };
  assert.equal(Boot.decide(boom, '0.3.1').action, 'none');
});

test('откат случается ровно один раз: после него метки нет', () => {
  // так это работает в run(): решили откатиться → метку сняли → второй раз решать не о чем
  const s = store({ [T]: JSON.stringify({ version: '0.3.1', boots: 1 }) });
  assert.equal(Boot.decide(s.get, '0.3.1').action, 'revert');
  delete s.bag[T];
  assert.equal(Boot.decide(s.get, '0.3.1').action, 'none');
});

test('полный цикл: применили → первый запуск → подтвердили', () => {
  const s = store({});
  // update.js перед перезапуском
  s.bag[T] = JSON.stringify({ version: '0.3.1', ts: 1, boots: 0 });
  // первый запуск новой сборки
  let d = Boot.decide(s.get, '0.3.1');
  assert.equal(d.action, 'arm');
  s.bag[T] = JSON.stringify(d.mark);
  // приложение нарисовалось: update.js ставит печать и снимает метку
  s.bag[OK] = '0.3.1';
  delete s.bag[T];
  // следующий запуск — обычный
  assert.equal(Boot.decide(s.get, '0.3.1').action, 'none');
});

test('полный цикл: применили → сборка падает до appReady → откат', () => {
  const s = store({});
  s.bag[T] = JSON.stringify({ version: '0.3.1', ts: 1, boots: 0 });
  let d = Boot.decide(s.get, '0.3.1');       // первый запуск
  assert.equal(d.action, 'arm');
  s.bag[T] = JSON.stringify(d.mark);
  // печати нет: приложение упало до appReady, хозяин перезапускает
  assert.equal(Boot.decide(s.get, '0.3.1').action, 'revert');
});

// ---------- staleWww: устаревшая OTA-сборка после переустановки APK ----------
// staleWww(loadedVer, shellVer, onAssetsBool) → true, только если НЕ на ассетах,
// оболочка известна, и загруженная версия НЕ НОВЕЕ оболочки (меньше или равна:
// OTA-папка той же версии, что APK, всегда лишняя - тест и релиз одного номера
// различаются только вшитыми флагами, встроенные ассеты не хуже).
test('staleWww: загруженная старше оболочки и не на ассетах — сбрасываем', () => {
  assert.equal(Update.staleWww('0.3.0', '0.3.1', false), true);
});

test('staleWww: на ассетах — никогда не сбрасываем', () => {
  assert.equal(Update.staleWww('0.3.0', '0.3.1', true), false);
});

test('staleWww: версия оболочки неизвестна (пусто/null) — не сбрасываем', () => {
  assert.equal(Update.staleWww('0.3.0', '', false), false);
  assert.equal(Update.staleWww('0.3.0', null, false), false);
});

test('staleWww: загруженная новее оболочки (легитимная OTA) — не сбрасываем', () => {
  assert.equal(Update.staleWww('0.3.2', '0.3.1', false), false);
});

test('staleWww: версии равны и не на ассетах — OTA-папка лишняя, сбрасываем', () => {
  // та же версия, что оболочка: папка могла остаться от сборки другого типа
  // (тест↔релиз 0.1.6), встроенные ассеты не хуже — сбрасываем на них
  assert.equal(Update.staleWww('0.3.1', '0.3.1', false), true);
  // но на ассетах — по-прежнему ничего не делаем (нет цикла перезагрузок)
  assert.equal(Update.staleWww('0.3.1', '0.3.1', true), false);
});

test('staleWww: onAssets не строго false (undefined) — не сбрасываем', () => {
  assert.equal(Update.staleWww('0.3.0', '0.3.1', undefined), false);
});
