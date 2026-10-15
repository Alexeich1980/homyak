/* debts.js - учёт долгов (1.0.4, концепция docs/1.0.4-dolgi-koncepciya.md).
   Экранная часть: «+» ленты кошельков (кошелёк / я должен / мне должны), форма долга,
   карточка долга (было/осталось, «выплачено N%», история платежей, настройки, тумблер
   «Напомнить о платеже»), «Долг погашен» (архив), блок «Долги» в «Настроить
   кошельки», баннер просрочки на главном, напоминания (свой плагин оболочки Reminders).
   Расчёты - в engine.js (payDebt, debtStatus, reminderPlan ...). Плитки долгов в ленте
   рисует ui.js (debtTileHtml): лента собирается раньше, чем грузится этот файл.

   Free: один долг (Engine.FREE.debts). Созданное не блокируется: если доступ пропал,
   заведённые долги работают как прежде, закрыто только добавление нового.

   Напоминания - локальные уведомления Android: план (даты на 12 месяцев вперёд, 31-е в
   феврале → 28-е) считает Engine.reminderPlan, телефон через плагин Reminders ставит
   будильник на ближайшее (AlarmManager, без точных будильников) и сам переставляет его
   после перезагрузки. Разрешение на уведомления (Android 13+) спрашиваем при первом
   включении тумблера; отказ - честное окно в гамме приложения. */
(function () {
'use strict';

var UI = window.UI;
if (!UI) return;
function $(id) { return document.getElementById(id); }
function esc(s) { return UI.esc(s); }
function fmt(n) { return UI.fmt(n); }
function money(v) { return UI.money(v); }
function S() { return UI.S; }
function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

var MONTH_ACC = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
var MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function monthAcc(ym) { return MONTH_ACC[+ym.slice(5, 7) - 1] || ''; }
function dayMonth(date) { return (+date.slice(8, 10)) + ' ' + (MONTH_GEN[+date.slice(5, 7) - 1] || ''); }
function txDate(d) { return String(d).slice(8, 10) + '.' + String(d).slice(5, 7); }
function full() { return UI.hasFullAccess ? !!UI.hasFullAccess() : !!(window.Access && window.Access.FULL); }
function testBuild() { return !(window.Access && window.Access.RELEASE); }
function showErr(id, msg) { var el = $(id); if (el) { el.textContent = msg; el.hidden = false; } }
function capMsg() { UI.dlgAlert('Достигнут предел: ' + Engine.HARD.debts + ' долгов. Больше добавить нельзя.', 'Предел'); }
function changed() { syncReminders(); checkWarn(); }

// ---------- «+» в ленте: что добавить ----------
var LOCK = ' <span class="clr-lock" aria-hidden="true">🔒</span>';
function addToStrip() {
  var f = full();
  var wl = !Engine.canAddWallet(S(), f), dl = !Engine.canAddDebt(S(), f);
  UI.openDlg({
    title: 'Что добавить',
    body: '<div class="op-pick">' +
      '<button type="button" class="btn ghost" data-add-what="wallet">Кошелёк' + (wl ? LOCK : '') + '</button>' +
      '<button type="button" class="btn ghost" data-add-what="owe">Долг: я должен' + (dl ? LOCK : '') + '</button>' +
      '<button type="button" class="btn ghost" data-add-what="owed">Долг: мне должны' + (dl ? LOCK : '') + '</button>' +
      '</div>' +
      (dl && !f ? '<div class="set-p db-free-p">В бесплатной версии - один долг.</div>' : '') +
      '<div class="set-p db-pick-p">Кредит, ипотека, рассрочка, долг другу - «я должен». Кредитка - это тоже кошелёк: отметьте «Кредитная карта» в его настройке.</div>',
    buttons: [{ label: 'Отмена', cls: 'nav' }],
    onOpen: function () {
      $('dlgBody').querySelector('.op-pick').addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-add-what]') : null;
        if (!b) return;
        var w = b.getAttribute('data-add-what');
        UI.closeDlg();
        if (w === 'wallet') { if (UI.addWallet) UI.addWallet(); }
        else addDebt(w);
      });
    }
  });
}

// ---------- форма долга ----------
// День платежа - сетка 7 x 5 (1-31, как лист календаря без дней недели): все числа видны
// сразу, выбор одним касанием (решение 12.10 вместо длинного списка 1-31). Значение - в
// скрытом поле <pfx>Day, его читает readForm.
function dayGridHtml(pfx, cur, label) {
  var h = '<div class="day-grid" id="' + pfx + 'DayGrid" role="radiogroup" aria-label="' + (label || 'День платежа') + '">';
  for (var i = 1; i <= 31; i++) {
    h += '<button type="button" class="dg-d' + (i === cur ? ' on' : '') + '" data-day="' + i + '" role="radio" aria-checked="' + (i === cur ? 'true' : 'false') + '">' + i + '</button>';
  }
  // 29, 30, 31-е в коротком месяце = последний день (Engine.dueDate); подписи об этом нет (решение 13.10)
  return h + '</div><input type="hidden" id="' + pfx + 'Day" value="' + (cur || '') + '">';
}
// o: {type, name, amount, pay, day, rate, due, amountLabel}
function debtFormHtml(pfx, o) {
  var owe = o.type !== 'owed';
  var h = '<div class="ef-err" id="' + pfx + 'Err" hidden></div>' +
    '<div class="ef"><span class="lbl">' + (owe ? 'Название' : 'Кто должен') + '</span>' +
      '<input class="inp" id="' + pfx + 'Name" type="text" autocomplete="off"' +
      (o.name != null ? ' value="' + esc(o.name) + '"' : '') +
      ' placeholder="' + (owe ? 'Например, Ипотека' : 'Например, Саша') + '"></div>' +
    '<div class="ef"><span class="lbl">' + esc(o.amountLabel || (owe ? 'Остаток долга, ₽' : 'Сколько должны, ₽')) + '</span>' +
      '<input class="inp" id="' + pfx + 'Amount" type="text" inputmode="decimal" autocomplete="off" value="' + esc(o.amount != null ? Engine.fmt(o.amount) : '') + '">' +
      (owe ? '<div class="hint">Сколько банк покажет к полному погашению</div>' : '') + '</div>';
  if (owe) {
    h += '<div class="ef"><span class="lbl">Платёж в месяц, ₽</span>' +
        '<input class="inp" id="' + pfx + 'Pay" type="text" inputmode="decimal" autocomplete="off" value="' + esc(o.pay ? Engine.fmt(o.pay) : '') + '"></div>' +
      '<div class="ef"><span class="lbl">День платежа</span>' + dayGridHtml(pfx, o.day) + '</div>' +
      '<div class="ef"><span class="lbl">Ставка, % годовых (если есть)</span>' +
        '<input class="inp" id="' + pfx + 'Rate" type="text" inputmode="decimal" autocomplete="off" value="' + esc(o.rate ? UI.rateNum(o.rate) : '') + '">' +
        '<div class="hint">Укажите ставку - «Хомяк» покажет, сколько из платежа ушло на проценты, а сколько в счёт долга. Проценты считаются раз в месяц, в первом платеже. Не знаете ставку - оставьте пустым</div></div>';
  } else {
    h += '<div class="ef"><span class="lbl">Ставка, % годовых (если есть)</span>' +
        '<input class="inp" id="' + pfx + 'Rate" type="text" inputmode="decimal" autocomplete="off" value="' + esc(o.rate ? UI.rateNum(o.rate) : '') + '">' +
        '<div class="hint">Для наглядности: «Хомяк» покажет её на плитке, проценты не начисляет</div></div>' +
      '<div class="ef"><span class="lbl">Дата возврата (если договорились)</span>' +
      Picker.dateField({ id: pfx + 'Due', value: o.due || '', optional: true, title: 'Дата возврата', ph: 'Не выбрана' }) + '</div>';
  }
  return h;
}
// Прочитать форму. {ok, v:{name, amount, pay, day, rate, due}} или {ok:false} (ошибка уже показана)
function readForm(pfx, type) {
  var owe = type !== 'owed';
  var name = String($(pfx + 'Name').value || '').trim();
  if (!name) { showErr(pfx + 'Err', owe ? 'Впишите название' : 'Впишите, кто должен'); return { ok: false }; }
  var raw = String($(pfx + 'Amount').value || '').trim();
  var amount = raw === '' ? NaN : Engine.parseNum(raw);
  if (!isFinite(amount) || amount < 0) { showErr(pfx + 'Err', owe ? 'Остаток долга - это число' : 'Сумма - это число'); return { ok: false }; }
  if (amount > Engine.MAX_AMOUNT) { showErr(pfx + 'Err', 'Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + '\u00a0₽'); return { ok: false }; }
  var v = { name: name, amount: amount };
  if (owe) {
    var pay = Engine.parseNum(String($(pfx + 'Pay').value || '').trim());
    if (!(pay > 0)) { showErr(pfx + 'Err', 'Впишите ежемесячный платёж'); return { ok: false }; }
    var day = parseInt($(pfx + 'Day').value, 10);
    if (!(day >= 1 && day <= 31)) { showErr(pfx + 'Err', 'Выберите день платежа'); return { ok: false }; }
    v.pay = pay; v.day = day;
  } else {
    var due = $(pfx + 'Due').value || '';
    if (due && !Engine.isDate(due)) { showErr(pfx + 'Err', 'Проверьте дату возврата'); return { ok: false }; }
    v.due = due || null;
  }
  var rr = String($(pfx + 'Rate').value || '').trim().replace('%', '');
  var rate = rr === '' ? null : Engine.parseNum(rr);
  if (rate !== null && (!isFinite(rate) || rate < 0 || rate > 100)) { showErr(pfx + 'Err', 'Ставка - число от 0 до 100'); return { ok: false }; }
  v.rate = rate;
  return { ok: true, v: v };
}
function bindForm(pfx) {
  ['Amount', 'Pay'].forEach(function (k) { var el = $(pfx + k); if (el) UI.moneyInput(el); });
  var g = $(pfx + 'DayGrid');
  if (g) g.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-day]') : null;
    if (!b) return;
    $(pfx + 'Day').value = b.getAttribute('data-day');
    all(g, '.dg-d').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
    UI.haptic('light');
  });
}

// true - можно завести (или вернуть из архива) долг; иначе окно предела или покупки
function debtGate(back) {
  if (Engine.debtsActiveCount(S()) >= Engine.HARD.debts) { capMsg(); return false; }
  if (!Engine.canAddDebt(S(), full())) { if (UI.paywall) UI.paywall(back || null); return false; }
  return true;
}

function addDebt(type, backToList) {
  var back = backToList && UI.openWallets ? function () { UI.openWallets(); } : null;
  if (!debtGate(back)) return;
  var owe = type !== 'owed';
  UI.openDlg({
    title: owe ? 'Я должен' : 'Мне должны',
    body: debtFormHtml('dn', { type: type }),
    buttons: [
      { label: 'Отмена', cls: 'nav', onClick: function () { if (back) { back(); return false; } } },
      { label: 'Добавить', cls: 'primary', onClick: function () {
        var r = readForm('dn', type);
        if (!r.ok) return false;
        var d;
        try {
          d = Engine.addDebt(S(), { type: type, name: r.v.name, amount: r.v.amount, pay: r.v.pay, day: r.v.day, rate: r.v.rate, due: r.v.due });
        } catch (e) { showErr('dnErr', 'Проверьте поля'); return false; }
        UI.save(); UI.render(); UI.haptic('medium');
        UI.toast('Долг «' + d.name + '» добавлен. ' + (type === 'owed' ? 'Отметить возврат - перетащите его плитку на кошелёк.' : 'Отметить платёж - перетащите кошелёк на его плитку.'));
        changed();
        if (back) { back(); return false; }
      } }
    ],
    onOpen: function () { bindForm('dn'); $('dnName').focus(); }
  });
}

// Настройки долга: имя, остаток (новая точка, как «Изменить баланс»), платёж, день, ставка
// или дата возврата; «Удалить» - здесь же.
function editDebt(id, backToList) {
  var d = Engine.findDebt(S(), id);
  if (!d) return;
  var back = backToList && UI.openWallets ? function () { UI.openWallets(); } : null;
  var bal = Engine.debtBalance(S(), id);
  UI.openDlg({
    title: d.type === 'owed' ? 'Мне должны' : 'Я должен',
    body: debtFormHtml('de', { type: d.type, name: d.name, amount: bal, pay: d.pay, day: d.day, rate: d.rate, due: d.due,
      amountLabel: d.type === 'owed' ? 'Сколько должны сейчас, ₽' : 'Остаток долга сейчас, ₽' }) +
      '<div class="ef-acts"><button class="btn danger" type="button" id="deDel">Удалить долг</button></div>',
    buttons: [
      { label: 'Отмена', cls: 'nav', onClick: function () { if (back) { back(); return false; } } },
      { label: 'Сохранить', cls: 'primary', onClick: function () {
        var r = readForm('de', d.type);
        if (!r.ok) return false;
        try {
          Engine.updateDebt(S(), id, { name: r.v.name, pay: r.v.pay, day: r.v.day, rate: r.v.rate, due: r.v.due });
          var baseChanged = Math.abs(r.v.amount - bal) > 0.004;
          if (baseChanged) Engine.setDebtBase(S(), id, r.v.amount);
        } catch (e) { showErr('deErr', 'Проверьте поля'); return false; }
        // остаток правится здесь (отдельной «Поправить остаток» в карточке больше нет): как она,
        // гасим баннер просрочки и при нуле предлагаем закрыть долг
        if (baseChanged) doneFor(id);
        UI.save(); UI.render(); if (UI.renderCard) UI.renderCard(); UI.haptic('light');
        UI.toast('Долг сохранён');
        changed();
        // Р11 ревью 15.10: из списка «Кошельки» (back) окно настройки закрывается, «Долг погашен?»
        // спрашивает и по своим кнопкам возвращает в список - раньше список открывался сразу, и
        // предложение сдавалось при открытом окне
        if (baseChanged && !(r.v.amount > 0)) { offerArchive(id, back); return; }   // ждёт, пока это окно закроется
        if (back) { back(); return false; }
      } }
    ],
    onOpen: function () {
      bindForm('de');
      $('deDel').addEventListener('click', function () { deleteDebtFlow(id, back); });
    }
  });
}

function deleteDebtFlow(id, back) {
  var d = Engine.findDebt(S(), id);
  if (!d) return;
  var n = Engine.debtHistory(S(), id).length;
  // куда идти, если долг на самом деле закрыт (14.10: кнопки «Долг погашен» больше нет)
  var how = !(Engine.debtBalance(S(), id) > 0) ? 'нажмите «' + CLOSE_WORD + '» в карточке'
    : 'запишите последний платёж или исправьте остаток в «Настроить» и нажмите «' + CLOSE_WORD + '»';
  UI.dlgConfirm({
    title: 'Удалить долг?',
    text: 'Удалить «' + d.name + '»' + (n ? ' вместе с историей (' + n + ' ' + Engine.plural(n, 'запись', 'записи', 'записей') + ')' : '') +
      '? Балансы кошельков не изменятся. Если долг уже закрыт - ' + how + ': он уйдёт в архив, а история сохранится.',
    danger: true, okLabel: 'Удалить',
    onOk: function () {
      var r = Engine.deleteDebt(S(), id);
      if (!r) return;
      if (UI.closeCard) UI.closeCard();
      UI.save(); UI.render(); UI.haptic('medium');
      UI.toast('Долг «' + r.name + '» удалён');
      changed();
      if (back) setTimeout(back, 0);
    }
  });
}

// ---------- «Поправить остаток» и «Долг погашен» ----------
function baseDlg(id) {
  var d = Engine.findDebt(S(), id);
  if (!d) return;
  UI.dlgPrompt({
    title: 'Поправить остаток',
    label: d.type === 'owed' ? 'Сколько вам должны сейчас, ₽' : 'Сколько осталось по долгу, ₽ (как в приложении банка)',
    type: 'text', inputmode: 'decimal', money: true,
    value: Engine.fmt(Engine.debtBalance(S(), id)),
    onOk: function (v) {
      var n = Engine.parseNum(v);
      if (!isFinite(n) || n < 0) { UI.dlgAlert('Нужно число не меньше нуля.', 'Не сохранилось'); return false; }
      if (n > Engine.MAX_AMOUNT) { UI.dlgAlert('Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + '\u00a0₽.', 'Не сохранилось'); return false; }
      Engine.setDebtBase(S(), id, n);
      doneFor(id);   // пришли из баннера просрочки - правка сохранена, баннер гаснет
      UI.save(); UI.render(); if (UI.renderCard) UI.renderCard(); UI.haptic('light');
      UI.toast('Остаток обновлён');
      changed();
      if (!(n > 0)) offerArchive(id);
    }
  });
}
function archive(id) {
  var d = Engine.findDebt(S(), id);
  if (!d) return;
  try { Engine.archiveDebt(S(), id); } catch (e) {
    // через setTimeout: archive зовут и из «ОК» другого окна, а оно закрывается после onClick -
    // открытое прямо здесь окно закрылось бы вместе с ним, молча (ревью 13.10 №3)
    setTimeout(function () { UI.dlgAlert('Остаток по «' + d.name + '» ещё не ноль. Запишите последний платёж или исправьте остаток в «Настроить».', 'Пока рано'); }, 0);
    return;
  }
  if (UI.closeCard) UI.closeCard();
  UI.save(); UI.render(); UI.haptic('medium');
  UI.toast('Долг «' + d.name + '» погашен и убран в архив. ' + ARCH_FIND);
  changed();
}
// где искать погашенный долг (тост архива, 14.10)
var ARCH_FIND = 'Найти: меню → «Настроить кошельки» → «Погашенные».';
// Одни слова для обоих видов долга (решение владельца 14.10): главная кнопка карточки -
// «Записать платёж», закрытие - «Долг погашен». Как закрыт долг, приложение не судит: других
// слов закрытия нет (заслон tests/debts-1410.test.js).
var PAY_WORD = 'Записать платёж', CLOSE_WORD = 'Долг погашен';

// ---------- выбор кошелька для денег долга (решения владельца 14.10) ----------
// «Записать платёж» (карточка, баннер просрочки, тап по напоминанию) сначала спрашивает кошелёк
// своим окном: экран суммы без кошелька оставлял «Подтвердить» неактивной, и было непонятно
// почему. Кошелёк прошлого раза - первым и с пометкой, но сам не выбирается: человек касается
// строки. Отдельной кнопки «Долг погашен» при остатке в карточке нет (дубль, решение владельца
// 14.10): погасить целиком - «Весь остаток» на экране суммы; закрыть без денег - остаток 0 в
// «Настроить», дальше окно «Долг погашен?».
function visWallets() {
  return S().wallets.filter(function (w) { return !w.hidden; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
}
// видимые кошельки, кошелёк прошлых денег этого долга - первым: {list, last}
function walletsFor(d) {
  var last = lastWalletOf(d.id, d.type === 'owed' ? 'take' : 'pay'), list = visWallets();
  if (last) list = list.filter(function (w) { return w.id === last; }).concat(list.filter(function (w) { return w.id !== last; }));
  return { list: list, last: last };
}
// строка кошелька-действие: значок цвета кошелька, имя, баланс (+ «в прошлый раз»), стрелка справа
function walletRowHtml(w, last) {
  return '<button type="button" class="set-row db-wr" data-wid="' + esc(w.id) + '">' +
    '<span class="db-wi ' + UI.wcolor(w) + '" aria-hidden="true">' + Icons.svg(Icons.walletKey(w.icon), 18) + '</span>' +
    '<span class="set-tx"><span class="set-t">' + esc(w.name) + '</span>' +
      '<span class="set-s">' + money(Engine.walletBalance(S(), w.id)) + '\u00a0₽' + (last ? ' · в прошлый раз' : '') + '</span></span>' +
    '<span class="db-go" aria-hidden="true">›</span>' +
  '</button>';
}
// Кошельков на экране нет - платить не с чего: вместо пустого экрана суммы - окно с «Добавить кошелёк»
function noWalletDlg(owe) {
  UI.openDlg({
    title: 'Сначала добавьте кошелёк',
    body: '<div class="set-p db-nw-p">' + (owe ? 'Платёж уходит с кошелька, а кошельков на экране нет.' : 'Возврат приходит на кошелёк, а кошельков на экране нет.') + '</div>',
    buttons: [
      { label: 'Отмена', cls: 'nav' },
      { label: 'Добавить кошелёк', cls: 'primary', onClick: function () { if (UI.addWallet) { UI.addWallet(); return false; } } }
    ]
  });
  var bb = $('dlgBtns'); if (bb) bb.classList.add('pw-btns');   // на 320 подпись не рвётся на две строки
}
// «Записать платёж» («я должен» - платёж, «мне должны» - возврат): окно выбора кошелька → экран
// суммы с ним (сумма платежа подставлена, как раньше; там же «Весь остаток X ₽»). Отмена окна -
// ничего не записано.
function payFlow(id) {
  var d = Engine.findDebt(S(), id);
  if (!d || d.archived) return false;
  var owe = d.type !== 'owed', ws = walletsFor(d);
  if (!ws.list.length) { noWalletDlg(owe); return 'nowallet'; }
  UI.openDlg({
    title: owe ? 'С какого кошелька платёж?' : 'На какой кошелёк платёж?',
    body: '<div class="set-list db-wl" id="dbWl">' + ws.list.map(function (w) { return walletRowHtml(w, w.id === ws.last); }).join('') + '</div>',
    buttons: [{ label: 'Отмена', cls: 'nav' }],
    onOpen: function () {
      $('dbWl').addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-wid]') : null;
        if (!b) return;
        var wid = b.getAttribute('data-wid');
        UI.closeDlg();
        UI.haptic('light');
        UI.openAmount(owe ? { kind: 'debtpay', debtId: id, walletId: wid } : { kind: 'debttake', debtId: id, walletId: wid });
      });
    }
  });
  return 'pick';
}
// Остаток дошёл до нуля действием человека с этим долгом (платёж жестом или из окна, «Мне
// вернули», правка суммы платежа, «Поправить остаток» на 0) - сразу окно «Долг погашен?».
// Удаление операции и отмена загрузки его не зовут. «Позже» - не спрашиваем снова, пока
// по долгу не было новой операции или правки (later: id → состояние долга при «Позже»).
var later = {};
function debtSig(id) {
  var d = Engine.findDebt(S(), id);
  return S().tx.filter(function (t) { return t.debtId === id; }).map(function (t) { return t.id + ':' + t.amount + ':' + t.date; }).join(',') +
    '|' + JSON.stringify((d && d.adj) || []);
}
// after (Р11 ревью 15.10) - куда вернуться, когда вопрос решён (любой кнопкой) или задавать его не
// нужно: окно «Настроить» из списка «Кошельки» возвращает в список уже после «Долг погашен?».
function offerArchive(id, after) {
  // через setTimeout: «ОК» закрывает своё окно после onClick - открытое прямо в нём закрылось бы
  function then() { if (after) setTimeout(after, 0); }
  var d = Engine.findDebt(S(), id);
  if (!d || d.archived || Engine.debtBalance(S(), id) > 0) { then(); return; }
  if (later[id] && later[id] === debtSig(id)) { then(); return; }
  setTimeout(function () {
    if (UI.dlgOpen && UI.dlgOpen()) return;   // уже открыто другое окно - не перебиваем его
    // за эти 350 мс долг могли уже закрыть, удалить или снова изменить
    d = Engine.findDebt(S(), id);
    if (!d || d.archived || Engine.debtBalance(S(), id) > 0) { then(); return; }
    // тост «… Отменить» (отмена платежа) под окном: отменённый платёж оставлял окно «Долг
    // погашен?» при остатке не ноль (ревью 13.10 №3). Окно спрашивает - тост убираем.
    if (UI.hideToast) UI.hideToast();
    UI.dlgConfirm({
      title: CLOSE_WORD + '?',
      text: 'Остаток по «' + d.name + '» - 0\u00a0₽. Долг уйдёт в архив, история платежей сохранится.',
      cancelLabel: 'Позже', okLabel: CLOSE_WORD, stack: true,
      onOk: function () {
        later[id] = null;
        var cur = Engine.findDebt(S(), id);
        if (!cur || cur.archived) { then(); return; }
        if (Math.abs(Engine.debtBalance(S(), id)) >= 0.005) {
          // остаток уже не ноль (платёж отменили, пока окно было открыто) - не молча
          setTimeout(function () {
            UI.dlgAlert('Остаток по «' + cur.name + '» уже не ноль: ' + money(Engine.debtBalance(S(), id)) + '\u00a0₽. Долг остаётся на экране.', 'Долг не закрыт', after);
          }, 0);
          return;
        }
        archive(id);
        then();
      },
      onCancel: function () { later[id] = debtSig(id); then(); }
    });
  }, 350);
}
// Закрыт с остатком (старой кнопкой «Долг погашен» до 14.10) - возврат снимает то обнуление: остаток снова
// прежний, об этом - в подтверждении (ревью 13.10 №1в). Закрыт при нуле - сразу.
function restoreDebt(id) {
  var d = Engine.findDebt(S(), id);
  if (!d || !d.archived) return;
  var back = UI.openWallets ? function () { UI.openWallets(); } : null;
  if (!debtGate(back)) return;
  var left = Engine.closedLeft(S(), id);
  function go() {
    var cur = Engine.findDebt(S(), id);
    if (!cur || !cur.archived) return;
    var got = Engine.reopenDebt(S(), id);
    UI.save(); UI.render(); UI.haptic('light');
    UI.toast('Долг «' + d.name + '» снова на экране' + (got ? ', остаток ' + money(got) + '\u00a0₽' : ''));
    changed();
    if (back) setTimeout(back, 0);
  }
  if (!(left > 0)) { go(); return; }
  UI.dlgConfirm({
    title: 'Вернуть из архива?',
    text: '«' + d.name + '» снова будет на экране. Остаток ' + money(left) + '\u00a0₽ вернётся: обнуление при закрытии снимется.',
    okLabel: 'Вернуть',
    onOk: go
  });
}

// ---------- карточка долга (лист #card) ----------
function statusLine(d) {
  if (d.type === 'owed') {
    if (!d.due) return '';
    return 'Вернуть до ' + dayMonth(d.due) + (d.due.slice(0, 4) !== Engine.today().slice(0, 4) ? ' ' + d.due.slice(0, 4) : '');
  }
  var st = Engine.debtStatus(S(), d.id, UI.screenDay ? UI.screenDay() : Engine.today());
  if (st.state === 'paid') return 'Платёж за ' + monthAcc(st.ym) + ' записан';
  if (st.state === 'soon') return 'Платёж за ' + monthAcc(st.ym) + ' - до ' + dayMonth(st.due);
  if (st.state === 'overdue') { var mt = missedText(st.missed || [st.ym]); return '<b class="db-late">' + mt.charAt(0).toUpperCase() + mt.slice(1) + '</b>'; }
  return '';
}
function historyRowHtml(r, d) {
  var name, sign;
  if (d.type === 'owed') { name = r.op === 'take' ? 'Вернули' : 'Дали в долг'; sign = r.op === 'take' ? '−' : '+'; }
  else { name = r.op === 'take' ? 'Взяли в долг' : 'Платёж'; sign = r.op === 'take' ? '+' : '−'; }
  var meta = [txDate(r.date), UI.walletName(r.walletId) || 'без кошелька'];
  if (r.interest > 0) meta.push('в счёт долга ' + money(r.body) + '\u00a0₽, проценты ' + money(r.interest) + '\u00a0₽');
  // архивный долг: история только для просмотра - не .txrow (свайп и тап её не берут), без
  // «Править»/«Удалить»; менять - после «Вернуть из архива» (ревью 13.10 №2)
  return (d.archived ? '<div class="dbro" data-id="' + esc(r.id) + '">' : '<div class="txrow" data-id="' + esc(r.id) + '">' +
    '<div class="txact edit" aria-hidden="true">Править</div>' +
    '<div class="txact del" aria-hidden="true">Удалить</div>') +
    '<div class="txfront">' +
      '<div class="txico dbt ' + d.type + '" aria-hidden="true">' + UI.DEBT_GLYPH + '</div>' +
      '<div class="txmid">' +
        '<div class="txn">' + esc(name) + '</div>' +
        '<div class="txmeta db-meta">' + esc(meta.join(' · ')) + '</div>' +
      '</div>' +
      '<div class="txa zero">' + sign + money(r.total) + '\u00a0₽</div>' +
    '</div>' +
  '</div>';
}
// Закрыт с остатком (до 14.10) - строка истории «Долг погашен · остаток X ₽ обнулён» (ревью 13.10 №1а)
function closeRowHtml(e, d) {
  return '<div class="dbro db-ev">' +
    '<div class="txfront">' +
      '<div class="txico dbt ' + d.type + '" aria-hidden="true">' + UI.DEBT_GLYPH + '</div>' +
      '<div class="txmid">' +
        '<div class="txn">' + CLOSE_WORD + '</div>' +
        '<div class="txmeta db-meta">' + esc(txDate(e.date) + ' · остаток ' + money(e.left) + '\u00a0₽ обнулён') + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}
var REMIND_ICO = '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5h4"/>';
function renderDebtCard(id) {
  var d = Engine.findDebt(S(), id);
  if (!d) return false;
  var owe = d.type !== 'owed', pr = Engine.debtProgress(S(), id);
  var ico = $('cardIco');
  ico.className = 'sh-ico debt ' + d.type;
  ico.innerHTML = UI.debtMark(d);
  $('cardTitle').textContent = d.name;
  $('cardSub').textContent = (owe ? 'Я должен' : 'Мне должны') + (d.archived ? ' · в архиве' : '');
  var amt = $('cardAmt');
  amt.textContent = money(pr.left) + '\u00a0₽';
  amt.classList.remove('neg');
  // Р10 ревью 15.10: 1 - 80 000 / 100 000 в дробях = 0,1999… - без допуска выходило «19 %»
  var pct = Math.floor(pr.share * 100 + 1e-9);
  // Р15 ревью 15.10: ставка - той же UI.rateText, что в шапке карточки и на плитке
  var info = owe
    ? 'Платёж ' + money(d.pay) + '\u00a0₽ · ' + d.day + '-го числа' + (d.rate ? ' · ставка ' + UI.rateText(d.rate) : '')
    : '';
  var st = d.archived ? '' : statusLine(d);
  var zero = !(pr.left > 0);
  // Сверху - только главное (сколько было, доля, что с платежом этого месяца, кнопки), всё
  // остальное (условия, напоминание, история) - в прокручиваемом списке ниже: на 320x640
  // лист иначе не вмещал историю.
  var h = '<div class="db-prog">' +
      '<div class="db-pl"><span>было ' + money(pr.was) + '\u00a0₽</span><span>' + (owe ? 'выплачено ' : 'вернули ') + pct + '\u00a0%</span></div>' +
      '<div class="db-bar ' + d.type + '" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
    '</div>' +
    (st ? '<div class="db-st">' + st + '</div>' : '');
  var top = (info ? '<div class="db-info">' + esc(info) +
    // 14.10: как считаются проценты - одной строкой, только если ставка есть
    (owe && d.rate > 0 ? '<span class="db-info-s">Проценты берутся раз в месяц, с первого платежа. Досрочный платёж целиком идёт в счёт долга.</span>' : '') +
    '</div>' : '');
  if (d.archived) {
    h += '<button class="btn ghost w100" type="button" id="dbRestore">Вернуть из архива</button>';
  } else {
    h += zero
      ? '<button class="btn primary w100" type="button" id="dbArchive">' + CLOSE_WORD + '</button>'
      : '<button class="btn primary w100" type="button" id="dbPay">' + PAY_WORD + '</button>';
    // «Поправить остаток» отдельной кнопкой убран (Алексей 13.10): остаток правится в «Настроить».
    // Кнопки «Долг погашен» при остатке больше нуля нет (решение владельца 14.10): она делала то
    // же, что «Записать платёж» на весь остаток. Погасить целиком - «Весь остаток» на экране
    // суммы, закрыть без денег - остаток 0 в «Настроить», дальше окно «Долг погашен?».
    h += '<button class="btn ghost w100" type="button" id="dbSetup">Настроить</button>';
    if (owe || d.due) {
      // включено, но уведомления запрещены в настройках телефона - честно «выключено»
      var rmOn = d.remind && !remindBlocked(), rmBlocked = d.remind && remindBlocked();
      top += '<div class="db-rm">' +
        '<button type="button" class="set-row c-green" id="dbRemind" aria-pressed="' + (rmOn ? 'true' : 'false') + '">' +
          '<span class="mi-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + REMIND_ICO + '</svg></span>' +
          '<span class="set-tx"><span class="set-t">' + (owe ? 'Напомнить о платеже' : 'Напомнить о возврате') + '</span>' +
            '<span class="set-s' + (rmBlocked ? ' db-late' : '') + '">' + (rmBlocked ? 'уведомления запрещены в настройках телефона' : (owe ? 'Накануне и в день платежа. В\u00a010:00' : 'Накануне и в день возврата. В\u00a010:00')) + '</span></span>' +
          '<span class="mi-sw' + (rmOn ? ' on' : '') + '" aria-hidden="true"><i></i></span></button>' +
        (rmBlocked ? '<button type="button" class="btn ghost db-test" id="dbPerm">Открыть настройки</button>' : '') +
        (testBuild() && rmOn ? '<button type="button" class="btn ghost db-test" id="dbTest">Проверить напоминание (тестовая сборка)</button>' : '') +
      '</div>';
    }
  }
  $('cardActs').innerHTML = h;

  var hist = Engine.debtHistory(S(), id);
  var rows = hist.map(function (r) { return { date: r.date, ts: r.ts, html: historyRowHtml(r, d) }; })
    .concat(Engine.debtCloseEvents(S(), id).map(function (e) { return { date: e.date, ts: e.ts, html: closeRowHtml(e, d) }; }))
    .sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.ts || 0) - (a.ts || 0); });
  $('cardList').innerHTML = (top ? '<div class="db-top">' + top + '</div>' : '') + (rows.length
    ? '<div class="db-hh">История</div>' + rows.map(function (r) { return r.html; }).join('')
    : '<div class="empty">' + (owe ? 'Платежей пока нет. Перетащите кошелёк на плитку долга - это платёж. Взяли ещё в долг - перетащите плитку долга на кошелёк.' : 'Возвратов пока нет. Вернули - перетащите плитку долга на кошелёк или нажмите «Записать платёж». Дали ещё - перетащите кошелёк на плитку долга.') + '</div>');
  // Подсказка про свайп - в самом списке, над «Историей» (а не внизу листа): на 320x640 внизу
  // она закрывала строку «Напомнить о платеже». Тот же узел #cardHint (свайп гашения к нему
  // привязан), карточки кошелька и категории возвращают его на место (sheet.js homeCardHint).
  var hintEl = $('cardHint');
  var swipeShown = !d.archived && UI.hintShouldShow('cardSwipe') && hist.length > 0;
  if (hintEl) {
    var ht = hintEl.querySelector('.sh-ht');
    if (ht) ht.textContent = 'Потяните строку влево - удалить, вправо - править.';
    hintEl.hidden = !swipeShown;
    var hh = $('cardList').querySelector('.db-hh');
    if (swipeShown && hh) { hintEl.classList.add('sh-hint-in'); $('cardList').insertBefore(hintEl, hh); }
  }
  var adj = $('cardAdjustHint'); if (adj) adj.hidden = true;

  function on(idx, fn) { var b = $(idx); if (b) b.addEventListener('click', fn); }
  on('dbPay', function () {
    UI.closeCard();
    payFlow(id);   // сначала кошелёк своим окном (решение 14.10), потом экран суммы
  });
  on('dbArchive', function () { archive(id); });
  on('dbRestore', function () { UI.closeCard(); restoreDebt(id); });
  on('dbSetup', function () { editDebt(id); });
  on('dbRemind', function () { toggleRemind(id); });
  on('dbTest', function () { testReminder(id); });
  on('dbPerm', function () { openSettings(); });
  return true;
}

// ---------- кредитная карта: отметка в форме кошелька (edit.js walletForm) ----------
// Решение 12.10: кредитка остаётся кошельком. Отметка «Кредитная карта» открывает
// необязательный день платежа по карте (та же сетка 7 x 5) и тумблер напоминания (тот же плагин,
// тот же контроль разрешения, что у долгов). Окно разрешения поверх формы открыть нельзя
// (окно одно) - отказ показан прямо в строке тумблера с кнопкой «Открыть настройки».
// Free: отметку не ограничиваем - кошельки и так считаются лимитом free.
var CARD_ICO = '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10.5h18M7 15h4"/>';
function swRowHtml(id, on, title, sub, late, ico, dis) {
  return '<button type="button" class="set-row c-green' + (dis ? ' cr-dis' : '') + '" id="' + id + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (dis ? ' aria-disabled="true"' : '') + '>' +
    '<span class="mi-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ico + '</svg></span>' +
    '<span class="set-tx"><span class="set-t">' + title + '</span><span class="set-s' + (late ? ' db-late' : '') + '">' + sub + '</span></span>' +
    '<span class="mi-sw' + (on ? ' on' : '') + '" aria-hidden="true"><i></i></span></button>';
}
function creditForm(pfx, w) {
  var saved = !!(w && w.credit === true);
  var st = { credit: saved, day: saved ? (w.payDay || null) : null, remind: saved && !!w.remind, denied: false };
  function remindHtml() {
    var noDay = !st.day, blocked = !noDay && ((st.remind && remindBlocked()) || st.denied);
    var on = !noDay && st.remind && !blocked;
    var h = swRowHtml(pfx + 'CrRemind', on, 'Напомнить о платеже',
      noDay ? 'Сначала выберите день платежа' : blocked ? 'уведомления запрещены в настройках телефона' : 'Накануне и в день платежа, в\u00a010:00 - пока карта в минусе',
      blocked, REMIND_ICO, noDay);
    if (blocked) h += '<button type="button" class="btn ghost db-test" id="' + pfx + 'CrPerm">Открыть настройки</button>';
    // проверка (тест-сборка) - сразу после включения тумблера, без сохранения формы (баг 12.10:
    // кнопка появлялась только у сохранённой карты, после повторного открытия). Проверке
    // сохранённый кошелёк не нужен: имя берём из формы, id - если карта уже есть.
    if (testBuild() && on) h += '<button type="button" class="btn ghost db-test" id="' + pfx + 'CrTest">Проверить напоминание (тестовая сборка)</button>';
    return h;
  }
  st.html = '<div class="ef cr-box">' +
      swRowHtml(pfx + 'Credit', st.credit, 'Кредитная карта', 'Минус на карте - ваш долг банку. В долговую нагрузку не входит.', false, CARD_ICO) +
      '<div class="cr-more" id="' + pfx + 'CrMore"' + (st.credit ? '' : ' hidden') + '>' +
        '<div class="ef"><span class="lbl">День платежа по карте</span>' + dayGridHtml(pfx + 'Cr', st.day, 'День платежа по карте') +
          '<div class="hint">Дата из приложения банка, до которой нужно внести платёж</div></div>' +
        '<div class="db-rm" id="' + pfx + 'CrRm">' + remindHtml() + '</div>' +
      '</div></div>';
  function paintRemind() {
    var box = $(pfx + 'CrRm');
    if (!box) return;
    box.innerHTML = remindHtml();
    var r = $(pfx + 'CrRemind'), pm = $(pfx + 'CrPerm'), ts = $(pfx + 'CrTest');
    if (r) r.addEventListener('click', toggle);
    if (pm) pm.addEventListener('click', function () { openSettings(); });
    if (ts) ts.addEventListener('click', function () {
      var nm = $(pfx + 'Name'), name = String((nm && nm.value) || (w && w.name) || '').trim() || 'Кредитная карта';
      testCardReminder(w ? w.id : '', name);
    });
  }
  // включение: тот же путь разрешения, что у долга (toggleRemind), только без окна поверх формы
  function toggle() {
    UI.haptic('light');
    if (!st.day) return Promise.resolve(false);
    if (st.remind && !remindBlocked() && !st.denied) { st.remind = false; paintRemind(); return Promise.resolve(false); }
    var p = plugin();
    if (!p) { st.remind = true; st.denied = false; paintRemind(); return Promise.resolve(true); }
    return call(p, 'checkPermission').then(function (r) {
      if (r && r.granted) return true;
      var release = away();
      return call(p, 'requestPermission').then(function (x) {
        if (typeof release === 'function') release();
        return !!(x && x.granted);
      }, function () { if (typeof release === 'function') release(); return false; });
    }, function () { return false; }).then(function (granted) {
      setPerm(granted);
      st.denied = !granted;
      st.remind = !!granted;
      paintRemind();
      return !!granted;
    });
  }
  st.toggleRemind = toggle;
  st.bind = function () {
    var c = $(pfx + 'Credit');
    c.addEventListener('click', function () {
      st.credit = !st.credit;
      c.setAttribute('aria-pressed', st.credit ? 'true' : 'false');
      c.querySelector('.mi-sw').classList.toggle('on', st.credit);
      $(pfx + 'CrMore').hidden = !st.credit;
      UI.haptic('light');
    });
    var g = $(pfx + 'CrDayGrid');
    g.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-day]') : null;
      if (!b) return;
      var v = +b.getAttribute('data-day');
      st.day = st.day === v ? null : v;   // то же число ещё раз - день убран
      $(pfx + 'CrDay').value = st.day || '';
      all(g, '.dg-d').forEach(function (x) { var on = +x.getAttribute('data-day') === st.day; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
      UI.haptic('light');
      paintRemind();
    });
    paintRemind();
  };
  st.read = function () { return { credit: st.credit, payDay: st.credit ? st.day : null, remind: st.credit && !!st.day && st.remind && !st.denied }; };
  return st;
}

// ---------- блок «Долги» в «Настроить кошельки» ----------
var archFolded = true;
function tileHtml(d, off) {
  return '<button type="button" class="wtile dtile ' + d.type + (off ? ' off' : '') + '" data-debt="' + esc(d.id) + '">' +
    '<span class="ico">' + UI.debtMark(d) + '</span>' +
    '<span class="wt-n">' + esc(d.name) + '</span>' +
    '<span class="wt-b">' + fmt(Engine.debtBalance(S(), d.id)) + '\u00a0₽</span></button>';
}
function debtsListHtml() {
  var live = Engine.debtsActive(S());
  var arch = (S().debts || []).filter(function (d) { return d.archived; });
  var atCap = !Engine.canAddDebt(S(), full());
  var h = '<div class="wl-sec">Долги</div><div class="wgrid" id="wlDebts">' +
    live.map(function (d) { return tileHtml(d); }).join('') +
    '<button class="wtile add" type="button" id="wlAddDebt">＋ Долг' + (atCap ? ' <span class="clr-lock">🔒</span>' : '') + '</button>' +
    '</div>';
  if (arch.length) {
    h += '<button class="btn ghost wide wl-fold" type="button" id="wlArchFold">' +
      (archFolded ? 'Погашенные (' + arch.length + ')' : 'Свернуть погашенные') + '</button>';
    if (!archFolded) h += '<div class="wl-foldt">Погашенные долги не видно на главном экране, история платежей цела.</div>' +
      '<div class="wgrid" id="wlArch">' + arch.map(function (d) { return tileHtml(d, true); }).join('') + '</div>';
  }
  return h;
}
function bindDebtsList() {
  all($('dlgBody'), '.wtile[data-debt]').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-debt'), d = Engine.findDebt(S(), id);
      if (!d) return;
      if (d.archived) { UI.closeDlg(); UI.openCard({ kind: 'debt', id: id }); }
      else editDebt(id, true);
    });
  });
  var add = $('wlAddDebt');
  if (add) add.addEventListener('click', function () { pickType(true); });
  var f = $('wlArchFold');
  if (f) f.addEventListener('click', function () { archFolded = !archFolded; UI.haptic('light'); if (UI.openWallets) UI.openWallets(); });
}
// «+ Долг» из списка: какой вид
function pickType(backToList) {
  var back = backToList && UI.openWallets ? function () { UI.openWallets(); } : null;
  if (!debtGate(back)) return;
  UI.openDlg({
    title: 'Новый долг',
    body: '<div class="op-pick">' +
      '<button type="button" class="btn ghost" data-t="owe">Я должен</button>' +
      '<button type="button" class="btn ghost" data-t="owed">Мне должны</button></div>',
    buttons: [{ label: 'Отмена', cls: 'nav', onClick: function () { if (back) { back(); return false; } } }],
    onOpen: function () {
      $('dlgBody').querySelector('.op-pick').addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-t]') : null;
        if (b) addDebt(b.getAttribute('data-t'), backToList);
      });
    }
  });
}

// ---------- баннер просрочки ----------
// Один на долг на месяц: закрыли (любой кнопкой) - этот месяц по этому долгу больше не
// показываем (S.ui.debtWarn). Стоит на месте карточки «Сохраните копию» и, пока виден,
// так же прячет «плюс» и подсказку главного.
var warnFor = null;   // {id, ym}
function warnKey(w) { return w.id + '|' + w.ym; }
function locked() { return !!(window.AppLock && window.AppLock.isLocked && window.AppLock.isLocked()); }
function busy() {
  if (locked()) return true;
  try { if (UI.topOverlay && UI.topOverlay()) return true; } catch (e) {}
  return !!(UI.onboardOpen && UI.onboardOpen());
}
function pendingWarn(todayStr) {
  var seen = (S().ui && S().ui.debtWarn) || {};
  var list = Engine.debtsActive(S());
  for (var i = 0; i < list.length; i++) {
    var st = Engine.debtStatus(S(), list[i].id, todayStr);
    if (st.state === 'overdue' && !seen[list[i].id + '|' + st.ym]) return { id: list[i].id, ym: st.ym, missed: st.missed };
  }
  // у кредитных карт баннера нет никогда (упрощение 13.10): только напоминание о дне платежа
  return null;
}
// «нет платежа за март» / «нет платежей за февраль и март» / «нет платежей за 4 месяца, с января»
function missedText(ms) {
  if (ms.length <= 1) return 'нет платежа за ' + monthAcc(ms[0]);
  if (ms.length === 2) return 'нет платежей за ' + monthAcc(ms[0]) + ' и ' + monthAcc(ms[1]);
  return 'нет платежей за ' + ms.length + ' ' + Engine.plural(ms.length, 'месяц', 'месяца', 'месяцев') + ', с ' + MONTH_GEN[+ms[0].slice(5, 7) - 1];
}
function warnEl() { return $('debtWarn'); }
function warnShown() { var el = warnEl(); return !!el && !el.hidden; }
function checkWarn(todayStr) {
  var el = warnEl();
  if (!el) return false;
  var w = pendingWarn(todayStr || (UI.screenDay ? UI.screenDay() : Engine.today()));
  if (!w) { if (!el.hidden) hideWarn(); return false; }
  if (warnShown() && warnFor && warnKey(warnFor) === warnKey(w)) return true;
  // своя очередь: пока открыт слой или видна карточка «Сохраните копию» - ждём
  if (busy() || (window.Nudges && window.Nudges.remindShown && window.Nudges.remindShown())) return false;
  warnFor = w;
  var tEl = el.querySelector('.dw-t'), fix = $('dwFix'), pay = $('dwPay');
  var d = Engine.findDebt(S(), w.id);
  if (tEl) tEl.textContent = 'Нет платежа по долгу';
  $('dwText').textContent = 'По «' + d.name + '» ' + missedText(w.missed || [w.ym]) + '. Если уже заплатили - запишите платёж. ' +
    'Если пропустили - банк начислит пени и проценты за просрочку: проверьте остаток долга в приложении банка и поправьте его кнопкой «Поправить остаток».';
  if (fix) fix.hidden = false;
  if (pay) pay.textContent = 'Записать платёж';
  el.hidden = false;
  syncMain();
  return true;
}
function hideWarn() { var el = warnEl(); if (el && !el.hidden) { el.hidden = true; syncMain(); } }
function syncMain() { try { if (UI.updateMainHint) UI.updateMainHint(); } catch (e) {} }
function dismissWarn() {
  if (!warnFor) { hideWarn(); return null; }
  var w = warnFor;
  if (!S().ui.debtWarn) S().ui.debtWarn = {};
  S().ui.debtWarn[warnKey(w)] = true;
  UI.save();
  warnFor = null;
  hideWarn();
  return w;
}
// «Записать платёж» и «Поправить остаток» баннер сами не гасят: передумали («Отмена» на
// экране суммы или в окне) - баннер на месте. Гаснет после записи платежа по этому долгу
// (UI.debtTxSaved из ui.js) или сохранённой правки остатка, либо по «×».
var actFor = null;   // по какому баннеру открыли платёж/правку
function doneFor(id) {
  if (!actFor || actFor.id !== id) return;
  warnFor = actFor; actFor = null;
  dismissWarn();
}
if ($('dwPay')) $('dwPay').addEventListener('click', function () {
  if (!warnFor) return;
  actFor = warnFor;
  payFlow(warnFor.id);
});
// Пополнение кредитки (тап по напоминанию): перевод НА эту карту, сумма = текущий минус карты,
// «откуда» - кошелёк прошлого пополнения (нет - выбор).
function lastTopUpFrom(id) {
  var best = null;
  S().tx.forEach(function (t) {
    if (t.kind !== 'transfer' || t.toWalletId !== id || !t.walletId) return;
    var w = Engine.findWallet(S(), t.walletId);
    if (!w || w.hidden || w.credit === true) return;
    if (!best || t.date > best.date || (t.date === best.date && (t.ts || 0) >= (best.ts || 0))) best = t;
  });
  return best ? best.walletId : null;
}
function topUpCard(id) {
  var bal = Engine.walletBalance(S(), id);
  UI.openAmount({ kind: 'transfer', toWalletId: id, walletId: lastTopUpFrom(id) }, bal < 0 ? Math.round(-bal * 100) / 100 : null);
}
if ($('dwFix')) $('dwFix').addEventListener('click', function () {
  if (!warnFor) return;
  actFor = warnFor;
  baseDlg(warnFor.id);
});
UI.debtTxSaved = doneFor;
if ($('dwClose')) $('dwClose').addEventListener('click', function () { dismissWarn(); UI.haptic('light'); });

// ---------- напоминания: плагин Reminders ----------
// Разрешение на уведомления проверяется не только при включении тумблера: его могут снять в
// настройках телефона, а копия с другого телефона приносит долги с remind:true. Поэтому
// перед каждой отдачей плана (запуск, возврат из фона, восстановление из копии - любая
// смена плана) - checkPermission. Нет разрешения - план телефону не отдаём (пустой: старые
// будильники снимаются), тумблер в карточке честно выключен с подписью «уведомления
// запрещены в настройках телефона» и кнопкой «Открыть настройки», и один раз - мягкое окно.
var pluginOverride = null;   // self-test подкладывает поддельный плагин
function plugin() {
  if (pluginOverride) return pluginOverride;
  if (!(window.isNativeApp && window.isNativeApp())) return null;
  var N = window.NativePlugins;
  return (N && N.Reminders) ? N.Reminders : null;
}
function away() { return (window.AppLock && window.AppLock.away) ? window.AppLock.away(window.AppLock.AWAY_CALL) : null; }
function call(p, name, arg) {
  try { return Promise.resolve(p[name](arg || {})); } catch (e) { return Promise.reject(e); }
}
// путь к настройке уведомлений - один текст во всех окнах (14.10)
var NOTIF_PATH = 'Разрешить: «Открыть настройки» → «Уведомления» → включить.';
var perm = null;       // разрешение на уведомления: true / false / null (не знаем, нет плагина)
var lastPlan = null;   // что уже отдано телефону (JSON) - не дёргаем плагин без изменений
function refreshPerm(p) {
  return call(p, 'checkPermission').then(function (r) { return setPerm(!!(r && r.granted)); },
    function () { return perm; });
}
function setPerm(v) {
  var was = perm;
  perm = v;
  if (v === true && S().ui && S().ui.remindDenied) { S().ui.remindDenied = false; UI.save(); }
  if (was !== v && UI.cardOpen && UI.cardOpen() && UI.renderCard) UI.renderCard();
  return v;
}
function remindBlocked() { return perm === false && plugin() !== null; }
function syncReminders(force) {
  var p = plugin();
  if (!p) return Promise.resolve(null);
  var plan = Engine.reminderPlan(S(), Date.now(), 12);
  var key = JSON.stringify(plan);
  if (!force && key === lastPlan) return Promise.resolve(null);
  lastPlan = key;
  var check = plan.length ? refreshPerm(p) : Promise.resolve(perm);
  return check.then(function (ok) {
    var blocked = plan.length > 0 && ok === false;
    if (blocked) softDenied();
    // без разрешения план не ставим вслепую: пусто - старые будильники сняты
    var send = blocked ? [] : plan;
    return call(p, 'schedule', { events: send }).then(function (r) { return r || { ok: true }; },
      function () { lastPlan = null; return null; });
  });
}
// Мягкое окно «напоминания не придут» - один раз (S.ui.remindDenied), пока разрешение снова
// не дадут. Занят экран (замок, открытое окно) - покажем на следующей проверке.
function softDenied() {
  var ui = S().ui;
  if (!ui || ui.remindDenied) return false;
  if (busy() || (UI.dlgOpen && UI.dlgOpen())) { lastPlan = null; return false; }
  ui.remindDenied = true;
  UI.save();
  UI.openDlg({
    title: 'Напоминания не придут',
    body: '<div class="set-p">Уведомления «Хомяка» запрещены в настройках телефона, поэтому напоминания о платежах по долгам и кредитным картам не придут. ' +
      NOTIF_PATH + ' Напоминание приходит без сумм.</div>',
    buttons: [
      { label: 'Позже', cls: 'nav' },
      { label: 'Открыть настройки', cls: 'primary', onClick: function () { openSettings(); } }
    ]
  });
  return true;
}
function openSettings() {
  var p = plugin();
  if (!p) return;
  var release = away();
  call(p, 'openSettings').then(function () { if (typeof release === 'function') release(); }, function () { if (typeof release === 'function') release(); });
}
function setRemind(id, on) {
  Engine.updateDebt(S(), id, { remind: !!on });
  UI.save();
  if (UI.renderCard) UI.renderCard();
  syncReminders();
}
// Включение: Android 13+ спрашивает разрешение на уведомления. Отказ (или уведомления
// выключены в настройках) - своё окно с объяснением и кнопкой «Открыть настройки», тумблер
// остаётся выключенным. Тумблер «включён, но разрешения нет» показан выключенным - нажатие
// снова спрашивает разрешение.
function toggleRemind(id) {
  var d = Engine.findDebt(S(), id);
  if (!d) return Promise.resolve(false);
  UI.haptic('light');
  if (d.remind && !remindBlocked()) { setRemind(id, false); UI.toast('Напоминание выключено'); return Promise.resolve(false); }
  var p = plugin();
  if (!p) {   // браузер: уведомлений нет, но настройка запоминается (поедет в копии на телефон)
    setRemind(id, true);
    UI.toast('Напоминание включено');
    return Promise.resolve(true);
  }
  return call(p, 'checkPermission').then(function (r) {
    if (r && r.granted) return true;
    var release = away();
    return call(p, 'requestPermission').then(function (x) {
      if (typeof release === 'function') release();
      return !!(x && x.granted);
    }, function () { if (typeof release === 'function') release(); return false; });
  }, function () { return false; }).then(function (granted) {
    setPerm(granted);
    if (!granted) { deniedDlg(); return false; }
    if (d.remind) { lastPlan = null; syncReminders(true); if (UI.renderCard) UI.renderCard(); }
    else setRemind(id, true);
    UI.toast(d.type === 'owed' ? 'Напомню за день до возврата и в сам день' : 'Напомню за день до платежа и в сам день');
    return true;
  });
}
function deniedDlg() {
  UI.openDlg({
    title: 'Уведомления выключены',
    body: '<div class="set-p">Без разрешения на уведомления «Хомяк» не сможет напомнить о платеже. ' +
      NOTIF_PATH + ' Напоминание приходит только про дату и название долга, без сумм.</div>',
    buttons: [
      { label: 'Закрыть', cls: 'nav' },
      { label: 'Открыть настройки', cls: 'primary', onClick: function () { openSettings(); } }
    ]
  });
}
// Только тестовая сборка: прислать уведомление этого долга через несколько секунд тем же
// путём (будильник → приёмник → уведомление). В стор-сборке кнопки нет.
function testReminder(id) {
  var d = Engine.findDebt(S(), id) || Engine.findWallet(S(), id), p = plugin();
  if (!d || !testBuild()) return Promise.resolve(false);
  if (!p) { UI.toast('Проверка работает только на телефоне'); return Promise.resolve(false); }
  if (!d.type) return testCardReminder(d.id, d.name);   // кошелёк (кредитка), а не долг
  return testCall(p, { delaySec: 5, debt: d.id, kind: 'debt',
    title: (d.type === 'owe' ? 'Завтра платёж по долгу «' : 'Завтра срок возврата долга «') + d.name + '»',
    text: 'Проверка напоминания (тестовая сборка).' });
}
// kind: 'credit' - на экране блокировки «Напоминание о платеже по кредитной карте» (ReminderReceiver)
function testCardReminder(id, name) {
  var p = plugin();
  if (!testBuild()) return Promise.resolve(false);
  if (!p) { UI.toast('Проверка работает только на телефоне'); return Promise.resolve(false); }
  return testCall(p, { delaySec: 5, debt: id || '', kind: 'credit',
    title: 'Завтра платёж по кредитной карте «' + name + '»',
    text: 'Проверка напоминания (тестовая сборка).' });
}
function testCall(p, o) {
  return call(p, 'test', o).then(function () {
      UI.toast('Уведомление придёт через несколько секунд');
      return true;
    }, function () { UI.toast('Не получилось поставить проверку'); return false; });
}

// ---------- тап по уведомлению-напоминанию → платёж по этому долгу ----------
// Оболочка кладёт id долга (и дату срока) в интент запуска; забираем takeTap на старте и при
// каждом возврате в приложение (холодный старт, приложение открыто или в фоне). «Я должен» -
// окно платежа: сумма = ежемесячный платёж, «откуда» = кошелёк последнего платежа по долгу
// (нет его - выбор кошелька), человек проверяет и жмёт «Подтвердить». Срок уже закрыт -
// карточка долга. «Мне должны» - окно «Мне вернули». Стоит замок - ждём разблокировки.
function lastWalletOf(id, op) {
  var best = null;
  S().tx.forEach(function (t) {
    if (t.debtId !== id || t.kind !== 'debt' || t.op !== op || !t.walletId) return;
    var w = UI.S.wallets.filter(function (x) { return x.id === t.walletId && !x.hidden; })[0];
    if (!w) return;
    if (!best || t.date > best.date || (t.date === best.date && (t.ts || 0) >= (best.ts || 0))) best = t;
  });
  return best ? best.walletId : null;
}
function termPaid(d, due) {
  if (due && Engine.isDate(due)) {
    var m = due.slice(0, 7), T = Engine.debtTerms(S(), d.id, m).filter(function (x) { return x.ym === m; })[0];
    if (T) return T.paid;
  }
  return Engine.debtStatus(S(), d.id, Engine.today()).state === 'paid';
}
var tapWait = null;
function openFromReminder(id, due) {
  var d = Engine.findDebt(S(), id);
  if (!d) return openCardFromReminder(id);
  if (d.archived) return false;
  if (locked()) {   // «Защита входа»: сначала замок, после разблокировки - сразу окно платежа
    clearTimeout(tapWait);
    tapWait = setTimeout(function () { openFromReminder(id, due); }, 400);
    return 'wait';
  }
  try { if (UI.closeTop) { for (var g = 0; g < 8 && UI.closeTop(); g++) {} } } catch (e) {}
  if (UI.closeAmount) UI.closeAmount();
  var owe = d.type !== 'owed';
  if (!(Engine.debtBalance(S(), id) > 0) || (owe && termPaid(d, due))) {
    UI.openCard({ kind: 'debt', id: id });
    return 'card';
  }
  // как кнопки карточки: сначала окно выбора кошелька (прошлый - первым), потом экран суммы
  payFlow(id);
  return 'pay';
}
// Кредитная карта (id кошелька в том же поле интента): карта в минусе - перевод НА неё
// (сумма = минус, «откуда» - кошелёк прошлого пополнения); уже не в минусе - карточка кошелька.
function openCardFromReminder(id) {
  var w = Engine.findWallet(S(), id);
  if (!w || w.credit !== true || w.hidden) return false;
  if (locked()) {
    clearTimeout(tapWait);
    tapWait = setTimeout(function () { openCardFromReminder(id); }, 400);
    return 'wait';
  }
  try { if (UI.closeTop) { for (var g = 0; g < 8 && UI.closeTop(); g++) {} } } catch (e) {}
  if (UI.closeAmount) UI.closeAmount();
  if (!(Engine.walletBalance(S(), id) < 0)) { UI.openCard({ kind: 'wallet', id: id }); return 'card'; }
  topUpCard(id);
  return 'pay';
}
function checkTap() {
  var p = plugin();
  if (!p || typeof p.takeTap !== 'function') return Promise.resolve(null);
  return call(p, 'takeTap').then(function (r) {
    if (r && r.debtId) return openFromReminder(r.debtId, r.due || '');
    return null;
  }, function () { return null; });
}

// перерисовка главного (операция, смена дня) - баннер и план напоминаний догоняют
var prevAfterRender = UI.afterRender;
UI.afterRender = function () {
  if (prevAfterRender) prevAfterRender();
  // план напоминаний сверяется с отданным телефону (lastPlan): плагин зовётся, только если
  // что-то поменялось (платёж, правка, восстановление из файла, новый день)
  setTimeout(function () { try { checkWarn(); syncReminders(); } catch (e) {} }, 0);
};
document.addEventListener('visibilitychange', function () {
  // вернулись (может быть, из настроек телефона): разрешение на уведомления - заново
  if (document.visibilityState !== 'hidden') {
    setTimeout(function () { try { checkTap(); } catch (e) {} }, 300);   // тап по напоминанию - без задержки на глаз
    setTimeout(function () { try { checkWarn(); syncReminders(true); } catch (e) {} }, 1500);
  }
});
// Тап по уведомлению, когда приложение уже открыто: оболочка (MainActivity.onNewIntent) сразу
// шлёт событие homyakReminderTap на document - забираем тап немедленно, visibilitychange при
// открытом приложении не приходит (ревью 12.10 №8). Повторный takeTap вернёт пусто - не страшно.
document.addEventListener('homyakReminderTap', function () { try { checkTap(); } catch (e) {} });
// на запуске: план на 12 месяцев вперёд обновляется (вдруг приложение не открывали месяцами)
setTimeout(function () { try { syncReminders(true); checkWarn(); } catch (e) {} }, 2000);
setTimeout(function () { try { checkTap(); } catch (e) {} }, 800);

UI.addToStrip = addToStrip;
UI.addDebt = addDebt;
UI.editDebt = editDebt;
UI.renderDebtCard = renderDebtCard;
UI.offerArchive = offerArchive;
UI.debtsListHtml = debtsListHtml;
UI.bindDebtsList = bindDebtsList;
UI.debtsChanged = changed;
UI.creditForm = creditForm;
window.Debts = {
  addToStrip: addToStrip, addDebt: addDebt, editDebt: editDebt, pickType: pickType, baseDlg: baseDlg,
  archive: archive, restore: restoreDebt, payFlow: payFlow, deleteFlow: deleteDebtFlow, offerArchive: offerArchive,
  checkWarn: checkWarn, hideWarn: hideWarn, warnShown: warnShown, pendingWarn: pendingWarn, dismissWarn: dismissWarn,
  syncReminders: syncReminders, toggleRemind: toggleRemind, testReminder: testReminder, deniedDlg: deniedDlg,
  monthAcc: monthAcc,
  softDenied: softDenied, perm: function () { return perm; },
  openFromReminder: openFromReminder, checkTap: checkTap,
  creditForm: creditForm, topUpCard: topUpCard,
  _plugin: function (p) { pluginOverride = p || null; lastPlan = null; perm = null; }
};

// QA: два долга для снимков (только демо): ?demo&debts или Debts.qaSeed() из tools/qa-shots.js
function qaSeed() {
  if (!UI.DEMO || (S().debts || []).length) return false;
  try {
    var t0 = Engine.today();
    var mo = Engine.addMonths(t0.slice(0, 7), -3) + '-10';
    var d1 = Engine.addDebt(S(), { type: 'owe', name: 'Ипотека', amount: 2400000, pay: 32000, day: 15, rate: 11.5, date: mo, now: 0 });
    Engine.addDebt(S(), { type: 'owed', name: 'Саша', amount: 15000, due: Engine.addMonths(t0.slice(0, 7), 1) + '-05', date: mo, now: 0 });
    var w = Engine.debtsActive(S()) && UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    if (w) {
      Engine.payDebt(S(), { debtId: d1.id, walletId: w.id, amount: 32000, date: Engine.addMonths(t0.slice(0, 7), -2) + '-14' });
      Engine.payDebt(S(), { debtId: d1.id, walletId: w.id, amount: 32000, date: Engine.addMonths(t0.slice(0, 7), -1) + '-15' });
    }
    UI.save(); UI.renderInstant();
    return true;
  } catch (e) { return false; }
}
window.Debts.qaSeed = qaSeed;
// QA: кредитка в минусе, день платежа 5-го (только демо)
function qaCredit() {
  if (!UI.DEMO) return null;
  var w = S().wallets.filter(function (x) { return x.credit === true; })[0];
  if (w) return w.id;
  // в демо уже есть кошелёк «Кредитка» в минусе - отмечаем его; нет - заводим
  w = S().wallets.filter(function (x) { return x.name === 'Кредитка' && !x.hidden; })[0];
  if (!w) { w = Engine.addWallet(S(), { name: 'Кредитка', icon: 'card', color: 'red', base: -45000 }); w.baseTs = 0; }
  Engine.setWalletCredit(S(), w.id, { credit: true, payDay: 5, remind: true });
  UI.save(); UI.renderInstant();
  return w.id;
}
window.Debts.qaCredit = qaCredit;
if (UI.DEMO && location.search.indexOf('debts') >= 0) qaSeed();

})();
