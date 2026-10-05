#!/usr/bin/env node
/* run-selftest.js — гейт сборки: самопроверка www/selftest.js в headless Edge.

   Зачем: self-test живёт в браузере (?demo&selftest) и раньше гонялся руками. При сборке
   1.0.1 его никто не запустил, и пункт (19г) месяц ждал устаревший красный цвет, а сборка
   прошла (найдено 01.10.2026). Теперь build-apk.js зовёт этот скрипт ДО Gradle и падает,
   если здесь хоть один FAIL.

   Как: поднимаем статику www/ на свободном порту, открываем index.html?demo&selftest в
   headless Edge с экраном телефона 375x812 (на десктопной ширине проверки раскладки дают
   ложные падения), ждём итоговую строку «SELFTEST n/N PASS|FAIL», печатаем все FAIL.

     node tools/run-selftest.js            код 0 - всё PASS; 1 - есть FAIL/не дождались
     node tools/run-selftest.js --verbose  плюс все PASS-строки

   Известных исключений нет: всё, что падает, валит гейт. */
'use strict';
const path = require('node:path');
const { edgePath, launchEdge, serveStatic, waitFor } = require('../tests/lib/edge-cdp.js');

const WWW = path.resolve(__dirname, '..', 'www');
const WIDTH = 375, HEIGHT = 812;
const TIMEOUT_MS = 240000;

// Разбор панели self-test - чистая функция (её же проверяет tests/selftest-gate.test.js).
function verdict(lines, summary) {
  const fails = lines.filter((l) => /^FAIL /.test(l));
  const m = /^SELFTEST (\d+)\/(\d+) (PASS|FAIL)$/.exec(summary || '');
  const complete = !!m;
  // ноль проверок - не «всё прошло», а «самопроверка не запустилась»
  const ok = complete && m[3] === 'PASS' && +m[2] > 0 && +m[1] === +m[2] && fails.length === 0;
  return { ok, complete, passed: m ? +m[1] : 0, total: m ? +m[2] : 0, fails };
}

async function runSelftest(opts) {
  opts = opts || {};
  if (!edgePath()) throw new Error('не найден Microsoft Edge (msedge.exe) - самопроверку негде запустить. Путь можно задать EDGE_PATH.');
  const srv = await serveStatic(opts.www || WWW);
  let edge = null;
  try {
    edge = await launchEdge();
    const url = 'http://localhost:' + srv.port + '/index.html?demo&selftest';
    const page = await edge.open('about:blank', { width: WIDTH, height: HEIGHT });
    // профиль Edge каждый раз новый (launchEdge: свежая папка, свой порт) - хранилище
    // пустое, демо засевается как на первом запуске; второй заход с очисткой не нужен:
    // он гонялся наперегонки с сохранениями ещё идущего первого прогона
    await page.goto(url);
    await waitFor(() => page.eval('!!window.APP_READY'), 20000, 'приложение нарисовалось');
    let summary = '';
    try {
      summary = await waitFor(() => page.eval(
        `(() => { var p = document.getElementById('selftest'); return p && p.getAttribute('data-result'); })()`),
        opts.timeout || TIMEOUT_MS, 'итог self-test');
    } catch (e) { summary = ''; }
    const lines = await page.eval(
      `Array.prototype.map.call(document.querySelectorAll('#stList > div'), function (d) { return d.textContent; })`) || [];
    const errors = page.logs.slice();
    return Object.assign(verdict(lines, summary), { summary, lines, errors });
  } finally {
    if (edge) await edge.close();
    await srv.close();
  }
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  let r;
  try { r = await runSelftest(); } catch (e) {
    console.error('[self-test] не удалось прогнать: ' + e.message);
    process.exit(1);
  }
  if (verbose) r.lines.forEach((l) => console.log('  ' + l));
  r.fails.forEach((l) => console.error('  ' + l));
  if (!r.complete) {
    console.error('[self-test] не дождался итога за ' + (TIMEOUT_MS / 1000) + ' с (' + r.lines.length + ' строк напечатано)');
    r.errors.slice(0, 10).forEach((l) => console.error('  ' + l));
    process.exit(1);
  }
  console.log('[self-test] ' + r.summary + ' (экран ' + WIDTH + 'x' + HEIGHT + ')');
  process.exit(r.ok ? 0 : 1);
}

module.exports = { verdict, runSelftest, WIDTH, HEIGHT };
if (require.main === module) main();
