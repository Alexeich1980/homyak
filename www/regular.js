/* regular.js - 1.0.6 «Регулярный платёж» (аренда, подписки, связь): решения Алексея 21-22.10.2026.

   Настройка - в карточке категории расхода (edit.js editCat): под «Лимит в месяц» строка-вход
   «Регулярный платёж» со стрелкой «›» (тест Алексея 23.10: с выключателем справа строку читали
   как тумблер и не догадывались, что тап открывает настройку). Тап - своё окно: выключатель
   справа от заголовка (вкл/выкл, у уже настроенного), сумма,
   кошелёк (свой выбор, picker.js), день оплаты (та же сетка 7x5, что у долгов). Окно живёт в том
   же #dlg, что и карточка: закрываясь, оно открывает карточку заново с уже вписанным (draft).

   Вечером в день оплаты (Engine.REGULAR_HOUR, 20:00: днём человек может нажать «Записать», не
   заплатив, и попасть на просрочку) - локальное уведомление (план - Engine.reminderPlan, ставит
   плагин Reminders через debts.js) и окно в приложении «Записать платёж?». «Записать» - обычный
   расход тем же путём, что экран суммы (UI.recordTx: звук, подсветка, тост «Отменить», лимиты);
   «Ещё нет» - завтра в 20:00 снова, до записи или конца месяца. Уже оплачен (один расход в
   категории за месяц не меньше 90% суммы, Engine.regularPaid) - ни уведомления, ни окна.

   Free: один регулярный платёж (Engine.FREE.regular). Включённое не блокируется: если доступ
   пропал, заведённые платежи работают; закрыто только включение нового. */
(function () {
'use strict';

var UI = window.UI;
if (!UI || !window.Debts || !window.Engine) return;
function $(id) { return document.getElementById(id); }
function S() { return UI.S; }
function esc(s) { return UI.esc(s); }
function money(v) { return UI.money(v); }
function full() { return UI.hasFullAccess ? !!UI.hasFullAccess() : !!(window.Access && window.Access.FULL); }
function testBuild() { return !(window.Access && window.Access.RELEASE); }
var D = window.Debts;

var BELL = '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5h4"/>';
var HOUR = (Engine.REGULAR_HOUR < 10 ? '0' : '') + Engine.REGULAR_HOUR + ':00';
var WHY_FREE = 'В бесплатной версии - один регулярный платёж.';
var OFF_SUB = 'Выключен - нажмите, чтобы настроить';
var SETUP_HINT = 'Напомним в\u00a020:00, если до этого не было оплаты.';
var ASK_HINT = 'Записывайте, только если уже заплатили. Не оплатили\u00a0- нажмите «Ещё нет», завтра вечером напомним снова.';
var ASK_HINT_LAST = 'Записывайте, только если уже заплатили.';
var PERM_HINT = 'Уведомления запрещены в настройках телефона. Окно в приложении покажем и без них.';
var AMT_EMPTY = 'Впишите сумму платежа';
var AMT_BAD = 'Сумма - положительное число';

function wallet(id) { var w = id ? Engine.findWallet(S(), id) : null; return w && !w.hidden ? w : null; }
function cat(id) { var f = Engine.findCategory(S(), id); return f && f.kind === 'exp' ? f.cat : null; }

// ---------- строка в карточке категории ----------
// Строка - вход в окно настройки (стрелка «›», как у карточек-переходов), выключателя в ней нет:
// вкл/выкл - строкой «Напоминать» в самом окне. Подпись - настоящее состояние (ревью «сломать» Н1):
// уведомления запрещены или кошелёк пропал - честная пометка. «Открыть настройки» - в окне
// настройки платежа (Н3: с кнопкой карточка не влезала в 360x640).
function rowHtml(catId) {
  var r = Engine.regularOf(S(), catId), w = r ? wallet(r.walletId) : null;
  var blocked = !!(r && r.on && w && D.remindBlocked());
  var sub, late = false;
  if (!r || !r.on) sub = OFF_SUB;
  else if (!w) { sub = 'Кошелёк удалён или скрыт - выберите другой'; late = true; }
  else if (blocked) { sub = 'уведомления запрещены в настройках телефона'; late = true; }
  else sub = r.day + '-го в\u00a0' + HOUR + ' · ' + money(r.amount) + '\u00a0₽ · ' + w.name;
  var lock = !(r && r.on) && !Engine.canAddRegular(S(), full(), catId);
  return '<button type="button" class="set-row c-green rp-row" id="rpRow" aria-haspopup="dialog" data-on="' + (r && r.on ? '1' : '0') + '">' +
      '<span class="mi-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + BELL + '</svg></span>' +
      '<span class="set-tx"><span class="set-t">Регулярный платёж</span><span class="set-s' + (late ? ' db-late' : '') + '" id="rpSub">' + esc(sub) + '</span></span>' +
      (lock ? '<span class="set-lock" aria-hidden="true">🔒</span>' : '') +
      '<span class="set-chev" aria-hidden="true">›</span></button>';
}
function rowBox(catId) { return '<div class="ef db-rm rp-box" id="rpBox">' + rowHtml(catId) + '</div>'; }
function repaint(catId) { var b = $('rpBox'); if (b) b.innerHTML = rowHtml(catId); }

// Тап по строке - окно настройки. Выключенный при занятом в free месте - окно «Полный доступ».
function bindRow(catId, draftFn, reopen) {
  var box = $('rpBox');
  if (!box) return;
  box.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t || !t.closest('#rpRow')) return;
    var r = Engine.regularOf(S(), catId);
    var draft = draftFn(), back = function () { reopen(draft); };
    UI.haptic('light');
    if (!(r && r.on) && !Engine.canAddRegular(S(), full(), catId)) { gate(back); return; }
    openSetup(catId, back);
  });
}
function gate(back) { if (UI.paywall) UI.paywall(back, WHY_FREE); }
// зовётся сразу после back(): карточка уже нарисована заново, строку перерисовывать не нужно
function saved() {
  UI.save(); UI.render();
  try { D.syncReminders(); } catch (e) {}
}
// разрешение на уведомления - при включении, как у долгов (Android 13+ спрашивает окном).
// Отказ - честно в подписи строки, окно поверх карточки не открываем (окно одно).
function askPerm(catId) {
  return D.askPerm().then(function (granted) {
    repaint(catId);
    if (granted) { try { D.syncReminders(true); } catch (e) {} }
    return granted;
  });
}

// ---------- окно настройки ----------
function lastWalletOf(catId) {
  var best = null;
  S().tx.forEach(function (t) {
    if (t.kind !== 'exp' || t.catId !== catId || !wallet(t.walletId)) return;
    if (!best || t.date > best.date || (t.date === best.date && (t.ts || 0) >= (best.ts || 0))) best = t;
  });
  return best ? best.walletId : null;
}
function openSetup(catId, back) {
  var c = cat(catId);
  if (!c) return false;
  var r = c.regular || null;
  var ws = S().wallets.filter(function (w) { return !w.hidden; }).sort(function (a, b) { return a.order - b.order; });
  var wid = (r && wallet(r.walletId) ? r.walletId : null) || lastWalletOf(catId) || (ws[0] ? ws[0].id : '');
  var lim = Engine.catLimit(S(), catId, UI.curYM());
  var amt = r ? r.amount : (lim > 0 ? lim : null);
  var day = r ? r.day : null;
  // «Напоминать» - только у уже настроенного: новый платёж включается самим «Готово»
  var onSel = r ? !!r.on : true;
  // выключатель - в строке заголовка окна справа (место по высоте: окно и так впритык в 360x640)
  var body = (r ? '<button type="button" class="rp-on" id="rpOn" aria-label="Напоминать" aria-pressed="' + (onSel ? 'true' : 'false') + '">' +
      '<span class="rp-on-t">Напоминать</span><span class="mi-sw' + (onSel ? ' on' : '') + '" aria-hidden="true"><i></i></span></button>' : '') +
    '<div class="ef-err" id="rpErr" hidden></div>' +
    '<div class="rp-two">' +
      '<div class="ef"><span class="lbl">Сумма, ₽</span>' +
        '<input class="inp" id="rpAmount" type="text" inputmode="decimal" autocomplete="off" value="' + esc(amt ? Engine.fmt(amt) : '') + '"></div>' +
      '<div class="ef"><span class="lbl">Кошелёк</span>' +
        Picker.listField({ id: 'rpWallet', title: 'Кошелёк', value: wid,
          items: ws.map(function (w) { return { value: w.id, label: w.name }; }) }) + '</div>' +
    '</div>' +
    '<div class="ef"><span class="lbl">День оплаты</span>' + UI.dayGridHtml('rp', day, 'День оплаты') +
      // Н3: запрет уведомлений - вместо «Напомним в 20:00» честная строка и кнопка в настройки
      // Android (здесь, а не в карточке категории: с кнопкой карточка не влезала в 360x640)
      (D.remindBlocked() ? '<div class="hint db-late">' + PERM_HINT + '</div>' +
        '<button type="button" class="btn ghost db-test rp-perm" id="rpPerm">Открыть настройки</button>'
        : '<div class="hint">' + SETUP_HINT + '</div>' +
          // только тестовая сборка (проход по USB, 23.10): уведомление и окно днём, не дожидаясь 20:00;
          // при запрете уведомлений не нужна (не придёт) и не влезает в 360x640 рядом с «Открыть настройки»
          (testBuild() && r && r.on ? '<button type="button" class="btn ghost db-test rp-test" id="rpTest">Проверить напоминание (тестовая сборка)</button>' : '')) +
      '</div>';
  UI.openDlg({
    title: 'Регулярный платёж', body: body,
    onClose: back,   // фон, свайп, «назад» - обратно в карточку категории
    buttons: [
      { label: 'Отмена', cls: 'nav', onClick: function () { back(); return false; } },
      { label: 'Готово', cls: 'primary', onClick: function () { done(); return false; } }
    ],
    onOpen: function () {
      UI.moneyInput($('rpAmount'));
      if ($('rpPerm')) $('rpPerm').addEventListener('click', function () { D.openSettings(); });
      if ($('rpTest')) $('rpTest').addEventListener('click', function () { testNotify(catId); });
      if ($('rpOn')) $('rpOn').addEventListener('click', function () {
        onSel = !onSel;
        this.setAttribute('aria-pressed', onSel ? 'true' : 'false');
        this.querySelector('.mi-sw').classList.toggle('on', onSel);
        UI.haptic('light');
      });
      var g = $('rpDayGrid');
      g.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-day]') : null;
        if (!b) return;
        var v = +b.getAttribute('data-day');
        $('rpDay').value = v;
        // С3: выбрали день - ошибка «Выберите день оплаты» гаснет сразу
        var er = $('rpErr'); if (er && !er.hidden && er.textContent === 'Выберите день оплаты') er.hidden = true;
        Array.prototype.forEach.call(g.querySelectorAll('.dg-d'), function (x) {
          var on = +x.getAttribute('data-day') === v;
          x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        UI.haptic('light');
      });
    }
  });
  function err(m) { var el = $('rpErr'); if (el) { el.textContent = m; el.hidden = false; } return false; }
  function done() {
    // «Напоминать» выключили: поля сохраняем, если они в порядке (иначе - прежняя настройка), и гасим
    // Ревью кода 1.0.6: сохранённый кошелёк скрыт/удалён - в поле подставлен запасной; выключение
    // его не берёт (иначе платёж молча переезжал на другой кошелёк), остаётся прежняя настройка
    if (!onSel) {
      var ra = Engine.parseNum(String($('rpAmount').value).trim()), rw = String($('rpWallet').value || ''), rd = +$('rpDay').value;
      if (ra > 0 && wallet(rw) && wallet(r.walletId) && rd >= 1 && rd <= 31) {
        try { Engine.setRegular(S(), catId, { amount: ra, day: rd, walletId: rw }); } catch (e) {}
      }
      Engine.setRegularOn(S(), catId, false);
      UI.haptic('light');
      back();
      saved(catId);
      UI.toast('Регулярный платёж выключен');
      return true;
    }
    // Н14: пусто (поле суммы само ставит 0 на пустом) - «впишите»; «-500», «abc», «150+300»
    // (калькулятора в этом поле нет), меньше копейки - «положительное число»
    var raw = String($('rpAmount').value).trim(), a = Engine.parseNum(raw);
    if (raw === '' || a === 0) return err(AMT_EMPTY);
    if (!(Math.round(a * 100) > 0)) return err(AMT_BAD);
    var w = String($('rpWallet').value || '');
    if (!wallet(w)) return err(ws.length ? 'Выберите кошелёк' : 'Сначала заведите кошелёк');
    var d = +$('rpDay').value;
    if (!(d >= 1 && d <= 31)) return err('Выберите день оплаты');
    var wasOn = !!(r && r.on);
    // Ревью кода 1.0.6: «Готово» без изменений у включённого платежа - ничего не трогаем. Иначе
    // setRegular сбрасывал «Ещё нет» и после 20:00 дня оплаты закрывал месяц (Н2): посмотрел
    // настройку - и напоминания до конца месяца пропали, хотя платёж не записан.
    if (wasOn && Math.round(a * 100) === Math.round(r.amount * 100) && d === r.day && w === r.walletId) {
      UI.haptic('light');
      back();
      return true;
    }
    if (!wasOn && !Engine.canAddRegular(S(), full(), catId)) { gate(back); return false; }
    try { Engine.setRegular(S(), catId, { amount: a, day: d, walletId: w }); }
    catch (e) { return err(e && e.message === 'amount' ? 'Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + '\u00a0₽' : 'Не сохранилось, проверьте поля'); }
    UI.haptic('light');
    back();          // карточка категории заново - строка уже со своей подписью
    saved(catId);
    UI.toast(wasOn ? 'Регулярный платёж сохранён' : 'Напомним ' + d + '-го в\u00a0' + HOUR);
    if (!wasOn || D.remindBlocked()) askPerm(catId);
    return true;
  }
  return true;
}

// ---------- вечернее окно «Записать платёж?» ----------
var shown = {};   // за одно открытие приложения: «категория|дата оплаты» → уже показывали
function key(p) { return p.id + '|' + p.due; }
function lastDayToday() { var t = Engine.today(); return Engine.dueDate(t.slice(0, 7), 31) === t; }
// платёж прошлого месяца (тап утром 1-го по уведомлению последнего дня, Н8): «Ещё нет» в новый
// месяц не переносится, «Записать» - датой дня оплаты, а не 1-м числом (ревью кода 1.0.6: запись
// 1-м числом засчитывалась как оплата нового месяца, и его напоминание пропадало)
function prevMonth(p) { return p.due.slice(0, 7) < Engine.today().slice(0, 7); }
function show(p) {
  var w = wallet(p.walletId), c = cat(p.id);
  if (!w || !c) return false;
  shown[key(p)] = true;
  var title = c.name + (p.late ? ' - день оплаты был ' + (+p.due.slice(8, 10)) + '-го' : ' - сегодня день оплаты');
  UI.openDlg({
    title: title,
    body: '<div class="rp-q" id="rpQ">' + esc(money(p.amount) + '\u00a0₽ с кошелька «' + w.name + '». Записать платёж?') + '</div>' +
      '<div class="hint rp-hint">' + esc(lastDayToday() || prevMonth(p) ? ASK_HINT_LAST : ASK_HINT) + '</div>',
    buttons: [
      { label: 'Ещё нет', cls: 'nav', onClick: function () { notYet(p); } },
      { label: 'Записать', cls: 'primary', onClick: function () { UI.closeDlg(); record(p); return false; } }
    ]
  });
  return true;
}
// «Записать» - обычный расход сегодняшней датой тем же путём, что экран суммы
function record(p) {
  var w = wallet(p.walletId);
  if (!w || !cat(p.id)) return null;
  var tx = UI.recordTx({ kind: 'exp', catId: p.id, walletId: w.id }, p.amount, prevMonth(p) ? p.due : Engine.today(), '', false);
  if (tx) setTimeout(function () { try { check(); } catch (e) {} }, 900);   // следующий платёж этого вечера
  return tx;
}
// «Ещё нет» - завтра в 20:00 снова (уведомление и окно), в последний день месяца - больше нет;
// платёж прошлого месяца - тоже больше нет (отложенный день ушёл бы в новый месяц и сдвинул его)
function notYet(p) {
  if (prevMonth(p)) { UI.toast('Об этом платеже больше не напомним'); return; }
  var last = lastDayToday();
  Engine.snoozeRegular(S(), p.id, Date.now());
  UI.save();
  try { D.syncReminders(); } catch (e) {}
  UI.toast(last ? 'В этом месяце больше не напомним' : 'Напомним завтра в\u00a0' + HOUR);
}
// Показать окно, если пора: не поверх другого окна, экрана суммы, замка; одно за раз; то же
// окно не дважды за одно открытие приложения (закрыли фоном - покажем при следующем открытии).
function check(nowTs) {
  if (D.busy()) return false;
  if (UI.dragging && UI.dragging()) return false;   // ревью кода 1.0.6: окно посреди перетаскивания плитки отменяло бросок
  if (window.Picker && Picker.isOpen()) return false;
  var list = Engine.regularPending(S(), typeof nowTs === 'number' ? nowTs : Date.now())
    .filter(function (p) { return !shown[key(p)]; });
  return list.length ? show(list[0]) : false;
}
// Тап по уведомлению: id категории приходит в том же поле интента, что id долга
// (debts.js openFromReminder → сюда). Стоит замок - ждём разблокировки.
var tapWait = null;
// Ожидающий платёж категории id для тапа (Н8): будильник неточный - тап за пару минут до 20:00 тоже
// «пора»; тап после 23:50 (плюс 10 минут - уже завтра) - на сам момент тапа; тап утром 1-го по
// уведомлению последнего дня - платёж прошлого месяца, на его конец (день оплаты уже прошёл - late).
// Прошлый месяц смотрим только 1-го: позже это уже старое уведомление.
function dayOf(ts) { var d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function pendingFor(id, now) {
  var d = new Date(now), ts = [now + 10 * 60000, now];
  if (d.getDate() === 1) ts.push(new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1);
  for (var i = 0; i < ts.length; i++) {
    var p = Engine.regularPending(S(), ts[i]).filter(function (x) { return x.id === id; })[0];
    // late - на момент тапа (ревью кода 1.0.6: проба «+10 минут» в 23:55 давала «был 15-го» 15-го числа)
    if (p) { p.late = p.due < dayOf(now); return p; }
  }
  return null;
}
function fromTap(id, due) {
  if (!cat(id)) return false;
  if (D.locked()) {
    clearTimeout(tapWait);
    tapWait = setTimeout(function () { fromTap(id, due); }, 400);
    return 'wait';
  }
  // сначала - есть ли что показать; только потом закрываем слои (ревью кода 1.0.6: тап по старому
  // уведомлению закрывал экран суммы с набранным числом и ничего не показывал)
  var p = pendingFor(id, Date.now());
  if (!p) p = testPending(id);
  if (!p) {
    if (Engine.regularPaid(S(), id, Engine.today().slice(0, 7))) UI.toast('Платёж «' + cat(id).name + '» в этом месяце уже записан');
    return 'none';
  }
  try { if (UI.closeTop) { for (var g = 0; g < 8 && UI.closeTop(); g++) {} } } catch (e) {}
  if (UI.closeAmount) UI.closeAmount();
  show(p);
  return 'window';
}
// Только тестовая сборка (проход по USB): уведомление этой категории через несколько секунд тем же
// путём (будильник → приёмник → уведомление → тап → окно). Кнопка «Проверить напоминание (тестовая
// сборка)» в окне настройки включённого платежа (WebView тест-сборки без отладки - консоли нет).
// Тап по проверочному уведомлению открывает окно «сегодня день оплаты» и днём (testPending), иначе
// до 20:00 его не проверить. В стор-сборке ни кнопки, ни подмены: testBuild() ложно.
var testTap = null;
function testPending(id) {
  if (!testBuild() || testTap !== id) return null;
  testTap = null;
  var r = Engine.regularOf(S(), id);
  if (!r || !r.on || !wallet(r.walletId)) return null;
  return { id: id, name: cat(id).name, amount: r.amount, walletId: r.walletId, due: Engine.today(), late: false };
}
function testNotify(catId) {
  var c = cat(catId);
  if (!c || !testBuild()) return Promise.resolve(false);
  return D.askPerm().then(function () {
    var N = window.NativePlugins, p = N && N.Reminders;
    if (!p || !(window.isNativeApp && window.isNativeApp())) { UI.toast('Проверка работает только на телефоне'); return false; }
    testTap = c.id;
    var t;
    try {
      t = Promise.resolve(p.test({ delaySec: 5, debt: c.id, kind: 'regular',
        title: 'Сегодня день оплаты «' + c.name + '»', text: 'Проверка напоминания (тестовая сборка).' }));
    } catch (e) { t = Promise.reject(e); }   // синхронный сбой плагина - тот же тост, testTap снят
    return t.then(function () {
      UI.toast('Уведомление придёт через несколько секунд');
      return true;
    }, function () { testTap = null; UI.toast('Не получилось поставить проверку'); return false; });
  });
}

// когда проверять: запуск, возврат в приложение, раз в полминуты (20:00 при открытом приложении,
// закрыли другое окно, сняли замок). В self-test - только явным вызовом.
var AUTO = location.search.indexOf('selftest') < 0;
if (AUTO) {
  setTimeout(function () { try { check(); } catch (e) {} }, 2600);
  setInterval(function () { if (document.visibilityState !== 'hidden') { try { check(); } catch (e) {} } }, 30000);
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { shown = {}; return; }   // новое открытие
  if (AUTO) setTimeout(function () { try { check(); } catch (e) {} }, 1700);
});

window.Regular = {
  rowBox: rowBox, rowHtml: rowHtml, bindRow: bindRow, openSetup: openSetup,
  show: show, check: check, fromTap: fromTap, record: record, notYet: notYet, testNotify: testNotify,
  WHY_FREE: WHY_FREE, SETUP_HINT: SETUP_HINT, ASK_HINT: ASK_HINT, PERM_HINT: PERM_HINT, pendingFor: pendingFor,
  _testPending: testPending, _reset: function () { shown = {}; testTap = null; }
};
})();
