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

// Манифест, каким его зальёт publish-update.py (без web), стор-приложение понимает.
test('манифест без web: стор-приложение видит новую версию и зовёт в RuStore', () => {
  const m = U.parseManifest({
    build: 'store', version: '1.0.2', size: 1,
    apkUrl: 'https://dorokhin-finance.ru/homyak-store/homyak-1.0.2.apk', notes: 'x'
  });
  assert.ok(m, 'манифест без web не разобрался');
  assert.equal(m.web, null);
  assert.deepEqual(U.decideStore(m, '1.0.1'), { kind: 'store', version: '1.0.2', notes: 'x' });
  assert.deepEqual(U.decideStore(m, '1.0.2'), { kind: 'none' });
});
