/* Страховка обновления, круг 3: откат на ПРЕЖНЮЮ РАБОЧУЮ сборку, память о провале и
   честный номер оболочки. Всё это чистые функции update.js/boot.js плюс уборка sweep,
   которой хватает подставной файловой системы — браузер не нужен. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Update = require('../www/update.js');
const Boot = require('../www/boot.js');

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

function manifest(webVer, opts) {
  opts = opts || {};
  return Update.parseManifest({
    version: opts.apk || '0.3.0',
    apkUrl: 'https://dorokhin-finance.ru/homyak/homyak.apk',
    size: 100, notes: 'что нового',
    web: {
      version: webVer,
      url: 'https://dorokhin-finance.ru/homyak/www-' + webVer + '.zip',
      sha256: opts.sha || SHA, size: 100,
      minShell: opts.minShell || '0.3.0'
    }
  });
}

// ---------- подставная файловая система для sweep ----------
function fakeFs(paths) {
  const files = new Set(paths);
  const log = [];
  return {
    log, files,
    readdir({ path }) {
      const set = new Set();
      for (const f of files) {
        if (f.indexOf(path + '/') === 0) set.add(f.slice(path.length + 1).split('/')[0]);
      }
      return Promise.resolve({ files: [...set].map((name) => ({ name })) });
    },
    rmdir({ path }) {
      log.push('rmdir ' + path);
      for (const f of [...files]) if (f === path || f.indexOf(path + '/') === 0) files.delete(f);
      return Promise.resolve();
    }
  };
}

test('sweep: прежняя рабочая сборка переживает первый запуск новой', async () => {
  const F = fakeFs([
    'ota/base/.complete', 'ota/base/index.html',
    'ota/state.json',
    'ota/0.3.1/index.html',                 // позапрошлая — её и надо убрать
    'ota/0.3.2/index.html',                 // прежняя рабочая
    'ota/0.3.3/index.html'                  // текущая, ещё не подтверждённая
  ]);
  await Update.sweep(F, '0.3.3', '0.3.2');
  assert.ok(F.files.has('ota/0.3.2/index.html'), 'прежнюю рабочую снесли');
  assert.ok(F.files.has('ota/0.3.3/index.html'), 'текущую снесли');
  assert.ok(F.files.has('ota/base/.complete'), 'заводскую снесли');
  assert.ok(F.files.has('ota/state.json'), 'карту сборок снесли');
  assert.deepEqual(F.log, ['rmdir ota/0.3.1']);
});

test('sweep: без прежней рабочей держим только текущую и заводскую', async () => {
  const F = fakeFs(['ota/base/.complete', 'ota/0.3.2/index.html', 'ota/0.3.3/index.html']);
  await Update.sweep(F, '0.3.3', '');
  assert.equal(F.files.has('ota/0.3.2/index.html'), false);
  assert.ok(F.files.has('ota/0.3.3/index.html'));
});

test('normState / buildOf: карта сборок и разбор пути', () => {
  assert.deepEqual(Update.normState({ current: '0.3.3', previousOk: '0.3.2' }),
    { current: '0.3.3', previousOk: '0.3.2' });
  assert.deepEqual(Update.normState(null), { current: '', previousOk: '' });
  assert.deepEqual(Update.normState({ current: '0.3.3', previousOk: '0.3.3' }),
    { current: '0.3.3', previousOk: '' }, 'сама себе прежней быть не может');
  assert.deepEqual(Update.normState({ current: 'мусор', previousOk: 5 }),
    { current: '', previousOk: '' });

  assert.equal(Update.buildOf('/data/user/0/ru.dorokhin.budgetphone/files/ota/0.3.2'), '0.3.2');
  assert.equal(Update.buildOf('/data/user/0/ru.dorokhin.budgetphone/files/ota/base'), '');
  assert.equal(Update.buildOf('public'), '');
  assert.equal(Update.buildOf(''), '');
  assert.equal(Update.buildOf(null), '');
});

test('boot.decide: номер архива едет в метку попытки и в запись о провале', () => {
  const bag = { 'homyak-ota-try': JSON.stringify({ version: '0.3.3', ts: 7, boots: 1, sha256: SHA }) };
  const d = Boot.decide((k) => (k in bag ? bag[k] : null), '0.3.3');
  assert.equal(d.action, 'revert');
  assert.equal(d.sha256, SHA);

  const rec = Boot.failRecord(null, d.version, d.sha256);
  assert.deepEqual(rec, { version: '0.3.3', count: 1, sha256: SHA, shown: false });
  // тот же номер второй раз — счёт растёт
  assert.equal(Boot.failRecord(JSON.stringify(rec), '0.3.3', SHA).count, 2);
  // другая версия — счёт с нуля
  assert.equal(Boot.failRecord(JSON.stringify(rec), '0.3.4', SHA).count, 1);
  // метка старого вида (просто строка) читается
  assert.equal(Boot.failRecord('0.3.3', '0.3.3', SHA).count, 2);
});

test('decide: версия, которая уже не завелась, повторно не предлагается', () => {
  const m = manifest('0.3.3');
  const fail = { version: '0.3.3', count: 1, sha256: SHA };
  assert.equal(Update.decide(m, '0.3.0', '0.3.0').kind, 'ota', 'без памяти о провале — обычное обновление');
  const d = Update.decide(m, '0.3.0', '0.3.0', fail);
  assert.equal(d.kind, 'skipped');
  assert.equal(d.version, '0.3.3');
});

test('decide: тот же номер, но другой архив — пробуем снова', () => {
  const fail = { version: '0.3.3', count: 2, sha256: SHA };
  assert.equal(Update.decide(manifest('0.3.3', { sha: SHA2 }), '0.3.0', '0.3.0', fail).kind, 'ota');
  // а вот провал без sha (метка старого вида) закрывает версию целиком
  assert.equal(Update.decide(manifest('0.3.3', { sha: SHA2 }), '0.3.0', '0.3.0',
    { version: '0.3.3', count: 1 }).kind, 'skipped');
});

test('decide: провалилась одна версия, а оболочка отстала — APK всё равно предложим', () => {
  const m = manifest('0.3.3', { apk: '0.3.5' });
  const d = Update.decide(m, '0.3.0', '0.3.0', { version: '0.3.3', count: 1, sha256: SHA });
  assert.equal(d.kind, 'apk');
  assert.equal(d.version, '0.3.5');
});

test('failBlocks: чужая версия и нулевой счёт не мешают', () => {
  const w = { version: '0.3.3', sha256: SHA };
  assert.equal(Update.failBlocks(null, w), false);
  assert.equal(Update.failBlocks({ version: '0.3.2', count: 5 }, w), false);
  assert.equal(Update.failBlocks({ version: '0.3.3', count: 0 }, w), false);
  assert.equal(Update.failBlocks({ version: '0.3.3', count: 1 }, w), true);
});

test('decide: номер оболочки неизвестен — бесшовное не предлагаем, только APK', () => {
  const m = manifest('0.3.5', { apk: '0.3.1', minShell: '0.3.0' });
  // null и пустая строка — одно и то же «не знаю»
  [null, ''].forEach((shell) => {
    const d = Update.decide(m, '0.3.4', shell);
    assert.equal(d.kind, 'apk', 'shell=' + JSON.stringify(shell));
    assert.equal(d.version, '0.3.1', 'APK предлагается честно, даже если он младше веб-сборки');
    assert.equal(d.shellUnknown, true);
  });
});

test('decide: неизвестная оболочка не мешает сборке без требований (minShell «0»)', () => {
  const m = Update.parseManifest({
    version: '0.3.0', apkUrl: 'https://dorokhin-finance.ru/homyak/h.apk', size: 1, notes: '',
    web: { version: '0.3.5', url: 'https://dorokhin-finance.ru/homyak/w.zip', sha256: SHA, size: 1 }
  });
  assert.equal(m.web.minShell, '0');
  assert.equal(Update.decide(m, '0.3.4', null).kind, 'ota');
});

test('decide: известная оболочка работает как раньше', () => {
  assert.equal(Update.decide(manifest('0.3.5', { minShell: '0.4.0' }), '0.3.4', '0.3.0').kind, 'none');
  assert.equal(Update.decide(manifest('0.3.5', { minShell: '0.3.0' }), '0.3.4', '0.3.0').kind, 'ota');
});

test('zipTimeout: часы растут с размером архива и упираются в потолок', () => {
  assert.equal(Update.zipTimeout(0), 20000);
  assert.equal(Update.zipTimeout(1024 * 1024), 30000);
  assert.equal(Update.zipTimeout(1269011), 32102);       // текущая сборка 1,27 МБ
  assert.equal(Update.zipTimeout(8 * 1024 * 1024), 100000);
  assert.equal(Update.zipTimeout(50 * 1024 * 1024), 120000, 'потолок две минуты');
  assert.equal(Update.zipTimeout('мусор'), 20000);
});

test('unpack: распакованный объём тоже под пределом', () => {
  const { zipSync } = require('fflate');
  const enc = (s) => new TextEncoder().encode(s);

  // зип-бомба: 60 МБ нулей ужимаются в 60 КБ и под MAX_ZIP проходят спокойно
  const bomb = zipSync({ 'index.html': enc('<html>'), 'z.bin': new Uint8Array(60 * 1024 * 1024) }, { level: 9 });
  assert.ok(bomb.length <= Update.MAX_ZIP, 'архив бомбы и правда мал: ' + bomb.length);
  assert.throws(() => Update.unpack(bomb, require('fflate')), /подозрительно большой/);

  // один файл больше восьми мегабайт — тоже отказ
  const fat = zipSync({ 'index.html': enc('<html>'), 'f.bin': new Uint8Array(Update.MAX_FILE + 1) }, { level: 9 });
  assert.throws(() => Update.unpack(fat, require('fflate')), /подозрительно большой/);

  // нормальная сборка проходит
  const ok = Update.unpack(zipSync({ 'index.html': enc('<html>'), 'a.js': enc('1') }), require('fflate'));
  assert.deepEqual(Object.keys(ok).sort(), ['a.js', 'index.html']);
});
