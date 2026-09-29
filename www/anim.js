/* anim.js — анимации изменения баланса: одометр цифр, летящая фишка, всплывающая дельта
   и плавный уровень заливки кружка. Грузится после ui.js/edit.js, работает через window.UI.

   Такт всей сцены ≈ 1,6 с: фишка летит по дуге 650 мс, на прилёте одновременно стартуют
   дельта (1000 мс), одометр (900 мс) и заливка (600 мс). Только transform/opacity,
   ничего бесконечного, никаких setInterval; каждый таймер снимается сам.
   При prefers-reduced-motion не создаётся ни одного элемента — числа встают сразу. */
(function () {
'use strict';

var UI = window.UI;

var ODO_MS = 900;     // одометр: цифры должны успеть прокрутиться на глаз
var FLY_MS = 650;     // полёт фишки
var DELTA_MS = 1000;  // всплывающая дельта
var FILL_MS = 600;    // подъём заливки кружка
var POP_MS = 150;     // «клевок» кольца-цели
var ODO_STEP = 60;    // разбег между разрядами одометра
var EASE = 'cubic-bezier(.16,.84,.28,1)';

var running = 0;      // сколько анимаций сейчас в работе (для self-test)

function reduced() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

// жетон одной анимации: снимается ровно один раз — по событию либо по страховочному таймеру
// (событие может не прийти, если элемент убрали из документа; счётчик тогда завис бы навсегда)
function track(ms, onEnd) {
  var t = { done: false, timer: null, extra: [] };
  running++;
  t.end = function () {
    if (t.done) return;
    t.done = true;
    clearTimeout(t.timer); t.timer = null;
    for (var i = 0; i < t.extra.length; i++) clearTimeout(t.extra[i]);
    t.extra.length = 0;
    running--;
    if (onEnd) onEnd();
  };
  // отложенный шаг внутри той же анимации: гасится вместе с жетоном
  t.after = function (ms2, fn) {
    if (!(ms2 > 0)) { if (!t.done) fn(); return; }
    t.extra.push(setTimeout(function () { if (!t.done) fn(); }, ms2));
  };
  t.timer = setTimeout(t.end, ms);
  return t;
}

// центр «головы» плитки в координатах экрана: у категории это кольцо/квадрат,
// у кошелька — вся жёлтая карточка (кольца в ней нет)
function ringBox(el) {
  if (!el || !el.querySelector) return null;
  var r = el.querySelector('.ring') || el;
  var b = r.getBoundingClientRect();
  if (!b.width || !b.height) return null;
  return { ring: r, top: b.top, height: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
}

// ---------- одометр ----------
// Подпись элемента сразу становится конечной (снимки ui.js читают textContent),
// а прокрутка цифр идёт наложением поверх — колонкой цифр под clip'ом.
function stopOdo(el) {
  if (el.__odoTk) { var t = el.__odoTk; el.__odoTk = null; t.end(); }
}

// последовательность цифр от a к b: вверх при росте, вниз при убыли
function digitFrames(a, b, up) {
  var seq = [a], d = a;
  for (var i = 0; i < 10 && d !== b; i++) { d = up ? (d + 1) % 10 : (d + 9) % 10; seq.push(d); }
  return seq;
}

function odoOverlay(el, s0, s1, ms, delay) {
  var box = el.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  var cs = window.getComputedStyle(el);
  var fs = parseFloat(cs.fontSize) || 14;
  var h = Math.ceil(fs * 1.25);
  var up = digitsOf(s1) >= digitsOf(s0);

  var ov = document.createElement('div');
  ov.className = 'odo';
  ov.setAttribute('aria-hidden', 'true');
  ov.style.cssText = 'position:fixed;z-index:54;pointer-events:none;overflow:hidden;' +
    'display:flex;align-items:center;white-space:nowrap;' +
    'left:' + box.left + 'px;top:' + box.top + 'px;width:' + box.width + 'px;height:' + box.height + 'px;' +
    'justify-content:' + (cs.textAlign === 'right' ? 'flex-end' : cs.textAlign === 'left' || cs.textAlign === 'start' ? 'flex-start' : 'center') + ';';
  ov.style.font = cs.font && cs.font !== '' ? cs.font : (cs.fontWeight + ' ' + cs.fontSize + '/' + h + 'px ' + cs.fontFamily);
  ov.style.fontWeight = cs.fontWeight;
  ov.style.letterSpacing = cs.letterSpacing;
  ov.style.color = cs.color;
  ov.style.fontVariantNumeric = cs.fontVariantNumeric;

  // цифры s1 справа налево сопоставляются с цифрами s0; чего не хватило — крутится от нуля
  var old = String(s0).replace(/\D/g, '');
  var newd = String(s1).replace(/\D/g, '');
  var seen = 0, cols = [];
  for (var i = 0; i < s1.length; i++) {
    var ch = s1.charAt(i);
    var cell;
    if (ch >= '0' && ch <= '9') {
      seen++;
      var fromIdx = old.length - (newd.length - seen + 1);
      var a = fromIdx >= 0 ? +old.charAt(fromIdx) : 0;
      var b = +ch;
      cell = document.createElement('span');
      cell.style.cssText = 'display:block;overflow:hidden;height:' + h + 'px;';
      var col = document.createElement('span');
      col.style.cssText = 'display:block;will-change:transform;';
      var frames = digitFrames(a, b, up);
      if (!up) frames.reverse();
      for (var k = 0; k < frames.length; k++) {
        var d = document.createElement('span');
        d.style.cssText = 'display:block;height:' + h + 'px;line-height:' + h + 'px;';
        d.textContent = String(frames[k]);
        col.appendChild(d);
      }
      var span = (frames.length - 1) * h;
      cell.appendChild(col);
      cols.push({ col: col, from: up ? 0 : -span, to: up ? -span : 0 });
    } else {
      cell = document.createElement('span');
      cell.style.cssText = 'display:block;height:' + h + 'px;line-height:' + h + 'px;' +
        (ch === ' ' ? 'width:.3em;' : '');
      cell.textContent = ch === ' ' ? ' ' : ch;
    }
    ov.appendChild(cell);
  }
  document.body.appendChild(ov);

  // разряды трогаются с разбегом: младшие успокаиваются первыми, старший идёт дольше всех
  for (var c = 0; c < cols.length; c++) {
    var o = cols[c];
    o.col.style.transform = 'translateY(' + o.from + 'px)';
    if (o.from === o.to) continue;
    o.col.animate(
      [{ transform: 'translateY(' + o.from + 'px)' }, { transform: 'translateY(' + o.to + 'px)' }],
      // при длинном числе разбег разрядов съедал всю длительность и уходил в минус
      // (Web Animations на отрицательной duration бросает) — держим пол в 120 мс
      { duration: Math.max(120, ms - (cols.length - 1 - c) * ODO_STEP), delay: delay, easing: EASE, fill: 'both' }
    );
  }
  return ov;
}

function digitsOf(s) {
  var n = parseFloat(String(s).replace(/−/g, '-').replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

function odometer(el, from, to, ms, delay) {
  if (!el) return;
  ms = ms > 0 ? ms : ODO_MS;
  delay = delay > 0 ? delay : 0;
  stopOdo(el);
  // в шапке числа идут без валюты (data-suf=""), на плитках — с « ₽»
  var suf = el.getAttribute('data-suf');
  if (suf === null) suf = ' ₽';
  var end = UI.fmt(to) + suf;
  el.textContent = end;                       // настоящая подпись всегда верная
  if (reduced() || from === to || !isFinite(from) || !isFinite(to)) return;
  if (!el.animate) return;                    // без Web Animations просто ставим число
  var ov = odoOverlay(el, UI.fmt(from) + suf, end, ms, delay);
  if (!ov) return;
  var vis = el.style.visibility;
  el.style.visibility = 'hidden';             // подменяем подпись накладкой на время прокрутки
  var tk = track(delay + ms + 250, function () {
    el.style.visibility = vis;
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    el.__odoTk = null;
  });
  el.__odoTk = tk;
  live.push({ el: el, tk: tk });
}

// накладки одометра: если перерисовка выкинула подпись из документа, снимаем накладку
// сразу — иначе она повисит над уже новыми числами
var live = [];
function dropStale() {
  for (var i = live.length - 1; i >= 0; i--) {
    var r = live[i];
    if (r.tk.done) { live.splice(i, 1); continue; }
    if (!document.body.contains(r.el)) { live.splice(i, 1); r.tk.end(); }
  }
}
var prevAfterRender = UI.afterRender;
UI.afterRender = function () {
  dropStale();
  if (prevAfterRender) prevAfterRender();
};

// ---------- уровень заливки плитки ----------
// el — это .ring; заливку (2a) и кольцо (2b) внутри него двигает UI.applyFill.
// Рендер уже поставил конечный уровень: откатываем на прежний без перехода,
// держим его до прилёта фишки и только потом отпускаем к конечному.
function fillParts(ring) {
  var out = [];
  var f = ring.querySelector('.tfill'); if (f) out.push(f);
  var a = ring.querySelector('.arc'); if (a) out.push(a);
  return out;
}
function animFill(ring, from, to, delay) {
  if (!ring || reduced() || !isFinite(from) || !isFinite(to)) return;
  var parts = fillParts(ring);
  parts.forEach(function (p) { p.style.transition = 'none'; });
  UI.applyFill(ring, from / 100);
  ring.getBoundingClientRect();                          // reflow: прежний уровень зафиксирован
  var tk = track((delay || 0) + FILL_MS + 250, function () {
    parts.forEach(function (p) { p.style.transition = ''; p.style.willChange = ''; });
  });
  tk.after(delay || 0, function () {
    parts.forEach(function (p) {
      p.style.willChange = 'transform, stroke-dashoffset';
      p.style.transition = 'transform ' + FILL_MS + 'ms cubic-bezier(.2,.8,.2,1), stroke-dashoffset ' + FILL_MS + 'ms cubic-bezier(.2,.8,.2,1)';
    });
    requestAnimationFrame(function () {
      if (!tk.done) UI.applyFill(ring, to / 100);
    });
  });
}

// ---------- летящая фишка ----------
function pop(ring) {
  if (!ring || reduced()) return;
  ring.classList.remove('pop');
  void ring.offsetWidth;                                 // перезапуск анимации, если класс ещё висел
  ring.classList.add('pop');
  var tk = track(POP_MS + 250, function () { ring.classList.remove('pop'); });
  ring.addEventListener('animationend', function h(e) {
    if (e.animationName !== 'pop') return;
    ring.removeEventListener('animationend', h);
    tk.end();
  });
}

// фишка идёт по дуге: середина пути приподнята, к цели фишка ужимается
function flyChip(fromEl, toEl, text, cls) {
  var a = ringBox(fromEl), b = ringBox(toEl);
  if (!a || !b) return false;                            // один из кружков не на экране — фишку пропускаем
  var d = document.createElement('div');
  d.className = 'flychip ' + cls;
  d.textContent = text;
  document.body.appendChild(d);
  d.style.left = (a.cx - d.offsetWidth / 2) + 'px';
  d.style.top = (a.cy - d.offsetHeight / 2) + 'px';
  d.style.transition = 'none';
  d.style.willChange = 'transform, opacity';
  var dx = b.cx - a.cx, dy = b.cy - a.cy;
  var lift = Math.max(26, Math.min(70, Math.abs(dx) * 0.22 + 26));   // подъём дуги
  var tk = track(FLY_MS + 250, function () {
    if (d.parentNode) d.parentNode.removeChild(d);
    pop(b.ring);
  });
  if (!d.animate) { tk.end(); return false; }   // без Web Animations фишку не показываем
  var an = d.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
    { transform: 'translate(' + (dx * 0.5) + 'px,' + (dy * 0.5 - lift) + 'px) scale(1.06)', opacity: 1, offset: .5 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.55)', opacity: 0, offset: 1 }
  ], { duration: FLY_MS, easing: 'cubic-bezier(.34,.15,.3,1)', fill: 'forwards' });
  an.onfinish = function () { tk.end(); };
  return true;
}

// ---------- всплывающая дельта ----------
// стартует внутри кольца кошелька (по центру, чуть выше иконки) и всплывает
// всего на 14px — не должна вылезать в строку доходов над кошельками
function floatDelta(el, text, cls, delay) {
  var a = ringBox(el);
  if (!a) return;
  var d = document.createElement('div');
  d.className = 'delta ' + cls;
  d.textContent = text;
  d.style.animationDuration = DELTA_MS + 'ms';
  d.style.animationDelay = (delay || 0) + 'ms';
  d.style.animationFillMode = 'forwards';
  d.style.opacity = '0';                      // до прилёта фишки дельты не видно
  document.body.appendChild(d);
  var y = a.cy - a.height * 0.18;
  d.style.left = (a.cx - d.offsetWidth / 2) + 'px';
  d.style.top = (y - d.offsetHeight / 2) + 'px';
  d.style.willChange = 'transform, opacity';
  var tk = track((delay || 0) + DELTA_MS + 250, function () { if (d.parentNode) d.parentNode.removeChild(d); });
  d.addEventListener('animationend', function (e) {
    if (e.animationName === 'floatUp') tk.end();
  });
}

// ---------- связки ----------
// render() присылает изменившиеся числа и заливки ДО animateTx (оба в одном такте),
// поэтому старт откладываем на следующий тик: к нему уже известно, летит ли фишка.
var pending = null, pendingTimer = null, flightArmed = false;

function startChanges(changes, delay) {
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    if (c.type === 'fill') animFill(c.el, c.from, c.to, delay);
    else odometer(c.el, c.from, c.to, ODO_MS, delay);
  }
}

function flush() {
  pendingTimer = null;
  var ch = pending; pending = null;
  var delay = flightArmed ? FLY_MS : 0;      // числа ждут прилёта фишки
  flightArmed = false;
  if (ch && ch.length) startChanges(ch, delay);
}

UI.onValuesChanged = function (changes) {
  if (reduced()) { startChanges(changes, 0); return; }
  pending = pending ? pending.concat(changes) : changes.slice();
  if (!pendingTimer) pendingTimer = setTimeout(flush, 0);
};

// фишка и дельта поверх новой картинки; числа и заливка подхватятся на её прилёте
UI.animateTx = function (tx, fromEl, toEl) {
  if (!tx || reduced()) return;
  var t = UI.fmt(tx.amount), flew;
  if (tx.kind === 'exp') {
    flew = flyChip(fromEl, toEl, '−' + t, 'neg');
    if (flew) flightArmed = true;
    floatDelta(fromEl, '−' + t, 'neg', flew ? FLY_MS : 0);   // кошелёк — источник расхода
  } else if (tx.kind === 'inc') {
    flew = flyChip(fromEl, toEl, '+' + t, 'pos');
    if (flew) flightArmed = true;
    floatDelta(toEl, '+' + t, 'pos', flew ? FLY_MS : 0);     // кошелёк — цель дохода
  }
  // перевод: только одометры, фишки и дельты не нужны — деньги остались при своих
};

UI.odometer = odometer;
UI.animActive = function () { return running; };

})();
