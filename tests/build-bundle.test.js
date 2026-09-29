/* Сборка веб-архива: опись files.json и zip. Проверяем на настоящих файлах проекта —
   если из сборки выпадет index.html или в опись пролезет отладочный selftest.js,
   бесшовное обновление приедет битым, а узнать об этом хочется здесь. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { unzipSync } = require('fflate');
const L = require('../build-lib.js');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-ship-'));
}

test('files.json в www/ описывает то, что реально едет в сборку', () => {
  const j = JSON.parse(fs.readFileSync(path.join(WWW, 'files.json'), 'utf8'));
  assert.ok(Array.isArray(j.files) && j.files.length > 10, 'список пустой');
  assert.equal(j.version, require('../package.json').version, 'версия описи разошлась с package.json');

  // всё перечисленное существует (звуки есть в APK, но в публичный репозиторий не выложены)
  j.files.filter(f => !/^sounds\/.+\.(mp3|ogg)$/.test(f))
    .forEach(f => assert.ok(fs.existsSync(path.join(WWW, f)), 'нет файла из описи: ' + f));

  // без чего приложение не запустится
  ['index.html', 'version.js', 'boot.js', 'native.js', 'ui.js', 'engine.js', 'update.js',
   'style.css', 'files.json', 'vendor/fflate.min.js'].forEach(f =>
    assert.ok(j.files.indexOf(f) >= 0, 'в описи нет ' + f));

  // отладочного в сборке быть не должно
  L.DEV_ONLY.forEach(f => assert.equal(j.files.indexOf(f), -1, 'в опись пролез ' + f));

  // шрифты едут все
  const fonts = j.files.filter(f => f.indexOf('fonts/') === 0);
  assert.equal(fonts.length, fs.readdirSync(path.join(WWW, 'fonts')).length, 'шрифты потерялись');
});

test('makeShip: чистая копия без отладочных файлов и без тега selftest', () => {
  const dir = tmp();
  try {
    L.makeShip(WWW, path.join(dir, 'ship'));
    const ship = path.join(dir, 'ship');
    L.DEV_ONLY.forEach(f => assert.equal(fs.existsSync(path.join(ship, f)), false, f + ' попал в сборку'));
    const idx = fs.readFileSync(path.join(ship, 'index.html'), 'utf8');
    assert.equal(idx.indexOf('selftest.js'), -1, 'тег selftest.js остался в index.html');
    // а вот boot.js обязан грузиться ДО приложения — иначе откатывать будет некому
    assert.ok(idx.indexOf('boot.js') < idx.indexOf('ui.js'), 'boot.js грузится не раньше ui.js');
    assert.ok(idx.indexOf('version.js') < idx.indexOf('boot.js'), 'boot.js не знает версии');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- релизные флаги: вшиваются makeShip, одним кодом для APK и OTA ----------

const FLAGS_RELEASE = '<script>window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;window.HOMYAK_PAY=true;</script>';
const FLAGS_STORE = '<script>window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;window.HOMYAK_PAY=true;window.HOMYAK_STORE=true;</script>';

test('makeShip без opts: тест-сборка, флагов в index.html нет', () => {
  const dir = tmp();
  try {
    L.makeShip(WWW, path.join(dir, 'ship'));
    const idx = fs.readFileSync(path.join(dir, 'ship', 'index.html'), 'utf8');
    assert.equal(idx.indexOf('HOMYAK_FULL_ACCESS'), -1);
    assert.equal(idx.indexOf('HOMYAK_DEMO'), -1);
    assert.equal(idx.indexOf('HOMYAK_STORE'), -1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeShip {release:true}: демо и полный доступ выключены, STORE нет, тег ПЕРЕД version.js', () => {
  const dir = tmp();
  try {
    L.makeShip(WWW, path.join(dir, 'ship'), { release: true });
    const idx = fs.readFileSync(path.join(dir, 'ship', 'index.html'), 'utf8');
    assert.ok(idx.indexOf(FLAGS_RELEASE) >= 0, 'релизные флаги не вшиты');
    assert.equal(idx.indexOf('HOMYAK_STORE'), -1, 'релиз без стора не должен включать STORE');
    // ровно один раз и раньше version.js (access.js читает флаги позже)
    assert.equal(idx.split('HOMYAK_DEMO').length - 1, 1, 'флаги вшиты дважды');
    assert.ok(idx.indexOf(FLAGS_RELEASE) < idx.indexOf(L.FLAG_MARKER), 'флаги стоят после version.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeShip {store:true}: релиз + HOMYAK_STORE=true в том же теге (store подразумевает release)', () => {
  const dir = tmp();
  try {
    L.makeShip(WWW, path.join(dir, 'ship'), { store: true });
    const idx = fs.readFileSync(path.join(dir, 'ship', 'index.html'), 'utf8');
    assert.ok(idx.indexOf(FLAGS_STORE) >= 0, 'сторовые флаги не вшиты');
    assert.equal(idx.split('<script>window.HOMYAK').length - 1, 1, 'флаги вшиты не одним тегом');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeShip: нет маркера version.js → бросает, а не молчит', () => {
  const dir = tmp();
  try {
    // копия www без маркера: index.html с чем угодно, кроме <script src="version.js">
    const src = path.join(dir, 'www');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'index.html'), '<html><body><script src="ver.js"></script></body></html>');
    assert.throws(() => L.makeShip(src, path.join(dir, 'ship'), { release: true }), /маркера/);
    // без флагов тот же index.html проходит: маркер нужен только под инъекцию
    L.makeShip(src, path.join(dir, 'ship2'));
    assert.ok(fs.existsSync(path.join(dir, 'ship2', 'index.html')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flagsTag: строка флагов по opts', () => {
  assert.equal(L.flagsTag(), '');
  assert.equal(L.flagsTag({ release: false }), '');
  assert.equal(L.flagsTag({ release: true }), FLAGS_RELEASE + '\n');
  assert.equal(L.flagsTag({ store: true }), FLAGS_STORE + '\n');
  assert.equal(L.flagsTag({ release: true, store: true }), FLAGS_STORE + '\n');
});

test('buildMode: env и argv, store подразумевает release', () => {
  assert.deepEqual(L.buildMode({}, []), { release: false, store: false });
  assert.deepEqual(L.buildMode({ HOMYAK_RELEASE: '1' }, []), { release: true, store: false });
  assert.deepEqual(L.buildMode({}, ['--release']), { release: true, store: false });
  assert.deepEqual(L.buildMode({ HOMYAK_STORE: '1' }, []), { release: true, store: true });
  assert.deepEqual(L.buildMode({}, ['--store']), { release: true, store: true });
  assert.deepEqual(L.buildMode({ HOMYAK_RELEASE: '0' }, []), { release: false, store: false });
});

test('versionCodeOf: тест и релиз одной версии различимы, ряд стора монотонный', () => {
  assert.equal(L.versionCodeOf('0.1.6', false), 212);
  assert.equal(L.versionCodeOf('0.1.6', true), 213);
  assert.equal(L.versionCodeOf('0.1.7', false), 214);
  assert.equal(L.versionCodeOf('0.1.7', true), 215);
  assert.ok(L.versionCodeOf('0.2.0', true) > L.versionCodeOf('0.1.99', true));
  assert.ok(L.versionCodeOf('1.0.0', true) > L.versionCodeOf('0.99.99', true));
});

test('writeFilesJson: опись считается по чистой копии и включает саму себя', () => {
  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    const files = L.writeFilesJson(ship, null, '9.9.9');
    assert.ok(files.indexOf('files.json') >= 0, 'опись не перечисляет саму себя');
    assert.equal(files.filter(f => f === 'files.json').length, 1, 'files.json продублировался');
    // порядок устойчивый: два запуска дают один и тот же список
    const again = L.writeFilesJson(ship, null, '9.9.9');
    assert.deepEqual(again, files);
    const onDisk = JSON.parse(fs.readFileSync(path.join(ship, 'files.json'), 'utf8'));
    assert.equal(onDisk.version, '9.9.9');
    assert.deepEqual(onDisk.files, files);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zipShip: архив распаковывается тем же fflate и содержит всю сборку байт в байт', () => {
  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    L.writeFilesJson(ship, null, '9.9.9');
    const buf = L.zipShip(ship);
    const out = unzipSync(new Uint8Array(buf));

    const names = Object.keys(out).sort();
    assert.deepEqual(names, L.listFiles(ship), 'состав архива разошёлся со сборкой');
    assert.ok(out['index.html'], 'в архиве нет index.html');

    // байты не поехали: сверяем картинку и шрифт, на них ломается перекодировка
    ['hamster.png', 'index.html', 'fonts/manrope-cyrillic-700.woff2'].forEach(n => {
      const disk = fs.readFileSync(path.join(ship, n));
      assert.equal(Buffer.compare(disk, Buffer.from(out[n])), 0, 'файл поехал: ' + n);
    });

    // имена только относительные — их будет проверять safeName на телефоне
    names.forEach(n => {
      assert.equal(n.indexOf('..'), -1, n);
      assert.notEqual(n.charAt(0), '/', n);
      assert.equal(n.indexOf('\\'), -1, n);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zipShip: детерминизм — один www даёт байт-в-байт одинаковый zip и sha (корень «пакет повреждён»)', () => {
  // Без фиксированного mtime fflate вшивает в записи текущее время: пересборка того же www
  // давала другой байтовый zip и другой sha256, и телефон бросал ERR_HASH. Два прогона —
  // один и тот же архив: только так sha в манифесте гарантированно совпадает с выложенным zip.
  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    L.writeFilesJson(ship, null, '9.9.9');
    const a = L.zipShip(ship);
    const b = L.zipShip(ship);
    assert.equal(Buffer.compare(a, b), 0, 'два прогона дали разный zip');
    assert.equal(L.sha256hex(a), L.sha256hex(b), 'sha разошёлся между прогонами');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selfCheckZip: клиентский код принимает свежий бандл', () => {
  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    L.writeFilesJson(ship, null, '0.3.0');
    const buf = L.zipShip(ship);
    const sha = L.sha256hex(buf);
    const r = L.selfCheckZip(buf, sha, WWW);
    assert.ok(r.files > 10, 'мало файлов в бандле: ' + r.files);
    assert.equal(r.sha, sha, 'самопроверка вернула другой sha');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selfCheckZip: КРАСНЕЕТ на порче — неверный sha, перевёрнутый байт, обрезка, нет index.html', () => {
  // Мутационный заслон: если самопроверка не ловит порчу, она бесполезна. Каждая мутация —
  // отдельный реальный сценарий, в котором телефон получил бы «пакет повреждён».
  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    L.writeFilesJson(ship, null, '0.3.0');
    const buf = L.zipShip(ship);
    const sha = L.sha256hex(buf);

    // sha в манифесте не тот (раздельная выкладка zip и манифеста)
    assert.throws(() => L.selfCheckZip(buf, 'f'.repeat(64), WWW), /sha256/);

    // перевёрнутый байт при НЕИЗМЕННОМ манифесте — ровно клиентский ERR_HASH
    const flipped = Buffer.from(buf);
    flipped[Math.floor(flipped.length / 2)] ^= 0xff;
    assert.throws(() => L.selfCheckZip(flipped, sha, WWW), /sha256/);

    // обрезанный архив (sha пересчитан, чтобы проверить именно распаковку, а не хеш)
    const cut = Buffer.from(buf.subarray(0, Math.max(1, Math.floor(buf.length / 2))));
    assert.throws(() => L.selfCheckZip(cut, L.sha256hex(cut), WWW), /unpack/);

    // валидный zip, но без index.html — клиентский unpack обязан отвергнуть
    const { zipSync } = require('fflate');
    const bag = {};
    L.listFiles(ship).filter(n => n !== 'index.html').forEach(n => {
      bag[n] = new Uint8Array(fs.readFileSync(path.join(ship, n)));
    });
    const noIndex = Buffer.from(zipSync(bag, { level: 6, mtime: L.OTA_MTIME }));
    assert.throws(() => L.selfCheckZip(noIndex, L.sha256hex(noIndex), WWW), /unpack/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('круг замкнулся: собранный архив распаковывается ВШИТЫМ в приложение fflate', () => {
  // Проверяем не библиотеку из node_modules, а ровно тот файл, который едет в APK:
  // если www/vendor/fflate.min.js обновят криво, обновление встанет намертво.
  const Update = require('../www/update.js');
  const src = fs.readFileSync(path.join(WWW, 'vendor', 'fflate.min.js'), 'utf8');
  const sandbox = { module: undefined, exports: undefined };
  new Function('self', 'module', 'exports', src)(sandbox, undefined, undefined);
  const ff = sandbox.fflate;
  assert.equal(typeof ff.unzipSync, 'function', 'вшитый fflate не отдал unzipSync');

  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    L.writeFilesJson(ship, null, '0.3.0');
    const files = Update.unpack(new Uint8Array(L.zipShip(ship)), ff);
    assert.deepEqual(Object.keys(files).sort(), L.listFiles(ship), 'состав после распаковки разошёлся');
    assert.ok(files['index.html'].length > 100, 'index.html пустой');
    // и опись внутри архива совпадает с тем, что реально в архиве лежит
    const listed = JSON.parse(Buffer.from(files['files.json']).toString('utf8')).files;
    assert.deepEqual(listed.slice().sort(), Object.keys(files).sort(), 'опись врёт про состав архива');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sha256hex: тот же хеш, что напишет манифест и посчитает телефон', () => {
  const b = Buffer.from('хомяк-сборка');
  assert.equal(L.sha256hex(b), crypto.createHash('sha256').update(b).digest('hex'));
  assert.match(L.sha256hex(b), /^[0-9a-f]{64}$/);
});

test('манифест, который пишет сборка, разбирается приложением', () => {
  const Update = require('../www/update.js');
  const dir = tmp();
  try {
    const ship = path.join(dir, 'ship');
    L.makeShip(WWW, ship);
    L.writeFilesJson(ship, null, '0.3.0');
    const buf = L.zipShip(ship);
    const manifest = {
      version: '0.3.0',
      apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-0.3.0.apk',
      size: 3120000,
      notes: 'что нового',
      web: {
        version: '0.3.0',
        url: 'https://dorokhin-finance.ru/homyak/www-0.3.0.zip',
        sha256: L.sha256hex(buf),
        size: buf.length,
        minShell: '0.3.0'
      }
    };
    const m = Update.parseManifest(manifest);
    assert.ok(m, 'приложение не приняло собственный манифест');
    assert.equal(m.web.sha256, manifest.web.sha256);
    // телефон 0.2.9 с такой оболочкой пойдёт за APK, 0.3.0 — за бесшовным
    assert.equal(Update.decide(m, '0.2.9', '0.2.9').kind, 'apk');
    assert.equal(Update.decide(m, '0.2.9', '0.3.0').kind, 'ota');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
