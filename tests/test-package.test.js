/* test-package.test.js - тест-сборка - отдельное приложение (12.10.2026).
   RuStore «обновлял» тестовую сборку до магазинной (одно и то же applicationId), и тест потом
   не ставился поверх. Теперь: стор/релиз - ru.dorokhin.homyak (как в RuStore), тест (и reel) -
   ru.dorokhin.homyak.test «Хомяк тест», рядом с магазинной. Всё, что зависит от имени пакета,
   берёт его из сборки: FileProvider, схема возврата из оплаты, приёмник напоминаний. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fflate = require('fflate');
const L = require('../build-lib.js');

const ROOT = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const J = 'android/app/src/main/java/ru/dorokhin/budgetphone/';
const fakeApk = (pkgs) => Buffer.from(fflate.zipSync({ 'AndroidManifest.xml': Buffer.concat(pkgs.map((p) => Buffer.from('\0\0' + p + '\0', 'utf16le'))) }));

test('пакет: стор и релиз - ru.dorokhin.homyak, тест и reel - ru.dorokhin.homyak.test', () => {
  assert.strictEqual(L.expectedPackage(L.buildMode({}, [])), 'ru.dorokhin.homyak.test');
  assert.strictEqual(L.expectedPackage(L.buildMode({}, ['--reel'])), 'ru.dorokhin.homyak.test');
  assert.strictEqual(L.expectedPackage(L.buildMode({}, ['--store'])), 'ru.dorokhin.homyak');
  assert.strictEqual(L.expectedPackage(L.buildMode({}, ['--release'])), 'ru.dorokhin.homyak');
  assert.strictEqual(L.expectedPackage(L.buildMode({ HOMYAK_STORE: '1' }, [])), 'ru.dorokhin.homyak');
});

test('пакет: заслон сборки читает имя пакета из манифеста APK и роняет сборку при чужом', () => {
  const store = fakeApk(['ru.dorokhin.homyak', 'android']), tst = fakeApk(['ru.dorokhin.homyak.test', 'android']);
  assert.strictEqual(L.apkPackageCheck(store, 'ru.dorokhin.homyak'), 'ru.dorokhin.homyak');
  assert.strictEqual(L.apkPackageCheck(tst, 'ru.dorokhin.homyak.test'), 'ru.dorokhin.homyak.test');
  assert.throws(() => L.apkPackageCheck(tst, 'ru.dorokhin.homyak'), /пакет APK ru\.dorokhin\.homyak\.test, а нужен ru\.dorokhin\.homyak/);
  assert.throws(() => L.apkPackageCheck(store, 'ru.dorokhin.homyak.test'), /а нужен ru\.dorokhin\.homyak\.test/);
  assert.throws(() => L.apkPackageOf(fakeApk(['com.other'])), /нет ни/);
  // сборка зовёт заслон для КАЖДОЙ сборки (не только релиза) и передаёт Gradle признак теста
  const b = rd('build-apk.js');
  assert.match(b, /'-PhomyakTest=' \+ \(L\.isTestBuild\(MODE\) \? 'true' : 'false'\)/);
  const at = b.indexOf('L.apkPackageCheck(fs.readFileSync(APK_SRC), L.expectedPackage(MODE))');
  assert.ok(at > 0 && at < b.indexOf('if (MODE.release && !REEL) {', b.indexOf('gradleArgs')), 'заслон пакета не перед раскладкой');
});

test('пакет: Gradle - суффикс .test и «Хомяк тест» только в тест-сборке; зависимое от пакета - из сборки', () => {
  const g = rd('android/app/build.gradle');
  assert.match(g, /applicationId "ru\.dorokhin\.homyak"\n/);
  assert.match(g, /def homyakTest = project\.findProperty\('homyakTest'\) == 'true'/);
  assert.match(g, /if \(homyakTest\) applicationIdSuffix "\.test"/);
  assert.match(g, /appLabel : homyakTest \? 'Хомяк тест' : '@string\/app_name'/);
  assert.match(g, /payScheme: homyakTest \? 'ru\.dorokhin\.homyak\.test\.rustore' : 'ru\.dorokhin\.homyak\.rustore'/);
  const m = rd('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  assert.strictEqual((m.match(/android:label="\$\{appLabel\}"/g) || []).length, 2, 'название приложения и активности - из сборки');
  assert.ok(m.indexOf('ru.dorokhin.homyak') < 0, 'в манифесте зашито имя пакета: ' + (m.match(/ru\.dorokhin\.homyak[\w.]*/g) || []).join(' '));
  assert.match(m, /<data android:scheme="\$\{payScheme\}" \/>/);
  assert.match(m, /android:name="sdk_pay_scheme_value"\s+android:value="\$\{payScheme\}"/);
  assert.match(m, /android:authorities="\$\{applicationId\}\.fileprovider"/);
  assert.match(rd(J + 'ShareFilePlugin.java'), /getContext\(\)\.getPackageName\(\) \+ "\.fileprovider"/);
  const pay = rd(J + 'RuStorePayPlugin.java');
  assert.ok(pay.indexOf('"ru.dorokhin.homyak.rustore"') < 0, 'схема оплаты зашита строкой');
  assert.match(pay, /return c\.getPackageName\(\) \+ "\.rustore";/);
  // напоминания: приёмник - явным классом своего пакета, уведомление открывает своё приложение
  const recv = rd(J + 'ReminderReceiver.java');
  assert.match(recv, /new Intent\(ctx, ReminderReceiver\.class\)/);
  assert.match(recv, /getLaunchIntentForPackage\(ctx\.getPackageName\(\)\)/);
});

test('пакет: собранные APK (если есть) - тест в out/test, стор в out/store', () => {
  const t = path.join(ROOT, 'out', 'test', 'Homyak.apk'), s = path.join(ROOT, 'out', 'store', 'Homyak-store.apk');
  const g = rd('android/app/build.gradle');
  if (fs.existsSync(t) && fs.statSync(t).mtimeMs > fs.statSync(path.join(ROOT, 'tests', 'test-package.test.js')).mtimeMs && /homyakTest/.test(g)) {
    assert.strictEqual(L.apkPackageOf(fs.readFileSync(t)), 'ru.dorokhin.homyak.test');
  }
  if (fs.existsSync(s)) assert.strictEqual(L.apkPackageOf(fs.readFileSync(s)), 'ru.dorokhin.homyak');
});
