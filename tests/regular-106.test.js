/* regular-106.test.js - 1.0.6 «Регулярный платёж» (аренда, подписки): настройка в карточке
   категории расхода, вечером в день оплаты (20:00) - уведомление и окно «Записать платёж?»,
   «Ещё нет» - завтра снова до конца месяца, досрочно оплаченный месяц (один расход не меньше
   90% суммы) - тишина. Решения Алексея 21-22.10.2026 (TASKS.md, раздел 1.0.6).
   Движок - здесь; экран (карточка, окно настройки, вечернее окно, запись, «Ещё нет») - self-test
   www/selftest.js; 360x640 без прокрутки в обеих темах - последний тест этого файла (Edge). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');
const { edgePath, launchEdge, waitFor, sleep } = require('./lib/edge-cdp.js');

const ROOT = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 100000 });
  const cash = Engine.addWallet(S, { name: 'Наличные', base: 5000 });
  card.baseTs = 0; cash.baseTs = 0;
  const rent = Engine.addCategory(S, 'exp', { name: 'Аренда' });
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  return { S, card, cash, rent, food, sal };
}
let seq = 0;
function spend(S, cat, w, amount, date) {
  const t = { id: 'x' + (++seq), kind: 'exp', amount, date, ts: 1, catId: cat.id, walletId: w.id, toWalletId: null };
  S.tx.push(t);
  return t;
}
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h || 0, mi || 0, 0, 0).getTime();
// момент настройки платежа в тестах движка: начало года, ни один день оплаты 2026 ещё не прошёл (skipYm, Н2)
const T0 = at(2026, 1, 1);

test('настройка: setRegular проверяет поля, выключение хранит настройку, free - один платёж', () => {
  const { S, card, cash, rent, food, sal } = fresh();
  assert.throws(() => Engine.setRegular(S, rent.id, { amount: 0, day: 5, walletId: card.id }), /amount/);
  assert.throws(() => Engine.setRegular(S, rent.id, { amount: 35000, day: 32, walletId: card.id }), /day/);
  assert.throws(() => Engine.setRegular(S, rent.id, { amount: 35000, day: 0, walletId: card.id }), /day/);
  assert.throws(() => Engine.setRegular(S, rent.id, { amount: 35000, day: 5, walletId: 'nope' }), /wallet/);
  assert.throws(() => Engine.setRegular(S, sal.id, { amount: 35000, day: 5, walletId: card.id }), /cat/, 'у дохода регулярного платежа нет');
  const r = Engine.setRegular(S, rent.id, { amount: 35000, day: 5, walletId: card.id }, T0);
  assert.deepEqual(r, { on: true, amount: 35000, day: 5, walletId: card.id, snooze: null, skipYm: null });
  cash.hidden = true;
  assert.throws(() => Engine.setRegular(S, food.id, { amount: 100, day: 1, walletId: cash.id }), /wallet/, 'скрытый кошелёк выбрать нельзя');
  cash.hidden = false;
  // free: второй включить нельзя, первый (уже включённый) - можно править
  assert.equal(Engine.canAddRegular(S, false, rent.id), true);
  assert.equal(Engine.canAddRegular(S, false, food.id), false);
  assert.equal(Engine.canAddRegular(S, true, food.id), true);
  assert.equal(Engine.FREE.regular, 1);
  // выключение не стирает настройку и освобождает место
  Engine.setRegularOn(S, rent.id, false);
  assert.deepEqual([rent.regular.on, rent.regular.amount, rent.regular.day, rent.regular.walletId], [false, 35000, 5, card.id]);
  assert.equal(Engine.canAddRegular(S, false, food.id), true);
  // в архиве не считается
  Engine.setRegularOn(S, rent.id, true, T0);
  Engine.archiveCategory(S, rent.id, true);
  assert.equal(Engine.canAddRegular(S, false, food.id), true);
});

test('хранение: migrate сохраняет платёж, чистит мусор, переживает копию в файл', () => {
  const { S, card, rent, food, sal } = fresh();
  Engine.setRegular(S, rent.id, { amount: 35000, day: 31, walletId: card.id }, T0);
  rent.regular.snooze = '2026-10-06';
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.deepEqual(M.categories.exp.find((c) => c.id === rent.id).regular,
    { on: true, amount: 35000, day: 31, walletId: card.id, snooze: '2026-10-06', skipYm: null });
  // копия в файл и обратно
  const j = Engine.exportJSON(S);
  const R = Engine.migrate(JSON.parse(j).state);
  assert.equal(R.categories.exp.find((c) => c.id === rent.id).regular.amount, 35000);
  // мусор
  const bad = JSON.parse(JSON.stringify(S));
  const fc = bad.categories.exp.find((c) => c.id === food.id);
  fc.regular = { on: 'да', amount: '100', day: 5, walletId: 7, snooze: '2026-13-01', junk: 1 };   // сумма строкой - вон
  const sc = bad.categories.inc.find((c) => c.id === sal.id);
  sc.regular = { on: true, amount: 100, day: 5, walletId: card.id };                                 // у дохода - вон
  const rc = bad.categories.exp.find((c) => c.id === rent.id);
  rc.regular = { on: 1, amount: 1e300, day: 7.9, walletId: '', snooze: 'вчера', extra: { a: 1 } };
  const B = Engine.migrate(bad);
  assert.equal('regular' in B.categories.exp.find((c) => c.id === food.id), false, 'сумма строкой - настройка не выброшена');
  assert.equal('regular' in B.categories.inc.find((c) => c.id === sal.id), false, 'регулярный платёж у дохода');
  assert.deepEqual(B.categories.exp.find((c) => c.id === rent.id).regular,
    { on: false, amount: 999999999, day: 7, walletId: null, snooze: null, skipYm: null });
  // битое целиком - не валит загрузку
  const bad2 = JSON.parse(JSON.stringify(S));
  bad2.categories.exp[0].regular = 'строка';
  assert.equal('regular' in Engine.migrate(bad2).categories.exp[0], false);
  assert.equal(Engine.normRegular({ amount: 10, day: 40 }), null);
  assert.equal(Engine.normRegular({ amount: -5, day: 3 }), null);
});

test('план: 20:00 в день оплаты, 31-е в коротком месяце - последний день, текст без сумм', () => {
  const { S, card, rent } = fresh();
  Engine.setRegular(S, rent.id, { amount: 35000, day: 31, walletId: card.id }, T0);
  const plan = Engine.reminderPlan(S, at(2026, 1, 10, 12), 3).filter((e) => e.kind === 'regular');
  assert.deepEqual(plan.map((e) => e.id), [rent.id + '|2026-01-31|r', rent.id + '|2026-02-28|r', rent.id + '|2026-03-31|r']);
  plan.forEach((e) => {
    const d = new Date(e.at);
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    assert.equal(ds, e.id.split('|')[1], 'напоминание не в день оплаты (31-е в феврале - 28-е)');
    assert.equal(d.getHours(), 20, 'не в 20:00');
    assert.equal(d.getMinutes(), 0);
    assert.equal(Engine.REGULAR_HOUR, 20);
    assert.ok(/«Аренда»/.test(e.title), 'в заголовке нет названия категории');
    assert.ok(!/\d/.test(e.title + e.text), 'в уведомлении цифры (сумма): ' + e.title + ' / ' + e.text);
    assert.ok(/Сегодня день оплаты/.test(e.title));
  });
  // день оплаты уже прошёл (в 20:00) - этого месяца в плане нет
  const late = Engine.reminderPlan(S, at(2026, 1, 31, 20, 1), 3).filter((e) => e.kind === 'regular');
  assert.deepEqual(late.map((e) => e.id), [rent.id + '|2026-02-28|r', rent.id + '|2026-03-31|r']);
  // в тот же день до 20:00 - ещё в плане
  assert.equal(Engine.reminderPlan(S, at(2026, 1, 31, 19, 59), 1).filter((e) => e.kind === 'regular').length, 1);
});

test('досрочно: один расход не меньше 90% суммы - в этом месяце не напоминаем; части не складываем', () => {
  const { S, card, cash, rent, food } = fresh();
  Engine.setRegular(S, rent.id, { amount: 35000, day: 5, walletId: card.id }, T0);
  const now = at(2026, 10, 2, 12);
  const ids = () => Engine.reminderPlan(S, now, 2).filter((e) => e.kind === 'regular').map((e) => e.id);
  assert.deepEqual(ids(), [rent.id + '|2026-10-05|r', rent.id + '|2026-11-05|r']);
  spend(S, rent, cash, 20000, '2026-10-01');
  spend(S, rent, cash, 15000, '2026-10-02');            // две части по 57% и 43% - не оплата
  assert.equal(Engine.regularPaid(S, rent.id, '2026-10'), false, 'части сложились');
  spend(S, food, card, 40000, '2026-10-01');           // другая категория - не в счёт
  assert.equal(Engine.regularPaid(S, rent.id, '2026-10'), false, 'расход другой категории засчитан');
  spend(S, rent, card, 31499, '2026-10-01');           // 89,99% - ещё нет
  assert.equal(Engine.regularPaid(S, rent.id, '2026-10'), false, 'меньше 90% засчитано');
  spend(S, rent, card, 31500, '2026-09-30');           // прошлый месяц - не в счёт
  assert.equal(Engine.regularPaid(S, rent.id, '2026-10'), false, 'расход прошлого месяца засчитан');
  spend(S, rent, card, 31500, '2026-10-01');           // ровно 90% - оплачено
  assert.equal(Engine.regularPaid(S, rent.id, '2026-10'), true);
  assert.deepEqual(ids(), [rent.id + '|2026-11-05|r'], 'оплаченный досрочно месяц всё ещё в плане');
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 5, 21)), [], 'окно при досрочной оплате');
});

test('окно в приложении: с 20:00 дня оплаты и позже, пока не записан; «Ещё нет» - завтра в 20:00 до конца месяца', () => {
  const { S, card, rent } = fresh();
  Engine.setRegular(S, rent.id, { amount: 35000, day: 30, walletId: card.id }, T0);
  assert.deepEqual(Engine.regularPending(S, at(2026, 9, 30, 19, 59)), [], 'окно до 20:00');
  const p = Engine.regularPending(S, at(2026, 9, 30, 20, 0));
  assert.equal(p.length, 1);
  assert.deepEqual(p[0], { id: rent.id, name: 'Аренда', amount: 35000, walletId: card.id, due: '2026-09-30', late: false });
  // «Ещё нет» в день оплаты - окна нет до завтрашних 20:00, в плане завтра
  assert.equal(Engine.snoozeRegular(S, rent.id, at(2026, 9, 30, 20, 5)), '2026-10-01');
  // 30 сентября - последний день: в сентябре больше не напоминаем
  assert.deepEqual(Engine.regularPending(S, at(2026, 9, 30, 22)), []);
  // октябрь: отложенное 1-е раньше дня оплаты 30-го - обычный день оплаты
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 1, 21)), []);
  assert.equal(Engine.regularPending(S, at(2026, 10, 30, 20)).length, 1);

  // середина месяца: день 5-й, «Ещё нет» 5-го и 6-го
  const f = fresh();
  Engine.setRegular(f.S, f.rent.id, { amount: 1000, day: 5, walletId: f.card.id }, T0);
  Engine.snoozeRegular(f.S, f.rent.id, at(2026, 10, 5, 20, 30));
  assert.deepEqual(Engine.regularPending(f.S, at(2026, 10, 5, 23)), [], 'после «Ещё нет» окно снова в тот же вечер');
  assert.deepEqual(Engine.regularPending(f.S, at(2026, 10, 6, 19)), [], 'на следующий день до 20:00');
  const p6 = Engine.regularPending(f.S, at(2026, 10, 6, 20));
  assert.equal(p6.length, 1);
  assert.equal(p6[0].late, true, 'день оплаты прошёл - late');
  const plan = Engine.reminderPlan(f.S, at(2026, 10, 5, 20, 31), 2).filter((e) => e.kind === 'regular');
  assert.deepEqual(plan.map((e) => [e.id, new Date(e.at).getDate(), new Date(e.at).getHours()]),
    [[f.rent.id + '|2026-10-05|r', 6, 20], [f.rent.id + '|2026-11-05|r', 5, 20]], 'после «Ещё нет» нет напоминания завтра в 20:00');
  assert.ok(/Не записан платёж «Аренда»/.test(plan[0].title));
  // приложение не открывали несколько дней: окно (late) есть и без «Ещё нет»
  const g = fresh();
  Engine.setRegular(g.S, g.rent.id, { amount: 1000, day: 5, walletId: g.card.id }, T0);
  assert.equal(Engine.regularPending(g.S, at(2026, 10, 9, 10)).length, 1, 'день оплаты прошёл, не записан - окна нет');
  // записали - окна нет
  spend(g.S, g.rent, g.card, 1000, '2026-10-09');
  assert.deepEqual(Engine.regularPending(g.S, at(2026, 10, 9, 10)), []);
  // выключение сбрасывает «Ещё нет»
  Engine.setRegularOn(f.S, f.rent.id, false);
  assert.equal(f.rent.regular.snooze, null);
});

test('кошелёк удалён или скрыт, категория в архиве, платёж выключен - напоминаний и окна нет, ничего не падает', () => {
  const { S, card, rent } = fresh();
  Engine.setRegular(S, rent.id, { amount: 500, day: 5, walletId: card.id }, T0);
  const now = at(2026, 10, 5, 21);
  const cnt = () => [Engine.reminderPlan(S, at(2026, 10, 1), 3).filter((e) => e.kind === 'regular').length, Engine.regularPending(S, now).length];
  assert.deepEqual(cnt(), [3, 1]);
  card.hidden = true;
  assert.deepEqual(cnt(), [0, 0], 'скрытый кошелёк');
  card.hidden = false;
  Engine.archiveCategory(S, rent.id, true);
  assert.deepEqual(cnt(), [0, 0], 'категория в архиве');
  Engine.archiveCategory(S, rent.id, false);
  Engine.setRegularOn(S, rent.id, false);
  assert.deepEqual(cnt(), [0, 0], 'выключен');
  Engine.setRegularOn(S, rent.id, true, T0);
  S.wallets.splice(S.wallets.indexOf(card), 1);   // кошелёк удалён
  assert.deepEqual(cnt(), [0, 0], 'удалённый кошелёк');
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.equal(M.categories.exp.find((c) => c.id === rent.id).regular.walletId, card.id, 'настройка с удалённым кошельком потерялась');
  assert.equal(Engine.regularLive(M, M.categories.exp.find((c) => c.id === rent.id)), false);
});

test('оболочка и тексты: экран блокировки - общая строка без названия, тап - id категории; политика и «Что нового»', () => {
  const recv = rd('android/app/src/main/java/ru/dorokhin/budgetphone/ReminderReceiver.java');
  assert.match(recv, /PUBLIC_TITLE_REGULAR = "Напоминание о регулярном платеже";/);
  assert.match(recv, /if \("regular"\.equals\(kind\)\) return PUBLIC_TITLE_REGULAR;/);
  const src = rd('www/regular.js');
  assert.ok(src.indexOf('—') < 0, 'длинное тире в regular.js');
  assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(src.replace(/dlg(Alert|Confirm|Prompt)/g, '')), 'нативное окно');
  assert.ok(!/<select|type=["']?(date|time|month)/.test(src), 'системный выбор');
  assert.ok(!/[0-9] [0-9]{3}|[0-9] ₽|' ₽/.test(src), 'обычный пробел перед ₽ - только \\u00a0');
  assert.ok(src.indexOf('\u00a0') < 0, 'литеральный неразрывный пробел в regular.js - только escape \\u00a0');
  assert.ok(/money\(r\.amount\) \+ '\\u00a0₽ · '/.test(src) && /money\(p\.amount\) \+ '\\u00a0₽ с кошелька/.test(src), 'сумма с ₽ без \\u00a0');
  const strs = (src.match(/'[^'\n]*[А-Яа-яЁё][^'\n]*'/g) || []).join(' ');
  assert.ok(!/(^|[^А-Яа-яЁё])(ты|тебе|тебя|твой|нажми|выбери|запиши)(?![А-Яа-яЁё])/i.test(strs), 'обращение на «ты»');
  // тексты окон - дословно (утверждены 22.10)
  assert.ok(src.indexOf("'Напомним в\\u00a020:00, если до этого не было оплаты.'") > 0, 'подсказка окна настройки (в\\u00a020:00 - время не отрывается)');
  assert.ok(src.indexOf('Записывайте, только если уже заплатили. Не оплатили\\u00a0- нажмите «Ещё нет», завтра вечером напомним снова.') > 0, 'подсказка вечернего окна');
  const pr = rd('legal/privacy.html');
  assert.match(pr, /регулярн/i, 'в политике нет регулярных платежей');
  assert.match(pr, /Редакция от 22\.10\.2026/);
  const ch = rd('CHANGELOG.md');
  const i106 = ch.indexOf('## 1.0.6'), i105 = ch.indexOf('## 1.0.5');
  assert.ok(i106 > 0 && i106 < i105, 'раздел 1.0.6 не над 1.0.5');
  assert.match(ch.slice(i106, i105), /Регулярный платёж/);
});

// ---------- ревью «сломать» 1.0.6 (23.10): движок и исходники ----------
test('Н2: включили или поправили после дня оплаты - этот месяц закрыт, первый раз в следующем; сегодня до 20:00 - сегодня', () => {
  const { S, card, rent } = fresh();
  const regIds = (now, n) => Engine.reminderPlan(S, now, n || 3).filter((e) => e.kind === 'regular').map((e) => e.id);
  // 23-го включили платёж на 5-е: ни «просрочки» сейчас, ни окна до конца месяца
  Engine.setRegular(S, rent.id, { amount: 1000, day: 5, walletId: card.id }, at(2026, 10, 23, 12));
  assert.equal(rent.regular.skipYm, '2026-10');
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 23, 21)), [], 'сразу после включения - просрочка');
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 31, 21)), [], 'в закрытом месяце окно');
  assert.deepEqual(regIds(at(2026, 10, 23, 12)), [rent.id + '|2026-11-05|r', rent.id + '|2026-12-05|r'], 'первое напоминание не в следующем месяце');
  assert.equal(Engine.regularPending(S, at(2026, 11, 5, 20, 30)).length, 1, 'в следующем месяце не напомнили');
  // день оплаты сегодня, ещё нет 20:00 - напоминаем сегодня
  Engine.setRegular(S, rent.id, { amount: 1000, day: 23, walletId: card.id }, at(2026, 10, 23, 19, 59));
  assert.equal(rent.regular.skipYm, null);
  assert.equal(regIds(at(2026, 10, 23, 19, 59))[0], rent.id + '|2026-10-23|r', 'сегодня до 20:00 - не напомнили сегодня');
  assert.equal(Engine.regularPending(S, at(2026, 10, 23, 20, 30)).length, 1);
  // сегодня, но 20:00 уже прошло - месяц закрыт
  Engine.setRegular(S, rent.id, { amount: 1000, day: 23, walletId: card.id }, at(2026, 10, 23, 20, 1));
  assert.equal(rent.regular.skipYm, '2026-10');
  // смена дня на ещё не наступивший - этот месяц открыт
  Engine.setRegular(S, rent.id, { amount: 1000, day: 28, walletId: card.id }, at(2026, 10, 23, 21));
  assert.equal(rent.regular.skipYm, null);
  assert.equal(regIds(at(2026, 10, 23, 21))[0], rent.id + '|2026-10-28|r');
  // выключатель: включили после дня оплаты - то же правило; выключение месяц не держит
  Engine.setRegular(S, rent.id, { amount: 1000, day: 5, walletId: card.id }, at(2026, 10, 1));
  Engine.setRegularOn(S, rent.id, false, at(2026, 10, 23));
  assert.equal(rent.regular.skipYm, null);
  Engine.setRegularOn(S, rent.id, true, at(2026, 10, 23));
  assert.equal(rent.regular.skipYm, '2026-10');
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 23, 21)), [], 'включили выключателем 23-го - сразу просрочка');
  Engine.setRegularOn(S, rent.id, true, at(2026, 10, 3));
  assert.equal(rent.regular.skipYm, null);
  // копия: месяц переживает migrate, мусор - вон
  rent.regular.skipYm = '2026-10';
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.equal(M.categories.exp.find((c) => c.id === rent.id).regular.skipYm, '2026-10');
  ['2026-13', 'вчера', 202610, '2026-10-01'].forEach((v) => assert.equal(Engine.normRegular({ amount: 1, day: 5, skipYm: v }).skipYm, null, 'skipYm ' + v));
});

test('Н13: сумма, которая округляется в ноль (0.001 из копии), - платёж отброшен; setRegular её не берёт', () => {
  assert.equal(Engine.normRegular({ on: true, amount: 0.001, day: 5 }), null);
  assert.equal(Engine.normRegular({ on: true, amount: 0.004, day: 5 }), null);
  assert.equal(Engine.normRegular({ on: true, amount: 0.01, day: 5 }).amount, 0.01);
  const { S, card, rent } = fresh();
  assert.throws(() => Engine.setRegular(S, rent.id, { amount: 0.001, day: 5, walletId: card.id }, T0), /amount/);
  const bad = JSON.parse(JSON.stringify(S));
  bad.categories.exp.find((c) => c.id === rent.id).regular = { on: true, amount: 0.001, day: 5, walletId: card.id };
  assert.equal('regular' in Engine.migrate(bad).categories.exp.find((c) => c.id === rent.id), false, 'платёж на 0 ₽ из копии');
});

test('Н5: регулярные платежи на кошельке - только работающие (для строки «напоминания прекратятся»)', () => {
  const { S, card, cash, rent, food } = fresh();
  assert.deepEqual(Engine.regularOnWallet(S, card.id), []);
  Engine.setRegular(S, rent.id, { amount: 1000, day: 5, walletId: card.id }, T0);
  Engine.setRegular(S, food.id, { amount: 500, day: 7, walletId: cash.id }, T0);
  assert.deepEqual(Engine.regularOnWallet(S, card.id), ['Аренда']);
  Engine.setRegular(S, food.id, { amount: 500, day: 7, walletId: card.id }, T0);
  assert.deepEqual(Engine.regularOnWallet(S, card.id), ['Аренда', 'Еда']);
  Engine.setRegularOn(S, food.id, false, T0);
  Engine.archiveCategory(S, rent.id, true);
  assert.deepEqual(Engine.regularOnWallet(S, card.id), [], 'выключенный или в архиве - не прекращается, его и так нет');
});

test('Н9: «Отменить» записанного до 20:00 платежа - сегодняшние 20:00 снова в плане', () => {
  const { S, card, rent } = fresh();
  Engine.setRegular(S, rent.id, { amount: 1000, day: 23, walletId: card.id }, T0);
  const today = rent.id + '|2026-10-23|r', now = at(2026, 10, 23, 19, 50);
  const ids = () => Engine.reminderPlan(S, now, 1).filter((e) => e.kind === 'regular').map((e) => e.id);
  assert.deepEqual(ids(), [today]);
  const t = Engine.addTx(S, { kind: 'exp', amount: 1000, date: '2026-10-23', catId: rent.id, walletId: card.id });
  assert.deepEqual(ids(), [], 'записан, а напоминание осталось');
  Engine.deleteTx(S, t.id);
  assert.deepEqual(ids(), [today], 'после «Отменить» сегодняшних 20:00 нет');
});

test('Н7: опоздавшее уведомление регулярного платежа - не дольше 4 часов (не «Сегодня» на следующий день)', () => {
  const j = rd('android/app/src/main/java/ru/dorokhin/budgetphone/ReminderReceiver.java');
  assert.match(j, /static final long LATE_MAX_REGULAR = 4L \* 3600 \* 1000;/);
  assert.match(j, /long lateMax = "regular"\.equals\(kindOf\(e\)\) \? LATE_MAX_REGULAR : LATE_MAX;\s+if \(now - at <= lateMax\) \{/);
  assert.ok(Engine.REGULAR_HOUR + 4 <= 24, '20:00 + опоздание доходит до следующего дня');
});

test('Н17: политика - повтор напоминания после «Ещё нет» до конца месяца, локально и без сумм; редакция та же', () => {
  const pr = rd('legal/privacy.html');
  assert.match(pr, /Если платёж не записан и в окне\s+Приложения выбрано «Ещё нет», напоминание повторяется в следующие дни в 20:00 до конца месяца/);
  assert.match(pr, /Все\s+эти напоминания локальные, в тексте только название категории, без сумм/);
  assert.match(pr, /Редакция от 22\.10\.2026/);
});

// 360x640 (OnePlus Алексея по ширине, низкий экран): карточка категории со строкой «Регулярный
// платёж», окно настройки и вечернее окно - без прокрутки в обеих темах (правило 18.10).
test('экран 360x640: карточка категории, окно настройки, вечернее окно - без прокрутки, обе темы', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    for (const th of ['', '&light']) {
      const page = await edge.open('about:blank', { width: 360, height: 640 });
      await page.goto('file:///' + path.join(ROOT, 'www', 'index.html').split(path.sep).join('/') + '?demo' + th);
      await waitFor(() => page.eval("!!window.APP_READY && typeof UI.editCat === 'function' && !!window.Regular"), 20000, 'приложение и регулярные платежи загрузились');
      await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
      const r = JSON.parse(await page.eval(`(async () => {
        function fit() { var d = document.getElementById('dlg'); return { sh: d.scrollHeight, ch: d.clientHeight, open: !d.hidden }; }
        var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
        var S = UI.S, c = S.categories.exp[0], w = S.wallets.filter(function (x) { return !x.hidden; })[0];
        Engine.setRegular(S, c.id, { amount: 35000, day: 5, walletId: w.id });
        UI.save();
        UI.editCat('exp', c.id);
        await wait(300);
        var out = { theme: document.body.dataset.theme, card: fit(), row: !!document.getElementById('rpRow') };
        document.getElementById('rpRow').click();
        await wait(300);
        out.setup = fit(); out.setupTitle = document.getElementById('dlgTitle').textContent;
        UI.closeDlg();
        await wait(100);
        Regular.show({ id: c.id, name: c.name, amount: 35000, walletId: w.id, due: Engine.today(), late: false });
        await wait(300);
        out.evening = fit(); out.eveningTitle = document.getElementById('dlgTitle').textContent;
        UI.closeDlg();
        return JSON.stringify(out);
      })()`));
      assert.ok(r.row, 'в карточке нет строки «Регулярный платёж»');
      assert.equal(r.setupTitle, 'Регулярный платёж');
      assert.ok(/сегодня день оплаты/.test(r.eveningTitle), r.eveningTitle);
      for (const k of ['card', 'setup', 'evening']) {
        assert.ok(r[k].open, k + ': окно не открылось');
        assert.ok(r[k].sh <= r[k].ch + 1, (th ? 'светлая' : 'тёмная') + ' тема, ' + k + ' прокручивается: ' + r[k].sh + ' > ' + r[k].ch);
      }
      assert.deepEqual(page.logs, [], 'ошибки в консоли: ' + page.logs.join(' | '));
      page.close();
    }
    await sleep(50);
  } finally { await edge.close(); }
});

// Ревью «сломать» (23.10) на настоящем экране 360x640, обе темы: Н3 - карточка категории при
// запрещённых уведомлениях без прокрутки (было 582/549), «Открыть настройки» - в окне настройки;
// Н1 - выключатель показывает настоящее «вкл», выключает всегда, включение просит разрешение;
// Н14 - ошибки суммы; Н5 - строка «напоминания прекратятся» в окнах архива/скрытия/удаления;
// Н12 - возврат из архива в free при занятом месте - платёж выключен, тост; Н8 - тап утром 1-го и
// после 23:50; Н9 - «Отменить» записанного до 20:00 - план снова с сегодняшними 20:00.
test('экран 360x640: ревью «сломать» Н1, Н3, Н5, Н8, Н9, Н12, Н14 - обе темы', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    for (const th of ['', '&light']) {
      const page = await edge.open('about:blank', { width: 360, height: 640 });
      await page.goto('file:///' + path.join(ROOT, 'www', 'index.html').split(path.sep).join('/') + '?demo' + th);
      await waitFor(() => page.eval("!!window.APP_READY && typeof UI.editCat === 'function' && !!window.Regular"), 20000, 'приложение и регулярные платежи загрузились');
      await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
      const r = JSON.parse(await page.eval(`(async () => {
        var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
        function fit() { var d = document.getElementById('dlg'); return { sh: d.scrollHeight, ch: d.clientHeight, open: !d.hidden }; }
        function txt(id) { var e = document.getElementById(id); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; }
        function asks() { return calls.filter(function (x) { return x === 'ask'; }).length; }
        var calls = [], grant = { v: false };
        Debts._plugin({
          checkPermission: function () { calls.push('check'); return Promise.resolve({ granted: grant.v }); },
          requestPermission: function () { calls.push('ask'); return Promise.resolve({ granted: grant.v }); },
          schedule: function (o) { calls.push(o); return Promise.resolve({ ok: true }); },
          openSettings: function () { calls.push('settings'); return Promise.resolve({ ok: true }); }
        });
        var S = UI.S, out = { theme: document.body.dataset.theme };
        S.ui.remindDenied = true;   // мягкое окно «Напоминания не придут» - не здесь
        var c = S.categories.exp[0], w = S.wallets.filter(function (x) { return !x.hidden; })[0];
        Engine.setRegular(S, c.id, { amount: 35000, day: 5, walletId: w.id });
        UI.save();
        await Debts.askPerm();
        out.blocked = Debts.remindBlocked();
        // Н3 + Н1: карточка при запрете
        UI.editCat('exp', c.id); await wait(300);
        out.card = fit(); out.sub = txt('rpSub'); out.pressed = document.getElementById('rpRow').getAttribute('data-on');
        out.permInCard = !!document.getElementById('rpPerm');
        // строка - вход со стрелкой (тест Алексея 23.10), выключателя в ней нет; вкл/выкл - «Напоминать» в окне
        out.rowSw = !!document.querySelector('#rpRow .mi-sw'); out.rowChev = !!document.querySelector('#rpRow .set-chev');
        var a0 = asks();
        document.getElementById('rpRow').click(); await wait(300);
        document.getElementById('rpOn').click(); document.getElementById('dlgBtns').lastChild.click(); await wait(300);
        out.off = { on: c.regular.on, pressed: document.getElementById('rpRow').getAttribute('data-on'), asked: asks() - a0, sub: txt('rpSub'),
                    kept: [c.regular.amount, c.regular.day], toast: txt('toastText') };
        document.getElementById('rpRow').click(); await wait(300);
        out.onSwOff = document.getElementById('rpOn').getAttribute('aria-pressed');
        document.getElementById('rpOn').click(); document.getElementById('dlgBtns').lastChild.click(); await wait(300);
        out.on = { on: c.regular.on, pressed: document.getElementById('rpRow').getAttribute('data-on'), asked: asks() - a0, sub: txt('rpSub') };
        // Н3: окно настройки при запрете - строка и «Открыть настройки», без прокрутки
        document.getElementById('rpRow').click(); await wait(300);
        out.setup = fit(); out.setupPerm = !!document.getElementById('rpPerm'); out.setupBody = txt('dlgBody');
        document.getElementById('rpPerm').click(); await wait(50);
        out.settings = calls.indexOf('settings') >= 0;
        // Н14: ошибки суммы
        out.amtErr = {};
        ['', '-500', 'abc', '150+300', '0,001'].forEach(function (v) {
          document.getElementById('rpAmount').value = v;
          document.getElementById('dlgBtns').lastChild.click();
          out.amtErr[v] = txt('rpErr');
        });
        UI.closeDlg(); await wait(100); UI.closeDlg(); await wait(100);
        // Н9: записали до 20:00 и «Отменить» - сегодняшние 20:00 снова в плане (время приложения - 19:00)
        grant.v = true; await Debts.askPerm();
        var realNow = Date.now, t19 = new Date(); t19.setHours(19, 0, 0, 0);
        Date.now = function () { return t19.getTime(); };
        try {
          var c9 = Engine.addCategory(S, 'exp', { name: 'Связь' });
          Engine.setRegularOn(S, c.id, false);
          Engine.setRegular(S, c9.id, { amount: 700, day: +Engine.today().slice(8, 10), walletId: w.id });
          UI.save(); UI.render(); await wait(100);
          var id9 = c9.id + '|' + Engine.today() + '|r';
          var lastPlan = function () { var s = calls.filter(function (x) { return x && x.events; }); return s.length ? s[s.length - 1].events.map(function (e) { return e.id; }) : []; };
          out.n9 = { before: lastPlan().indexOf(id9) >= 0 };
          Regular.record({ id: c9.id, amount: 700, walletId: w.id, due: Engine.today() }); await wait(150);
          out.n9.recorded = lastPlan().indexOf(id9) >= 0;
          document.getElementById('toastBtn').click(); await wait(150);
          out.n9.undone = lastPlan().indexOf(id9) >= 0;
        } finally { Date.now = realNow; }
        UI.hideToast();
        // Н8: тап утром 1-го по уведомлению последнего дня и тап после 23:50
        var c8 = Engine.addCategory(S, 'exp', { name: 'Интернет' });
        S.categories.exp.forEach(function (x) { if (x.regular && x.id !== c8.id) x.regular.on = false; });
        Engine.setRegular(S, c8.id, { amount: 900, day: 31, walletId: w.id }, new Date(2026, 9, 1).getTime());
        var p1 = Regular.pendingFor(c8.id, new Date(2026, 10, 1, 8, 0).getTime());
        var p2 = Regular.pendingFor(c8.id, new Date(2026, 9, 31, 23, 55).getTime());
        var p3 = Regular.pendingFor(c8.id, new Date(2026, 10, 2, 8, 0).getTime());
        out.n8 = { p1: p1 && [p1.due, p1.late], p2: p2 && [p2.due, p2.late], p3: p3 };
        // Н5: окна архива категории, скрытия и удаления кошелька
        UI.editCat('exp', c8.id); await wait(200);
        document.getElementById('ecatArch').click(); await wait(100);
        out.n5 = { arch: txt('dlgBody') };
        UI.closeDlg(); await wait(100);
        UI.hideWallet(w.id); await wait(100);
        out.n5.hideTitle = txt('dlgTitle'); out.n5.hide = txt('dlgBody'); out.n5.hiddenNow = !!w.hidden;
        UI.closeDlg(); await wait(100);
        UI.deleteWallet(w.id); await wait(100);
        out.n5.del = txt('dlgBody');
        UI.closeDlg(); await wait(100);
        var c0 = S.categories.exp.filter(function (x) { return !x.regular && !x.archived; })[0];
        UI.editCat('exp', c0.id); await wait(200);
        document.getElementById('ecatArch').click(); await wait(100);
        out.n5.archNone = txt('dlgBody');
        UI.closeDlg(); await wait(100);
        // Н12: free - архив с платежом, второй включили, вернули первый из архива
        var h0 = UI.hasFullAccess;
        UI.hasFullAccess = function () { return false; };
        try {
          S.categories.exp.forEach(function (x) { if (x.regular) x.regular.on = false; });
          S.categories.exp.filter(function (x) { return !x.archived; }).slice(3).forEach(function (x) { x.archived = true; });
          var live = S.categories.exp.filter(function (x) { return !x.archived; }), cA = live[0], cB = live[1];
          Engine.setRegular(S, cA.id, { amount: 30000, day: 10, walletId: w.id });
          Engine.archiveCategory(S, cA.id, true);
          Engine.setRegular(S, cB.id, { amount: 500, day: 12, walletId: w.id });
          out.n12 = { restored: UI.restoreCat('exp', cA.id) };
          await wait(50);
          out.n12.archived = !!cA.archived; out.n12.on = cA.regular.on; out.n12.kept = [cA.regular.amount, cA.regular.day, cA.regular.walletId === w.id];
          out.n12.bOn = cB.regular.on; out.n12.toast = txt('toastText');
          // место свободно - возвращается включённым
          Engine.archiveCategory(S, cA.id, true); Engine.setRegularOn(S, cA.id, true); Engine.setRegularOn(S, cB.id, false);
          UI.restoreCat('exp', cA.id);
          out.n12.freeOn = cA.regular.on;
        } finally { UI.hasFullAccess = h0; }
        Debts._plugin(null);
        return JSON.stringify(out);
      })()`));
      const tn = th ? 'светлая' : 'тёмная';
      assert.equal(r.blocked, true, 'запрет уведомлений не изображён');
      // Н3
      assert.ok(r.card.open && r.card.sh <= r.card.ch + 1, tn + ': карточка при запрете уведомлений прокручивается: ' + r.card.sh + ' > ' + r.card.ch);
      assert.ok(r.setup.open && r.setup.sh <= r.setup.ch + 1, tn + ': окно настройки при запрете прокручивается: ' + r.setup.sh + ' > ' + r.setup.ch);
      assert.equal(r.permInCard, false, 'кнопка «Открыть настройки» в карточке');
      assert.ok(r.setupPerm && r.settings, 'в окне настройки нет рабочей «Открыть настройки»');
      assert.ok(r.setupBody.indexOf('Уведомления запрещены в настройках телефона. Окно в приложении покажем и без них.') >= 0, r.setupBody);
      assert.ok(r.setupBody.indexOf('Напомним в 20:00') < 0, 'при запрете обещаем уведомление в 20:00');
      // Н1
      assert.ok(/запрещены/.test(r.sub), r.sub);
      assert.equal(r.pressed, '1', 'включённый платёж при запрете показан выключенным');
      assert.equal(r.rowSw, false, 'в строке карточки снова выключатель - её читают как тумблер');
      assert.equal(r.rowChev, true, 'у строки нет стрелки «›»');
      assert.deepEqual(r.off, { on: false, pressed: '0', asked: 0, sub: 'Выключен - нажмите, чтобы настроить', kept: [35000, 5], toast: 'Регулярный платёж выключен' },
        '«Напоминать» в окне не выключает (или теряет настройку)');
      assert.equal(r.onSwOff, 'false', 'выключенный открылся с «Напоминать» вкл');
      assert.equal(r.on.on, true, 'при запрете не включается');
      assert.equal(r.on.pressed, '1');
      assert.ok(r.on.asked >= 1, 'включение не спросило разрешение');
      assert.ok(/запрещены/.test(r.on.sub), 'после включения при запрете нет честной пометки: ' + r.on.sub);
      // Н14
      assert.deepEqual(r.amtErr, { '': 'Впишите сумму платежа', '-500': 'Сумма - положительное число', 'abc': 'Сумма - положительное число',
        '150+300': 'Сумма - положительное число', '0,001': 'Сумма - положительное число' });
      // Н9
      assert.deepEqual(r.n9, { before: true, recorded: false, undone: true }, '«Отменить» не вернул сегодняшние 20:00 в план');
      // Н8
      assert.deepEqual(r.n8.p1, ['2026-10-31', true], 'тап утром 1-го потерял платёж последнего дня');
      assert.deepEqual(r.n8.p2, ['2026-10-31', false], 'тап в 23:55 потерял платёж');
      assert.equal(r.n8.p3, null, '2-го ноября - октябрьский платёж по тапу');
      // Н5
      assert.ok(/Напоминания о регулярном платеже «Интернет» прекратятся\.$/.test(r.n5.arch), r.n5.arch);
      assert.equal(r.n5.hideTitle, 'Скрыть кошелёк?');
      assert.ok(/^Напоминания о регулярном платеже «Интернет» прекратятся\.$/.test(r.n5.hide), r.n5.hide);
      assert.equal(r.n5.hiddenNow, false, 'кошелёк скрыт без подтверждения');
      assert.ok(/Напоминания о регулярном платеже «Интернет» прекратятся\.$/.test(r.n5.del), r.n5.del);
      assert.ok(r.n5.archNone.indexOf('Напоминания') < 0, 'строка про напоминания у категории без платежа');
      // Н12
      assert.equal(r.n12.restored, true);
      assert.equal(r.n12.archived, false);
      assert.equal(r.n12.on, false, 'free: вернули из архива второй работающий платёж');
      assert.deepEqual(r.n12.kept, [30000, 10, true], 'настройка платежа потерялась');
      assert.equal(r.n12.bOn, true);
      assert.ok(/выключен: в бесплатной версии - один/.test(r.n12.toast), 'нет тоста: ' + r.n12.toast);
      assert.equal(r.n12.freeOn, true, 'место свободно, а платёж выключили');
      assert.deepEqual(page.logs, [], 'ошибки в консоли: ' + page.logs.join(' | '));
      page.close();
    }
    await sleep(50);
  } finally { await edge.close(); }
});

// Проход по USB (23.10): WebView тест-сборки без отладки, а 20:00 днём не дождаться - в окне настройки
// включённого платежа кнопка «Проверить напоминание (тестовая сборка)» (как у долга), тап по проверочному
// уведомлению открывает окно «сегодня день оплаты» и днём. В стор-сборке (Access.RELEASE) - ни кнопки,
// ни подмены окна.
test('тест-сборка: «Проверить напоминание» в окне настройки и окно по тапу днём; в стор-сборке - нет', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const src = rd('www/regular.js');
  assert.match(src, /\(testBuild\(\) && r && r\.on \? '<button type="button" class="btn ghost db-test rp-test" id="rpTest">Проверить напоминание \(тестовая сборка\)<\/button>'/);
  assert.match(src, /function testPending\(id\) \{\n  if \(!testBuild\(\) \|\| testTap !== id\) return null;/);
  const edge = await launchEdge();
  try {
    const page = await edge.open('about:blank', { width: 360, height: 640 });
    await page.goto('file:///' + path.join(ROOT, 'www', 'index.html').split(path.sep).join('/') + '?demo');
    await waitFor(() => page.eval("!!window.APP_READY && typeof UI.editCat === 'function' && !!window.Regular"), 20000, 'приложение загрузилось');
    await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
    const r = JSON.parse(await page.eval(`(async () => {
      var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
      function fit() { var d = document.getElementById('dlg'); return { sh: d.scrollHeight, ch: d.clientHeight }; }
      var calls = [];
      var fake = {
        checkPermission: function () { return Promise.resolve({ granted: true }); },
        requestPermission: function () { return Promise.resolve({ granted: true }); },
        schedule: function () { return Promise.resolve({ ok: true }); },
        test: function (o) { calls.push(o); return Promise.resolve({ ok: true }); }
      };
      Debts._plugin(fake);
      window.isNativeApp = function () { return true; };
      window.NativePlugins = { Reminders: fake };
      var S = UI.S, c = S.categories.exp[0], w = S.wallets.filter(function (x) { return !x.hidden; })[0];
      Engine.setRegular(S, c.id, { amount: 35000, day: 5, walletId: w.id });
      UI.save(); Regular._reset();
      var out = {};
      UI.editCat('exp', c.id); await wait(300);
      document.getElementById('rpRow').click(); await wait(300);
      out.btn = !!document.getElementById('rpTest'); out.fit = fit();
      document.getElementById('rpTest').click(); await wait(200);
      out.call = calls[0] || null;
      UI.closeDlg(); await wait(100);
      out.tap = Regular.fromTap(c.id, '');
      out.title = document.getElementById('dlgTitle').textContent;
      out.btns = Array.prototype.map.call(document.querySelectorAll('#dlgBtns button'), function (b) { return b.textContent; });
      UI.closeDlg(); await wait(100);
      out.again = Regular._testPending(c.id);   // тап - один раз на проверку
      // стор-сборка
      Access.RELEASE = true;
      UI.editCat('exp', c.id); await wait(300);
      document.getElementById('rpRow').click(); await wait(300);
      out.relBtn = !!document.getElementById('rpTest');
      UI.closeDlg(); await wait(100);
      out.relNotify = await Regular.testNotify(c.id);
      Access.RELEASE = false; await Regular.testNotify(c.id); Access.RELEASE = true;   // проверка поставлена в тесте, потом стор
      out.relPending = Regular._testPending(c.id);
      return JSON.stringify(out);
    })()`));
    assert.ok(r.btn, 'в тест-сборке нет кнопки «Проверить напоминание»');
    assert.ok(r.fit.sh <= r.fit.ch + 1, 'окно настройки с кнопкой прокручивается: ' + r.fit.sh + ' > ' + r.fit.ch);
    assert.ok(r.call && r.call.kind === 'regular' && r.call.delaySec === 5, 'проверка не дошла до плагина: ' + JSON.stringify(r.call));
    assert.ok(!/\d/.test(r.call.title + r.call.text), 'в проверочном уведомлении цифры: ' + r.call.title);
    assert.equal(r.tap, 'window', 'тап по проверочному уведомлению днём не открыл окно');
    assert.ok(/ - сегодня день оплаты$/.test(r.title), r.title);
    assert.deepEqual(r.btns, ['Ещё нет', 'Записать']);
    assert.equal(r.again, null, 'проверочное окно открывается повторно без новой проверки');
    assert.equal(r.relBtn, false, 'в стор-сборке есть кнопка проверки');
    assert.equal(r.relNotify, false, 'в стор-сборке проверка ставится');
    assert.equal(r.relPending, null, 'в стор-сборке тап открывает проверочное окно');
    assert.deepEqual(page.logs, [], 'ошибки в консоли: ' + page.logs.join(' | '));
    page.close();
  } finally { await edge.close(); }
});
