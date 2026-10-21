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

// Цвет-ярлык категории - по её месту в списке (строки отсортированы по факту, крупная - первая):
// шкала долей, точки легенды и строки красятся одним и тем же индексом. Палитры свои (14.10):
// расходы - спокойные --sx-0..5 без красного и оранжевого (те только у перерасхода и «почти
// лимита»); доходы - оттенки одного зелёного --sg-0..5, крупный - самый насыщенный.
var HUES = 6;
var MIN_SEG = 0.02;       // сегмент меньше 2% уходит в «Прочее»
var MAX_LEG = 6;          // сколько фишек показываем в легенде

function hue(i) { return 'var(--' + (kind === 'inc' ? 'sg-' : 'sx-') + (kind === 'inc' ? Math.min(i, HUES - 1) : i % HUES) + ')'; }
function tint(i) { return 'var(--' + (kind === 'inc' ? 'sgt-' : 'sxt-') + (kind === 'inc' ? Math.min(i, HUES - 1) : i % HUES) + ')'; }

// ---------- состояние экрана ----------
var VIEWS = { summary: 1, feed: 1, heat: 1, attn: 1, dyn: 1, cap: 1, load: 1 };
var WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
var MM = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
var heatDay = null;       // выбранный день в тепловой карте (его операции показываем ниже)

var opened = false;
var ymStr = null;         // месяц сводки
var view = 'chooser';     // 'chooser' | 'summary' | 'feed' | 'heat' | 'attn' | 'dyn' | 'cap' | 'load'
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
    sub = 'из ' + fmt(lp.plan) + '\u00a0₽ ' + (kind === 'inc' ? 'по плану' : 'по лимиту');
    if (lp.limited < lp.total) {
      sub += ' · ' + (kind === 'inc' ? 'план задан' : 'лимит задан') + ' у ' + lp.limited + ' из ' + lp.total +
        ' ' + Engine.plural(lp.total, 'категории', 'категорий', 'категорий');
    }
    if (lp.plan > 0) pctHtml = '<span class="sm-pct">' + pct(lp.fact / lp.plan) + '\u00a0%</span>';
  }
  var h = '<div class="sm-big">' + fmt(factTotal) + '\u00a0₽</div>' +
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
      '<b>' + esc(s.name) + '</b> ' + pct(s.share) + '\u00a0%</span>';
  }).join('') +
    (segs.length > shown.length ? '<span class="sm-lg more">+' + (segs.length - shown.length) + '</span>' : '') +
    '</div>';
  return h;
}

// ---------- блок 2: строки категорий ----------
// Иконка категории - как на главном экране: своя иконка категории, затем угадывание по имени.
// Раньше брали только S.icons и сразу угадывали - «Еда» в сводке становилась многоточием (06.10).
function catIcon(S, r, kind) {
  var f = Engine.findCategory(S, r.catId);
  return S.icons[r.catId] || (f && f.cat.icon) || Icons.guessKind(r.name, kind);
}

function rowHtml(r, factTotal, idx) {
  var S = UI.S;
  var icon = catIcon(S, r, kind);
  var L = UI.levelOf(kind, r.fact, r.plan);
  var lvl = 'lvl-' + L.lvl, ratio = L.pct, style = '';
  if (r.fact > 0 && !(r.plan > 0)) { lvl = ''; style = 'background:' + hue(idx) + ';'; }
  var note = [];
  if (factTotal > 0 && r.fact > 0) note.push(pct(r.fact / factTotal) + '\u00a0%');
  var word = kind === 'inc' ? 'план' : 'лимит';
  note.push(r.hasPlan ? word + ' ' + fmt(r.plan) + '\u00a0₽' : word + ' не задан');
  if (r.archived) note.push('в архиве');
  return '<button class="sm-row ' + lvl + (r.archived ? ' retired' : '') + '" type="button" data-id="' + esc(r.catId) + '"' +
    ' style="--tint:' + tint(idx) + ';--hue:' + hue(idx) + '">' +
    '<span class="sm-ico" aria-hidden="true">' + Icons.img(icon, kind, 23, r.name) + '</span>' +
    '<span class="sm-mid">' +
      '<span class="sm-l1"><span class="sm-n">' + esc(r.name) + '</span>' +
        '<span class="sm-f">' + fmt(r.fact) + '\u00a0₽</span></span>' +
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
  if (t.kind === 'debt') {
    // 1.0.4: операция с долгом - вид операции сверху, «кошелёк → долг» (или обратно) строкой
    top = UI.debtOpLabel(t.op === 'take' ? 'debttake' : 'debtpay', t.debtId);
    var wn = UI.walletName(t.walletId) || '—', dn = UI.debtName(t.debtId) || 'долг удалён';
    name = t.op === 'take' ? dn + ' → ' + wn : wn + ' → ' + dn;
    cls = 'zero'; amt = (t.op === 'take' ? '+' : '−') + money(t.amount);
  } else if (t.kind === 'transfer') {
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
        UI.noteHtml(t) +   // 1.0.5: заметка второй строкой
      '</div>' +
      '<div class="txa ' + cls + '">' + esc(amt) + '\u00a0₽</div>' +
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
        '<span class="fd-bal">остаток на конец дня ' + fmt(g.balanceEnd) + '\u00a0₽</span>' +
        '<span class="fd-ch ' + chCls + '">изменение ' + (ch > 0 ? '+' : '') + fmt(ch) + '\u00a0₽</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function noPlansHtml() { return '<div class="empty">Пока нет категорий. Добавьте их в меню → «Настроить категории».</div>'; }

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
    cells += '<button class="hm-cell' + hot + on + '" type="button" data-date="' + date + '"' + col + ' aria-label="' + d + ': ' + fmt(v) + '\u00a0₽">' +
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
  var icon = catIcon(S, r, 'exp');
  var ratio = Math.min(r.ratio, 1);
  var fp = fmt(r.fact) + ' / ' + (r.plan > 0 ? fmt(r.plan) : '—') + '\u00a0₽';
  var note = r.level === 'over'
    ? (r.plan > 0 ? '+' + fmt(r.over) + '\u00a0₽ сверх лимита' : fmt(r.fact) + '\u00a0₽ при лимите 0')
    : pct(r.ratio) + '\u00a0% лимита';
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

// ---------- экран «Динамика по месяцам»: расходы и доходы за год ----------
// 14.10: те же вкладки «Расходы | Доходы», что в сводке. Доходы - зелёные полосы, отметка -
// план дохода; перевыполнение плана - хорошо (никогда не красным).
// Вертикальный список из 12 строк (Янв..Дек): подпись месяца слева, горизонтальная
// полоса факта (все делят одну шкалу — самый дорогой месяц = 100%, длины сравнимы),
// тонкая метка лимита на полосе и сумма факта справа. Так все 12 месяцев видны сразу,
// без горизонтальной прокрутки, а число не обрезается на узком столбике.
function dynHtml() {
  var S = UI.S;
  if (!Engine.listCategories(S, kind).length) return noPlansHtml();
  var year = parseInt(Engine.ym(Engine.today()).slice(0, 4), 10);
  var inc = kind === 'inc';
  var data = Engine.monthlyTotals(S, year, kind);
  var max = 1;                                          // общая шкала полос — самый дорогой месяц
  data.forEach(function (d) { if (d.fact > max) max = d.fact; });
  var selM = (parseInt(ymStr.slice(0, 4), 10) === year) ? (parseInt(ymStr.slice(5, 7), 10) - 1) : -1;

  var rows = data.map(function (d) {
    var on = d.m === selM, over = !inc && d.plan > 0 && d.fact > d.plan, zero = d.fact <= 0;
    var w = Math.max(0, Math.min(d.fact / max, 1));
    var pw = d.plan > 0 ? Math.max(0, Math.min(d.plan / max, 1)) : -1;
    var cls = 'dy-row' + (on ? ' on' : '') + (over ? ' over' : '') + (zero ? ' zero' : '');
    return '<button class="' + cls + '" type="button" data-m="' + d.m + '" aria-label="' + MM[d.m] + ': ' + fmt(d.fact) + '\u00a0₽">' +
      '<span class="dy-m">' + MM[d.m] + '</span>' +
      '<span class="dy-track">' +
        '<span class="dy-fact" style="width:' + (w * 100).toFixed(1) + '%"></span>' +
        (pw >= 0 ? '<span class="dy-plan" style="left:' + (pw * 100).toFixed(1) + '%" aria-hidden="true"></span>' : '') +
      '</span>' +
      '<span class="dy-v">' + (zero ? '—' : fmt(d.fact)) + '\u00a0₽</span>' +
    '</button>';
  }).join('');

  return '<div class="dy-list' + (inc ? ' inc' : '') + '">' + rows + '</div>' +
    '<div class="dy-foot' + (inc ? ' inc' : '') + '"><span class="dy-key"><i></i>факт</span>' +
    '<span class="dy-key plan"><i></i>' + (inc ? 'план' : 'лимит') + '</span><span>' + esc(String(year) + ' год') + '</span></div>';
}

// ---------- 1.0.4: «Чистый капитал» - в кошельках + мне должны - я должен, по месяцам ----------
// 12 месяцев, кончая выбранным: полоса от нуля (минус - красным влево), сумма справа.
function capHtml() {
  var S = UI.S, cur = Engine.netCapital(S, ymStr);
  // месяцы до первой записи (операции или долга) не рисуем - там капитал ничего не говорит
  var first = ymStr;
  S.tx.forEach(function (t) { var m = String(t.date).slice(0, 7); if (m < first) first = m; });
  (S.debts || []).forEach(function (d) { var m = String(d.createdDate).slice(0, 7); if (m < first) first = m; });
  var series = Engine.netCapitalSeries(S, ymStr, 12).filter(function (x) { return x.ym >= first; });
  var max = 1;
  series.forEach(function (x) { if (Math.abs(x.net) > max) max = Math.abs(x.net); });
  var head = '<div class="cp-head">' +
    '<div class="sm-big' + (cur.net < 0 ? ' neg' : '') + '">' + fmt(cur.net) + '\u00a0₽</div>' +
    '<div class="cp-parts">' +
      // кредитки (1.0.4): их минус уже внутри «в кошельках» - показываем его отдельной строкой
      // среди долгов, а «в кошельках» - без него (cur.own); net тот же, без задвоения
      '<span>' + (cur.credit ? 'В кошельках без кредиток' : 'В кошельках') + ': <b>' + fmt(cur.credit ? cur.own : cur.wallets) + '\u00a0₽</b></span>' +
      (cur.owed ? '<span>Мне должны: <b>+' + fmt(cur.owed) + '\u00a0₽</b></span>' : '') +
      (cur.owe ? '<span>Я должен: <b class="neg">−' + fmt(cur.owe) + '\u00a0₽</b></span>' : '') +
      (cur.credit ? '<span>Кредитные карты: <b class="neg">−' + fmt(-cur.credit) + '\u00a0₽</b></span>' : '') +
    '</div></div>';
  var rows = series.map(function (x) {
    var on = x.ym === ymStr, w = Math.min(1, Math.abs(x.net) / max);
    return '<div class="dy-row cp-row' + (on ? ' on' : '') + (x.net < 0 ? ' neg' : '') + '">' +
      '<span class="dy-m">' + MM[+x.ym.slice(5, 7) - 1] + '</span>' +
      '<span class="dy-track"><span class="dy-fact" style="width:' + (w * 100).toFixed(1) + '%"></span></span>' +
      '<span class="dy-v">' + fmt(x.net) + '\u00a0₽</span></div>';
  }).join('');
  var note = ((S.debts || []).length || Engine.hasCreditCards(S)) ? '' :
    '<div class="cp-note">Долгов пока нет - капитал равен деньгам в кошельках. Завести долг: «+» в ленте кошельков.</div>';
  return head + '<div class="dy-list">' + rows + '</div>' + note +
    '<div class="dy-foot"><span>Каждый месяц - сколько было на его последний день. Текущий месяц - на сегодня.</span></div>';
}

// ---------- 1.0.4: вкладка «Долги» (была «Нагрузка», Алексей 13.10) ----------
// Сверху - сколько должен сейчас и сколько уже выплачено (в счёт долга и процентами); ниже -
// нагрузка выбранного месяца (плановые платежи / доходы, порог 30%) и по каждому долгу:
// остаток, платёж и прогноз погашения. Вкладка есть, только когда есть долг «я должен».
// «в августе 2028» (14.10): месяц в предложном падеже, год не отрывается
var MONTH_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
function monthPrep(v) { return MONTH_PREP[+String(v).slice(5, 7) - 1] + '\u00a0' + String(v).slice(0, 4); }
function loadHtml() {
  var S = UI.S, D = Engine.debtStats(S), L = Engine.debtLoad(S, ymStr);
  var h = '<div class="ld-head">' +
    '<div class="sm-big' + (D.total > 0 ? ' neg' : '') + '">' + fmt(D.total) + '\u00a0₽</div>' +
    '<div class="sm-sub"><span>' + (D.total > 0 ? 'общая сумма всех долгов' : 'долгов «я должен» сейчас нет') + '</span></div>' +
    (D.paid > 0 ? '<div class="ld-paid"><span>выплачено ' + fmt(D.paid) + '\u00a0₽</span><span>в счёт долга ' + fmt(D.body) + '\u00a0₽' +
      (D.interest > 0 ? ' · проценты ' + fmt(D.interest) + '\u00a0₽' : '') + '</span></div>' : '') +
    '</div>';
  // нагрузка месяца (подписи - решение Алексея 14.10: «Долговая нагрузка на бюджет», под
  // процентом две строки - платежи по всем долгам и доходы месяца)
  h += '<div class="ld-sec">Долговая нагрузка на бюджет</div>';
  if (!L.list.length) h += '<div class="ld-none-t">В этом месяце платежей по долгам нет.</div>';
  else if (L.ratio === null) h += '<div class="ld-none-t">Платежи по всем долгам: ' + fmt(L.pay) + '\u00a0₽, доходов в этом месяце нет.</div>';
  else {
    var p = L.pct, hi = Engine.LOAD_HIGH_PCT;   // порог - один, из движка (Р20 ревью 15.10)
    h += '<div class="ld-load"><b class="' + (L.high ? 'neg' : '') + '">' + String(p).replace('.', ',') + '\u00a0%</b>' +
      '<span class="ld-lines"><span class="ld-pay">Платежи по всем долгам: ' + fmt(L.pay) + '\u00a0₽</span>' +
      '<span class="ld-inc">Доходы за месяц: ' + fmt(L.income) + '\u00a0₽</span></span></div>' +
      '<div class="ld-bar' + (L.high ? ' high' : '') + '" aria-hidden="true"><i style="width:' + Math.min(100, p) + '%"></i><b style="left:' + hi + '%"></b></div>';
    if (L.high) h += '<div class="ld-warn">Долговая нагрузка выше ' + hi + '% - высокий риск просрочек. Направьте свободные деньги на досрочное погашение с сокращением ежемесячного платежа.</div>';
  }
  // по каждому долгу
  if (D.list.length) h += '<div class="ld-list">' + D.list.map(function (x) {
    var when = x.never ? '<span class="ld-late">платёж не покрывает проценты</span>'
      : 'закроется в ' + esc(monthPrep(x.until));
    return '<div class="ld-row"><div class="ld-l"><span class="ld-n">' + esc(x.name) + '</span>' +
      '<span class="ld-s">платёж ' + fmt(x.pay) + '\u00a0₽</span><span class="ld-s ld-when">' + when + '</span></div>' +
      '<span class="ld-v">' + fmt(x.left) + '\u00a0₽</span></div>';
  }).join('') + '</div>';
  // подвал (14.10): как считан месяц закрытия; про кредитки - всегда, когда они есть
  h += '<div class="dy-foot ld-foot"><span>Месяц закрытия рассчитан исходя из платежей по графику. Досрочные платежи могут его приблизить.' +
    (Engine.hasCreditCards(S) ? ' Кредитные карты в нагрузку не входят.' : '') + '</span></div>';
  return h;
}

function renderBody() {
  return view === 'cap' ? capHtml()
    : view === 'load' ? loadHtml()
    : view === 'feed' ? feedHtml()
    : view === 'heat' ? heatHtml()
    : view === 'attn' ? attnHtml()
    : view === 'dyn' ? dynHtml()
    : bodyHtml();
}

function paint() {
  if (!opened) return;
  $('summary').dataset.view = view;           // видимость блоков решает CSS по этому атрибуту
  $('summary').classList.toggle('sm-free', !fullAccess());   // замки на премиум-карточках выбора
  // «Капитал и обязательства» (1.0.4) - только когда долги есть (и погашенные в архиве: история)
  $('smGoDebt').hidden = !((UI.S.debts || []).length || Engine.hasCreditCards(UI.S));
  // вкладка «Долги» - только когда есть долг «я должен»; без неё и вкладок нет, один «Капитал»
  var oweAny = (UI.S.debts || []).some(function (d) { return d.type === 'owe'; });
  if (view === 'load' && !oweAny) view = 'cap';
  $('smDebtTabs').hidden = !oweAny;
  all($('smDebtTabs'), '.sm-tab').forEach(function (b) {
    var on = b.getAttribute('data-dv') === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
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
var PREMIUM = { heat: 1, attn: 1, dyn: 1, cap: 1, load: 1 };
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
  if (UI.updateMainHint) UI.updateMainHint();
  UI.haptic('light');
}

// Телефон 17.10 (1.0.5): правка операции из ленты перерисовывает главный экран, пока аналитика
// открыта, и «плюс» прячется. Закрытие аналитики обязано вернуть его (и подсказку) само.
function close() {
  if (!opened) return;
  opened = false;
  if (UI.updateMainHint) UI.updateMainHint();
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
$('smGoDebt').addEventListener('click', function () { setView('cap'); });
// «Капитал | Нагрузка» - вкладки внутри «Капитала и обязательств»
all($('smDebtTabs'), '.sm-tab').forEach(function (b) {
  b.addEventListener('click', function () { setView(b.getAttribute('data-dv')); });
});

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
// какой месяц писать в хранилище: подмена на время карточки живёт только в памяти
UI.persistMonth = function () { return monthTaken ? monthSaved : UI.S.ui.month; };
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
  var vm = location.search.match(/[?&]view=(feed|heat|attn|dyn|cap|load|summary|chooser)/);
  var qv = vm ? vm[1] : 'summary';
  var ymM = location.search.match(/[?&]ym=(\d{4}-\d{2})/);
  open({ kind: location.search.indexOf('tab=inc') >= 0 ? 'inc' : 'exp', view: qv, ym: ymM ? ymM[1] : undefined });
}

})();
