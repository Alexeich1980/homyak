/* edit.js — режим редактирования: вход по долгому тапу, перестановка плиток внутри своего
   поля, правка иконки/названия/баланса, список кошельков и выбор месяца.
   Работает поверх window.UI (ui.js), грузится после него. */
(function () {
'use strict';

var UI = window.UI;
function $(id) { return document.getElementById(id); }
function esc(s) { return UI.esc(s); }
function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
function num(v) { return Engine.parseNum(v); }
function showErr(id, msg) { var el = $(id); if (el) { el.textContent = msg; el.hidden = false; } }

// ---------- вход и выход из режима ----------
var wiggleTimer = null;

// Ситуативная подсказка режима правки: фиксированный баннер #editHint, живёт только пока
// включён режим. Один раз, гасится свайпом (привязан ниже, один раз), подчиняется выключателю.
function updateEditHint() {
  var el = $('editHint');
  if (!el) return;
  el.hidden = !(document.body.classList.contains('editmode') && UI.hintShouldShow('edit'));
}

function enterEdit() {
  if (document.body.classList.contains('editmode')) return;
  document.body.classList.add('editmode');
  $('editBar').hidden = false;
  // однократная «дрожь» на входе: 300 мс, iteration-count 1, класс снимаем по таймеру
  document.body.classList.add('editenter');
  clearTimeout(wiggleTimer);
  wiggleTimer = setTimeout(function () { document.body.classList.remove('editenter'); }, 320);
  updateEditHint();
  // главная подсказка в режиме правки не показывается (mainHintKey это знает), но
  // перечитать её надо здесь, иначе #mainHint и #editHint рисовались бы в одной плашке
  if (UI.updateMainHint) UI.updateMainHint();
  relayout();
}

function exitEdit() {
  if (!document.body.classList.contains('editmode')) return;
  endReorder();
  document.body.classList.remove('editmode', 'editenter');
  clearTimeout(wiggleTimer); wiggleTimer = null;
  $('editBar').hidden = true;
  updateEditHint();
  if (UI.updateMainHint) UI.updateMainHint();
  relayout();
  UI.haptic('light');
}

// #editBar стоит в потоке #app и забирает высоту у поля расходов: просим оболочку
// пересчитать сетку тем же путём, что и на повороте экрана
function relayout() { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }

// ---------- перестановка ----------
var rd = null;   // {el, kind, field, pid, x, y, active, ghost, gw, gh}

// призрак — клон самой плитки; сам клон делает UI.makeGhost (один на приложение),
// здесь только запоминаем размеры для позиционирования под пальцем
function makeGhost(el) {
  var g = UI.makeGhost(el);
  rd.gw = g.w; rd.gh = g.h;
  return g.el;
}

function circleAt(x, y) {
  if (rd.ghost) rd.ghost.style.visibility = 'hidden';
  var el = document.elementFromPoint(x, y);
  if (rd.ghost) rd.ghost.style.visibility = '';
  var c = (el && el.closest) ? el.closest('.circle') : null;
  if (!c || c === rd.el || c.classList.contains('dragghost')) return null;
  if (!Engine.reorderAllowed(rd.kind, c.dataset.kind)) return null;   // не свой вид — не пускаем
  if (c.closest('.field') !== rd.field) return null;                  // и не чужое поле (заслон вдвойне)
  return c;
}

// ---------- плавная перестановка (FLIP) ----------
// Раньше соседи прыгали: плитка вставлялась в DOM, и всё поле мгновенно
// перекладывалось. Теперь FLIP: до перекладки меряем, где КАЖДЫЙ сосед стоит НА ЭКРАНЕ
// (getBoundingClientRect — с учётом уже идущего перехода), после перекладки сажаем его
// сдвигом обратно на прежнее видимое место и отпускаем — браузер доводит его за
// REORDER_MS. Призрак едет за пальцем, а на броске садится в ячейку за SETTLE_MS.
//
// Мерять «до и после» каждой перекладки (а не по одному снимку на старте) — заслон от
// мельтешения: если палец гоняет плитку туда-сюда быстрее, чем доигрывает анимация,
// прежний снимок «offsetLeft на старте» врал, и соседи прыгали на целую ячейку. Теперь
// начальная точка перехода всегда там, где сосед реально виден, — прерывание бесшовно.
// Прокрутка полю в этот момент не мешает: на время переноса у .pages/.strip
// overflow:hidden, лента стоит.
var REORDER_MS = 160, SETTLE_MS = 200;

function lessMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

// перекладываем DOM (mutate) и доводим соседей FLIP-ом от их текущего вида к новому
function flipMove(mutate) {
  if (!rd || lessMotion()) { mutate(); return; }
  var els = all(rd.field, '.circle').filter(function (e) { return e !== rd.el; });
  var fx = [], fy = [];
  els.forEach(function (e) { var r = e.getBoundingClientRect(); fx.push(r.left); fy.push(r.top); });
  mutate();
  // Last: гасим transform от прерванной анимации и меряем «голое» новое место
  els.forEach(function (e) { e.style.transition = 'none'; e.style.transform = ''; });
  void rd.field.offsetWidth;
  var moved = [];
  els.forEach(function (e, i) {
    var r = e.getBoundingClientRect();
    var dx = fx[i] - r.left, dy = fy[i] - r.top;
    if (dx || dy) { e.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; moved.push(e); }
  });
  void rd.field.offsetWidth;
  moved.forEach(function (e) {
    e.style.transition = 'transform ' + REORDER_MS + 'ms cubic-bezier(.2,.8,.2,1)';
    e.style.transform = '';
  });
}

function flipClear(field) {
  if (field) all(field, '.circle').forEach(function (e) { e.style.transition = ''; e.style.transform = ''; });
}

// вставляем перетаскиваемый кружок до или после соседа — по СТОРОНЕ пальца от центра
// цели, а не по порядку в документе. Порядок документа после перекладки переворачивался
// сам на себя (сосед уезжал под палец), и вставка щёлкала туда-сюда каждый кадр —
// отсюда и дрожь. Сторона пальца стабильна: пока палец на своей половине, вставка
// идемпотентна и соседей не трогает.
function place(t, x, y) {
  // Заслон на самом месте вставки: даже если сюда как-то прилетела чужая цель (гонка
  // hit-test после перелистывания страницы, перерисовки и т.п.), плитку в чужое поле
  // не переносим - барьер дохода/расхода/кошелька должен держаться и здесь, а не только
  // в circleAt. Иначе доход мог бы физически уехать из #fieldInc.
  if (!Engine.reorderAllowed(rd.kind, t.dataset.kind)) return;
  if (t.closest('.field') !== rd.field) return;
  var horizontal = !!rd.field.querySelector('.strip');   // лента кошельков — по X, сетки — по строкам
  var r = t.getBoundingClientRect();
  var after = horizontal
    ? x >= r.left + r.width / 2
    : (y > r.bottom ? true : (y < r.top ? false : x >= r.left + r.width / 2));
  var ref = after ? t.nextSibling : t;
  if (ref === rd.el) return;                              // «после» самого источника — двигать некуда
  if (rd.el.parentNode === t.parentNode && rd.el.nextSibling === ref) return;
  // Лента кошельков нарезана страницами по четыре: вставка в чужую страницу делает
  // в ней пять карточек, а в соседней три. Выравниваем ТУТ ЖЕ, внутри одной перекладки,
  // чтобы FLIP довёл и переехавшего соседа - лента ведёт себя как сплошной список.
  flipMove(function () {
    t.parentNode.insertBefore(rd.el, ref);
    if (horizontal) UI.balanceStrip(rd.field.querySelector('.strip'));
  });
}

// ---------- край поля: перелистнуть страницу ----------
// Плитку с первой страницы на вторую раньше было не перетащить: страница не едет,
// а бросить некуда. Теперь палец, задержавшийся у края поля, сам листает. Лента
// кошельков листается так же, как сетки: целой страницей по четыре карточки, а не
// подкруткой по пикселям — страницы у неё теперь настоящие.
var EDGE_PAD = 24;     // насколько близко к краю надо держать палец
var EDGE_HOLD = 500;   // сколько держать, чтобы страница перевернулась

// Чистая функция: -1 — палец у левого края, 1 — у правого, 0 — посередине.
// Её же проверяет self-test, поэтому она не трогает ни DOM, ни таймеры.
function edgeSide(x, rect, pad) {
  if (!rect || !(rect.width > 0)) return 0;
  if (typeof pad !== 'number') pad = EDGE_PAD;
  if (x <= rect.left + pad) return -1;
  if (x >= rect.right - pad) return 1;
  return 0;
}

var eh = null;   // {side, timer, raf} — держится, только пока палец у края

function edgeStop() {
  if (!eh) return;
  clearTimeout(eh.timer);
  if (eh.raf) { try { cancelAnimationFrame(eh.raf); } catch (e) {} }
  eh = null;
}

// перелистываем той же лентой, что и палец: scroll-snap сам доводит страницу
function flipPage(box, side) {
  var w = box.clientWidth;
  if (!w) return;
  var to = Math.max(0, Math.min(box.scrollWidth - w, Math.round(box.scrollLeft / w) * w + side * w));
  if (Math.abs(to - box.scrollLeft) < 2) return;          // дальше листать некуда
  try { box.scrollTo({ left: to, behavior: 'smooth' }); }
  catch (e) { box.scrollLeft = to; }
  UI.haptic('light');
  // FLIP теперь меряет соседей «до и после» каждой перекладки, снимок сбрасывать нечего:
  // после переворота страницы следующая вставка сама возьмёт актуальные координаты.
}

function edgeWatch(x) {
  if (!rd || !rd.active) return edgeStop();
  var strip = rd.field.querySelector('.strip');
  var box = strip || rd.field.querySelector('.pages');
  if (!box) return edgeStop();
  var side = edgeSide(x, box.getBoundingClientRect());
  if (!side) return edgeStop();
  if (eh && eh.side === side) return;                     // уже ждём с этой стороны
  edgeStop();
  eh = { side: side, timer: null, raf: 0 };
  eh.timer = setTimeout(function () {
    flipPage(box, side);
    edgeStop();            // перевернули - ждём, пока палец зайдёт к краю заново
  }, EDGE_HOLD);
}

function endReorder() {
  edgeStop();
  if (!rd) return;
  if (rd.ghost && rd.ghost.parentNode) rd.ghost.parentNode.removeChild(rd.ghost);
  flipClear(rd.field);
  rd.el.classList.remove('reordering');
  try { rd.el.releasePointerCapture(rd.pid); } catch (e) {}
  document.body.classList.remove('dragging');
  rd = null;
}

function commitOrder(field, kind) {
  var ids = all(field, '.circle').map(function (c) { return c.dataset.id; });
  if (kind === 'wallet') {
    // скрытые кошельки в DOM не попадают — дописываем их в хвост, иначе order столкнётся
    UI.S.wallets.forEach(function (w) { if (ids.indexOf(w.id) < 0) ids.push(w.id); });
    Engine.reorder(UI.S, 'wallets', ids);
  } else {
    Engine.reorder(UI.S, kind, ids);
  }
  UI.save(); UI.render(); UI.haptic('medium');
}

function onEditPointerDown(e, c) {
  if (rd) return;                                  // палец уже отслеживается
  // палец лёг на карандаш - это не перестановка, а «открой форму этой плитки»
  var pencil = !!(e.target && e.target.closest && e.target.closest('.tedit'));
  rd = { el: c, kind: c.dataset.kind, field: c.closest('.field'), pid: e.pointerId,
    x: e.clientX, y: e.clientY, active: false, ghost: null, gw: 0, gh: 0, pencil: pencil };
}

document.addEventListener('pointermove', function (e) {
  if (!rd || e.pointerId !== rd.pid) return;
  if (rd.pencil) return;                           // с карандаша плитку не тащим
  var dx = e.clientX - rd.x, dy = e.clientY - rd.y;
  if (!rd.active) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    rd.active = true;
    rd.ghost = makeGhost(rd.el);
    // отклик касания снимаем сразу: иначе приподнятая (is-pressed/is-lifted) и
    // приглушённая (reordering) плитка тянут два перехода разом — источник дрожи
    rd.el.classList.remove('is-pressed', 'is-lifted');
    rd.el.classList.add('reordering');
    document.body.classList.add('dragging');
    UI.haptic('light');
    try { rd.el.setPointerCapture(e.pointerId); } catch (x) {}
  }
  rd.ghost.style.transform = 'translate(' + (e.clientX - rd.gw / 2) + 'px,' + (e.clientY - rd.gh / 2) + 'px)';
  edgeWatch(e.clientX);
  var t = circleAt(e.clientX, e.clientY);
  if (t) place(t, e.clientX, e.clientY);
}, { passive: true });

// Призрак садится в свою ячейку, а не гаснет под пальцем: 200 мс от места броска до
// плитки, и только потом перерисовка с новым порядком. Без этого перенос заканчивался
// щелчком: призрак пропадал в одном месте, плитка появлялась в другом.
function settleGhost(ghost, el, done) {
  var r = el.getBoundingClientRect();
  ghost.style.transition = 'transform ' + SETTLE_MS + 'ms cubic-bezier(.2,.8,.2,1)';
  ghost.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px)';
  el.classList.add('reordering');                  // плитка под призраком ещё приглушена
  setTimeout(function () {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    el.classList.remove('reordering');
    done();
  }, SETTLE_MS);
}

document.addEventListener('pointerup', function (e) {
  if (!rd || e.pointerId !== rd.pid) return;
  var active = rd.active, el = rd.el, kind = rd.kind, field = rd.field, pencil = rd.pencil;
  var still = Math.abs(e.clientX - rd.x) < 8 && Math.abs(e.clientY - rd.y) < 8;
  var ghost = rd.ghost;
  if (active && ghost && !lessMotion()) {
    rd.ghost = null;                               // endReorder его больше не трогает
    endReorder();
    settleGhost(ghost, el, function () { commitOrder(field, kind); });
    return;
  }
  endReorder();
  if (pencil) { editCircle({ kind: kind, id: el.dataset.id }); return; }
  if (active) { commitOrder(field, kind); return; }
  if (still) editCircle({ kind: kind, id: el.dataset.id });   // короткий тап в режиме = правка кружка
});

document.addEventListener('pointercancel', function (e) {
  if (!rd || e.pointerId !== rd.pid) return;
  endReorder();
});

// ---------- лист выбора иконки ----------
// Простыня из полусотни иконок раньше жила прямо в форме и вытесняла с экрана и
// название, и баланс. Теперь в форме одна выбранная иконка и кнопка «Изменить»,
// а сетка выезжает отдельным листом ПОВЕРХ формы (свой фон и z-index) — форма при
// этом цела и по выбору просто перерисовывает превью.
var icOnPick = null;

// сначала иконки своего вида, потом все остальные: для дохода нужное не в самом низу.
// Кошелёк — исключение: у него показываем ТОЛЬКО кошельковый набор, без добора
// категорийных иконок (иначе в выборе кошелька мелькали бы еда/такси и пр.).
function icOrder(kind) {
  if (kind === 'wallet') return Icons.list('wallet');
  var out = Icons.list(kind), seen = {};
  out.forEach(function (n) { seen[n] = 1; });
  Icons.NAMES.forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } });
  return out;
}

function openIconSheet(o) {
  o = o || {};
  var cur = o.cur || '';
  icOnPick = o.onPick || null;
  $('icTitle').textContent = o.title || 'Иконка';
  // Кошельки выбирают из линейных глифов, доходы и расходы — из цветных иллюстраций
  // (тех самых, что потом окажутся на плитке).
  var wal = o.kind === 'wallet';
  $('icGrid').innerHTML = icOrder(o.kind).map(function (n) {
    return '<button type="button" class="icbtn' + (n === cur ? ' on' : '') + '" data-ic="' + n +
      '" aria-label="' + esc(Icons.LABELS[n] || n) + '"' + (n === cur ? ' aria-pressed="true"' : '') + '>' +
      (wal ? Icons.svg(n, 22) : Icons.img(n, o.kind, 26)) + '</button>';
  }).join('');
  $('icBg').hidden = false;
  $('icSheet').hidden = false;
  UI.haptic('light');
}

function closeIconSheet() {
  $('icSheet').hidden = true;
  $('icBg').hidden = true;
  $('icGrid').innerHTML = '';
  icOnPick = null;
}
function iconSheetOpen() { return !$('icSheet').hidden; }

// тап по иконке = выбрал и закрыл: второй кнопки «Готово» тут не нужно
$('icGrid').addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('.icbtn') : null;
  if (!b) return;
  var fn = icOnPick, n = b.getAttribute('data-ic');
  closeIconSheet();
  UI.haptic('light');
  if (fn) fn(n);
});
$('icClose').addEventListener('click', closeIconSheet);
UI.bindBackdropClose($('icBg'), closeIconSheet);
// Своего обработчика Escape тут нет и не нужно: лист иконок — обычный слой в общей
// стопке ui.js, и Escape разматывает её сверху вниз (icons → dialog → …). Прежний
// слушатель был мёртвым: ui.js висит на том же document и срабатывает раньше, а
// stopPropagation соседей по одному узлу не глушит.

// ---------- строка «иконка + Изменить» и палитра цветов ----------
// kind: 'wallet' - линейный глиф, 'inc'/'exp' - цветная иллюстрация
function icoRowHtml(id, icon, colorCls, kind) {
  var g = (!kind || kind === 'wallet') ? Icons.svg(icon, 22) : Icons.img(icon, kind, 26);
  return '<div class="icrow">' +
    '<span class="icprev ' + (colorCls || '') + '" id="' + id + '" aria-hidden="true">' + g + '</span>' +
    '<button class="btn ghost icchg" type="button" id="' + id + 'Btn">Изменить</button>' +
  '</div>';
}

var COLOR_LABELS = {
  yellow: 'Жёлтый', red: 'Красный', green: 'Зелёный', blue: 'Синий', white: 'Белый',
  orange: 'Оранжевый', purple: 'Фиолетовый', teal: 'Бирюзовый', pink: 'Розовый', graphite: 'Графит'
};

function colorsHtml(id, cur) {
  return '<div class="cgrid" id="' + id + '" role="group" aria-label="Цвет кошелька">' +
    Engine.WALLET_COLORS.map(function (c) {
      return '<button type="button" class="cw wc-' + c + (c === cur ? ' on' : '') + '" data-c="' + c +
        '" aria-label="' + COLOR_LABELS[c] + '"' + (c === cur ? ' aria-pressed="true"' : '') + '></button>';
    }).join('') + '</div>';
}

// ---------- правка кружка ----------
function editCircle(o) {
  if (!o || !o.id) return;
  if (o.kind === 'wallet') editWallet(o.id);
  else if (o.kind === 'inc' || o.kind === 'exp') editCat(o.kind, o.id);
}

// Форма кошелька одна на «новый» и «правку»: иконка одной кнопкой, палитра цветов,
// имя подсказывает иконку, пока её не выбрали руками.
// pfx — префикс id полей, чтобы две формы не столкнулись в одном #dlgBody.
function walletForm(pfx, o) {
  var st = { icon: Icons.walletKey(o.icon), color: Engine.walletColor(o.color), touched: !!o.iconTouched };

  st.body =
    '<div class="ef-err" id="' + pfx + 'Err" hidden></div>' +
    '<div class="ef"><span class="lbl">Название</span>' +
      '<input class="inp" id="' + pfx + 'Name" type="text"' +
      (o.name != null ? ' value="' + esc(o.name) + '"' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '></div>' +
    '<div class="ef"><span class="lbl">Иконка</span>' + icoRowHtml(pfx + 'Ico', st.icon, 'wc-' + st.color) + '</div>' +
    '<div class="ef"><span class="lbl">Цвет</span>' + colorsHtml(pfx + 'Colors', st.color) + '</div>' +
    '<div class="ef"><span class="lbl">' + esc(o.balLabel) + '</span>' +
      '<input class="inp" id="' + pfx + 'Base" type="text" inputmode="decimal" value="' + esc(o.balValue) + '"></div>';

  st.bind = function () {
    var prev = $(pfx + 'Ico'), nameEl = $(pfx + 'Name');
    function paintIco() {
      prev.innerHTML = Icons.svg(st.icon, 22);
      prev.className = 'icprev wc-' + st.color;
    }
    $(pfx + 'IcoBtn').addEventListener('click', function () {
      openIconSheet({ title: 'Иконка кошелька', kind: 'wallet', cur: st.icon, onPick: function (n) {
        st.icon = n; st.touched = true; paintIco();
      } });
    });
    // пока иконку не трогали руками — она едет за названием: «Т-Банк» → карта
    nameEl.addEventListener('input', function () {
      if (st.touched) return;
      var g = Icons.guessKind(nameEl.value, 'wallet');
      if (g !== st.icon) { st.icon = g; paintIco(); }
    });
    all($('dlgBody'), '#' + pfx + 'Colors .cw').forEach(function (b) {
      b.addEventListener('click', function () {
        all($('dlgBody'), '#' + pfx + 'Colors .cw').forEach(function (x) { x.classList.remove('on'); x.removeAttribute('aria-pressed'); });
        b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
        st.color = b.getAttribute('data-c');
        paintIco();
        UI.haptic('light');
      });
    });
    UI.moneyInput($(pfx + 'Base'));
  };
  return st;
}

// backToList — вернуться в список «Настроить кошельки», а не закрыть всё
function editWallet(id, backToList) {
  var w = Engine.findWallet(UI.S, id);
  if (!w) return;
  var bal = Engine.walletBalance(UI.S, id);
  var f = walletForm('ec', { name: w.name, icon: w.icon || 'wallet', color: w.color,
    iconTouched: true, balLabel: 'Баланс, ₽', balValue: Engine.fmt(bal) });
  // у скрытого кошелька вместо «Скрыть» - «Показать»: иначе вернуть его после того, как
  // тост «Вернуть» уехал, было негде
  UI.openDlg({
    title: 'Кошелёк',
    body: f.body +
      '<div class="ef-acts">' +
        '<button class="btn ghost" type="button" id="ecHide">' + (w.hidden ? 'Показать' : 'Скрыть') + '</button>' +
        '<button class="btn danger" type="button" id="ecDel">Удалить</button>' +
      '</div>',
    buttons: [
      { label: 'Отмена', cls: 'ghost', onClick: function () { if (backToList) { openWallets(); return false; } } },
      { label: 'Сохранить', cls: 'primary', onClick: function () {
        var name = String($('ecName').value).trim();
        if (!name) { showErr('ecErr', 'Впиши название'); return false; }
        var n = num($('ecBase').value);
        if (isNaN(n)) { showErr('ecErr', 'Баланс - это число'); return false; }
        Engine.updateWallet(UI.S, id, { name: name, icon: f.icon, color: f.color });
        if (Math.abs(n - bal) > 0.004) Engine.setWalletBase(UI.S, id, n);   // трогаем базу только если правда менял
        UI.save(); UI.render(); UI.haptic('light');
        UI.toast('Кошелёк сохранён');
        if (backToList) { openWallets(); return false; }
      } }
    ],
    onOpen: function () {
      f.bind();
      $('ecHide').addEventListener('click', function () {
        if (w.hidden) unhideWallet(id, backToList); else hideWallet(id, backToList);
      });
      $('ecDel').addEventListener('click', function () { deleteWalletFlow(id, backToList); });
    }
  });
}

function hideWallet(id, backToList) {
  var w = Engine.findWallet(UI.S, id);
  if (!w) return;
  Engine.updateWallet(UI.S, id, { hidden: true });
  UI.save(); UI.closeDlg(); UI.render(); UI.haptic('medium');
  UI.toast('Кошелёк «' + w.name + '» скрыт', {
    action: 'Вернуть',
    onAction: function () { unhideWallet(id, false); }
  });
  if (backToList) setTimeout(openWallets, 0);
}

// Возврат скрытого кошелька проходит ТУ ЖЕ проверку, что добавление нового: скрытый
// в лимите free-версии не считается, и «скрыть третий - завести четвёртый - вернуть
// третий» обходило бы гейт. Упёрлись - paywall, из списка возврат в список.
function unhideWallet(id, backToList) {
  var w = Engine.findWallet(UI.S, id);
  if (!w || !w.hidden) return;
  if (!walletGate(backToList)) return;
  Engine.updateWallet(UI.S, id, { hidden: false });
  UI.save(); UI.closeDlg(); UI.render(); UI.haptic('light');
  UI.toast('Кошелёк «' + w.name + '» снова на экране');
  if (backToList) setTimeout(openWallets, 0);
}

// Удаление кошелька НАСОВСЕМ. Скрытие ничего не теряет, удаление уносит и операции -
// поэтому у кошелька с историей окно честно называет число операций и напоминает про
// «Скрыть» (кнопка живёт в самой форме): правильный выход должен быть проще неправильного.
// Обе развилки - обычный confirm на две кнопки «Удалить»/«Отмена», без прежнего
// третьего выбора.
function deleteWalletFlow(id, backToList) {
  var w = Engine.findWallet(UI.S, id);
  if (!w) return;
  var n = Engine.walletTxCount(UI.S, id);
  var text = n
    ? 'У кошелька «' + w.name + '» ' + n + ' ' + Engine.plural(n, 'операция', 'операции', 'операций') +
      '. Удалить кошелёк вместе с операциями? Они сотрутся насовсем. ' +
      'Хочешь сохранить историю - нажми «Скрыть».'
    : 'Удалить кошелёк «' + w.name + '»?';
  UI.dlgConfirm({
    title: 'Удалить кошелёк?',
    text: text,
    danger: true, okLabel: 'Удалить',
    onOk: function () { dropWallet(id, backToList); }
  });
}

function dropWallet(id, backToList) {
  var r = Engine.deleteWallet(UI.S, id);
  if (!r) return;
  UI.save(); UI.closeDlg(); UI.render(); UI.haptic('medium');
  UI.toast(r.removed
    ? 'Кошелёк «' + r.name + '» удалён вместе с ' + r.removed + ' ' +
      Engine.plural(r.removed, 'операцией', 'операциями', 'операциями')
    : 'Кошелёк «' + r.name + '» удалён');
  if (backToList) setTimeout(openWallets, 0);
}

// Полный доступ снимает лимиты free-версии. Один источник правды на всё приложение -
// UI.hasFullAccess (purchase.js); пока его нет (порядок загрузки) - флаг сборки.
function full() {
  if (UI.hasFullAccess) return !!UI.hasFullAccess();
  return (typeof Access !== 'undefined') ? !!Access.FULL : true;
}
// подключена ли оплата (Access.PAY, access.js). Без неё баннер честно говорит «позже».
function payOn() { return !!(typeof Access !== 'undefined' && Access.PAY); }
var FULL_PRICE = '990 ₽';
// Стартовая цена действует до этой даты (включительно). После неё строка про срок
// гаснет сама - даже в сборке, которую не обновили, устаревшее обещание не покажется.
// Саму цену после подключения RuStore Pay брать из магазина (getProducts), не отсюда.
var PRICE_UNTIL = '2026-12-31';
function priceUntilOn() {
  var today = new Date();
  var ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  return ymd <= PRICE_UNTIL;
}
// back - куда вернуться при закрытии баннера (кнопка «Позже» / фон / свайп). Из настроек
// (addCat/addWallet) это функция, открывающая список категорий/кошельков заново: без неё
// баннер живёт в том же #dlg, и закрытие выкидывало бы на главный экран. Из аналитики
// back не передаётся - там баннер лежит поверх оверлея #summary, закрытие и так корректно.
// «Купить» ведёт в UI.buyFullAccess(ret): тот же колбэк возврата, что у «Позже».
function paywall(back) {
  var ret = (typeof back === 'function') ? back : null;
  var pay = payOn();
  var body =
    '<div class="pw">' +
      '<div class="pw-lead">Полный доступ навсегда - одной покупкой, без подписок.</div>' +
      '<div class="pw-h">Кошельки и категории - сколько нужно</div>' +
      '<div class="pw-sub">до ' + Engine.HARD.wallets + ' кошельков и ' + Engine.HARD.expCats + ' категорий</div>' +
      '<div class="pw-h">Вся аналитика:</div>' +
      '<ul class="pw-list">' +
        '<li>сводка месяца</li>' +
        '<li>лента событий</li>' +
        '<li>тепловая карта трат</li>' +
        '<li>зона внимания</li>' +
        '<li>динамика по месяцам</li>' +
      '</ul>' +
      '<div class="pw-respect">Покупка поддерживает независимую разработку - без рекламы и подписок.</div>' +
      (pay
        ? '<div class="pw-price"><b id="pwPrice">' + FULL_PRICE + '</b> <span>· один раз, навсегда</span></div>' +
          (priceUntilOn() ? '<div class="pw-note">Стартовая цена - до 31 декабря 2026. С нового года будет дороже.</div>' : '')
        : '<div class="pw-note">Оплата подключится в ближайшем обновлении. Всё бесплатное работает без ограничений по времени.</div>') +
      // Офлайн-активация лицензионным ключом. Только поле и кнопка - никаких ссылок,
      // адресов и контактов «где купить» (требование Алексея и модерации RuStore).
      '<div class="pw-key">' +
        '<div class="pw-key-h">Уже есть ключ? Активируйте его</div>' +
        '<div class="pw-key-sub">Лицензионный ключ приобретается отдельно, вне приложения.</div>' +
        '<div class="pw-key-row">' +
          '<input type="text" class="inp" id="pwKey" placeholder="Вставьте ключ" ' +
            'autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text">' +
          '<button type="button" class="btn primary" id="pwActivate">Активировать</button>' +
        '</div>' +
        '<div class="pw-key-msg" id="pwKeyMsg" hidden></div>' +
      '</div>' +
      // «Восстановить покупку»: для случая «купил, сменил телефон, вошёл в тот же RuStore».
      // Только при подключённой оплате - без неё восстанавливать нечем.
      (pay
        ? '<div class="pw-restore">' +
            '<button type="button" class="btn ghost wide" id="pwRestore">Восстановить покупку</button>' +
          '</div>'
        : '') +
    '</div>';
  var buttons = [{ label: 'Позже', cls: pay ? 'ghost' : 'primary', onClick: function () { if (ret) { ret(); return false; } } }];
  if (pay) buttons.push({ label: 'Купить в RuStore - ' + FULL_PRICE, cls: 'primary', onClick: function () {
    if (window.UI.buyFullAccess) { window.UI.buyFullAccess(ret); return false; }
  } });
  UI.openDlg({
    title: 'Полный доступ',
    body: body,
    onClose: ret || undefined,   // закрытие по фону/свайпу - вернуть в список, если есть контекст
    buttons: buttons,
    onOpen: function () {
      // кнопки пейволла - столбиком: «Купить в RuStore - 990 ₽» целиком в одну строку, сверху
      var bb = $('dlgBtns'); if (bb) bb.classList.add('pw-btns');
      bindActivate(ret);
      if (pay) bindRestore(ret);
      if (pay) fillStorePrice();
    }
  });
}

// Кнопка «Восстановить покупку» ведёт в UI.restorePurchase(ret) - тот же колбэк возврата.
function bindRestore(ret) {
  var b = $('pwRestore');
  if (b) b.addEventListener('click', function () {
    if (window.UI.restorePurchase) window.UI.restorePurchase(ret);
  });
}

// Цену в пейволле берём из магазина (getProducts), а не хардкодим. Не пришла (браузер/дев,
// заглушка id, ошибка) - остаётся дефолтная строка FULL_PRICE, уже отрисованная.
function fillStorePrice() {
  try {
    if (!window.Pay || !window.Pay.getPriceLabel) return;
    window.Pay.getPriceLabel().then(function (label) {
      if (!label) return;
      var el = $('pwPrice');
      if (el) el.textContent = label;
      // и на кнопке - та же цена, иначе строка и кнопка разойдутся после смены цены в Консоли
      Array.prototype.forEach.call(document.querySelectorAll('#dlg .dlg-btns .btn'), function (btn) {
        if (btn.textContent.indexOf('Купить в RuStore - ') === 0) btn.textContent = 'Купить в RuStore - ' + label;
      });
    });
  } catch (e) {}
}

// Привязка поля активации ключом в пейволле. Валидный ключ включает Полный доступ,
// лимиты сняты, свой диалог-подтверждение (НЕ нативный alert). Ошибка - понятным текстом.
function bindActivate(ret) {
  var input = $('pwKey'), btn = $('pwActivate'), msg = $('pwKeyMsg');
  if (!input || !btn) return;
  function showMsg(text, bad) {
    if (!msg) return;
    msg.hidden = false; msg.textContent = text;
    msg.classList.toggle('bad', !!bad);
  }
  btn.addEventListener('click', function () {
    var raw = String(input.value || '').trim();
    if (!raw) { showMsg('Вставь лицензионный ключ.', true); input.focus(); return; }
    if (!window.License || !window.License.activate) {
      showMsg('Проверка ключа недоступна в этой сборке.', true); return;
    }
    btn.disabled = true; input.disabled = true;
    showMsg('Проверяю ключ…', false);
    window.License.activate(raw).then(function (r) {
      if (r && r.valid) {
        UI.render();                              // лимиты сняты сразу (фон под окном)
        UI.haptic('medium');
        // dlgAlert открывается в том же #dlg: заменяет пейволл своим содержимым и
        // сбрасывает его onClose (ret не сработает). Закрыл подтверждение - главный экран
        // уже без лимитов.
        UI.dlgAlert('Полный доступ открыт. Спасибо, что поддержал разработку!', 'Готово');
        return;
      }
      btn.disabled = false; input.disabled = false;
      var why = (r && r.reason === 'no-webcrypto')
        ? 'Проверка ключа недоступна на этом устройстве. Обнови приложение.'
        : 'Ключ недействителен. Проверь, что вставил его целиком и без изменений.';
      showMsg(why, true);
    });
  });
}

// Предохранитель (50/100/50) - упор в него НЕ paywall, а тихое «Предел».
function capMsg(what, n) {
  UI.dlgAlert('Достигнут предел: ' + n + ' ' + what + '. Больше добавить нельзя.', 'Предел');
}
// true - можно добавить (или вернуть из архива) категорию; иначе показывает нужное окно
// (предел или покупка). Возврат из архива идёт через ту же проверку: архивная в лимите
// free не считается, и «в архив - добавить новую - вернуть» обходило бы гейт.
// backToList - паволл открыт из списка «Категории», при закрытии вернуть туда, а не на главный.
function catGate(kind, backToList) {
  var ret = backToList ? function () { openCats(kind); } : null;
  if (kind === 'exp') {
    if (Engine.expCatsActiveCount(UI.S) >= Engine.HARD.expCats) { capMsg('категорий расходов', Engine.HARD.expCats); return false; }
    if (!Engine.canAddExpCat(UI.S, full())) { paywall(ret); return false; }
  } else {
    if (Engine.incCatsActiveCount(UI.S) >= Engine.HARD.incCats) { capMsg('источников дохода', Engine.HARD.incCats); return false; }
    if (!Engine.canAddIncCat(UI.S, full())) { paywall(ret); return false; }
  }
  return true;
}

// Форма категории (новая и правка): название, иконка, для расходной — месячный лимит.
// pfx — префикс id полей, чтобы формы не столкнулись в #dlgBody.
function catForm(pfx, o, kind) {
  var st = { icon: o.icon || Icons.guessKind(o.name || '', kind), touched: !!o.iconTouched };
  st.body =
    '<div class="ef-err" id="' + pfx + 'Err" hidden></div>' +
    '<div class="ef"><span class="lbl">Название</span>' +
      '<input class="inp" id="' + pfx + 'Name" type="text"' +
      (o.name != null ? ' value="' + esc(o.name) + '"' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '></div>' +
    '<div class="ef"><span class="lbl">Иконка</span>' + icoRowHtml(pfx + 'Ico', st.icon, '', kind) + '</div>' +
    // Число-цель месяца: у расхода — «Лимит» (краснеет при перерасходе), у дохода — «План»
    // (позитивный, зеленеет при достижении). Поле и логика ввода общие (id …Lim, readLimit).
    (kind === 'exp'
      ? '<div class="ef"><span class="lbl">Лимит в месяц, ₽</span>' +
        '<input class="inp" id="' + pfx + 'Lim" type="text" inputmode="decimal" placeholder="не задан"' +
        (o.limValue != null ? ' value="' + esc(o.limValue) + '"' : '') + '>' +
        '<div class="hint">Оставишь пустым - лимита нет: приложение просто считает траты. С лимитом кружок категории на главном показывает, сколько осталось, и краснеет при перерасходе.</div></div>'
      : '<div class="ef"><span class="lbl">План на месяц, ₽</span>' +
        '<input class="inp" id="' + pfx + 'Lim" type="text" inputmode="decimal" placeholder="не задан"' +
        (o.limValue != null ? ' value="' + esc(o.limValue) + '"' : '') + '>' +
        '<div class="hint">Оставишь пустым - плана нет: приложение просто считает доход. С планом кружок источника на главном показывает, сколько осталось до цели, и зеленеет при достижении.</div></div>');
  st.bind = function () {
    var prev = $(pfx + 'Ico'), nameEl = $(pfx + 'Name');
    function paintIco() { prev.innerHTML = Icons.img(st.icon, kind, 26); }
    $(pfx + 'IcoBtn').addEventListener('click', function () {
      openIconSheet({ title: kind === 'inc' ? 'Иконка источника' : 'Иконка категории',
        kind: kind, cur: st.icon, onPick: function (n) { st.icon = n; st.touched = true; paintIco(); } });
    });
    nameEl.addEventListener('input', function () {
      if (st.touched) return;
      var g = Icons.guessKind(nameEl.value, kind);
      if (g !== st.icon) { st.icon = g; paintIco(); }
    });
    if ($(pfx + 'Lim')) UI.moneyInput($(pfx + 'Lim'));
  };
  return st;
}

// пустое поле лимита = «не задан» (null); иначе число. NaN — сигнал ошибки.
function readLimit(pfx) {
  var raw = String($(pfx + 'Lim').value).trim();
  if (raw === '') return null;
  return num(raw);
}

function editCat(kind, id, backToList) {
  var f2 = Engine.findCategory(UI.S, id);
  if (!f2) return;
  var c = f2.cat, ym = UI.curYM();
  var lim = Engine.catLimit(UI.S, id, ym);
  var f = catForm('ecat', { name: c.name, icon: UI.S.icons[id] || c.icon, iconTouched: true,
    limValue: (lim == null ? '' : Engine.fmt(lim)) }, kind);
  UI.openDlg({
    title: kind === 'inc' ? 'Источник дохода' : 'Категория', body: f.body +
      '<div class="ef-acts"><button class="btn danger" type="button" id="ecatArch">' +
        (kind === 'inc' ? 'Убрать источник в архив' : 'Убрать категорию в архив') + '</button></div>',
    buttons: [
      { label: 'Отмена', cls: 'ghost', onClick: function () { if (backToList) { openCats(kind); return false; } } },
      { label: 'Сохранить', cls: 'primary', onClick: function () {
        var name = String($('ecatName').value).trim();
        if (!name) { showErr('ecatErr', 'Впиши название'); return false; }
        var l = readLimit('ecat');
        if (l !== null && (isNaN(l) || l < 0)) {
          showErr('ecatErr', (kind === 'inc' ? 'План' : 'Лимит') + ' - неотрицательное число'); return false;
        }
        Engine.setLimit(UI.S, ym, id, l);
        Engine.updateCategory(UI.S, id, { name: name });
        UI.S.icons[id] = f.icon;
        UI.save(); UI.render(); UI.haptic('light');
        UI.toast('Сохранено');
        if (backToList) { openCats(kind); return false; }
      } }
    ],
    onOpen: function () {
      f.bind();
      $('ecatArch').addEventListener('click', function () {
        UI.dlgConfirm({ title: 'В архив?', danger: true, okLabel: 'В архив',
          text: 'Категория «' + c.name + '» уйдёт из выбора. История операций сохранится, вернуть можно из архива.',
          onOk: function () {
            Engine.archiveCategory(UI.S, id, true);
            UI.save(); UI.closeDlg(); UI.render(); UI.haptic('medium');
            UI.toast('«' + c.name + '» в архиве', { action: 'Вернуть',
              onAction: function () { restoreCat(kind, id, false); } });
            if (backToList) setTimeout(function () { openCats(kind); }, 0);
          } });
      });
    }
  });
}

// Вернуть категорию из архива - через тот же гейт, что и добавление (см. catGate).
function restoreCat(kind, id, backToList) {
  if (!catGate(kind, backToList)) return false;
  Engine.archiveCategory(UI.S, id, false);
  UI.save(); UI.render(); UI.haptic('light');
  return true;
}

function addCat(kind, backToList) {
  if (!catGate(kind, backToList)) return;
  var f = catForm('acat', { placeholder: kind === 'inc' ? 'Например, Зарплата' : 'Например, Еда' }, kind);
  UI.openDlg({
    title: kind === 'inc' ? 'Новый источник дохода' : 'Новая категория', body: f.body,
    buttons: [
      { label: 'Отмена', cls: 'ghost', onClick: function () { if (backToList) { openCats(kind); return false; } } },
      { label: 'Добавить', cls: 'primary', onClick: function () {
        var name = String($('acatName').value).trim();
        if (!name) { showErr('acatErr', 'Впиши название'); return false; }
        if (!catGate(kind, backToList)) return false;
        var l = readLimit('acat');
        if (l !== null && (isNaN(l) || l < 0)) {
          showErr('acatErr', (kind === 'inc' ? 'План' : 'Лимит') + ' - неотрицательное число'); return false;
        }
        var c = Engine.addCategory(UI.S, kind, { name: name, icon: f.icon });
        Engine.setLimit(UI.S, UI.curYM(), c.id, l);
        UI.S.icons[c.id] = f.icon;
        UI.save(); UI.render(); UI.haptic('medium');
        UI.toast(kind === 'inc' ? 'Источник «' + name + '» добавлен' : 'Категория «' + name + '» добавлена');
        if (backToList) { openCats(kind); return false; }
      } }
    ],
    onOpen: function () { f.bind(); $('acatName').focus(); }
  });
}

// строка категории в списке: иконка + имя + число-цель справа (расход - лимит, доход - план)
function catRowHtml(c, kind) {
  var ym = UI.curYM();
  var lim = Engine.catLimit(UI.S, c.id, ym);
  var noneWord = kind === 'inc' ? 'без плана' : 'без лимита';
  var right = '<span class="clr-lim">' + (lim == null ? noneWord : Engine.fmt(lim) + ' ₽') + '</span>';
  return '<button class="clrow" type="button" data-id="' + esc(c.id) + '">' +
    '<span class="clr-ic" aria-hidden="true">' + Icons.img(UI.S.icons[c.id] || c.icon, kind, 24, c.name) + '</span>' +
    '<span class="clr-n">' + esc(c.name) + '</span>' + right + '</button>';
}

var catsKind = 'exp';       // активная вкладка экрана «Категории»
var catsArchFold = true;    // архив свёрнут

function openCats(kind) {
  if (kind === 'exp' || kind === 'inc') catsKind = kind;
  var k = catsKind;
  var live = Engine.listCategories(UI.S, k);   // активные, в порядке хозяина
  var arch = (k === 'inc' ? UI.S.categories.inc : UI.S.categories.exp).filter(function (c) { return c.archived; });

  // замок на «+», когда упёрлись в лимит free (и у расходов, и у источников дохода):
  // тап по нему всё равно открывает баннер, но paywall не «внезапный»
  var full2 = full();
  var atCap = k === 'exp' ? !Engine.canAddExpCat(UI.S, full2) : !Engine.canAddIncCat(UI.S, full2);
  var tabs = '<div class="clr-bar"><div class="clr-tabs">' +
    '<button type="button" class="clr-tab' + (k === 'exp' ? ' on' : '') + '" data-k="exp">Расходы</button>' +
    '<button type="button" class="clr-tab' + (k === 'inc' ? ' on' : '') + '" data-k="inc">Доходы</button></div></div>';

  var list = '<div class="clr-list">' +
    (live.length ? live.map(function (c) { return catRowHtml(c, k); }).join('')
                 : '<div class="empty">Пока нет категорий</div>') +
    '<button class="clrow add" type="button" id="clAdd">＋ ' + (k === 'inc' ? 'Источник дохода' : 'Категория') +
      (atCap ? ' <span class="clr-lock">🔒</span>' : '') + '</button>' +
    '</div>';

  var body = tabs + list;
  body += '<button class="btn ghost wide" type="button" id="clCopy">' +
    (k === 'inc' ? 'Скопировать планы прошлого месяца' : 'Скопировать лимиты прошлого месяца') + '</button>';
  if (arch.length) {
    body += '<button class="btn ghost wide" type="button" id="clArch">' +
      (catsArchFold ? 'Архив (' + arch.length + ')' : 'Свернуть архив') + '</button>';
    if (!catsArchFold) {
      body += '<div class="clr-list clr-dim">' + arch.map(function (c) {
        return '<div class="clrow arch"><span class="clr-ic" aria-hidden="true">' +
          Icons.img(UI.S.icons[c.id] || c.icon, k, 24, c.name) + '</span>' +
          '<span class="clr-n">' + esc(c.name) + '</span>' +
          '<button class="btn ghost sm" type="button" data-back="' + esc(c.id) + '">Вернуть</button></div>';
      }).join('') + '</div>';
    }
  }

  UI.openDlg({
    title: '', body: body,
    hint: { key: 'cats', text: k === 'inc'
      ? 'Задай план на месяц - и кружок источника покажет, сколько осталось до цели.'
      : 'Задай месячный лимит категории - и кружок начнёт показывать траты к лимиту.' },
    buttons: [{ label: 'Готово', cls: 'primary' }],
    onOpen: function () {
      $('dlg').classList.add('dlg-swipe');
      // Подсказку - под вкладки, над списком: внизу окна (после кнопок «Скопировать
      // лимиты» и «Архив») её на телефоне не видно без прокрутки. Узел #dlgHint стабилен
      // (свайп привязан один раз), openDlg/closeDlg возвращают его на штатное место.
      var dh = $('dlgHint'), barEl = $('dlgBody').querySelector('.clr-bar');
      if (dh && !dh.hidden && barEl) barEl.parentNode.insertBefore(dh, barEl.nextSibling);
      all($('dlgBody'), '.clr-tab').forEach(function (t) {
        t.addEventListener('click', function () { catsKind = t.getAttribute('data-k'); UI.haptic('light'); openCats(catsKind); });
      });
      all($('dlgBody'), '.clrow[data-id]').forEach(function (b) {
        b.addEventListener('click', function () { editCat(k, b.getAttribute('data-id'), true); });
      });
      $('clAdd').addEventListener('click', function () { addCat(k, true); });
      var cp = $('clCopy');
      if (cp) cp.addEventListener('click', function () {
        var now = UI.curYM();
        var y = parseInt(now.slice(0, 4), 10), m = parseInt(now.slice(5, 7), 10) - 1;
        var pd = new Date(Date.UTC(y, m - 1, 1));
        var prev = pd.getUTCFullYear() + '-' + (pd.getUTCMonth() + 1 < 10 ? '0' : '') + (pd.getUTCMonth() + 1);
        var n = Engine.copyLimits(UI.S, prev, now, k);
        UI.save(); UI.render(); UI.haptic('light');
        UI.toast(k === 'inc'
          ? (n ? ('Скопировано планов: ' + n) : 'В прошлом месяце планов нет')
          : (n ? ('Скопировано лимитов: ' + n) : 'В прошлом месяце лимитов нет'));
        openCats(k);
      });
      var af = $('clArch');
      if (af) af.addEventListener('click', function () { catsArchFold = !catsArchFold; UI.haptic('light'); openCats(k); });
      all($('dlgBody'), '.clrow.arch [data-back]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (restoreCat(k, b.getAttribute('data-back'), true)) openCats(k);
        });
      });
    }
  });
}

// ---------- новый кошелёк ----------
// backToList — после «Добавить» возвращаемся в список, а не на главный экран:
// кошельки заводят пачкой, и каждый раз открывать меню заново было мучением.
// true - можно добавить (или вернуть из скрытых) кошелёк; иначе окно предела или покупки
function walletGate(backToList) {
  if (Engine.walletsActiveCount(UI.S) >= Engine.HARD.wallets) { capMsg('кошельков', Engine.HARD.wallets); return false; }
  if (!Engine.canAddWallet(UI.S, full())) { paywall(backToList ? function () { openWallets(); } : null); return false; }
  return true;
}

function addWallet(backToList) {
  if (!walletGate(backToList)) return;
  var f = walletForm('aw', { icon: 'wallet', color: Engine.WALLET_COLOR_DEFAULT,
    placeholder: 'Например, Т-Банк', balLabel: 'Сколько на нём сейчас, ₽', balValue: '0' });
  UI.openDlg({
    title: 'Новый кошелёк', body: f.body,
    buttons: [
      { label: 'Отмена', cls: 'ghost', onClick: function () { if (backToList) { openWallets(); return false; } } },
      { label: 'Добавить', cls: 'primary', onClick: function () {
        var name = String($('awName').value).trim();
        if (!name) { showErr('awErr', 'Впиши название'); return false; }
        var raw = String($('awBase').value).trim();
        var n = raw === '' ? 0 : num(raw);
        if (isNaN(n)) { showErr('awErr', 'Баланс - это число'); return false; }
        Engine.addWallet(UI.S, { name: name, icon: f.icon, color: f.color, base: n });
        UI.save(); UI.render(); UI.haptic('medium');
        UI.toast('Кошелёк «' + name + '» добавлен');
        if (backToList) { openWallets(); return false; }
      } }
    ],
    onOpen: function () {
      f.bind();
      $('awName').focus();
    }
  });
}

// ---------- список кошельков ----------
// Плитки, а не строки: те же карточки, что на главном экране, по две в ряд. Хозяин
// узнаёт кошелёк по цвету, а не читает список. Кнопки «Скрыть» в плитке нет - скрытие
// и удаление живут внутри формы кошелька, куда ведёт тап по плитке.
var wlFolded = true;      // «Скрытые (N)» по умолчанию свёрнуты

function openWallets() {
  var ws = UI.S.wallets.slice().sort(function (a, b) { return a.order - b.order; });
  var live = ws.filter(function (w) { return !w.hidden; });
  var off = ws.filter(function (w) { return w.hidden; });

  var atCap = !Engine.canAddWallet(UI.S, full());   // замок на «+», когда упёрлись в лимит free
  var body = '<div class="wgrid" id="wlGrid">' +
    (live.length ? live.map(function (w) { return UI.walletTileHtml(w); }).join('')
                 : '<div class="empty">Кошельков пока нет</div>') +
    '<button class="wtile add" type="button" id="wlAdd">＋ Кошелёк' +
      (atCap ? ' <span class="clr-lock">🔒</span>' : '') + '</button>' +
  '</div>';

  if (off.length) {
    body += '<button class="btn ghost wide wl-fold" type="button" id="wlFold">' +
      (wlFolded ? 'Скрытые (' + off.length + ')' : 'Свернуть скрытые') + '</button>';
    if (!wlFolded) {
      body += '<div class="wl-foldt">Скрытые кошельки не видно на главном экране, операции у них целы.</div>' +
        '<div class="wgrid" id="wlOff">' +
        off.map(function (w) { return UI.walletTileHtml(w, { off: true }); }).join('') + '</div>';
    }
  }

  UI.openDlg({
    title: 'Кошельки', body: body,
    buttons: [{ label: 'Готово', cls: 'primary' }],
    // слушателей вешаем на сами кнопки: #dlgBody переживает закрытие диалога,
    // делегирование на нём копилось бы с каждым открытием списка
    onOpen: function () {
      // метка «закрывается свайпом вниз по шапке» — жест берётся с ручки/заголовка
      $('dlg').classList.add('dlg-swipe');
      all($('dlgBody'), '.wtile[data-id]').forEach(function (b) {
        b.addEventListener('click', function () { editWallet(b.getAttribute('data-id'), true); });
      });
      $('wlAdd').addEventListener('click', function () { addWallet(true); });
      var f = $('wlFold');
      if (f) f.addEventListener('click', function () { wlFolded = !wlFolded; UI.haptic('light'); openWallets(); });
    }
  });
}

// ---------- выбор месяца ----------
// Год листается стрелками: 1 января декабрь прошлого года иначе было бы не открыть.
// Открываем на годе выбранного месяца, а не календарном - чтобы видеть, где стоишь.
function pickMonth(year) {
  UI.checkDay();            // сразу после полуночи «сейчас» в выборе - уже новый месяц
  var cur = UI.curYM(), now = UI.screenYM();
  if (!year) year = parseInt(cur.slice(0, 4), 10);
  var body = '<div class="mgrid-y">' +
      '<button type="button" class="chip mgrid-nav" id="pmPrev" aria-label="Предыдущий год">‹</button>' +
      '<span class="mgrid-year">' + year + '</span>' +
      '<button type="button" class="chip mgrid-nav" id="pmNext" aria-label="Следующий год">›</button>' +
    '</div>' +
    '<div class="mgrid">' + UI.MONTHS.map(function (n, i) {
      var v = year + '-' + (i < 9 ? '0' : '') + (i + 1);
      return '<button type="button" class="chip' + (v === cur ? ' on' : '') + (v === now ? ' now' : '') +
        '" data-ym="' + v + '">' + n + '</button>';
    }).join('') + '</div>';
  UI.openDlg({
    title: 'Месяц', body: body,
    buttons: [{ label: 'Закрыть', cls: 'ghost' }],
    onOpen: function () {
      all($('dlgBody'), '.chip[data-ym]').forEach(function (el) {
        el.addEventListener('click', function () {
          var v = el.getAttribute('data-ym');
          UI.S.ui.month = (v === UI.screenYM()) ? null : v;
          UI.save(); UI.closeDlg(); UI.render(); UI.haptic('light');
        });
      });
      $('pmPrev').addEventListener('click', function () { UI.haptic('light'); pickMonth(year - 1); });
      $('pmNext').addEventListener('click', function () { UI.haptic('light'); pickMonth(year + 1); });
    }
  });
}

// ---------- связки ----------
$('btnEditDone').addEventListener('click', exitEdit);
// подсказку режима правки гасит свайп в любую сторону; узел стабилен — привязка один раз
UI.bindHintSwipe($('editHint'), 'edit', function () { var e = $('editHint'); if (e) e.hidden = true; });

UI.onLongPress = function () { enterEdit(); };
UI.onEditPointerDown = onEditPointerDown;
UI.enterEdit = enterEdit;
UI.exitEdit = exitEdit;
UI.editCircle = editCircle;
UI.addWallet = addWallet;
UI.editWallet = editWallet;
UI.openWallets = openWallets;
UI.openCats = openCats;
UI.addCat = addCat;
UI.editCat = editCat;
UI.paywall = paywall;
UI.openIconSheet = openIconSheet;
UI.closeIconSheet = closeIconSheet;
UI.iconSheetOpen = iconSheetOpen;
UI.pickMonth = pickMonth;
UI.hideWallet = hideWallet;
UI.unhideWallet = unhideWallet;
UI.restoreCat = restoreCat;
UI.deleteWallet = deleteWalletFlow;
UI.edgeSide = edgeSide;
UI.REORDER_MS = REORDER_MS;
UI.SETTLE_MS = SETTLE_MS;

})();
