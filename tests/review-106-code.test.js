/* review-106-code.test.js - находки ревью кода max 1.0.6 (23.10.2026) по регулярным платежам и
   мелочам вокруг них. Каждый тест был красным на коде 827c01f8 (до исправлений):
   - «Готово» без изменений у включённого платежа сбрасывало «Ещё нет» и закрывало месяц;
   - окно платежа прошлого месяца (тап 1-го): «Ещё нет» уводило отсрочку в новый месяц,
     «Записать» писало 1-м числом и гасило напоминание нового месяца;
   - тап в 23:55 дня оплаты - «день оплаты был …-го»;
   - тап по старому уведомлению закрывал открытое окно и ничего не показывал;
   - выключение платежа со скрытым кошельком перепривязывало его к запасному;
   - окно «Записать платёж?» посреди перетаскивания плитки;
   - «Слишком большая сумма» без числа;
   - возврат из архива / показ кошелька - сразу окно «просрочки» (Н2 не применялось);
   - отмена загрузки удаляла кошелёк/категорию с регулярным платежом;
   - «Отмена» в подтверждениях кошелька теряла вписанное в форму;
   - сбой checkPermission записывался как запрет уведомлений. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Engine = require('../www/engine.js');
const Import = require('../www/import.js');
const { edgePath, launchEdge, waitFor } = require('./lib/edge-cdp.js');

const ROOT = path.resolve(__dirname, '..');
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h || 0, mi || 0, 0, 0).getTime();

test('reviveRegular: возврат после дня оплаты закрывает месяц (без окна «просрочки»), до него - напомним', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 1000 });
  const c = Engine.addCategory(S, 'exp', { name: 'Аренда' });
  Engine.setRegular(S, c.id, { amount: 30000, day: 5, walletId: w.id }, at(2026, 10, 1));
  Engine.archiveCategory(S, c.id, true);
  Engine.archiveCategory(S, c.id, false);
  assert.equal(Engine.regularPending(S, at(2026, 10, 23, 21)).length, 1, 'без reviveRegular окно «просрочки» есть (так и было)');
  Engine.reviveRegular(S, c.id, at(2026, 10, 23, 12));
  assert.equal(c.regular.skipYm, '2026-10');
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 23, 21)), [], 'после возврата - окно за прошедший день оплаты');
  Engine.reviveRegular(S, c.id, at(2026, 10, 3, 12));
  assert.equal(c.regular.skipYm, null, 'день оплаты впереди - месяц не закрыт');
  c.regular.on = false;
  assert.equal(Engine.reviveRegular(S, c.id, at(2026, 10, 23)), null, 'выключенный не оживает');
});

test('reminderPlan/regularPending: порядок проверок не меняет итог (оплачено, отложено, будущие месяцы)', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 100000 });
  w.baseTs = 0;
  const c = Engine.addCategory(S, 'exp', { name: 'Аренда' });
  Engine.setRegular(S, c.id, { amount: 1000, day: 20, walletId: w.id }, at(2026, 10, 1));
  const now = at(2026, 10, 10, 12);
  const ids = () => Engine.reminderPlan(S, now, 3).filter((e) => e.kind === 'regular').map((e) => e.id.split('|')[1]);
  assert.deepEqual(ids(), ['2026-10-20', '2026-11-20', '2026-12-20']);
  S.tx.push({ id: 'p1', kind: 'exp', amount: 950, date: '2026-10-05', ts: 1, catId: c.id, walletId: w.id, toWalletId: null });
  assert.deepEqual(ids(), ['2026-11-20', '2026-12-20'], 'оплаченный досрочно месяц не напоминается, будущие - да');
  assert.deepEqual(Engine.regularPending(S, at(2026, 10, 20, 21)), [], 'оплачен - окна нет');
});

test('отмена загрузки не удаляет кошелёк и категорию, на которые настроен регулярный платёж', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Тинькофф', base: 0 });
  const c = Engine.addCategory(S, 'exp', { name: 'Аренда' });
  const c2 = Engine.addCategory(S, 'exp', { name: 'Прочее импорт' });
  Engine.setRegular(S, c.id, { amount: 30000, day: 5, walletId: w.id });
  S.imports = [{ id: 'b1', cats: [c.id, c2.id], wallets: [w.id], fz: [] }];
  const r = Import.undo(S, 'b1', Engine);
  assert.ok(Engine.findWallet(S, w.id), 'кошелёк с регулярным платежом удалён');
  assert.ok(Engine.findCategory(S, c.id), 'категория с регулярным платежом удалена');
  assert.equal(Engine.findCategory(S, c2.id), null, 'пустая категория партии без платежа осталась');
  assert.deepEqual(r, { tx: 0, cats: 1, wallets: 0 });
});

test('экран: регулярный платёж и кошелёк - находки ревью кода 1.0.6', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    const page = await edge.open('about:blank', { width: 360, height: 640 });
    await page.goto('file:///' + path.join(ROOT, 'www', 'index.html').split(path.sep).join('/') + '?demo');
    await waitFor(() => page.eval("!!window.APP_READY && typeof UI.editCat === 'function' && !!window.Regular"), 20000, 'приложение загрузилось');
    await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
    const r = JSON.parse(await page.eval(`(async () => {
      var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
      function txt(id) { var e = document.getElementById(id); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; }
      function btn(label) { return Array.prototype.filter.call(document.querySelectorAll('#dlgBtns .btn'), function (b) { return b.textContent === label; })[0]; }
      var at = function (y, m, d, h, mi) { return new Date(y, m - 1, d, h || 0, mi || 0).getTime(); };
      var calls = [];
      Debts._plugin({
        checkPermission: function () { return Promise.resolve({ granted: true }); },
        requestPermission: function () { return Promise.resolve({ granted: true }); },
        schedule: function (o) { calls.push(o); return Promise.resolve({ ok: true }); }
      });
      var S = UI.S, out = {};
      var ws = S.wallets.filter(function (x) { return !x.hidden; }), w = ws[0], w2 = ws[1];
      var c = S.categories.exp[0], c2 = S.categories.exp[1], c3 = S.categories.exp[2];
      S.categories.exp.forEach(function (x) { delete x.regular; });

      // 1) «Готово» без изменений: «Ещё нет» и закрытый месяц не трогаются
      var now = Date.now(), today = Engine.today(), dd = +today.slice(8, 10);
      Engine.setRegular(S, c.id, { amount: 1500, day: dd, walletId: w.id }, at(+today.slice(0, 4), +today.slice(5, 7), 1));
      Engine.snoozeRegular(S, c.id, now);
      var before = JSON.stringify(c.regular);
      UI.save();
      Regular.openSetup(c.id, function () { UI.closeDlg(); });
      await wait(150);
      btn('Готово').click();
      await wait(150);
      out.resave = { same: JSON.stringify(c.regular) === before, open: !document.getElementById('dlg').hidden };
      UI.closeDlg(); await wait(80);

      // 2) окно платежа прошлого месяца: «Ещё нет» без отсрочки в новый месяц, «Записать» - датой дня оплаты
      var y = +today.slice(0, 4), mo = +today.slice(5, 7);
      var prevDue = Engine.dueDate(Engine.addMonths(today.slice(0, 7), -1), 31);
      var snooze0 = c.regular.snooze;
      Regular.show({ id: c.id, name: c.name, amount: 1500, walletId: w.id, due: prevDue, late: true });
      await wait(100);
      out.prevHint = txt('dlgBody');
      btn('Ещё нет').click();
      await wait(100);
      out.prevSnooze = c.regular.snooze === snooze0;
      out.prevToast = txt('toastText');
      UI.hideToast();
      var n0 = S.tx.length;
      var tx = Regular.record({ id: c.id, name: c.name, amount: 1500, walletId: w.id, due: prevDue, late: true });
      out.prevDate = tx ? tx.date === prevDue : 'нет записи';
      if (tx) { S.tx = S.tx.filter(function (t) { return t.id !== tx.id; }); }
      UI.hideToast(); UI.save(); UI.render();
      await wait(100);

      // 3) тап в 23:55 дня оплаты - «сегодня», не «был»
      Engine.setRegular(S, c2.id, { amount: 700, day: 15, walletId: w.id }, at(2027, 3, 1));
      var p = Regular.pendingFor(c2.id, at(2027, 3, 15, 23, 55));
      out.late2355 = p ? p.late : 'нет окна';
      var p1 = Regular.pendingFor(c2.id, at(2027, 3, 16, 9, 0));
      out.lateNext = p1 ? p1.late : 'нет окна';

      // 4) тап по уведомлению, когда показывать нечего, - открытое окно не закрывается
      Engine.setRegularOn(S, c2.id, false);
      UI.dlgAlert('Проверка', 'Окно');
      await wait(80);
      out.tap = Regular.fromTap(c2.id, '');
      out.tapKeep = !document.getElementById('dlg').hidden && txt('dlgTitle') === 'Окно';
      UI.closeDlg(); await wait(80);

      // 5) выключение со скрытым кошельком - кошелёк платежа не меняется
      Engine.setRegular(S, c3.id, { amount: 900, day: 10, walletId: w2.id });
      w2.hidden = true;
      Regular.openSetup(c3.id, function () { UI.closeDlg(); });
      await wait(150);
      document.getElementById('rpOn').click();
      btn('Готово').click();
      await wait(150);
      out.offWallet = { on: c3.regular.on, same: c3.regular.walletId === w2.id };
      UI.closeDlg(); w2.hidden = false; await wait(80);

      // 6) перетаскивание плитки - окно «Записать платёж?» не открывается
      Engine.setRegular(S, c2.id, { amount: 700, day: 15, walletId: w.id }, at(2027, 3, 1));
      var d0 = UI.dragging;
      UI.dragging = function () { return true; };
      out.dragCheck = Regular.check(at(2027, 3, 15, 21));
      UI.dragging = d0;
      out.hasDragging = typeof UI.dragging === 'function' && UI.dragging() === false;
      out.freeCheck = Regular.check(at(2027, 3, 15, 21));
      UI.closeDlg(); await wait(80);

      // 7) слишком большая сумма - с числом максимума
      Regular.openSetup(c2.id, function () { UI.closeDlg(); });
      await wait(150);
      document.getElementById('rpAmount').value = '9999999999';
      btn('Готово').click();
      await wait(80);
      out.maxErr = txt('rpErr');
      UI.closeDlg(); await wait(80);

      // 8) «Отмена» в «Удалить кошелёк?» - вписанное в форму на месте
      UI.editWallet(w.id);
      await wait(150);
      document.getElementById('ecName').value = 'Карта ВТБ';
      document.getElementById('ecDel').click();
      await wait(150);
      out.delTitle = txt('dlgTitle');
      btn('Отмена').click();
      await wait(150);
      out.draftName = document.getElementById('ecName') ? document.getElementById('ecName').value : null;
      UI.closeDlg(); await wait(80);
      UI.editWallet(w.id);
      await wait(150);
      out.freshName = document.getElementById('ecName').value === w.name;
      UI.closeDlg(); await wait(80);

      // 10) возврат из архива и показ кошелька после дня оплаты - без окна «просрочки» (Н2)
      if (+today.slice(8, 10) > 1) {
        S.categories.exp.forEach(function (x) { if (x.regular) x.regular.on = false; });
        UI.hasFullAccess0 = UI.hasFullAccess; UI.hasFullAccess = function () { return true; };
        Engine.setRegular(S, c3.id, { amount: 999999, day: 1, walletId: w.id }, at(y, mo, 1));   // сумма больше трат демо - месяц не «оплачен»
        Engine.archiveCategory(S, c3.id, true);
        UI.restoreCat('exp', c3.id);
        await wait(80);
        out.restorePending = Engine.regularPending(S, Date.now() + 24 * 3600000).filter(function (x) { return x.id === c3.id; }).length;
        Engine.setRegular(S, c3.id, { amount: 999999, day: 1, walletId: w2.id }, at(y, mo, 1));
        w2.hidden = true;
        UI.unhideWallet(w2.id);
        await wait(80);
        out.unhidePending = Engine.regularPending(S, Date.now() + 24 * 3600000).filter(function (x) { return x.id === c3.id; }).length;
        UI.hasFullAccess = UI.hasFullAccess0;
        UI.hideToast(); UI.closeDlg(); await wait(80);
      } else { out.restorePending = 0; out.unhidePending = 0; }

      // 9) сбой checkPermission - не «запрещены»
      Debts._plugin({
        checkPermission: function () { return Promise.reject(new Error('мост')); },
        requestPermission: function () { return Promise.resolve({ granted: true }); },
        schedule: function () { return Promise.resolve({ ok: true }); }
      });
      out.perm = await Debts.askPerm();
      out.blocked = Debts.remindBlocked();
      Debts._plugin(null);
      return JSON.stringify(out);
    })()`));
    assert.deepEqual(r.resave, { same: true, open: false }, '«Готово» без изменений тронуло настройку');
    assert.ok(/Записывайте, только если уже заплатили\.$/.test(r.prevHint) && !/Ещё нет/.test(r.prevHint), 'окно прошлого месяца обещает «завтра»: ' + r.prevHint);
    assert.equal(r.prevSnooze, true, '«Ещё нет» за прошлый месяц сдвинуло отсрочку нового');
    assert.equal(r.prevToast, 'Об этом платеже больше не напомним');
    assert.equal(r.prevDate, true, '«Записать» за прошлый месяц не датой дня оплаты');
    assert.equal(r.late2355, false, 'тап в 23:55 дня оплаты - «был»');
    assert.equal(r.lateNext, true, 'на следующий день - «был»');
    assert.equal(r.tap, 'none');
    assert.equal(r.tapKeep, true, 'тап без окна закрыл открытое окно');
    assert.deepEqual(r.offWallet, { on: false, same: true }, 'выключение перепривязало платёж к запасному кошельку');
    assert.equal(r.dragCheck, false, 'окно открылось посреди перетаскивания');
    assert.equal(r.hasDragging, true, 'UI.dragging нет');
    assert.equal(r.freeCheck, true, 'без перетаскивания окно не открылось');
    assert.ok(/^Максимум 999\s999\s999\s₽$/.test(r.maxErr), 'ошибка суммы: ' + r.maxErr);
    assert.equal(r.delTitle, 'Удалить кошелёк?');
    assert.equal(r.draftName, 'Карта ВТБ', '«Отмена» потеряла вписанное');
    assert.equal(r.freshName, true, 'черновик пережил закрытие формы');
    assert.equal(r.restorePending, 0, 'возврат из архива - сразу окно «просрочки»');
    assert.equal(r.unhidePending, 0, 'показ кошелька - сразу окно «просрочки»');
    assert.equal(r.perm, null, 'сбой проверки - не «нет»');
    assert.equal(r.blocked, false, 'сбой проверки записан как запрет уведомлений');
    assert.deepEqual(page.logs, [], 'ошибки в консоли: ' + page.logs.join(' | '));
    page.close();
  } finally { await edge.close(); }
});
