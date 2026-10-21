/* selftest-gate.test.js — сборка не проходит при красном self-test (01.10.2026).
   Сборка 1.0.1 ушла с красным пунктом (19г): self-test жил в браузере и гонялся руками.
   Теперь build-apk.js первым делом зовёт tools/run-selftest.js и падает при любом FAIL. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../tools/run-selftest.js');
const { edgePath } = require('./lib/edge-cdp.js');

const ROOT = path.join(__dirname, '..');

test('build-apk.js зовёт гейт self-test раньше cap sync и Gradle, и падает на нём', () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-apk.js'), 'utf8');
  const at = src.indexOf("path.join(ROOT, 'tools', 'run-selftest.js')");
  assert.ok(at > 0, 'build-apk.js не зовёт tools/run-selftest.js');
  assert.ok(at < src.indexOf("run('npx', ['cap', 'sync', 'android']"), 'гейт стоит после cap sync');
  assert.ok(at < src.indexOf('[2/3] Собираю APK'), 'гейт стоит после запуска Gradle');
  assert.ok(at < src.indexOf('const VER = stampVersion('), 'гейт стоит после простановки версии');
  // гейт не внутри условия режима: работает и для теста, и для стора, и для reel
  const before = src.slice(0, at);
  assert.equal((before.match(/\bif \(MODE\.|\bif \(REEL\)/g) || []).length, 0, 'гейт спрятан под условие режима сборки');
  const tail = src.slice(at, at + 400);
  assert.match(tail, /gate\.status !== 0/, 'код возврата гейта не проверяется');
  assert.match(tail, /die\(/, 'красный гейт не останавливает сборку');
});

test('verdict: любой FAIL, неполный прогон или расхождение счёта = красный', () => {
  assert.equal(G.verdict(['PASS a', 'PASS b'], 'SELFTEST 2/2 PASS').ok, true);
  assert.equal(G.verdict(['PASS a', 'FAIL b: x'], 'SELFTEST 1/2 FAIL').ok, false);
  assert.equal(G.verdict(['PASS a', 'FAIL b: x'], 'SELFTEST 2/2 PASS').ok, false, 'FAIL-строка при «PASS» в итоге');
  assert.equal(G.verdict(['PASS a'], '').ok, false, 'итога нет - прогон не завершился');
  assert.equal(G.verdict([], 'SELFTEST 0/0 PASS').ok, false, 'ноль проверок = самопроверка не запустилась, не зелёный');
  assert.deepEqual(G.verdict(['FAIL x: y'], 'SELFTEST 0/1 FAIL').fails, ['FAIL x: y']);
});

test('экран гейта - телефон 375x812', () => {
  assert.equal(G.WIDTH, 375);
  assert.equal(G.HEIGHT, 812);
});

// Мутация гейта на настоящем Edge: копия www с одним заведомо красным пунктом.
test('гейт краснеет от сломанного пункта self-test', { skip: edgePath() ? false : 'нет Edge', timeout: 300000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-gate-'));
  try {
    const www = path.join(tmp, 'www');
    fs.cpSync(path.join(ROOT, 'www'), www, { recursive: true });
    const f = path.join(www, 'selftest.js');
    const s = fs.readFileSync(f, 'utf8');
    const at = s.lastIndexOf('setTimeout(run, 0);');
    assert.ok(at > 0, 'не нашёл запуск self-test');
    fs.writeFileSync(f, s.slice(0, at) + "add('мутация гейта', function () { eq(1, 2, 'нарочно'); });\n" + s.slice(at));
    const r = await G.runSelftest({ www });
    assert.equal(r.complete, true, 'self-test не дошёл до итога');
    assert.equal(r.ok, false, 'гейт зелёный при сломанном пункте');
    assert.ok(r.fails.some((l) => l.indexOf('FAIL мутация гейта') === 0), 'FAIL сломанного пункта не пойман: ' + r.fails.join(' | '));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
