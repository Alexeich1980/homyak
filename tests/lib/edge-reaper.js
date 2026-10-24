/* edge-reaper.js - гарантированная уборка headless Edge за тестами (22.10.2026).
   Боль: за час тестов и мутаций копилось 300+ msedge (~7 ГБ), у соседних задач кончалась память. Причины:
   1) Edge на Windows перезапускает сам себя (compat layer): запущенный процесс сразу выходит, настоящий главный -
      его ребёнок. proc.kill() бил в уже мёртвый PID, и ВСЁ дерево оставалось жить после каждого close().
      Лечение: флаг RELAUNCH_FLAG при запуске (PID = настоящий главный процесс) + kill дерева по PID.
   2) Тест, убитый по таймауту раннера (node --test, мутации), не выполняет finally/after() - дерево сирота.
      Лечение: в профиле метка владельца (PID процесса теста); при первом запуске Edge в процессе Edge с мёртвым
      владельцем гасятся по PID. Владелец жив = процесс с этим PID есть и он старше своего Edge (PID, занятый
      после смерти владельца, всегда моложе Edge). Живые Edge параллельных тестов не трогаются.
     track(proc, prof)    - метка владельца + при выходе/Ctrl+C процесса теста дерево гасится;
     killTree(pid)        - taskkill /PID <pid> /T /F (только по PID, не по имени);
     killProfile(prof)    - добить процессы этого профиля по PID, если папка профиля не стирается (её держит хвост
                            дерева, рождённый в момент taskkill /T);
     listEdge()/findOrphans()/sweepOrphans() - Edge с профилем во временной папке / сироты / погасить сирот;
     assertNoOrphans()    - для мутаций: после мутанта подмести и убедиться, что сирот 0;
     runTreeSync(args, o) - spawnSync node, у которого таймаут гасит ВСЁ дерево (node --test → файлы → Edge),
                            а не только первого ребёнка, как штатный spawnSync({timeout}); node --test - с --test-force-exit.
   В package.json: node --test --test-force-exit - иначе тест, упавший по таймауту, вешает весь npm test.
   Копии: Хомяк/tests/lib, Хомяк RuStore/tests/lib, Ипотека/tests - держать одинаковыми. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const WIN = process.platform === 'win32';
const TMP = os.tmpdir().toLowerCase();
const RELAUNCH_FLAG = '--edge-skip-compat-layer-relaunch';
const OWNER = 'edge-reaper-owner.json';
// профили наших хелперов без метки владельца (старый код в другой копии проекта): сирота, если старше 30 минут
const PREFIXES = ['homyak-edge-', 'kr-fit-'];
const LEGACY_AGE_MS = 30 * 60e3;

function killTree(pid) {
  if (!pid) return;
  try {
    if (WIN) cp.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch (e) { /* уже нет */ }
}

function rmProfile(prof) {
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* Edge ещё держит файлы - подметёт 15-минутная уборка */ }
}

// процессы под присмотром этого процесса: при выходе гасим всё, что ещё живо
const tracked = new Map();
let hooked = false;
function cleanupSync() {
  for (const [pid, t] of tracked) {
    if (t.proc.exitCode === null && t.proc.signalCode === null) killTree(pid); // вышедший PID мог занять чужой процесс
    killProfile(t.prof); // дети Edge не в job-объекте node (silent breakaway) и сами гаснут не сразу
    if (t.prof) rmProfile(t.prof);
  }
  tracked.clear();
}
function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupSync);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    try { process.once(sig, () => { cleanupSync(); process.exit(130); }); } catch (e) { /* сигнала нет на этой ОС */ }
  }
}
function track(proc, prof) {
  hook();
  if (prof) { try { fs.writeFileSync(path.join(prof, OWNER), JSON.stringify({ pid: process.pid })); } catch (e) { /* без метки - сработает правило возраста */ } }
  tracked.set(proc.pid, { proc, prof });
  proc.once('exit', () => tracked.delete(proc.pid));
}

// снимок процессов Windows одним вызовом: pid, родитель, время создания (мс), имя, командная строка. Завершённые
// процессы (0 потоков) под нагрузкой висят в списке Windows до минуты, пока кто-то держит их описатель, - это тени,
// не живые процессы: их не считаем (иначе заслон видит «выжившие» процессы, которые уже не работают и памяти не держат)
function snapshot() {
  const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | " +
    "Select-Object @{n='p';e={$_.ProcessId}},@{n='pp';e={$_.ParentProcessId}},@{n='c';e={if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0}}}," +
    "@{n='n';e={$_.Name}},@{n='l';e={$_.CommandLine}},@{n='t';e={$_.ThreadCount}} | ConvertTo-Json -Compress";
  const r = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (r.status !== 0 || !r.stdout) throw new Error('не удалось получить список процессов: ' + (r.stderr || r.error || r.status));
  const list = JSON.parse(r.stdout);
  return (Array.isArray(list) ? list : [list]).filter((x) => x.t > 0).map((x) => Object.assign(x, { ms: x.c ? x.c / 1e4 - 11644473600000 : 0 }));
}

// профиль Edge во временной папке из командной строки, иначе null (обычный Edge пользователя не трогаем)
function tempProfile(cmd) {
  const m = /--user-data-dir="?([^"]+?)"?(?=\s|$)/i.exec(cmd || '');
  if (!m) return null;
  const dir = m[1];
  return dir.toLowerCase().startsWith(TMP + path.sep) ? dir : null;
}

// чей это Edge: true - владелец мёртв (сирота), false - жив или профиль не наш. first - когда создан первый процесс Edge
// этого профиля. Сверка по времени старта процесса теста не годится: под нагрузкой node стартует секундами, и живой
// Edge соседа принимался за сироту (22.10.2026, падал storage-guard в полном npm test).
function ownerDead(prof, byPid, now, first) {
  let o = null;
  try { o = JSON.parse(fs.readFileSync(path.join(prof, OWNER), 'utf8')); } catch (e) { /* метки нет */ }
  if (o) {
    const p = byPid.get(o.pid);
    return !(p && p.ms <= first + 1000);
  }
  if (!PREFIXES.some((x) => path.basename(prof).startsWith(x))) return false; // чужой профиль - не наш, не трогаем
  let born = 0;
  try { born = fs.statSync(prof).birthtimeMs; } catch (e) { return true; } // профиль стёрт, а Edge живёт - сирота
  return now - born > LEGACY_AGE_MS;
}

// все msedge с профилем во временной папке; orphan - владелец профиля мёртв
function listEdge() {
  if (!WIN) return [];
  const all = snapshot();
  const byPid = new Map(all.map((x) => [x.p, x]));
  const now = Date.now();
  const edges = [];
  const first = new Map();
  for (const x of all) {
    if (String(x.n).toLowerCase() !== 'msedge.exe') continue;
    const prof = tempProfile(x.l);
    if (!prof) continue;
    edges.push({ pid: x.p, ppid: x.pp, prof });
    if (!first.has(prof) || x.ms < first.get(prof)) first.set(prof, x.ms);
  }
  const verdict = new Map();
  for (const e of edges) {
    if (!verdict.has(e.prof)) verdict.set(e.prof, ownerDead(e.prof, byPid, now, first.get(e.prof)));
    e.orphan = verdict.get(e.prof);
  }
  return edges;
}

function findOrphans() { return listEdge().filter((x) => x.orphan); }

function killProfile(prof) {
  if (!WIN || !prof) return 0;
  let left = [];
  try { left = listEdge().filter((x) => x.prof === prof); } catch (e) { return 0; }
  for (const x of left) killTree(x.pid);
  return left.length;
}

function sweepOrphans() {
  const orphans = findOrphans();
  for (const o of orphans) killTree(o.pid);
  for (const prof of new Set(orphans.map((o) => o.prof))) rmProfile(prof);
  return orphans.length;
}

// есть ли кого подметать - без запроса к Windows (он тяжёлый, а тест-файлы стартуют пачкой): папка нашего профиля,
// чей владелец мёртв или (без метки) старше 30 минут, и которую не удаётся стереть - её держит живой Edge
function hasCandidates() {
  if (!WIN) return false;
  const now = Date.now();
  for (const n of fs.readdirSync(os.tmpdir())) {
    if (!PREFIXES.some((x) => n.startsWith(x))) continue;
    const dir = path.join(os.tmpdir(), n);
    let o = null;
    try { o = JSON.parse(fs.readFileSync(path.join(dir, OWNER), 'utf8')); } catch (e) { /* метки нет */ }
    let stale = false;
    if (o) { try { process.kill(o.pid, 0); } catch (e) { stale = e.code === 'ESRCH'; } }
    else { try { stale = now - fs.statSync(dir).birthtimeMs > LEGACY_AGE_MS; } catch (e) { /* уже нет */ } }
    if (!stale) continue;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { return true; }
  }
  return false;
}

// раз на процесс: первый запуск Edge в тест-файле подметает сирот прошлых прогонов
let swept = false;
function sweepOnce() {
  if (swept) return;
  swept = true;
  try { if (hasCandidates()) sweepOrphans(); } catch (e) { /* уборка не должна ронять тест */ }
}

function assertNoOrphans(label) {
  const killed = sweepOrphans();
  if (!killed) return 0;
  const until = Date.now() + 5000;
  let left = findOrphans();
  while (left.length && Date.now() < until) { cp.spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']); left = findOrphans(); }
  if (left.length) throw new Error('сироты Edge после ' + (label || 'прогона') + ' не гаснут: PID ' + left.map((o) => o.pid).join(', '));
  return killed;
}

// spawnSync(node, args) с таймаутом на всё дерево; вывод - как у spawnSync. Код 124 - таймаут.
// node --test получает --test-force-exit: тест, упавший по своему таймауту, не выполняет finally - сервер и Edge
// остаются открыты, и без флага процесс тест-файла висит вечно (22.10.2026, review-055 под нагрузкой)
function runTreeSync(args, o) {
  o = o || {};
  if (args[0] === '--test' && !args.includes('--test-force-exit')) args = ['--test', '--test-force-exit'].concat(args.slice(1));
  const ms = o.timeout || 300000;
  return cp.spawnSync(process.execPath, [__filename, '--run', String(ms)].concat(args),
    { cwd: o.cwd, env: o.env, encoding: o.encoding, stdio: o.stdio, timeout: ms + 60000, maxBuffer: 256 * 1024 * 1024 });
}

if (require.main === module && process.argv[2] === '--run') {
  const ms = +process.argv[3];
  const child = cp.spawn(process.execPath, process.argv.slice(4), { stdio: 'inherit' });
  const timer = setTimeout(() => {
    process.stderr.write('\nТАЙМАУТ ' + ms + ' мс: гашу дерево процессов ' + child.pid + '\n');
    killTree(child.pid);
    process.exit(124);
  }, ms);
  child.on('exit', (code) => { clearTimeout(timer); process.exit(code === null ? 1 : code); });
  const stop = () => { killTree(child.pid); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

module.exports = { RELAUNCH_FLAG, killTree, killProfile, track, listEdge, findOrphans, sweepOrphans, sweepOnce, assertNoOrphans, runTreeSync, tempProfile };
