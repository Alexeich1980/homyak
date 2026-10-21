/* review-103-code.test.js - код-ревью релиза 1.0.3 (06.10.2026, diff 9ad1077..HEAD), каждая
   подтверждённая находка - заслоном (номер = номер находки):
    1) отпечатки удалены в телефоне, а флаг «вход по отпечатку» включён: замок не тянется к
       отпечатку, «Забыли код?» честный, в настройках есть «Выключить вход по отпечатку»;
    2) отметка «своё системное окно» (AppLock.away) снимается, если вызов кончился без ухода
       в фон, и живёт, пока идёт вызов (медленное окно RuStore);
    3) хранилище забито - пауза после неверного кода всё равно наступает (счётчик в памяти);
    4) окно «Данные не прочитались» возвращается после входа, если его закрыл замок;
    5) после входа закрытое при запирании меню не «видно» диктору (aria-hidden);
    6) «Ввести код» в окне отпечатка - не «Не получилось по отпечатку»;
    7) «есть, но без номера» гаснет после установки обновления;
    8) «Отмена» в «Спрашиваю RuStore…» - окно результата потом не всплывает;
    9) сбой окна обновления RuStore - карточка в RuStore (deeplink плагина), браузер - запасной;
   11) данные не прочитались - обычная копия пустых данных не сохраняется и не гасит напоминание;
   12) окно сохранения не ответило - настройка кода не обрывается молча;
   13) повреждённые данные из старого ключа (kazna_v1) сохраняются в файл из того ключа;
   14) наследный ключ карантина homyak_v1.broken (до 1.0.2) убирается и не мешает новой копии;
   15) напоминание о копии: «Позже» 31-го не значит «снова 1-го»;
   16) окно оценки не запрашивается после каждой операции, если флаги не легли в хранилище;
   17) гейт версии не держится за versionCode тест-сборки;
   18) стор-сборка убирает папку ota/ (заводская копия от 1.0.2);
   19) тексты: «копия данных», «Ничего не изменено»;
   20) у «Позже» в карточке-напоминании есть свои стили (правило было на .ghost);
   21) архив веб-сборки - только с адреса, который пускает CSP тест-сборки. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../build-lib.js');
const G = require('../www/guards.js');
const U = require('../www/update.js');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');
const { edgePath, launchEdge, waitFor, sleep } = require('./lib/edge-cdp.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DAY = 86400000;

// ---------- чистая часть ----------

test('7: «есть, но без номера» помнит оболочку и гаснет, когда её сменили', () => {
  assert.equal(U.newerRecord({ kind: 'store', versionCode: 0 }, '1.0.3'), '?@1.0.3');
  assert.equal(U.newerRecord({ kind: 'store', versionCode: 20009 }, '1.0.3'), '20009');
  const p = U.parseNewer('?@1.0.3');
  assert.deepEqual(p, { stored: 'unknown', base: '1.0.3' });
  assert.equal(U.stillNewer(p.stored, '1.0.3', p.base), true, 'та же оболочка - обновление ещё ждёт');
  assert.equal(U.stillNewer(p.stored, '1.0.4', p.base), false, 'оболочку обновили - точка «новая» висит на актуальной версии');
  assert.equal(U.stillNewer(p.stored, null, p.base), true, 'оболочка ещё не ответила - не гасим');
  assert.deepEqual(U.parseNewer('?'), { stored: 'unknown', base: '' }, 'старая запись без оболочки читается');
  assert.deepEqual(U.parseNewer('20009'), { stored: 20009, base: '' });
  assert.equal(U.parseNewer(''), null);
});

test('9: сбой окна обновления RuStore - карточка в RuStore (openStore), браузер только запасной', async () => {
  const opened = [];
  const ext = (u) => opened.push(u);
  let card = 0;
  const r = await U.startSdkUpdate({ native: {
    startUpdate: () => Promise.resolve({ ok: false, reason: 'flow' }),
    openStore: () => { card++; return Promise.resolve({ ok: true, via: 'store' }); }
  } }, ext);
  assert.equal(card, 1, 'плагин openStore не позван');
  assert.equal(r.via, 'store');
  assert.deepEqual(opened, [], 'при живом deeplink открылся браузер');
  // и deeplink не вышел - тогда браузер
  const r2 = await U.startSdkUpdate({ native: {
    startUpdate: () => Promise.reject(new Error('x')),
    openStore: () => Promise.resolve({ ok: false })
  } }, ext);
  assert.equal(r2.via, 'web');
  assert.deepEqual(opened, [U.URL_RUSTORE]);
});

function mapStorage(init, limit) {
  const m = new Map(Object.entries(init || {}));
  const size = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const was = m.has(k) ? k.length + m.get(k).length : 0;
      if (limit && size() - was + k.length + String(v).length > limit) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
    keys: () => Array.from(m.keys()).sort()
  };
}

test('14: наследный ключ homyak_v1.broken (до 1.0.2) - самая старая копия карантина', () => {
  const now = new Date(2026, 9, 6, 12, 0, 0).getTime();
  const fresh = Engine.quarantineKey('homyak_v1', now - 2 * DAY);
  const s = mapStorage({ homyak_v1: '{}', 'homyak_v1.broken': 'old', [fresh]: 'new' });
  assert.deepEqual(Engine.pruneQuarantine(s, 'homyak_v1', now, 30), ['homyak_v1.broken']);
  assert.deepEqual(s.keys(), ['homyak_v1', fresh]);
  // единственная копия - остаётся (вдруг это единственный след порчи)
  const s2 = mapStorage({ 'homyak_v1.broken': 'old' });
  assert.deepEqual(Engine.pruneQuarantine(s2, 'homyak_v1', now, 30), []);
});

test('14: свежая порча не ложится из-за наследного ключа - он уступает место', () => {
  const big = 'x'.repeat(4000);
  const s = mapStorage({ 'homyak_v1.broken': big }, 6000);
  const q = Engine.quarantine(s, 'homyak_v1', 'y'.repeat(3000), new Date(2026, 9, 6, 12, 0, 0));
  assert.equal(q.copied, true, 'копия свежей порчи не легла');
  assert.equal(s.getItem('homyak_v1.broken'), null);
  // без наследного ключа места нет - честное «не легло», чужое не трогаем
  const s2 = mapStorage({ other: big }, 6000);
  assert.equal(Engine.quarantine(s2, 'homyak_v1', 'y'.repeat(3000), new Date(2026, 9, 6, 12, 0, 0)).copied, false);
  assert.equal(s2.getItem('other'), big);
});

test('15: напоминание о копии - не раньше GAP_DAYS после показа или «Позже», даже в новом месяце', () => {
  const oct31 = new Date(2026, 9, 31, 20, 0, 0).getTime(), nov1 = new Date(2026, 10, 1, 9, 0, 0).getTime();
  const base = { txCount: 50, lastAt: new Date(2026, 6, 1).getTime() };
  assert.equal(G.backupDue(Object.assign({}, base, { now: nov1, snoozeYM: '2026-10', snoozeAt: oct31 })), false, '«Позже» 31-го - снова 1-го');
  assert.equal(G.backupDue(Object.assign({}, base, { now: nov1, shownYM: '2026-10', shownAt: oct31 })), false, 'показ 31-го - снова 1-го');
  const later = oct31 + G.BACKUP.GAP_DAYS * DAY;
  assert.equal(G.backupDue(Object.assign({}, base, { now: later, snoozeYM: '2026-10', snoozeAt: oct31 })), true, 'после паузы - снова можно');
  assert.ok(G.BACKUP.GAP_DAYS >= 20 && G.BACKUP.GAP_DAYS <= 30);
  // метка из будущего (часы назад) паузу не держит
  assert.equal(G.backupDue(Object.assign({}, base, { now: nov1, snoozeAt: nov1 + 5 * DAY })), true);
  // nudges пишет метки времени
  const n = rd('www/nudges.js');
  assert.match(n, /s\.shownAt = now/); assert.match(n, /s\.snoozeAt = now/); assert.match(n, /shownAt: s\.shownAt, snoozeAt: s\.snoozeAt/);
});

test('17: гейт версии - versionCode тест-сборки (чётный) не запрещает стор', () => {
  // тест-сборка 1.0.4 записала 20008, а чинить надо неопубликованный стор 1.0.3
  assert.doesNotThrow(() => L.checkVersionGate({ version: '1.0.3', published: '1.0.2', built: '1.0.3', gradleCode: 20008 }));
  // релизный код выше - по-прежнему нельзя
  assert.throws(() => L.checkVersionGate({ version: '1.0.3', published: '1.0.2', built: null, gradleCode: 20009 }), /versionCode/);
});

function fakeFs(paths) {
  const files = new Set(paths);
  return {
    files,
    readdir({ path: p }) {
      const set = new Set();
      for (const f of files) if (f.indexOf(p + '/') === 0) set.add(f.slice(p.length + 1).split('/')[0]);
      if (!set.size) return Promise.reject(new Error('Directory does not exist'));
      return Promise.resolve({ files: [...set].map((name) => ({ name })) });
    },
    rmdir({ path: p }) {
      for (const f of [...files]) if (f === p || f.indexOf(p + '/') === 0) files.delete(f);
      return Promise.resolve();
    }
  };
}

test('18: стор-сборка убирает папку ota/ (заводская копия стор-сборки 1.0.2)', async () => {
  const F = fakeFs(['ota/base/.complete', 'ota/base/index.html', 'ota/state.json', 'other/x']);
  assert.equal(await U.dropOta(F), true);
  assert.deepEqual([...F.files], ['other/x']);
  assert.equal(await U.dropOta(fakeFs([])), false, 'нет папки - ничего');
  assert.equal(await U.dropOta(null), false);
  const u = rd('www/update.js');
  const at = u.indexOf('function confirmBoot()');
  const body = u.slice(at, u.indexOf('\n  }\n', at));
  assert.ok(body.indexOf('if (isStore()) return dropOta(') > 0, 'confirmBoot в сторе не убирает ota/');
});

// видимые строки JS (без комментариев)
function strings(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1').match(/'(?:[^'\\\n]|\\.)*'/g) || [];
}
test('19: тексты обновления - «копия данных» и «Ничего не изменено»', () => {
  const bad = strings(rd('www/update.js')).filter((s) => /[Бб]экап|не менял/.test(s));
  assert.deepEqual(bad, []);
  assert.ok(rd('www/update.js').indexOf('честная строка на «ты»') < 0, 'комментарий про «ты»');
});

test('20: правила .rm-btns .btn.<класс> - только для кнопок, что есть в карточке-напоминании', () => {
  const html = rd('www/index.html');
  const card = html.slice(html.indexOf('<div id="remind"'), html.indexOf('</div>', html.indexOf('rm-btns')) + 6);
  const classes = new Set();
  for (const m of card.matchAll(/class="btn ([a-z-]+)"/g)) classes.add(m[1]);
  assert.ok(classes.size >= 2, 'кнопок карточки не нашлось: ' + card.slice(0, 200));
  const css = rd('www/style.css');
  const used = [...css.matchAll(/\.rm-btns \.btn\.([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 2);
  const dead = used.filter((c) => !classes.has(c));
  assert.deepEqual(dead, [], 'мёртвые правила карточки: ' + dead.join(', '));
});

test('21: архив веб-сборки - только с адреса, который пускает CSP тест-сборки', () => {
  const sha = 'a'.repeat(64);
  const w = U.parseWeb({ version: '1.0.4', url: 'https://dorokhin-finance.ru/homyak-store/www-1.0.4.zip', sha256: sha, size: 10 });
  assert.ok(w, 'голый домен отвергнут целиком');
  assert.equal(w.url, 'https://www.dorokhin-finance.ru/homyak-store/www-1.0.4.zip');
  assert.equal(U.parseWeb({ version: '1.0.4', url: 'https://cdn.dorokhin-finance.ru/www-1.0.4.zip', sha256: sha }), null, 'поддомен, закрытый CSP');
  const origin = w.url.match(/^https:\/\/[^/]+/)[0];
  assert.ok(L.CSP_CONNECT_DEV.split(/\s+/).indexOf(origin) > 0, 'CSP не пускает ' + origin);
});

// ---------- сквозная часть: стор-копия в Edge ----------

const WWW = path.join(ROOT, 'www');
const EDGE = { skip: edgePath() ? false : 'нет Edge', timeout: 240000 };

async function bootShip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-rev103c-'));
  const ship = path.join(dir, 'ship');
  L.makeShip(WWW, ship, { release: true, store: true });
  L.writeFilesJson(ship, null, '0');
  const url = 'file:///' + path.join(ship, 'index.html').split(path.sep).join('/');
  const edge = await launchEdge();
  const page = await edge.open('about:blank', { width: 360, height: 640 });
  const S = Seed.demoState(Engine, Engine.today()); S.ui.demo = false; S.ui.onboarded = true;
  const real = JSON.stringify(S);
  async function boot(setup) {
    await page.goto(url); await waitFor(() => page.eval('document.readyState==="complete"'), 10000);
    await page.eval(`(function(){localStorage.clear();${setup || ''};return 1})()`);
    await page.goto(url); await waitFor(() => page.eval('!!window.APP_READY && document.readyState === "complete"'), 20000, 'стор-копия нарисовалась')  // ui.js ставит APP_READY раньше nudges.js/update.js; await sleep(500);
  }
  return { dir, edge, page, boot, real, done: async () => { await edge.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const pin = (p) => `['${p[0]}','${p[1]}','${p[2]}','${p[3]}'].forEach(function(k){document.querySelector('#lockPad [data-k="'+k+'"]').click()}); 1`;
// подложенные родные плагины: телефон, отпечаток, сохранение файла
const NATIVE = `(function(o){ window.isNativeApp = function(){ return true; };
  window.NativePlugins = Object.assign({}, window.NativePlugins || {}, o); return 1; })`;

test('1, 2, 3, 5, 6, 12, 16: замок, свои системные окна, окно оценки', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(t.real)})`);
    // 1: флаг отпечатка включён, а отпечатков в телефоне нет
    await page.eval(`${NATIVE}({ NativeBiometric: { isAvailable: function(){ return Promise.resolve({ isAvailable: false }); },
      verifyIdentity: function(){ window.__bio = (window.__bio || 0) + 1; return Promise.reject({ code: '3' }); } } })`);
    await page.eval(`AppLock._enable('1234', true).then(function(){ AppLock.lockNow(); return 1; })`);
    await sleep(800);
    const r1 = JSON.parse(await page.eval(`JSON.stringify({ key: !!document.querySelector('#lockPad [data-k="bio"]'), auto: window.__bio || 0,
      msg: document.getElementById('lockMsg').textContent })`));
    assert.deepEqual(r1, { key: false, auto: 0, msg: '' }, '1: замок тянется к удалённому отпечатку');
    await page.eval(`AppLock._forgot(); 1`); await sleep(300);
    assert.equal(await page.eval(`document.getElementById('lockSheetT').textContent`), 'Код не сбросить', '1: «Забыли код?» предлагает отпечаток, которого нет');
    await page.eval(`document.querySelector('#lockSheetBtns button').click(); 1`);
    await page.eval(pin('1234'));
    await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    await page.eval(`document.getElementById('mLock').click(); 1`); await sleep(500);
    const opts = JSON.parse(await page.eval(`JSON.stringify([].map.call(document.querySelectorAll('#dlgBody [data-lk]'), function(b){ return b.textContent; }))`));
    assert.ok(opts.indexOf('Выключить вход по отпечатку') >= 0, '1: нет кнопки выключить отпечаток: ' + opts.join(' | '));
    await page.eval(`UI.closeDlg(); 1`);

    // 6: «Ввести код» в окне отпечатка (код 16) - без «Не получилось»; настоящий сбой (10) - с ним
    for (const [code, bad] of [['16', false], ['10', true]]) {
      await page.eval(`${NATIVE}({ NativeBiometric: { isAvailable: function(){ return Promise.resolve({ isAvailable: true }); },
        verifyIdentity: function(){ return Promise.reject({ code: '${code}', message: 'x' }); } } })`);
      await page.eval(`AppLock.lockNow(); 1`); await sleep(800);
      const msg = await page.eval(`document.getElementById('lockMsg').textContent`);
      // 14.10: настоящий сбой - «Отпечаток не распознан… осталось N» (3 попытки), потом «Не получилось»
      assert.equal(/Не получилось|не распознан/.test(msg), bad, '6: код ' + code + ' → «' + msg + '»');
      await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    }
    await page.eval(`(function(){ var s = JSON.parse(localStorage.getItem(AppLock.KEY)); s.bio = false; localStorage.setItem(AppLock.KEY, JSON.stringify(s)); return 1; })()`);

    // 2а: окно оценки - RuStore сразу ответил ошибкой, в фон не уходили: следующий уход - со шторкой и замком
    const r2 = JSON.parse(await page.eval(`Nudges.launch({ requestAndLaunch: function(){ return Promise.reject(new Error('no')); } }).then(function(){
      AppLock.onBackground(); var cov = AppLock.isCovered(); AppLock._bgAt(Date.now() - 6 * 60000); var need = AppLock.onForeground();
      return JSON.stringify({ cov: cov, need: need }); })`));
    assert.deepEqual(r2, { cov: true, need: true }, '2: после мгновенной ошибки RuStore уход «Домой» прощён без шторки');
    await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    // 2б: сохранение файла - системного окна нет, плагин сразу отказал (SaveFilePlugin NO_PICKER)
    await page.eval(`${NATIVE}({ SaveFile: { save: function(){ return Promise.reject({ code: 'NO_PICKER' }); } } })`);
    const r2b = JSON.parse(await page.eval(`Backup.backup().then(function(){ UI.closeDlg(); AppLock.onBackground(); var cov = AppLock.isCovered();
      AppLock._bgAt(Date.now() - 6 * 60000); var need = AppLock.onForeground(); return JSON.stringify({ cov: cov, need: need }); })`));
    assert.deepEqual(r2b, { cov: true, need: true }, '2: после мгновенного отказа сохранения уход прощён');
    await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    // 2в: окно RuStore открылось через 20 с (медленная сеть) - это всё ещё своё окно
    const r2c = JSON.parse(await page.eval(`(function(){ AppLock.away(AppLock.AWAY_CALL); AppLock._awayAge(20000); AppLock.onBackground();
      var cov = AppLock.isCovered(); AppLock._bgAt(Date.now() - 6 * 60000); var need = AppLock.onForeground(); return JSON.stringify({ cov: cov, need: need }); })()`));
    assert.deepEqual(r2c, { cov: false, need: false }, '2: медленное окно RuStore (20 с) - лишнее запирание после оплаты');
    // без ответа (выбор файла) - прежние 10 с
    const r2d = JSON.parse(await page.eval(`(function(){ AppLock.away(); AppLock._awayAge(20000); AppLock.onBackground();
      var cov = AppLock.isCovered(); AppLock._bgAt(Date.now() - 6 * 60000); var need = AppLock.onForeground(); return JSON.stringify({ cov: cov, need: need }); })()`));
    assert.deepEqual(r2d, { cov: true, need: true });
    await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');

    // 5: меню открыто → фон (шторка) → 6 минут → замок → вход: меню закрыто и скрыто от диктора
    await page.eval(`UI.openMenu(); 1`); await sleep(400);
    await page.eval(`(function(){ AppLock.onBackground(); AppLock._bgAt(Date.now() - 6 * 60000); AppLock.onForeground(); return 1; })()`);
    await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    const menu = JSON.parse(await page.eval(`JSON.stringify({ open: document.getElementById('menu').classList.contains('open'), aria: document.getElementById('menu').getAttribute('aria-hidden') })`));
    assert.deepEqual(menu, { open: false, aria: 'true' }, '5: закрытое меню после входа видно диктору');

    // 3: хранилище не принимает запись замка - пауза после 5 неверных всё равно
    await page.eval(`(function(){ window.__si = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v){
      if (k === AppLock.KEY) throw new DOMException('full', 'QuotaExceededError'); return window.__si.call(this, k, v); }; AppLock.lockNow(); return 1; })()`);
    for (let i = 0; i < 5; i++) {
      await page.eval(pin('0000'));
      await waitFor(() => page.eval(`document.getElementById('lockDots').classList.contains('bad') || document.getElementById('lockPad').classList.contains('wait')`), 4000, 'неверный код отработал');
      await sleep(150);
    }
    const r3 = JSON.parse(await page.eval(`JSON.stringify({ wait: document.getElementById('lockPad').classList.contains('wait'),
      dis: document.querySelector('#lockPad [data-k="1"]').disabled, msg: document.getElementById('lockMsg').textContent })`));
    await page.eval(`(function(){ Storage.prototype.setItem = window.__si; return 1; })()`);
    assert.equal(r3.wait && r3.dis, true, '3: при забитом хранилище паузы нет - перебор кода: ' + r3.msg);
    assert.match(r3.msg, /Подождите/);
    await page.eval(`AppLock._unlockState(); 1`);
    await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');

    // 12: окно сохранения не ответило никогда - настройка кода идёт дальше
    await page.eval(`${NATIVE}({ SaveFile: { save: function(){ return new Promise(function(){}); } } })`);
    await page.eval(`(function(){ window.__next = 0; AppLock._backupWait(300); AppLock._warnNoBio(function(){ window.__next++; });
      [].filter.call(document.querySelectorAll('#dlgBtns button'), function(b){ return b.textContent === 'Сохранить копию'; })[0].click(); return 1; })()`);
    await sleep(1500);
    assert.equal(await page.eval('window.__next'), 1, '12: настройка кода оборвалась молча');

    // 16: флаги окна оценки не ложатся - второй раз за сессию не спрашиваем
    await page.eval(`(function(){ UI.closeDlg(); localStorage.removeItem(Nudges.RKEY); var t0 = UI.S.tx[0]; for (var i = 0; i < 25; i++) UI.S.tx.push(Object.assign({}, t0, { id: 'rv' + i, ts: Date.now() - 30 * 86400000 }));
      window.__si = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v){ if (k === Nudges.RKEY) throw new DOMException('full', 'QuotaExceededError'); return window.__si.call(this, k, v); };
      window.__asks = 0; Nudges._plugin({ requestAndLaunch: function(){ window.__asks++; return Promise.resolve({ shown: false, code: 'ERROR' }); } }); return 1; })()`);
    assert.equal(await page.eval('Nudges.reviewDue()'), true, 'предусловие: окно оценки пора');
    await page.eval(`Nudges.afterTx(); 1`); await sleep(300);
    await page.eval(`Nudges.afterTx(); 1`); await sleep(300);
    const asks = await page.eval(`(function(){ Storage.prototype.setItem = window.__si; Nudges._plugin(null); return window.__asks; })()`);
    assert.equal(asks, 1, '16: окно оценки запрошено ' + asks + ' раза за сессию');
  } finally { await t.done(); }
});

test('4, 11, 13: повреждённые данные - окно после замка, копия, старый ключ', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    // 4: окно «Данные не прочитались» → фон → замок → вход: окно снова на экране
    await t.boot(`localStorage.setItem('homyak_v1','{"ver":3,"tx":[{"a":')`);
    assert.equal(await page.eval(`document.getElementById('dlgTitle').textContent`), 'Данные не прочитались');
    await page.eval(`AppLock._enable('1234', false).then(function(){ AppLock.onBackground(); AppLock._bgAt(Date.now() - 6 * 60000); AppLock.onForeground(); return 1; })`);
    assert.equal(await page.eval(`AppLock.isLocked() && document.getElementById('dlg').hidden`), true, 'под замком окно должно закрыться');
    await page.eval(pin('1234')); await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл'); await sleep(200);
    const back = JSON.parse(await page.eval(`JSON.stringify({ open: !document.getElementById('dlg').hidden, t: document.getElementById('dlgTitle').textContent, raw: !!document.getElementById('dlgSaveRaw') })`));
    assert.deepEqual(back, { open: true, t: 'Данные не прочитались', raw: true }, '4: окно о повреждённых данных потерялось при запирании');
    await page.eval(`AppLock._disable(); UI.closeDlg(); 1`);

    // 11а: копия порченого в карантине, запись разрешена - файл сохраняем, но копией для напоминания не считаем
    await page.eval(`${NATIVE}({ SaveFile: { save: function(o){ window.__saved = (window.__saved || 0) + 1; return Promise.resolve({ ok: true }); } } })`);
    const a = JSON.parse(await page.eval(`Backup.backup().then(function(n){ return JSON.stringify({ n: n, saved: window.__saved || 0,
      lastAt: (JSON.parse(localStorage.getItem('homyak_v1.backup') || '{}').lastAt || 0) > 0 }); })`));
    assert.equal(a.saved, 1, '11: файл не сохранился');
    assert.equal(a.lastAt, false, '11: копия данных-по-умолчанию после порчи засчитана - напоминание заглохнет');

    // 11б: копии порченого нет (хранилище забито) - только чтение: обычная копия не сохраняется
    await t.boot(`localStorage.setItem('homyak_v1','{"broken":'+ 'x'.repeat(1500000));
      var big='y'.repeat(500000); try{ for(var i=0;i<40;i++) localStorage.setItem('fill'+i, big);}catch(e){}`);
    assert.equal(await page.eval('UI.isReadOnly()'), true, 'предусловие: только чтение');
    await page.eval(`UI.closeDlg(); window.__saved = 0; ${NATIVE}({ SaveFile: { save: function(o){ window.__saved++; return Promise.resolve({ ok: true }); } } })`);
    const b = JSON.parse(await page.eval(`Backup.backup().then(function(){ return JSON.stringify({ saved: window.__saved,
      t: document.getElementById('dlgTitle').textContent, body: document.getElementById('dlgBody').textContent, raw: !!document.getElementById('dlgSaveRaw') }); })`));
    assert.equal(b.saved, 0, '11: в режиме только чтения сохранён файл пустых данных');
    assert.match(b.body, /Обычную копию сейчас сохранить нельзя/);
    assert.equal(b.raw, true, '11: нет кнопки сохранить повреждённые данные');
    await page.eval(`(function(){ for (var i=0;i<40;i++) localStorage.removeItem('fill'+i); UI.closeDlg(); return 1; })()`);

    // 13: битые данные под старым именем kazna_v1, копия в карантин не легла - в файл уходит kazna_v1
    await t.boot(`localStorage.setItem('kazna_v1','{"kazna":'+ 'k'.repeat(1500000));
      var big='y'.repeat(500000); try{ for(var i=0;i<40;i++) localStorage.setItem('fill'+i, big);}catch(e){}`);
    assert.equal(await page.eval('UI.isReadOnly()'), true, 'предусловие: копия не легла');
    const saved = JSON.parse(await page.eval(`(function(){ window.__got = null;
      ${NATIVE}({ SaveFile: { save: function(o){ window.__got = o; return Promise.resolve({ ok: true }); } } });
      var b = document.getElementById('dlgSaveRaw'); if (!b) return Promise.resolve(JSON.stringify({ btn: false }));
      b.click(); return new Promise(function(r){ setTimeout(function(){ var o = window.__got;
        var txt = o ? atob(o.base64) : ''; r(JSON.stringify({ btn: true, len: txt.length, head: txt.slice(0, 9), dlg: document.getElementById('dlgBody').textContent.slice(0, 60) })); }, 600); }); })()`));
    await page.eval(`(function(){ for (var i=0;i<40;i++) localStorage.removeItem('fill'+i); return 1; })()`);
    assert.equal(saved.btn, true);
    assert.equal(saved.head, '{"kazna":', '13: в файл ушёл не текст из kazna_v1: ' + JSON.stringify(saved));
    assert.equal(saved.len, 1500009);
  } finally { await t.done(); }
});

test('8: «Отмена» в «Спрашиваю RuStore…» - окно результата потом не всплывает', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(t.real)})`);
    const r = JSON.parse(await page.eval(`(function(){ Update._store(true); var cur = Update.codeOfVer(window.APP_VERSION);
      Update._sdk({ checkUpdate: function(){ return new Promise(function(res){ setTimeout(function(){ res({ ok: true, available: true, versionCode: cur + 2, currentVersionCode: cur }); }, 500); }); } });
      var p = Update.check();
      var w = document.getElementById('dlgBody').textContent;
      document.getElementById('dlgBtns').lastChild.click();            // «Отмена»
      UI.dlgAlert('Другая работа', 'Другое');
      return p.then(function(d){ return new Promise(function(res){ setTimeout(function(){
        res(JSON.stringify({ w: w, kind: d && d.kind, t: document.getElementById('dlgTitle').textContent, dot: Update.newer() !== '' }));
        Update._sdk(undefined); Update._store(undefined); UI.closeDlg(); }, 100); }); }); })()`));
    assert.match(r.w, /Спрашиваю RuStore/);
    assert.equal(r.kind, 'store');
    assert.equal(r.t, 'Другое', '8: после «Отмена» всплыло окно результата поверх другой работы');
    assert.equal(r.dot, true, 'память о найденной версии всё равно обновилась');
  } finally { await t.done(); }
});
