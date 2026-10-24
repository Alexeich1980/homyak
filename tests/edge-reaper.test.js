/* edge-reaper.test.js - заслон «headless Edge не остаётся сиротой» (22.10.2026: за час тестов и мутаций
   накопилось 300+ msedge, ~7 ГБ, у соседних задач кончалась память). Сценарии - как это случалось на деле:
   обычное закрытие, процесс теста вышел без close(), тест убит по таймауту (finally не выполнился), таймаут
   мутационного раннера (гасится всё дерево). Edge нет или не Windows - пропуск с причиной. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const reaper = require('./lib/edge-reaper.js');
const { edgePath, launchEdge } = require('./lib/edge-cdp.js');

// как процесс теста поднимает Edge (у каждого проекта свой хелпер); в stdout - «PROF <папка профиля>»
const LAUNCH = "const e = await require(" + JSON.stringify(path.join(__dirname, 'lib', 'edge-cdp.js')) + ").launchEdge();";
const REAPER = path.join(__dirname, 'lib', 'edge-reaper.js');
const PREFIX = 'homyak-edge-';
// Edge, запущенный по-старому (без флага против перезапуска): вырывается из-под процесса теста - так копились сироты
const RAW = "const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');" +
  " const prof = fs.mkdtempSync(path.join(os.tmpdir(), " + JSON.stringify(PREFIX) + "));" +
  " const p = cp.spawn(" + JSON.stringify(edgePath() || '') + ", ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });" +
  " require(" + JSON.stringify(REAPER) + ").track(p, prof);" +
  " await new Promise((r) => { const t = setInterval(() => { if (fs.existsSync(path.join(prof, 'DevToolsActivePort'))) { clearInterval(t); r(); } }, 100); });" +
  " const e = { prof };";
const skip = process.platform !== 'win32' ? 'не Windows' : (!edgePath() ? 'нет Edge' : false);

const alive = (prof) => reaper.listEdge().filter((x) => x.prof === prof);
async function gone(prof, ms) {
  const until = Date.now() + (ms || 60000); // под полной нагрузкой завершённые процессы уходят из списка Windows не сразу
  let left = alive(prof);
  while (left.length && Date.now() < until) { await new Promise((r) => setTimeout(r, 300)); left = alive(prof); }
  return left;
}
// дочерний процесс теста: поднимает Edge, сообщает профиль, дальше - tail (висит / выходит без close)
function child(tail, launch) {
  const c = cp.spawn(process.execPath, ['-e', '(async () => { ' + (launch || LAUNCH) + " console.log('PROF ' + e.prof); " + tail + ' })()'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const prof = new Promise((res, rej) => {
    let buf = '';
    c.stdout.on('data', (d) => { buf += d; const m = /PROF (\S+)/.exec(buf); if (m) res(m[1]); });
    c.on('exit', (code) => rej(new Error('дочерний процесс вышел до запуска Edge, код ' + code)));
  });
  return { c, prof };
}

test('close(): после закрытия ни одного процесса Edge этого профиля', { skip, timeout: 180000 }, async () => {
  const e = await launchEdge();
  assert.ok(alive(e.prof).length > 0, 'Edge не виден в списке процессов - заслон слепой');
  await e.close();
  assert.deepEqual((await gone(e.prof)).map((x) => x.pid), []);
});

test('процесс теста вышел, не позвав close(): дерево Edge гасится хуком выхода', { skip, timeout: 180000 }, async () => {
  const { c, prof } = child('process.exit(0);');
  const p = await prof;
  await new Promise((r) => c.once('exit', r));
  assert.deepEqual((await gone(p)).map((x) => x.pid), []);
});

test('тест убит по таймауту (finally не выполнился): Edge нашего хелпера гаснет вместе с ним', { skip, timeout: 180000 }, async () => {
  const { c, prof } = child('setInterval(() => {}, 1000);');
  const p = await prof;
  assert.ok(alive(p).length > 0, 'Edge не виден в списке процессов - заслон слепой');
  c.kill(); // как раннер по таймауту: процесс теста гибнет сразу, его finally/after() не выполняются
  await new Promise((r) => c.once('exit', r));
  assert.deepEqual((await gone(p)).map((x) => x.pid), [], 'Edge пережил убитый тест - вырвался из-под него (флаг против перезапуска?)');
});

test('Edge, вырвавшийся из-под убитого теста (запуск без флага), - сирота: найдена и погашена по PID', { skip, timeout: 180000 }, async (t) => {
  const { c, prof } = child('setInterval(() => {}, 1000);', RAW);
  const p = await prof;
  c.kill(); // как раннер по таймауту: процесс теста гибнет сразу, его хуки не срабатывают
  await new Promise((r) => c.once('exit', r));
  await new Promise((r) => setTimeout(r, 500));
  const orphans = alive(p);
  // публичная копия: сценарий зависит от версии Edge; если процесс без флага не вырвался из-под теста,
  // проверять нечего - пропуск с причиной (остатки гасим), а не красный тест у читателя кода
  if (!(orphans.length > 0 && orphans.some((x) => x.orphan))) {
    for (const x of orphans) { try { process.kill(x.pid); } catch (e) { /* уже погас */ } }
    t.skip('сценарий не воспроизводится установленной версией Edge: Edge без флага не вырвался из-под теста');
    return;
  }
  reaper.sweepOrphans();
  assert.deepEqual((await gone(p)).map((x) => x.pid), []);
});

test('таймаут раннера (runTreeSync): гаснет всё дерево - node и его Edge', { skip, timeout: 180000 }, async () => {
  const r = reaper.runTreeSync(['-e', '(async () => { ' + LAUNCH + " console.log('PROF ' + e.prof); setInterval(() => {}, 1000); })()"], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 124, 'ожидался выход по таймауту: ' + (r.error ? r.error.message + ' ' : '') + r.stdout + r.stderr);
  const p = (/PROF (\S+)/.exec(r.stdout) || [])[1];
  assert.ok(p, 'Edge не поднялся: ' + r.stdout + r.stderr);
  const left = await gone(p);
  assert.deepEqual(left.map((x) => x.pid), [], 'после таймаута остались процессы Edge');
});
