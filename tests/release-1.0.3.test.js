/* release-1.0.3.test.js - заслоны 1.0.3 (раздел В/Д TASKS.md и пункты по опыту «Честной пенсии»):
   1) окно оценки только в стор-сборке; 2) адреса сайта только через www; 3) «Сохранить как» без
   таймаута; 4) стор без ключа подписи - отказ; 5) защита от тихого затирания битых данных;
   6) CSP: стор без сети веб-части; 7) неразрывный пробел только escape; 8) полный доступ в
   сторе только покупкой/ключом; 14) store/cards: рендер падает, а не оставляет старый PNG. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../build-lib.js');
const Engine = require('../www/engine.js');
const G = require('../www/guards.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DAY = 86400000;

// Мини-окружение браузера для IIFE-скриптов www/ (nudges.js, backup.js): любой getElementById
// отдаёт заглушку элемента, таймеры - свои (fire() прокручивает время вперёд).
function sandbox(extra) {
  const timers = [];
  const el = () => ({ addEventListener() {}, click() {}, style: {}, hidden: true, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} });
  const store = new Map();
  const win = Object.assign({
    document: { getElementById: el, addEventListener() {}, createElement: el, body: { appendChild() {} }, visibilityState: 'visible' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    Promise, JSON, Date, Math, Object, Array, String, Number, Error, TextEncoder, btoa, unescape, encodeURIComponent,
    console
  }, extra || {});
  win.window = win;
  win.fire = (minMs) => { timers.splice(0).forEach((t) => { if (t.fn && t.ms >= (minMs || 0)) t.fn(); }); };
  win.timers = timers;
  return vm.createContext(win);
}
function run(ctx, file) { vm.runInContext(rd(file), ctx, { filename: file }); }

// ---------- 1. окно оценки ----------

test('1: окно оценки - только стор-сборка (Guards.reviewAllowed)', () => {
  assert.equal(G.reviewAllowed({ STORE: true }), true);
  assert.equal(G.reviewAllowed({ STORE: false, DEMO: true, FULL: true }), false);
  assert.equal(G.reviewAllowed(null), false);
  assert.equal(G.reviewAllowed(undefined), false);
});

function nudgesCtx(store) {
  const calls = [];
  const T0 = Date.now();
  const tx = []; for (let i = 0; i < 30; i++) tx.push({ ts: T0 - 10 * DAY + i });
  const ctx = sandbox({
    Access: { STORE: store, DEMO: !store, FULL: !store },
    isNativeApp: () => true,
    NativePlugins: { RuStoreReview: { requestAndLaunch: () => { calls.push('review'); return Promise.resolve({ shown: true }); } } },
    UI: { KEY: 'homyak_v1', S: { tx, ui: {} }, topOverlay: () => false, onboardOpen: () => false, renderMenu() {}, toast() {}, haptic() {} }
  });
  run(ctx, 'www/guards.js');
  ctx.Guards = ctx.Guards || ctx.window.Guards;
  run(ctx, 'www/nudges.js');
  return { ctx, calls };
}

test('1: тест-сборка на телефоне с RuStore окно оценки НЕ зовёт, стор - зовёт', async () => {
  const t = nudgesCtx(false);
  assert.equal(t.ctx.Nudges.afterTx(), false, 'тест-сборка запланировала окно оценки');
  t.ctx.fire(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(t.calls, []);
  const s = nudgesCtx(true);
  assert.equal(s.ctx.Nudges.afterTx(), true, 'стор-сборка не позвала окно при 30 операциях за 10 дней');
  s.ctx.fire(1000); await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.calls, ['review']);
});

// ---------- 2. адреса сайта ----------

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('2: в www/ нет адресов сайта без www (корень домена лёг 05.10.2026)', () => {
  const bad = [];
  for (const f of walk(path.join(ROOT, 'www'), [])) {
    const s = fs.readFileSync(f, 'utf8');
    const m = s.match(/https?:\/\/dorokhin-finance\.ru/g);
    if (m) bad.push(path.relative(ROOT, f) + ' ×' + m.length);
  }
  assert.deepEqual(bad, [], 'адреса без www: ' + bad.join(', '));
  const ui = rd('www/ui.js');
  assert.match(ui, /var PRIVACY_URL = 'https:\/\/www\.dorokhin-finance\.ru\/homyak\/privacy\.html';/);
  assert.match(ui, /var TERMS_URL = 'https:\/\/www\.dorokhin-finance\.ru\/homyak\/terms\.html';/);
  assert.match(ui, /var SITE = 'https:\/\/www\.dorokhin-finance\.ru\/';/);
});

// ---------- 3. «Сохранить как» без таймаута ----------

function backupCtx(saveImpl) {
  const alerts = [], toasts = [];
  const ctx = sandbox({
    isNativeApp: () => true,
    NativePlugins: { SaveFile: { save: saveImpl } },
    Engine: { exportJSON: () => '{"a":1}', safeFileName: (n) => n },
    UI: { KEY: 'homyak_v1', dlgAlert: (t) => alerts.push(t), toast: (t) => toasts.push(t), haptic() {}, closeMenu() {} }
  });
  run(ctx, 'www/backup.js');
  return { ctx, alerts, toasts };
}

test('3: окно «Сохранить как» открыто дольше 30 с - ложной ошибки «долго не отвечал» нет', async () => {
  let resolveSave;
  const b = backupCtx(() => new Promise((r) => { resolveSave = r; }));
  const p = b.ctx.Backup.backup();
  b.ctx.fire();                          // прошло сколько угодно времени: все таймеры сработали
  await new Promise((r) => setImmediate(r));
  resolveSave({ ok: true });             // человек наконец выбрал папку
  const name = await p;
  assert.deepEqual(b.alerts, [], 'показали ошибку, пока человек выбирал папку: ' + b.alerts.join(' | '));
  assert.ok(name && /Хомяк-бэкап/.test(name), 'файл не засчитан сохранённым');
  assert.equal(b.toasts.length, 1);
  assert.ok(!/T_SAVE\s*=\s*30000/.test(rd('www/backup.js')), 'таймаут 30 с остался в исходнике');
});

test('3: таймаут остаётся только явным (для проверок) и тогда честно срабатывает', async () => {
  const b = backupCtx(() => new Promise(() => {}));
  const p = b.ctx.Backup.backup({ timeout: 10 });
  b.ctx.fire();
  await p;
  assert.equal(b.alerts.length, 1);
  assert.match(b.alerts[0], /долго не отвечал/);
});

// ---------- 4. подпись ----------

test('4: стор/релиз без ключа подписи - отказ, тест-сборка - debug можно', () => {
  assert.throws(() => L.signingPlan({ release: true, store: true }, false), /без своего ключа подписи/);
  assert.throws(() => L.signingPlan({ release: true, store: false }, false), /без своего ключа подписи/);
  assert.deepEqual(L.signingPlan({ release: true, store: true }, true), { task: 'assembleRelease', debug: false });
  assert.deepEqual(L.signingPlan({ release: false, store: false }, false), { task: 'assembleDebug', debug: true });
  assert.deepEqual(L.signingPlan({}, true), { task: 'assembleRelease', debug: false });
});

test('4: build-apk.js проверяет ключ до self-test и Gradle, debug-задача только из signingPlan', () => {
  const s = rd('build-apk.js');
  const at = s.indexOf('L.signingPlan(MODE, hasKey)');
  assert.ok(at > 0, 'нет вызова signingPlan');
  assert.ok(at < s.indexOf('[0/3] Самопроверка'), 'ключ проверяется после self-test');
  assert.ok(at < s.indexOf("path.join(ANDROID, 'gradlew.bat')"), 'ключ проверяется после Gradle');
  assert.ok(/const task = SIGN\.task;/.test(s));
  assert.ok(!/hasKey \? 'assembleRelease' : 'assembleDebug'/.test(s), 'остался тихий откат на debug');
});

// ---------- 5. защита от тихого затирания ----------

function memStore(o) {
  o = o || {};
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (o.full) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k)
  };
}

test('5: classifyStored - пусто ≠ битое ≠ не открылось', () => {
  assert.equal(Engine.classifyStored(null, null).kind, 'empty');
  assert.equal(Engine.classifyStored('', null).kind, 'empty');
  assert.equal(Engine.classifyStored('{"ver":1}', new Error('x')).kind, 'unreadable');
  for (const raw of ['{обрезан', '"строка"', '[1,2]', 'null', '42']) assert.equal(Engine.classifyStored(raw, null).kind, 'broken', raw);
  const ok = Engine.classifyStored(JSON.stringify(Engine.defaultState()), null);
  assert.equal(ok.kind, 'ok');
  assert.ok(Array.isArray(ok.state.tx) && Array.isArray(ok.state.wallets));
});

test('5: карантин - своя копия на каждую порчу, вторая не затирает первую, копия проверена чтением', () => {
  const st = memStore();
  const now = new Date(2026, 9, 5, 18, 30, 5);
  const a = Engine.quarantine(st, 'homyak_v1', '{первая', now);
  const b = Engine.quarantine(st, 'homyak_v1', '{вторая', now);
  assert.equal(a.key, 'homyak_v1.broken-2026-10-05T18-30-05');   // gitleaks:allow - имя ключа хранилища, не секрет
  assert.notEqual(a.key, b.key);
  assert.equal(st.getItem(a.key), '{первая');
  assert.equal(st.getItem(b.key), '{вторая');
  assert.ok(a.copied && b.copied);
  // хранилище молча не записало (без исключения) - проверка чтением это видит
  const deaf = { getItem: () => null, setItem() {}, removeItem() {} };
  assert.equal(Engine.quarantine(deaf, 'homyak_v1', '{x', now).copied, false, 'запись молча не легла, а мы сказали «легла»');
  const full = memStore({ full: true });
  assert.equal(Engine.quarantine(full, 'homyak_v1', '{x', now).copied, false, 'нет места - копия не легла, а мы сказали «легла»');
});

test('5: ui.js - копии нет или хранилище не открылось → запись запрещена, восстановление из файла снимает запрет', () => {
  const ui = rd('www/ui.js');
  assert.match(ui, /if \(!q\.copied\) readOnly = true;/);
  assert.match(ui, /readOnly = true; recovered = true; loadProblem = \{ kind: 'unreadable' \}/);
  assert.match(ui, /function save\(\) \{\s*\/\/[^\n]*\n\s*if \(readOnly\) \{ saveBanner\(true\); return false; \}/);
  assert.match(ui, /if \(recovered && !readOnly\) save\(\);/);
  assert.ok(!/^if \(recovered\) save\(\);/m.test(ui), 'осталась безусловная запись поверх битого');
  assert.match(rd('www/backup.js'), /if \(UI\.allowWrite\) UI\.allowWrite\(\);\s*UI\.save\(\);/);
});

// ---------- 6. CSP ----------

test('6: CSP - один мета-тег; превью/тест - свои файлы и свой сайт; стор - сеть закрыта', () => {
  const html = rd('www/index.html');
  const csp = L.cspOf(html);
  assert.ok(csp.indexOf(L.CSP_CONNECT_DEV) >= 0);
  assert.ok(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp));
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP стоит после первого скрипта');
  const store = L.cspOf(L.shipCsp(html));
  assert.ok(store.indexOf("connect-src 'none'") >= 0);
  assert.ok(store.indexOf('dorokhin-finance') < 0, 'в стор-CSP остался сайт');
  assert.throws(() => L.cspOf('<html></html>'), /ровно один мета-тег CSP/);
});

test('6: makeShip - стор получает connect-src \'none\', тест-сборка - нет', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-csp-'));
  try {
    L.makeShip(path.join(ROOT, 'www'), path.join(dir, 's'), { release: true, store: true });
    L.makeShip(path.join(ROOT, 'www'), path.join(dir, 't'), {});
    const s = L.cspOf(fs.readFileSync(path.join(dir, 's', 'index.html'), 'utf8'));
    const t = L.cspOf(fs.readFileSync(path.join(dir, 't', 'index.html'), 'utf8'));
    assert.ok(s.indexOf("connect-src 'none'") >= 0, s);
    assert.ok(t.indexOf(L.CSP_CONNECT_DEV) >= 0, t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('6: стор не читает files.json (заводская копия OTA ему не нужна) - confirmBoot выходит до fetch', () => {
  const u = rd('www/update.js');
  const at = u.indexOf('function confirmBoot()');
  const body = u.slice(at, u.indexOf('\n  }\n', at));
  // стор выходит до ensureBase (files.json не читает), но папку ota/ от 1.0.2 убирает (ревью 1.0.3)
  assert.ok(body.indexOf('if (isStore()) return dropOta(') > 0, 'confirmBoot в сторе идёт за files.json');
  assert.ok(body.indexOf('if (isStore())') < body.indexOf('ensureBase('));
});

// ---------- 7. неразрывный пробел ----------

test('7: в коде нет литерального неразрывного пробела - только \\u00a0', () => {
  const files = walk(path.join(ROOT, 'www'), []).concat(walk(path.join(ROOT, 'tests'), []), walk(path.join(ROOT, 'tools'), []))
    .filter((f) => /\.(js|html|css)$/.test(f));
  const bad = files.filter((f) => fs.readFileSync(f, 'utf8').indexOf('\u00a0') >= 0).map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, [], 'литеральный NBSP в: ' + bad.join(', '));
  assert.equal(Engine.NBSP, '\u00a0');
  assert.equal(Engine.fmt(1234567.5), '1\u00a0234\u00a0567,50');
  assert.equal(Engine.fmt(-5000), '\u22125\u00a0000');
  assert.equal(Engine.fmtCompact ? typeof Engine.fmtCompact : 'function', 'function');
});

test('7: «число ₽/%» склеено неразрывным пробелом в коде экранов (не обычным)', () => {
  const bad = [];
  for (const f of ['anim', 'edit', 'sheet', 'summary', 'ui']) {
    rd('www/' + f + '.js').split('\n').forEach((ln, i) => {
      const t = ln.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (/' ₽|' %|\d ₽/.test(ln)) bad.push(f + '.js:' + (i + 1) + ' ' + t.slice(0, 80));
    });
  }
  assert.deepEqual(bad, []);
});

// ---------- 8. полный доступ ----------

test('8: стор-сборка - полный доступ только покупкой или ключом; тест-сборка - демо и полный доступ', () => {
  // флаги, которые makeShip вшивает в стор и в тест (их читает access.js)
  const storeTag = L.flagsTag({ release: true, store: true });
  const testTag = L.flagsTag({});
  const accessIn = (tag) => {
    const ctx = vm.createContext({});
    ctx.window = ctx; ctx.self = ctx;
    if (tag) vm.runInContext(tag.replace(/<\/?script>/g, ''), ctx);
    vm.runInContext(rd('www/access.js'), ctx);
    return ctx.Access;
  };
  const S = accessIn(storeTag), T = accessIn(testTag);
  assert.equal(S.FULL, false, 'стор: полный доступ открыт без покупки');
  assert.equal(S.DEMO, false);
  assert.equal(S.STORE, true);
  assert.equal(S.RELEASE, true, 'стор: параметры адреса (?demo) должны игнорироваться');
  assert.equal(T.FULL, true, 'тест-сборка задумана с полным доступом (RELEASE.md)');
  assert.equal(T.DEMO, true);
  assert.equal(T.STORE, false);
  // единый источник правды - UI.hasFullAccess (purchase.js): в сторе только ключ или покупка
  const door = (access, lic, paid) => {
    const ctx = sandbox({ Access: access, UI: {}, License: { isActiveSync: () => lic }, Pay: { isPurchasedSync: () => paid } });
    run(ctx, 'www/purchase.js');
    return ctx.UI.hasFullAccess();
  };
  assert.equal(door(S, false, false), false, 'стор без покупки и ключа - полный доступ открыт');
  assert.equal(door(S, true, false), true, 'ключ лицензии не открыл');
  assert.equal(door(S, false, true), true, 'покупка RuStore не открыла');
  assert.equal(door(T, false, false), true, 'тест-сборка без полного доступа');
  // параметры адреса (?demo) в стор/релиз-сборке ничего не включают
  assert.match(rd('www/ui.js'), /var Q = \(typeof Access !== 'undefined' && Access\.RELEASE\) \? '' : location\.search;/);
});

// ---------- 14. store/cards ----------

// store/cards - внутренние скрипты картинок для витрины RuStore, в публичный репозиторий не входят
const NO_CARDS = !fs.existsSync(path.join(ROOT, 'store', 'cards', 'render-lib.js')) && 'внутренний файл не входит в публичный репозиторий';

test('14: store/cards - рендер падает, если Edge не записал PNG, старый файл не остаётся', { skip: NO_CARDS }, () => {
  const R = require('../store/cards/render-lib.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-cards-'));
  try {
    const out = path.join(dir, 'card.png');
    fs.writeFileSync(out, Buffer.concat([R.PNG_SIG, Buffer.alloc(64)]));   // «старый» PNG
    assert.throws(() => R.renderPng({ edge: 'edge.exe', exec: () => {}, url: 'file:///x', out, width: 10, height: 10 }), /не записал/);
    assert.equal(fs.existsSync(out), false, 'старый PNG остался на месте');
    assert.throws(() => R.renderPng({ edge: 'edge.exe', exec: () => { throw new Error('crash'); }, url: 'file:///x', out, width: 10, height: 10 }), /Edge упал/);
    assert.throws(() => R.renderPng({ edge: 'edge.exe', exec: () => fs.writeFileSync(out, 'не png'), url: 'file:///x', out, width: 10, height: 10 }), /не PNG/);
    const size = R.renderPng({ edge: 'edge.exe', exec: () => fs.writeFileSync(out, Buffer.concat([R.PNG_SIG, Buffer.alloc(100)])), url: 'file:///x', out, width: 10, height: 10 });
    assert.equal(size, 108);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('14: store/cards - рабочий стол ищется, жёсткого «OneDrive/Рабочий стол» в скриптах нет', { skip: NO_CARDS }, () => {
  const R = require('../store/cards/render-lib.js');
  const has = (set) => (p) => set.has(p);
  const home = path.join('C:', 'Users', 'x');
  assert.equal(R.desktopDir(home, has(new Set([path.join(home, 'Desktop')]))), path.join(home, 'Desktop'));
  assert.equal(R.desktopDir(home, has(new Set([path.join(home, 'OneDrive', 'Рабочий стол'), path.join(home, 'Desktop')]))), path.join(home, 'OneDrive', 'Рабочий стол'));
  assert.equal(R.desktopDir(home, has(new Set())), null);
  const dir = path.join(ROOT, 'store', 'cards');
  for (const f of fs.readdirSync(dir).filter((n) => /^(render-(?!lib).*|shoot-clean)\.js$/.test(n))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/'OneDrive'/.test(s), f + ': жёсткий путь OneDrive');
    assert.ok(!/execFileSync\(EDGE/.test(s), f + ': свой вызов Edge мимо render-lib (без проверки PNG)');
    assert.match(s, /require\('\.\/render-lib'\)/, f);
  }
});
