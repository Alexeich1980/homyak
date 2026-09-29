/* sheet.js — нижний лист «карточка кошелька/категории»: шапка, сумма, действия,
   список операций со свайпами (влево — удалить, вправо — исправить) и подсказка хомяка.
   Работает поверх window.UI (ui.js), грузится сразу после него. */
(function () {
'use strict';

var UI = window.UI;
function $(id) { return document.getElementById(id); }
function esc(s) { return UI.esc(s); }
function fmt(n) { return UI.fmt(n); }
function money(v) { return UI.money(v); }

var cardOf = null;          // что открыто: {kind:'wallet'|'inc'|'exp', id}
var cardHideTimer = null;

// «открыта» — по состоянию, а не по DOM: во время анимации ухода лист ещё виден,
// но карточка уже закрыта и не должна ничего блокировать
function cardOpen() { return !!cardOf; }
function txDate(d) { return String(d).slice(8, 10) + '.' + String(d).slice(5, 7); }

// индекс категории в её списке — от него берётся тинт плитки и иконки в строке.
// Список берём с месяцем: карточку выведенной категории с фактом тоже надо открывать.
function catList(kind) { return Engine.listCategories(UI.S, kind, { ymStr: UI.curYM() }); }
function catIndex(kind, id) {
  var list = catList(kind);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return 0;
}
function catOf(kind, id) {
  var list = catList(kind);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function catIcon(id) {
  var k = Engine.catKind(UI.S, id);
  var c = k ? catOf(k, id) : null;
  return (c && c.icon) || Icons.guessKind(UI.catName(id) || '', k || 'cat');
}
function walletIcon(id) {
  var w = Engine.findWallet(UI.S, id);
  return Icons.walletKey(w && w.icon);
}

// ---------- одна строка списка ----------
// ctx: {kind:'wallet'|'cat', id, tint} — от чьего лица смотрим
function txRowHtml(t, ctx) {
  var name, cls, amt, icon, tint;
  if (t.kind === 'transfer') {
    name = UI.walletName(t.walletId) + ' → ' + UI.walletName(t.toWalletId);
    cls = 'zero';
    amt = (ctx.kind === 'wallet' ? (t.toWalletId === ctx.id ? '+' : '−') : '') + money(t.amount);
    icon = walletIcon(t.walletId); tint = ctx.tint;
  } else if (t.kind === 'inc') {
    name = ctx.kind === 'wallet' ? UI.catName(t.catId) : UI.walletName(t.walletId);
    cls = 'pos'; amt = '+' + money(t.amount);
    icon = ctx.kind === 'wallet' ? catIcon(t.catId) : walletIcon(t.walletId);
    tint = ctx.kind === 'wallet' ? catIndex('inc', t.catId) % 6 : ctx.tint;
  } else {
    name = ctx.kind === 'wallet' ? UI.catName(t.catId) : UI.walletName(t.walletId);
    cls = 'neg'; amt = '−' + money(t.amount);
    icon = ctx.kind === 'wallet' ? catIcon(t.catId) : walletIcon(t.walletId);
    tint = ctx.kind === 'wallet' ? catIndex('exp', t.catId) % 6 : ctx.tint;
  }
  // В строке операции иконка бывает двух родов: из карточки кошелька смотрим на
  // категорию (цветная иллюстрация), из карточки категории - на кошелёк (линейный глиф).
  var isCat = t.kind !== 'transfer' && ctx.kind === 'wallet';
  var glyph = isCat ? Icons.img(icon, t.kind, 22, name) : Icons.svg(icon, 18);
  return '<div class="txrow" data-id="' + esc(t.id) + '">' +
    '<div class="txact edit" aria-hidden="true">Править</div>' +
    '<div class="txact del" aria-hidden="true">Удалить</div>' +
    '<div class="txfront">' +
      '<div class="txico t' + tint + '" aria-hidden="true">' + glyph + '</div>' +
      '<div class="txd">' + txDate(t.date) + '</div>' +
      '<div class="txmid">' +
        '<div class="txn">' + esc(name || '—') + '</div>' +
        '<div class="txmeta">' + esc(txDate(t.date)) + '</div>' +
      '</div>' +
      '<div class="txa ' + cls + '">' + amt + ' ₽</div>' +
    '</div>' +
  '</div>';
}

// ---------- отрисовка листа ----------
function renderCard() {
  if (!cardOf) return false;
  var ico = $('cardIco'), list, ctx;

  if (cardOf.kind === 'wallet') {
    var w = Engine.findWallet(UI.S, cardOf.id);
    if (!w) { closeCard(); return false; }
    ico.className = 'sh-ico wallet ' + UI.wcolor(w);
    ico.innerHTML = Icons.svg(Icons.walletKey(w.icon), 26);
    $('cardTitle').textContent = w.name;
    var bal = Engine.walletBalance(UI.S, cardOf.id);
    var amt = $('cardAmt');
    amt.textContent = money(bal) + ' ₽';
    amt.classList.toggle('neg', bal < 0);
    // «Скрыть» уехало внутрь формы кошелька (там же, где «Удалить»), а на его месте
    // «Настроить» - та же форма, что открывается из списка «Настроить кошельки».
    // «Перевести» - явный путь к переводу для тех, кто не носит плитки пальцем.
    $('cardActs').innerHTML =
      '<button class="btn primary w100" type="button" id="cardBase">Изменить баланс</button>' +
      '<button class="btn ghost" type="button" id="cardTransfer">Перевести</button>' +
      '<button class="btn ghost" type="button" id="cardSetup">Настроить</button>';
    // операции кошелька за ВЫБРАННЫЙ месяц (как у категории), а не за всю историю:
    // счётчик «N операций» под именем и список показывают один и тот же месяц
    list = Engine.txOfWallet(UI.S, cardOf.id, UI.curYM());
    ctx = { kind: 'wallet', id: cardOf.id, tint: 0 };
  } else {
    var c = catOf(cardOf.kind, cardOf.id);
    if (!c) { closeCard(); return false; }
    var ymStr = UI.curYM();
    var fact = Engine.catFact(UI.S, cardOf.id, ymStr), lim = Engine.catLimit(UI.S, cardOf.id, ymStr), plan = Engine.planOr0(UI.S, cardOf.id, ymStr);
    var left = plan - fact;
    var L = UI.levelOf(cardOf.kind, fact, lim);
    var idx = catIndex(cardOf.kind, cardOf.id) % 6;
    var curIcon = c.icon || Icons.guessKind(c.name, cardOf.kind);
    ico.className = 'sh-ico cat t' + idx + ' lvl-' + L.lvl;
    ico.innerHTML = Icons.img(curIcon, cardOf.kind, 30, c.name);
    $('cardTitle').textContent = c.name;
    $('cardAmt').textContent = money(fact) + ' ₽';
    $('cardAmt').classList.remove('neg');
    // Иконку источника дохода и категории меняем прямо здесь: до 0.2.2 это жило только
    // в режиме правки (долгий тап), и хозяин его не находил.
    var isInc = cardOf.kind === 'inc';
    // Статус-строка. Расход: «лимит X · осталось Y» (Y<0 красным - перерасход).
    // Доход: «план X · осталось до плана Y» / «перевыполнен на Z» (позитив, без красного).
    var statusHtml;
    if (lim == null) statusHtml = isInc ? 'Плана на месяц нет' : 'Лимита на месяц нет';
    else if (isInc) statusHtml = 'план <b>' + fmt(plan) + ' ₽</b> · ' + (
      left > 0 ? 'осталось до плана <b>' + fmt(left) + ' ₽</b>'
      : left < 0 ? 'перевыполнен на <b>' + fmt(-left) + ' ₽</b>'
      : '<b>план выполнен</b>');
    else statusHtml = 'лимит <b>' + fmt(plan) + ' ₽</b> · осталось <b class="' + (left < 0 ? 'txa neg' : '') + '">' + fmt(left) + ' ₽</b>';
    $('cardActs').innerHTML = '<div class="sh-plan">' + statusHtml + '</div>' +
      // Число-цель правится прямо тут - отдельной строкой-действием. У расхода это «Лимит»,
      // у источника дохода - «План». Переименование и архив остаются в полном редакторе.
      '<div class="sh-icorow sh-limrow"><span class="sh-icol">' + (isInc ? 'План на месяц' : 'Лимит на месяц') + '</span>' +
        '<span class="sh-limval" id="cardLimVal">' + (lim != null ? fmt(lim) + ' ₽' : 'не задан') + '</span>' +
        '<button class="btn ghost icchg" type="button" id="cardLimBtn">' + (lim != null ? 'Изменить' : 'Задать') + '</button>' +
      '</div>' +
      '<div class="sh-icorow"><span class="sh-icol">Иконка</span>' +
        '<span class="icprev" id="cardIcoPrev" aria-hidden="true">' + Icons.img(curIcon, cardOf.kind, 24, c.name) + '</span>' +
        '<button class="btn ghost icchg" type="button" id="cardIcoBtn">Изменить</button>' +
      '</div>';
    list = Engine.txOfCat(UI.S, cardOf.id, ymStr);
    ctx = { kind: 'cat', id: cardOf.id, tint: idx };
  }

  $('cardSub').textContent = list.length
    ? list.length + ' ' + Engine.plural(list.length, 'операция', 'операции', 'операций')
    : 'операций пока нет';
  $('cardList').innerHTML = list.length
    ? list.map(function (t) { return txRowHtml(t, ctx); }).join('')
    : '<div class="empty">Операций пока нет</div>';

  // Подсказка внизу листа — про то, что можно сделать ЗДЕСЬ: свайп по строке операции
  // (влево — удалить, вправо — править). Она уместна и у кошелька, и у категории: обе
  // карточки показывают один и тот же свайпаемый список. Про «подними и неси» подсказка
  // живёт на главном экране, где перенос и происходит, — сюда её больше не суём.
  // Показываем только когда подсказки включены, эта не погашена и операции есть.
  var hintEl = $('cardHint');
  var swipeShown = UI.hintShouldShow('cardSwipe') && list.length > 0;
  if (hintEl) {
    var ht = hintEl.querySelector('.sh-ht');
    if (ht) ht.textContent = 'Потяни строку влево - удалить, вправо - править.';
    hintEl.hidden = !swipeShown;
  }
  // Ситуативная подсказка кошелька про «Изменить баланс»: на одном листе одновременно
  // максимум одна подсказка, приоритет у cardSwipe (пока есть операции и она не погашена).
  // Только у кошелька — у категории баланса нет. Стоит НАД списком (сразу под кнопками):
  // внизу листа на 375×812 её хвост уходил за экран.
  var adjEl = $('cardAdjustHint');
  if (adjEl) adjEl.hidden = !(cardOf.kind === 'wallet' && !swipeShown && UI.hintShouldShow('adjust'));

  if (cardOf.kind === 'wallet') {
    $('cardBase').addEventListener('click', walletBaseDlg);
    $('cardTransfer').addEventListener('click', function () { openTransfer(cardOf.id); });
    $('cardSetup').addEventListener('click', function () {
      var id = cardOf.id;
      closeCard();
      if (UI.editWallet) UI.editWallet(id);
    });
  } else {
    $('cardIcoBtn').addEventListener('click', catIconDlg);
    if ($('cardLimBtn')) $('cardLimBtn').addEventListener('click', cardLimDlg);
  }
  return true;
}

// правка числа-цели прямо из карточки категории: тот же путь, что «Изменить баланс»
// у кошелька (dlgPrompt в гамме приложения), сохранение - в текущий открытый месяц.
// Пусто = снять цель. Валидация как в editCat (неотрицательное число). Расход - «Лимит»
// (краснеет), доход - «План» (позитивный, зеленеет). Хранилище общее (Engine.setLimit).
function cardLimDlg() {
  if (!cardOf || cardOf.kind === 'wallet') return;
  var isInc = cardOf.kind === 'inc';
  var id = cardOf.id, ym = UI.curYM();
  var cur = Engine.catLimit(UI.S, id, ym);
  UI.dlgPrompt({
    title: isInc ? 'План на месяц' : 'Лимит на месяц',
    label: isInc ? 'Сколько в месяц, ₽ (пусто - без плана)' : 'Сколько в месяц, ₽ (пусто - без лимита)',
    type: 'text', inputmode: 'decimal', money: true,
    value: (cur == null ? '' : Engine.fmt(cur)),
    onOk: function (v) {
      var raw = String(v).trim();
      var l = raw === '' ? null : Engine.parseNum(raw);
      if (l !== null && (!isFinite(l) || l < 0)) { UI.dlgAlert((isInc ? 'План' : 'Лимит') + ' - неотрицательное число.', 'Не сохранилось'); return false; }
      Engine.setLimit(UI.S, ym, id, l);
      UI.save(); renderCard(); UI.render(); UI.haptic('light');
      UI.toast('Сохранено');
    }
  });
}

// ---------- лист «Куда перевести» ----------
// Перенос кошелька на кошелёк пальцем остался, но он не единственный: раньше о нём
// вообще нельзя было догадаться. Тут те же плитки кошельков, тап = экран суммы «A › B».
var trFrom = null;

function openTransfer(fromId) {
  var from = Engine.findWallet(UI.S, fromId);
  if (!from) return;
  trFrom = fromId;
  var list = UI.S.wallets
    .filter(function (w) { return !w.hidden && w.id !== fromId; })
    .sort(function (a, b) { return a.order - b.order; });
  $('trFrom').textContent = 'из «' + from.name + '»';
  $('trGrid').innerHTML = list.length
    ? list.map(function (w) { return UI.walletTileHtml(w); }).join('')
    : '<div class="empty">Других кошельков нет - заведи второй в меню</div>';
  $('trBg').hidden = false;
  $('trSheet').hidden = false;
  UI.haptic('light');
}

function closeTransfer() {
  $('trSheet').hidden = true;
  $('trBg').hidden = true;
  $('trGrid').innerHTML = '';
  trFrom = null;
}
function transferOpen() { return !$('trSheet').hidden; }

$('trGrid').addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('.wtile') : null;
  if (!b || !trFrom) return;
  var op = UI.resolveDrop('wallet', trFrom, 'wallet', b.getAttribute('data-id'));
  closeTransfer();
  closeCard();
  if (op) { UI.haptic('drop'); UI.openAmount(op); }
});
$('trClose').addEventListener('click', closeTransfer);
UI.bindBackdropClose($('trBg'), closeTransfer);
UI.bindSwipeClose($('trHead'), 'down', function () { if (transferOpen()) closeTransfer(); });
UI.bindSwipeClose($('trSheet').querySelector('.dlg-grip'), 'down', function () { if (transferOpen()) closeTransfer(); });

function openCard(o) {
  if (!o || !o.id) return;
  if (o.kind !== 'wallet' && o.kind !== 'inc' && o.kind !== 'exp') return;
  clearTimeout(cardHideTimer); cardHideTimer = null;
  cardOf = { kind: o.kind, id: o.id };
  if (!renderCard()) return;
  $('cardBg').hidden = false;
  var el = $('card');
  el.hidden = false;
  void el.offsetHeight;                       // reflow: старт анимации от translateY(100%)
  el.classList.add('open');
  UI.haptic('light');
}

function closeCard() {
  cardOf = null; swEnd();
  $('cardBg').hidden = true;
  var el = $('card');
  if (el.hidden) return;
  el.classList.remove('open');
  clearTimeout(cardHideTimer);
  cardHideTimer = setTimeout(function () { el.hidden = true; $('cardList').innerHTML = ''; }, 260);
}

// смена иконки категории/источника прямо из карточки: тот же лист, что и в форме кошелька
function catIconDlg() {
  if (!cardOf || cardOf.kind === 'wallet') return;
  var id = cardOf.id, kind = cardOf.kind;
  var c = catOf(kind, id);
  if (!c || !UI.openIconSheet) return;
  UI.openIconSheet({
    title: kind === 'inc' ? 'Иконка источника' : 'Иконка категории',
    kind: kind, cur: c.icon || Icons.guessKind(c.name, kind),
    onPick: function (n) {
      UI.S.icons[id] = n;
      UI.save(); renderCard(); UI.render(); UI.haptic('light');
      UI.toast('Иконка обновлена');
    }
  });
}

// ---------- кнопки кошелька ----------
function walletBaseDlg() {
  if (!cardOf || cardOf.kind !== 'wallet') return;
  var id = cardOf.id;
  UI.dlgPrompt({
    title: 'Изменить баланс', label: 'Сколько на самом деле, ₽',
    type: 'text', inputmode: 'decimal', money: true,
    value: Engine.fmt(Engine.walletBalance(UI.S, id)),
    onOk: function (v) {
      var n = Engine.parseNum(v);
      if (!isFinite(n)) { UI.dlgAlert('Нужно число.', 'Не сохранилось'); return false; }
      Engine.setWalletBase(UI.S, id, n);
      UI.save(); renderCard(); UI.render(); UI.haptic('light');
      UI.toast('Баланс обновлён');
    }
  });
}

// Отдельного «Скрыть» тут больше нет: скрытие и удаление живут в одной форме кошелька,
// которую открывает «Настроить» - и из карточки, и из списка «Настроить кошельки».

// ---------- свайпы по строке операции ----------
var SW_T = 80;      // порог срабатывания, px
var sw = null;

function swEnd() {
  if (!sw) return;
  var s = sw; sw = null;
  s.row.classList.remove('to-del', 'to-edit');
  try { s.row.releasePointerCapture(s.pid); } catch (e) {}
  s.front.style.transition = '';
  s.front.style.transform = '';
}

// Одна связка свайпов на любой список строк операций: карточка кошелька и лента
// в «Аналитике» ведут себя одинаково, потому что код у них буквально один.
// o.onTap — что делать по короткому касанию без сдвига (в ленте это правка).
function bindTxSwipe(box, o) {
  if (!box) return;
  o = o || {};

  box.addEventListener('pointerdown', function (e) {
    if (sw) return;
    if (e.button || UI.dlgOpen()) return;
    var row = e.target.closest ? e.target.closest('.txrow') : null;
    if (!row) return;
    sw = { row: row, front: row.querySelector('.txfront'), id: row.getAttribute('data-id'),
      startX: e.clientX, startY: e.clientY, active: false, pid: e.pointerId };
  });

  box.addEventListener('pointermove', function (e) {
    if (!sw || e.pointerId !== sw.pid) return;
    var dx = e.clientX - sw.startX, dy = e.clientY - sw.startY;
    if (!sw.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) { sw = null; return; }   // вертикаль = скролл списка
      sw.active = true;
      sw.front.style.transition = 'none';
      try { sw.row.setPointerCapture(e.pointerId); } catch (x) {}
    }
    sw.row.classList.toggle('to-del', dx <= -SW_T);
    sw.row.classList.toggle('to-edit', dx >= SW_T);
    sw.front.style.transform = 'translateX(' + dx + 'px)';
  }, { passive: true });

  box.addEventListener('pointerup', function (e) {
    if (!sw || e.pointerId !== sw.pid) return;
    var dx = e.clientX - sw.startX, dy = e.clientY - sw.startY;
    var act = sw.active ? (dx <= -SW_T ? 'del' : (dx >= SW_T ? 'edit' : null)) : null;
    var tap = !sw.active && Math.abs(dx) < 8 && Math.abs(dy) < 8;
    var id = sw.id;
    swEnd();
    if (act === 'del') { UI.haptic('medium'); confirmDelTx(id); }
    else if (act === 'edit') { UI.haptic('light'); editTx(id); }
    else if (tap && o.onTap) o.onTap(id);
  });
  box.addEventListener('pointercancel', function (e) {
    if (!sw || e.pointerId !== sw.pid) return;
    swEnd();
  });
}

bindTxSwipe($('cardList'));

// подсказку под списком гасит свайп в любую сторону — тогда она больше не всплывает
UI.bindHintSwipe($('cardHint'), 'cardSwipe', function () {
  var e = $('cardHint'); if (e) e.hidden = true;
});
// подсказка про «Изменить баланс» — тот же свайп, привязка один раз (узел стабилен)
UI.bindHintSwipe($('cardAdjustHint'), 'adjust', function () {
  var e = $('cardAdjustHint'); if (e) e.hidden = true;
});

// ---------- удаление и правка операции ----------
function txSummary(t) {
  var sign = t.kind === 'inc' ? '+' : (t.kind === 'exp' ? '−' : '');
  var who = t.kind === 'transfer'
    ? UI.walletName(t.walletId) + ' → ' + UI.walletName(t.toWalletId)
    : UI.catName(t.catId) + ' · ' + UI.walletName(t.walletId);
  return sign + money(t.amount) + ' ₽ · ' + who + ' · ' + txDate(t.date);
}

function confirmDelTx(id) {
  var t = Engine.findTx(UI.S, id);
  if (!t) return;
  UI.dlgConfirm({
    title: 'Удалить операцию?', text: txSummary(t), danger: true, okLabel: 'Удалить',
    onOk: function () {
      Engine.deleteTx(UI.S, id);
      UI.save(); renderCard(); UI.render(); UI.haptic('medium');
      UI.toast('Операция удалена');
    }
  });
}

// Операция без кошелька бывает (walletId: null в старом бэкапе или у удалённого кошелька).
// Без пустого варианта браузер молча выбирал первый кошелёк, и сохранение вешало
// операцию на него, сдвинув его баланс.
function walletOptions(selId) {
  var known = UI.S.wallets.some(function (w) { return w.id === selId; });
  var head = known ? '' : '<option value="" selected>- не выбран -</option>';
  return head + UI.S.wallets.filter(function (w) { return !w.hidden || w.id === selId; })
    .sort(function (a, b) { return a.order - b.order; })
    .map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (w.id === selId ? ' selected' : '') + '>' + esc(w.name) + '</option>';
    }).join('');
}

function editTx(id) {
  var t = Engine.findTx(UI.S, id);
  if (!t) { UI.dlgAlert('Операция не найдена.'); return; }
  var isTr = t.kind === 'transfer';
  var body =
    '<div class="ef-err" id="etErr" hidden></div>' +
    '<div class="ef"><span class="lbl">Сумма, ₽</span>' +
      '<input class="inp" id="etAmount" type="text" inputmode="decimal" value="' + esc(Engine.fmt(t.amount)) + '"></div>' +
    '<div class="ef"><span class="lbl">Дата</span>' +
      '<input class="inp" id="etDate" type="date" max="' + esc(Engine.today()) + '" value="' + esc(t.date) + '"></div>';

  if (!isTr) {
    var live = Engine.listCategories(UI.S, t.kind, { ymStr: UI.curYM() }), has = false;
    var opts = live.map(function (c) {
      if (c.id === t.catId) has = true;
      return '<option value="' + esc(c.id) + '"' + (c.id === t.catId ? ' selected' : '') +
        '>' + esc(c.name) + (c.archived ? ' (в архиве)' : '') + '</option>';
    }).join('');
    if (!has && t.catId) {
      // Категория операции не в списке (другой месяц или её уже нет): держим её первой
      // строкой под своим именем, а если её не осталось - так и говорим.
      opts = '<option value="' + esc(t.catId) + '" selected>' +
        esc(UI.catName(t.catId) || 'Категории больше нет') + '</option>' + opts;
    }
    body += '<div class="ef"><span class="lbl">' + (t.kind === 'inc' ? 'Источник дохода' : 'Категория') + '</span>' +
      '<select class="inp" id="etCat">' + opts + '</select></div>';
  }
  body += '<div class="ef"><span class="lbl">' + (isTr ? 'Откуда' : 'Кошелёк') + '</span>' +
    '<select class="inp" id="etWallet">' + walletOptions(t.walletId) + '</select></div>';
  if (isTr) {
    body += '<div class="ef"><span class="lbl">Куда</span>' +
      '<select class="inp" id="etTo">' + walletOptions(t.toWalletId) + '</select></div>';
  }

  UI.openDlg({
    title: 'Операция', body: body,
    buttons: [
      { label: 'Отмена', cls: 'ghost' },
      { label: 'Повторить', cls: 'ghost', onClick: function () { repeatTx(id); } },
      { label: 'Сохранить', cls: 'primary', onClick: function () { return saveEditTx(id); } }
    ],
    onOpen: function () { UI.moneyInput($('etAmount')); UI.noFutureDate($('etDate')); }
  });
}

// «Повторить»: открыть экран суммы, заполненный этой же операцией, но с датой
// «сегодня». Запись создаёт НОВУЮ операцию (openAmount → amSave), оригинал не трогаем.
// Работает для расхода, дохода и перевода (перевод подставляет оба кошелька).
function repeatTx(id) {
  var t = Engine.findTx(UI.S, id);
  if (!t) { UI.dlgAlert('Операция не найдена.'); return; }
  UI.haptic('light');
  UI.openAmount({
    kind: t.kind, catId: t.catId || null,
    walletId: t.walletId || null, toWalletId: t.toWalletId || null
  }, t.amount);
}

// ошибка правки — строкой внутри той же формы, не поверх неё: диалог правки и dlgAlert
// используют один и тот же DOM, и openDlg() из dlgAlert стёр бы уже введённые значения
function showEtErr(msg) {
  var el = $('etErr');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function saveEditTx(id) {
  var t = Engine.findTx(UI.S, id);
  if (!t) { UI.dlgAlert('Операция не найдена.'); return false; }
  var v = Engine.parseNum($('etAmount').value);
  if (!(v > 0)) { showEtErr('Сумма должна быть больше нуля'); return false; }
  if (v > Engine.MAX_AMOUNT) { showEtErr('Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + ' ₽'); return false; }
  var wid = $('etWallet').value;
  if (!wid) { showEtErr('Выбери кошелёк'); return false; }
  var dt = $('etDate').value || t.date;
  if (!Engine.isDate(dt)) { showEtErr('Проверь дату'); return false; }
  if (Engine.futureDate(dt)) { showEtErr(UI.FUTURE_MSG); return false; }
  var patch = {
    amount: v,
    date: dt,
    walletId: wid
  };
  if ($('etCat')) patch.catId = $('etCat').value;
  if ($('etTo')) {
    if ($('etTo').value === patch.walletId) { showEtErr('Выбери разные кошельки.'); return false; }
    patch.toWalletId = $('etTo').value;
  }
  try {
    Engine.updateTx(UI.S, id, patch);
  } catch (e) {
    var m = e && e.message;
    showEtErr(m === 'amount-max' ? 'Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + ' ₽'
      : m === 'date-future' ? UI.FUTURE_MSG
      : m === 'date' ? 'Проверь дату'
      : 'Сумма должна быть больше нуля');
    return false;
  }
  UI.save(); renderCard(); UI.render(); UI.haptic('light');
  // правка суммы может увести категорию за план — звук выбирается по уровню ПОСЛЕ
  // правки, тем же правилом, что и при записи операции
  UI.soundTx(t.kind, patch.catId || t.catId, Engine.ym(dt));
}

// ---------- связки ----------
$('btnCardClose').addEventListener('click', closeCard);
UI.bindBackdropClose($('cardBg'), closeCard);
// смахнуть вниз по ручке или шапке = закрыть; список операций под ними прокручивается
UI.bindSwipeClose($('card').querySelector('.sh-grip'), 'down', function () { if (cardOpen()) closeCard(); });
UI.bindSwipeClose($('card').querySelector('.sh-head'), 'down', function () { if (cardOpen()) closeCard(); });

UI.openCard = openCard;
UI.closeCard = closeCard;
UI.cardOpen = cardOpen;
UI.openTransfer = openTransfer;
UI.closeTransfer = closeTransfer;
UI.transferOpen = transferOpen;
UI.renderCard = renderCard;
UI.editTx = editTx;
UI.confirmDelTx = confirmDelTx;
UI.bindTxSwipe = bindTxSwipe;

})();
