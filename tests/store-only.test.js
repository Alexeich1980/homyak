/* store-only.test.js — заслоны решения 27.09.2026: платный «Хомяк» у людей только из RuStore.
   Прямой раздачи (--release без --store) и веб-обновлений с канала нет; канал публикует
   только номер версии для стор-приложения. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('../build-lib.js');
const U = require('../www/update.js');

const ROOT = path.join(__dirname, '..');

test('checkDistribution: релиз «напрямую» запрещён, стор и тест-сборка разрешены', () => {
  assert.throws(() => L.checkDistribution({ release: true, store: false }), /Прямой раздачи нет/);
  assert.doesNotThrow(() => L.checkDistribution({ release: true, store: true }));
  assert.doesNotThrow(() => L.checkDistribution({ release: false, store: false }));
});

test('build-apk.js зовёт checkDistribution до сборки (раньше Gradle)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-apk.js'), 'utf8');
  const at = src.indexOf('L.checkDistribution(MODE)');
  assert.ok(at > 0, 'нет вызова L.checkDistribution(MODE)');
  assert.ok(at < src.indexOf("[2/3] Собираю APK"), 'заслон стоит после запуска Gradle');
});

['--release', '--store'].forEach((flag) => {
  test('build-ota.js ' + flag + ': отказывается, веб-обновлений нет', { skip: !fs.existsSync(path.join(ROOT, 'build-ota.js')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'build-ota.js'), flag], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'build-ota.js отработал - веб-архив снова собирается');
    assert.match(r.stderr, /Веб-обновлений нет/);
  });
});

test('publish-update.py: только стор, только update.json, без zip/APK', { skip: !fs.existsSync(path.join(ROOT, 'publish-update.py')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const src = fs.readFileSync(path.join(ROOT, 'publish-update.py'), 'utf8');
  assert.match(src, /if manifest\.get\("build"\) != "store":/);
  assert.equal(src.split('put_object(').length, 2, 'должна быть ровно одна заливка (манифест)');
  assert.match(src, /Key=PREFIX \+ "update\.json"/);
  assert.ok(src.indexOf('manifest.pop("web", None)') < src.indexOf('put_object('), 'web убирается после заливки');
  assert.ok(!/application\/zip|vnd\.android\.package-archive/.test(src), 'в скрипте осталась заливка zip/APK');
});

// Манифест, каким его зальёт publish-update.py (без web): его читают установленные 1.0.2
// и старше (с 1.0.3 стор-приложение спрашивает RuStore само, tests/update-sdk.test.js).
test('манифест стор-сборки: только номер версии, без web - старые клиенты его разбирают', () => {
  const m = L.channelManifest({ mode: { release: true, store: true }, version: '1.0.3', size: 1,
    apkUrl: 'https://www.dorokhin-finance.ru/homyak-store/homyak-1.0.3.apk', notes: 'x',
    web: { url: 'https://www.dorokhin-finance.ru/homyak-store/www-1.0.3.zip', sha256: 'a'.repeat(64), size: 5, minShell: '0.1.0' } });
  assert.equal(m.build, 'store');
  assert.equal(m.web, undefined, 'в стор-манифесте остался раздел web');
  const parsed = U.parseManifest(m);
  assert.ok(parsed, 'манифест без web не разобрался кодом клиента');
  assert.equal(parsed.web, null);
  assert.equal(parsed.version, '1.0.3');
  // тест-сборка - как раньше, с web
  const t = L.channelManifest({ mode: {}, version: '1.0.3', size: 1, apkUrl: m.apkUrl, notes: '',
    web: { url: 'https://www.dorokhin-finance.ru/homyak-store/www-1.0.3.zip', sha256: 'a'.repeat(64), size: 5, minShell: '0.1.0' } });
  assert.equal(t.build, 'test');
  assert.equal(t.web.version, '1.0.3');
  assert.equal(L.shipsWebZip({ release: true, store: true }), false);
  assert.equal(L.shipsWebZip({}), true);
});

test('build-apk.js: веб-архив и раздел web только через shipsWebZip/channelManifest (стор без zip)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-apk.js'), 'utf8');
  assert.match(src, /if \(L\.shipsWebZip\(MODE\)\) \{\s*zipBuf = L\.zipShip\(WWW_SHIP\);/);
  assert.match(src, /L\.channelManifest\(\{/);
  assert.equal(src.split('L.zipShip(').length, 2, 'zipShip зовётся ещё где-то мимо shipsWebZip');
});

test('build-ota.js - заглушка: только отказ, без кода сборки', { skip: !fs.existsSync(path.join(ROOT, 'build-ota.js')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-ota.js'), 'utf8');
  assert.ok(!/require\(|zipShip|makeShip|writeFileSync|UPDATE_JSON/.test(src), 'в заглушке остался код сборки');
  assert.match(src, /process\.exit\(1\)/);
});

// 05.10.2026: CDN сайта не отдавал Access-Control-Allow-Origin, и проверка обновлений в
// приложении писала «Нет связи». publish-update.py обязан проверять канал так же, как
// приложение (запрос с Origin https://localhost), и падать без CORS-заголовка.
test('publish-update.py: после заливки проверяет манифест глазами приложения (CORS)', { skip: !fs.existsSync(path.join(ROOT, 'publish-update.py')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const src = fs.readFileSync(path.join(ROOT, 'publish-update.py'), 'utf8');
  assert.match(src, /"Origin": "https:\/\/localhost"/);
  assert.match(src, /Access-Control-Allow-Origin/);
  assert.ok(src.indexOf('Access-Control-Allow-Origin') > src.indexOf('put_object('), 'проверка стоит до заливки');
  assert.match(src, /raise SystemExit\("\[ОШИБКА\] манифест залит, но CDN не отдаёт/);
});
