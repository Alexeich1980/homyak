#!/usr/bin/env node
/**
 * Сборка APK «Хомяк».
 *
 *   node build-apk.js             тест-сборка: демо-данные + полный доступ → out/test/
 *   node build-apk.js --release   релиз: чистый пресет, гейт, OTA как обычно → out/store/
 *   node build-apk.js --store     стор: релиз + обновления только через RuStore → out/store/
 *   node build-apk.js --store --app-id=2063760325
 *                                 стор с боевым console_app_id RuStore: id вписывается ОДНОЙ
 *                                 командой в оба места (www/pay-config.js и strings.xml).
 *                                 Без id (заглушка) стор-сборка = КАНДИДАТ: собирается, но
 *                                 кладётся с суффиксом «-кандидат» и громким предупреждением.
 *   (то же через env: HOMYAK_RELEASE=1 / HOMYAK_STORE=1; store подразумевает release)
 *
 * Что делает:
 *   1. проверяет JAVA_HOME и ANDROID_HOME (+ что SDK реально доустановлен);
 *   1б. разносит version из package.json: в www/version.js и в versionName/versionCode
 *      android/app/build.gradle - номер версии живёт в ОДНОМ месте;
 *   2. собирает чистую копию www/ БЕЗ отладочных файлов и переносит её в Android-проект
 *      (npx cap sync android). Сами selftest.js/icons.html/preview.html из www/ никуда
 *      не деваются - это рабочие инструменты QA, они просто не едут в APK;
 *   3. android\gradlew.bat assembleRelease с ключом из keys/ (если ключа нет -
 *      откат на assembleDebug с громким предупреждением);
 *   4. копирует готовый APK в out/<test|store>/homyak-<версия>.apk (и Homyak.apk /
 *      Homyak-store.apk туда же и на рабочий стол), кладёт рядом веб-архив
 *      www-<версия>.zip (та же чистая копия www, из которой собран APK) и пишет
 *      update.json - манифест канала обновления с ДВУМЯ разделами: apk (переустановка)
 *      и web (бесшовное обновление). publish-update.py читает только out/store/.
 *
 * Любая осечка - понятное сообщение по-русски и код возврата 1.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const L = require('./build-lib');

const ROOT = __dirname;
const ANDROID = path.join(ROOT, 'android');

// Режим сборки: тест / релиз / стор (env или аргумент). Выходы разнесены по папкам,
// чтобы тест-сборка физически не могла попасть в publish-update.py (он читает
// только out/store/).
const MODE = L.buildMode(process.env, process.argv.slice(2));
// reel-сборка для промо-скринкастов: полный доступ + reel-персоны + скрытый
// переключатель. Определяем отдельным флагом (не через buildMode, чтобы не менять его
// сигнатуру и тесты). reel НЕ релиз: выход в out/reel/, publish-update.py его не видит.
const on = (v) => !!v && v !== '0' && v !== 'false' && v !== '';
const REEL = process.argv.slice(2).indexOf('--reel') >= 0 || on(process.env.HOMYAK_REEL);
try { L.checkModeConflict(MODE, REEL); } catch (e) { die(e.message); }
try { L.checkDistribution(MODE); } catch (e) { die(e.message); }

// --- console_app_id RuStore: одно значение в двух местах -------------------------------
const PAY_CONFIG = path.join(ROOT, 'www', 'pay-config.js');
const STRINGS_XML = path.join(ANDROID, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const APP_ID_ARG = L.parseAppIdArg(process.argv.slice(2), process.env);
let APP_ID;
try {
  if (APP_ID_ARG !== null) {
    if (!MODE.release) die('--app-id имеет смысл только для --store (или --release): в тест-сборке оплата - заглушка.');
    APP_ID = L.stampAppIdFiles(PAY_CONFIG, STRINGS_XML, APP_ID_ARG);
  } else {
    APP_ID = L.readAppIdFiles(PAY_CONFIG, STRINGS_XML);
  }
} catch (e) { die(e.message); }
if (!APP_ID.synced) {
  die('console_app_id разъехался: www/pay-config.js = ' + JSON.stringify(APP_ID.js) +
      ', strings.xml = ' + JSON.stringify(APP_ID.xml) + '.\nВпиши один id в оба места: node build-apk.js --store --app-id=<ID>');
}
// стор без боевого id - КАНДИДАТ: оплата на устройстве ответит «не сконфигурировано»
const CANDIDATE = MODE.store && !REEL && APP_ID.placeholder;
const DESKTOP_ROOT = path.join(os.homedir(), 'OneDrive', 'Рабочий стол');

const OUT_DIR = path.join(ROOT, 'out', REEL ? 'reel' : (MODE.release ? 'store' : 'test'));
let OUT_APK = path.join(OUT_DIR, REEL ? 'Homyak-reel.apk' : (MODE.store ? 'Homyak-store.apk' : 'Homyak.apk'));
let DESKTOP_APK = path.join(DESKTOP_ROOT,
  REEL ? 'Homyak-reel.apk' : (MODE.store ? 'Homyak-store.apk' : 'Homyak.apk'));

function candidateBanner() {
  console.warn(
    '\n##########################################################################\n' +
    '###  КАНДИДАТ: оплата НЕ сконфигурирована, не отправлять на модерацию  ###\n' +
    '###  console_app_id - заглушка. Финал: node build-apk.js --store --app-id=<ID>\n' +
    '##########################################################################\n');
}
// Базовая версия ОБОЛОЧКИ клиентов: minShell веб-обновления держим на ней, иначе клиенты
// на старой оболочке не получают бесшовное обновление (уходят на скачивание APK).
// Поднимать только когда реально выпущена новая нативная оболочка и она уже у клиентов.
const MIN_SHELL = '0.1.0';
const WWW = path.join(ROOT, 'www');
const WWW_SHIP = path.join(ROOT, 'build', 'www-ship');   // чистая копия под APK
const KEYS = path.join(ROOT, 'keys');
const KEY_PROPS = path.join(KEYS, 'homyak.properties');
const KEY_STORE = path.join(KEYS, 'homyak.jks');
const CAP_CFG = path.join(ROOT, 'capacitor.config.json');
const PKG = path.join(ROOT, 'package.json');
const GRADLE = path.join(ANDROID, 'app', 'build.gradle');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const UPDATE_JSON = path.join(OUT_DIR, 'update.json');
const LAST_APK = path.join(OUT_DIR, 'last-apk.json');
const UPDATE_BASE = 'https://dorokhin-finance.ru/homyak-store/';

// Список отладочных файлов, чистая копия www, опись files.json и zip - в build-lib.js:
// тем же кодом пользуется build-ota.js, иначе архив и APK разъехались бы по составу.
const DEV_ONLY = L.DEV_ONLY;

function die(msg) {
  console.error('\n[ОШИБКА] ' + msg + '\n');
  process.exit(1);
}

function say(msg) {
  console.log(msg);
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' МБ';
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: true }, opts || {}));
  if (r.error) return { ok: false, why: r.error.message };
  if (r.status !== 0) return { ok: false, why: 'код возврата ' + r.status };
  return { ok: true };
}

// --- 0. гейт: самопроверка www/selftest.js -----------------------------------
// Self-test живёт в браузере и раньше гонялся руками: сборка 1.0.1 прошла с красным
// пунктом (19г) - его никто не запустил (найдено 01.10.2026). Теперь любой режим сборки
// сначала гоняет self-test в headless Edge (экран телефона 375x812) и падает при любом
// FAIL - ДО версии, cap sync и Gradle. Обхода нет намеренно.
say('[0/3] Самопроверка (self-test в headless Edge)...');
{
  const gate = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'run-selftest.js')], { cwd: ROOT, stdio: 'inherit' });
  if (gate.error || gate.status !== 0) {
    die('self-test красный (' + (gate.error ? gate.error.message : 'код ' + gate.status) + ') - сборка остановлена до Gradle.\n' +
        'Посмотреть руками: node serve.js и http://localhost:8793/?demo&selftest (окно телефона 375x812).');
  }
}

// --- 1. окружение -----------------------------------------------------------

const javaHome = process.env.JAVA_HOME;
if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin', 'java.exe'))) {
  die(
    'не найдена Java (JAVA_HOME).\n' +
    'JDK 17 должен лежать в %LOCALAPPDATA%\\Java\\jdk-17.* , а переменная - указывать на него:\n' +
    '  setx JAVA_HOME %LOCALAPPDATA%\\Java\\jdk-17.0.20.1+1\n' +
    'Если JDK нет вообще - скачай zip https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip\n' +
    'и распакуй в %LOCALAPPDATA%\\Java.\n' +
    'После setx открой новое окно терминала - переменная подхватится только там.'
  );
}

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !fs.existsSync(sdk)) {
  die(
    'не найден Android SDK (ANDROID_HOME).\n' +
    'Распакуй command-line tools в %LOCALAPPDATA%\\Android\\Sdk\\cmdline-tools\\latest и пропиши:\n' +
    '  setx ANDROID_HOME %LOCALAPPDATA%\\Android\\Sdk'
  );
}

const hasPlatform = fs.existsSync(path.join(sdk, 'platforms', 'android-34'));
const hasBuildTools = fs.existsSync(path.join(sdk, 'build-tools'));
const hasLicenses = fs.existsSync(path.join(sdk, 'licenses'));
if (!hasPlatform || !hasBuildTools || !hasLicenses) {
  die(
    'Android SDK стоит не полностью - не хватает компонентов (или не приняты лицензии Google).\n' +
    'Это делается один раз, вручную, потому что там надо согласиться с лицензиями:\n\n' +
    '  cd %LOCALAPPDATA%\\Android\\Sdk\\cmdline-tools\\latest\\bin\n' +
    '  sdkmanager --licenses\n' +
    '  sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"\n\n' +
    'Проверил: платформа android-34 - ' + (hasPlatform ? 'есть' : 'НЕТ') +
    ', build-tools - ' + (hasBuildTools ? 'есть' : 'НЕТ') +
    ', лицензии - ' + (hasLicenses ? 'приняты' : 'НЕ приняты') + '.\n' +
    'После установки запусти сборку снова: node build-apk.js'
  );
}

if (!fs.existsSync(ANDROID)) {
  die('нет папки android/. Сначала выполни: npx cap add android');
}

say('Java:        ' + javaHome);
say('Android SDK: ' + sdk);

if (REEL) {
  say('Режим:       REEL (промо-скринкасты: полный доступ + reel-персоны) → out/reel/');
} else if (MODE.store) {
  say('Режим:       СТОР (релиз + обновления только через RuStore) → out/store/');
} else if (MODE.release) {
  say('Режим:       РЕЛИЗ (чистый пресет, гейт, OTA-обновления) → out/store/');
} else {
  console.warn(
    '\n=== ТЕСТ-СБОРКА: демо-данные + полный доступ. НЕ отдавать клиентам и не публиковать ===\n' +
    '=== Релиз: node build-apk.js --release   Стор: node build-apk.js --store           ===\n'
  );
}

// --- 1б. версия: один источник — package.json ------------------------------
// Раньше номер жил в трёх местах (окно «О приложении», versionName, versionCode) и
// разъезжался. Теперь version из package.json растекается отсюда: в www/version.js
// (его читает приложение) и в android/app/build.gradle (его читает Android).

function readVersion() {
  try { return L.readVersion(PKG); } catch (e) { die(e.message); }
}

// versionCode Android: (major*10000 + minor*100 + patch)*2 + бит типа сборки
// (1 - релиз/стор, 0 - тест). Тест и релиз одной версии - разный код, стор растёт
// монотонно. Подробно - в build-lib.js versionCodeOf и в RELEASE.md.
function versionCodeOf(v) {
  return L.versionCodeOf(v, MODE.release);
}

function stampVersion(v) {
  const code = versionCodeOf(v);

  L.stampWeb(WWW, v);

  let g = fs.readFileSync(GRADLE, 'utf8');
  const before = g;
  g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code)
       .replace(/versionName\s+"[^"]*"/, 'versionName "' + v + '"');
  if (g.indexOf('versionName "' + v + '"') < 0) {   // уже актуально - не ошибка
    die('не нашёл versionCode/versionName в ' + GRADLE + ' - правь build-apk.js');
  }
  fs.writeFileSync(GRADLE, g, 'utf8');

  say('Версия:      ' + v + ' (versionCode ' + code + ')');
  return { version: v, code: code };
}

// «что нового» для канала обновления — верхний раздел CHANGELOG.md
function topNotes() { return L.topNotes(CHANGELOG); }

const VER = stampVersion(readVersion());
const APK_NAME = 'homyak-' + VER.version + (CANDIDATE ? '-кандидат' : '') + '.apk';
const OUT_APK_VER = path.join(OUT_DIR, APK_NAME);
if (MODE.store && !REEL) {
  const names = L.storeOutNames(VER.version, CANDIDATE);
  OUT_APK = path.join(OUT_DIR, names.out);
  DESKTOP_APK = path.join(DESKTOP_ROOT, names.desktop);
}
if (MODE.release) {
  say('console_app_id: ' + (APP_ID.placeholder ? 'ЗАГЛУШКА (оплата не сконфигурирована)' : APP_ID.id) +
      ' - одинаков в pay-config.js и strings.xml');
}
if (CANDIDATE) candidateBanner();

// --- 2. cap sync ------------------------------------------------------------

say('\n[1/3] Готовлю чистую копию www/ и переношу её в Android-проект (cap sync)...');

// чистая копия www без отладочных файлов и без тега selftest.js — общая с build-ota.js.
// Релизные флаги (демо и полный доступ выкл; при сторе ещё HOMYAK_STORE) вшивает
// makeShip по MODE - одним кодом для APK и веб-архива; нет маркера - сборка падает.
try { L.makeShip(WWW, WWW_SHIP, Object.assign({}, MODE, { reel: REEL })); } catch (e) { die(e.message); }
if (REEL) {
  say('  REEL: полный доступ (без гейта), reel-персоны, ключ хранилища homyak-reel');
} else if (MODE.release) {
  say('  РЕЛИЗ: демо и полный доступ выключены (пресет + гейт)' +
      (MODE.store ? '; СТОР: обновления только через RuStore' : ''));
}

// Опись сборки. По ней приложение на первом запуске делает заводскую копию www в
// личной папке телефона: копия — это то, куда откатывается boot.js, если приехавшее
// бесшовное обновление не завелось. Пишется и в чистую копию (едет в APK), и в www/.
const SHIP_FILES = L.writeFilesJson(WWW_SHIP, WWW, VER.version);

say('  в APK не едут: ' + DEV_ONLY.join(', '));
say('  files.json: ' + SHIP_FILES.length + ' файлов');

// cap sync берёт папку из webDir конфига: на время сборки подменяем её на чистую копию
// и возвращаем как было в любом случае, даже если Gradle упадёт
const cfgBackup = fs.readFileSync(CAP_CFG, 'utf8');
let restored = false;
function restoreCfg() {
  if (restored) return;
  restored = true;
  try { fs.writeFileSync(CAP_CFG, cfgBackup); } catch (e) { /* ничего не поделать */ }
}
process.on('exit', restoreCfg);
process.on('SIGINT', () => { restoreCfg(); process.exit(1); });

const cfg = JSON.parse(cfgBackup);
cfg.webDir = 'build/www-ship';
fs.writeFileSync(CAP_CFG, JSON.stringify(cfg, null, 2) + '\n');

let r = run('npx', ['cap', 'sync', 'android'], { cwd: ROOT });
restoreCfg();
if (!r.ok) die('не прошёл "npx cap sync android" (' + r.why + ').');

// --- 3. gradle --------------------------------------------------------------

// Релизная подпись своим ключом. На debug-ключе APK получается отлаживаемым (любой
// подключённый по USB компьютер читает базу целиком), а сам ключ общеизвестен и
// протухает - после этого обновление поверх невозможно, только удаление с потерей данных.
const hasKey = fs.existsSync(KEY_PROPS) && fs.existsSync(KEY_STORE);
const task = hasKey ? 'assembleRelease' : 'assembleDebug';
const APK_SRC = hasKey
  ? path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

if (hasKey) {
  say('\nПодпись: свой ключ keys/homyak.jks (релизная сборка).');
} else {
  console.warn(
    '\n!!! ВНИМАНИЕ: ключа подписи нет (' + KEY_PROPS + ').\n' +
    '!!! Собираю ОТЛАДОЧНЫЙ APK на общеизвестном debug-ключе.\n' +
    '!!! Такой APK читается с компа по USB целиком, и обновить его поверх релизным\n' +
    '!!! потом не выйдет - только удаление приложения вместе со всеми данными.\n' +
    '!!! Восстанови keys/ из своей копии, см. keys/README.txt.\n'
  );
}

say('\n[2/3] Собираю APK (gradlew ' + task + '). Первый раз это долго - Gradle качает себя и зависимости...');
// относительное имя: cwd уже android/, абсолютный путь с пробелами/кириллицей под shell:true ненадёжен
// -PhomyakStore=true → ресурс bool/homyak_store: стор-оболочка на старте забывает путь к
// скачанной веб-сборке и всегда грузит встроенную (MainActivity) - заслон от самоподмены кода.
const gradleArgs = [task, '-PhomyakStore=' + (MODE.store && !REEL ? 'true' : 'false')];
r = run('"' + path.join(ANDROID, 'gradlew.bat') + '"', gradleArgs, { cwd: ANDROID });   // полный путь: cmd не ищет .bat в cwd на кириллических путях
if (!r.ok) die('сборка Gradle упала (' + r.why + '). Смотри текст ошибки выше.');

if (!fs.existsSync(APK_SRC)) {
  die('Gradle отработал, но APK не найден: ' + APK_SRC);
}

// --- 3б. самопроверка APK: что вшито, то и лежит в файле -------------------------------
// Читаем собранный APK как zip: www/pay-config.js из ассетов и resources.arsc (strings.xml).
// id должен совпасть в обоих местах с тем, что вписано в исходники; стор-флаги на месте,
// reel-флага в релизе/сторе нет. Не сошлось - сборка падает, файл не раскладывается.
if (MODE.release && !REEL) {
  try {
    const chk = L.verifyApk(fs.readFileSync(APK_SRC), { appId: APP_ID.js, store: MODE.store });
    say('Самопроверка APK: pay-config.js = ' + chk.jsId + ', resources.arsc содержит его же (' + chk.arscEnc +
        '); флаги ' + (MODE.store ? 'стора' : 'релиза') + ' на месте, reel нет, ' + chk.so + ' нативных .so.');
  } catch (e) { die('самопроверка APK не прошла: ' + e.message); }
}

// --- 4. копии ---------------------------------------------------------------

say('\n[3/3] Раскладываю готовый файл...');
fs.mkdirSync(OUT_DIR, { recursive: true });
// в out/<режим>/ файл лежит с версией в имени — ровно под тем же именем он уедет на
// канал обновления; на рабочий стол копия - Homyak.apk (тест/релиз) или
// Homyak-store.apk (стор), ровно то, что сейчас собрали
fs.copyFileSync(APK_SRC, OUT_APK_VER);
fs.copyFileSync(APK_SRC, OUT_APK);

// копия на рабочий стол — по просьбе Алексея
let desktopOk = true;
try {
  fs.mkdirSync(path.dirname(DESKTOP_APK), { recursive: true });
  fs.copyFileSync(APK_SRC, DESKTOP_APK);
  if (MODE.store && !REEL) {
    // чтобы не перепутать: старое общее имя стор-сборки и (для финала) кандидат со стола убираем
    const stale = [path.join(DESKTOP_ROOT, 'Homyak-store.apk')];
    if (!CANDIDATE) {
      stale.push(path.join(DESKTOP_ROOT, L.storeOutNames(VER.version, true).desktop));
      stale.push(path.join(OUT_DIR, L.storeOutNames(VER.version, true).out));
      stale.push(path.join(OUT_DIR, 'homyak-' + VER.version + '-кандидат.apk'));
    }
    stale.filter((f) => f !== DESKTOP_APK && f !== OUT_APK && fs.existsSync(f))
      .forEach((f) => { try { fs.unlinkSync(f); say('  убрал устаревшее: ' + f); } catch (e2) { /* не мешает */ } });
  }
} catch (e) {
  desktopOk = false;
  console.warn('  ! не смог положить копию на рабочий стол: ' + e.message);
}

const size = fs.statSync(OUT_APK_VER).size;

// --- 5. веб-архив: то же самое www, но для бесшовного обновления ---------------
// Тот же WWW_SHIP, из которого собран APK: в архиве и в оболочке лежит один и тот же
// набор файлов, разъехаться им негде.
const zipBuf = L.zipShip(WWW_SHIP);
const ZIP_NAME = 'www-' + VER.version + '.zip';
fs.writeFileSync(path.join(OUT_DIR, ZIP_NAME), zipBuf);
const zipSha = L.sha256hex(zipBuf);

// манифест канала обновления. Публикуется отдельно и вручную:
//   python publish-update.py
// Верхние поля - как были: их читает уже установленная 0.2.2, которая про «web»
// ничего не знает. Раздел web - бесшовное обновление; minShell - минимальная версия
// оболочки, на которой эта веб-сборка вообще заведётся.
fs.writeFileSync(UPDATE_JSON, JSON.stringify({
  // build: тип сборки; publish-update.py публикует только 'release' | 'store'.
  // Приложение это поле не читает (parseManifest берёт только известные поля).
  build: MODE.store ? 'store' : (MODE.release ? 'release' : 'test'),
  version: VER.version,
  apkUrl: UPDATE_BASE + APK_NAME,
  size: size,
  notes: topNotes(),
  web: {
    version: VER.version,
    url: UPDATE_BASE + ZIP_NAME,
    sha256: zipSha,
    size: zipBuf.length,
    minShell: MIN_SHELL
  }
}, null, 2) + '\n', 'utf8');

// След последней сборки оболочки: из него build-ota.js берёт apk-поля манифеста,
// когда выкладывает одну веб-сборку без пересборки APK.
fs.writeFileSync(LAST_APK, JSON.stringify({
  version: VER.version,
  apkName: APK_NAME,
  apkUrl: UPDATE_BASE + APK_NAME,
  size: size,
  built: new Date().toISOString()
}, null, 2) + '\n', 'utf8');

say('\nГотово. APK ' + mb(size));
say('  ' + OUT_APK_VER);
say('  ' + OUT_APK);
if (desktopOk) say('  ' + DESKTOP_APK);
say('  ' + path.join(OUT_DIR, ZIP_NAME) + '  (веб-архив ' + mb(zipBuf.length) + ', sha256 ' + zipSha.slice(0, 12) + '…)');
say('  ' + UPDATE_JSON + '  (манифест обновления: apk + web)');
if (REEL) {
  console.warn('\n=== REEL-СБОРКА для промо-скринкастов: полный доступ + reel-персоны. НЕ отдавать клиентам и не публиковать ===');
  say('Переключатель персон: long-press по шапке приложения → лист «Демо-ролик».');
  say('publish-update.py папку out/reel/ не видит - опубликовать её случайно нельзя.');
} else if (MODE.release) {
  if (CANDIDATE) candidateBanner();
  say('\nДальше: ' + (MODE.store
    ? 'APK со стола - в Консоль RuStore. Прямой раздачи нет: только через RuStore.'
    : 'перешли файл клиенту, открыть на телефоне, «Установить».'));
  say('После одобрения и публикации в RuStore: python publish-update.py <версия> (только номер версии на канал)');
} else {
  console.warn('\n=== ТЕСТ-СБОРКА: демо-данные + полный доступ. НЕ отдавать клиентам и не публиковать ===');
  say('publish-update.py папку out/test/ не видит - опубликовать её случайно нельзя.');
}

// --- уборка out/: последние 3 версии APK/zip, остальное - прочь ---------------------
// Только здесь, в самом конце успешной сборки: при любой осечке выше die() уже вышел.
// Алиасы без версии, манифесты и всё, на что они ссылаются (published.json = опубликованное
// на канале), не трогаются (build-lib.js).
try {
  const gone = L.pruneOldVersions(OUT_DIR, 3);
  say('Уборка ' + path.relative(ROOT, OUT_DIR).split(path.sep).join('/') + '/: ' + (gone.length ? 'удалены старые версии - ' + gone.join(', ') : 'старше последних 3 версий ничего нет'));
} catch (e) {
  // e.removed - что уборка успела удалить до осечки: «пропущена» при удалённых файлах врёт
  console.warn('  ! уборка старых версий ' + (e.removed && e.removed.length
    ? 'прервана, уже удалены: ' + e.removed.join(', ') + '. Причина: ' : 'пропущена, ничего не удалено: ') + e.message);
}
