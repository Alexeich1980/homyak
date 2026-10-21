/* picker.js - свои окна выбора даты и значения из списка (1.0.4, решение 14.10).

   Вместо системных окон Android (поле даты и выпадающий список): лист в стиле приложения
   поверх всего (и поверх формы в #dlg - она не стирается). Регламент RuStore-приложений,
   этап 2: выбор даты/времени/списка - только своё окно (заслон tests/pickers.test.js).

   Поле в форме - кнопка .inp.pk-f. У <button> есть свойство value (атрибут value), поэтому
   код форм читает $(id).value так же, как читал у input/select. После выбора кнопке ставится
   value, подпись и всплывает событие change - старые обработчики change работают как были.

     Picker.dateField({id, value, max, min, optional, title, ph})  - HTML поля даты
     Picker.listField({id, attrs, items:[{value, label}], value, title}) - HTML поля списка
     Picker.date({value, max, min, optional, title, onPick(v)})  - открыть календарь
     Picker.list({title, items, value, onPick(v)})               - открыть список
*/
(function () {
'use strict';

var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
var WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function today() { return (window.Engine && Engine.today) ? Engine.today() : iso(new Date()); }
function iso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
// подпись поля даты: 14.10.2026
function dateLabel(v) { return isDate(v) ? v.slice(8, 10) + '.' + v.slice(5, 7) + '.' + v.slice(0, 4) : ''; }

// ---------- слой ----------
var cur = null;   // {kind, o, ym}
function ensure() {
  if ($('pk')) return;
  var bg = document.createElement('div');
  bg.id = 'pkBg'; bg.hidden = true;
  var sh = document.createElement('div');
  sh.id = 'pk'; sh.hidden = true;
  sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = '<div class="dlg-grip" aria-hidden="true"></div><div class="dlg-t" id="pkTitle"></div>' +
    '<div id="pkBody"></div><div class="dlg-btns" id="pkBtns"></div>';
  document.body.appendChild(bg);
  document.body.appendChild(sh);
  // закрыть по фону - только если и нажали, и отпустили на фоне (выделение текста не закрывает)
  if (window.UI && UI.bindBackdropClose) UI.bindBackdropClose(bg, close);
  // свайп вниз по ручке и заголовку - закрыть, как у остальных листов
  if (window.UI && UI.bindSwipeClose) {
    UI.bindSwipeClose(sh.querySelector('.dlg-grip'), 'down', function () { if (isOpen()) close(); });
    UI.bindSwipeClose(sh.querySelector('.dlg-t'), 'down', function () { if (isOpen()) close(); });
  }
  sh.addEventListener('click', onSheetClick);
}
function isOpen() { var p = $('pk'); return !!p && !p.hidden; }
function close() {
  if (!$('pk')) return;
  $('pk').hidden = true; $('pkBg').hidden = true;
  $('pkBody').innerHTML = ''; $('pkBtns').innerHTML = '';
  cur = null;
}
function show(title, body, btns) {
  ensure();
  $('pkTitle').textContent = title || '';
  $('pkBody').innerHTML = body;
  $('pkBtns').innerHTML = btns.map(function (b) {
    return '<button type="button" class="btn ' + b[2] + '" data-pk-act="' + b[0] + '">' + esc(b[1]) + '</button>';
  }).join('');
  $('pkBg').hidden = false; $('pk').hidden = false;
}
function pick(v) {
  var o = cur && cur.o;
  close();
  if (window.UI && UI.haptic) UI.haptic('light');
  if (o && o.onPick) o.onPick(v);
}
function onSheetClick(e) {
  var t = e.target.closest ? e.target : null;
  if (!t || !cur) return;
  var a = t.closest('[data-pk-act]');
  if (a) {
    var act = a.getAttribute('data-pk-act');
    if (act === 'cancel') close();
    else if (act === 'today') pick(today());
    else if (act === 'clear') pick('');
    return;
  }
  var nav = t.closest('[data-pk-nav]');
  if (nav) { if (!nav.disabled) { cur.ym = shiftYm(cur.ym, +nav.getAttribute('data-pk-nav')); renderCal(); } return; }
  var d = t.closest('[data-pk-day]');
  if (d) { if (!d.disabled) pick(d.getAttribute('data-pk-day')); return; }
  var r = t.closest('[data-pk-val]');
  if (r) pick(r.getAttribute('data-pk-val'));
}

// ---------- календарь ----------
// Р20 ревью 15.10: сдвиг месяца - тот же Engine.addMonths (engine.js грузится раньше picker.js)
function shiftYm(ym, k) { return Engine.addMonths(ym, k); }
function calHtml(ym, o) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
  var t = today(), max = isDate(o.max) ? o.max : null, min = isDate(o.min) ? o.min : null;
  var canPrev = !min || shiftYm(ym, -1) >= min.slice(0, 7);
  var canNext = !max || shiftYm(ym, 1) <= max.slice(0, 7);
  var h = '<div class="pk-nav">' +
    '<button type="button" class="pk-arr" data-pk-nav="-1" aria-label="Предыдущий месяц"' + (canPrev ? '' : ' disabled') + '>‹</button>' +
    '<div class="pk-month" id="pkMonth">' + MONTHS[m] + ' ' + y + '</div>' +
    '<button type="button" class="pk-arr" data-pk-nav="1" aria-label="Следующий месяц"' + (canNext ? '' : ' disabled') + '>›</button></div>' +
    '<div class="pk-cal" role="grid">';
  WD.forEach(function (w, i) { h += '<span class="pk-wd' + (i > 4 ? ' we' : '') + '">' + w + '</span>'; });
  var first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  for (var i = 0; i < lead; i++) h += '<span class="pk-e"></span>';
  for (var d = 1; d <= days; d++) {
    var v = ym + '-' + pad2(d);
    var off = (max && v > max) || (min && v < min);
    h += '<button type="button" class="pk-d' + (v === t ? ' today' : '') + (v === o.value ? ' on' : '') + '" data-pk-day="' + v + '"' +
      (off ? ' disabled' : '') + ' aria-label="' + d + ' ' + MONTHS[m].toLowerCase() + '">' + d + '</button>';
  }
  return h + '</div>';
}
function renderCal() { $('pkBody').innerHTML = calHtml(cur.ym, cur.o); }
function date(o) {
  o = o || {};
  var t = today();
  var start = isDate(o.value) ? o.value : (isDate(o.max) && o.max < t ? o.max : t);
  cur = { kind: 'date', o: o, ym: start.slice(0, 7) };
  var btns = [];
  if (o.optional && isDate(o.value)) btns.push(['clear', 'Очистить', 'nav']);
  else btns.push(['cancel', 'Отмена', 'nav']);
  var todayOk = !(isDate(o.max) && t > o.max) && !(isDate(o.min) && t < o.min);
  if (todayOk) btns.push(['today', 'Сегодня', 'ghost']);
  show(o.title || 'Выберите дату', calHtml(cur.ym, o), btns);
}

// ---------- список ----------
function list(o) {
  o = o || {};
  cur = { kind: 'list', o: o };
  var body = '<div class="set-list pk-list">' + (o.items || []).map(function (it) {
    var on = String(it.value) === String(o.value);
    return '<button type="button" class="set-row pk-row' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-pk-val="' + esc(it.value) + '">' +
      '<span class="set-tx"><span class="set-t">' + esc(it.label) + '</span>' + (it.sub ? '<span class="set-s">' + esc(it.sub) + '</span>' : '') + '</span>' +
      '<span class="db-rd" aria-hidden="true"></span></button>';
  }).join('') + '</div>';
  show(o.title || 'Выберите', body, [['cancel', 'Отмена', 'nav']]);
}

// ---------- поля форм ----------
function dateField(f) {
  f = f || {};
  var v = isDate(f.value) ? f.value : '';
  return '<button type="button" class="inp pk-f pk-fd' + (v ? '' : ' empty') + '" id="' + esc(f.id) + '" value="' + esc(v) + '"' +
    (f.max ? ' data-max="' + esc(f.max) + '"' : '') + (f.min ? ' data-min="' + esc(f.min) + '"' : '') +
    (f.optional ? ' data-opt="1"' : '') + ' data-title="' + esc(f.title || 'Выберите дату') + '"' +
    ' data-ph="' + esc(f.ph || 'Не выбрана') + '">' + esc(v ? dateLabel(v) : (f.ph || 'Не выбрана')) + '</button>';
}
function listField(f) {
  f = f || {};
  var items = f.items || [], v = f.value == null ? '' : String(f.value);
  var it = items.filter(function (x) { return String(x.value) === v; })[0];
  return '<button type="button" class="inp pk-f pk-fl" ' + (f.id ? 'id="' + esc(f.id) + '" ' : '') + (f.attrs || '') +
    ' value="' + esc(it ? it.value : '') + '" data-title="' + esc(f.title || 'Выберите') + '"' +
    ' data-items="' + esc(JSON.stringify(items)) + '">' + esc(it ? it.label : '') + '</button>';
}
function setField(el, v) {
  el.value = v;
  if (el.classList.contains('pk-fd')) {
    el.textContent = v ? dateLabel(v) : (el.getAttribute('data-ph') || '');
    el.classList.toggle('empty', !v);
  } else {
    var items = []; try { items = JSON.parse(el.getAttribute('data-items') || '[]'); } catch (e) {}
    var it = items.filter(function (x) { return String(x.value) === String(v); })[0];
    el.textContent = it ? it.label : '';
  }
  var ev; try { ev = new Event('change', { bubbles: true }); } catch (e) { ev = document.createEvent('Event'); ev.initEvent('change', true, false); }
  el.dispatchEvent(ev);
}
// тап по полю - своё окно (делегирование: поля рождаются в innerHTML окон)
document.addEventListener('click', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('.pk-f') : null;
  if (!el || el.disabled) return;
  e.preventDefault();
  if (el.classList.contains('pk-fd')) {
    date({ value: el.value, max: el.getAttribute('data-max') || null, min: el.getAttribute('data-min') || null,
      optional: el.getAttribute('data-opt') === '1', title: el.getAttribute('data-title'),
      onPick: function (v) { setField(el, v); } });
  } else {
    var items = []; try { items = JSON.parse(el.getAttribute('data-items') || '[]'); } catch (er) {}
    list({ title: el.getAttribute('data-title'), items: items, value: el.value, onPick: function (v) { setField(el, v); } });
  }
});

window.Picker = { date: date, list: list, close: close, isOpen: isOpen,
  dateField: dateField, listField: listField, setField: setField, dateLabel: dateLabel };
})();
