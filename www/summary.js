/* summary.js — экран «Аналитика»: сколько прошло по каждой категории за месяц.
   Полноэкранный слой поверх приложения, месяц свой (от главного экрана не зависит).
   Работает поверх window.UI (ui.js), грузится после edit.js. */
(function () {
'use strict';

var UI = window.UI;
function $(id) { return document.getElementById(id); }
function esc(s) { return UI.esc(s); }
function fmt(n) { return UI.fmt(n); }
function money(v) { return UI.money(v); }   // с копейками — суммы операций в ленте
function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

// Цвет-ярлык категории берётся из палитры темы (--hue-0..5) по её месту в списке:
// шкала долей, точки легенды и иконки строк красятся одним и тем же индексом.
var HUES = 6;
var MIN_SEG = 0.02;       // сегмент меньше 2% уходит в «Прочее»
var MAX_LEG = 6;          // сколько фишек показываем в легенде

function hue(i) { return 'var(--hue-' + (i % HUES) + ')'; }
function tint(i) { return 'var(--tint-' + (i % HUES) + ')'; }

// ---------- состояние экрана ----------
var VIEWS = { summary: 1, feed: 1, heat: 1, attn: 1, dyn: 1 };
var WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
var MM = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
var heatDay = null;       // выбранный день в тепловой карте (его операции показываем ниже)

var opened = false;
var ymStr = null;         // месяц сводки
var view = 'chooser';     // 'chooser' | 'summary' | 'feed' | 'heat' | 'attn' | 'dyn'
var kind = 'exp';         // вкладка «Расходы | Доходы» внутри сводки
var paintKey = null;      // что было нарисовано в прошлый раз — по нему держим прокрутку
var showZero = false;     // раскрыт ли блок «без трат»
var hideTimer = null;     // отложенное hidden после анимации ухода
var monthSaved = null;    // куда вернуть S.ui.month после карточки
var monthTaken = false;
var cardWatch = null;     // наблюдатель за закрытием карточки

function stepYM(v, d) {
  var y = parseInt(v.slice(0, 4), 10), m = parseInt(v.slice(5, 7), 10) - 1 + d;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + (m < 9 ? '0' : '') + (m + 1);
}
function pct(x) { return Math.round(x * 100); }
// в макете подпись — просто «Сентябрь»; год дописываем, только когда он не текущий
function shortMonth(v) {
  var full = UI.monthLabel(v);
  return v.slice(0, 4) === Engine.today().slice(0, 4) ? full.split(' ')[0] : full;
}

// ---------- блок 1: итог, полоса, легенда ----------
function segments(rows, total) {
  var out = [], rest = 0, i = 0;
  rows.forEach(function (r) {
    if (r.fact <= 0) return;
    var sh = r.fact / total, idx = i++;
    if (sh < MIN_SEG) { rest += r.fact; return; }
    out.push({ name: r.name, color: hue(idx), share: sh });
  });
  if (rest > 0) out.push({ name: 'Прочее', color: 'var(--muted)', share: rest / total });
  return out;
}

// Процент - только по категориям с лимитом (Engine.limitProgress): лимит у одной
// категории и траты в другой раньше давали «2469 %». Если лимит не у всех - говорим,
// у скольких, чтобы процент не читался как «весь месяц».
function headHtml(rows, factTotal, planTotal) {
  var lp = Engine.limitProgress(UI.S, ymStr, kind);
  var sub, pctHtml = '';
  if (!lp.limited) sub = kind === 'inc' ? 'план на месяц не задан' : 'лимиты на месяц не заданы';
  else {
    sub = 'из ' + fmt(lp.plan) + ' ₽ ' + (kind === 'inc' ? 'по плану' : 'по лимиту');
    if (lp.limited < lp.total) {
      sub += ' · ' + (kind === 'inc' ? 'план задан' : 'лимит задан') + ' у ' + lp.limited + ' из ' + lp.total +
        ' ' + Engine.plural(lp.total, 'категории', 'категорий', 'категорий');
    }
    if (lp.plan > 0) pctHtml = '<span class="sm-pct">' + pct(lp.fact / lp.plan) + ' %</span>';
  }
  var h = '<div class="sm-big">' + fmt(factTotal) + ' ₽</div>' +
    '<div class="sm-sub"><span>' + esc(sub) + '</span>' + pctHtml + '</div>';
  if (factTotal <= 0) {
    return h + '<div class="empty">В этом месяце пока нет операций</div>';
  }
  var segs = segments(rows, factTotal);
  h += '<div class="sm-bar" aria-hidden="true">' + segs.map(function (s) {
    return '<i style="flex:0 0 ' + (s.share * 100).toFixed(2) + '%;background:' + s.color + '"></i>';
  }).join('') + '</div>';
  var shown = segs.slice(0, MAX_LEG);
  h += '<div class="sm-leg">' + shown.map(function (s) {
    return '<span class="sm-lg"><span class="sm-dot" style="background:' + s.color + '"></span>' +
      '<b>' + esc(s.name) + '</b> ' + pct(s.share) + ' %</span>';
  }).join('') +
    (segs.length > shown.length ? '<span class="sm-lg more">+' + (segs.length - shown.length) + '</span>' : '') +
    '</div>';
  return h;
}

// ---------- блок 2: строки категорий ----------
function rowHtml(r, factTotal, idx) {
  var S = UI.S;
  var icon = S.icons[r.catId] || Icons.guessKind(r.name, kind);
  var L = UI.levelOf(kind, r.fact, r.plan);
  var lvl = 'lvl-' + L.lvl, ratio = L.pct, style = '';
  if (r.fact > 0 && !(r.plan > 0)) { lvl = ''; style = 'background:' + hue(idx) + ';'; }
  var note = [];
  if (factTotal > 0 && r.fact > 0) note.push(pct(r.fact / factTotal) + ' %');
  var word = kind === 'inc' ? 'план' : 'лимит';
  note.push(r.hasPlan ? word + ' ' + fmt(r.plan) + ' ₽' : word + ' не задан');
  if (r.archived) note.push('в архиве');
  return '<button class="sm-row ' + lvl + (r.archived ? ' retired' : '') + '" type="button" data-id="' + esc(r.catId) + '"' +
    ' style="--tint:' + tint(idx) + ';--hue:' + hue(idx) + '">' +
    '<span class="sm-ico" aria-hidden="true">' + Icons.img(icon, kind, 23, r.name) + '</span>' +
    '<span class="sm-mid">' +
      '<span class="sm-l1"><span class="sm-n">' + esc(r.name) + '</span>' +
        '<span class="sm-f">' + fmt(r.fact) + ' ₽</span></span>' +
      '<span class="sm-rb"><i style="' + style + 'width:' + (ratio * 100).toFixed(1) + '%"></i></span>' +
      '<span class="sm-l2">' + esc(note.join(' · ')) + '</span>' +
    '</span>' +
  '</button>';
}

function bodyHtml() {
  var S = UI.S;
  if (!Engine.listCategories(S, kind).length) return noPlansHtml();
  var rows = Engine.monthBreakdown(S, ymStr, kind);
  var factTotal = 0, planTotal = 0;
  rows.forEach(function (r) { factTotal += r.fact; planTotal += r.plan; });

  var live = rows.filter(function (r) { return r.fact > 0; });
  var zero = rows.filter(function (r) { return r.fact <= 0 && r.plan > 0; });

  var h = '';
  h += '<div class="sm-head-b">' + headHtml(rows, factTotal, planTotal) + '</div>';
  h += '<div class="sm-rows">' + live.map(function (r, i) { return rowHtml(r, factTotal, i); }).join('') + '</div>';
  if (zero.length) {
    h += '<button class="sm-more" type="button" id="smMore">' +
      (showZero ? 'Скрыть' : 'Показать') + ' ' +
      (kind === 'inc' ? 'без поступлений' : 'без трат') + ' (' + zero.length + ')</button>';
    if (showZero) {
      h += '<div class="sm-rows sm-dim">' +
        zero.map(function (r, i) { return rowHtml(r, factTotal, live.length + i); }).join('') + '</div>';
    }
  }
  return h;
}

// ---------- блок 3: лента операций по дням ----------
// Строка ленты — тот же .txrow, что в карточке кошелька: свайпы и правку даёт
// UI.bindTxSwipe из sheet.js, здесь только устройство строки.
function feedRowHtml(t) {
  var top, name, cls, amt;
  if (t.kind === 'transfer') {
    top = 'Перевод';
    name = (UI.walletName(t.walletId) || '—') + ' → ' + (UI.walletName(t.toWalletId) || '—');
    cls = 'zero'; amt = money(t.amount);
  } else {
    top = UI.walletName(t.walletId) || 'без кошелька';
    name = UI.catName(t.catId) || '—';
    cls = t.kind === 'inc' ? 'pos' : 'neg';
    amt = (t.kind === 'inc' ? '+' : '−') + money(t.amount);
  }
  return '<div class="txrow" data-id="' + esc(t.id) + '">' +
    '<div class="txact edit" aria-hidden="true">Править</div>' +
    '<div class="txact del" aria-hidden="true">Удалить</div>' +
    '<div class="txfront">' +
      '<div class="fd-mid">' +
        '<div class="fd-w">' + esc(top) + '</div>' +
        '<div class="fd-n">' + esc(name) + '</div>' +
      '</div>' +
      '<div class="txa ' + cls + '">' + esc(amt) + ' ₽</div>' +
    '</div>' +
  '</div>';
}

function feedHtml() {
  var days = Engine.feedByDay(UI.S, ymStr);
  if (!days.length) return '<div class="empty">В этом месяце операций нет</div>';
  return days.map(function (g) {
    var ch = g.change;
    var chCls = ch > 0 ? 'pos' : (ch < 0 ? 'neg' : '');
    return '<div class="fd-day">' +
      '<div class="fd-h">' + esc(g.label) + '</div>' +
      '<div class="fd-card">' + g.rows.map(feedRowHtml).join('') + '</div>' +
      '<div class="fd-f">' +
        '<span class="fd-bal">остаток на конец дня ' + fmt(g.balanceEnd) + ' ₽</span>' +
        '<span class="fd-ch ' + chCls + '">изменение ' + (ch > 0 ? '+' : '') + fmt(ch) + ' ₽</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function noPlansHtml() { return '<div class="empty">Пока нет категорий. Добавь их в меню → «Настроить категории».</div>'; }

// ---------- экран «Тепловая карта»: дни месяца по тратам ----------
function heatHtml() {
  var S = UI.S;
  var spend = Engine.daySpend(S, ymStr);
  var y = parseInt(ymStr.slice(0, 4), 10), m = parseInt(ymStr.slice(5, 7), 10);
  var lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;   // пустых клеток до понедельника
  var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var max = 0;
  Object.keys(spend).forEach(function (k) { if (spend[k] > max) max = spend[k]; });

  var cells = '';
  for (var d = 1; d <= days; d++) {
    var date = ymStr + '-' + (d < 10 ? '0' : '') + d;
    var v = spend[date] || 0;
    var it = (max > 0 && v > 0) ? Math.max(0.14, v / max) : 0;   // видимая заливка даже у мелкой траты
    var hot = it >= 0.5 ? ' hot' : '';
    var on = date === heatDay ? ' on' : '';
    // первый день месяца встаёт в свою колонку недели (Пн..Вс), пустых клеток слева нет
    var col = d === 1 ? ' style="grid-column-start:' + (lead + 1) + '"' : '';
    cells += '<button class="hm-cell' + hot + on + '" type="button" data-date="' + date + '"' + col + ' aria-label="' + d + ': ' + fmt(v) + ' ₽">' +
      '<i aria-hidden="true" style="--i:' + it.toFixed(3) + '"></i>' +
      '<span class="hm-d">' + d + '</span></button>';
  }

  var h = '<div class="hm-wrap"><div class="hm-week">' +
    WD.map(function (w) { return '<span class="hm-wd">' + w + '</span>'; }).join('') +
    '</div><div class="hm-grid">' + cells + '</div>' +
    '<div class="hm-legend"><span>меньше</span><span class="hm-ramp" aria-hidden="true"></span><span>больше</span></div>';

  if (heatDay) {
    var dayTx = S.tx.filter(function (t) { return t.date === heatDay; }).sort(Engine.byNewest);
    h += '<div class="hm-day"><div class="fd-h">' + esc(Engine.dayLabel(heatDay)) + '</div>' +
      (dayTx.length ? '<div class="fd-card">' + dayTx.map(feedRowHtml).join('') + '</div>'
                    : '<div class="empty">В этот день операций нет</div>') +
      '</div>';
  }
  return h + '</div>';
}

// ---------- экран «Зона внимания»: где перерасход ----------
function attnRow(r) {
  var S = UI.S;
  var icon = S.icons[r.catId] || Icons.guessKind(r.name, 'exp');
  var ratio = Math.min(r.ratio, 1);
  var fp = fmt(r.fact) + ' / ' + (r.plan > 0 ? fmt(r.plan) : '—') + ' ₽';
  var note = r.level === 'over'
    ? (r.plan > 0 ? '+' + fmt(r.over) + ' ₽ сверх' : fmt(r.fact) + ' ₽ при лимите 0')
    : pct(r.ratio) + ' % лимита';
  return '<div class="at-row lvl-' + r.level + (r.archived ? ' retired' : '') + '">' +
    '<span class="sm-ico" aria-hidden="true">' + Icons.img(icon, 'exp', 23, r.name) + '</span>' +
    '<span class="at-mid">' +
      '<span class="at-l1"><span class="at-n">' + esc(r.name) + '</span><span class="at-fp">' + esc(fp) + '</span></span>' +
      '<span class="at-bar"><i style="width:' + (ratio * 100).toFixed(1) + '%"></i></span>' +
      '<span class="at-l2 ' + (r.level === 'over' ? 'over' : 'warn') + '">' + esc(note) + '</span>' +
    '</span></div>';
}
function attnHtml() {
  var S = UI.S;
  if (!Engine.listCategories(S, 'exp').length) return noPlansHtml();
  var head = '';
  var rows = Engine.attention(S, ymStr);
  if (!rows.length) return head + '<div class="empty">В этом месяце всё в пределах лимитов</div>';
  var over = [], warn = [];
  rows.forEach(function (r) { (r.level === 'over' ? over : warn).push(r); });
  var h = head;
  if (over.length) h += '<div class="at-sub">Перерасход</div>' + over.map(attnRow).join('');
  if (warn.length) h += '<div class="at-sub">Близко к лимиту</div><div class="at-dim">' + warn.map(attnRow).join('') + '</div>';
  return h;
}

// ---------- экран «Динамика по месяцам»: расходы за год ----------
// Вертикальный список из 12 строк (Янв..Дек): подпись месяца слева, горизонтальная
// полоса факта (все делят одну шкалу — самый дорогой месяц = 100%, длины сравнимы),
// тонкая метка лимита на полосе и сумма факта справа. Так все 12 месяцев видны сразу,
// без горизонтальной прокрутки, а число не обрезается на узком столбике.
function dynHtml() {
  var S = UI.S;
  if (!Engine.listCategories(S, 'exp').length) return noPlansHtml();
  var year = parseInt(Engine.ym(Engine.today()).slice(0, 4), 10);
  var data = Engine.monthlyTotals(S, year);
  var max = 1;                                          // общая шкала полос — самый дорогой месяц
  data.forEach(function (d) { if (d.fact > max) max = d.fact; });
  var selM = (parseInt(ymStr.slice(0, 4), 10) === year) ? (parseInt(ymStr.slice(5, 7), 10) - 1) : -1;

  var rows = data.map(function (d) {
    var on = d.m === selM, over = d.plan > 0 && d.fact > d.plan, zero = d.fact <= 0;
    var w = Math.max(0, Math.min(d.fact / max, 1));
    var pw = d.plan > 0 ? Math.max(0, Math.min(d.plan / max, 1)) : -1;
    var cls = 'dy-row' + (on ? ' on' : '') + (over ? ' over' : '') + (zero ? ' zero' : '');
    return '<button class="' + cls + '" type="button" data-m="' + d.m + '" aria-label="' + MM[d.m] + ': ' + fmt(d.fact) + ' ₽">' +
      '<span class="dy-m">' + MM[d.m] + '</span>' +
      '<span class="dy-track">' +
        '<span class="dy-fact" style="width:' + (w * 100).toFixed(1) + '%"></span>' +
        (pw >= 0 ? '<span class="dy-plan" style="left:' + (pw * 100).toFixed(1) + '%" aria-hidden="true"></span>' : '') +
      '</span>' +
      '<span class="dy-v">' + (zero ? '—' : fmt(d.fact)) + ' ₽</span>' +
    '</button>';
  }).join('');

  return '<div class="dy-list">' + rows + '</div>' +
    '<div class="dy-foot"><span class="dy-key"><i></i>факт</span>' +
    '<span class="dy-key plan"><i></i>лимит</span><span>' + esc(String(year) + ' год') + '</span></div>';
}

function renderBody() {
  return view === 'feed' ? feedHtml()
    : view === 'heat' ? heatHtml()
    : view === 'attn' ? attnHtml()
    : view === 'dyn' ? dynHtml()
    : bodyHtml();
}

function paint() {
  if (!opened) return;
  $('summary').dataset.view = view;           // видимость блоков решает CSS по этому атрибуту
  $('summary').classList.toggle('sm-free', !fullAccess());   // замки на премиум-карточках выбора
  if (view === 'chooser') return;             // на экране выбора рисовать в теле нечего

  $('smMonth').textContent = shortMonth(ymStr);
  // «Расходы | Доходы» — разрез только у сводки; в ленте видны все операции сразу
  all($('smKinds'), '.sm-tab').forEach(function (b) {
    var on = b.getAttribute('data-kind') === kind;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  var box = $('smBody');
  // Прокрутку держим, пока на экране то же самое: иначе правка операции прямо из
  // ленты (перерисовка приложения) каждый раз кидала бы список в начало месяца.
  var key = view + '|' + ymStr + '|' + kind;
  var top = key === paintKey ? box.scrollTop : 0;
  box.innerHTML = renderBody();
  paintKey = key;
  box.scrollTop = top;
}

// открыть один из двух экранов (память «последнего открытого» больше не ведём:
// аналитика всегда открывается выбором из двух карточек)
// В бесплатной версии открыты только «Сводка» и «Лента». Остальное — под полным доступом.
var PREMIUM = { heat: 1, attn: 1, dyn: 1 };
function fullAccess() { return !(UI.hasFullAccess) || UI.hasFullAccess(); }

function setView(v) {
  v = VIEWS[v] ? v : 'summary';
  if (v === view) return;
  if (PREMIUM[v] && !fullAccess()) { if (UI.paywall) UI.paywall(); return; }
  view = v;
  heatDay = null;
  paint();
  UI.haptic('light');
}

// вернуться к выбору из карточек
function toChooser() {
  if (view === 'chooser') return;
  view = 'chooser';
  heatDay = null;
  paintKey = null;
  paint();
  UI.haptic('light');
}

// ---------- открытие и закрытие ----------
function open(o) {
  o = o || {};
  if (opened) return;
  opened = true;
  ymStr = o.ym || UI.curYM();
  kind = o.kind === 'inc' ? 'inc' : 'exp';
  // Куда открыть: если экран попросили ЯВНО (o.view — например, из QA-ссылки), на него;
  // иначе всегда показываем выбор из двух карточек. «Последний открытый» не запоминаем.
  var want = o.view;
  if (want && PREMIUM[want] && !fullAccess()) want = null;   // премиум-экран под замком → к выбору
  view = VIEWS[want] ? want : 'chooser';
  showZero = false;
  heatDay = null;
  paintKey = null;
  clearTimeout(hideTimer); hideTimer = null;
  var el = $('summary');
  el.hidden = false;
  paint();
  void el.offsetHeight;                       // reflow: старт анимации от translateY(100%)
  el.classList.add('open');
  UI.haptic('light');
}

function close() {
  if (!opened) return;
  opened = false;
  var el = $('summary');
  el.classList.remove('open');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(function () { el.hidden = true; $('smBody').innerHTML = ''; hideTimer = null; }, 260);
}

// ---------- карточка категории из строки ----------
// UI.openCard берёт месяц из S.ui.month — на время карточки подменяем его месяцем сводки
// и возвращаем как было, когда карточка уедет (следим за классом .open, без таймеров).
function openCat(catId) {
  if (UI.curYM() !== ymStr) { monthSaved = UI.S.ui.month; monthTaken = true; UI.S.ui.month = ymStr; }
  UI.openCard({ kind: kind, id: catId });
  if ($('card').classList.contains('open')) watchCard();
  else afterCard();
}

function watchCard() {
  if (cardWatch) return;
  var el = $('card');
  cardWatch = new MutationObserver(function () {
    if (el.classList.contains('open')) return;
    cardWatch.disconnect(); cardWatch = null;
    afterCard();
  });
  cardWatch.observe(el, { attributes: true, attributeFilter: ['class'] });
}

function afterCard() {
  if (monthTaken) {
    UI.S.ui.month = monthSaved; monthSaved = null; monthTaken = false;
    UI.save(); UI.render();                   // render() дёрнет afterRender → paint()
    return;
  }
  paint();                                    // операцию могли поправить прямо из карточки
}

// ---------- связки ----------
$('smBack').addEventListener('click', close);           // крестик справа — закрыть аналитику
$('smToChoose').addEventListener('click', toChooser);   // стрелка слева — назад к выбору
$('smPrev').addEventListener('click', function () { ymStr = stepYM(ymStr, -1); showZero = false; heatDay = null; paint(); UI.haptic('light'); });
$('smNext').addEventListener('click', function () { ymStr = stepYM(ymStr, 1); showZero = false; heatDay = null; paint(); UI.haptic('light'); });

// карточки выбора открывают каждая свой экран
$('smGoSummary').addEventListener('click', function () { setView('summary'); });
$('smGoFeed').addEventListener('click', function () { setView('feed'); });
$('smGoHeat').addEventListener('click', function () { setView('heat'); });
$('smGoAttn').addEventListener('click', function () { setView('attn'); });
$('smGoDyn').addEventListener('click', function () { setView('dyn'); });

all($('smKinds'), '.sm-tab').forEach(function (b) {
  b.addEventListener('click', function () {
    var k = b.getAttribute('data-kind');
    if (k === kind) return;
    kind = k; showZero = false; paint(); UI.haptic('light');
  });
});

$('smBody').addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var more = e.target.closest('.sm-more');
  if (more) { showZero = !showZero; paint(); UI.haptic('light'); return; }
  var cell = e.target.closest('.hm-cell');
  if (cell && cell.getAttribute('data-date')) {
    var date = cell.getAttribute('data-date');
    heatDay = (heatDay === date) ? null : date;   // повторный тап по дню — свернуть список
    paint(); UI.haptic('light'); return;
  }
  var col = e.target.closest('.dy-row');
  if (col && col.getAttribute('data-m') != null) {
    var m = parseInt(col.getAttribute('data-m'), 10);
    ymStr = parseInt(Engine.ym(Engine.today()).slice(0, 4), 10) + '-' + (m < 9 ? '0' : '') + (m + 1);
    paint(); UI.haptic('light'); return;
  }
  var row = e.target.closest('.sm-row');
  if (row) openCat(row.getAttribute('data-id'));
});

// Свайпы по строке ленты (влево — удалить, вправо — исправить) и тап = правка.
// Обработчики те же самые, что в карточке кошелька: sheet.js их и раздаёт.
if (UI.bindTxSwipe) {
  UI.bindTxSwipe($('smBody'), { onTap: function (id) { if (UI.editTx) UI.editTx(id); } });
}

$('btnSummary').addEventListener('click', function () { open(); });

// Escape и кнопка «назад» приходят из ui.js: он один знает порядок слоёв
// (Engine.topOverlay) и закрывает ровно верхний. Своего перехватчика тут больше нет -
// два обработчика на одну клавишу закрывали сводку вместе с тем, что под ней.

// перерисовка приложения (операция, синк, смена темы) — обновляем и сводку
var prevAfterRender = UI.afterRender;
UI.afterRender = function () {
  if (prevAfterRender) prevAfterRender();
  paint();
};

UI.openSummary = open;
UI.closeSummary = close;
// «назад» (Android/Escape): с экрана — к выбору, с выбора — закрыть аналитику
UI.summaryBack = function () { if (view === 'chooser') close(); else toChooser(); };
UI.summaryOpen = function () { return opened; };
UI.summaryView = function () { return view; };
UI.setSummaryView = setView;
UI.summaryToChooser = toChooser;

// QA: ?demo&open=summary[&tab=inc][&view=feed|heat|attn|dyn|summary|chooser][&ym=YYYY-MM]
// открывает нужный экран сразу — для скриншотов
if (UI.DEMO && location.search.indexOf('open=summary') >= 0) {
  var vm = location.search.match(/[?&]view=(feed|heat|attn|dyn|summary|chooser)/);
  var qv = vm ? vm[1] : 'summary';
  var ymM = location.search.match(/[?&]ym=(\d{4}-\d{2})/);
  open({ kind: location.search.indexOf('tab=inc') >= 0 ? 'inc' : 'exp', view: qv, ym: ymM ? ymM[1] : undefined });
}

})();
