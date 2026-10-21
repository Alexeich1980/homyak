/* guards.test.js - решения трёх функций 1.0.3 чистыми функциями (www/guards.js):
     1. окно оценки RuStore: когда звать и что делать после ответа SDK;
     2. замок на вход: формат кода, хэш с солью, пауза после неверных попыток,
        запирать ли после возврата из фона;
     3. напоминание «сохрани копию данных»: не чаще раза в месяц и не новичку.
   Плюс статические заслоны: плагины зарегистрированы, зависимости на месте, бэкап
   запоминает дату, скрипты подключены до ui.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../www/guards.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);   // 05.10.2026

// ---------- 1. окно оценки ----------
function txs(n, firstTs) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 't' + i, ts: firstTs + i * 1000, date: '2026-10-05' });
  return out;
}

test('оценка: первая операция - по самой ранней метке ts, без ts - по дате', () => {
  assert.equal(G.firstTxTime([{ ts: 500 }, { ts: 200 }, { ts: 900 }]), 200);
  assert.equal(G.firstTxTime([]), null);
  const byDate = G.firstTxTime([{ date: '2026-09-01' }]);
  assert.ok(byDate > Date.UTC(2026, 7, 31) && byDate < Date.UTC(2026, 8, 2), 'дата без ts');
});

test('оценка: зовём только при >=20 операциях и >=7 днях с первой', () => {
  const first = T0 - 7 * DAY;
  const ctx = (n, now) => ({ now: now, txCount: n, firstTs: first });
  assert.equal(G.reviewDue({}, ctx(20, T0)), true, '20 операций, 7 дней');
  assert.equal(G.reviewDue({}, ctx(19, T0)), false, '19 операций');
  assert.equal(G.reviewDue({}, ctx(500, T0 - 1000)), false, 'неделя ещё не прошла');
  assert.equal(G.reviewDue({}, { now: T0, txCount: 30, firstTs: null }), false, 'нет первой операции');
  assert.equal(G.reviewDue(null, ctx(20, T0)), true, 'пустое состояние');
});

test('оценка: после показа окна больше никогда', () => {
  const st = G.reviewAfter({}, { shown: true }, T0);
  assert.equal(st.done, true);
  assert.equal(G.reviewDue(st, { now: T0 + 400 * DAY, txCount: 900, firstTs: T0 - 30 * DAY }), false);
});

test('оценка: уже оценил / лимит / прочие ошибки - больше не спрашиваем', () => {
  ['REVIEW_EXISTS', 'LIMIT', 'BANNED', 'INVALID_INFO', 'ERROR', undefined].forEach((code) => {
    const st = G.reviewAfter({}, { shown: false, code: code }, T0);
    assert.equal(st.done, true, String(code));
  });
});

test('оценка: «не показано» (нет RuStore, не вошёл) - один повтор не раньше чем через 60 дней', () => {
  const ctx = (now) => ({ now: now, txCount: 50, firstTs: T0 - 30 * DAY });
  ['NOT_INSTALLED', 'UNAUTHORIZED', 'OUTDATED'].forEach((code) => {
    let st = G.reviewAfter({}, { shown: false, code: code }, T0);
    assert.equal(st.done, false, code + ': ещё не всё');
    assert.equal(G.reviewDue(st, ctx(T0 + 59 * DAY)), false, code + ': рано');
    assert.equal(G.reviewDue(st, ctx(T0 + 60 * DAY)), true, code + ': через 60 дней можно');
    // повтор снова не показал - на этом всё, третьего раза нет
    st = G.reviewAfter(st, { shown: false, code: code }, T0 + 60 * DAY);
    assert.equal(st.done, true, code + ': второй отказ - конец');
    assert.equal(G.reviewDue(st, ctx(T0 + 400 * DAY)), false);
  });
});

test('оценка: окно запущено, а ответа нет (приложение закрыли) - считаем показанным', () => {
  const st = G.reviewStart({}, T0);
  assert.equal(G.reviewDue(st, { now: T0 + 90 * DAY, txCount: 90, firstTs: T0 - 30 * DAY }), false);
});

// ---------- 2. замок ----------
test('замок: код - ровно 4 цифры', () => {
  assert.equal(G.validPin('1234'), true);
  assert.equal(G.validPin('0000'), true);
  ['123', '12345', '12a4', '', null, 1234, '١٢٣٤'].forEach((p) => assert.equal(G.validPin(p), false, String(p)));
});

test('замок: код хранится хэшем с солью, а не открытым текстом', async () => {
  const salt = G.newSalt();
  assert.ok(typeof salt === 'string' && salt.length >= 16, 'соль');
  assert.notEqual(G.newSalt(), salt, 'соль каждый раз новая');
  const h1 = await G.hashPin('1234', salt);
  assert.match(h1, /^[0-9a-f]{64}$/, 'SHA-256 в hex');
  assert.ok(h1.indexOf('1234') < 0);
  assert.equal(await G.hashPin('1234', salt), h1, 'тот же код и соль - тот же хэш');
  assert.notEqual(await G.hashPin('1235', salt), h1, 'другой код');
  assert.notEqual(await G.hashPin('1234', G.newSalt()), h1, 'другая соль');
  const rec = await G.makePinRecord('4321');
  assert.equal(rec.pin, undefined, 'открытого кода в записи нет');
  assert.ok(JSON.stringify(rec).indexOf('4321') < 0, 'код не виден в записи');
  assert.equal(await G.checkPin(rec, '4321'), true);
  assert.equal(await G.checkPin(rec, '4322'), false);
  assert.equal(await G.checkPin(null, '4321'), false);
});

test('замок: 5 неверных - пауза 30 с, дальше пауза растёт; верный код сбрасывает', () => {
  let st = {};
  for (let i = 0; i < 4; i++) { st = G.lockFail(st, T0); assert.equal(G.lockWait(st, T0), 0, 'попытка ' + (i + 1)); }
  st = G.lockFail(st, T0);
  assert.equal(G.lockWait(st, T0), 30000, 'после 5-й - 30 с');
  assert.equal(G.lockWait(st, T0 + 29000), 1000);
  assert.equal(G.lockWait(st, T0 + 30000), 0, 'пауза кончилась');
  let t = T0 + 30000;
  for (let i = 0; i < 5; i++) st = G.lockFail(st, t);
  assert.equal(G.lockWait(st, t), 60000, 'вторая серия - 60 с');
  t += 60000;
  for (let i = 0; i < 5; i++) st = G.lockFail(st, t);
  assert.equal(G.lockWait(st, t), 120000, 'третья - 120 с');
  // потолок
  for (let k = 0; k < 20; k++) { t += G.LOCK.PAUSE_MAX; for (let i = 0; i < 5; i++) st = G.lockFail(st, t); }
  assert.equal(G.lockWait(st, t), G.LOCK.PAUSE_MAX, 'пауза не растёт бесконечно');
  st = G.lockOk(st);
  assert.equal(G.lockWait(st, t), 0);
  assert.equal(st.fails, 0);
  assert.equal(st.lockouts, 0);
});

test('замок: во время паузы попытки не считаются', () => {
  let st = {};
  for (let i = 0; i < 5; i++) st = G.lockFail(st, T0);
  const until = st.until;
  st = G.lockFail(st, T0 + 1000);
  assert.equal(st.until, until, 'пауза не продлилась от нажатий во время неё');
});

test('замок: после фона запираем только если прошло >= 5 минут и замок включён', () => {
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + 5 * 60000 - 1000 }), false, 'отвлёкся меньше чем на 5 минут');
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + 5 * 60000 }), true, '5 минут');
  assert.equal(G.resumeLock({ on: false, bgAt: T0, now: T0 + 600000 }), false, 'замок выключен');
  assert.equal(G.resumeLock({ on: true, bgAt: 0, now: T0 }), false, 'в фон не уходили');
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + 120000, away: true }), false,
    'своё системное окно (сохранение файла, оплата, отпечаток) - не уход хозяина');
  assert.equal(G.resumeLock({ on: true, bgAt: T0, now: T0 + 10 * 60000, away: true }), true,
    'из своего окна ушёл надолго (дольше AWAY_MAX) - запираем');
});

// ---------- 3. напоминание о копии ----------
test('копия: напоминаем, если копии не было, операций >=10, не демо', () => {
  const base = { now: T0, lastAt: 0, txCount: 10, demo: false };
  assert.equal(G.backupDue(base), true);
  assert.equal(G.backupDue(Object.assign({}, base, { txCount: 9 })), false, 'новичок');
  assert.equal(G.backupDue(Object.assign({}, base, { demo: true })), false, 'демо');
  assert.equal(G.backupDue(Object.assign({}, base, { off: true })), false, 'выключено в меню');
});

test('копия: делали в этом месяце или меньше 30 дней назад - молчим', () => {
  const base = { now: T0, txCount: 50, demo: false };
  assert.equal(G.backupDue(Object.assign({}, base, { lastAt: Date.UTC(2026, 9, 1, 9) })), false, 'в этом месяце');
  assert.equal(G.backupDue(Object.assign({}, base, { lastAt: T0 - 20 * DAY })), false, '20 дней назад (прошлый месяц)');
  assert.equal(G.backupDue(Object.assign({}, base, { lastAt: T0 - 30 * DAY })), true, '30 дней назад');
  // 30 с лишним дней, но тот же календарный месяц (копия 1-го, сейчас 31-е) - молчим
  const oct1 = new Date(2026, 9, 1, 0, 30).getTime(), oct31 = new Date(2026, 9, 31, 20, 0).getTime();
  assert.ok(oct31 - oct1 > 30 * DAY);
  assert.equal(G.backupDue(Object.assign({}, base, { now: oct31, lastAt: oct1 })), false, 'копия в этом же месяце');
});

test('копия: не чаще раза в месяц - показали или «Позже» в этом месяце, ждём следующего', () => {
  const base = { now: T0, txCount: 50, demo: false, lastAt: 0 };
  const ym = G.ymOf(T0);
  assert.equal(ym, '2026-10');
  assert.equal(G.backupDue(Object.assign({}, base, { shownYM: ym })), false, 'уже показывали в октябре');
  assert.equal(G.backupDue(Object.assign({}, base, { snoozeYM: ym })), false, '«Позже» в октябре');
  assert.equal(G.backupDue(Object.assign({}, base, { shownYM: '2026-09', snoozeYM: '2026-09' })), true, 'новый месяц');
});

// ---------- статические заслоны ----------
test('сборка: плагин оценки RuStore зарегистрирован и зависимость review подключена', () => {
  const main = read('android/app/src/main/java/ru/dorokhin/budgetphone/MainActivity.java');
  assert.match(main, /registerPlugin\(RuStoreReviewPlugin\.class\)/);
  const plug = read('android/app/src/main/java/ru/dorokhin/budgetphone/RuStoreReviewPlugin.java');
  assert.match(plug, /@CapacitorPlugin\(name = "RuStoreReview"\)/);
  assert.match(plug, /requestReviewFlow\(\)/);
  assert.match(plug, /launchReviewFlow\(/);
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /implementation 'ru\.rustore\.sdk:review'/);
  const nat = read('www/native.js');
  assert.match(nat, /RuStoreReview: C\.registerPlugin\('RuStoreReview'\)/);
  assert.match(nat, /NativeBiometric: C\.registerPlugin\('NativeBiometric'\)/);
});

test('сборка: биометрия - capacitor-native-biometric 4.2.2 в зависимостях и в Android-проекте', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['capacitor-native-biometric'] || '', /4\.2\.2/);
  assert.match(read('android/capacitor.settings.gradle'), /capacitor-native-biometric/);
  assert.match(read('android/app/capacitor.build.gradle'), /capacitor-native-biometric/);
});

test('сборка: guards.js и lock.js грузятся до ui.js (замок закрывает экран до отрисовки данных)', () => {
  const html = read('www/index.html');
  const pos = (f) => html.indexOf('<script src="' + f + '"></script>');
  ['guards.js', 'lock.js', 'nudges.js'].forEach((f) => assert.ok(pos(f) > 0, f + ' подключён'));
  assert.ok(pos('guards.js') < pos('lock.js') && pos('lock.js') < pos('ui.js'), 'guards → lock → ui');
  assert.ok(pos('nudges.js') > pos('backup.js'), 'nudges после backup.js');
  assert.match(html, /id="lock"[^>]*hidden/, 'экран замка в разметке, скрыт по умолчанию');
});

test('бэкап: после успешного сохранения запоминаем дату (для напоминания)', () => {
  const src = read('www/backup.js');
  const marks = src.match(/\bmarkBackup\(\);/g) || [];   // вызовы, не объявление
  assert.ok(marks.length >= 2, 'и на телефоне, и в браузере');
});

test('тексты новых функций: без длинного тире и без «Нравится?»/«Оцените»', () => {
  ['www/guards.js', 'www/lock.js', 'www/nudges.js'].forEach((f) => {
    const s = read(f);
    assert.ok(s.indexOf('—') < 0, f + ': длинное тире');
    assert.ok(!/Нравится|Оцени(те)? приложение/i.test(s), f + ': запрещённая RuStore просьба');
  });
});

test('замок: модуль называется AppLock, а не Lock (Lock - встроенный класс Web Locks API в WebView)', () => {
  ['www/lock.js', 'www/nudges.js', 'www/backup.js', 'www/pay.js', 'www/ui.js', 'www/selftest.js'].forEach((f) => {
    assert.ok(!/window\.Lock\b/.test(read(f)), f + ': window.Lock');
  });
  assert.match(read('www/lock.js'), /window\.AppLock = \{/);
  // FLAG_SECURE глобально не ставим (скриншоты и запись экрана у хозяина остаются)
  assert.ok(!/FLAG_SECURE/.test(read('android/app/src/main/java/ru/dorokhin/budgetphone/MainActivity.java').replace(/\/\/.*$/gm, '')));
});
