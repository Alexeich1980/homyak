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
  // 1.0.4: операция с долгом в карточке кошелька - имя долга, знак по движению денег
  if (t.kind === 'debt') {
    name = (UI.debtName(t.debtId) || 'Долг удалён') + ' · ' + UI.debtOpLabel(t.op === 'take' ? 'debttake' : 'debtpay', t.debtId).toLowerCase();
    amt = (t.op === 'take' ? '+' : '−') + money(t.amount);
    // платёж со ставкой: весь платёж одной суммой, разбивка - строкой ниже (как в карточке долга).
    // В тёмной теме дата - колонкой .txd: в строке остаётся только разбивка (.tx-mdate прячется)
    var pi = Engine.payInt(t), meta = '<div class="txmeta">' + esc(txDate(t.date)) + '</div>';
    if (pi > 0) {
      meta = '<div class="txmeta db-meta tx-split"><span class="tx-mdate">' + esc(txDate(t.date)) + ' · </span>' +
        esc('в счёт долга ' + money(Engine.debtPart(t)) + '\u00a0₽, проценты ' + money(pi) + '\u00a0₽') + '</div>';
    }
    return '<div class="txrow" data-id="' + esc(t.id) + '">' +
      '<div class="txact edit" aria-hidden="true">Править</div>' +
      '<div class="txact del" aria-hidden="true">Удалить</div>' +
      '<div class="txfront">' +
        '<div class="txico dbt" aria-hidden="true">' + UI.DEBT_GLYPH + '</div>' +
        '<div class="txd">' + txDate(t.date) + '</div>' +
        '<div class="txmid">' +
          '<div class="txn">' + esc(name) + '</div>' +
          meta +
        '</div>' +
        '<div class="txa zero">' + amt + '\u00a0₽</div>' +
      '</div>' +
    '</div>';
  }
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
      '<div class="txa ' + cls + '">' + amt + '\u00a0₽</div>' +
    '</div>' +
  '</div>';
}

// ---------- отрисовка листа ----------
// Подсказку про свайп карточка долга ставит внутрь списка (над «Историей»); перед любой
// перерисовкой узел возвращается на своё место под списком - иначе innerHTML списка его съел бы.
function homeCardHint() {
  var h = $('cardHint'), l = $('cardList');
  if (!h || !l || h.parentNode === l.parentNode) return;
  h.classList.remove('sh-hint-in');
  l.parentNode.insertBefore(h, l.nextSibling);
}

function renderCard() {
  if (!cardOf) return false;
  homeCardHint();
  var ico = $('cardIco'), list, ctx;

  // 1.0.4: карточка долга целиком рисуется в debts.js (поля того же листа)
  if (cardOf.kind === 'debt') {
    if (!UI.renderDebtCard || !UI.renderDebtCard(cardOf.id)) { closeCard(); return false; }
    return true;
  }

  if (cardOf.kind === 'wallet') {
    var w = Engine.findWallet(UI.S, cardOf.id);
    if (!w) { closeCard(); return false; }
    ico.className = 'sh-ico wallet ' + UI.wcolor(w);
    ico.innerHTML = Icons.svg(Icons.walletKey(w.icon), 26);
    $('cardTitle').textContent = w.name;
    var bal = Engine.walletBalance(UI.S, cardOf.id);
    var amt = $('cardAmt');
    amt.textContent = money(bal) + '\u00a0₽';
    amt.classList.toggle('neg', bal < 0);
    // «Скрыть» уехало внутрь формы кошелька (там же, где «Удалить»), а на его месте
    // «Настроить» - та же форма, что открывается из списка «Настроить кошельки».
    // «Перевести» убран (Алексей 14.10): дубль «+» и перетаскивания кошелька на кошелёк.
    // Лист перевода остался - его открывает тап по напоминанию кредитки (перевод на карту).
    $('cardActs').innerHTML =
      '<button class="btn primary w100" type="button" id="cardBase">Изменить баланс</button>' +
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
    // остаток в копейках, как и порог заливки: 333,33+333,33+333,34 из 1000 - это ровно
    // план (жёлтый, «осталось 0»), а не «-0,0000000001» красным
    var left = (Math.round(plan * 100) - Math.round(fact * 100)) / 100;
    var L = UI.levelOf(cardOf.kind, fact, lim);
    var idx = catIndex(cardOf.kind, cardOf.id) % 6;
    var curIcon = c.icon || Icons.guessKind(c.name, cardOf.kind);
    ico.className = 'sh-ico cat t' + idx + ' lvl-' + L.lvl;
    ico.innerHTML = Icons.img(curIcon, cardOf.kind, 30, c.name);
    $('cardTitle').textContent = c.name;
    $('cardAmt').textContent = money(fact) + '\u00a0₽';
    $('cardAmt').classList.remove('neg');
    // Иконку источника дохода и категории меняем прямо здесь: до 0.2.2 это жило только
    // в режиме правки (долгий тап), и хозяин его не находил.
    var isInc = cardOf.kind === 'inc';
    // Статус-строка. Расход: «осталось Y» (Y<0 красным - перерасход). Доход: «осталось до
    // плана Y» / «перевыполнен на Z» (позитив, без красного). Сам лимит/план здесь не
    // повторяем (1.0.3, одно число - одно место): он стоит строкой ниже, рядом с «Изменить».
    // Плана/лимита нет - статус-строки нет (14.10): строка ниже «План/Лимит на месяц: не задан
    // [Задать]» говорит то же самое, второй раз не повторяем.
    var statusHtml = '';
    if (lim == null) statusHtml = '';
    else if (isInc) statusHtml =
      left > 0 ? 'осталось до плана <b>' + fmt(left) + '\u00a0₽</b>'
      : left < 0 ? 'перевыполнен на <b>' + fmt(-left) + '\u00a0₽</b>'
      : '<b>план выполнен</b>';
    else statusHtml = 'осталось <b class="' + (left < 0 ? 'txa neg' : '') + '">' + fmt(left) + '\u00a0₽</b>';
    $('cardActs').innerHTML = (statusHtml ? '<div class="sh-plan">' + statusHtml + '</div>' : '') +
      // Число-цель правится прямо тут - отдельной строкой-действием. У расхода это «Лимит»,
      // у источника дохода - «План». Переименование и архив остаются в полном редакторе.
      '<div class="sh-icorow sh-limrow"><span class="sh-icol">' + (isInc ? 'План на месяц' : 'Лимит на месяц') + '</span>' +
        '<span class="sh-limval" id="cardLimVal">' + (lim != null ? fmt(lim) + '\u00a0₽' : 'не задан') + '</span>' +
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
    if (ht) ht.textContent = 'Потяните строку влево - удалить, вправо - править.';
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
    : '<div class="empty">Других кошельков нет - заведите второй в меню</div>';
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
  if (o.kind !== 'wallet' && o.kind !== 'inc' && o.kind !== 'exp' && o.kind !== 'debt') return;
  clearTimeout(cardHideTimer); cardHideTimer = null;
  cardOf = { kind: o.kind, id: o.id };
  if (!renderCard()) return;
  $('cardBg').hidden = false;
  var el = $('card');
  el.hidden = false;
  // с начала списка: прокрутка прошлой карточки прятала свежую операцию за верх (телефон 13.10).
  // Только после hidden = false: у скрытого списка браузер прокрутку не сбрасывает.
  $('cardList').scrollTop = 0;
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
  // подсказку из списка долга - на место до очистки списка, иначе innerHTML её съедал насовсем
  cardHideTimer = setTimeout(function () { el.hidden = true; homeCardHint(); $('cardList').innerHTML = ''; }, 260);
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
  // 1.0.4: платёж по долгу - весь платёж одной записью (проценты внутри)
  if (t.debtId && t.kind === 'debt') {
    var op = t.op === 'take' ? 'debttake' : 'debtpay';
    return UI.debtOpLabel(op, t.debtId) + ' «' + (UI.debtName(t.debtId) || 'долг') + '» · ' + money(t.amount) + '\u00a0₽ · ' +
      UI.walletName(t.walletId) + ' · ' + txDate(t.date);
  }
  var sign = t.kind === 'inc' ? '+' : (t.kind === 'exp' ? '−' : '');
  var who = t.kind === 'transfer'
    ? UI.walletName(t.walletId) + ' → ' + UI.walletName(t.toWalletId)
    : UI.catName(t.catId) + ' · ' + UI.walletName(t.walletId);
  return sign + money(t.amount) + '\u00a0₽ · ' + who + ' · ' + txDate(t.date);
}

function confirmDelTx(id) {
  var t = Engine.findTx(UI.S, id);
  if (!t) return;
  UI.dlgConfirm({
    title: 'Удалить операцию?', text: txSummary(t), danger: true, okLabel: 'Удалить',
    onOk: function () {
      // Р3 ревью 15.10: операцию долга, после удаления которой остаток стал бы меньше нуля,
      // движок не удаляет ('over') - своё окно вместо тихой ошибки
      try { Engine.deleteTx(UI.S, id); } catch (e) {
        if (!(e && e.message === 'over')) throw e;
        // окно подтверждения закроется после onOk - отказ показываем следом, своим окном
        setTimeout(function () { UI.dlgAlert('Нельзя удалить: остаток долга станет меньше нуля. Сначала исправьте более поздние платежи по этому долгу.', 'Не удалилось'); }, 0);
        return;
      }
      UI.save(); renderCard(); UI.render(); UI.haptic('medium');
      UI.toast('Операция удалена');
      if (UI.debtsChanged) UI.debtsChanged();
    }
  });
}

// Операция без кошелька бывает (walletId: null в старом бэкапе или у удалённого кошелька).
// Без пустого варианта форма молча выбирала бы первый кошелёк, и сохранение вешало
// операцию на него, сдвинув его баланс. Список - своё окно (picker.js), не системное.
function walletItems(selId) {
  var known = UI.S.wallets.some(function (w) { return w.id === selId; });
  var head = known ? [] : [{ value: '', label: '- не выбран -' }];
  return head.concat(UI.S.wallets.filter(function (w) { return !w.hidden || w.id === selId; })
    .sort(function (a, b) { return a.order - b.order; })
    .map(function (w) { return { value: w.id, label: w.name }; }));
}
function walletField(id, selId, title) {
  var known = UI.S.wallets.some(function (w) { return w.id === selId; });
  return Picker.listField({ id: id, items: walletItems(selId), value: known ? selId : '', title: title });
}

// pre - введённое раньше (возврат из окна «Не сохранилось»): {amount, date, walletId}
function editTx(id, pre) {
  var t = Engine.findTx(UI.S, id);
  if (!t) { UI.dlgAlert('Операция не найдена.'); return; }
  var isTr = t.kind === 'transfer';
  // 1.0.4: платёж по долгу правится целиком (тело + проценты одной суммой, как в истории
  // долга), с той же проверкой переплаты, что у записи (Engine.editDebtTx)
  var isDebt = !!(t.debtId && t.kind === 'debt');
  var amt = t.amount;
  pre = pre || {};
  var body =
    '<div class="ef-err" id="etErr" hidden></div>' +
    '<div class="ef"><span class="lbl">Сумма, ₽</span>' +
      '<input class="inp" id="etAmount" type="text" inputmode="decimal" autocomplete="off" value="' + esc(pre.amount != null ? pre.amount : Engine.fmt(amt)) + '">' +
      '<div class="calc-ops" id="etOps">' +
        '<button class="chip" type="button" data-op="+" aria-label="Плюс">+</button>' +
        '<button class="chip" type="button" data-op="−" aria-label="Минус">−</button>' +
        '<button class="chip" type="button" data-op="×" aria-label="Умножить">×</button>' +
        '<button class="chip" type="button" data-op="÷" aria-label="Разделить">÷</button>' +
        '<button class="chip" type="button" data-op="=" aria-label="Посчитать">=</button>' +
      '</div><div class="calc-res" id="etRes" hidden></div></div>' +
    '<div class="ef"><span class="lbl">Дата</span>' +
      // Р14 ревью 15.10: у операции с долгом - не раньше дня его заведения (такую дату правка отвергает)
      Picker.dateField({ id: 'etDate', value: pre.date || t.date, max: Engine.today(),
        min: isDebt && Engine.findDebt(UI.S, t.debtId) ? Engine.findDebt(UI.S, t.debtId).createdDate : null, title: 'Дата операции' }) + '</div>';

  if (!isTr && !isDebt) {
    var live = Engine.listCategories(UI.S, t.kind, { ymStr: UI.curYM() }), has = false;
    var items = live.map(function (c) {
      if (c.id === t.catId) has = true;
      return { value: c.id, label: c.name + (c.archived ? ' (в архиве)' : '') };
    });
    if (!has && t.catId) {
      // Категория операции не в списке (другой месяц или её уже нет): держим её первой
      // строкой под своим именем, а если её не осталось - так и говорим.
      items.unshift({ value: t.catId, label: UI.catName(t.catId) || 'Категории больше нет' });
    }
    var catLbl = t.kind === 'inc' ? 'Источник дохода' : 'Категория';
    body += '<div class="ef"><span class="lbl">' + catLbl + '</span>' +
      Picker.listField({ id: 'etCat', items: items, value: t.catId || (items[0] && items[0].value), title: catLbl }) + '</div>';
  }
  // 1.0.4: у операции с долгом сам долг не меняется (только сумма, дата и кошелёк)
  if (isDebt) body += '<div class="ef"><span class="lbl">Долг</span><div class="inp ro">' + esc(UI.debtName(t.debtId) || '-') + '</div></div>';
  body += '<div class="ef"><span class="lbl">' + (isTr ? 'Откуда' : 'Кошелёк') + '</span>' +
    walletField('etWallet', pre.walletId || t.walletId, isTr ? 'Откуда' : 'Кошелёк') + '</div>';
  if (isTr) {
    body += '<div class="ef"><span class="lbl">Куда</span>' +
      walletField('etTo', t.toWalletId, 'Куда') + '</div>';
  }

  UI.openDlg({
    title: 'Операция', body: body,
    buttons: [
      { label: 'Отмена', cls: 'nav' },
      { label: 'Повторить', cls: 'ghost', onClick: function () { repeatTx(id); } },
      { label: 'Сохранить', cls: 'primary', onClick: function () { return saveEditTx(id); } }
    ],
    onOpen: function () { UI.calcInput($('etAmount'), $('etOps'), $('etRes')); UI.noFutureDate($('etDate')); }
  });
}

// «Повторить»: открыть экран суммы, заполненный этой же операцией, но с датой
// «сегодня». Запись создаёт НОВУЮ операцию (openAmount → amSave), оригинал не трогаем.
// Работает для расхода, дохода и перевода (перевод подставляет оба кошелька).
function repeatTx(id) {
  var t = Engine.findTx(UI.S, id);
  if (!t) { UI.dlgAlert('Операция не найдена.'); return; }
  UI.haptic('light');
  // 1.0.4: повтор платежа по долгу - тот же платёж целиком (проценты пересчитаются)
  if (t.debtId && t.kind === 'debt') {
    UI.openAmount({ kind: t.op === 'take' ? 'debttake' : 'debtpay', walletId: t.walletId || null, debtId: t.debtId }, t.amount);
    return;
  }
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
  var raw = $('etAmount').value;
  var v = Engine.calcAmount(raw);          // «1 200» и «1 200+300» - одним разбором
  if (Engine.hasCalcOp(raw) && !isFinite(v)) { showEtErr('Не получается посчитать сумму'); return false; }
  if (!(v > 0)) { showEtErr('Сумма должна быть больше нуля'); return false; }
  if (v > Engine.MAX_AMOUNT) { showEtErr('Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + '\u00a0₽'); return false; }
  var wid = $('etWallet').value;
  if (!wid) { showEtErr('Выберите кошелёк'); return false; }
  var dt = $('etDate').value || t.date;
  if (!Engine.isDate(dt)) { showEtErr('Проверьте дату'); return false; }
  if (Engine.futureDate(dt)) { showEtErr(UI.FUTURE_MSG); return false; }
  var patch = {
    amount: v,
    date: dt,
    walletId: wid
  };
  if (t.debtId && t.kind === 'debt') return saveEditDebt(t, patch, raw);
  if ($('etCat')) patch.catId = $('etCat').value;
  if ($('etTo')) {
    if ($('etTo').value === patch.walletId) { showEtErr('Выберите разные кошельки.'); return false; }
    patch.toWalletId = $('etTo').value;
  }
  try {
    Engine.updateTx(UI.S, id, patch);
  } catch (e) {
    var m = e && e.message;
    showEtErr(m === 'amount-max' ? 'Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + '\u00a0₽'
      : m === 'date-future' ? UI.FUTURE_MSG
      : m === 'date' ? 'Проверьте дату'
      : 'Сумма должна быть больше нуля');
    return false;
  }
  UI.save(); renderCard(); UI.render(); UI.haptic('light');
  if (UI.debtsChanged) UI.debtsChanged();
  // правка суммы может увести категорию за план — звук выбирается по уровню ПОСЛЕ
  // правки, тем же правилом, что и при записи операции
  UI.soundTx(t.kind, patch.catId || t.catId, Engine.ym(dt));
}

// 1.0.4: правка платежа по долгу - весь платёж (Engine.editDebtTx). Отказ (переплата, дата
// раньше заведения долга) - то же окно «Не сохранилось», что у записи платежа; «Понятно»
// возвращает в форму с введёнными значениями.
function saveEditDebt(t, patch, raw) {
  var id = t.id, d = Engine.findDebt(UI.S, t.debtId);
  try {
    Engine.editDebtTx(UI.S, id, patch);
  } catch (e) {
    var m = e && e.message;
    if ((m === 'over' || m === 'before-created') && UI.debtSaveErr) {
      var back = { amount: raw, date: patch.date, walletId: patch.walletId };
      UI.dlgAlert(UI.debtSaveErr(m, d, e.max), 'Не сохранилось', function () { editTx(id, back); });
      return false;   // окно отказа уже на месте формы - не закрывать его
    }
    showEtErr(m === 'amount-max' ? 'Максимум ' + Engine.fmt(Engine.MAX_AMOUNT) + '\u00a0₽'
      : m === 'date-future' ? UI.FUTURE_MSG
      : m === 'date' ? 'Проверьте дату'
      : 'Сумма должна быть больше нуля');
    return false;
  }
  UI.save(); renderCard(); UI.render(); UI.haptic('light');
  if (UI.debtsChanged) UI.debtsChanged();
  if (d && UI.offerArchive && !(Engine.debtBalance(UI.S, d.id) > 0)) UI.offerArchive(d.id);
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
