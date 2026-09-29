'use strict';
/**
 * build-lib.js — общая кухня двух сборок.
 *
 *   build-apk.js — полная сборка оболочки (Gradle, APK) + веб-архив к ней;
 *   build-ota.js — только веб-архив, без Android SDK и без Gradle.
 *
 * Чтобы «чистая копия www», список файлов и zip считались ОДИНАКОВО в обоих случаях,
 * всё это живёт здесь, а не копией в каждом скрипте.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipSync } = require('fflate');

// Инструменты QA, которым в сборке делать нечего: self-test заперт проверкой адреса и
// безопасен, но это отладочный балласт, а страницы иконок и превью - вообще рабочий
// стол разработчика. В www/ они остаются, из сборки исключаются.
// README.txt из www/sounds/ — записка для хозяина папки, а не файл приложения.
// Сами звуки (sounds/*.mp3, *.ogg) в сборку едут: их подхватывает listFiles.
const DEV_ONLY = ['selftest.js', 'icons.html', 'preview.html', 'icon-512.png', 'README.txt'];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// рекурсивная копия www/ с отсевом отладочных файлов
function copyClean(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((e) => {
    if (skip.indexOf(e.name) >= 0) return;
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyClean(src, dst, skip);
    else fs.copyFileSync(src, dst);
  });
}

// все файлы папки как относительные пути через «/», по алфавиту
function listFiles(root, rel) {
  rel = rel || '';
  const out = [];
  fs.readdirSync(path.join(root, rel), { withFileTypes: true }).forEach((e) => {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push.apply(out, listFiles(root, r));
    else out.push(r);
  });
  return out.sort();
}

// Маркер в index.html, перед которым вшиваются релизные флаги. Он должен стоять
// раньше access.js (тот читает window.HOMYAK_*), version.js - первый тег в файле.
const FLAG_MARKER = '<script src="version.js">';

// Тег с релизными флагами для отгружаемого index.html. Только строка, без записи:
// её проверяют тесты и вшивает makeShip.
//   release → демо и полный доступ выключены (чистый пресет + free-гейт);
//   store   → то же + HOMYAK_STORE=true (обновления только через RuStore).
// store без release не бывает: сторовая сборка всегда релизная.
function flagsTag(opts) {
  opts = opts || {};
  // reel-сборка для промо-скринкастов: полный доступ (без гейта) + reel-персоны.
  // Это НЕ релиз: гейт не включаем. Ветка стоит раньше release, поэтому обычные
  // тест/релиз/стор-сборки reel-флага никогда не получают.
  if (opts.reel) {
    return '<script>window.HOMYAK_REEL=true;window.HOMYAK_FULL_ACCESS=true;</script>\n';
  }
  const store = !!opts.store;
  const release = !!opts.release || store;
  if (!release) return '';
  // HOMYAK_PAY=true — в релизе/сторе оплата подключена: пейволл показывает «Купить» и
  // «Восстановить покупку». Пока в strings.xml/pay-config.js плейсхолдер console_app_id,
  // покупка на девайсе отвечает «не сконфигурировано» (Pro бесплатно не выдаётся), а в
  // браузере/деве JS-адаптер уходит на MockPayment. Боевой id вписывает Алексей.
  let js = 'window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;window.HOMYAK_PAY=true;';
  if (store) js += 'window.HOMYAK_STORE=true;';
  return '<script>' + js + '</script>\n';
}

// Чистая копия www под сборку: без отладочных файлов и без тега selftest.js в index.html
// (файла в сборке нет - приложение не должно ломиться за отсутствующим скриптом).
// opts = {release, store} - релизные флаги вшиваются ЗДЕСЬ, одним кодом для APK и OTA:
// раньше их вшивал только build-apk.js, и веб-обновление из build-ota.js уехало бы
// клиентам с DEMO=true (ключ хранилища переключился бы на демо, данные «исчезли» бы,
// полный доступ открылся бы бесплатно). Если маркер в index.html не найден -
// сборка валится, а не молчит.
function makeShip(www, ship, opts) {
  rmrf(ship);
  copyClean(www, ship, DEV_ONLY);
  const idx = path.join(ship, 'index.html');
  let html = fs.readFileSync(idx, 'utf8')
    .replace(/^[ \t]*<script src="selftest\.js"><\/script>\r?\n/m, '');
  const tag = flagsTag(opts);
  if (tag) {
    const at = html.indexOf(FLAG_MARKER);
    if (at < 0) {
      throw new Error('в www/index.html нет маркера ' + FLAG_MARKER +
        ' - некуда вшить релизные флаги, сборка остановлена');
    }
    if (html.indexOf(FLAG_MARKER, at + 1) >= 0) {
      throw new Error('в www/index.html маркер ' + FLAG_MARKER + ' встречается дважды');
    }
    html = html.slice(0, at) + tag + html.slice(at);
    if (html.indexOf(tag + FLAG_MARKER) < 0) {
      throw new Error('релизные флаги не вшились в index.html');
    }
  }
  fs.writeFileSync(idx, html);
  return ship;
}

// Разбор режима сборки из env + argv. HOMYAK_STORE=1 / --store → store (+release),
// HOMYAK_RELEASE=1 / --release → release. Без всего - тест-сборка.
function buildMode(env, argv) {
  env = env || {};
  argv = argv || [];
  const on = (v) => !!v && v !== '0' && v !== 'false' && v !== '';
  const store = on(env.HOMYAK_STORE) || argv.indexOf('--store') >= 0;
  const release = store || on(env.HOMYAK_RELEASE) || argv.indexOf('--release') >= 0;
  return { release: release, store: store };
}

/**
 * files.json — опись сборки. По ней приложение на первом запуске делает заводскую
 * копию www в личной папке телефона: копия нужна, чтобы было куда откатиться, если
 * приехавшее обновление не заведётся. Список считаем по ЧИСТОЙ копии (то, что реально
 * едет в APK), пишем и в неё, и в рабочую www/ - чтобы файл был виден в репозитории
 * и в браузерном превью.
 */
function writeFilesJson(ship, www, version) {
  const files = listFiles(ship).filter((f) => f !== 'files.json');
  files.push('files.json');
  files.sort();
  const body = JSON.stringify({ version: version, files: files }, null, 2) + '\n';
  fs.writeFileSync(path.join(ship, 'files.json'), body, 'utf8');
  if (www) fs.writeFileSync(path.join(www, 'files.json'), body, 'utf8');
  return files;
}

// Фиксированное время записей архива (см. zipShip). В пределах 1980-2099 - иначе fflate
// бракует дату. Число не важно, важна НЕИЗМЕННОСТЬ: от него зависит воспроизводимость zip.
const OTA_MTIME = new Date('2024-01-01T00:00:00Z');

// zip чистой копии: ровно те же файлы, что и в APK, теми же именами.
// ДЕТЕРМИНИРОВАННО (корень бага «пакет повреждён»): без mtime fflate.zipSync вшивает в
// каждую запись ТЕКУЩЕЕ время, поэтому один и тот же www при каждой пересборке даёт РАЗНЫЙ
// байтовый zip → разный sha256. Контракт целостности держится только если на канале лежит
// ровно тот zip, чей sha попал в манифест: телефон сверяет sha скачанного архива с sha из
// манифеста (fetchBundle) и на расхождении бросает ERR_HASH «файл скачался повреждённым».
// Любая пересборка/повторная выкладка/раздельная заливка zip и манифеста рвала бы sha.
// Фиксируем mtime → байт-в-байт воспроизводимый zip, стабильный sha, идемпотентная выкладка.
function zipShip(ship) {
  const bag = {};
  listFiles(ship).forEach((name) => {
    bag[name] = new Uint8Array(fs.readFileSync(path.join(ship, name)));
  });
  return Buffer.from(zipSync(bag, { level: 6, mtime: OTA_MTIME }));
}

// ---------- САМОПРОВЕРКА OTA-бандла (заслон от повтора «пакет повреждён») ----------
// После сборки zip прогоняем его через ТУ ЖЕ логику, что и телефон на устройстве:
//   1) sha256(zip) == sha в манифесте        (Update.sameHash, как fetchBundle);
//   2) размер zip <= MAX_ZIP                  (как fetchBundle/parseWeb);
//   3) Update.unpack(zip, fflate)             (fflate.unzipSync + safeName + MAX_FILE/MAX_RAW +
//      требование index.html — код клиента, а не его копия);
//   4) внутри есть ключевые файлы приложения (без них www не оживёт).
// «Та же логика» гарантирована тем, что грузим НАСТОЯЩИЕ www/update.js и www/vendor/fflate.min.js:
// отвергнет бандл клиент - отвергнет и самопроверка. Не прошло - бросаем, а build-ota.js
// останавливает публикацию, а не выкладывает битьё.
const CORE_IN_BUNDLE = ['index.html', 'version.js', 'boot.js', 'native.js', 'ui.js',
  'engine.js', 'update.js', 'style.css', 'files.json', 'vendor/fflate.min.js'];

// Вшитый в приложение fflate - грузим ровно так, как это делает клиент (UMD → self.fflate),
// а не библиотеку из node_modules: если www/vendor/fflate.min.js кривой, узнать это надо здесь.
function loadClientFflate(wwwDir) {
  const src = fs.readFileSync(path.resolve(wwwDir, 'vendor', 'fflate.min.js'), 'utf8');
  const sandbox = { module: undefined, exports: undefined };
  new Function('self', 'module', 'exports', src)(sandbox, undefined, undefined);
  return sandbox.fflate;
}

function selfCheckZip(zipBuf, expectedSha, wwwDir) {
  // path.resolve, не join: require трактует относительный «www/update.js» как ИМЯ ПАКЕТА и
  // падает MODULE_NOT_FOUND; абсолютный путь читается как файл при любом wwwDir.
  const Update = require(path.resolve(wwwDir, 'update.js'));   // UMD → module.exports (mount() не зовётся)
  const fflate = loadClientFflate(wwwDir);
  if (!fflate || typeof fflate.unzipSync !== 'function') {
    throw new Error('самопроверка: не загрузился www/vendor/fflate.min.js (нет unzipSync)');
  }
  const zip = Buffer.isBuffer(zipBuf) ? zipBuf : Buffer.from(zipBuf);
  const sha = sha256hex(zip);
  if (!Update.sameHash(sha, expectedSha)) {
    throw new Error('самопроверка: sha256 бандла (' + sha + ') != sha в манифесте (' + expectedSha + ')');
  }
  if (zip.length > Update.MAX_ZIP) {
    throw new Error('самопроверка: zip больше MAX_ZIP (' + zip.length + ' > ' + Update.MAX_ZIP + ')');
  }
  let files;
  try {
    files = Update.unpack(new Uint8Array(zip), fflate);
  } catch (e) {
    throw new Error('самопроверка: клиентский unpack отверг бандл: ' + (e && e.message ? e.message : e));
  }
  const missing = CORE_IN_BUNDLE.filter((n) => !files[n]);
  if (missing.length) {
    throw new Error('самопроверка: в бандле нет обязательных файлов: ' + missing.join(', '));
  }
  return { files: Object.keys(files).length, sha };
}

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// version.js — единственный источник номера версии на стороне приложения
function stampWeb(www, v) {
  fs.writeFileSync(path.join(www, 'version.js'),
    '/* version.js — единственный источник номера версии на стороне приложения.\n' +
    '   Файл ГЕНЕРИРУЕТСЯ сборкой (build-apk.js / build-ota.js берут version из\n' +
    '   package.json и переписывают эту строку; build-apk.js заодно синхронизирует\n' +
    '   versionName/versionCode в android/app/build.gradle). Руками не правь -\n' +
    '   правь package.json. В репозитории лежит собранным, чтобы версия была видна\n' +
    '   и в браузерном превью. */\n' +
    "window.APP_VERSION = '" + v + "';\n", 'utf8');
}

function readVersion(pkgPath) {
  const v = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(String(v || ''))) {
    throw new Error('version в package.json должна быть вида «0.2.0», а там: ' + JSON.stringify(v));
  }
  return String(v);
}

// «что нового» для канала обновления — верхний раздел CHANGELOG.md
function topNotes(changelog) {
  if (!fs.existsSync(changelog)) return '';
  const txt = fs.readFileSync(changelog, 'utf8');
  const m = txt.match(/^##\s+.*$/m);
  if (!m) return '';
  const rest = txt.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

// versionCode Android: base = major*10000 + minor*100 + patch, а сам код = base*2 + бит
// типа сборки (1 - релиз/стор, 0 - тест). Зачем: тест и релиз одной версии различаются
// только вшитыми флагами, и при одинаковом versionCode Capacitor не считал переустановку
// «новым бинарём» - сохранённый путь на старую OTA-папку оставался, грузился старый www
// (так пропал онбординг в 0.1.6). Теперь тест↔релиз - всегда разный код, а ряд стора
// монотонный: 0.1.6 → тест 212, релиз/стор 213; 0.1.7 → тест 214, стор 215.
function versionCodeOf(v, release) {
  const p = String(v).split('.').map(Number);
  const base = p[0] * 10000 + p[1] * 100 + p[2];
  return base * 2 + (release ? 1 : 0);
}

// ---------- console_app_id RuStore: одна команда вшивает id в ОБА места ----------
// Нативный Pay SDK читает id из android/app/src/main/res/values/strings.xml
// (rustore_console_app_id → meta-data console_app_id_value), JS - из www/pay-config.js
// (CONSOLE_APP_ID). Два места обязаны совпадать: иначе JS думает одно, SDK - другое.
// `node build-apk.js --store --app-id=2063760325` переписывает оба исходника одним кодом
// (stampAppIdFiles) и читает их обратно (readAppIdFiles): рассинхрон - сборка падает.
// Формат id - только цифры (RuStore Консоль: https://console.rustore.ru/apps/<ID>/versions).
const APP_ID_PLACEHOLDER = 'РАЗМЕСТИТЬ_APP_ID_ИЗ_RUSTORE_CONSOLE';
const APP_ID_RE = /^[0-9]{3,20}$/;

function validAppId(id) { return APP_ID_RE.test(String(id == null ? '' : id)); }

// --app-id=123 / --app-id 123 / env HOMYAK_APP_ID. null - аргумента нет; '' - пустой.
function parseAppIdArg(argv, env) {
  argv = argv || []; env = env || {};
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a.indexOf('--app-id=') === 0) return a.slice('--app-id='.length).trim();
    if (a === '--app-id') return String(argv[i + 1] == null ? '' : argv[i + 1]).trim();
  }
  if (env.HOMYAK_APP_ID != null) return String(env.HOMYAK_APP_ID).trim();
  return null;
}

const JS_ID_RE = /CONSOLE_APP_ID:\s*(PLACEHOLDER|'[^']*')/;
const XML_ID_RE = /(<string name="rustore_console_app_id">)([^<]*)(<\/string>)/;

function readAppIdJs(text) {
  const m = String(text).match(JS_ID_RE);
  if (!m) throw new Error('в pay-config.js не найдено поле CONSOLE_APP_ID');
  return m[1] === 'PLACEHOLDER' ? APP_ID_PLACEHOLDER : m[1].slice(1, -1);
}
function readAppIdXml(text) {
  const m = String(text).match(XML_ID_RE);
  if (!m) throw new Error('в strings.xml не найдена строка rustore_console_app_id');
  return m[2].trim();
}
function stampAppIdJs(text, id) {
  if (!JS_ID_RE.test(text)) throw new Error('в pay-config.js не найдено поле CONSOLE_APP_ID');
  return String(text).replace(JS_ID_RE, "CONSOLE_APP_ID: '" + id + "'");
}
function stampAppIdXml(text, id) {
  if (!XML_ID_RE.test(text)) throw new Error('в strings.xml не найдена строка rustore_console_app_id');
  return String(text).replace(XML_ID_RE, '$1' + id + '$3');
}

// Состояние id в двух текстах: {js, xml, synced, placeholder, id}. placeholder - в любом
// из мест стоит заглушка (или невалидное значение) → стор-сборка = КАНДИДАТ.
function appIdState(jsText, xmlText) {
  const js = readAppIdJs(jsText), xml = readAppIdXml(xmlText);
  const synced = js === xml;
  const placeholder = !validAppId(js) || !validAppId(xml);
  return { js: js, xml: xml, synced: synced, placeholder: placeholder, id: synced && !placeholder ? js : null };
}

// Вписать id в оба исходника (атомарно по смыслу: сначала проверка формата и что оба
// поля находятся, потом запись обоих) и вернуть прочитанное обратно состояние.
function stampAppIdFiles(payConfigPath, stringsXmlPath, id) {
  if (!validAppId(id)) {
    throw new Error('console_app_id должен состоять только из цифр (3-20 знаков), а передано: ' +
      JSON.stringify(id) + '. Взять из адреса https://console.rustore.ru/apps/<ID>/versions');
  }
  const js = stampAppIdJs(fs.readFileSync(payConfigPath, 'utf8'), id);
  const xml = stampAppIdXml(fs.readFileSync(stringsXmlPath, 'utf8'), id);
  fs.writeFileSync(payConfigPath, js, 'utf8');
  fs.writeFileSync(stringsXmlPath, xml, 'utf8');
  return readAppIdFiles(payConfigPath, stringsXmlPath);
}
function readAppIdFiles(payConfigPath, stringsXmlPath) {
  return appIdState(fs.readFileSync(payConfigPath, 'utf8'), fs.readFileSync(stringsXmlPath, 'utf8'));
}

// Режимы несовместимы: reel (промо, полный доступ) нельзя смешивать с релизом/стором -
// иначе reel-ветка flagsTag молча перекрыла бы релизные флаги.
function checkModeConflict(mode, reel) {
  if (reel && mode && (mode.release || mode.store)) {
    throw new Error('--reel нельзя совмещать с --release/--store: reel-сборка даёт полный доступ и только для съёмки');
  }
}

// Имена стор-выхода: кандидат (id не вписан) или финал. desktop - относительный путь от
// рабочего стола. Кандидат нельзя спутать с финалом: суффикс «-кандидат» и другая папка.
function storeOutNames(version, candidate) {
  return candidate
    ? { out: 'Homyak-store-кандидат.apk', desktop: 'Хомяк-' + version + '-RuStore-кандидат.apk' }
    : { out: 'Homyak-store.apk', desktop: path.join('Хомяк-RuStore-публикация', 'Хомяк-' + version + '.apk') };
}

// Самопроверка собранного APK (zip): что вшито - то и лежит в файле.
//   opts.appId - ожидаемый console_app_id (или заглушка), opts.store - стор-сборка.
// Проверяет: assets/public/pay-config.js несёт тот же id; resources.arsc (скомпилированный
// strings.xml) содержит тот же id; index.html несёт релизные (и стор-) флаги и НЕ несёт
// reel-флаг; отладочного selftest.js нет. Возвращает сводку, при нарушении - бросает.
function verifyApk(apkBuf, opts) {
  opts = opts || {};
  const { unzipSync } = require('fflate');
  const want = (name) => name === 'resources.arsc' || name.indexOf('assets/public/') === 0 || /\.so$/.test(name);
  const files = unzipSync(new Uint8Array(apkBuf), { filter: (f) => want(f.name) });
  const txt = (n) => {
    if (!files[n]) throw new Error('в APK нет ' + n);
    return Buffer.from(files[n]).toString('utf8');
  };
  const jsId = readAppIdJs(txt('assets/public/pay-config.js'));
  if (opts.appId != null && jsId !== String(opts.appId)) {
    throw new Error('в APK pay-config.js id ' + JSON.stringify(jsId) + ', а ожидался ' + JSON.stringify(opts.appId));
  }
  const arsc = Buffer.from(files['resources.arsc'] || []);
  if (!arsc.length) throw new Error('в APK нет resources.arsc');
  let arscEnc = null;
  if (arsc.indexOf(Buffer.from(jsId, 'utf8')) >= 0) arscEnc = 'utf8';
  else if (arsc.indexOf(Buffer.from(jsId, 'utf16le')) >= 0) arscEnc = 'utf16le';
  if (!arscEnc) throw new Error('в resources.arsc (strings.xml) нет id ' + JSON.stringify(jsId) + ' - JS и нативный SDK разъехались');
  const idx = txt('assets/public/index.html');
  if (idx.indexOf('window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;') < 0) {
    throw new Error('в index.html APK нет релизных флагов (FULL_ACCESS/DEMO=false)');
  }
  if (opts.store && idx.indexOf('window.HOMYAK_STORE=true;') < 0) throw new Error('в index.html APK нет HOMYAK_STORE=true');
  if (idx.indexOf('HOMYAK_REEL') >= 0) throw new Error('в index.html релизного APK есть reel-флаг');
  if (files['assets/public/selftest.js']) throw new Error('в APK уехал отладочный selftest.js');
  const so = Object.keys(files).filter((n) => /\.so$/.test(n));
  return { jsId: jsId, arscEnc: arscEnc, so: so.length, soList: so };
}

module.exports = {
  DEV_ONLY, FLAG_MARKER, rmrf, copyClean, listFiles, makeShip, flagsTag, buildMode,
  versionCodeOf, writeFilesJson, zipShip, selfCheckZip, sha256hex, stampWeb, readVersion, topNotes,
  OTA_MTIME, CORE_IN_BUNDLE,
  APP_ID_PLACEHOLDER, validAppId, parseAppIdArg, readAppIdJs, readAppIdXml, stampAppIdJs, stampAppIdXml,
  appIdState, stampAppIdFiles, readAppIdFiles, checkModeConflict, storeOutNames, verifyApk
};
