'use strict';
// pruneOldVersions (build-lib.js): сборка хранит в out/ только последние 3 версии
// APK/zip. Проверяем на временной папке: порядок по semver (0.1.10 новее 0.1.9),
// алиасы и манифесты не трогаются, опубликованное на канале (published.json, его пишет
// publish-update.py после заливки) живёт, даже если оно старше последних трёх;
// посторонние файлы - мимо.
//
// Реалистичная папка: update.json / last-apk.json сборка ВСЕГДА переписывает на себя до
// уборки, поэтому в тестах они указывают на ТЕКУЩУЮ сборку, а не на канал.
//
// Мутация (проверено вручную): убрать 'published.json' из OUT_MANIFESTS в build-lib.js -
// краснеет «опубликованная 1.0.1 живёт»; вернуть - зелёный.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../build-lib.js');

const APK = (v) => 'homyak-' + v + '.apk';
const ZIP = (v) => 'www-' + v + '.zip';
const CH = 'https://dorokhin-finance.ru/homyak-store/';

function tmpDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
  Object.keys(files).forEach((n) => fs.writeFileSync(path.join(dir, n), files[n]));
  return dir;
}
const ls = (dir) => fs.readdirSync(dir).sort();
const has = (dir, n) => fs.existsSync(path.join(dir, n));

// манифест в формате build-ota.js / build-apk.js (update.json) для версии v
const manifest = (v) => ({
  build: 'store', version: v, apkUrl: CH + APK(v), size: 1,
  web: { version: v, url: CH + ZIP(v), sha256: 'a', size: 1, minShell: '0.1.0' }
});

// out/store после серии сборок: по APK+zip на каждую версию, манифесты - на `current`,
// published.json (если задан) - копия update.json той версии, что залита на канал.
function outStore(versions, current, published) {
  const files = { 'Homyak-store.apk': 'alias', 'Homyak.apk': 'alias' };
  versions.forEach((v) => { files[APK(v)] = 'x'; files[ZIP(v)] = 'x'; });
  files['update.json'] = JSON.stringify(manifest(current));
  files['last-apk.json'] = JSON.stringify({ version: current, apkName: APK(current), apkUrl: CH + APK(current) });
  if (published) files['published.json'] = JSON.stringify(manifest(published));
  return tmpDir(files);
}

test('pruneOldVersions: оставляет 3 новейших по semver, 0.1.10 новее 0.1.9', () => {
  const dir = tmpDir({
    'app-0.1.8.apk': 'x', 'app-0.1.9.apk': 'x', 'app-0.1.10.apk': 'x', 'app-0.2.0.apk': 'x', 'app-0.1.2.apk': 'x'
  });
  try {
    const gone = L.pruneOldVersions(dir, 3);
    assert.deepEqual(gone, ['app-0.1.2.apk', 'app-0.1.8.apk']);
    assert.deepEqual(ls(dir), ['app-0.1.10.apk', 'app-0.1.9.apk', 'app-0.2.0.apk']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pruneOldVersions: 1.10.0 и 10.0.0 - числами, не строкой; группы apk и zip раздельно', () => {
  const dir = tmpDir({
    'app-9.0.0.apk': 'x', 'app-10.0.0.apk': 'x', 'app-1.10.0.apk': 'x', 'app-1.9.0.apk': 'x',
    'www-1.0.0.zip': 'x', 'www-1.0.1.zip': 'x'
  });
  try {
    assert.deepEqual(L.pruneOldVersions(dir), ['app-1.9.0.apk']);   // keep по умолчанию = 3
    assert.ok(has(dir, 'www-1.0.0.zip'), 'zip-группа своя, из 2 файлов ничего не удаляется');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Сценарий из ревью: 1.0.1 залит на канал, потом собраны 1.0.2..1.0.4 без публикации.
// Манифесты сборки уже смотрят на 1.0.4; 1.0.1 ниже среза «последние 3».
test('pruneOldVersions: опубликованная 1.0.1 живёт после трёх неопубликованных сборок (published.json)', () => {
  const dir = outStore(['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4'], '1.0.4', '1.0.1');
  try {
    const gone = L.pruneOldVersions(dir, 3);
    assert.deepEqual(gone, [APK('1.0.0'), ZIP('1.0.0')]);
    [APK('1.0.1'), ZIP('1.0.1'), 'published.json', 'update.json', 'last-apk.json',
      'Homyak-store.apk', 'Homyak.apk'].forEach((n) => assert.ok(has(dir, n), n + ' должен остаться'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Контроль к тесту выше: та же папка без published.json - 1.0.1 удаляется. Значит, живёт
// она именно благодаря published.json, а манифесты сборки её не защищают.
test('pruneOldVersions: без published.json та же 1.0.1 удаляется - защита держится только на нём', () => {
  const dir = outStore(['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4'], '1.0.4', null);
  try {
    const gone = L.pruneOldVersions(dir, 3);
    assert.deepEqual(gone, [APK('1.0.0'), APK('1.0.1'), ZIP('1.0.0'), ZIP('1.0.1')]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Текущая сборка - самая младшая версия в папке (пересобрали старую ветку): её файлы
// ниже среза, но на них смотрят update.json/last-apk.json - не удаляются.
test('pruneOldVersions: текущая сборка - младшая версия в папке - не удаляется', () => {
  const dir = outStore(['0.9.0', '1.0.2', '1.0.3', '1.0.4'], '0.9.0', null);
  try {
    assert.deepEqual(L.pruneOldVersions(dir, 3), []);
    assert.ok(has(dir, APK('0.9.0')) && has(dir, ZIP('0.9.0')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pruneOldVersions: алиасы и манифесты без версии не трогаются, URL с ?query разбирается', () => {
  const dir = tmpDir({
    'App.apk': 'alias', 'App-store.apk': 'alias', 'Хомяк.apk': 'alias',
    'app-0.1.0.apk': 'x', 'app-0.1.1.apk': 'x', 'app-0.1.2.apk': 'x', 'app-0.1.3.apk': 'x', 'app-0.1.4.apk': 'x',
    'www-0.1.0.zip': 'x', 'www-0.1.1.zip': 'x', 'www-0.1.2.zip': 'x', 'www-0.1.3.zip': 'x', 'www-0.1.4.zip': 'x',
    'published.json': JSON.stringify({ web: { url: 'https://example.ru/ch/www-0.1.1.zip?v=1#x' } })
  });
  try {
    assert.deepEqual(L.pruneOldVersions(dir, 3), ['app-0.1.0.apk', 'app-0.1.1.apk', 'www-0.1.0.zip']);
    ['App.apk', 'App-store.apk', 'Хомяк.apk', 'published.json', 'www-0.1.1.zip']
      .forEach((n) => assert.ok(has(dir, n), n));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pruneOldVersions: посторонние файлы и папки мимо; хвост «-кандидат» - своя группа', () => {
  const dir = tmpDir({
    'notes-1.0.0.txt': 'x', 'readme.md': 'x', 'app-1.0.apk': 'x', 'app-v1.0.0.apk': 'x',
    'app-1.0.0-кандидат.apk': 'x', 'app-1.0.1.apk': 'x', 'app-1.0.2.apk': 'x', 'app-1.0.3.apk': 'x'
  });
  fs.mkdirSync(path.join(dir, 'app-0.0.1.apk'));   // папка с «версионным» именем - не файл
  try {
    assert.deepEqual(L.pruneOldVersions(dir, 3), []);
    assert.equal(ls(dir).length, 9);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

['update.json', 'last-apk.json', 'published.json'].forEach((bad) => {
  test('pruneOldVersions: битый ' + bad + ' - не удаляет ничего и громко отказывается', () => {
    const dir = tmpDir({
      'app-0.1.0.apk': 'x', 'app-0.1.1.apk': 'x', 'app-0.1.2.apk': 'x', 'app-0.1.3.apk': 'x',
      [bad]: '{ битый'
    });
    try {
      assert.throws(() => L.pruneOldVersions(dir, 3), (e) => e.message.indexOf(bad) >= 0 && e.message.indexOf('ничего не удалено') >= 0);
      assert.equal(ls(dir).length, 5);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// Осечка посередине удаления: ошибка обязана сказать, что УЖЕ удалено (e.removed), а не
// выдавать себя за «пропущена».
test('pruneOldVersions: упало на втором удалении - ошибка несёт уже удалённое', () => {
  const dir = tmpDir({ 'app-0.1.0.apk': 'x', 'app-0.1.1.apk': 'x', 'app-0.1.2.apk': 'x', 'app-0.1.3.apk': 'x', 'app-0.1.4.apk': 'x' });
  const real = fs.unlinkSync;
  let n = 0;
  fs.unlinkSync = function (p) { if (++n === 2) throw new Error('EBUSY занято'); return real.apply(this, arguments); };
  try {
    assert.throws(() => L.pruneOldVersions(dir, 3), (e) => {
      assert.equal(e.removed.length, 1);
      assert.ok(e.message.indexOf('EBUSY') >= 0 && e.message.indexOf(e.removed[0]) >= 0, e.message);
      return true;
    });
  } finally { fs.unlinkSync = real; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pruneOldVersions: нет папки - пустой список, не падение', () => {
  assert.deepEqual(L.pruneOldVersions(path.join(os.tmpdir(), 'нет-такой-папки-' + Date.now()), 3), []);
});

// Заслон «только в конце успешной сборки»: вызов уборки стоит в скрипте ПОСЛЕ последнего
// die() (любая осечка выходит раньше) и после записи артефактов. Нет скрипта - красный:
// тихий return прятал бы переименование/удаление сборки.
test('build-скрипты: уборка зовётся один раз, в самом конце, после всех die(); осечка печатает удалённое', () => {
  // build-ota.js - внутренний скрипт, в публичный репозиторий не входит
  ['build-apk.js', 'build-ota.js'].filter((n) => n === 'build-apk.js' || fs.existsSync(path.join(__dirname, '..', n))).forEach((name) => {
    const p = path.join(__dirname, '..', name);
    assert.ok(fs.existsSync(p), name + ' не найден - заслон уборки проверять не на чем');
    const src = fs.readFileSync(p, 'utf8');
    const at = src.indexOf('L.pruneOldVersions(OUT_DIR, 3)');
    assert.ok(at > 0, name + ': нет вызова L.pruneOldVersions(OUT_DIR, 3)');
    assert.equal(src.indexOf('pruneOldVersions', at + 20), -1, name + ': вызов уборки должен быть один');
    assert.ok(at > src.lastIndexOf('die('), name + ': уборка стоит раньше последнего die()');
    assert.ok(at > src.lastIndexOf('fs.writeFileSync(') && at > src.lastIndexOf('fs.copyFileSync('),
      name + ': уборка стоит раньше записи артефактов');
    assert.ok(src.indexOf('e.removed', at) > at, name + ': catch уборки не печатает e.removed (что уже удалено)');
  });
});

// publish-update.py пишет published.json - и только ПОСЛЕ цикла заливки (put_object):
// иначе отметка «опубликовано» появилась бы и при упавшей заливке.
test('publish-update.py: published.json пишется после всех put_object, вне цикла, копией манифеста', { skip: !fs.existsSync(path.join(__dirname, '..', 'publish-update.py')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'publish-update.py'), 'utf8').replace(/\r\n/g, '\n');
  const put = src.lastIndexOf('s3.put_object(');
  assert.ok(put > 0, 'нет s3.put_object');
  const m = src.match(/^with open\(os\.path\.join\(OUT, "published\.json"\), "w", encoding="utf-8"\) as f:\n    json\.dump\(manifest, f/m);
  assert.ok(m, 'нет записи out/.../published.json копией manifest на верхнем уровне (без отступа = вне цикла)');
  assert.ok(m.index > put, 'published.json пишется раньше заливки');
  assert.equal(src.split('"published.json"').length, 2, 'published.json должен писаться ровно в одном месте');
});
