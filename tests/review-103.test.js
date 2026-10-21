/* review-103.test.js - находки адверсариального ревью 1.0.3 (05.10.2026), каждая - заслоном:
   1) замок: «своё системное окно» (away) прощает только ОДИН короткий уход; фон дольше
      потолка AWAY_MAX - запираем всегда;
   2) после «Восстановить из файла» при запрете записи красная полоса уходит;
   3) карточка «Сохрани копию» не перекрывает меню, окна, экран суммы и шапку «Потрачено»;
   4) версия: стор-сборка обязана быть строго новее опубликованной (гейт до Gradle);
   5) повреждённые данные можно сохранить в файл; карантин старше 30 дней чистится;
   6) во время паузы после неверных попыток вход по отпечатку остаётся;
   7) перевод часов назад не даёт паузу дольше PAUSE_MAX;
   8) приветствие не поверх замка; 9) под замком ничего не фокусируется (inert).
   Сквозная часть - стор-копия (build-lib makeShip, как в APK) в headless Edge. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../build-lib.js');
const G = require('../www/guards.js');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');
const { edgePath, launchEdge, waitFor, sleep } = require('./lib/edge-cdp.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
const MIN = 60000, DAY = 86400000;

// ---------- 1. замок: away ----------

function notes103() {
  // заметки 1.0.3 - свой раздел CHANGELOG, а не верхний (с выходом 1.0.4 верхний - 1.0.4)
  const t = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const a = t.indexOf('## 1.0.3\n'); const b = t.indexOf('\n## ', a + 1);
  return t.slice(a, b < 0 ? undefined : b).split('\n').slice(1).join('\n').trim();
}

test('1: away прощает только короткий уход; фон дольше потолка - запираем', () => {
  assert.ok(G.LOCK.AWAY_MAX >= G.LOCK.BG_MS && G.LOCK.AWAY_MAX <= 10 * MIN, 'потолок AWAY_MAX: ' + G.LOCK.AWAY_MAX);
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + 7 * MIN, away: true }), false, 'выбирал папку 7 минут');
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + 60 * MIN, away: true }), true, 'ушёл из окна сохранения на час');
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + G.LOCK.AWAY_MAX, away: true }), true, 'ровно потолок');
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 - 10 * MIN }), true, 'часы назад в фоне - не знаем, сколько прошло');
});

// ---------- 7. пауза не длиннее потолка ----------

test('7: часы перевели назад - пауза не больше PAUSE_MAX, и запись в хранилище обрезается', () => {
  const st = { fails: 0, lockouts: 1, until: T0 + DAY + 30000 };
  assert.equal(G.lockWait(st, T0), G.LOCK.PAUSE_MAX);
  const n = G.lockNormalize(st, T0);
  assert.equal(n.until, T0 + G.LOCK.PAUSE_MAX);
  assert.equal(G.lockWait(n, T0 + G.LOCK.PAUSE_MAX), 0, 'после потолка пауза кончилась');
  const ok = { until: T0 + 30000 };
  assert.equal(G.lockNormalize(ok, T0).until, T0 + 30000, 'нормальную паузу не трогаем');
});

// ---------- 5. карантин ----------

function mapStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => Array.from(m.keys()).sort()
  };
}

test('5: карантин старше 30 дней удаляется, самая свежая копия остаётся всегда', () => {
  const now = new Date(2026, 9, 5, 12, 0, 0).getTime();
  const k = (d) => 'homyak_v1.broken-' + d;
  const s = mapStorage({
    homyak_v1: '{}', 'homyak_v1.backup': '{}', 'homyak-lock': '{}',
    [k('2026-08-01T10-00-00')]: 'a', [k('2026-08-01T10-00-00-2')]: 'b',
    [k('2026-09-20T10-00-00')]: 'c', 'other.broken-2026-01-01T00-00-00': 'x'
  });
  const removed = Engine.pruneQuarantine(s, 'homyak_v1', now, 30);
  assert.deepEqual(removed.sort(), [k('2026-08-01T10-00-00'), k('2026-08-01T10-00-00-2')]);
  assert.deepEqual(s.keys(), ['homyak-lock', 'homyak_v1', 'homyak_v1.backup', k('2026-09-20T10-00-00'), 'other.broken-2026-01-01T00-00-00']);
  // все старые - самая свежая остаётся
  const s2 = mapStorage({ [k('2026-01-01T10-00-00')]: 'a', [k('2026-02-01T10-00-00')]: 'b' });
  assert.deepEqual(Engine.pruneQuarantine(s2, 'homyak_v1', now, 30), [k('2026-01-01T10-00-00')]);
  assert.deepEqual(s2.keys(), [k('2026-02-01T10-00-00')]);
});

// ---------- 4. версия ----------

test('4: package.json 1.0.3+, верхний раздел CHANGELOG - эта версия, без «—» и без окна оценки', () => {
  const ver = require('../package.json').version;
  assert.ok(L.cmpVer(ver, '1.0.3') >= 0, 'package.json всё ещё ' + ver);
  const notes = notes103();
  assert.ok(/Защита входа/.test(notes) && /копи/.test(notes), 'в заметках 1.0.3 нет кода на вход и копии');
  assert.ok(!/оценк|отзыв/i.test(notes), 'окно оценки в CHANGELOG не пишем');
  assert.equal(notes.indexOf('—'), -1);
});

test('4: гейт версии - стор строго новее опубликованной, не ниже собранной и versionCode в gradle', () => {
  const pub = { published: '1.0.2', built: '1.0.2', gradleCode: 20005 };
  assert.throws(() => L.checkVersionGate(Object.assign({ version: '1.0.2' }, pub)), /1\.0\.2.*(опубликован|RuStore)/);
  assert.throws(() => L.checkVersionGate(Object.assign({ version: '1.0.1' }, pub)), /package\.json/);
  assert.doesNotThrow(() => L.checkVersionGate(Object.assign({ version: '1.0.3' }, pub)));
  // пересборка той же версии до публикации (кандидат → финал) - можно
  assert.doesNotThrow(() => L.checkVersionGate({ version: '1.0.3', published: '1.0.2', built: '1.0.3', gradleCode: 20007 }));
  // собранная новее, чем собираем, - нельзя откатываться
  assert.throws(() => L.checkVersionGate({ version: '1.0.3', published: '1.0.2', built: '1.0.4', gradleCode: 20009 }), /1\.0\.4/);
  // versionCode в gradle выше, чем стор-код собираемой версии
  assert.throws(() => L.checkVersionGate({ version: '1.0.3', published: null, built: null, gradleCode: 20011 }), /versionCode/);
  assert.doesNotThrow(() => L.checkVersionGate({ version: '1.0.3', published: null, built: null, gradleCode: 0 }));
  // тест-сборка (store:false) гейтом не держится: её версия может совпадать с опубликованной
  assert.doesNotThrow(() => L.checkVersionGate(Object.assign({ store: false, version: '1.0.2' }, pub)));
  assert.throws(() => L.checkVersionGate(Object.assign({ store: true, version: '1.0.2' }, pub)));
});

test('4: storeHistory читает published.json, last-apk.json и versionCode из build.gradle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-vgate-'));
  try {
    fs.writeFileSync(path.join(dir, 'published.json'), JSON.stringify({ version: '1.0.2' }));
    fs.writeFileSync(path.join(dir, 'last-apk.json'), JSON.stringify({ version: '1.0.3' }));
    const gradle = path.join(dir, 'build.gradle');
    fs.writeFileSync(gradle, 'android {\n  defaultConfig {\n        versionCode 20006\n        versionName "1.0.3"\n  }\n}\n');
    assert.deepEqual(L.storeHistory(dir, gradle), { published: '1.0.2', built: '1.0.3', gradleCode: 20006 });
    assert.deepEqual(L.storeHistory(path.join(dir, 'нет'), path.join(dir, 'нет.gradle')), { published: null, built: null, gradleCode: 0 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('4: build-apk.js проверяет версию до self-test и Gradle (только стор)', () => {
  const s = rd('build-apk.js');
  const gate = s.indexOf('L.checkVersionGate(');
  assert.ok(gate > 0, 'гейта версии нет в build-apk.js');
  assert.match(s.slice(gate, gate + 200), /store: !!MODE\.store && !REEL/, 'гейт не знает, стор это или нет');
  assert.ok(gate < s.indexOf("'run-selftest.js')"), 'гейт версии после self-test');
  assert.ok(gate < s.indexOf("'gradlew.bat')"), 'гейт версии после Gradle');
});

// ---------- сквозная часть: стор-копия в Edge ----------

const WWW = path.join(ROOT, 'www');

async function bootShip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-rev103-'));
  const ship = path.join(dir, 'ship');
  L.makeShip(WWW, ship, { release: true, store: true });
  L.writeFilesJson(ship, null, '0');
  const url = 'file:///' + path.join(ship, 'index.html').split(path.sep).join('/');
  const edge = await launchEdge();
  const page = await edge.open('about:blank', { width: 360, height: 640 });
  const S = Seed.demoState(Engine, Engine.today()); S.ui.demo = false; S.ui.onboarded = true;
  const real = JSON.stringify(S);
  async function boot(setup, w, h) {
    if (w) await page.size(w, h);
    await page.goto(url); await waitFor(() => page.eval('document.readyState==="complete"'), 10000);
    await page.eval(`(function(){localStorage.clear();${setup || ''};return 1})()`);
    await page.goto(url); await waitFor(() => page.eval('!!window.APP_READY && document.readyState === "complete"'), 20000, 'стор-копия нарисовалась')  // ui.js ставит APP_READY раньше nudges.js/update.js; await sleep(500);
  }
  return { dir, edge, page, boot, real, S, done: async () => { await edge.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const EDGE = { skip: edgePath() ? false : 'нет Edge', timeout: 180000 };

test('1, 6, 7, 8, 9: замок в стор-копии', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(t.real)})`);
    await page.eval(`AppLock._enable('1234', false)`);
    await page.goto('about:blank'); await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(t.real)})`);
    // boot чистит хранилище - включаем снова и запираем
    await page.eval(`AppLock._enable('1234', false).then(function(){ AppLock.lockNow(); return 1; })`);
    // 9: под замком ничего не фокусируется
    const focusable = await page.eval(`(function(){var lock=document.getElementById('lock');
      return [].slice.call(document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')).filter(function(e){
        if (lock.contains(e) || e.offsetParent === null) return false; e.focus(); return document.activeElement === e; }).length})()`);
    assert.equal(focusable, 0, 'под замком фокусируются кнопки: ' + focusable);
    assert.equal(await page.eval(`document.getElementById('app').inert === true && document.getElementById('app').getAttribute('aria-hidden') === 'true'`), true, '#app не inert/aria-hidden под замком');
    // 1: код → away (окно «Сохранить как») → фон → час → возврат: замок
    await page.eval(`['1','2','3','4'].forEach(function(k){document.querySelector('#lockPad [data-k="'+k+'"]').click()})`);
    await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    assert.equal(await page.eval(`document.getElementById('app').inert`), false, 'после входа #app остался inert');
    assert.equal(await page.eval(`document.getElementById('app').hasAttribute('aria-hidden')`), false, 'после входа остался aria-hidden');
    const r1 = JSON.parse(await page.eval(`(function(){ AppLock.away(); AppLock.onBackground(); AppLock._bgAt(Date.now()-3600*1000);
      var need = AppLock.onForeground(); return JSON.stringify({ need: need, locked: AppLock.isLocked() }); })()`));
    assert.deepEqual(r1, { need: true, locked: true }, 'ушёл из окна сохранения на час - замка нет');
    await page.eval(`AppLock._unlockState(); ['1','2','3','4'].forEach(function(k){document.querySelector('#lockPad [data-k="'+k+'"]').click()})`);
    await waitFor(() => page.eval('!AppLock.isLocked()'), 4000, 'код открыл');
    // короткое своё окно - не запираем; но флаг одноразовый: следующий уход на 7 мин без away - замок
    const r2 = JSON.parse(await page.eval(`(function(){ AppLock.away(); AppLock.onBackground(); AppLock._bgAt(Date.now()-7*60000);
      var a = AppLock.onForeground(); AppLock.onBackground(); AppLock._bgAt(Date.now()-7*60000); var b = AppLock.onForeground();
      return JSON.stringify({ a: a, b: b }); })()`));
    assert.deepEqual(r2, { a: false, b: true }, 'away сработал не один раз');
    // 6: пауза после 5 неверных - отпечаток остаётся живым и пробуется сам
    await page.eval(`(function(){ window.__bio = 0; window.isNativeApp = function(){ return true; };
      window.NativePlugins = Object.assign({}, window.NativePlugins || {}, { NativeBiometric: {
        isAvailable: function(){ return Promise.resolve({ isAvailable: true }); },
        verifyIdentity: function(){ window.__bio++; return Promise.reject(new Error('cancel')); } } });
      var s = JSON.parse(localStorage.getItem(AppLock.KEY)); s.bio = true; s.fails = 0; s.lockouts = 1; s.until = Date.now() + 30000;
      localStorage.setItem(AppLock.KEY, JSON.stringify(s)); AppLock.lockNow(); return 1; })()`);
    await sleep(700);
    const bio = JSON.parse(await page.eval(`JSON.stringify({ dis: document.querySelector('#lockPad [data-k="bio"]').disabled,
      digit: document.querySelector('#lockPad [data-k="1"]').disabled, auto: window.__bio })`));
    assert.equal(bio.digit, true, 'цифры во время паузы живые');
    assert.equal(bio.dis, false, 'клавиша отпечатка погасла на паузе');
    assert.ok(bio.auto >= 1, 'отпечаток не предложен сам во время паузы');
    await page.eval(`document.querySelector('#lockPad [data-k="bio"]').click(); 1`); await sleep(200);
    assert.ok(await page.eval('window.__bio') >= 2, 'клавиша отпечатка на паузе не работает');
    // 7: часы назад на сутки - пауза не больше 30 мин и обрезана в хранилище
    await page.eval(`(function(){ var o = JSON.parse(localStorage.getItem(AppLock.KEY)); o.bio = false; o.until = Date.now() + 86400000 + 30000;
      localStorage.setItem(AppLock.KEY, JSON.stringify(o)); AppLock.lockNow(); return 1; })()`);
    await sleep(300);
    const msg = await page.eval(`document.getElementById('lockMsg').textContent`);
    assert.match(msg, /Подождите (30 мин|[12]?\d мин|\d+ с)/, msg);
    assert.ok(!/14\d\d мин/.test(msg), 'пауза на сутки: ' + msg);
    assert.ok(await page.eval(`JSON.parse(localStorage.getItem(AppLock.KEY)).until - Date.now() <= ${G.LOCK.PAUSE_MAX}`), 'в хранилище осталась пауза на сутки');
    // 8: приветствие не поверх замка
    const S2 = Seed.presetState(Engine); S2.ui.onboarded = false;
    await page.eval(`(function(){ var o = JSON.parse(localStorage.getItem(AppLock.KEY)); o.until = 0; o.lockouts = 0; o.fails = 0;
      localStorage.setItem(AppLock.KEY, JSON.stringify(o)); localStorage.setItem('homyak_v1', ${JSON.stringify(JSON.stringify(S2))}); return 1; })()`);
    await page.goto(page && 'about:blank');
    await page.goto('file:///' + path.join(t.dir, 'ship', 'index.html').split(path.sep).join('/'));
    await waitFor(() => page.eval('!!window.APP_READY'), 20000); await sleep(600);
    const top = await page.eval(`(function(){ var e = document.elementFromPoint(180, 320); var lock = document.getElementById('lock');
      return JSON.stringify({ locked: AppLock.isLocked(), inLock: !!e && lock.contains(e) }); })()`);
    assert.deepEqual(JSON.parse(top), { locked: true, inLock: true }, 'приветствие поверх замка');
    // inert-слои не ловятся elementFromPoint, а нарисованы всё равно: замок обязан быть выше
    // любого видимого слоя по z-index (приветствие 999, окна, тост)
    const z = JSON.parse(await page.eval(`(function(){ var lock = document.getElementById('lock'), zl = +getComputedStyle(lock).zIndex, over = [];
      [].forEach.call(document.body.children, function(e){ if (e === lock || e.id === 'selftest') return; var cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.position === 'static') return; var zi = +cs.zIndex; if (zi >= zl) over.push(e.id + ':' + zi); });
      return JSON.stringify({ onboard: !document.getElementById('onboard').hidden, over: over }); })()`));
    assert.deepEqual(z.over, [], 'слои не ниже замка: ' + z.over.join(', '));
  } finally { await t.done(); }
});

test('2, 5: запрет записи, восстановление из файла, сохранение повреждённых данных, уборка карантина', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    // 5: старые копии карантина чистятся при запуске, свежая остаётся
    const old = Engine.quarantineKey('homyak_v1', Date.now() - 40 * DAY), fresh = Engine.quarantineKey('homyak_v1', Date.now() - 2 * DAY);
    await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(t.real)}); localStorage.setItem(${JSON.stringify(old)}, 'old'); localStorage.setItem(${JSON.stringify(fresh)}, 'fresh')`);
    assert.deepEqual(JSON.parse(await page.eval(`JSON.stringify([localStorage.getItem(${JSON.stringify(old)}), localStorage.getItem(${JSON.stringify(fresh)})])`)), [null, 'fresh'],
      'карантин старше 30 дней не убран (или убрана свежая копия)');
    // 5: битые данные - в окне кнопка «Сохранить повреждённые данные в файл», файл = битый текст
    await t.boot(`localStorage.setItem('homyak_v1','{"ver":3,"tx":[{"a":')`);
    const dlg = JSON.parse(await page.eval(`JSON.stringify({ t: document.getElementById('dlgTitle').textContent,
      b: [].map.call(document.querySelectorAll('#dlg button'), function(b){ return b.textContent; }) })`));
    assert.ok(dlg.b.indexOf('Сохранить повреждённые данные в файл') >= 0, 'нет кнопки сохранения повреждённых данных: ' + dlg.b.join(' | '));
    assert.ok(!dlg.b.some((x) => /заново|Стереть|Удалить/i.test(x)), 'в окне появилось стирание данных: ' + dlg.b.join(' | '));
    const saved = JSON.parse(await page.eval(`(function(){ window.__saved = null; window.isNativeApp = function(){ return true; };
      window.NativePlugins = Object.assign({}, window.NativePlugins || {}, { SaveFile: { save: function(o){ window.__saved = o; return Promise.resolve({ ok: true }); } } });
      [].filter.call(document.querySelectorAll('#dlg button'), function(b){ return b.textContent === 'Сохранить повреждённые данные в файл'; })[0].click();
      return new Promise(function(r){ setTimeout(function(){ var o = window.__saved; r(JSON.stringify(o && { name: o.name, text: decodeURIComponent(escape(atob(o.base64))) })); }, 300); }); })()`));
    assert.ok(saved, 'файл не сохранялся');
    assert.equal(saved.text, '{"ver":3,"tx":[{"a":', 'в файле не битый текст');
    assert.match(saved.name, /повреждён/i);
    assert.equal(await page.eval(`(JSON.parse(localStorage.getItem('homyak_v1.backup') || '{}').lastAt || 0) > 0`), false, 'повреждённые данные засчитаны как копия');
    // 2: копии не легло (хранилище забито) → только чтение; восстановление из файла снимает полосу
    await t.boot(`localStorage.setItem('homyak_v1','{"broken":'+ 'x'.repeat(1500000));
      var big='y'.repeat(500000); try{ for(var i=0;i<40;i++) localStorage.setItem('fill'+i, big);}catch(e){}`);
    assert.equal(await page.eval('UI.isReadOnly()'), true);
    await page.eval(`UI.save(); 1`);
    assert.equal(await page.eval(`document.getElementById('saveWarn').hidden`), false, 'полосы нет в режиме только чтения');
    await page.eval(`(function(){ for (var i=0;i<40;i++) localStorage.removeItem('fill'+i); UI.closeDlg(); return 1; })()`);
    await page.eval(`(function(){ Backup.restoreText(${JSON.stringify(JSON.stringify({ app: 'homyak', state: t.S }))}); document.getElementById('dlgBtns').lastChild.click(); return 1; })()`);
    await sleep(200);
    const after = JSON.parse(await page.eval(`JSON.stringify({ ro: UI.isReadOnly(), banner: !document.getElementById('saveWarn').hidden })`));
    assert.deepEqual(after, { ro: false, banner: false }, 'после восстановления полоса «Изменения сейчас не сохраняются» осталась');
  } finally { await t.done(); }
});

// 3: карточка «Сохрани копию» не перекрывает слои и шапку
const REMIND_SIZES = [[360, 640], [375, 812]];
test('3: карточка «Сохрани копию» не поверх меню, экрана суммы, окна и шапки «Потрачено»', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    const out = process.env.REVIEW103_SHOTS || null;
    for (const [w, h] of REMIND_SIZES) {
      for (const theme of ['dark', 'light']) {
        const S = JSON.parse(t.real); S.ui.theme = theme;
        await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(JSON.stringify(S))})`, w, h);
        await page.eval(`(function(){ Nudges.hideRemind(); localStorage.removeItem(Nudges.BKEY); return Nudges.checkRemind(); })()`);
        await page.eval(`(function(){ var el = document.getElementById('remind'); if (el.getAnimations) el.getAnimations().forEach(function(a){ a.finish(); }); return 1; })()`);
        const tag = w + 'x' + h + '-' + theme;
        assert.equal(await page.eval('Nudges.remindShown()'), true, tag + ': карточка не показалась');
        if (out) await page.shot(path.join(out, 'remind-main-' + tag + '.png'));
        // шапка «Потрачено» видна
        const head = await page.eval(`(function(){ var r = document.getElementById('sumSpent').getBoundingClientRect();
          var e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !e.closest('#remind'); })()`);
        assert.equal(head, true, tag + ': карточка закрывает «Потрачено»');
        // карточка целиком на экране и не на шапке
        const box = JSON.parse(await page.eval(`(function(){ var r = document.getElementById('remind').getBoundingClientRect(), s = document.getElementById('sumSpent').getBoundingClientRect();
          return JSON.stringify({ top: r.top, bottom: r.bottom, H: innerHeight, overlap: !(r.bottom <= s.top || r.top >= s.bottom) }); })()`));
        assert.ok(box.top >= 0 && box.bottom <= box.H && !box.overlap, tag + ': ' + JSON.stringify(box));
        // меню: все плитки доступны (центр каждой - сама плитка, не карточка)
        await page.eval(`UI.openMenu(); 1`); await sleep(450);
        if (out) await page.shot(path.join(out, 'remind-menu-' + tag + '.png'));
        const menu = JSON.parse(await page.eval(`(function(){ var bad = []; [].forEach.call(document.querySelectorAll('#menu .mi'), function(m){
          var r = m.getBoundingClientRect(); if (!r.width) return; var e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!e || !m.contains(e)) bad.push((m.id || m.className) + '→' + (e ? (e.closest('#remind') ? 'REMIND' : (e.id || e.className)) : 'нет')); });
          var hd = document.elementFromPoint(180, 40); return JSON.stringify({ bad: bad, head: hd && hd.closest('#remind') ? 'REMIND' : 'ok' }); })()`));
        assert.deepEqual(menu, { bad: [], head: 'ok' }, tag + ': меню перекрыто');
        await page.eval(`UI.closeMenu(); 1`); await sleep(300);
        // экран суммы и окно: верхний слой - не карточка, ни в одной точке
        for (const [name, open, close] of [
          ['сумма', `UI.openAmount({ kind: 'exp', walletId: UI.S.wallets[0].id, catId: UI.S.categories.exp[0].id })`, `UI.closeAmount()`],
          ['окно', `UI.dlgAlert('Проверка', 'Окно')`, `UI.closeDlg()`],
          ['карточка', `UI.openCard({ kind: 'exp', id: UI.S.categories.exp[0].id })`, `UI.closeTop()`]
        ]) {
          await page.eval(`(function(){ ${open}; return 1; })()`); await sleep(500);
          if (out && name === 'сумма') await page.shot(path.join(out, 'remind-amount-' + tag + '.png'));
          const hits = await page.eval(`(function(){ var n = 0; for (var y = 10; y < innerHeight; y += 20) for (var x = 10; x < innerWidth; x += 40) {
            var e = document.elementFromPoint(x, y); if (e && e.closest('#remind')) n++; } return n; })()`);
          assert.equal(hits, 0, tag + ': карточка поверх слоя «' + name + '» в ' + hits + ' точках');
          await page.eval(`(function(){ ${close}; return 1; })()`); await sleep(350);
        }
        // главный экран: кнопка «плюс» не под карточкой
        const fab = await page.eval(`(function(){ var f = document.getElementById('fabAdd'); if (f.hidden) return 'hidden'; var r = f.getBoundingClientRect();
          var e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && f.contains(e) ? 'ok' : 'covered'; })()`);
        assert.notEqual(fab, 'covered', tag + ': карточка накрыла кнопку «плюс»');
      }
    }
  } finally { await t.done(); }
});

// 05.10.2026, найдено Алексеем на телефоне: при купленном доступе на «+» кошелька висел 🔒,
// хотя добавить кошелёк давало. Первая отрисовка (ui.js) идёт раньше purchase.js, когда
// UI.hasFullAccess ещё нет, а кэш покупки Pay поднят уже до неё - и без перерисовки замок
// оставался до первого действия.
test('купленный доступ: на «+» нет замка сразу после запуска', EDGE, async () => {
  const t = await bootShip();
  try {
    const { page } = t;
    const S = JSON.parse(t.real);
    while (S.wallets.length < 3) Engine.addWallet(S, { name: 'W' + S.wallets.length });
    // кэш-флаг покупки ровно так, как его пишет pay.js markPurchased (xor 0x5c + base64)
    const flag = Buffer.from(String.fromCharCode('1'.charCodeAt(0) ^ 0x5c), 'binary').toString('base64');
    await t.boot(`localStorage.setItem('homyak_v1', ${JSON.stringify(JSON.stringify(S))}); localStorage.setItem('homyak.pf', ${JSON.stringify(flag)})`);
    assert.equal(await page.eval(`!!(window.UI.hasFullAccess && window.UI.hasFullAccess())`), true, 'доступ не поднялся из кэша');
    const locks = await page.eval(`document.querySelectorAll('#app .addtile.locked, #app .add-lock').length`);
    assert.equal(locks, 0, 'при купленном доступе на «+» висит замок: ' + locks);
  } finally { await t.done(); }
});
