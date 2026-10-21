/* update-sdk.test.js - 1.0.3: стор-сборка проверяет обновления через RuStore App Update SDK
   (плагин RuStoreUpdate, как в «Карте года»), свой манифест на CDN больше не читает.
   Чистая часть update.js + поведение check()/silentCheck() в стор- и тест-сборке на
   подложенных window/UI/плагине + заслоны по исходникам оболочки. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../build-lib.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const U = require('../www/update.js');

// ---------- чистая часть ----------

test('decideSdk: RuStore нашёл версию новее → store с versionCode', () => {
  assert.deepEqual(U.decideSdk({ ok: true, available: true, versionCode: 20007, currentVersionCode: 20005 }), { kind: 'store', versionCode: 20007 });
  // номер не пришёл - всё равно «есть» (RuStore так умеет), без номера
  assert.deepEqual(U.decideSdk({ ok: true, available: true }), { kind: 'store', versionCode: 0 });
});

test('decideSdk: новее нет / та же / старше → none', () => {
  assert.deepEqual(U.decideSdk({ ok: true, available: false, versionCode: 20007, currentVersionCode: 20005 }), { kind: 'none' });
  assert.deepEqual(U.decideSdk({ ok: true, available: true, versionCode: 20005, currentVersionCode: 20005 }), { kind: 'none' });
  assert.deepEqual(U.decideSdk({ ok: true, available: true, versionCode: 20003, currentVersionCode: 20005 }), { kind: 'none' });
});

test('decideSdk: нет RuStore / сбой SDK / мусор → error с честной строкой на «вы»', () => {
  const a = U.decideSdk({ ok: false, reason: 'no-rustore' });
  assert.equal(a.kind, 'error'); assert.equal(a.message, U.MSG_NO_RUSTORE);
  assert.match(a.message, /нет приложения RuStore/);
  const b = U.decideSdk({ ok: false, reason: 'sdk', error: 'X' });
  assert.equal(b.message, U.MSG_SDK_FAIL);
  assert.match(b.message, /Проверьте интернет/);
  assert.equal(U.decideSdk(null).kind, 'error');
  assert.equal(U.decideSdk('ерунда').kind, 'error');
  for (const m of [U.MSG_NO_RUSTORE, U.MSG_SDK_FAIL]) assert.ok(!/—|Проверь |попробуй /.test(m), 'не на «вы» или с длинным тире: ' + m);
});

test('verOfCode/codeOfVer: versionCode стор-сборки ↔ номер версии (та же формула, что у сборки)', () => {
  for (const v of ['1.0.2', '1.0.3', '1.2.10', '2.0.0']) {
    const code = L.versionCodeOf(v, true);
    assert.equal(U.codeOfVer(v), code, v);
    assert.equal(U.verOfCode(code), v, v);
  }
  assert.equal(U.verOfCode(20006), '', 'чётный код - тест-сборка, номер не выдумываем');
  assert.equal(U.verOfCode(0), '');
  assert.equal(U.verOfCode('мусор'), '');
});

test('stillNewer: найденная версия гаснет, когда её поставили', () => {
  assert.equal(U.stillNewer(20007, '1.0.2'), true);
  assert.equal(U.stillNewer(20007, '1.0.3'), false, 'поставили ровно её');
  assert.equal(U.stillNewer(20007, '1.0.4'), false, 'поставили новее');
  assert.equal(U.stillNewer(20007, null), true, 'оболочка ещё не ответила - не гасим');
  assert.equal(U.stillNewer('unknown', '1.0.9'), true, 'без номера - до следующей проверки');
  assert.equal(U.stillNewer(0, '1.0.2'), false);
});

test('weekDue: раз в неделю; метка из будущего - пора', () => {
  const W = 7 * 86400000, T = 1790000000000;
  assert.equal(U.weekDue(0, T), true);
  assert.equal(U.weekDue(T - W + 1, T), false);
  assert.equal(U.weekDue(T - W, T), true);
  assert.equal(U.weekDue(T + 5000, T), true, 'часы перевели назад');
});

test('checkSdk: ответ плагина, отказ, зависание, нет плагина - никогда не отклоняется', async () => {
  assert.deepEqual(await U.checkSdk({ native: { checkUpdate: () => Promise.resolve({ ok: true, available: true, versionCode: 20007, currentVersionCode: 20005 }) } }),
    { kind: 'store', versionCode: 20007 });
  assert.equal((await U.checkSdk({ native: { checkUpdate: () => Promise.reject(new Error('x')) } })).kind, 'error');
  assert.equal((await U.checkSdk({ native: { checkUpdate: () => { throw new Error('sync'); } } })).kind, 'error');
  const hang = await U.checkSdk({ timeout: 50, native: { checkUpdate: () => new Promise(() => {}) } });
  assert.deepEqual(hang, { kind: 'error', message: U.MSG_SDK_FAIL });
  assert.deepEqual(await U.checkSdk({ native: null }), { kind: 'error', message: U.MSG_NO_RUSTORE });
});

test('startSdkUpdate: окно RuStore; отказ или нет плагина - страница RuStore в браузере', async () => {
  const opened = [];
  const ext = (u) => opened.push(u);
  const r1 = await U.startSdkUpdate({ native: { startUpdate: () => Promise.resolve({ ok: true, via: 'sdk' }) } }, ext);
  assert.equal(r1.via, 'sdk'); assert.deepEqual(opened, []);
  const r2 = await U.startSdkUpdate({ native: { startUpdate: () => Promise.resolve({ ok: false, reason: 'flow' }) } }, ext);
  assert.equal(r2.via, 'web'); assert.deepEqual(opened, [U.URL_RUSTORE]);
  await U.startSdkUpdate({ native: { startUpdate: () => Promise.reject(new Error('x')) } }, ext);
  await U.startSdkUpdate({ native: null }, ext);
  assert.equal(opened.length, 3);
});

// ---------- поведение: стор не читает манифест, тест-сборка - читает ----------

function harness(store) {
  const dlgs = [], fetched = [], ls = new Map();
  const prev = { window: global.window, document: global.document, fetch: global.fetch };
  // #updWait - окно «Спрашиваю RuStore…» на экране (результат показывается только поверх него)
  global.document = { getElementById: (id) => (id === 'updWait' ? {} : null), addEventListener() {}, visibilityState: 'visible' };
  global.fetch = (u) => { fetched.push(String(u)); return Promise.reject(new TypeError('Failed to fetch')); };
  global.window = {
    Access: { STORE: store }, SHELL_VERSION: '1.0.2', APP_VERSION: '1.0.2',
    addEventListener() {},
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    UI: { openDlg: (o) => dlgs.push(o), esc: (s) => String(s), renderMenu() {}, openExternal() {}, closeMenu() {} }
  };
  delete require.cache[require.resolve('../www/update.js')];
  const Up = require('../www/update.js');
  Up.mount();
  return {
    Up, dlgs, fetched, ls,
    done() {
      Object.assign(global, prev);
      delete require.cache[require.resolve('../www/update.js')];
    }
  };
}

test('стор: «Проверить» спрашивает RuStore, манифест на CDN не запрашивается; нашлась - «Обновить»', async () => {
  const h = harness(true);
  try {
    let asked = 0, started = 0;
    const native = {
      checkUpdate: () => { asked++; return Promise.resolve({ ok: true, available: true, versionCode: 20007, currentVersionCode: 20005 }); },
      startUpdate: () => { started++; return Promise.resolve({ ok: true, via: 'sdk' }); }
    };
    h.Up._sdk(native);
    const d = await h.Up.check();
    assert.equal(d.kind, 'store');
    assert.equal(asked, 1);
    assert.deepEqual(h.fetched, [], 'стор-сборка полезла в сеть: ' + h.fetched.join(', '));
    const last = h.dlgs[h.dlgs.length - 1];
    assert.equal(last.title, 'Есть обновление');
    assert.match(last.body, /Версия 1\.0\.3 ждёт в RuStore/);
    const btn = last.buttons.find((b) => b.label === 'Обновить');
    assert.ok(btn, 'нет кнопки «Обновить»');
    btn.onClick();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(started, 1, '«Обновить» не запустил обновление через SDK');
    assert.equal(h.Up.newer(), '1.0.3', 'точка «есть обновление» не встала');
    assert.equal(h.ls.get(h.Up.K_NEWER), '20007', 'найденная версия не запомнилась между запусками');
    assert.ok(h.ls.get(h.Up.K_CHECK), 'удачная проверка не сдвинула метку недели');
  } finally { h.done(); }
});

test('стор: нет RuStore - честное окно с «Повторить», метка недели не сдвигается, сети нет', async () => {
  const h = harness(true);
  try {
    h.Up._sdk({ checkUpdate: () => Promise.resolve({ ok: false, reason: 'no-rustore' }) });
    const d = await h.Up.check();
    assert.equal(d.kind, 'error');
    const last = h.dlgs[h.dlgs.length - 1];
    assert.ok(last.body.indexOf(U.MSG_NO_RUSTORE) >= 0);
    assert.ok(last.buttons.some((b) => b.label === 'Повторить'));
    assert.equal(h.ls.get(h.Up.K_CHECK), undefined);
    assert.deepEqual(h.fetched, []);
  } finally { h.done(); }
});

test('стор: тихая недельная проверка - через SDK, поставили версию - точка гаснет', async () => {
  const h = harness(true);
  try {
    h.Up._sdk({ checkUpdate: () => Promise.resolve({ ok: true, available: true, versionCode: 20007, currentVersionCode: 20005 }) });
    h.ls.delete(h.Up.K_CHECK);
    const r = await h.Up.weeklyCheck();
    assert.equal(r.kind, 'store');
    assert.deepEqual(h.fetched, []);
    assert.equal(h.Up.newer(), '1.0.3');
    // вторая проверка в ту же неделю не ходит в RuStore
    let asked = 0;
    h.Up._sdk({ checkUpdate: () => { asked++; return Promise.resolve({ ok: true, available: false }); } });
    assert.equal(await h.Up.weeklyCheck(), null);
    assert.equal(asked, 0);
    // обновились до 1.0.3 - отметка снимается
    global.window.SHELL_VERSION = '1.0.3';
    assert.equal(h.Up.newer(), '');
    assert.equal(h.ls.has(h.Up.K_NEWER), false);
  } finally { h.done(); }
});

test('тест-сборка: SDK не зовётся (тот же applicationId), проверка - как раньше, своим манифестом по www', async () => {
  const h = harness(false);
  try {
    let asked = 0;
    h.Up._sdk({ checkUpdate: () => { asked++; return Promise.resolve({ ok: true, available: true, versionCode: 99999 }); } });
    await h.Up.check({ fetch: (u) => { h.fetched.push(u); return Promise.reject(new TypeError('Failed to fetch')); } });
    assert.equal(asked, 0, 'тест-сборка позвала RuStore SDK');
    const urls = [...new Set(h.fetched.filter((u) => /update\.json/.test(u)))];
    assert.deepEqual(urls, ['https://www.dorokhin-finance.ru/homyak-store/update.json']);
  } finally { h.done(); }
});

// ---------- оболочка ----------

test('оболочка: плагин RuStoreUpdate есть, зарегистрирован до super.onCreate, SDK из BOM, RuStore виден', () => {
  const java = rd('android/app/src/main/java/ru/dorokhin/budgetphone/RuStoreUpdatePlugin.java');
  assert.match(java, /^package ru\.dorokhin\.budgetphone;/m);
  assert.match(java, /@CapacitorPlugin\(name = "RuStoreUpdate"\)/);
  assert.match(java, /RuStoreAppUpdateManagerFactory\.INSTANCE\.create/);
  assert.match(java, /AppUpdateType\.IMMEDIATE/);
  const main = rd('android/app/src/main/java/ru/dorokhin/budgetphone/MainActivity.java');
  const reg = main.indexOf('registerPlugin(RuStoreUpdatePlugin.class)');
  assert.ok(reg > 0 && reg < main.indexOf('super.onCreate(savedInstanceState)'), 'плагин регистрируется после super.onCreate - мост его не увидит');
  const g = rd('android/app/build.gradle');
  assert.match(g, /implementation platform\('ru\.rustore\.sdk:bom:2026\.08\.01'\)/);
  assert.match(g, /implementation 'ru\.rustore\.sdk:appupdate'/);
  assert.match(rd('android/build.gradle'), /nexus-external\.rustore\.ru/);
  const m = rd('android/app/src/main/AndroidManifest.xml');
  assert.match(m, /<queries>[\s\S]*<package android:name="ru\.vk\.store" \/>[\s\S]*<\/queries>/);
  // разрешения манифеста: 1.0.4 добавила только напоминания о долгах (POST_NOTIFICATIONS,
  // RECEIVE_BOOT_COMPLETED - tests/debts-shell.test.js); RuStore Update своих не добавляет
  const perms = [...m.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(perms, ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.VIBRATE']);
  assert.match(rd('www/native.js'), /RuStoreUpdate: C\.registerPlugin\('RuStoreUpdate'\)/);
});
