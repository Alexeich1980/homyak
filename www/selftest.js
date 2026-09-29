/* selftest.js — самопроверка приложения прямо в браузере/на телефоне.
   Включается только адресом с «selftest» (например ?demo&selftest), в обычной работе
   не делает ничего. Печатает панель PASS/FAIL и итоговую строку «SELFTEST n/N PASS».
   Состояние, которое трогает, в конце возвращает как было. */
(function () {
'use strict';

if (location.search.indexOf('selftest') < 0) return;

var UI = window.UI;
var panel, listEl, passed = 0, total = 0;

// ---------- панель ----------
function mount() {
  var css = document.createElement('style');
  css.textContent =
    '#selftest{position:fixed;right:6px;bottom:6px;z-index:9999;width:min(360px,calc(100vw - 12px));' +
    'max-height:60vh;overflow:auto;background:#0b0d11;color:#dfe4ea;border:1px solid #2b3240;' +
    'border-radius:10px;padding:8px 10px;font:11px/1.45 ui-monospace,Consolas,monospace;' +
    '-webkit-overflow-scrolling:touch;box-shadow:0 8px 24px rgba(0,0,0,.5)}' +
    '#selftest .st-h{font-weight:700;margin-bottom:4px;color:#9fb0c4}' +
    '#selftest .pass{color:#57c98a}' +
    '#selftest .fail{color:#ef6f6f}' +
    '#selftest .st-sum{margin-top:6px;padding-top:6px;border-top:1px solid #2b3240;font-weight:700}';
  document.head.appendChild(css);
  panel = document.createElement('div');
  panel.id = 'selftest';
  panel.innerHTML = '<div class="st-h">self-test</div><div id="stList"></div><div class="st-sum" id="stSum">…</div>';
  document.body.appendChild(panel);
  listEl = document.getElementById('stList');
}

function line(cls, text) {
  var d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  listEl.appendChild(d);
}

// ---------- утверждения ----------
function fail(msg) { throw new Error(msg); }
function eq(a, b, what) {
  if (a !== b) fail(what + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
}
function ok(v, what) { if (!v) fail(what); }

// ---------- вспомогательное ----------
// Ожидаемый состав меню — держим списком, чтобы порядок пунктов был проверяемым,
// а не «как получилось».
// Автономный форк: синка с ПК нет (пункт mSync убран), зато есть свой экран
// «Настроить категории» (mCats). Порядок держим списком - он проверяемый.
var MENU_ORDER = ['mTheme', 'mUpdate', 'mCats', 'mWallets', 'mSound', 'mHaptic',
                  'mHints', 'mAbout', 'mBackup', 'mRestore'];

// innerHTML браузер печатает по-своему («<path/>» → «<path></path>»), поэтому
// ожидаемую иконку прогоняем через тот же разбор, а не сравниваем строки в лоб
function sameIcon(el, name, size) {
  var t = document.createElement('span');
  t.innerHTML = Icons.svg(name, size || 22);
  return el && el.innerHTML === t.innerHTML;
}

function circles(kind) { return document.querySelectorAll('#app .circle[data-kind="' + kind + '"]'); }
function circle(kind, i) { return circles(kind)[i || 0]; }
function cname(el) { var n = el.querySelector('.cname'); return n ? n.textContent : ''; }
function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Ждём условия, а не «столько-то миллисекунд». Плавная прокрутка и переворот страницы
// у края поля укладываются в разное время на разной машине, и жёсткий sleep то и дело
// врал про приложение. tick зовём на каждом круге - им жест «подрагивает» пальцем,
// чтобы слежение за краем не считало, что палец ушёл.
function waitFor(cond, ms, tick) {
  var t0 = Date.now();
  return new Promise(function (done) {
    (function loop() {
      if (cond() || Date.now() - t0 > (ms || 2000)) return done(cond());
      if (tick) tick();
      setTimeout(loop, 100);
    })();
  });
}

// подмена matchMedia на «человек просил меньше движения»
var mm0 = window.matchMedia;
function forceReduced(on) {
  if (on) {
    window.matchMedia = function (q) {
      if (String(q).indexOf('reduced-motion') >= 0) return { matches: true, media: q, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
      return mm0.call(window, q);
    };
  } else window.matchMedia = mm0;
}

function pev(el, type, x, y, up, ptype) {
  var E = window.PointerEvent || window.MouseEvent;
  var e = new E(type, { bubbles: true, cancelable: true, composed: true,
    clientX: x, clientY: y, pointerId: 77, isPrimary: true, pointerType: ptype || 'touch',
    button: 0, buttons: up ? 0 : 1 });
  el.dispatchEvent(e);
}

// Панель self-test висит поверх экрана и ловит elementFromPoint: на время жеста
// её убираем, иначе бросок «не долетает» до плитки и проверка врёт про приложение.
function withoutPanel(fn) {
  var vis = panel ? panel.style.visibility : null;
  if (panel) panel.style.visibility = 'hidden';
  try { return fn(); } finally { if (panel) panel.style.visibility = vis; }
}

// жест «взял плитку A — отпустил на плитке B» по прямой
function gesture(src, tgt, ptype) {
  withoutPanel(function () {
    var a = center(src), b = center(tgt);
    pev(src, 'pointerdown', a.x, a.y, false, ptype);
    for (var i = 1; i <= 6; i++) {
      pev(document, 'pointermove', a.x + (b.x - a.x) * i / 6, a.y + (b.y - a.y) * i / 6, false, ptype);
    }
    pev(document, 'pointerup', b.x, b.y, true, ptype);
  });
}

// ---------- проверки ----------
var CHECKS = [];
function add(name, fn) { CHECKS.push({ name: name, fn: fn }); }

// (1) движок — те же инварианты, что в node-тестах, коротко
add('движок: баланс кошелька (база, перевод, поправка)', function () {
  var S = Engine.defaultState();
  S.startYM = '2026-01';
  var a = Engine.addWallet(S, { name: 'A', base: 1000 });
  var b = Engine.addWallet(S, { name: 'B', base: 0 });
  a.baseTs = 0; b.baseTs = 0;
  Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: a.id, date: '2026-01-05' });
  Engine.addTx(S, { kind: 'inc', amount: 50, catId: 'i1', walletId: a.id, date: '2026-01-06' });
  Engine.addTx(S, { kind: 'transfer', amount: 200, walletId: a.id, toWalletId: b.id, date: '2026-01-07' });
  S.tx.forEach(function (t) { t.ts = 1000; });
  eq(Engine.walletBalance(S, a.id), 550, 'баланс A');
  eq(Engine.walletBalance(S, b.id), 200, 'баланс B');
  Engine.setWalletBase(S, a.id, 10);                       // поправка двигает точку отсчёта
  eq(Engine.walletBalance(S, a.id), 10, 'баланс A после поправки');
});

add('движок: уровень заливки (fill)', function () {
  eq(Engine.fill(0, 1000).level, 'none', '0/1000');
  eq(Engine.fill(500, 1000).level, 'ok', '500/1000');
  eq(Engine.fill(500, 1000).ratio, 0.5, 'ratio 500/1000');
  eq(Engine.fill(800, 1000).level, 'warn', '800/1000');
  eq(Engine.fill(1200, 1000).level, 'over', '1200/1000');
  eq(Engine.fill(10, 0).level, 'over', '10/0');
});

// Синк с ПК убран в автономном форке (нет factsPayload/parsePairCode/станции :52780) -
// соответствующие проверки удалены. Категории и лимиты живут на телефоне.

// (2) DOM
add('экран: три поля на месте', function () {
  ok(document.getElementById('fieldInc'), 'нет #fieldInc');
  ok(document.getElementById('fieldWallets'), 'нет #fieldWallets');
  ok(document.getElementById('fieldExp'), 'нет #fieldExp');
});

// (2б) разметка макета 2a/2b: плитка категории и карточка кошелька
add('экран: плитка категории и карточка кошелька собраны по макету', function () {
  var t = circle('exp', 0);
  ok(t && t.classList.contains('tile'), 'плитка расхода не .tile');
  var ring = t.querySelector('.ring[data-pct]');
  ok(ring, 'у плитки нет .ring с data-pct');
  ok(ring.querySelector('.tfill'), 'нет заливки 2a (.tfill)');
  ok(ring.querySelector('.tarc .arc'), 'нет кольца 2b (.tarc .arc)');
  ok(t.querySelector('.cname') && t.querySelector('.cnum') && t.querySelector('.cplan'), 'нет подписей плитки');
  ok(/lvl-(none|ok|warn|over|inc)/.test(ring.className), 'у кольца нет класса уровня: ' + ring.className);
  var w = circle('wallet', 0);
  ok(w && w.classList.contains('wcard'), 'кошелёк не .wcard');
  ok(w.querySelector('.cbal'), 'у кошелька нет баланса');
  ok(!document.querySelector('#app .circle.add'), 'с главного экрана не убрана плитка «+ Кошелёк»');
});

// (2в) шапка блоков: суммы в заголовках доходов и расходов
add('экран: заголовки блоков считают суммы', function () {
  var S = UI.S, ymStr = UI.curYM();
  var inc = 0, fact = 0, plan = 0;
  Engine.listCategories(S, 'inc').forEach(function (c) { inc += Engine.catFact(S, c.id, ymStr); });
  Engine.listCategories(S, 'exp').forEach(function (c) {
    fact += Engine.catFact(S, c.id, ymStr); plan += Engine.planOr0(S, c.id, ymStr);
  });
  var incPlan = 0;
  Engine.listCategories(S, 'inc').forEach(function (c) { incPlan += Engine.planOr0(S, c.id, ymStr); });
  // «из N» показывается только когда план/лимит вообще задан (иначе просто «· факт ₽»)
  var incSuf = incPlan > 0 ? ' из ' + UI.fmt(incPlan) : '';
  var expSuf = plan > 0 ? ' из ' + UI.fmt(plan) : '';
  eq(document.getElementById('incHeadText').textContent,
    'Доходы · ' + UI.fmt(inc) + incSuf + ' ₽', 'заголовок доходов');
  eq(document.getElementById('expHead').textContent,
    'Расходы · ' + UI.fmt(fact) + expSuf + ' ₽', 'заголовок расходов');
});

// (2г) главный экран не прокручивается: всё, что нужно, помещается в окно
add('экран: главный не прокручивается по вертикали', function () {
  var d = document.scrollingElement || document.documentElement;
  ok(d.scrollHeight <= window.innerHeight + 1,
    'страница выше окна: ' + d.scrollHeight + ' > ' + window.innerHeight);
  var exp = document.getElementById('fieldExp').getBoundingClientRect();
  ok(exp.bottom <= window.innerHeight + 1,
    'блок расходов вылез за экран: ' + Math.round(exp.bottom) + ' > ' + window.innerHeight);
});

// (2г2) сетка расходов: четыре ряда на любом телефоне, кольцо в своих границах
add('сетка: четыре ряда расходов и кольцо в границах 54…68', function () {
  var r = UI.ringPx();
  ok(r >= Engine.RING_MIN && r <= Engine.RING_MAX,
    'кольцо вне границ ' + Engine.RING_MIN + '…' + Engine.RING_MAX + ': ' + r);
  eq(UI.expRows(), 4, 'рядов в поле расходов');
  var pg = document.querySelector('#fieldExp .page');
  ok(pg, 'нет страницы расходов');
  ok(pg.querySelectorAll('.circle').length <= 16, 'на странице больше четырёх рядов');
});

// кольцо одно и то же в доходах и расходах, глиф — ровно половина кольца
add('сетка: кольцо доходов и расходов одного размера, глиф — половина', function () {
  var inc = document.querySelector('#fieldInc .ring'), exp = document.querySelector('#fieldExp .ring');
  ok(inc && exp, 'нет колец на экране');
  var wi = Math.round(inc.getBoundingClientRect().width);
  var we = Math.round(exp.getBoundingClientRect().width);
  eq(wi, we, 'кольцо доходов и расходов');
  eq(we, UI.ringPx(), 'кольцо на экране разошлось с расчётным');
  // у расходов в кольце теперь цветная картинка (её коробка крупнее глифа — 0.62
  // кольца, потому что у иллюстрации свои поля), у редких старых ключей — прежний глиф
  var g = exp.querySelector('.ico img, .ico svg');
  ok(g, 'в кольце расхода нет иконки');
  var want = g.tagName.toLowerCase() === 'img' ? we * 0.62 : we / 2;
  ok(Math.abs(g.getBoundingClientRect().width - want) <= 1.5,
    'иконка не по размеру кольца: ' + Math.round(g.getBoundingClientRect().width) + ' при ' + we);
  // геометрия дуги считается от размера, а не зашита числом
  var arc = exp.querySelector('.arc');
  if (arc) {
    var geo = Engine.ringGeom(we);
    ok(Math.abs(parseFloat(arc.getAttribute('r')) - geo.r) < 0.6, 'радиус дуги не по размеру кольца');
    ok(Math.abs(parseFloat(arc.style.strokeDasharray) - geo.circ) < 1, 'длина дуги не по размеру кольца');
  }
});

// (2г3) свободная высота раздана поровну: зазоры равны, не больше 28 и не меньше 8
add('сетка: зазоры между шапкой и полями равны и в границах 8…28', function () {
  var app = document.getElementById('app'), kids = [];
  Array.prototype.forEach.call(app.children, function (el) {
    if (getComputedStyle(el).display !== 'none') kids.push(el);
  });
  ok(kids.length >= 3, 'на экране меньше трёх блоков');
  var gaps = [];
  for (var i = 1; i < kids.length; i++) {
    gaps.push(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom);
  }
  var mn = Math.min.apply(null, gaps), mx = Math.max.apply(null, gaps);
  ok(mx - mn <= 2, 'зазоры разъехались: ' + gaps.map(Math.round).join(', '));
  ok(mx <= 28.5, 'зазор больше 28: ' + Math.round(mx));
  // Нижняя граница — это код-минимум GAP_MIN (6): на тесном 360×760 с четырьмя рядами
  // весь запас высоты забирает нижний зазор экрана (padding-bottom), и межблочные
  // зазоры честно опускаются к GAP_MIN. Раньше здесь стояло 8 — эмерджентное число
  // «пока низ лип к краю», а не контракт.
  ok(mn >= 5.5, 'зазор меньше GAP_MIN (6): ' + Math.round(mn));
});

// (2г4) угловая плитка растёт под пальцем и не обрезается лентой ни с одной стороны
add('сетка: увеличенная угловая плитка видна целиком', function () {
  var pg = document.querySelector('#fieldExp .page');
  var box = document.querySelector('#fieldExp .pages');
  ok(pg && box, 'нет ленты расходов');
  var cells = pg.querySelectorAll('.circle');
  ok(cells.length >= 4, 'мало плиток для проверки углов');
  var n = cells.length;
  var idx = [0, Math.min(3, n - 1), Math.max(0, n - 4), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
  idx.forEach(function (i) { cells[i].classList.add('is-target'); });
  return sleep(300).then(function () {
    var b = box.getBoundingClientRect(), bad = [];
    idx.forEach(function (i) {
      var r = cells[i].querySelector('.ring').getBoundingClientRect();
      if (r.left < b.left - 0.6 || r.right > b.right + 0.6 || r.top < b.top - 0.6 || r.bottom > b.bottom + 0.6) {
        bad.push(cname(cells[i]));
      }
    });
    idx.forEach(function (i) { cells[i].classList.remove('is-target'); });
    ok(!bad.length, 'кольцо срезано лентой: ' + bad.join(', '));
  });
});

// (2д) обе темы дают полный набор токенов
add('темы: светлая и тёмная задают все токены', function () {
  var was = UI.S.ui.theme;
  var keys = ['--bg', '--surface', '--text', '--muted', '--accent', '--wallet',
    '--lv-ok', '--lv-over', '--num-ok', '--num-over', '--tint-0', '--hue-0', '--ring', '--font'];
  ['light', 'dark'].forEach(function (th) {
    document.body.dataset.theme = th;
    var cs = getComputedStyle(document.body);
    keys.forEach(function (k) {
      ok(String(cs.getPropertyValue(k)).trim() !== '', th + ': нет токена ' + k);
    });
  });
  document.body.dataset.theme = was;
});

add('экран: плиток столько же, сколько сущностей', function () {
  var S = UI.S;
  eq(circles('exp').length, Engine.listCategories(S, 'exp').length, 'расходы');
  eq(circles('inc').length, Engine.listCategories(S, 'inc').length, 'доходы');
  var live = S.wallets.filter(function (w) { return !w.hidden; }).length;
  eq(circles('wallet').length, live, 'кошельки');
});

// (3) смысл броска
add('бросок: что означает источник → цель', function () {
  var a = UI.resolveDrop('wallet', 'w1', 'exp', 'e1');
  eq(a.kind + '|' + a.walletId + '|' + a.catId, 'exp|w1|e1', 'кошелёк → расход');
  var b = UI.resolveDrop('inc', 'i1', 'wallet', 'w1');
  eq(b.kind + '|' + b.catId + '|' + b.walletId, 'inc|i1|w1', 'доход → кошелёк');
  var c = UI.resolveDrop('wallet', 'w1', 'wallet', 'w2');
  eq(c.kind + '|' + c.walletId + '|' + c.toWalletId, 'transfer|w1|w2', 'кошелёк → кошелёк');
  eq(UI.resolveDrop('wallet', 'w1', 'wallet', 'w1'), null, 'сам в себя');
  eq(UI.resolveDrop('exp', 'e1', 'wallet', 'w1'), null, 'расход тащить нельзя');
  // та же развилка чистой ступенью в движке: подсветка и бросок берут её оттуда
  var kinds = ['inc', 'wallet', 'exp'];
  var want = { 'inc>wallet': true, 'wallet>exp': true, 'wallet>wallet': true };
  kinds.forEach(function (s) { kinds.forEach(function (t) {
    eq(Engine.dropAllowed(s, t), !!want[s + '>' + t], 'dropAllowed ' + s + '→' + t);
  }); });
});

// (4) перетаскивание кошелька на категорию открывает экран суммы
add('жест: кошелёк → категория открывает сумму', function () {
  var src = circle('wallet', 0), tgt = circle('exp', 0);
  ok(src && tgt, 'нет плиток для жеста');
  gesture(src, tgt);
  var am = document.getElementById('amount');
  ok(!am.hidden, 'экран суммы не открылся');
  eq(document.getElementById('amFrom').textContent, cname(src), 'откуда');
  eq(document.getElementById('amTo').textContent, cname(tgt), 'куда');
  UI.closeAmount();
});

// (4б) перевод между кошельками: соседи в одном ряду, жест почти горизонтальный.
// Раньше он целиком уходил в «это скролл ленты» и перевод мышкой был недоступен.
add('жест: кошелёк → кошелёк открывает перевод', function () {
  var src = circle('wallet', 0), tgt = circle('wallet', 1);
  ok(src && tgt, 'нужно минимум два кошелька');
  ok(Math.abs(center(tgt).y - center(src).y) < 8, 'кошельки должны стоять в одном ряду');
  gesture(src, tgt, 'mouse');
  ok(!document.getElementById('amount').hidden, 'экран суммы не открылся (жест приняли за скролл ленты)');
  eq(document.getElementById('amFrom').textContent, cname(src), 'откуда');
  eq(document.getElementById('amTo').textContent, cname(tgt), 'куда');
  UI.closeAmount();
});

// (4в) тактильный отклик: нажатие растит саму плитку, перенос — только ту цель,
// на которую бросок правда сработает
add('отклик: is-pressed на нажатии, is-target только на годной цели', function () {
  var src = circle('wallet', 0), tgt = circle('exp', 0), bad = circle('inc', 0);
  ok(src && tgt && bad, 'нужны кошелёк, расход и доход на экране');

  var a = center(tgt);
  withoutPanel(function () { pev(tgt, 'pointerdown', a.x, a.y, false, 'mouse'); });
  ok(tgt.classList.contains('is-pressed'), 'нажатая плитка без is-pressed');
  withoutPanel(function () { pev(document, 'pointerup', a.x, a.y, true, 'mouse'); });

  return sleep(260).then(function () {
    ok(!tgt.classList.contains('is-pressed'), 'is-pressed не снялся после отпускания');
    if (UI.cardOpen && UI.cardOpen()) UI.closeCard();
    if (!document.getElementById('amount').hidden) UI.closeAmount();
    return sleep(120);
  }).then(function () {
    withoutPanel(function () {
      var s = center(src), t = center(tgt), b = center(bad);
      pev(src, 'pointerdown', s.x, s.y, false, 'mouse');
      pev(document, 'pointermove', s.x + (t.x - s.x) / 2, s.y + (t.y - s.y) / 2, false, 'mouse');
      pev(document, 'pointermove', t.x, t.y, false, 'mouse');
      ok(tgt.classList.contains('is-target'), 'расход под кошельком не подсветился');
      ok(!src.classList.contains('is-target'), 'источник подсветил сам себя');
      pev(document, 'pointermove', b.x, b.y, false, 'mouse');
      ok(!bad.classList.contains('is-target'), 'доход подсветился под кошельком (бросок туда не работает)');
      ok(!tgt.classList.contains('is-target'), 'подсветка не снялась с прошлой цели');
      pev(document, 'pointercancel', b.x, b.y, true, 'mouse');
    });
    eq(document.querySelectorAll('.is-target, .is-pressed').length, 0, 'классов осталось после жеста');
    ok(!document.body.classList.contains('dragging'), 'режим переноса не выключился');
  });
});

// (4г) брак переноса: доход на расход. Цель не подсвечивается, на отпускании ничего
// не пишется, а призрак не исчезает рывком — он 200 мс уезжает домой (snapback).
add('брак переноса: доход на расход — тихий возврат без записи', function () {
  var src = circle('inc', 0), tgt = circle('exp', 0);
  ok(src && tgt, 'нужны доход и расход на экране');
  var txN = UI.S.tx.length, srcId = src.dataset.id;
  return withoutPanel(function () {
    var s = center(src), t = center(tgt);
    pev(src, 'pointerdown', s.x, s.y, false, 'mouse');
    for (var i = 1; i <= 6; i++) pev(document, 'pointermove', s.x + (t.x - s.x) * i / 6, s.y + (t.y - s.y) * i / 6, false, 'mouse');
    ok(document.body.classList.contains('dragging'), 'перенос не начался');
    ok(!tgt.classList.contains('is-target'), 'расход подсветился под доходом (бросок туда не работает)');
    ok(document.querySelector('.dragghost'), 'призрака под пальцем нет');
    pev(document, 'pointerup', t.x, t.y, true, 'mouse');
    // призрак ещё на экране: он уезжает домой 200 мс, а не пропадает мгновенно
    ok(document.querySelector('.dragghost'), 'призрак пропал сразу, без возврата');
    ok(!document.body.classList.contains('dragging'), 'режим переноса не выключился');
    eq(UI.S.tx.length, txN, 'на браке записалась операция');
    ok(document.getElementById('amount').hidden, 'экран суммы открылся на браке');
    return sleep(UI.SNAP_MS + 120).then(function () {
      ok(!document.querySelector('.dragghost'), 'призрак остался на экране после возврата');
      ok(!!document.querySelector('#fieldInc .circle[data-id="' + srcId + '"]'), 'плитка дохода не вернулась в своё поле');
      eq(document.querySelectorAll('.is-target').length, 0, 'подсветка осталась после возврата');
    });
  });
});

// (5) сохранённая операция меняет числа на кружках
add('операция меняет числа на плитках', function () {
  var S = UI.S;
  var wEl = circle('wallet', 0), cEl = circle('exp', 0);
  ok(wEl && cEl, 'нет плиток');
  var wId = wEl.dataset.id, cId = cEl.dataset.id;
  var bal0 = wEl.querySelector('.cbal').textContent;
  var num0 = cEl.querySelector('.cnum').textContent;
  forceReduced(true);                        // без анимации числа встают сразу — иначе меряем старое
  var tx = Engine.addTx(S, { kind: 'exp', amount: 777, catId: cId, walletId: wId, date: Engine.today() });
  UI.render();
  var bal1 = circle('wallet', 0).querySelector('.cbal').textContent;
  var num1 = document.querySelector('.circle[data-kind="exp"][data-id="' + cId + '"] .cnum').textContent;
  Engine.deleteTx(S, tx.id);
  UI.render();
  forceReduced(false);
  ok(bal1 !== bal0, 'баланс кошелька не изменился (' + bal0 + ')');
  ok(num1 !== num0, 'факт категории не изменился (' + num0 + ')');
});

// (6) в покое ничего не крутится
add('покой: ни одного кадра анимации за 800 мс', function () {
  var raf0 = window.requestAnimationFrame, n = 0;
  window.requestAnimationFrame = function (cb) { n++; return raf0.call(window, cb); };
  UI.render();
  return sleep(800).then(function () {
    window.requestAnimationFrame = raf0;
    eq(UI.animActive(), 0, 'живых анимаций');
    eq(n, 0, 'вызовов requestAnimationFrame');
  });
});

// (7) «меньше движения» ничего не ломает
add('меньше движения: animateTx молчит и не падает', function () {
  forceReduced(true);
  try {
    UI.animateTx({ kind: 'exp', amount: 100 }, circle('wallet', 0), circle('exp', 0));
    UI.animateTx({ kind: 'inc', amount: 100 }, circle('inc', 0), circle('wallet', 0));
  } finally { forceReduced(false); }
  eq(document.querySelectorAll('.flychip,.delta').length, 0, 'создано элементов анимации');
});

// Синк с ПК убран в автономном форке: проверки станции/связывания/факта удалены.

// (10) клавиатура суммы: состав клавиш и деление
add('клавиатура: 16 клавиш, есть ÷, деление считается', function () {
  var keys = [];
  var els = document.querySelectorAll('#amKeys .amk');
  for (var i = 0; i < els.length; i++) keys.push(els[i].getAttribute('data-k'));
  eq(keys.join(' '), '1 2 3 back 4 5 6 ÷ 7 8 9 × , 0 − +', 'раскладка');
  eq(UI.evalExpr('100÷4'), 25, '100÷4');
  eq(UI.evalExpr('3×4÷2'), 6, '3×4÷2');
  eq(UI.evalExpr('1000÷3'), 333.33, '1000÷3 округляется до копеек');
  ok(!isFinite(UI.evalExpr('10÷0')), 'деление на ноль не должно давать число');
  eq(UI.evalExpr('100÷'), 100, 'недобранный хвост оператора отбрасывается');
  ok(!isFinite(UI.evalExpr('alert(1)')), 'посторонний текст не считается');
});

// (11) мост к телефону: рантайм Capacitor загружен и в браузере ничего не ломает
add('мост: Capacitor загружен, в браузере не мешает', function () {
  ok(window.Capacitor, 'нет window.Capacitor - capacitor.js не подключён');
  ok(typeof Capacitor.registerPlugin === 'function', 'нет Capacitor.registerPlugin');
  ok(typeof window.isNativeApp === 'function', 'нет window.isNativeApp - native.js не подключён');
  eq(window.isNativeApp(), false, 'браузер прикинулся телефоном');
  UI.haptic('light');                                  // на браузере уходит в navigator.vibrate
});

// Синк с ПК и связывание убраны в автономном форке: проверки станции 503, авто-поиска
// в подсети, окна ошибки синка, «Связать заново» и восстановления из файла с компа удалены.

// (14) разряды: на главном экране не должно остаться слитных длинных чисел
add('разряды: на главном экране числа с пробелами', function () {
  var txt = document.getElementById('app').textContent;
  var clean = txt.replace(/\b(19|20)\d{2}\b/g, '');       // год в строке месяца — не сумма
  var bad = clean.match(/\d{4,}/g);
  eq(bad ? bad.join(', ') : '', '', 'числа без разделителя разрядов');
});

// (15) табло суммы: набранное число показывается с разрядами прямо во время ввода
add('разряды: набор 12500 показывает «12 500»', function () {
  var src = circle('wallet', 0), tgt = circle('exp', 0);
  ok(src && tgt, 'нет плиток для жеста');
  gesture(src, tgt, 'mouse');
  ok(!document.getElementById('amount').hidden, 'экран суммы не открылся; помехи: ' +
    JSON.stringify({ dlg: !document.getElementById('dlg').hidden,
      menu: document.getElementById('menu').classList.contains('open'),
      card: !!(UI.cardOpen && UI.cardOpen()),
      toast: !document.getElementById('toast').hidden,
      edit: document.body.classList.contains('editmode'),
      src: cname(src), tgt: cname(tgt),
      sc: withoutPanel(function () { var b = center(src), c = center(tgt);
        var e1 = document.elementFromPoint(b.x, b.y), e2 = document.elementFromPoint(c.x, c.y);
        return [e1 && e1.className, e2 && e2.className]; }) }));
  ['1', '2', '5', '0', '0'].forEach(function (k) {
    document.querySelector('#amKeys .amk[data-k="' + k + '"]').click();
  });
  var shown = document.getElementById('amExpr').textContent.replace(/[₽\s]+$/, '');
  eq(shown, '12' + Engine.NBSP + '500', 'табло');
  document.querySelector('#amKeys .amk[data-k="+"]').click();
  document.querySelector('#amKeys .amk[data-k="3"]').click();
  document.querySelector('#amKeys .amk[data-k="0"]').click();
  document.querySelector('#amKeys .amk[data-k="0"]').click();
  eq(document.getElementById('amMini').textContent, '12' + Engine.NBSP + '500+300', 'строка выражения');
  UI.closeAmount();
});

// (16) нижний лист карточки: заголовок, сумма, подпись со склонением, подсказка
add('карточка: лист собран по макету, подпись склоняется', function () {
  var w = circle('wallet', 0);
  ok(w, 'нет кошелька');
  var id = w.dataset.id;
  UI.openCard({ kind: 'wallet', id: id });
  ok(UI.cardOpen(), 'карточка не открылась');
  // счётчик под именем — операции этого кошелька ЗА ВЫБРАННЫЙ МЕСЯЦ, не за всю историю
  var n = Engine.txOfWallet(UI.S, id, UI.curYM()).length;
  eq(document.getElementById('cardSub').textContent,
    n ? n + ' ' + Engine.plural(n, 'операция', 'операции', 'операций') : 'операций пока нет', 'подпись');
  eq(document.getElementById('cardAmt').textContent,
    UI.money(Engine.walletBalance(UI.S, id)) + ' ₽', 'сумма на карточке');
  ok(document.getElementById('cardBase'), 'нет кнопки «Изменить баланс»');
  ok(document.getElementById('cardTransfer'), 'нет кнопки «Перевести»');
  ok(document.getElementById('cardSetup'), 'нет кнопки «Настроить»');
  ok(!document.getElementById('cardHide'), '«Скрыть» осталось в карточке: оно живёт в форме');
  ok(document.getElementById('cardHint'), 'нет подсказки хомяка');
  ok(document.getElementById('cardIco').classList.contains('wallet'), 'иконка кошелька без класса wallet');
  UI.closeCard();
  eq(UI.cardOpen(), false, 'карточка не закрылась');
});

// (17б) порченое хранилище: приложение не умирает, битый текст откладывается на разбор
add('порча базы: откат на пустое состояние, битое отложено в .broken', function () {
  var was = null;
  try { was = localStorage.getItem(UI.BROKEN_KEY); } catch (e) {}
  try { localStorage.removeItem(UI.BROKEN_KEY); } catch (e) {}
  try {
    // ровно те входы из ревью, что валили запуск целиком
    ['{"ver":1,"ui":{"order":"no"}}', '{обрезан', '"строка"', '[1,2,3]'].forEach(function (raw) {
      var st = null;
      try { st = UI.loadFrom(raw); } catch (e) { fail('loadFrom бросил на ' + raw + ': ' + e.message); }
      ok(st && typeof st === 'object', 'нет состояния для ' + raw);
      ok(Array.isArray(st.tx) && Array.isArray(st.wallets), 'форма поехала на ' + raw);
      ok(st.ui && Array.isArray(st.ui.order.exp), 'ui.order не массив на ' + raw);
    });
    var kept = null;
    try { kept = localStorage.getItem(UI.BROKEN_KEY); } catch (e) {}
    ok(kept, 'битый текст не отложен в ' + UI.BROKEN_KEY + ' — восстанавливать будет нечего');
    ok(typeof UI.wasRecovered() === 'boolean', 'нет признака восстановления');
  } finally {
    try {
      if (was === null) localStorage.removeItem(UI.BROKEN_KEY);
      else localStorage.setItem(UI.BROKEN_KEY, was);
    } catch (e) {}
  }
});

// (17в) отказ записи виден хозяину, а не проглатывается
add('отказ записи: save() возвращает false и вешает красную полосу', function () {
  var real = localStorage.setItem;
  var warn = document.getElementById('saveWarn');
  ok(warn, 'нет элемента #saveWarn');
  var res;
  try {
    localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
    res = UI.save();
  } finally {
    localStorage.setItem = real;
  }
  UI.closeDlg();                                  // окно «Не удалось сохранить» показали один раз
  eq(res, false, 'save() соврал про успех');
  eq(warn.hidden, false, 'красной полосы нет');
  ok(warn.textContent.indexOf('бэкап') >= 0, 'полоса не зовёт делать бэкап: ' + warn.textContent);
  eq(UI.save(), true, 'после починки хранилища save() не прошёл');
  eq(warn.hidden, true, 'полоса не убралась после успешной записи');
});

// (17г) выведенная категория: шапка и «Аналитика» об одних и тех же деньгах
add('выведенная категория: шапка и аналитика сходятся', function () {
  var S = UI.S;
  if (!S.plans || !S.plans.exp.length) { ok(true, 'без планов проверять нечего'); return; }
  var ymStr = UI.curYM();
  var victim = S.plans.exp[S.plans.exp.length - 1];
  var wasRetired = victim.retired;
  var w = S.wallets[0];
  ok(w, 'нет кошелька');
  var tx = Engine.addTx(S, { kind: 'exp', amount: 7000, catId: victim.id, walletId: w.id,
    date: ymStr < Engine.ym(Engine.today()) ? ymStr + '-10' : Engine.today() });
  try {
    victim.retired = true;                        // как будто категорию вывели на компе
    UI.render();
    var spent = Engine.summary(S, ymStr).spent;
    var rows = Engine.monthBreakdown(S, ymStr, 'exp');
    var sum = 0;
    rows.forEach(function (r) { sum += r.fact; });
    eq(sum, spent, 'сумма строк «Аналитики» разошлась с шапкой «Потрачено»');
    var row = null;
    rows.forEach(function (r) { if (r.catId === victim.id) row = r; });
    ok(row && row.fact === 7000, 'факта выведенной категории нет в разрезе');
    ok(row.retired === true, 'строка не помечена как выведенная');
    var tile = document.querySelector('#app .circle[data-id="' + victim.id + '"]');
    ok(tile && tile.classList.contains('retired'), 'плитка выведенной категории не приглушена');
  } finally {
    victim.retired = wasRetired;
    Engine.deleteTx(S, tx.id);
    UI.render();
  }
});

// (17) карточка категории: вместо кнопок строка «план · осталось»
add('карточка: у категории строка плана вместо кнопок', function () {
  var c = circle('exp', 0);
  ok(c, 'нет категории');
  UI.openCard({ kind: 'exp', id: c.dataset.id });
  ok(document.querySelector('#cardActs .sh-plan'), 'нет строки плана');
  ok(!document.getElementById('cardBase'), 'у категории не должно быть «Изменить баланс»');
  UI.closeCard();
});

// (18) меню: состав и порядок плиток. Карточка-статус («хомяк-помощник») убрана,
// плитки идут ровными парами: связь+вид, обновление+кошельки, звук+вибрация,
// подсказки+«О приложении», бэкап+восстановление. Проверка держит этот состав.
add('меню: ровно те плитки и в том порядке', function () {
  var ids = [].map.call(document.querySelectorAll('#menu .menu-list .mi'), function (b) { return b.id; });
  eq(ids.join(','), MENU_ORDER.join(','), 'состав меню');
  eq(document.querySelector('#mCats .mi-t').textContent, 'Настроить категории', 'подпись категорий');
  eq(document.querySelector('#mWallets .mi-t').textContent, 'Настроить кошельки', 'подпись кошельков');
  eq(document.querySelector('#mSound .mi-t').textContent, 'Звук', 'подпись звука');
  ok(!document.getElementById('mSummary'), 'в меню осталась «Аналитика месяца»');
  ok(!document.getElementById('mPair'), 'в меню остался «Связать с компом»');
  ok(!document.getElementById('mMonth'), 'в меню остался «Месяц»');
  ok(!document.getElementById('mStatus'), 'карточка-статус осталась в меню');
  ok(!document.querySelector('#menu .mcard'), 'в меню осталась разметка карточки-статуса');
  ok(document.getElementById('btnSummary'), 'кнопка аналитики должна остаться в шапке');
});

// (18а) плитки: у каждой своя иконка и подпись, счёт кошельков и версия - живые
add('меню: у плиток иконки, счёт кошельков и версия', function () {
  UI.openMenu();
  try {
    var tiles = document.querySelectorAll('#menu .menu-list .mi');
    eq(tiles.length, MENU_ORDER.length, 'число плиток');
    for (var i = 0; i < tiles.length; i++) {
      ok(tiles[i].querySelector('.mi-ic'), 'плитка без иконки: ' + tiles[i].id);
      ok(tiles[i].querySelector('.mi-s'), 'плитка без подписи: ' + tiles[i].id);
      var r = tiles[i].getBoundingClientRect();
      ok(r.height >= 80, 'плитка слишком низкая: ' + tiles[i].id + ' = ' + Math.round(r.height));
    }
    // сетка в две колонки: первые две плитки стоят на одной высоте
    eq(Math.round(tiles[0].getBoundingClientRect().top),
       Math.round(tiles[1].getBoundingClientRect().top), 'плитки не в две колонки');
    // «О приложении» — обычная половинная плитка: по ширине как соседняя, без плиток
    // во всю ширину, и число плиток чётное (пустых половинок в сетке нет)
    var about = document.getElementById('mAbout').getBoundingClientRect();
    ok(Math.abs(about.width - tiles[0].getBoundingClientRect().width) <= 2,
      'плитка «О приложении» не половинной ширины: ' + Math.round(about.width));
    ok(!document.querySelector('#menu .menu-list .mi.wide'), 'в меню осталась плитка во всю ширину');
    eq(tiles.length % 2, 0, 'нечётное число плиток — в сетке пустая половина');
    var n = UI.S.wallets.filter(function (w) { return !w.hidden; }).length;
    eq(document.getElementById('mWalletsInfo').textContent,
      n + ' ' + Engine.plural(n, 'кошелёк', 'кошелька', 'кошельков'), 'счёт кошельков');
    eq(document.getElementById('mUpdateInfo').textContent, 'версия ' + UI.appVersion(), 'версия на плитке');
    // значок темы = эмблема ТЕКУЩЕЙ темы (месяц/солнце), а не образец другой
    eq(document.getElementById('mThemeSwatch').getAttribute('data-theme-ic'),
      UI.S.ui.theme === 'dark' ? 'moon' : 'sun', 'значок темы не совпал с текущей темой');
  } finally { UI.closeMenu(); }
});

// Плитка синка убрана в автономном форке (нет связи с ПК, счётчика неотправленных,
// долга удалений) - проверка её состояния удалена.

// (18в2) выключатель вибрации нарисован в приложении и показывает настоящее состояние
add('меню: выключатель вибрации отражает настройку', function () {
  var was = UI.S.ui.haptics;
  try {
    UI.S.ui.haptics = true; UI.renderMenu();
    ok(document.getElementById('mHapticSw').classList.contains('on'), 'включённая вибрация без «on»');
    eq(document.getElementById('mHapticInfo').textContent, 'вкл', 'подпись «вкл»');
    document.getElementById('mHaptic').click();
    eq(UI.S.ui.haptics, false, 'тап по плитке не выключил вибрацию');
    ok(!document.getElementById('mHapticSw').classList.contains('on'), 'выключатель остался включённым');
    eq(document.getElementById('mHapticInfo').textContent, 'выкл', 'подпись «выкл»');
  } finally { UI.S.ui.haptics = was; UI.save(); UI.renderMenu(); }
});

// (18в3) выключатель звука: та же механика, что у вибрации, и своя настройка
add('меню: выключатель звука отражает настройку', function () {
  var was = UI.S.ui.sound;
  try {
    UI.S.ui.sound = true; UI.renderMenu();
    ok(document.getElementById('mSoundSw').classList.contains('on'), 'включённый звук без «on»');
    eq(document.getElementById('mSoundInfo').textContent, 'вкл', 'подпись «вкл»');
    eq(document.getElementById('mSound').getAttribute('aria-pressed'), 'true', 'aria-pressed');
    document.getElementById('mSound').click();
    eq(UI.S.ui.sound, false, 'тап по плитке не выключил звук');
    ok(!document.getElementById('mSoundSw').classList.contains('on'), 'выключатель остался включённым');
    eq(document.getElementById('mSoundInfo').textContent, 'выкл', 'подпись «выкл»');
    // вибрация - отдельная настройка, звук её не трогает
    eq(UI.S.ui.haptics !== false, true, 'звук выключил заодно и вибрацию');
  } finally { UI.S.ui.sound = was; UI.save(); UI.renderMenu(); }
});

// (18в4) звук: белый список имён и молчание, когда выключено
add('звук: чужие имена не играются, выключатель слышен', function () {
  ok(window.Sound, 'sound.js не загрузился');
  eq(Sound.NAMES.join(','), 'expense,income,transfer,over', 'набор звуков');
  var was = UI.S.ui.sound;
  try {
    UI.S.ui.sound = true;
    eq(Sound.play('нетакого'), false, 'сыграл звук, которого нет в списке');
    eq(Sound.play('sounds/expense.mp3'), false, 'принял путь вместо имени');
    UI.S.ui.sound = false;
    eq(Sound.play('expense'), false, 'играет при выключенном звуке');
  } finally { UI.S.ui.sound = was; Sound.reset(); }
});

// (18б) версия — из одного источника (version.js), в шапке меню только major.minor
add('меню: версия в шапке — только v<major.minor>, без оболочки/сборки', function () {
  ok(/^\d+\.\d+\.\d+$/.test(String(window.APP_VERSION || '')), 'APP_VERSION не задан или не «0.2.0»: ' + window.APP_VERSION);
  UI.openMenu();
  var mv = document.getElementById('menuVer').textContent;
  eq(mv, 'v' + UI.menuVersion(), 'номер в шапке меню');
  ok(/^v\d+\.\d+$/.test(mv), 'в шапке не «v0.4», а «' + mv + '»');
  ok(mv.indexOf('оболочка') < 0, 'в шапке осталась «оболочка»: ' + mv);
  UI.closeMenu();
});

// (18в) тема: название текущей темы, а переключение уводит на главный экран
add('меню: тема названа и переключение закрывает меню', function () {
  var was = UI.S.ui.theme;
  try {
    UI.openMenu();
    eq(document.getElementById('mThemeInfo').textContent,
      UI.S.ui.theme === 'dark' ? 'Ночная' : 'Дневная', 'название темы');
    // значок = эмблема ТЕКУЩЕЙ темы: месяц у ночной, солнце у дневной
    eq(document.getElementById('mThemeSwatch').getAttribute('data-theme-ic'),
      UI.S.ui.theme === 'dark' ? 'moon' : 'sun', 'значок не совпал с темой');
    document.getElementById('mTheme').click();
    ok(UI.S.ui.theme !== was, 'тема не переключилась');
    eq(document.getElementById('menu').classList.contains('open'), false, 'меню осталось открытым');
    eq(document.body.dataset.theme, UI.S.ui.theme, 'тело не перекрасилось');
    ok(document.getElementById('card').hidden !== false || !UI.cardOpen(), 'карточка осталась поверх');
    UI.openMenu();   // переключение закрыло меню — открываем заново, чтобы сверить подпись и значок
    eq(document.getElementById('mThemeInfo').textContent,
      UI.S.ui.theme === 'dark' ? 'Ночная' : 'Дневная', 'название новой темы');
    eq(document.getElementById('mThemeSwatch').getAttribute('data-theme-ic'),
      UI.S.ui.theme === 'dark' ? 'moon' : 'sun', 'значок не обновился под новую тему');
  } finally {
    UI.S.ui.theme = was; UI.save(); UI.render(); UI.closeMenu();
  }
});

// (18г) «О приложении» — одна страница без прокрутки: суть, «Как записывать
// операции» списком, автор и живая ссылка на сайт
add('меню: «О приложении» — суть, список, автор, ссылка, без прокрутки', function () {
  document.getElementById('mAbout').click();
  ok(UI.dlgOpen(), 'окно «О приложении» не открылось');
  var body = document.getElementById('dlgBody');
  ok(body.querySelector('.about'), 'окно не в стиле приложения (нет .about)');
  ok(body.querySelector('.ab-lead'), 'нет строки «что это»');
  ok(body.textContent.indexOf('без облака') >= 0, 'нет строки про приватность');
  ok(body.textContent.indexOf('v' + UI.menuVersion()) >= 0, 'нет короткого номера версии');
  ok(body.textContent.indexOf('Жесты и настройки') >= 0, 'нет заголовка «Жесты и настройки»');
  ok(body.textContent.indexOf('Ещё') < 0, 'остался старый заголовок «Ещё»');
  // «Как записывать операции» — маркированный список, каждый пункт своей строкой
  var items = [].map.call(body.querySelectorAll('.ab-list li'), function (li) { return li.textContent; });
  ok(items.length === 3, 'в списке не 3 пункта, а ' + items.length);
  ['кошелёк на категорию расхода - расход', 'источник дохода на кошелёк - доход',
   'кошелёк на кошелёк - перевод']
    .forEach(function (t, i) { eq(items[i], t, 'пункт ' + (i + 1)); });
  ok(body.textContent.indexOf('Финансовый консультант Алексей Дорохин') >= 0, 'нет строки автора');
  var a = body.querySelector('.ab-contacts .ab-link[data-ext]');
  ok(a && a.tagName === 'A', 'ссылка не ссылка');
  eq(a.getAttribute('href'), 'https://dorokhin-finance.ru', 'адрес ссылки');
  eq(a.textContent, 'dorokhin-finance.ru', 'подпись ссылки');
  ok(body.textContent.indexOf('avdorohin@') < 0 && !body.querySelector('a[href^="mailto:"]'), 'в «О приложении» осталась почта');
  // окно помечено свайпом вниз и своей плотной вёрсткой
  var dlg = document.getElementById('dlg');
  ok(dlg.classList.contains('dlg-swipe'), 'окно не помечено свайпом (dlg-swipe)');
  ok(dlg.classList.contains('dlg-about'), 'окно без плотной вёрстки (dlg-about)');
  // помещается без прокрутки: содержимое диалога не выше его видимой области
  ok(dlg.scrollHeight <= dlg.clientHeight + 1,
    'окно «О приложении» прокручивается: ' + dlg.scrollHeight + ' > ' + dlg.clientHeight);
  UI.closeDlg();
});

// (19) «Обновление»: окно «установлена версия» → «Проверить» с подставным сервером.
// Настоящая сеть не трогается — fetch подсовываем свой.
add('обновление: окно с подставным манифестом', function () {
  var manifest = {
    version: '9.9.9',
    apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-9.9.9.apk',
    size: 3120000,
    notes: 'новая версия для проверки'
  };
  function fakeFetch(body, status) {
    return function () {
      return Promise.resolve({ ok: status === undefined || status === 200, status: status || 200,
        text: function () { return Promise.resolve(body); } });
    };
  }

  document.getElementById('mUpdate').click();
  ok(UI.dlgOpen(), 'окно «Обновление» не открылось');
  var body = document.getElementById('dlgBody');
  ok(body.querySelector('.upd'), 'окно не в стиле приложения (нет .upd)');
  ok(body.textContent.indexOf('Установлена версия ' + UI.appVersion()) >= 0,
    'нет установленной версии: ' + body.textContent.slice(0, 80));
  var btns = document.getElementById('dlgBtns');
  eq(btns.lastChild.textContent, 'Проверить', 'нет кнопки «Проверить»');
  UI.closeDlg();

  // (а) есть новая версия
  return Update.check({ fetch: fakeFetch(JSON.stringify(manifest)) }).then(function () {
    var b = document.getElementById('dlgBody');
    eq(document.getElementById('dlgTitle').textContent, 'Есть обновление', 'заголовок');
    ok(b.textContent.indexOf('Версия 9.9.9') >= 0, 'нет номера новой версии: ' + b.textContent.slice(0, 80));
    ok(b.textContent.indexOf('3,0 МБ') >= 0, 'нет размера в МБ');
    ok(b.textContent.indexOf('новая версия для проверки') >= 0, 'нет «что нового»');
    ok(b.textContent.indexOf('Android предложит обновить') >= 0, 'нет подсказки про установку');
    eq(document.getElementById('dlgBtns').lastChild.textContent, 'Скачать', 'нет кнопки «Скачать»');
    eq(Update.newer(), '9.9.9', 'проверка не запомнила новую версию');
    ok(document.getElementById('mUpdate').classList.contains('has-upd'), 'на плитке «Обновление» нет отметки');
    UI.closeDlg();

    // (б) та же версия — «последняя»
    return Update.check({ fetch: fakeFetch(JSON.stringify(
      { version: UI.appVersion(), apkUrl: manifest.apkUrl, size: 1, notes: '' })) });
  }).then(function () {
    ok(document.getElementById('dlgBody').textContent.indexOf('последняя версия') >= 0,
      'не сказал, что версия последняя');
    eq(Update.newer(), '', 'после «последняя версия» отметка не снялась');
    ok(!document.getElementById('mUpdate').classList.contains('has-upd'), 'отметка на плитке осталась');
    UI.closeDlg();

    // (в) сети нет — честный текст, а не «всё хорошо»
    return Update.check({ fetch: function () { return Promise.reject(new TypeError('Failed to fetch')); } });
  }).then(function () {
    eq(document.getElementById('dlgBody').textContent, Update.ERR.net, 'текст про отсутствие сети');
    UI.closeDlg();

    // (г) сервер прислал мусор
    return Update.check({ fetch: fakeFetch('не json') });
  }).then(function () {
    eq(document.getElementById('dlgBody').textContent, Update.ERR.bad, 'текст про непонятный ответ');
    UI.closeDlg();
  });
});

// (19б) Бесшовное обновление: три исхода одной проверки на подставном манифесте.
// Сеть не трогается, на диск ничего не пишется - смотрим только окна и решение.
add('обновление: бесшовное, переустановка и «всё свежее»', function () {
  function fakeFetch(body) {
    return function () {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(body); } });
    };
  }
  var SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  var mine = UI.appVersion();
  function manifest(o) {
    return JSON.stringify({
      version: o.apk, apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-' + o.apk + '.apk',
      size: 3120000, notes: 'что нового в сборке',
      web: o.web ? {
        version: o.web, url: 'https://dorokhin-finance.ru/homyak/www-' + o.web + '.zip',
        sha256: SHA, size: 524288, minShell: o.minShell || '0'
      } : undefined
    });
  }

  // (а) веб-сборка новее, оболочка подходит - бесшовный путь
  return Update.check({ fetch: fakeFetch(manifest({ apk: mine, web: '9.9.9', minShell: '0' })) }).then(function () {
    var b = document.getElementById('dlgBody');
    eq(document.getElementById('dlgTitle').textContent, 'Есть обновление', 'заголовок бесшовного');
    ok(b.querySelector('.upd'), 'окно не в стиле приложения');
    ok(b.textContent.indexOf('Обновление 9.9.9') >= 0, 'нет номера: ' + b.textContent.slice(0, 90));
    ok(b.textContent.indexOf('0,5 МБ') >= 0, 'нет размера в МБ: ' + b.textContent.slice(0, 90));
    ok(b.textContent.indexOf('без переустановки') >= 0, 'не сказал, что переустанавливать не надо');
    ok(b.textContent.indexOf('что нового в сборке') >= 0, 'нет «что нового»');
    eq(Update.newer(), '9.9.9', 'проверка не запомнила версию');
    ok(document.getElementById('mUpdate').classList.contains('has-upd'), 'нет отметки на плитке');

    // в браузере обновляться некуда - честно говорим об этом и не рисуем кнопку
    var labels = [].map.call(document.getElementById('dlgBtns').children, function (e) { return e.textContent; });
    if (window.isNativeApp && window.isNativeApp()) {
      ok(labels.indexOf('Обновить') >= 0, 'на телефоне нет кнопки «Обновить»');
    } else {
      eq(labels.join('|'), 'Закрыть', 'в браузере лишние кнопки: ' + labels.join('|'));
      ok(b.textContent.indexOf(Update.ERR.onlyApp) >= 0, 'не сказал, что это только для телефона');
    }
    UI.closeDlg();

    // (б) веб-сборка новее, но требует оболочку из будущего - остаётся путь через APK
    return Update.check({ fetch: fakeFetch(manifest({ apk: '9.9.9', web: '9.9.9', minShell: '99.0.0' })) });
  }).then(function () {
    var b = document.getElementById('dlgBody');
    ok(b.textContent.indexOf('Версия 9.9.9') >= 0, 'нет номера APK: ' + b.textContent.slice(0, 90));
    ok(b.textContent.indexOf('Нужна переустановка приложения') >= 0, 'не предупредил про переустановку');
    eq(document.getElementById('dlgBtns').lastChild.textContent, 'Скачать', 'нет кнопки «Скачать»');
    UI.closeDlg();

    // (в) ничего нового ни там, ни там
    return Update.check({ fetch: fakeFetch(manifest({ apk: mine, web: mine, minShell: '0' })) });
  }).then(function () {
    var b = document.getElementById('dlgBody');
    ok(b.textContent.indexOf('последняя версия') >= 0, 'не сказал, что версия последняя');
    eq(Update.newer(), '', 'отметка «есть обновление» не снялась');
    ok(!document.getElementById('mUpdate').classList.contains('has-upd'), 'отметка на плитке осталась');
    UI.closeDlg();
  });
});

// (19в) Заслон от кирпича: решение об откате. Настоящий откат живёт в телефоне,
// а вот логика - чистая, её и дёргаем на подставных ключах.
add('обновление: откат битой сборки решается правильно', function () {
  ok(window.Boot && Boot.decide, 'boot.js не загрузился - откатывать битую сборку будет некому');
  function get(bag) { return function (k) { return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null; }; }
  var T = Boot.K_TRY, OK = Boot.K_OK;
  var bag;

  bag = {};
  eq(Boot.decide(get(bag), '0.3.1').action, 'none', 'без меток лезем куда не просят');

  bag = {}; bag[T] = JSON.stringify({ version: '0.3.1', boots: 0 });
  eq(Boot.decide(get(bag), '0.3.1').action, 'arm', 'первый запуск новой сборки не должен откатываться');

  bag = {}; bag[T] = JSON.stringify({ version: '0.3.1', boots: 1 });
  eq(Boot.decide(get(bag), '0.3.1').action, 'revert', 'сборка не завелась, а отката нет');

  bag = {}; bag[T] = JSON.stringify({ version: '0.3.1', boots: 1 }); bag[OK] = '0.3.1';
  eq(Boot.decide(get(bag), '0.3.1').action, 'clear', 'живую сборку собрался откатывать');

  bag = {}; bag[T] = 'не json';
  eq(Boot.decide(get(bag), '0.3.1').action, 'clear', 'на мусоре в метке падает');

  // сборка, которая сейчас работает, обязана иметь номер: без него откатывать нечего
  ok(/^\d+\.\d+/.test(UI.appVersion()), 'у сборки нет номера версии: ' + UI.appVersion());
  eq(UI.shellVersion(), String(window.SHELL_VERSION || UI.appVersion()), 'версия оболочки не читается');
});

// (19в2) Печать «сборка живая» не должна зависеть от разметки меню: раньше mount()
// выходил первой же строкой, если кнопки #mUpdate нет, и boot.js откатывал ИСПРАВНУЮ
// сборку на втором запуске. Перекраиваем меню и смотрим, доедет ли подтверждение.
add('обновление: печать живости ставится и без кнопки меню', function () {
  var btn = document.getElementById('mUpdate'), idWas = btn.id;
  var OK = Boot.K_OK, okWas = null;
  try { okWas = localStorage.getItem(OK); } catch (e) {}
  btn.id = 'mUpdateПереименовали';
  try { localStorage.removeItem(OK); } catch (e) {}
  Update.resetConfirm();
  Update.mount();                        // кнопки с прежним id нет - и это не мешает
  return new Promise(function (res) { setTimeout(res, 1700); }).then(function () {
    eq(localStorage.getItem(OK), UI.appVersion(), 'без кнопки меню сборка не подтвердила живость');
  }).then(function () {
    btn.id = idWas;
    if (okWas === null) { try { localStorage.removeItem(OK); } catch (e) {} }
    else { try { localStorage.setItem(OK, okWas); } catch (e) {} }
  }, function (e) {
    btn.id = idWas;
    throw e;
  });
});

// (19в3) Память о провале: версию, которая уже не завелась, канал не предлагает снова.
add('обновление: сломавшаяся версия второй раз не предлагается', function () {
  var K = Update.KEY.failK, was = null;
  try { was = localStorage.getItem(K); } catch (e) {}
  var sha = new Array(65).join('a');
  var m = Update.parseManifest({
    version: UI.shellVersion(), apkUrl: 'https://dorokhin-finance.ru/homyak/h.apk', size: 1, notes: '',
    web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/homyak/www-9.9.9.zip',
           sha256: sha, size: 100, minShell: '0' }
  });
  try {
    eq(Update.decide(m, UI.appVersion(), UI.shellVersion()).kind, 'ota', 'без памяти о провале обновление не предлагается');
    localStorage.setItem(K, JSON.stringify({ version: '9.9.9', count: 1, sha256: sha, shown: true }));
    eq(Update.decide(m, UI.appVersion(), UI.shellVersion(), Update.readFail()).kind, 'skipped',
      'сломавшуюся версию предлагают снова');
    // перевыложили тот же номер другим архивом - можно пробовать
    var m2 = Update.parseManifest({
      version: UI.shellVersion(), apkUrl: 'https://dorokhin-finance.ru/homyak/h.apk', size: 1, notes: '',
      web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/homyak/www-9.9.9.zip',
             sha256: new Array(65).join('b'), size: 100, minShell: '0' }
    });
    eq(Update.decide(m2, UI.appVersion(), UI.shellVersion(), Update.readFail()).kind, 'ota',
      'перевыложенный архив под тем же номером не пробуют');
  } finally {
    try { if (was === null) localStorage.removeItem(K); else localStorage.setItem(K, was); } catch (e) {}
  }
});

// (19г) Опись сборки: по ней приложение делает заводскую копию для отката.
add('обновление: files.json перечисляет всё нужное', function () {
  return fetch('files.json', { cache: 'no-store' }).then(function (r) {
    ok(r.ok, 'files.json не отдался: ' + r.status);
    return r.json();
  }).then(function (j) {
    ok(j && j.files && j.files.length > 10, 'опись пустая');
    eq(j.version, UI.appVersion(), 'версия описи разошлась с версией приложения');
    ['index.html', 'version.js', 'boot.js', 'ui.js', 'engine.js', 'update.js', 'style.css',
     'vendor/fflate.min.js', 'files.json'].forEach(function (f) {
      ok(j.files.indexOf(f) >= 0, 'в описи нет ' + f);
    });
    ok(j.files.indexOf('selftest.js') < 0, 'в опись пролез отладочный selftest.js');
  });
});


// (2е) ряд кошельков: карточка всегда в четверть ряда, сколько бы их ни было
add('кошельки: ширина карточки не зависит от их числа', function () {
  var snap = JSON.stringify(UI.S.wallets);
  function widths(n) {
    var ws = [];
    for (var i = 0; i < n; i++) {
      ws.push({ id: 'q' + i, name: 'К' + i, icon: 'wallet', color: 'yellow',
        base: 100, baseTs: 0, order: i, hidden: false });
    }
    UI.S.wallets = ws;
    UI.render();
    var strip = document.querySelector('#fieldWallets .strip');
    // в автономной сборке в ленте есть плитка «+ кошелёк» (.wcard.addtile) - её из счёта
    // настоящих кошельков исключаем
    var cards = strip.querySelectorAll('.wcard:not(.addtile)');
    var gap = 6;
    // Ряд карточек живёт внутри СТРАНИЦЫ ленты (.wpage), и запас под рост карточки
    // теперь её отступ, а не отступ ленты: ширину считаем по содержимому страницы.
    var page = strip.querySelector('.wpage') || strip;
    var pcs = getComputedStyle(page);
    var inner = page.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
    var want = (inner - 3 * gap) / 4;
    var got = [];
    for (var j = 0; j < cards.length; j++) got.push(cards[j].getBoundingClientRect().width);
    return { want: want, got: got, n: cards.length };
  }
  try {
    [1, 4, 6].forEach(function (n) {
      var r = widths(n);
      eq(r.n, n, 'карточек на экране при ' + n);
      r.got.forEach(function (w) {
        ok(Math.abs(w - r.want) < 1.5,
          n + ' кошельков: ширина ' + w.toFixed(1) + ' ≠ (ряд − 3×6)/4 = ' + r.want.toFixed(1));
      });
    });
    // шесть штук уже не влезают: лента должна ехать вбок
    var strip = document.querySelector('#fieldWallets .strip');
    ok(strip.scrollWidth - strip.clientWidth > 4, 'шесть кошельков не прокручиваются вбок');
  } finally {
    UI.S.wallets = JSON.parse(snap);
    UI.render();
  }
});

// (2ж) ни одной плитки без иконки — ни в демо, ни на настоящих названиях доходов
add('иконки: на каждой плитке есть картинка или глиф, пустых нет', function () {
  function checkAll(what) {
    var cs = document.querySelectorAll('#app .circle[data-id]');
    ok(cs.length > 0, what + ': плиток нет вовсе');
    for (var i = 0; i < cs.length; i++) {
      var im = cs[i].querySelector('.ico img'), svg = cs[i].querySelector('.ico svg');
      ok(im || svg, what + ': плитка «' + cname(cs[i]) + '» без иконки');
      if (im) ok(/^icons-color\/[a-z-]+\.png$/.test(im.getAttribute('src') || ''),
        what + ': у «' + cname(cs[i]) + '» кривой адрес картинки: ' + im.getAttribute('src'));
      else ok(svg.innerHTML.trim() !== '', what + ': у «' + cname(cs[i]) + '» пустой svg');
    }
  }
  checkAll('демо');

  // настоящие названия источников дохода из «Бюджета года»
  var snap = JSON.stringify(UI.S);
  try {
    var want = { 'Комса ICN': 'percent', 'Аренда, Кайе-т': 'homekey',
      'Курсы (1,3 …)': 'education', 'Подписка LF': 'play', 'Прочее': 'other' };
    var names = Object.keys(want);
    names.forEach(function (n) {
      eq(Icons.guessKind(n, 'inc'), want[n], 'подбор иконки для «' + n + '»');
    });
    // автономный форк: источники дохода - живые категории на телефоне, не «планы с ПК»;
    // иконка подбирается по имени (guessKind) и кладётся прямо в категорию.
    UI.S.icons = {};
    UI.S.categories.inc = [];
    UI.S.ui.order.inc = [];
    names.forEach(function (n) { Engine.addCategory(UI.S, 'inc', { name: n, icon: Icons.guessKind(n, 'inc') }); });
    UI.render();
    checkAll('живые названия доходов');
    // запасная иконка (other) допустима только там, где категория так и называется
    var inc = document.querySelectorAll('#app .circle[data-kind="inc"]');
    for (var k = 0; k < inc.length; k++) {
      var nm = cname(inc[k]);
      if (/проч|друго|разное/i.test(nm)) continue;
      var box = inc[k].querySelector('.ico'), pic = box.querySelector('img');
      ok(pic ? !/\/other(-inc)?\.png$/.test(pic.getAttribute('src') || '')
             : box.innerHTML.indexOf('circle cx="6" cy="12"') < 0,
        'источник «' + nm + '» остался с запасной иконкой «прочее»');
    }
  } finally {
    UI.S = Engine.migrate(JSON.parse(snap));
    UI.render();
  }
});

// (0.3.1) Цветные иллюстрации доходов и расходов: там, где под ключ есть картинка,
// на плитке обязана быть именно она - и она обязана догрузиться (битых нет).
// Кошельки остаются на линейных глифах.
add('иконки: доходы и расходы - цветные картинки, битых нет', function () {
  var cs = document.querySelectorAll('#app .circle[data-kind="inc"], #app .circle[data-kind="exp"]');
  ok(cs.length > 0, 'плиток доходов и расходов нет');
  var imgs = [];
  for (var i = 0; i < cs.length; i++) {
    var el = cs[i], kind = el.dataset.kind;
    // как в render (ui.js): иконка плитки = c.icon категории, иначе подбор по имени
    var f = Engine.findCategory(UI.S, el.dataset.id);
    var key = (f && f.cat.icon) || UI.S.icons[el.dataset.id] || Icons.guessKind(cname(el), kind);
    var im = el.querySelector('.ico img');
    if (Icons.hasImg(key, kind)) {
      ok(im, 'у «' + cname(el) + '» ключ ' + key + ' с картинкой, а на плитке глиф');
      eq(im.getAttribute('src'), 'icons-color/' + Icons.imgFile(key, kind) + '.png',
        'адрес картинки «' + cname(el) + '»');
      imgs.push(im);
    } else {
      // без иллюстрации — цветная фишка (диск + глиф), а НЕ голый линейный глиф
      var chip = el.querySelector('.ico .ico-chip');
      ok(!im && chip, 'у «' + cname(el) + '» ключ ' + key + ' без картинки, а цветной фишки нет');
      if (chip) {
        ok(/<circle[^>]*fill="rgba\(/.test(chip.innerHTML), 'у «' + cname(el) + '» фишка без цветного диска');
        ok(el.querySelector('.ico > svg:not(.ico-chip)') == null, 'у «' + cname(el) + '» остался голый глиф');
      }
    }
  }
  ok(imgs.length > 0, 'ни одной цветной картинки на экране');
  // кошельки не тронуты: у них по-прежнему svg
  var wal = document.querySelector('#app .wcard .ico');
  ok(wal && wal.querySelector('svg') && !wal.querySelector('img'), 'кошелёк уехал на картинку');
  // картинка не перехватывает палец: плитку носят и за иконку
  eq(getComputedStyle(imgs[0]).pointerEvents, 'none', 'картинка ловит касания');
  // дожидаемся загрузки и проверяем, что файлы реально нашлись
  return Promise.all(imgs.map(function (im) {
    if (im.complete) return null;
    return new Promise(function (res) {
      im.addEventListener('load', res, { once: true });
      im.addEventListener('error', res, { once: true });
      setTimeout(res, 3000);
    });
  })).then(function () {
    imgs.forEach(function (im) {
      ok(im.complete && im.naturalWidth > 0, 'картинка не загрузилась: ' + im.getAttribute('src'));
    });
  });
});

// (0.4.4) Ни одной категории с голым линейным глифом: у ключа без иллюстрации —
// цветная фишка (диск + глиф в тоне категории). Проверяем на синтетическом наборе
// доходов с ключами, у которых картинки нет («star», «pie», «globe», «music»).
add('иконки: категории без картинки — цветная фишка, не голая линия', function () {
  var snap = JSON.stringify(UI.S);
  try {
    // hueFor детерминирована и в диапазоне палитры
    ['a', 'Комса ICN', 'Родин (1,3 млн)', 'Рента Финам', '', 'star'].forEach(function (k) {
      var h = Icons.hueFor(k);
      ok(h === (h | 0) && h >= 0 && h < 6, 'hueFor(' + JSON.stringify(k) + ') вне палитры: ' + h);
      eq(Icons.hueFor(k), Icons.hueFor(k), 'hueFor нестабильна для ' + JSON.stringify(k));
    });
    // фишка всегда цветная: диск с rgba-заливкой и тонированный глиф
    var c = Icons.chip('star', 'inc', 26, 'Родин (1,3 млн)');
    ok(/class="ico-chip"/.test(c), 'chip без класса ico-chip');
    ok(/<circle[^>]*fill="rgba\(/.test(c), 'chip без цветного диска');
     ok(/stroke="#/.test(c), 'chip без цветного глифа');

    // автономный форк: заводим живые источники дохода с иконками без картинки
    var oddNames = ['Комса ICN', 'Родин (1,3 млн)', 'Рента Финам', 'Хренотень 42', 'ЫЪЬ'];
    var oddIcons = ['star', 'pie', 'globe', 'music', 'skull'];
    UI.S.icons = {};
    UI.S.categories.inc = [];
    UI.S.ui.order.inc = [];
    oddNames.forEach(function (n, i) { Engine.addCategory(UI.S, 'inc', { name: n, icon: oddIcons[i] }); });
    UI.render();
    var inc = document.querySelectorAll('#app .circle[data-kind="inc"]');
    ok(inc.length > 0, 'нет плиток дохода в синтетике');
    for (var i = 0; i < inc.length; i++) {
      var box = inc[i].querySelector('.ico');
      var chip = box.querySelector('.ico-chip'), pic = box.querySelector('img');
      ok(chip && !pic, 'у «' + cname(inc[i]) + '» не цветная фишка (голый глиф/пусто)');
      // именно фишка, а не голый svg без диска
      ok(box.innerHTML.indexOf('fill="rgba(') >= 0, 'у «' + cname(inc[i]) + '» фишка без цветного диска');
    }
  } finally {
    UI.S = Engine.migrate(JSON.parse(snap));
    UI.render();
  }
});

// (0.3.1) Сетка выбора: у категории - те же картинки, что окажутся на плитке,
// у кошелька - прежние глифы.
add('иконки: в листе выбора у категорий картинки, у кошельков глифы', function () {
  try {
    UI.openIconSheet({ title: 'Иконка категории', kind: 'exp', cur: 'cart', onPick: function () {} });
    var g = document.getElementById('icGrid');
    ok(g.querySelectorAll('.icbtn').length > 10, 'сетка иконок пустая');
    var cart = g.querySelector('.icbtn[data-ic="cart"] img');
    ok(cart && cart.getAttribute('src') === 'icons-color/cart.png', 'в сетке расходов нет картинки «Магазины»');
    // старый ключ без картинки живёт глифом в той же сетке
    var star = g.querySelector('.icbtn[data-ic="star"]');
    ok(star && star.querySelector('svg') && !star.querySelector('img'), 'у ключа без картинки не остался глиф');
    UI.closeIconSheet();

    UI.openIconSheet({ title: 'Иконка источника', kind: 'inc', cur: 'gift', onPick: function () {} });
    var gift = document.getElementById('icGrid').querySelector('.icbtn[data-ic="gift"] img');
    ok(gift && gift.getAttribute('src') === 'icons-color/gift-inc.png', 'у дохода не свой вариант подарка');
    UI.closeIconSheet();

    UI.openIconSheet({ title: 'Иконка кошелька', kind: 'wallet', cur: 'card', onPick: function () {} });
    var wg = document.getElementById('icGrid');
    var card = wg.querySelector('.icbtn[data-ic="card"]');
    ok(card && card.querySelector('svg') && !card.querySelector('img'), 'кошельки уехали на картинки');
    // в листе кошелька — только кошельковый набор, без категорийных иконок
    var wbtns = [].slice.call(wg.querySelectorAll('.icbtn'));
    eq(wbtns.length, Icons.SETS.wallet.length, 'в листе кошелька не ровно кошельковый набор');
    var wset = {}; Icons.SETS.wallet.forEach(function (k) { wset[k] = 1; });
    var leak = wbtns.map(function (b) { return b.getAttribute('data-ic'); })
      .filter(function (k) { return !wset[k]; });
    eq(leak.join(','), '', 'в лист кошелька просочились не-кошельковые иконки');
    // каждая иконка кошелька — монохромный глиф, не цветная картинка/фишка
    var colored = wbtns.filter(function (b) { return b.querySelector('img') || b.querySelector('.ico-chip'); });
    eq(colored.length, 0, 'иконка кошелька нарисована цветной, а не монохромным глифом');
    // новые глифы на месте
    ['qr', 'deposit', 'salcard'].forEach(function (k) {
      ok(wg.querySelector('.icbtn[data-ic="' + k + '"]'), 'в наборе кошельков нет ' + k);
    });
  } finally {
    UI.closeIconSheet();
  }
});

// (0.4.6) плитка кошелька рисует монохромный глиф в цвет кошелька, не цветную фишку/картинку
add('кошельки: плитка рисует монохромный глиф, не цветную фишку', function () {
  var els = document.querySelectorAll('#app .circle[data-kind="wallet"]');
  ok(els.length, 'нет плиток кошельков на экране');
  [].forEach.call(els, function (el) {
    var ico = el.querySelector('.ico');
    ok(ico && ico.querySelector('svg'), 'у кошелька нет линейного глифа');
    ok(!ico.querySelector('img'), 'кошелёк нарисован картинкой');
    ok(!ico.querySelector('.ico-chip'), 'кошелёк нарисован цветной фишкой');
  });
});

// (2з) план дохода виден и на плитке, и в заголовке
add('доходы: под плиткой строка плана месяца', function () {
  var S = UI.S, ymStr = UI.curYM();
  var t = circle('inc', 0);
  ok(t, 'нет плиток доходов');
  var id = t.dataset.id;
  var plan = Engine.planOr0(S, id, ymStr);
  if (!(plan > 0)) { ok(true, 'у первого источника нет плана в демо — проверять нечего'); return; }
  var el = t.querySelector('.cplan');
  ok(el, 'у плитки дохода нет строки плана');
  eq(el.textContent, UI.fmt(plan) + ' ₽', 'строка плана');
  ok(getComputedStyle(el).display !== 'none', 'строка плана спрятана стилем');
  var s = Engine.summary(S, ymStr);
  var sum = 0;
  Engine.listCategories(S, 'inc').forEach(function (c) { sum += Engine.planOr0(S, c.id, ymStr); });
  eq(s.earnedPlan, Math.round(sum), 'summary.earnedPlan');
});

// (2и) поле суммы: ноль уходит по тапу, пустое возвращается нулём
add('ввод: 0 в поле баланса стирается на тапе', function () {
  var el = document.createElement('input');
  el.className = 'inp'; el.type = 'text'; el.value = '0';
  document.body.appendChild(el);
  try {
    UI.moneyInput(el);
    el.dispatchEvent(new Event('focus'));
    eq(el.value, '', 'ноль не ушёл по фокусу');
    el.dispatchEvent(new Event('blur'));
    eq(el.value, '0', 'пустое поле не вернулось нулём');
    el.value = '12500';
    el.dispatchEvent(new Event('blur'));
    eq(el.value, Engine.fmt(12500), 'разряды по blur');
    el.value = Engine.fmt(12500);
    el.dispatchEvent(new Event('focus'));
    eq(el.value, Engine.fmt(12500), 'непустое значение стёрли зря');
  } finally {
    document.body.removeChild(el);
  }
});

// (2к) цвет кошелька: класс на карточке, палитра рисуется, старые кошельки жёлтые
add('кошельки: цвет живёт классом и переживает migrate', function () {
  var w = UI.S.wallets[0];
  var el = document.querySelector('#app .circle[data-kind="wallet"][data-id="' + w.id + '"]');
  ok(el, 'нет карточки первого кошелька');
  ok(el.classList.contains('wc-' + Engine.walletColor(w.color)), 'на карточке нет класса цвета: ' + el.className);
  var bg = getComputedStyle(el).backgroundImage;
  ok(bg && bg.indexOf('gradient') >= 0, 'фон карточки не градиент: ' + bg);
  var old = Engine.migrate({ ver: 1, wallets: [{ id: 'w9', name: 'Старый', base: 0 }] });
  eq(old.wallets[0].color, 'yellow', 'кошелёк из старой версии стал не жёлтым');
  eq(Engine.walletColor('чужое'), 'yellow', 'чужой ключ цвета не откатился к жёлтому');
  eq(Engine.WALLET_COLORS.length, 10, 'в палитре не десять цветов');
});

// (2л) лист выбора иконки: открывается поверх формы, тап выбирает и закрывает
add('иконка: сетка выехала из формы в отдельный лист', function () {
  var body = document.getElementById('dlgBody');
  UI.addWallet();
  ok(!body.querySelector('.icgrid'), 'сетка иконок снова живёт прямо в форме');
  ok(body.querySelector('.icrow .icprev') && document.getElementById('awIcoBtn'),
    'в форме нет строки «иконка + Изменить»');
  eq(body.querySelectorAll('#awColors .cw').length, 10, 'в форме не десять образцов цвета');

  var nameEl = document.getElementById('awName');
  nameEl.value = 'Т-Банк';
  nameEl.dispatchEvent(new Event('input', { bubbles: true }));
  ok(sameIcon(document.getElementById('awIco'), 'card'), 'иконка не подсказалась по названию');

  document.getElementById('awIcoBtn').click();
  ok(!document.getElementById('icSheet').hidden, 'лист иконок не открылся');
  ok(!document.getElementById('dlg').hidden, 'форма кошелька закрылась под листом');
  var btn = document.querySelector('#icGrid .icbtn[data-ic="piggy"]');
  ok(btn, 'в листе нет иконки «Копилка»');
  btn.click();
  ok(document.getElementById('icSheet').hidden, 'лист не закрылся после выбора');
  ok(sameIcon(document.getElementById('awIco'), 'piggy'), 'выбранная иконка не встала в форму');
  UI.closeDlg();
});

// (2м) добавил кошелёк — вернулись в список, а не на главный экран
add('кошельки: после «Добавить» возвращаемся в список', function () {
  var snap = JSON.stringify(UI.S.wallets);
  try {
    UI.openWallets();
    eq(document.getElementById('dlgTitle').textContent, 'Кошельки', 'список не открылся');
    document.getElementById('wlAdd').click();
    eq(document.getElementById('dlgTitle').textContent, 'Новый кошелёк', 'форма не открылась');
    document.getElementById('awName').value = 'Проверка';
    document.getElementById('dlgBtns').lastChild.click();
    eq(document.getElementById('dlgTitle').textContent, 'Кошельки', 'после добавления ушли не в список');
    ok(!document.getElementById('dlg').hidden, 'диалог закрылся совсем');
    ok(document.getElementById('dlgBody').textContent.indexOf('Проверка') >= 0, 'новый кошелёк не виден в списке');
    UI.closeDlg();
  } finally {
    UI.S.wallets = JSON.parse(snap);
    UI.save(); UI.render();
  }
});

// (2м2) список кошельков закрывается свайсом вниз по шапке; обычное окно — нет
add('кошельки: список закрывается свайпом вниз по шапке', function () {
  UI.openWallets();
  try {
    ok(!document.getElementById('dlg').hidden, 'список кошельков не открылся');
    ok(document.getElementById('dlg').classList.contains('dlg-swipe'), 'на списке нет метки свайпа');
    var grip = document.querySelector('#dlg .dlg-grip');
    ok(grip, 'у диалога нет ручки');
    var r = grip.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    pev(grip, 'pointerdown', x, y, false, 'touch');
    pev(document, 'pointermove', x, y + 90, false, 'touch');   // 90 px вниз ≥ порога 80
    pev(document, 'pointerup', x, y + 90, true, 'touch');
    ok(document.getElementById('dlg').hidden, 'свайп вниз по шапке не закрыл список');

    // обычное окно (без метки) тем же жестом не закрывается
    UI.dlgAlert('проверка', 'Заголовок');
    ok(!document.getElementById('dlg').classList.contains('dlg-swipe'), 'на обычном окне осталась метка свайпа');
    var g2 = document.querySelector('#dlg .dlg-grip'), r2 = g2.getBoundingClientRect();
    var x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;
    pev(g2, 'pointerdown', x2, y2, false, 'touch');
    pev(document, 'pointermove', x2, y2 + 90, false, 'touch');
    pev(document, 'pointerup', x2, y2 + 90, true, 'touch');
    ok(!document.getElementById('dlg').hidden, 'обычное окно закрылось свайпом (не должно)');
  } finally {
    if (!document.getElementById('dlg').hidden) UI.closeDlg();
  }
});

// (2н) иконку источника дохода меняем прямо из его карточки
add('карточка: у источника дохода есть строка смены иконки', function () {
  var t = circle('inc', 0);
  ok(t, 'нет плиток доходов');
  var id = t.dataset.id, was = UI.S.icons[id];
  UI.openCard({ kind: 'inc', id: id });
  var btn = document.getElementById('cardIcoBtn');
  ok(btn, 'в карточке источника нет кнопки «Изменить»');
  ok(document.getElementById('cardIcoPrev'), 'в карточке нет превью иконки');
  btn.click();
  ok(!document.getElementById('icSheet').hidden, 'лист иконок не открылся из карточки');
  var pick = document.querySelector('#icGrid .icbtn[data-ic="star"]');
  ok(pick, 'в листе нет иконки «Бонусы»');
  pick.click();
  eq(UI.S.icons[id], 'star', 'иконка источника не сохранилась');
  UI.closeCard();
  UI.hideToast();
  UI.S.icons[id] = was; UI.save(); UI.render();
});

// (2о) шапка меню: хомяк слева от названия. Именно hamster.png: icon-512.png лежит
// в DEV_ONLY, в APK не едет, и на телефоне вместо иконки была битая картинка.
add('меню: хомяк в шапке и номер версии рядом', function () {
  var disc = document.querySelector('#menu .menu-head .menu-app');
  var img = disc ? disc.querySelector('img') : null;
  ok(img, 'в шапке меню нет хомяка');
  ok(/hamster\.png$/.test(img.getAttribute('src')), 'в шапке меню не hamster.png: ' + img.getAttribute('src'));
  var r = disc.getBoundingClientRect();
  eq(Math.round(r.width), 48, 'диск хомяка не 48 px');
  eq(Math.round(r.height), 48, 'диск хомяка не круглый');
  ok(document.getElementById('menuVer').textContent.indexOf('v') === 0, 'в шапке нет версии');
});


// ---------- 0.3.0: удаление кошелька, крупные иконки, край поля, «Сохранить как» ----------

// (3а) движок: удаление кошелька уносит его операции, скрытие — нет
add('кошелёк: удаление уносит историю, скрытие оставляет', function () {
  var S = Engine.defaultState();
  var a = Engine.addWallet(S, { name: 'A', base: 1000 });
  var b = Engine.addWallet(S, { name: 'B', base: 0 });
  a.baseTs = 0; b.baseTs = 0;
  Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: a.id, date: '2026-03-01' });
  Engine.addTx(S, { kind: 'transfer', amount: 50, walletId: a.id, toWalletId: b.id, date: '2026-03-02' });
  Engine.addTx(S, { kind: 'exp', amount: 70, catId: 'e1', walletId: b.id, date: '2026-03-03' });
  eq(Engine.walletTxCount(S, a.id), 2, 'счёт операций кошелька');

  // скрытие: кошелёк на месте, операции на месте
  Engine.updateWallet(S, a.id, { hidden: true });
  eq(S.tx.length, 3, 'скрытие тронуло операции');
  Engine.updateWallet(S, a.id, { hidden: false });

  var r = Engine.deleteWallet(S, a.id);
  eq(r.removed, 2, 'сколько операций ушло');
  eq(Engine.findWallet(S, a.id), null, 'кошелёк остался после удаления');
  eq(S.tx.length, 1, 'чужие операции пострадали');
  eq(Engine.deleteWallet(S, a.id), null, 'удалил несуществующий кошелёк');
});

// (3б) форма кошелька: «Скрыть» и «Удалить» рядом. Удаление - обычный confirm на две
// кнопки «Удалить»/«Отмена»: у пустого кошелька коротко, у кошелька с историей честный
// текст с числом операций. Прежнего третьего выбора в самом окне больше нет.
add('кошелёк: в форме есть «Удалить», окно на две кнопки считает операции', function () {
  var w = Engine.addWallet(UI.S, { name: 'Тестовый', base: 0 });
  UI.save(); UI.render();
  try {
    UI.editCircle({ kind: 'wallet', id: w.id });
    ok(document.getElementById('ecHide'), 'в форме нет кнопки «Скрыть»');
    var del = document.getElementById('ecDel');
    ok(del, 'в форме нет кнопки «Удалить»');
    ok(del.classList.contains('danger'), 'кнопка «Удалить» не опасная');

    // (а) операций нет — короткое подтверждение на две кнопки
    del.click();
    var labels = [].map.call(document.getElementById('dlgBtns').children, function (e) { return e.textContent; });
    eq(labels.join('|'), 'Отмена|Удалить', 'кнопки простого удаления: ' + labels.join('|'));
    eq(document.getElementById('dlgBody').textContent, 'Удалить кошелёк «Тестовый»?',
      'текст простого удаления: ' + document.getElementById('dlgBody').textContent);
    UI.closeDlg();

    // (б) операции есть — те же две кнопки и честный текст, без третьего выбора
    Engine.addTx(UI.S, { kind: 'exp', amount: 10, catId: 'e1', walletId: w.id, date: Engine.today() });
    Engine.addTx(UI.S, { kind: 'exp', amount: 20, catId: 'e1', walletId: w.id, date: Engine.today() });
    UI.save();
    UI.editCircle({ kind: 'wallet', id: w.id });
    document.getElementById('ecDel').click();
    var body = document.getElementById('dlgBody').textContent;
    ok(body.indexOf('У кошелька «Тестовый» 2 операции') === 0, 'нет счёта операций: ' + body.slice(0, 60));
    ok(body.indexOf('сохранить историю') > 0, 'не предложил сохранить историю');
    // синк с ПК убран в форке: прежнего предупреждения «изменится в Бюджете» здесь больше нет
    ok(body.indexOf('«Скрыть»') > 0, 'не напомнил про «Скрыть»');
    var l2 = [].map.call(document.getElementById('dlgBtns').children, function (e) { return e.textContent; });
    // ровно две кнопки: прежнего третьего выбора в окне удаления больше нет
    eq(l2.join('|'), 'Отмена|Удалить', 'кнопки удаления с историей: ' + l2.join('|'));
    eq(l2.length, 2, 'в окне удаления не две кнопки: ' + l2.join('|'));

    // жмём «Удалить» — кошелька и его операций не остаётся
    var kids = document.getElementById('dlgBtns').children;
    kids[kids.length - 1].click();
    eq(Engine.findWallet(UI.S, w.id), null, 'кошелёк не удалился');
    eq(Engine.walletTxCount(UI.S, w.id), 0, 'операции удалённого кошелька остались');
  } finally {
    UI.closeDlg(); UI.hideToast();
    if (Engine.findWallet(UI.S, w.id)) Engine.deleteWallet(UI.S, w.id);
    UI.save(); UI.render();
  }
});

// (4а) иконки крупнее: в кольце 28, на карточке кошелька 20
add('иконки: крупные глифы в плитке и на кошельке', function () {
  var ring = document.querySelector('#app .circle[data-kind="exp"] .ring .ico img, #app .circle[data-kind="exp"] .ring .ico svg');
  ok(ring, 'нет иконки в плитке расхода');
  var pic = ring.tagName.toLowerCase() === 'img';
  var r = ring.getBoundingClientRect();
  var ringBox = ring.closest('.ring').getBoundingClientRect();
  var geo = Engine.ringGeom(Math.round(ringBox.width));
  // глиф — половина кольца, картинка — 0.62 (у неё свои поля), каким бы кольцо ни было
  var want = pic ? Math.round(geo.size * 0.62) : geo.ico;
  ok(Math.abs(r.width - want) <= 1.5, 'иконка не по размеру кольца: ' + Math.round(r.width) + ' при ' + geo.size);
  // Кольцу должно остаться чем дышать. У картинки меряем не коробку, а краску:
  // прозрачные поля занимают около 11% ширины (проверено по всем 49 файлам).
  var ink = pic ? r.width * 0.89 : r.width;
  ok((ringBox.width - 2 * geo.sw - ink) / 2 >= 6,
    'иконке тесно в кольце: зазор ' + ((ringBox.width - 2 * geo.sw - ink) / 2).toFixed(1));
  var wal = document.querySelector('#app .wcard .ico svg');
  ok(wal, 'нет иконки на карточке кошелька');
  eq(Math.round(wal.getBoundingClientRect().width), 22, 'глиф кошелька не 22');
});

// (4б) шапка: кнопка аналитики ростом со сводку, а не ниже её
add('шапка: кнопка аналитики вровень со сводкой', function () {
  var sums = document.getElementById('sums').getBoundingClientRect();
  var btn = document.getElementById('btnSummary').getBoundingClientRect();
  ok(Math.abs(sums.height - btn.height) <= 1,
    'высоты разошлись: сводка ' + Math.round(sums.height) + ', кнопка ' + Math.round(btn.height));
  ok(Math.abs(sums.top - btn.top) <= 1, 'кнопка не на одной линии со сводкой');
  ok(Math.abs(sums.bottom - btn.bottom) <= 1, 'низ кнопки не совпал с низом сводки');
});

// (6а) край поля: чистая функция, по которой листаются страницы в режиме правки
add('правка: край поля считается одинаково слева и справа', function () {
  var rect = { left: 100, right: 300, width: 200 };
  eq(UI.edgeSide(100, rect), -1, 'сам левый край');
  eq(UI.edgeSide(120, rect), -1, 'в 20 px от левого края');
  eq(UI.edgeSide(124, rect), -1, 'ровно на границе зоны слева');
  eq(UI.edgeSide(125, rect), 0, 'уже не край');
  eq(UI.edgeSide(200, rect), 0, 'середина');
  eq(UI.edgeSide(275, rect), 0, 'ещё не край справа');
  eq(UI.edgeSide(276, rect), 1, 'в 24 px от правого края');
  eq(UI.edgeSide(300, rect), 1, 'сам правый край');
  eq(UI.edgeSide(150, rect, 60), -1, 'своя ширина зоны не работает');
  eq(UI.edgeSide(150, null), 0, 'без прямоугольника должен быть 0');
  eq(UI.edgeSide(150, { left: 0, right: 0, width: 0 }), 0, 'схлопнутое поле — не край');
});

// (3в) бэкап: имя файла человеческое, с датой и по-русски
add('бэкап: имя файла с датой', function () {
  var n = Backup.fileName();
  ok(/^Хомяк-бэкап-\d{4}-\d{2}-\d{2}\.json$/.test(n), 'имя файла бэкапа: ' + n);
  // кириллица в base64 не должна ломаться: обратный разбор даёт ту же строку
  var b = Backup.toBase64('{"хомяк":"тест ₽"}');
  ok(/^[A-Za-z0-9+/]+=*$/.test(b), 'это не base64: ' + b);
  eq(decodeURIComponent(escape(atob(b))), '{"хомяк":"тест ₽"}', 'кириллица поехала');
});

// ---------- 0.3.1: жесты, «назад», плитки кошельков, тост сверху ----------

// (18а) меню закрывается смахиванием влево — тем же движением, каким оно уезжает
add('меню: закрывается свайпом влево', function () {
  UI.openMenu();
  ok(document.getElementById('menu').classList.contains('open'), 'меню не открылось');
  var m = document.getElementById('menu'), r = m.getBoundingClientRect();
  var y = r.top + r.height / 2, x = r.left + r.width - 20;
  withoutPanel(function () {
    pev(m, 'pointerdown', x, y, false);
    pev(document, 'pointermove', x - 20, y, false);   // мало: 20 < 60
  });
  ok(document.getElementById('menu').classList.contains('open'), 'меню закрылось от лёгкого сдвига');
  withoutPanel(function () { pev(document, 'pointermove', x - 90, y, false); });
  ok(!document.getElementById('menu').classList.contains('open'), 'меню не закрылось свайпом влево');
  pev(document, 'pointerup', x - 90, y, true);

  // прокрутка меню вверх-вниз его не захлопывает
  UI.openMenu();
  withoutPanel(function () {
    pev(m, 'pointerdown', x, y, false);
    pev(document, 'pointermove', x - 70, y + 220, false);
  });
  ok(document.getElementById('menu').classList.contains('open'), 'меню закрылось от вертикальной прокрутки');
  pev(document, 'pointerup', x - 70, y + 220, true);
  UI.closeMenu();
});

// (18б) «назад»: закрывается ровно верхний слой, а не всё сразу
add('назад: закрывается верхний слой, снизу вверх', function () {
  eq(UI.topOverlay(), null, 'на чистом экране что-то считается открытым');
  eq(UI.closeTop(), false, 'на чистом экране «назад» что-то закрыл');

  UI.openMenu();
  eq(UI.topOverlay(), 'menu', 'меню не верхний слой');
  UI.S.ui.analyticsView = null;            // на выборе «назад» закрывает аналитику одним нажатием
  UI.openSummary();
  eq(UI.topOverlay(), 'summary', 'аналитика не перебила меню');
  var w = circle('wallet', 0);
  UI.openCard({ kind: 'wallet', id: w.dataset.id });
  eq(UI.topOverlay(), 'card', 'карточка не перебила аналитику');
  UI.openTransfer(w.dataset.id);
  eq(UI.topOverlay(), 'transfer', 'лист перевода не перебил карточку');
  UI.dlgAlert('проверка');
  eq(UI.topOverlay(), 'dialog', 'окно не перебило лист перевода');

  // и разбираем стопку по одному
  ok(UI.closeTop(), 'окно не закрылось'); eq(UI.topOverlay(), 'transfer', 'после окна не лист перевода');
  ok(UI.closeTop(), 'лист перевода не закрылся'); eq(UI.topOverlay(), 'card', 'после листа не карточка');
  ok(UI.closeTop(), 'карточка не закрылась'); eq(UI.topOverlay(), 'summary', 'после карточки не аналитика');
  ok(UI.closeTop(), 'аналитика не закрылась'); eq(UI.topOverlay(), 'menu', 'после аналитики не меню');
  ok(UI.closeTop(), 'меню не закрылось'); eq(UI.topOverlay(), null, 'после меню что-то осталось');
  eq(UI.closeTop(), false, 'на пустом экране «назад» снова что-то закрыл');

  // режим правки — самый нижний слой, из него «назад» тоже выводит
  UI.enterEdit();
  eq(UI.topOverlay(), 'edit', 'режим правки не считается слоем');
  ok(UI.closeTop(), 'из режима правки не вышли');
  eq(document.body.classList.contains('editmode'), false, 'режим правки остался');
});

// (18в) тост переехал наверх: он больше не накрывает «Готово» и нижние кнопки
add('тост: висит сверху, а не над нижними кнопками', function () {
  UI.toast('проверка', { action: 'Отменить', onAction: function () {} });
  var t = document.getElementById('toast');
  ok(!t.hidden, 'тост не показался');
  var r = t.getBoundingClientRect();
  ok(r.top < window.innerHeight / 3, 'тост не в верхней трети экрана: top ' + Math.round(r.top));
  ok(r.bottom < window.innerHeight / 2, 'тост свисает ниже середины экрана');
  ok(!document.getElementById('toastBtn').hidden, 'кнопка отмены пропала');
  // 0.3.2: подтверждение правки уехало наверх, и тост не должен его накрывать -
  // в режиме правки он опускается ниже полосы
  UI.enterEdit();
  // место замеряем по стилю, а не по рамке: тост въезжает анимацией и первые
  // 200 мс стоит на 16 px выше своего места
  var toastTop = parseFloat(getComputedStyle(document.getElementById('toast')).top);
  var done = document.getElementById('btnEditDone').getBoundingClientRect();
  ok(done.bottom <= toastTop + 1, 'тост накрывает галочку выхода из правки: ' +
    Math.round(done.bottom) + ' > ' + Math.round(toastTop));
  UI.exitEdit();
  UI.hideToast();
});

// (18г) «Настроить кошельки» — плитки, а не строки, и без кнопки «Скрыть»
add('кошельки: список стал плитками, «Скрыть» из строк убран', function () {
  var was = UI.S.wallets.map(function (w) { return w.hidden; });
  try {
    UI.S.wallets[UI.S.wallets.length - 1].hidden = true;
    UI.openWallets();
    var body = document.getElementById('dlgBody');
    var tiles = body.querySelectorAll('.wgrid .wtile[data-id]');
    var live = UI.S.wallets.filter(function (w) { return !w.hidden; });
    eq(tiles.length, live.length, 'плиток не столько же, сколько видимых кошельков');
    ok(body.querySelector('.wtile[class*="wc-"]'), 'плитка без цвета кошелька');
    ok(tiles[0].querySelector('.ico svg'), 'на плитке нет иконки');
    ok(tiles[0].querySelector('.wt-n').textContent, 'на плитке нет названия');
    ok(/₽/.test(tiles[0].querySelector('.wt-b').textContent), 'на плитке нет баланса');
    eq(body.querySelectorAll('.wl-act').length, 0, 'кнопка «Скрыть» осталась в строке');
    // «+ Кошелёк» — последняя плитка пунктиром
    var add = document.getElementById('wlAdd');
    ok(add && add.classList.contains('wtile') && add.classList.contains('add'), '«+ Кошелёк» не плитка');
    eq(add.parentNode.lastElementChild, add, '«+ Кошелёк» не последняя плитка');
    // две в ряд
    var g = getComputedStyle(body.querySelector('.wgrid')).gridTemplateColumns.split(' ').length;
    eq(g, 2, 'плиток в ряду не две, а ' + g);
    // скрытые — свёрнутой группой
    var fold = document.getElementById('wlFold');
    ok(fold, 'нет группы «Скрытые»');
    ok(/^Скрытые \(1\)/.test(fold.textContent), 'подпись группы: ' + fold.textContent);
    eq(document.getElementById('wlOff'), null, 'скрытые видны, хотя группа свёрнута');
    fold.click();
    var off = document.getElementById('wlOff');
    ok(off, 'группа не развернулась');
    ok(off.querySelector('.wtile.off'), 'скрытая плитка не приглушена');
    document.getElementById('wlFold').click();      // вернули как было
    eq(document.getElementById('wlOff'), null, 'группа не свернулась обратно');
    // «Готово» на месте
    eq(document.getElementById('dlgBtns').lastChild.textContent, 'Готово', 'нет кнопки «Готово»');
    UI.closeDlg();
  } finally {
    UI.S.wallets.forEach(function (w, i) { w.hidden = was[i]; });
    UI.save(); UI.render();
  }
});

// (18д) явный путь к переводу: карточка → «Перевести» → плитки → экран суммы «A › B»
add('перевод: кнопка «Перевести» доводит до экрана суммы', function () {
  var ws = UI.S.wallets.filter(function (w) { return !w.hidden; });
  ok(ws.length > 1, 'для проверки нужно два кошелька');
  var from = ws[0], to = ws[1];
  UI.openCard({ kind: 'wallet', id: from.id });
  document.getElementById('cardTransfer').click();
  ok(UI.transferOpen(), 'лист «куда перевести» не открылся');
  var tiles = document.querySelectorAll('#trGrid .wtile[data-id]');
  eq(tiles.length, ws.length - 1, 'в листе не все чужие кошельки');
  [].forEach.call(tiles, function (t) { ok(t.getAttribute('data-id') !== from.id, 'исходный кошелёк предлагают самому себе'); });
  ok(document.getElementById('trFrom').textContent.indexOf(from.name) >= 0, 'не сказано, откуда переводим');
  var tgt = null;
  [].forEach.call(tiles, function (t) { if (t.getAttribute('data-id') === to.id) tgt = t; });
  ok(tgt, 'нет плитки второго кошелька');
  tgt.click();
  eq(UI.transferOpen(), false, 'лист перевода не закрылся');
  ok(UI.amountOpen(), 'экран суммы не открылся');
  eq(document.getElementById('amFrom').textContent, from.name, 'слева не исходный кошелёк');
  eq(document.getElementById('amTo').textContent, to.name, 'справа не кошелёк-получатель');
  UI.closeAmount(); UI.closeCard();
});

// (18е) «Настроить» в карточке открывает ту же форму кошелька, что и список
add('карточка: «Настроить» открывает форму со «Скрыть» и «Удалить»', function () {
  var w = circle('wallet', 0);
  UI.openCard({ kind: 'wallet', id: w.dataset.id });
  document.getElementById('cardSetup').click();
  eq(document.getElementById('dlgTitle').textContent, 'Кошелёк', 'форма кошелька не открылась');
  ok(document.getElementById('ecHide'), 'в форме нет «Скрыть»');
  ok(document.getElementById('ecDel'), 'в форме нет «Удалить»');
  UI.closeDlg(); UI.closeCard();
});

// (18ж) «О приложении»: суть про сервис первой строкой, автор не переносится
add('о приложении: суть первой строкой, автор в одну строку', function () {
  document.getElementById('mAbout').click();
  try {
    var body = document.getElementById('dlgBody');
    var first = body.querySelector('.about .ab-lead');
    ok(first, 'нет первой строки .ab-lead');
    ok(first.textContent.indexOf('Учёт личных финансов') >= 0, 'первая строка не про сервис: ' + first.textContent);
    ok(body.textContent.indexOf('без облака') > 0, 'пропала строка про облако');
    var a = body.querySelector('.ab-author');
    ok(a, 'нет строки автора');
    eq(a.textContent, 'Финансовый консультант Алексей Дорохин', 'текст автора');
    // контакты автора одной строкой: сайт-ссылка, без переноса
    var c = body.querySelector('.ab-contacts');
    ok(c, 'нет строки контактов .ab-contacts');
    eq(getComputedStyle(c).whiteSpace, 'nowrap', 'строка контактов может переноситься');
    ok(c.scrollWidth <= c.clientWidth + 1,
      'контакты не влезли: нужно ' + c.scrollWidth + ', есть ' + c.clientWidth);
    ok(c.getBoundingClientRect().height < parseFloat(getComputedStyle(c).fontSize) * 2,
      'строка контактов занимает две строки');
  } finally { UI.closeDlg(); }
});

// (18з) значок аналитики: три цветных столбика, а не монохромный глиф
add('шапка: столбики аналитики раскрашены по уровням', function () {
  var svg = document.querySelector('#btnSummary svg.ic-bars');
  ok(svg, 'значок аналитики не тот');
  var cs = getComputedStyle(document.body);
  [['b1', '--lv-ok'], ['b2', '--lv-warn'], ['b3', '--lv-over']].forEach(function (p) {
    var el = svg.querySelector('.' + p[0]);
    ok(el, 'нет столбика ' + p[0]);
    var got = getComputedStyle(el).stroke;
    ok(got && got !== 'none', 'столбик ' + p[0] + ' без цвета');
    ok(got !== getComputedStyle(svg.querySelector(p[0] === 'b1' ? '.b2' : '.b1')).stroke,
      'столбики одного цвета');
    eq(parseFloat(getComputedStyle(el).strokeWidth), 3.4, 'толщина обводки столбика ' + p[0]);
  });
  ok(cs.getPropertyValue('--lv-ok').trim(), 'в теме нет токена --lv-ok');
});

// (18и) «подними и неси»: сдвиг после 150 мс тащит плитку даже вдоль ленты
add('жест: подержал 150 мс — кошелёк едет вбок, а не листает ленту', function () {
  var a = circle('wallet', 0), b = circle('wallet', 1);
  ok(a && b, 'нужно два кошелька');
  var pa = center(a), pb = center(b);
  return withoutPanel(function () {
    pev(a, 'pointerdown', pa.x, pa.y, false);
    return sleep(Engine.PRESS_PICKUP + 90).then(function () {
      ok(a.classList.contains('is-lifted'), 'плитка не поднялась за 150 мс');
      // ведём строго вбок — раньше это забирала себе лента кошельков
      for (var i = 1; i <= 6; i++) {
        pev(document, 'pointermove', pa.x + (pb.x - pa.x) * i / 6, pa.y, false);
      }
      ok(document.body.classList.contains('dragging'), 'перенос не начался: жест ушёл ленте');
      pev(document, 'pointerup', pb.x, pb.y, true);
      ok(UI.amountOpen(), 'перевод не открылся');
      eq(document.getElementById('amFrom').textContent, cname(a), 'слева не тот кошелёк');
      eq(document.getElementById('amTo').textContent, cname(b), 'справа не тот кошелёк');
      UI.closeAmount();
    });
  });
});

// ---------- 0.3.2 ----------

// (19а) правка подтверждается сверху: шапка уходит, на её месте название и галочка
add('правка: полоса сверху с галочкой, нижнего «Готово» нет', function () {
  var bar = document.getElementById('editBar');
  var top = document.getElementById('top');
  var done = document.getElementById('btnEditDone');
  ok(bar && done, 'нет полосы правки или кнопки выхода');
  eq(bar.hidden, true, 'полоса видна вне режима правки');

  UI.enterEdit();
  eq(bar.hidden, false, 'полоса правки не показалась');
  eq(getComputedStyle(top).display, 'none', 'шапка осталась на экране');
  eq(document.getElementById('editBarTitle').textContent, 'Правка', 'заголовок полосы');

  var rb = bar.getBoundingClientRect(), rd = done.getBoundingClientRect();
  ok(rb.top < window.innerHeight / 3, 'полоса не в верхней части экрана');
  ok(rd.width >= 44 && rd.height >= 44, 'галочка мельче 44×44: ' + Math.round(rd.width) + '×' + Math.round(rd.height));
  ok(rd.right <= rb.right + 1 && rd.right > rb.left + rb.width / 2, 'галочка не справа полосы');
  ok(done.querySelector('svg'), 'галочка нарисована буквой, а не svg');
  eq(done.textContent.trim(), '', 'на кнопке остался текст «Готово»');

  // заголовок стоит по центру полосы, а не по центру остатка
  var rt = document.getElementById('editBarTitle').getBoundingClientRect();
  ok(Math.abs((rt.left + rt.width / 2) - (rb.left + rb.width / 2)) < 2, 'заголовок не по центру');

  // ниже полей никаких кнопок правки не осталось
  var exp = document.getElementById('fieldExp').getBoundingClientRect();
  ok(rd.bottom < exp.top, 'кнопка выхода осталась внизу экрана');

  done.click();
  eq(document.body.classList.contains('editmode'), false, 'галочка не вывела из режима правки');
  eq(bar.hidden, true, 'полоса осталась после выхода');
});

// (19б) карандаш на плитке: виден только в правке и открывает форму этой плитки
add('правка: карандаш на плитке открывает её форму', function () {
  var c = circle('wallet', 0);
  ok(c, 'нет кошелька');
  var b = c.querySelector('.tedit');
  ok(b, 'на плитке нет значка правки');
  eq(getComputedStyle(b).display, 'none', 'карандаш виден вне режима правки');

  UI.enterEdit();
  var st = getComputedStyle(b);
  ok(st.display !== 'none', 'карандаш не появился в режиме правки');
  var rb = b.getBoundingClientRect(), rc = c.getBoundingClientRect();
  eq(Math.round(rb.width), 22, 'ширина значка');
  eq(Math.round(rb.height), 22, 'высота значка');
  ok(rb.left + rb.width / 2 > rc.left + rc.width / 2, 'значок не в правой половине плитки');
  ok(rb.top + rb.height / 2 > rc.top + rc.height / 2, 'значок не в нижней половине плитки');

  // тап по карандашу = форма кошелька
  return withoutPanel(function () {
    var p = center(b);
    pev(b, 'pointerdown', p.x, p.y, false);
    pev(document, 'pointerup', p.x, p.y, true);
    ok(UI.dlgOpen(), 'форма плитки не открылась');
    eq(document.getElementById('dlgTitle').textContent, 'Кошелёк', 'открылась не та форма');
    UI.closeDlg();
    UI.exitEdit();
  });
});

// (19в) знак деления: рисуем сами, потому что в Manrope он сливается в крестик
add('клавиатура: ÷ нарисован svg и стоит по центру клавиши', function () {
  var b = document.querySelector('#amKeys .amk[data-k="÷"]');
  ok(b, 'нет клавиши деления');
  var svg = b.querySelector('svg.ic-div');
  ok(svg, '÷ по-прежнему текстовый глиф - зависит от шрифта темы');
  eq(b.textContent.trim(), '', 'в клавише остался текст ÷');

  var w = UI.S.wallets[0];
  ok(w, 'нет кошелька');
  UI.openAmount({ kind: 'exp', catId: 'e1', walletId: w.id });   // экран суммы: клавиши без него не измерить
  try {
    var rk = b.getBoundingClientRect(), rg = svg.getBoundingClientRect();
    ok(rg.width > 0 && rg.height > 0, 'знак деления не нарисовался');
    ok(rk.width > 0, 'клавиатура не показалась');
    ok(Math.abs((rg.left + rg.width / 2) - (rk.left + rk.width / 2)) < 1.5, 'знак ушёл вбок');
    ok(Math.abs((rg.top + rg.height / 2) - (rk.top + rk.height / 2)) < 1.5, 'знак ушёл по вертикали');
    ok(rg.width <= rk.width && rg.height <= rk.height, 'знак больше самой клавиши');
  } finally { UI.closeAmount(); }
});

// (19в2) широкая «Подтвердить» над клавиатурой: сохраняет как прежняя ✓, верхней
// галочки в шапке больше нет, на нуле кнопка выключена
add('экран суммы: широкая «Подтвердить» вместо верхней ✓', function () {
  ok(!document.getElementById('amOk'), 'верхняя галочка ✓ осталась в шапке');
  ok(!document.getElementById('amTags'), 'поле #метка осталось на экране суммы');
  var btn = document.getElementById('amConfirm');
  ok(btn, 'нет широкой кнопки «Подтвердить»');
  eq(btn.textContent.trim(), 'Подтвердить', 'подпись кнопки не «Подтвердить»');
  var w = UI.S.wallets[0];
  ok(w, 'нет кошелька');
  var n0 = UI.S.tx.length;
  UI.openAmount({ kind: 'exp', catId: 'e1', walletId: w.id });
  try {
    ok(btn.disabled, 'на нуле кнопка «Подтвердить» активна');
    var r = btn.getBoundingClientRect(), am = document.getElementById('amount').getBoundingClientRect();
    var num = document.getElementById('amExpr').getBoundingClientRect();
    ok(r.width > am.width * 0.8, 'кнопка не широкая: ' + Math.round(r.width) + ' из ' + Math.round(am.width));
    ok(r.height >= 46, 'кнопка ниже 46 px под палец: ' + Math.round(r.height));
    // без поля метки «Подтвердить» стоит сразу под суммой: сумма → кнопка → клавиатура
    ok(r.top >= num.bottom - 1, 'кнопка «Подтвердить» не под суммой');
    // клавиатура и нижний ряд дат помещаются под кнопкой на одном экране
    var keys = document.getElementById('amKeys').getBoundingClientRect();
    var date = document.getElementById('amDate').getBoundingClientRect();
    ok(r.bottom <= keys.top + 1, 'кнопка налезла на клавиатуру');
    ok(keys.bottom <= date.top + 1, 'клавиатура налезла на ряд дат');
    ok(date.bottom <= am.bottom + 1, 'ряд дат вышел за экран');
    // набрали сумму — кнопка ожила и сохраняет
    ['1', '0', '0'].forEach(function (k) { document.querySelector('#amKeys .amk[data-k="' + k + '"]').click(); });
    ok(!btn.disabled, 'после ввода суммы кнопка не включилась');
    btn.click();
    ok(document.getElementById('amount').hidden, 'экран суммы не закрылся после «Подтвердить»');
    eq(UI.S.tx.length, n0 + 1, 'операция не записалась по «Подтвердить»');
    var last = UI.S.tx[UI.S.tx.length - 1];
    eq(last.amount, 100, 'сумма записалась неверно');
    Engine.deleteTx(UI.S, last.id); UI.save(); UI.render(); UI.hideToast();
  } finally {
    if (!document.getElementById('amount').hidden) UI.closeAmount();
  }
});

// (0.4.6) «Повторить»: окно операции открывает экран суммы, заполненный тем же
// расходом/доходом/переводом с датой «сегодня»; подтверждение создаёт НОВУЮ запись.
add('операция: «Повторить» заполняет экран суммы и создаёт новую запись', function () {
  var src = UI.S.tx.filter(function (t) { return t.kind === 'exp'; })[0];
  ok(src, 'нет операции-расхода для повтора');
  var n0 = UI.S.tx.length;
  UI.editTx(src.id);
  var btns = document.getElementById('dlgBtns').querySelectorAll('button');
  var rep = null;
  [].forEach.call(btns, function (b) { if (b.textContent.trim() === 'Повторить') rep = b; });
  ok(rep, 'в окне операции нет кнопки «Повторить»');
  rep.click();                                   // закрывает окно, открывает экран суммы
  try {
    ok(!document.getElementById('amount').hidden, 'экран суммы не открылся по «Повторить»');
    ok(!document.getElementById('amConfirm').disabled, 'экран суммы не заполнен суммой оригинала');
    document.getElementById('amConfirm').click();
    eq(UI.S.tx.length, n0 + 1, 'повтор не создал новую операцию');
    var last = UI.S.tx[UI.S.tx.length - 1];
    ok(last.id !== src.id, 'повтор переписал оригинал вместо новой записи');
    eq(last.amount, src.amount, 'сумма повтора не совпала');
    eq(last.catId, src.catId, 'категория повтора не совпала');
    eq(last.walletId, src.walletId, 'кошелёк повтора не совпал');
    eq(last.date, Engine.today(), 'дата повтора не сегодня');
    Engine.deleteTx(UI.S, last.id); UI.save(); UI.render(); UI.hideToast();
  } finally {
    if (!document.getElementById('amount').hidden) UI.closeAmount();
    if (UI.dlgOpen && UI.dlgOpen()) UI.closeDlg();
  }
});

// (19г) сто процентов - красный: проверяем не только движок, но и саму плитку
add('заливка: ровно 100 % плана красит плитку красным', function () {
  var S = UI.S;
  if (!S.plans || !S.plans.exp.length) { ok(true, 'без планов проверять нечего'); return; }
  var ymStr = UI.curYM(), m = Engine.monthIndex(S.plans, ymStr);
  if (m < 0) { ok(true, 'месяц вне планов'); return; }
  var cat = S.plans.exp[0], w = S.wallets[0];
  ok(w, 'нет кошелька');
  var wasPlan = S.plans.months[m].expPlan[cat.id];
  var fact = Engine.catFact(S, cat.id, ymStr);
  var added = [];
  try {
    // план ровно равен факту: 100 % - это уже перебор
    S.plans.months[m].expPlan[cat.id] = fact > 0 ? fact : 1000;
    if (!(fact > 0)) {
      added.push(Engine.addTx(S, { kind: 'exp', amount: 1000, catId: cat.id, walletId: w.id, date: Engine.today() }));
    }
    UI.render();
    eq(Engine.fill(Engine.catFact(S, cat.id, ymStr), Engine.catPlan(S, cat.id, ymStr)).level, 'over', 'движок');
    eq(UI.levelOf('exp', 100, 100).lvl, 'over', 'levelOf на границе');
    var ring = document.querySelector('#app .circle[data-id="' + cat.id + '"] .ring');
    ok(ring, 'плитки категории нет на экране');
    ok(ring.classList.contains('lvl-over'), 'плитка на 100 % не красная: ' + ring.className);
    ok(!ring.classList.contains('lvl-warn'), 'плитка осталась жёлтой');

    // чуть за сотню - тоже красный, а 99,9 % ещё жёлтый
    eq(Engine.fill(1001, 1000).level, 'over', '1.001');
    eq(Engine.fill(999, 1000).level, 'warn', '0.999');
  } finally {
    S.plans.months[m].expPlan[cat.id] = wasPlan;
    added.forEach(function (t) { Engine.deleteTx(S, t.id); });
    UI.render();
  }
});

// (19д) дата операции не уходит вперёд: ни календарём, ни через движок
add('дата: вперёд не пускают ни календарь, ни движок', function () {
  var t = Engine.today();
  var inp = document.getElementById('amDateInput');
  eq(inp.max, t, 'у календаря нет предела «сегодня»');
  eq(document.querySelector('#app .circle') !== null, true, 'нет плиток');

  var d = new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) + 1);
  var tomorrow = d.getFullYear() + '-' + Engine.pad2(d.getMonth() + 1) + '-' + Engine.pad2(d.getDate());
  eq(Engine.futureDate(tomorrow), true, 'завтра не считается будущим');
  eq(Engine.futureDate(t), false, 'сегодня посчитали будущим');
  eq(UI.clampDate(tomorrow), t, 'подрезка даты не сработала');
  eq(UI.clampDate('2026-01-05'), '2026-01-05', 'подрезка тронула прошлое');

  var S = UI.S, w = S.wallets[0];
  ok(w, 'нет кошелька');
  var threw = '';
  try { Engine.addTx(S, { kind: 'exp', amount: 1, catId: 'e1', walletId: w.id, date: tomorrow }); }
  catch (e) { threw = e.message; }
  eq(threw, 'date-future', 'addTx принял завтрашнюю дату');

  var okTx = Engine.addTx(S, { kind: 'exp', amount: 1, catId: 'e1', walletId: w.id, date: t });
  try {
    threw = '';
    try { Engine.updateTx(S, okTx.id, { date: tomorrow }); } catch (e2) { threw = e2.message; }
    eq(threw, 'date-future', 'updateTx принял завтрашнюю дату');
    eq(Engine.findTx(S, okTx.id).date, t, 'дата испортилась после отказа');
  } finally {
    Engine.deleteTx(S, okTx.id);
    UI.render();
  }

  // сам экран суммы дату вперёд не отдаёт
  inp.value = tomorrow;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  eq(inp.value, t, 'календарь оставил завтрашнюю дату');
  UI.hideToast();
});

// ---------- 0.3.2, вторая волна ----------

// (20а) звук перебора звучит КАЖДЫЙ раз, пока категория за планом
add('звук: за планом каждый расход звучит перебором, а не только первый', function () {
  // чистая ступень: имя звука выводится из вида операции и уровня категории
  eq(Engine.txSound('exp', 'over'), 'over', 'расход за планом');
  eq(Engine.txSound('exp', 'warn'), 'expense', 'расход впритык');
  eq(Engine.txSound('exp', 'ok'), 'expense', 'расход в плане');
  eq(Engine.txSound('exp', null), 'expense', 'расход без уровня');
  eq(Engine.txSound('inc', 'over'), 'income', 'доход не звучит перебором');
  eq(Engine.txSound('transfer', 'over'), 'transfer', 'перевод не звучит перебором');

  var S = UI.S, w = S.wallets[0];
  ok(w, 'нет кошелька');
  if (!S.plans || !S.plans.exp.length) { ok(true, 'без планов проверять нечего'); return; }
  var ymStr = UI.curYM(), m = Engine.monthIndex(S.plans, ymStr);
  if (m < 0) { ok(true, 'месяц вне планов'); return; }

  var cat = S.plans.exp[0];
  var wasPlan = S.plans.months[m].expPlan[cat.id];
  var heard = [], play0 = window.Sound.play;
  var added = [];
  try {
    window.Sound.play = function (n) { heard.push(n); return true; };
    S.plans.months[m].expPlan[cat.id] = 100;                       // план заведомо мал
    added.push(Engine.addTx(S, { kind: 'exp', amount: 500, catId: cat.id, walletId: w.id, date: Engine.today() }));
    UI.soundTx('exp', cat.id, ymStr);
    added.push(Engine.addTx(S, { kind: 'exp', amount: 500, catId: cat.id, walletId: w.id, date: Engine.today() }));
    UI.soundTx('exp', cat.id, ymStr);                              // второй расход по той же категории
    added.push(Engine.addTx(S, { kind: 'exp', amount: 500, catId: cat.id, walletId: w.id, date: Engine.today() }));
    UI.soundTx('exp', cat.id, ymStr);                              // и третий
    eq(heard.join(','), 'over,over,over', 'перебор звучал не каждый раз');
  } finally {
    window.Sound.play = play0;
    S.plans.months[m].expPlan[cat.id] = wasPlan;
    added.forEach(function (t) { Engine.deleteTx(S, t.id); });
    UI.render();
  }
});

// (20б) меню закрывается смахиванием откуда угодно, а не только с шапки
add('меню: смахивание влево работает с плитки, вертикаль не закрывает', function () {
  var tile = document.getElementById('mSound');
  ok(tile, 'нет плитки «Звук»');

  // порог: горизонталь должна быть в полтора раза длиннее вертикали
  eq(Engine.SWIPE_RATIO, 1.5, 'порог намерения');
  eq(Engine.swipeCloses(-120, 10, 'left'), true, 'честный горизонтальный жест');
  eq(Engine.swipeCloses(-120, 100, 'left'), false, 'косой жест закрыл меню');
  eq(Engine.swipeCloses(-59, 0, 'left'), false, 'слишком короткий жест закрыл меню');

  return withoutPanel(function () {
    // 1) вертикальное движение по плитке меню НЕ закрывает
    UI.openMenu();
    ok(UI.overlayFlags().menu, 'меню не открылось');
    var p = center(tile);
    pev(tile, 'pointerdown', p.x, p.y, false);
    pev(document, 'pointermove', p.x - 10, p.y + 90, false);
    pev(document, 'pointerup', p.x - 10, p.y + 90, true);
    ok(UI.overlayFlags().menu, 'прокрутка списка закрыла меню');

    // 2) смахивание влево С ПЛИТКИ закрывает
    pev(tile, 'pointerdown', p.x, p.y, false);
    for (var i = 1; i <= 4; i++) pev(document, 'pointermove', p.x - 35 * i, p.y + 4, false);
    ok(!UI.overlayFlags().menu, 'смахивание с плитки не закрыло меню');

    // 3) клик, прилетевший следом за смахиванием, плитку не нажимает
    var was = UI.S.ui.sound;
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    eq(UI.S.ui.sound, was, 'смахивание заодно нажало плитку меню');
    pev(document, 'pointerup', p.x - 140, p.y + 4, true);

    // 4) обычный тап по плитке по-прежнему работает
    UI.openMenu();
    pev(tile, 'pointerdown', p.x, p.y, false);
    pev(document, 'pointerup', p.x, p.y, true);
    tile.click();
    eq(UI.S.ui.sound, !was, 'тап по плитке перестал переключать звук');
    tile.click();                                   // возвращаем как было
    eq(UI.S.ui.sound, was, 'не вернулось прежнее значение');
    UI.closeMenu();
    UI.save();
  });
});

// (20в) шапка стала выше: сводка 56, хомяк и аналитика той же высоты, ряды целы
add('шапка: сводка 56 px, хомяк и аналитика 56×56, четыре ряда расходов целы', function () {
  UI.relayout();
  var sums = document.getElementById('sums').getBoundingClientRect();
  var av = document.querySelector('#top .avatar').getBoundingClientRect();
  var bs = document.getElementById('btnSummary').getBoundingClientRect();
  eq(Math.round(sums.height), 56, 'высота сводки');
  eq(Math.round(av.width), 56, 'ширина хомяка');
  eq(Math.round(av.height), 56, 'высота хомяка');
  eq(Math.round(bs.width), 56, 'ширина кнопки аналитики');
  eq(Math.round(bs.height), 56, 'высота кнопки аналитики');

  var sv = document.querySelector('#sumBalance .sv'), sl = document.querySelector('#sumBalance .sl');
  eq(getComputedStyle(sv).fontSize, '15px', 'размер числа');
  eq(getComputedStyle(sv).fontWeight, '800', 'жирность числа');
  eq(getComputedStyle(sl).fontSize, '10px', 'размер подписи');

  // все трое стоят одной планкой
  ok(Math.abs(av.top - sums.top) < 1.5 && Math.abs(bs.top - sums.top) < 1.5, 'ряд шапки разъехался');

  // четыре ряда расходов после подросшей шапки на месте
  if (Engine.listCategories(UI.S, 'exp', { ymStr: UI.curYM() }).length >= 16) {
    eq(UI.expRows(), 4, 'рядов расходов стало меньше четырёх');
  }
  ok(UI.fieldGap() >= 6, 'зазор между блоками ушёл ниже 6 px');
});

// (20г) хомяк в шапке меню — 48 px, название по центру круга
add('меню: хомяк 48 px, название по центру круга', function () {
  UI.openMenu();
  try {
    var ham = document.querySelector('.menu-app');
    var ttl = document.querySelector('.menu-title');
    ok(ham && ttl, 'нет шапки меню');
    var rh = ham.getBoundingClientRect(), rt = ttl.getBoundingClientRect();
    eq(Math.round(rh.width), 48, 'ширина хомяка в меню');
    eq(Math.round(rh.height), 48, 'высота хомяка в меню');
    ok(ham.querySelector('img'), 'хомяк рисуется не картинкой');
    ok(Math.abs((rh.top + rh.height / 2) - (rt.top + rt.height / 2)) < 2.5,
      'название не по центру круга: ' + Math.round(rh.top + rh.height / 2) + ' и ' + Math.round(rt.top + rt.height / 2));
    ok(rt.left >= rh.right, 'название налезло на хомяка');
  } finally { UI.closeMenu(); }
});

// (20д) точки под лентой кошельков: страницы по четыре
add('кошельки: больше четырёх — точки страниц и прилипание по четыре', function () {
  var S = UI.S;
  var dots = document.getElementById('walDots');
  var strip = document.querySelector('#fieldWallets .strip');
  ok(dots && strip, 'нет ленты кошельков или точек');

  // чистые ступени счёта страниц
  eq(Engine.PAGE_WALLETS, 4, 'кошельков на страницу');
  eq(Engine.pageCount(4, 4), 1, '4 кошелька - одна страница');
  eq(Engine.pageCount(5, 4), 2, '5 кошельков - две страницы');
  eq(Engine.pageCount(8, 4), 2, '8 кошельков - две страницы');
  eq(Engine.pageCount(9, 4), 3, '9 кошельков - три страницы');
  eq(Engine.pageCount(0, 4), 1, 'пусто - всё равно одна страница');
  eq(Engine.pageAt(0, 696, 348, 2), 0, 'начало ленты');
  eq(Engine.pageAt(348, 696, 348, 2), 1, 'край ленты - вторая страница');
  eq(Engine.pageAt(9999, 696, 348, 2), 1, 'номер подрезан по числу страниц');
  eq(Engine.pageAt(100, 348, 348, 2), 0, 'ленту ещё не измерили');
  eq(Engine.pageStep(696, 348, 2), 348, 'шаг страницы - ширина окна ленты');
  eq(Engine.pageLeft(1, 696, 348, 2), 348, 'куда листает тап по второй точке');

  var live = S.wallets.filter(function (w) { return !w.hidden; }).length;
  eq(dots.children.length, live > 4 ? Engine.pageCount(live, 4) : 0, 'точек не столько, сколько страниц');

  // четыре кошелька (демо) - одна страница и никаких точек
  if (live === 4) {
    eq(document.querySelectorAll('#fieldWallets .wpage').length, 1, 'четыре кошелька - должна быть одна страница');
    eq(dots.children.length, 0, 'четыре кошелька - точек быть не должно');
    ok(!document.getElementById('fieldWallets').classList.contains('many'), 'одна страница, а лента считает себя многостраничной');
    eq(strip.scrollWidth - strip.clientWidth <= 1, true, 'одной странице ехать некуда');
  }

  // Возврат состояния делаем руками, а не в finally: проверка асинхронная, и finally
  // сработал бы РАНЬШЕ, чем лента доедет до второй страницы, — кошельки исчезли бы
  // прямо посреди замеров.
  var made = [];
  function restore() {
    made.forEach(function (w) { Engine.deleteWallet(S, w.id); });
    made = [];
    UI.render();
  }
  function body() {
    while (S.wallets.filter(function (w) { return !w.hidden; }).length < 6) {
      made.push(Engine.addWallet(S, { name: 'Проверка ' + (made.length + 1), color: 'teal' }));
    }
    UI.render();
    eq(dots.children.length, 2, 'шесть кошельков - должно быть две точки');
    ok(document.getElementById('fieldWallets').classList.contains('many'), 'лента не считает себя многостраничной');
    ok(dots.children[0].classList.contains('on'), 'первая точка не подсвечена');

    // в ленте есть плитка «+ кошелёк» (.wcard.addtile) - считаем только настоящие кошельки
    var cards = document.querySelectorAll('#fieldWallets .wcard:not(.addtile)');
    eq(cards.length, 6, 'кошельков на ленте');

    // Главное правило страниц: на странице N стоят кошельки 4N+1…4N+4, лишние места
    // остаются ПУСТЫМИ. Шесть кошельков - это 4 + 2, а не «сдвинулись на два».
    var wp = document.querySelectorAll('#fieldWallets .wpage');
    eq(wp.length, 2, 'страниц ленты не две');
    eq(wp[0].querySelectorAll('.wcard:not(.addtile)').length, 4, 'на первой странице не четыре кошелька');
    eq(wp[1].querySelectorAll('.wcard:not(.addtile)').length, 2, 'на второй странице не два кошелька (остальные места пустые)');
    var live6 = S.wallets.filter(function (w) { return !w.hidden; })
      .sort(function (a, b) { return a.order - b.order; }).map(function (w) { return w.id; });
    function idsOf(p) { return [].map.call(p.querySelectorAll('.wcard:not(.addtile)'), function (c) { return c.dataset.id; }); }
    var p1 = idsOf(wp[0]), p2 = idsOf(wp[1]);
    eq(p1.join(','), live6.slice(0, 4).join(','), 'первая страница показывает не 1-4');
    eq(p2.join(','), live6.slice(4, 6).join(','), 'вторая страница показывает не 5-6');
    eq(p1.filter(function (id) { return p2.indexOf(id) >= 0; }).length, 0,
      'кошелёк повторяется на обеих страницах: ' + p1.join(',') + ' / ' + p2.join(','));

    // страница - ровно ширина окна ленты, ход прокрутки кратен ей
    var pw = Math.round(wp[0].getBoundingClientRect().width);
    eq(pw, Math.round(strip.clientWidth), 'страница не во всю ширину окна ленты');
    ok(Math.abs(strip.scrollWidth - pw * 2) <= 1.5, 'ход ленты не кратен ширине страницы: ' + strip.scrollWidth + ' при странице ' + pw);
    ok(strip.scrollWidth - strip.clientWidth > 0, 'лента шести кошельков никуда не едет');
    eq(getComputedStyle(wp[0]).scrollSnapAlign, 'start', 'страница не прилипает');
    eq(getComputedStyle(cards[0]).scrollSnapAlign, 'none', 'прилипание осталось покарточным');

    // тап по второй точке листает ленту ровно на одну ширину страницы
    return withoutPanel(function () {
      dots.children[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return sleep(600).then(function () {
        ok(Math.abs(strip.scrollLeft - pw) <= 1.5,
          'тап по точке привёл ленту не на край страницы: ' + Math.round(strip.scrollLeft) + ' вместо ' + pw);
        eq(UI.walletPage(), 1, 'номер страницы не обновился');
        ok(dots.children[1].classList.contains('on'), 'вторая точка не подсветилась');

        // перерисовка страницу не теряет
        UI.render();
        eq(UI.walletPage(), 1, 'перерисовка кинула ленту на первую страницу');
        ok(Math.abs(strip.scrollLeft - pw) <= 1.5, 'лента уехала в начало: ' + Math.round(strip.scrollLeft));
      });
    });
  }
  return Promise.resolve().then(body).then(
    function () { restore(); },
    function (e) { restore(); throw e; }
  );
});

// (20е) перестановка на второй странице расходов не кидает на первую
add('страницы: перестановка на второй странице оставляет вторую страницу', function () {
  var S = UI.S;
  if (!S.plans) { ok(true, 'план-модель ПК убрана в форке - синтетику на планах не гоняем'); return; }
  var ymStr = UI.curYM(), m = Engine.monthIndex(S.plans, ymStr);
  if (m < 0) { ok(true, 'месяц вне планов'); return; }
  var mine = [];
  var box = document.querySelector('#fieldExp .pages');
  var wasOrder = (S.ui.order.exp || []).slice();
  try {
    for (var i = 1; i <= 12; i++) {
      var id = 'stpage' + i;
      mine.push(id);
      S.plans.exp.push({ id: id, name: 'Стр ' + i, retired: false, order: 900 + i });
      S.plans.months.forEach(function (mo) { mo.expPlan[id] = 1000; });
      S.icons[id] = 'other';
    }
    UI.relayout();
    var pages = document.querySelectorAll('#fieldExp .page').length;
    ok(pages >= 2, 'страниц расходов меньше двух: ' + pages);

    box.scrollLeft = box.clientWidth;
    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'лента не встала на вторую страницу');

    var per = document.querySelectorAll('#fieldExp .page:first-child .circle').length;
    var list = Engine.cats(S, 'exp', ymStr).map(function (c) { return c.id; });
    ok(list.length > per + 1, 'на второй странице меньше двух плиток');
    var a = list[per], b = list[per + 1];
    list[per] = b; list[per + 1] = a;               // меняем местами две плитки ВТОРОЙ страницы
    Engine.reorder(S, 'exp', list);
    UI.render();

    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'после перестановки лента прыгнула на первую страницу');
    var now = Engine.cats(S, 'exp', ymStr).map(function (c) { return c.id; });
    eq(now[per], b, 'порядок не сохранился');
    eq(now[per + 1], a, 'порядок не сохранился');

    // вход и выход из режима правки страницу тоже не теряют
    UI.enterEdit();
    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'вход в правку сбросил страницу');
    UI.exitEdit();
    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'выход из правки сбросил страницу');
  } finally {
    S.plans.exp = S.plans.exp.filter(function (c) { return mine.indexOf(c.id) < 0; });
    S.plans.months.forEach(function (mo) { mine.forEach(function (id) { delete mo.expPlan[id]; }); });
    mine.forEach(function (id) { delete S.icons[id]; });
    S.ui.order.exp = wasOrder;
    UI.relayout();
  }
});

// (20ж) перестановка едет плавно: соседи сдвигаются, призрак садится в ячейку
add('правка: соседи переезжают плавно, призрак садится в ячейку', function () {
  eq(UI.REORDER_MS, 160, 'длительность переезда соседей');
  eq(UI.SETTLE_MS, 200, 'посадка призрака');

  var a = circle('wallet', 0), b = circle('wallet', 1);
  ok(a && b, 'нужны два кошелька');
  var idA = a.dataset.id, idB = b.dataset.id;

  return withoutPanel(function () {
    UI.enterEdit();
    var pa = center(a), pb = center(b);
    pev(a, 'pointerdown', pa.x, pa.y, false);
    for (var i = 1; i <= 5; i++) pev(document, 'pointermove', pa.x + (pb.x - pa.x) * i / 5, pa.y, false);

    // сосед уехал не мгновенно: на нём висит собственный переход
    var moved = document.querySelector('#fieldWallets .wcard[data-id="' + idB + '"]');
    ok(moved && /transform/.test(moved.style.transition || ''), 'сосед переставился без перехода');
    ok(document.querySelector('.dragghost'), 'призрака под пальцем нет');

    pev(document, 'pointerup', pb.x, pb.y, true);
    // призрак ещё на экране: он садится в ячейку 200 мс
    ok(document.querySelector('.dragghost'), 'призрак пропал сразу, без посадки');

    return sleep(UI.SETTLE_MS + 260).then(function () {
      ok(!document.querySelector('.dragghost'), 'призрак остался на экране');
      var order = UI.S.wallets.slice().sort(function (x, y) { return x.order - y.order; })
        .map(function (w) { return w.id; });
      eq(order.indexOf(idB) < order.indexOf(idA), true, 'порядок кошельков не поменялся');
      var live = document.querySelectorAll('#fieldWallets .wcard');
      Array.prototype.forEach.call(live, function (c) {
        eq(c.style.transform, '', 'на плитке остался сдвиг от анимации');
      });
      UI.exitEdit();
    });
  });
});

// (21) ВОЛНА 6 — правки живого теста
// (21а) перестановка в правке не выходит за своё поле: доход тянем вниз на кошелёк,
// а он остаётся среди доходов, порядок доходов не меняется, чужие поля не трогаются.
add('правка: доход не переставляется в чужое поле', function () {
  eq(Engine.reorderAllowed('inc', 'inc'), true, 'свой вид разрешён');
  eq(Engine.reorderAllowed('inc', 'wallet'), false, 'доход в кошельки нельзя');
  eq(Engine.reorderAllowed('inc', 'exp'), false, 'доход в расходы нельзя');
  var inc = circle('inc', 0), wal = circle('wallet', 0);
  ok(inc && wal, 'нужны доход и кошелёк на экране');
  var incBefore = Array.prototype.map.call(circles('inc'), function (c) { return c.dataset.id; }).join(',');
  var walBefore = Array.prototype.map.call(circles('wallet'), function (c) { return c.dataset.id; }).join(',');
  return withoutPanel(function () {
    UI.enterEdit();
    var a = center(inc), b = center(wal);
    pev(inc, 'pointerdown', a.x, a.y, false);
    for (var i = 1; i <= 8; i++) pev(document, 'pointermove', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, false);
    var reord = document.querySelector('.circle.reordering');
    ok(reord && reord.closest('.field') && reord.closest('.field').id === 'fieldInc',
      'переставляемый доход ушёл из поля доходов');
    pev(document, 'pointerup', b.x, b.y, true);
    return sleep(UI.SETTLE_MS + 120).then(function () {
      UI.exitEdit();
      var incAfter = Array.prototype.map.call(circles('inc'), function (c) { return c.dataset.id; }).join(',');
      var walAfter = Array.prototype.map.call(circles('wallet'), function (c) { return c.dataset.id; }).join(',');
      eq(incAfter, incBefore, 'порядок доходов изменился');
      eq(walAfter, walBefore, 'кошельки затронуты переносом дохода');
      ok(document.querySelector('#fieldInc .circle[data-id="' + inc.dataset.id + '"]'), 'доход выпал из своего поля');
    });
  });
});

// (21б) одно удаление операции убирает её везде: из S.tx, из баланса кошелька, из факта
// категории и из списка операций кошелька — атомарно, один store.
add('удаление: операция уходит из баланса, факта и списка разом', function () {
  var S = Engine.defaultState();
  S.startYM = '2026-01';
  var w = Engine.addWallet(S, { name: 'ЕКП', base: 1000 });
  w.baseTs = 0;
  var a = Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: w.id, date: '2026-01-05' });
  var b = Engine.addTx(S, { kind: 'exp', amount: 200, catId: 'e1', walletId: w.id, date: '2026-01-06' });
  S.tx.forEach(function (t) { t.ts = 1000; });
  eq(Engine.walletBalance(S, w.id), 500, 'старт баланса');
  eq(Engine.catFact(S, 'e1', '2026-01'), 500, 'старт факта');
  eq(Engine.txOfWallet(S, w.id).length, 2, 'старт списка');
  eq(Engine.deleteTx(S, a.id), true, 'deleteTx вернул true');
  eq(Engine.findTx(S, a.id), null, 'осталась в S.tx');
  eq(Engine.walletBalance(S, w.id), 800, 'баланс не пересчитан');
  eq(Engine.catFact(S, 'e1', '2026-01'), 200, 'факт не пересчитан');
  eq(Engine.txOfWallet(S, w.id).map(function (t) { return t.id; }).join(','), b.id, 'список кошелька не обновился');
});

// (21в) шеврон селекта: свой значок, отступ справа 38px, стрелка не липнет к краю
add('форма: у селекта свой шеврон с нормальным отступом', function () {
  var el = document.createElement('select');
  el.className = 'inp';
  el.innerHTML = '<option>раз</option><option>два</option>';
  document.body.appendChild(el);
  try {
    var cs = getComputedStyle(el);
    eq(cs.appearance || cs.webkitAppearance, 'none', 'системная стрелка не убрана (appearance)');
    eq(cs.paddingRight, '38px', 'отступ справа под шеврон не 38px');
    ok(/data:image\/svg/.test(cs.backgroundImage), 'своего шеврона-картинки нет');
    ok(/(right|100%)/.test(cs.backgroundPositionX) || cs.backgroundPosition.indexOf('14px') >= 0 || cs.backgroundPosition.indexOf('100%') >= 0,
      'шеврон не у правого края: ' + cs.backgroundPosition);
  } finally { document.body.removeChild(el); }
});

// (21г) перенос операции: призрак position:fixed и попадание в цель на ДРУГОЙ странице.
// Долив категорий делаем на две страницы, поднимаем кошелёк, у края поле листается само,
// и цель на 2-й странице ловится elementFromPoint.
add('перенос: призрак fixed и цель на другой странице расходов', function () {
  var S = UI.S, mine = [];
  if (!S.plans) { ok(true, 'план-модель ПК убрана в форке - синтетику на планах не гоняем'); return; }
  var box = document.querySelector('#fieldExp .pages');
  for (var i = 1; i <= 12; i++) {
    var id = 'stfix' + i; mine.push(id);
    S.plans.exp.push({ id: id, name: 'Пер ' + i, retired: false, order: 800 + i });
    S.plans.months.forEach(function (mo) { mo.expPlan[id] = 1000; });
    S.icons[id] = 'other';
  }
  UI.relayout();
  var pages = document.querySelectorAll('#fieldExp .page').length;
  ok(pages >= 2, 'страниц расходов меньше двух: ' + pages);

  var wal = circle('wallet', 0);
  // панель прячем на всё время жеста руками: withoutPanel вернул бы её сразу, а её
  // угол внизу-справа наезжает на 2-ю страницу расходов и перехватывал бы elementFromPoint
  var pvis = panel ? panel.style.visibility : null;
  if (panel) panel.style.visibility = 'hidden';
  function done() { if (panel) panel.style.visibility = pvis; }
  var w = center(wal);
  var r = box.getBoundingClientRect();
  pev(wal, 'pointerdown', w.x, w.y, false, 'mouse');
  pev(document, 'pointermove', w.x, w.y + 4, false, 'mouse');
  return sleep(Engine.PRESS_PICKUP + 60).then(function () {
    pev(document, 'pointermove', r.right - 8, r.top + 20, false, 'mouse');
    var g = document.querySelector('.dragghost');
    ok(g, 'призрака переноса нет');
    eq(getComputedStyle(g).position, 'fixed', 'призрак переноса не position:fixed');
    // держим у края: страница переворачивается через D_EDGE_HOLD (500 мс)
    var n = 0;
    return waitFor(function () { return box.scrollLeft > 100; }, 2500, function () {
      pev(document, 'pointermove', r.right - 7 - (n++ % 2), r.top + 20, false, 'mouse');
    });
  }).then(function () {
    ok(box.scrollLeft > 100, 'поле расходов не перелистнулось под пальцем: ' + Math.round(box.scrollLeft));
    var second = document.querySelectorAll('#fieldExp .page')[1].querySelector('.circle');
    var c = center(second);
    pev(document, 'pointermove', c.x, c.y, false, 'mouse');
    ok(second.classList.contains('is-target'), 'цель на 2-й странице не поймалась (нет hit-test через перелистывание)');
    pev(document, 'pointerup', c.x, c.y, true, 'mouse');
    return sleep(60);
  }).then(function () {
    ok(!document.getElementById('amount').hidden, 'экран суммы не открылся по броску на 2-й странице');
    UI.closeAmount();
    done();
  }, function (e) {
    pev(document, 'pointercancel', 0, 0, true, 'mouse');
    done();
    throw e;
  });
});

// (22) ВОЛНА 7 — правки живого теста 0.3.4

// (22а) барьер дохода: тянем доход вниз через кошельки в расходы и отпускаем над
// расходом. Доход обязан остаться в #fieldInc, порядок и состав расходов — нетронуты.
add('правка: доход не уходит вниз в расходы (барьер поля, жест сверху вниз)', function () {
  var inc = circle('inc', 0), exp = circle('exp', 0);
  ok(inc && exp, 'нужны доход и расход на экране');
  var incId = inc.dataset.id;
  var expOrderBefore = JSON.stringify(UI.S.ui.order.exp);
  var expDomBefore = Array.prototype.map.call(circles('exp'), function (c) { return c.dataset.id; }).join(',');
  var incDomBefore = Array.prototype.map.call(circles('inc'), function (c) { return c.dataset.id; }).join(',');
  return withoutPanel(function () {
    UI.enterEdit();
    var a = center(inc), b = center(exp);
    pev(inc, 'pointerdown', a.x, a.y, false);
    for (var i = 1; i <= 8; i++) pev(document, 'pointermove', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, false);
    // над расходом «поднятый» доход не должен подсветить чужую цель
    ok(!document.querySelector('#fieldExp .circle.is-target'), 'доход подсветил цель в чужом поле');
    pev(document, 'pointerup', b.x, b.y, true);
    return sleep(UI.SETTLE_MS + 140).then(function () {
      UI.exitEdit();
      eq(JSON.stringify(UI.S.ui.order.exp), expOrderBefore, 'S.ui.order.exp тронут переносом дохода');
      eq(Array.prototype.map.call(circles('exp'), function (c) { return c.dataset.id; }).join(','), expDomBefore, 'состав расходов изменился');
      eq(Array.prototype.map.call(circles('inc'), function (c) { return c.dataset.id; }).join(','), incDomBefore, 'состав доходов изменился');
      ok(document.querySelector('#fieldInc .circle[data-kind="inc"][data-id="' + incId + '"]'), 'доход выпал из своего поля #fieldInc');
      ok(!document.querySelector('#fieldExp .circle[data-kind="inc"]'), 'доход просочился в поле расходов');
    });
  });
});

// (22б) поле даты: свой шеврон, как у селектов «Откуда/Куда» (раньше торчал системный
// значок календаря, и строка «Дата» выбивалась из ряда)
add('форма: у поля даты свой шеврон, как у селектов', function () {
  var el = document.createElement('input');
  el.type = 'date'; el.className = 'inp';
  document.body.appendChild(el);
  try {
    var cs = getComputedStyle(el);
    eq(cs.appearance || cs.webkitAppearance, 'none', 'системный вид у даты не убран (appearance)');
    eq(cs.paddingRight, '38px', 'отступ справа под шеврон не 38px');
    ok(/data:image\/svg/.test(cs.backgroundImage), 'своего шеврона-картинки у даты нет');
    ok(/(right|100%|14px)/.test(cs.backgroundPositionX + ' ' + cs.backgroundPosition),
      'шеврон даты не у правого края: ' + cs.backgroundPosition);
    // Родной значок календаря спрятан (opacity:0) и растянут на всё поле, чтобы тап в
    // любом месте открывал календарь. getComputedStyle в Edge врёт про opacity этого
    // shadow-псевдо (отдаёт «1»), но width отдаёт честно — по нему и проверяем, что наше
    // правило псевдоэлемента применилось: индикатор шире собственного значка (≈поле).
    var ind = null;
    try { ind = getComputedStyle(el, '::-webkit-calendar-picker-indicator'); } catch (e) {}
    if (ind && ind.width && ind.width !== 'auto') {
      ok(parseFloat(ind.width) > el.getBoundingClientRect().width * 0.5,
        'родной значок календаря не нейтрализован (индикатор не во всю ширину): ' + ind.width);
    }
  } finally { document.body.removeChild(el); }
});

// (22в) движок: удаление замороженной операции (ts < baseTs, «вшита» в base после
// «Изменить баланс») возвращает деньги в base; живую (ts >= baseTs) не трогает дважды.
add('движок: удаление замороженной операции возвращает деньги на кошелёк', function () {
  var S = Engine.defaultState();
  S.startYM = '2026-01';
  var w = Engine.addWallet(S, { name: 'ЕКП', base: 1000 });
  w.baseTs = 5000;                                            // точка отсчёта позже операций
  var frozenExp = Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: w.id, date: '2026-01-05' });
  frozenExp.ts = 1000;                                        // ДО baseTs — в balance не входит
  eq(Engine.walletBalance(S, w.id), 1000, 'замороженная трата двигала баланс');
  eq(Engine.deleteTx(S, frozenExp.id), true, 'deleteTx');
  eq(Engine.walletBalance(S, w.id), 1300, 'удаление замороженной траты не вернуло деньги');
  var frozenInc = Engine.addTx(S, { kind: 'inc', amount: 200, catId: 'i1', walletId: w.id, date: '2026-01-06' });
  frozenInc.ts = 1000;
  eq(Engine.walletBalance(S, w.id), 1300, 'замороженный доход двигал баланс');
  Engine.deleteTx(S, frozenInc.id);
  eq(Engine.walletBalance(S, w.id), 1100, 'удаление замороженного дохода не убрало его из base');
  var live = Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: w.id, date: '2026-01-07' });
  live.ts = 6000;                                             // ПОСЛЕ baseTs — считается пересчётом
  eq(Engine.walletBalance(S, w.id), 1000, 'живая трата не посчиталась');
  Engine.deleteTx(S, live.id);
  eq(Engine.walletBalance(S, w.id), 1100, 'живую удалили, а базу тронули дважды');
});

// (22г) полный путь UI: удаление операции из «Аналитики» (свайп по строке в карточке
// категории) возвращает деньги на кошелёк. Берём замороженную трату — именно на ней
// баг и ловился: факт падал, а деньги не возвращались.
add('аналитика: свайп-удаление операции возвращает деньги на кошелёк', function () {
  var S = UI.S;
  var w = S.wallets[0];
  var cats = Engine.listCategories(S, 'exp');
  ok(w && cats.length, 'нужны кошелёк и категории');
  var catId = cats[0].id;
  var bal0 = Engine.walletBalance(S, w.id);
  forceReduced(true);
  var tx = Engine.addTx(S, { kind: 'exp', amount: 4321, catId: catId, walletId: w.id, date: Engine.today() });
  tx.ts = w.baseTs - 1;                                       // как трата до «Изменить баланс» — заморожена
  UI.render();
  eq(Engine.walletBalance(S, w.id), bal0, 'замороженная трата двинула баланс до удаления');
  UI.openSummary({ kind: 'exp', ym: Engine.ym(Engine.today()), view: 'summary' });
  return sleep(50).then(function () {
    var row = document.querySelector('#smBody .sm-row[data-id="' + catId + '"]');
    ok(row, 'строки категории в аналитике нет');
    row.click();
    return sleep(70);
  }).then(function () {
    ok(UI.cardOpen(), 'карточка категории не открылась из аналитики');
    var txrow = document.querySelector('#cardList .txrow[data-id="' + tx.id + '"]');
    ok(txrow, 'операции нет в списке карточки');
    withoutPanel(function () {
      var r = txrow.getBoundingClientRect(), y = r.top + r.height / 2;
      pev(txrow, 'pointerdown', r.right - 20, y, false, 'touch');
      for (var i = 1; i <= 10; i++) pev(txrow, 'pointermove', r.right - 20 - i * 12, y, false, 'touch');
      pev(txrow, 'pointerup', r.right - 150, y, true, 'touch');
    });
    return sleep(50);
  }).then(function () {
    ok(UI.dlgOpen(), 'окно подтверждения удаления не появилось (свайп не сработал)');
    var btns = document.getElementById('dlgBtns').querySelectorAll('button');
    btns[btns.length - 1].click();                           // «Удалить»
    return sleep(70);
  }).then(function () {
    eq(Engine.findTx(S, tx.id), null, 'операция не удалилась');
    eq(Engine.walletBalance(S, w.id), bal0 + 4321, 'деньги не вернулись на кошелёк после удаления из аналитики');
    if (UI.closeCard) UI.closeCard();
    if (UI.closeSummary) UI.closeSummary();
    forceReduced(false);
  });
});

// (23) ВОЛНА 8 — настоящие страницы ленты кошельков (0.3.7)

// Шесть кошельков на время проверки: демо-состояние их не содержит, а ленту надо
// увидеть двухстраничной. Возврат — руками, проверки асинхронные.
function withSixWallets(body) {
  var S = UI.S, made = [];
  function restore() {
    made.forEach(function (w) { Engine.deleteWallet(S, w.id); });
    made = [];
    UI.render();
  }
  while (S.wallets.filter(function (w) { return !w.hidden; }).length < 6) {
    made.push(Engine.addWallet(S, { name: 'Стр ' + (made.length + 1), color: 'teal' }));
  }
  UI.render();
  // перерисовка асинхронная — даём ей случиться, иначе меряем старую ленту
  return sleep(80).then(body).then(
    function () { restore(); },
    function (e) { restore(); throw e; }
  );
}

function walletOrder() {
  return UI.S.wallets.filter(function (w) { return !w.hidden; })
    .sort(function (a, b) { return a.order - b.order; }).map(function (w) { return w.id; });
}

// (23а) перестановка через границу страниц: кошелёк с первой страницы встаёт на вторую,
// а сосед, которого он оттуда вытеснил, переезжает на первую — лента остаётся нарезанной
// ровно по четыре, без «пять тут и три там».
add('кошельки: перестановка с первой страницы на вторую держит нарезку по четыре', function () {
  return withSixWallets(function () {
    var strip = document.querySelector('#fieldWallets .strip');
    var before = walletOrder();
    eq(before.length, 6, 'кошельков должно быть шесть');
    var moved = before[0];
    var pw = strip.clientWidth;

    var src = document.querySelector('#fieldWallets .wcard[data-id="' + moved + '"]');
    ok(src, 'нет карточки первого кошелька');
    var pvis = panel ? panel.style.visibility : null;
    if (panel) panel.style.visibility = 'hidden';
    function done() { if (panel) panel.style.visibility = pvis; }

    UI.enterEdit();
    var a = center(src);
    pev(src, 'pointerdown', a.x, a.y, false);
    // подъём делаем ВНИЗ, а не вбок: сдвиг вбок сразу переставил бы плитку внутри
    // первой страницы, поехала бы анимация соседей, и мерить цель было бы нечего
    pev(document, 'pointermove', a.x, a.y + 12, false);

    // страницу листаем сами: на живом телефоне это делает палец у края (edgeWatch),
    // здесь важна сама перестановка через границу, а не таймер края
    strip.scrollLeft = pw;
    return sleep(UI.REORDER_MS + 120).then(function () {
      var second = document.querySelectorAll('#fieldWallets .wpage')[1];
      ok(second, 'второй страницы ленты нет');
      var tgt = second.querySelectorAll('.wcard')[1] || second.querySelector('.wcard');
      ok(tgt && tgt !== src, 'на второй странице нет цели для перестановки');
      var b = tgt.getBoundingClientRect();
      pev(document, 'pointermove', b.right - 4, b.top + b.height / 2, false);   // правая половина = «после»
      // нарезка не поехала: страницы по-прежнему 4 + 2
      var wp = document.querySelectorAll('#fieldWallets .wpage');
      eq(wp[0].querySelectorAll('.wcard').length, 4, 'первая страница расползлась во время переноса');
      eq(wp[1].querySelectorAll('.wcard').length, 2, 'вторая страница расползлась во время переноса');
      pev(document, 'pointerup', b.right - 4, b.top + b.height / 2, true);
      return sleep(UI.SETTLE_MS + 220);
    }).then(function () {
      UI.exitEdit();
      var after = walletOrder();
      eq(after.length, 6, 'кошелёк потерялся при перестановке');
      eq(after.slice().sort().join(','), before.slice().sort().join(','), 'состав кошельков изменился');
      ok(after.indexOf(moved) >= 4, 'кошелёк не переехал на вторую страницу: ' + after.join(','));
      var wp = document.querySelectorAll('#fieldWallets .wpage');
      eq(wp.length, 2, 'страниц после перестановки не две');
      eq(wp[0].querySelectorAll('.wcard').length, 4, 'после перестановки на первой странице не четыре');
      eq(wp[1].querySelectorAll('.wcard').length, 2, 'после перестановки на второй странице не два');
      var ids = [].map.call(document.querySelectorAll('#fieldWallets .wcard'), function (c) { return c.dataset.id; });
      eq(ids.join(','), after.join(','), 'порядок в ленте разошёлся с порядком в состоянии');
      done();
    }, function (e) {
      pev(document, 'pointercancel', 0, 0, true);
      done();
      throw e;
    });
  });
});

// (23б) перенос операции: доход тянем к правому краю ленты, она листается ЦЕЛОЙ
// страницей (а не подкручивается по пикселям), цель на второй странице ловится,
// и бросок открывает экран суммы.
add('кошельки: край ленты листает страницу целиком, бросок на 2-ю страницу ловится', function () {
  return withSixWallets(function () {
    var strip = document.querySelector('#fieldWallets .strip');
    var pw = strip.clientWidth;
    // поле доходов могло остаться свёрнутым от прежней проверки — развернём,
    // иначе плитку дохода не за что взять (её просто нет на экране)
    if (UI.S.ui.incomeCollapsed) { UI.S.ui.incomeCollapsed = false; UI.render(); }
    var inc = circle('inc', 0);
    ok(inc && inc.getBoundingClientRect().width > 0, 'нужен видимый доход на экране');
    var pvis = panel ? panel.style.visibility : null;
    if (panel) panel.style.visibility = 'hidden';
    function done() { if (panel) panel.style.visibility = pvis; }

    // рамку ленты меряем НЕ заранее, а в момент самого жеста: перерисовка приложения
    // асинхронная, и снятая заранее рамка врала бы на 40 px - палец уходил мимо ленты
    var r = null;
    var a = center(inc);
    pev(inc, 'pointerdown', a.x, a.y, false, 'mouse');
    pev(document, 'pointermove', a.x, a.y + 4, false, 'mouse');
    return sleep(Engine.PRESS_PICKUP + 60).then(function () {
      r = strip.getBoundingClientRect();
      pev(document, 'pointermove', r.right - 8, r.top + r.height / 2, false, 'mouse');
      ok(document.querySelector('.dragghost'), 'перенос не начался: призрака под пальцем нет');
      // держим палец у края: через D_EDGE_HOLD (500 мс) лента перевернётся страницей
      var n = 0;
      return waitFor(function () { return Math.round(strip.scrollLeft) >= pw - 2; }, 2500, function () {
        pev(document, 'pointermove', r.right - 7 - (n++ % 2), r.top + r.height / 2, false, 'mouse');
      });
    }).then(function () {
      // допуск в пиксель: ширина карточки дробная, и прокрутка доезжает до 399,7 из 400
      ok(Math.abs(strip.scrollLeft - pw) <= 1.5,
        'лента не перевернулась целой страницей: ' + Math.round(strip.scrollLeft) + ' вместо ' + pw +
        ' [лента ' + strip.clientWidth + '/' + strip.scrollWidth + ']');
      var second = document.querySelectorAll('#fieldWallets .wpage')[1].querySelector('.wcard');
      ok(second, 'на второй странице нет кошелька');
      var c = center(second);
      pev(document, 'pointermove', c.x, c.y, false, 'mouse');
      ok(second.classList.contains('is-target'), 'кошелёк на 2-й странице не поймался целью');
      pev(document, 'pointerup', c.x, c.y, true, 'mouse');
      return sleep(80);
    }).then(function () {
      ok(!document.getElementById('amount').hidden, 'экран суммы не открылся по броску на 2-й странице ленты');
      eq(document.getElementById('amTo').textContent,
        UI.walletName(document.querySelectorAll('#fieldWallets .wpage')[1].querySelector('.wcard').dataset.id),
        'операция нацелилась не на тот кошелёк');
      UI.closeAmount();
      done();
    }, function (e) {
      pev(document, 'pointercancel', 0, 0, true, 'mouse');
      try { UI.closeAmount(); } catch (x) {}
      done();
      throw e;
    });
  });
});

// (24) ВОЛНА 9 — вкладка «Лента» в аналитике и сворачивание доходов (0.3.9)

// (24а) лента печатает ровно то, что посчитал движок: дни сверху вниз, строки по ts,
// «остаток на конец дня» и «изменение» — числами из feedByDay, а не своим счётом на месте.
add('лента: дни, строки и подвал совпадают с расчётом движка', function () {
  var S = UI.S, ymStr = UI.curYM();
  UI.openSummary({ ym: ymStr, view: 'feed' });
  return sleep(60).then(function () {
    eq(UI.summaryView(), 'feed', 'вкладка ленты не включилась');
    ok(getComputedStyle(document.getElementById('smKinds')).display === 'none', '«Расходы | Доходы» видны в ленте');
    var days = Engine.feedByDay(S, ymStr);
    var box = document.querySelectorAll('#smBody .fd-day');
    eq(box.length, days.length, 'дней в ленте');
    ok(days.length, 'в демо-месяце должны быть операции');
    for (var i = 0; i < days.length; i++) {
      var g = days[i], d = box[i];
      eq(d.querySelector('.fd-h').textContent, g.label, 'подпись дня ' + g.date);
      var ids = [].map.call(d.querySelectorAll('.txrow'), function (r) { return r.dataset.id; });
      eq(ids.join(','), g.rows.map(function (t) { return t.id; }).join(','), 'порядок строк дня ' + g.date);
      eq(d.querySelector('.fd-bal').textContent, 'остаток на конец дня ' + UI.fmt(g.balanceEnd) + ' ₽', 'остаток дня ' + g.date);
      eq(d.querySelector('.fd-ch').textContent,
        'изменение ' + (g.change > 0 ? '+' : '') + UI.fmt(g.change) + ' ₽', 'изменение дня ' + g.date);
      ok(g.change >= 0 || d.querySelector('.fd-ch').classList.contains('neg'), 'минус не покрашен красным');
      ok(g.change <= 0 || d.querySelector('.fd-ch').classList.contains('pos'), 'плюс не покрашен зелёным');
    }
    // строка: кошелёк сверху, категория снизу, знак и цвет по виду операции
    var row = document.querySelector('#smBody .txrow');
    var t0 = Engine.findTx(S, row.dataset.id);
    ok(row.querySelector('.fd-w') && row.querySelector('.fd-n'), 'в строке нет кошелька над категорией');
    eq(row.querySelector('.fd-n').textContent, UI.catName(t0.catId), 'категория в строке');
    eq(row.querySelector('.fd-w').textContent, UI.walletName(t0.walletId), 'кошелёк в строке');
    var amt = row.querySelector('.txa');
    eq(amt.textContent, (t0.kind === 'inc' ? '+' : '−') + UI.money(t0.amount) + ' ₽', 'сумма в строке');
    ok(amt.classList.contains(t0.kind === 'inc' ? 'pos' : 'neg'), 'сумма не того цвета');
    // пустой месяц говорит об этом словами, а не пустотой
    UI.closeSummary();
    return sleep(20);
  }).then(function () {
    UI.openSummary({ ym: '2019-01', view: 'feed' });
    return sleep(40);
  }).then(function () {
    var e = document.querySelector('#smBody .empty');
    ok(e && e.textContent === 'В этом месяце операций нет', 'пустой месяц молчит');
    UI.closeSummary();
    return sleep(20);
  });
});

// (24б) выбор из двух карточек: аналитика ВСЕГДА открывается выбором, тап ведёт на свой
// экран, «к выбору» и «назад» возвращают к выбору, а следующий заход снова показывает
// выбор (память «последнего открытого» убрана — авто-переход в прошлый экран не делаем).
add('аналитика: всегда открывается выбором, не запоминает последний экран', function () {
  function shown(sel) { var e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; }
  UI.openSummary();
  return sleep(40).then(function () {
    eq(UI.summaryView(), 'chooser', 'аналитика открылась не выбором');
    eq(document.getElementById('summary').dataset.view, 'chooser', 'data-view не «chooser»');
    ok(shown('#smChoose'), 'карточки выбора не показаны');
    ok(document.getElementById('smGoSummary') && document.getElementById('smGoFeed'), 'нет двух карточек');
    ok(!shown('.sm-mo'), 'на выборе видна навигация по месяцу');
    ok(!shown('#smBody'), 'на выборе видно тело экрана');
    document.getElementById('smGoFeed').click();
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'feed', 'карточка «Лента» не открыла ленту');
    eq(document.getElementById('summary').dataset.view, 'feed', 'data-view не «feed»');
    ok(shown('.sm-mo'), 'внутри экрана нет навигации по месяцу');
    ok(!shown('#smKinds'), 'в ленте показан разрез «Расходы | Доходы»');
    ok(!shown('#smChoose'), 'на экране остались карточки выбора');
    document.getElementById('smToChoose').click();     // стрелка «к выбору»
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'chooser', 'стрелка не вернула к выбору');
    document.getElementById('smGoSummary').click();
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'summary', 'карточка «Сводка» не открыла сводку');
    ok(shown('#smKinds'), '«Расходы | Доходы» не показаны в сводке');
    ok(document.querySelector('#smBody .sm-big'), 'сводка не нарисовалась');
    UI.closeSummary();
    return sleep(20);
  }).then(function () {
    UI.openSummary();                          // следующий заход — снова выбор, не «Сводка»
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'chooser', 'повторный заход не открылся выбором');
    UI.summaryBack();                          // «назад» с выбора закрывает аналитику
    return sleep(40);
  }).then(function () {
    eq(UI.summaryOpen(), false, '«назад» с выбора не закрыл аналитику');
    return sleep(20);
  });
});

// (24б-2) ВОЛНА 0.4.3 — три новых экрана аналитики и история прошлых месяцев.
// Чузер из пяти карточек по порядку; каждый новый экран рисуется; тепловая карта
// тапается по дню; зона внимания сортирует over→warn; динамика даёт 12 столбцов;
// прошлый месяц (история с компа) виден с плашкой «из Бюджета» и НЕ уезжает в factsPayload.
add('аналитика 0.4.3: пять карточек, три новых экрана, история read-only', function () {
  function shown(sel) { var e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; }
  // прошлый месяц того же года — для проверки истории (в демо она заполнена)
  var cur = UI.curYM();
  var py = parseInt(cur.slice(0, 4), 10), pm = parseInt(cur.slice(5, 7), 10) - 1;
  if (pm < 1) { py -= 1; pm = 12; }
  var past = py + '-' + (pm < 10 ? '0' : '') + pm;

  UI.openSummary();
  return sleep(40).then(function () {
    var ids = [].map.call(document.querySelectorAll('#smChoose .sm-card'), function (c) { return c.id; });
    eq(ids.join(','), 'smGoSummary,smGoFeed,smGoHeat,smGoAttn,smGoDyn', 'порядок карточек чузера');
    // тепловая карта
    document.getElementById('smGoHeat').click();
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'heat', 'тепловая карта не открылась');
    ok(document.querySelectorAll('#smBody .hm-cell[data-date]').length >= 28, 'в тепловой карте нет клеток дней');
    ok(document.querySelector('#smBody .hm-legend'), 'нет легенды «меньше…больше»');
    // тап по дню с тратой показывает список операций
    var hot = [].filter.call(document.querySelectorAll('#smBody .hm-cell[data-date]'), function (c) {
      var i = c.querySelector('i'); return i && parseFloat(i.style.getPropertyValue('--i')) > 0;
    })[0];
    if (hot) { hot.click(); }
    return sleep(40).then(function () {
      if (hot) ok(document.querySelector('#smBody .hm-day'), 'тап по дню не показал операции');
      document.getElementById('smToChoose').click();
      return sleep(40);
    });
  }).then(function () {
    // зона внимания
    document.getElementById('smGoAttn').click();
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'attn', 'зона внимания не открылась');
    ok(!shown('#smKinds'), 'в зоне внимания виден разрез «Расходы | Доходы»');
    var rows = [].slice.call(document.querySelectorAll('#smBody .at-row'));
    var over = rows.filter(function (r) { return r.classList.contains('lvl-over'); });
    var warn = rows.filter(function (r) { return r.classList.contains('lvl-warn'); });
    // перебравшие идут раньше подобравшихся (если есть и те, и те)
    if (over.length && warn.length) {
      ok(rows.indexOf(over[over.length - 1]) < rows.indexOf(warn[0]), 'over не раньше warn');
    }
    document.getElementById('smToChoose').click();
    return sleep(40);
  }).then(function () {
    // динамика
    document.getElementById('smGoDyn').click();
    return sleep(40);
  }).then(function () {
    eq(UI.summaryView(), 'dyn', 'динамика не открылась');
    eq(document.querySelectorAll('#smBody .dy-row').length, 12, 'в динамике не 12 строк-месяцев');
    eq(document.querySelectorAll('#smBody .dy-row.on').length, 1, 'в динамике не подсвечен один месяц');
    // все 12 строк влезают без вертикальной прокрутки тела
    var _smb = document.getElementById('smBody');
    ok(_smb.scrollHeight <= _smb.clientHeight + 1, 'список динамики не влезает без прокрутки: ' + _smb.scrollHeight + ' > ' + _smb.clientHeight);
    // сумма факта не обрезается: значение целиком помещается в свою ячейку
    var _dv = document.querySelector('#smBody .dy-row.on .dy-v');
    if (_dv) ok(_dv.scrollWidth <= _dv.clientWidth + 1, 'сумма в динамике обрезана: ' + _dv.textContent);
    UI.closeSummary();
    // История «из Бюджета» (read-only прошлые месяцы, factsPayload, плашка) убрана в
    // автономном форке - соответствующая часть проверки удалена.
  });
});

// (24б-3) подпись плитки «Бэкап в файл» — «сохранить данные»
add('меню: у «Бэкап в файл» подпись «сохранить данные»', function () {
  var s = document.querySelector('#mBackup .mi-s');
  ok(s, 'нет плитки «Бэкап в файл»');
  eq(s.textContent, 'сохранить данные', 'подпись «Бэкап» не та');
});

// (24в) тап по строке ленты открывает ту же форму правки, что и свайп вправо
// в карточке кошелька: обработчики у них общие (UI.bindTxSwipe).
add('лента: тап по строке открывает правку операции', function () {
  UI.openSummary({ ym: UI.curYM(), view: 'feed' });
  return sleep(60).then(function () {
    var row = document.querySelector('#smBody .txrow');
    ok(row, 'в ленте нет ни одной операции');
    var id = row.dataset.id;
    withoutPanel(function () {
      var r = row.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      pev(row, 'pointerdown', x, y, false, 'touch');
      pev(row, 'pointerup', x, y, true, 'touch');
    });
    return sleep(50).then(function () {
      ok(UI.dlgOpen(), 'форма правки не открылась по тапу');
      eq(document.getElementById('dlgTitle').textContent, 'Операция', 'открылось не то окно');
      var t = Engine.findTx(UI.S, id);
      eq(Engine.parseNum(document.getElementById('etAmount').value), t.amount, 'в форме чужая сумма');
      UI.closeDlg();
      UI.closeSummary();
      return sleep(20);
    });
  });
});

// (24г) сворачивание доходов: заголовок остаётся, плитки уходят, а высота достаётся
// сетке расходов. Рядов после сворачивания не может стать МЕНЬШЕ, чем было.
add('доходы: тап по заголовку сворачивает поле и отдаёт ряд расходам', function () {
  var was = !!UI.S.ui.incomeCollapsed;
  forceReduced(true);                       // без анимации: переход происходит сразу
  UI.S.ui.incomeCollapsed = false;
  // мерить рядЫ надо по СВЕЖЕЙ раскладке: прежние проверки заводили и убирали кошельки,
  // а число рядов у них закэшировано - иначе сравниваем с числом из другой жизни
  UI.relayout();
  var head = document.getElementById('incHead');
  ok(head && head.tagName.toLowerCase() === 'button', 'заголовок доходов не кнопка');
  ok(head.querySelector('.ph-chev svg'), 'у заголовка нет галочки');
  eq(head.getAttribute('aria-expanded'), 'true', 'aria-expanded развёрнутого поля');
  // Галочка = состояние: развёрнуто → смотрит ВВЕРХ (rotate 180°, matrix(-1…)),
  // свёрнуто → ВНИЗ (rotate 0°, none/matrix(1…)).
  function chevUp() {
    var m = getComputedStyle(head.querySelector('.ph-chev')).transform;
    return m.indexOf('matrix(-1') === 0;
  }
  ok(chevUp(), 'у развёрнутого поля галочка не смотрит вверх');

  var rows0 = UI.expRows(), body = document.getElementById('incBody');
  ok(body.getBoundingClientRect().height > 20, 'поле доходов и так свёрнуто');
  var text0 = document.getElementById('incHeadText').textContent;

  head.click();
  return sleep(60).then(function () {
    eq(UI.S.ui.incomeCollapsed, true, 'состояние не записалось');
    ok(document.getElementById('fieldInc').classList.contains('collapsed'), 'поле не свернулось');
    eq(body.getBoundingClientRect().height, 0, 'плитки доходов остались на экране');
    eq(document.getElementById('incDots').getBoundingClientRect().height, 0, 'точки доходов остались');
    eq(document.getElementById('incHeadText').textContent, text0, 'заголовок с суммой пропал');
    eq(head.getAttribute('aria-expanded'), 'false', 'aria-expanded свёрнутого поля');
    ok(!chevUp(), 'у свёрнутого поля галочка не смотрит вниз');
    var rows1 = UI.expRows();
    ok(rows1 >= rows0, 'рядов расходов стало меньше: ' + rows1 + ' было ' + rows0);
    ok(window.innerHeight < 800 || rows1 > rows0,
      'на высоком экране свёрнутые доходы не дали ряда: ' + rows1 + ' было ' + rows0);
    var exp = document.getElementById('fieldExp').getBoundingClientRect();
    ok(exp.bottom <= window.innerHeight + 1,
      'сетка вылезла за экран: ' + Math.round(exp.bottom) + ' > ' + window.innerHeight);
    head.click();
    return sleep(60);
  }).then(function () {
    eq(UI.S.ui.incomeCollapsed, false, 'обратно не развернулось');
    ok(!document.getElementById('fieldInc').classList.contains('collapsed'), 'класс collapsed остался');
    ok(body.getBoundingClientRect().height > 20, 'плитки доходов не вернулись');
    eq(UI.expRows(), rows0, 'рядов расходов после разворота');
    eq(head.getAttribute('aria-expanded'), 'true', 'aria-expanded после разворота');
    ok(chevUp(), 'после разворота галочка не вернулась вверх');
    var exp2 = document.getElementById('fieldExp').getBoundingClientRect();
    ok(exp2.bottom <= window.innerHeight + 1, 'после разворота сетка вылезла за экран');
    forceReduced(false);
    if (was) { UI.S.ui.incomeCollapsed = true; UI.relayout(); }
  });
});

// (24д) правки UX 0.4.2: подпись «Сводка месяца», подпись и половинность плитки
// «О приложении», порядок и парность сетки меню, нижний зазор экрана и плавное
// сворачивание доходов без прыжка соседей в начале перехода.
add('0.4.2: подписи, сетка меню, нижний зазор, плавность без прыжка', function () {
  // 1. подзаголовок карточки «Сводка месяца»
  var sub = document.querySelector('#smGoSummary .sm-card-s');
  eq(sub && sub.textContent.trim(), 'движение денег, по категориям', 'подпись карточки «Сводка месяца»');

  // 2. плитка «О приложении» — половинная (не во всю ширину) с новой подписью
  var ab = document.getElementById('mAbout');
  ok(ab && !ab.classList.contains('wide'), 'плитка «О приложении» осталась во всю ширину');
  eq(ab.querySelector('.mi-s').textContent.trim(), 'Как пользоваться, автор', 'подпись плитки «О приложении»');

  // 3. порядок плиток меню: ровно как задал хозяин, парами, без пустой ячейки
  var ids = [].map.call(document.querySelectorAll('#menu .menu-list .mi'), function (b) { return b.id; });
  eq(ids.join(','),
    'mTheme,mUpdate,mCats,mWallets,mSound,mHaptic,mHints,mAbout,mBackup,mRestore',
    'порядок плиток меню');
  eq(ids.length % 2, 0, 'нечётное число плиток — будет пустая половина');

  // 4. нижний зазор приложения: padding-bottom > 0 и карточка расходов не на самом краю
  var pb = parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom) || 0;
  ok(pb >= 10, 'нижний зазор приложения меньше 10px: ' + pb);
  ok(document.getElementById('fieldExp').getBoundingClientRect().bottom < window.innerHeight,
    'карточка расходов лежит вплотную к нижнему краю');

  // 5. плавность сворачивания: на СТАРТЕ перехода лента кошельков не прыгает — сетка
  //    расходов не пересчитывается в начале, соседи едут только за высотой доходов.
  var wasCol = !!UI.S.ui.incomeCollapsed;
  forceReduced(false);
  UI.S.ui.incomeCollapsed = false; UI.relayout();
  function walTop() { return Math.round(document.getElementById('fieldWallets').getBoundingClientRect().top); }
  return sleep(60).then(function () {
    var start = walTop();
    document.getElementById('incHead').click();     // старт анимированного сворачивания
    return sleep(30).then(function () {
      ok(UI.incomeAnimating(), 'переход сворачивания не идёт');
      ok(Math.abs(walTop() - start) <= 8, 'лента кошельков прыгнула на старте перехода: ' + start + ' -> ' + walTop());
      return sleep(340);
    }).then(function () {
      ok(!UI.incomeAnimating(), 'переход не завершился');
      ok(document.getElementById('fieldExp').getBoundingClientRect().bottom < window.innerHeight,
        'после сворачивания сетка на самом краю экрана');
      UI.S.ui.incomeCollapsed = wasCol; UI.relayout();
    });
  });
});

// (25а) подсказки: главная про перенос — на главном экране; в карточке кошелька её нет,
// там подсказка про свайп по строке. Обе гаснут свайпом и общим выключателем.
add('подсказки: главная на месте, в карточке — про свайп, не про перенос', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  try {
    UI.S.ui.hints = true;
    UI.S.ui.hintsDismissed = {};
    UI.save(); UI.render();
    // главная подсказка видна и говорит про перенос, а не про свайп по строке
    var mh = document.getElementById('mainHint');
    ok(mh && !mh.hidden, 'главная подсказка не показана');
    ok(mh.textContent.indexOf('веди пальцем') >= 0, 'главная подсказка не про перенос');
    // карточка кошелька: подсказка про свайп по строке, НЕ про «подними и неси»
    var w = circle('wallet', 0);
    UI.openCard({ kind: 'wallet', id: w.dataset.id });
    var ch = document.getElementById('cardHint');
    var ht = ch.querySelector('.sh-ht').textContent;
    ok(ht.indexOf('Потяни строку') >= 0, 'в карточке кошелька не подсказка про свайп: ' + ht);
    ok(ht.indexOf('неси') < 0, 'в карточке кошелька осталась подсказка про перенос');
    UI.closeCard();
  } finally {
    UI.S.ui.hints = wasHints;
    UI.S.ui.hintsDismissed = JSON.parse(wasDis);
    UI.save(); UI.render();
  }
});

// (25б) выключатель «Подсказки»: выкл — подсказок нет нигде, вкл — снова показываются
add('подсказки: выключатель в меню прячет их и возвращает', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  try {
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = {}; UI.save(); UI.render();
    ok(!document.getElementById('mainHint').hidden, 'при вкл. подсказках главной нет');
    UI.openMenu();
    ok(document.getElementById('mHints'), 'нет плитки «Подсказки»');
    ok(document.getElementById('mHintsSw').classList.contains('on'), 'выключатель подсказок не «вкл»');
    eq(document.getElementById('mHintsInfo').textContent, 'вкл', 'подпись подсказок не «вкл»');
    document.getElementById('mHints').click();     // выключаем
    eq(UI.S.ui.hints, false, 'подсказки не выключились');
    eq(document.getElementById('mHintsInfo').textContent, 'выкл', 'подпись не «выкл»');
    UI.closeMenu(); UI.render();
    ok(document.getElementById('mainHint').hidden, 'при выкл. подсказках главная осталась');
    var w = circle('wallet', 0);
    UI.openCard({ kind: 'wallet', id: w.dataset.id });
    ok(document.getElementById('cardHint').hidden, 'при выкл. подсказках в карточке осталась');
    UI.closeCard();
  } finally {
    UI.S.ui.hints = wasHints;
    UI.S.ui.hintsDismissed = JSON.parse(wasDis);
    UI.save(); UI.render();
  }
});

// (25в) погашение свайпом: смахнул подсказку — она больше не показывается (в этом контексте).
// fill/taps заранее гасим, чтобы в очереди осталась одна mainDrag — иначе после её свайпа
// на её место встала бы следующая из цепочки, и «скрылась ли» проверялось бы неверно.
add('подсказки: свайп по подсказке гасит её и запоминает это', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  try {
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = { fill: true, taps: true }; UI.save(); UI.render();
    var mh = document.getElementById('mainHint');
    ok(!mh.hidden, 'главная подсказка не показана до свайпа');
    withoutPanel(function () {
      var r = mh.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      pev(mh, 'pointerdown', x, y, false, 'touch');
      pev(document, 'pointermove', x + 60, y, false, 'touch');   // свайп вбок
      pev(document, 'pointerup', x + 60, y, true, 'touch');
    });
    ok(UI.S.ui.hintsDismissed.mainDrag === true, 'свайп не записал подсказку как погашенную');
    ok(mh.hidden, 'подсказка не скрылась после свайпа');
    UI.render();
    ok(document.getElementById('mainHint').hidden, 'погашенная подсказка вернулась после перерисовки');
  } finally {
    UI.S.ui.hints = wasHints;
    UI.S.ui.hintsDismissed = JSON.parse(wasDis);
    UI.save(); UI.render();
  }
});

// (25д) очередь на главном: одна подсказка за раз, порядок mainDrag → fill → taps.
// fill встаёт только если на экране есть цветной кружок расхода; taps — всегда следом.
add('подсказки: очередь на главном (mainDrag → fill → taps), по одной', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  try {
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = {}; UI.save(); UI.render();
    var mh = document.getElementById('mainHint');
    function txt() { return mh.querySelector('.mh-t').textContent; }
    ok(!mh.hidden, 'на старте главной подсказки нет');
    ok(txt().indexOf('веди пальцем') >= 0, 'первой в очереди должна быть mainDrag');
    var hasColor = !!document.querySelector('#app .circle[data-kind="exp"] .ring.lvl-ok,' +
      '#app .circle[data-kind="exp"] .ring.lvl-warn,#app .circle[data-kind="exp"] .ring.lvl-over');
    UI.dismissHint('mainDrag'); UI.render();
    if (hasColor) {
      ok(!mh.hidden && txt().indexOf('Кружок') >= 0, 'после mainDrag не встала fill (про цвет кружка)');
      UI.dismissHint('fill'); UI.render();
    }
    ok(!mh.hidden && txt().indexOf('Тап по плитке') >= 0, 'не встала taps (про тапы)');
    UI.dismissHint('taps'); UI.render();
    ok(mh.hidden, 'после гашения всей цепочки главная подсказка осталась');
  } finally {
    UI.S.ui.hints = wasHints; UI.S.ui.hintsDismissed = JSON.parse(wasDis); UI.save(); UI.render();
  }
});

// (25е) экран суммы: подсказка про калькулятор, появляется и гаснет (погашенная не возвращается)
add('подсказки: на экране суммы про калькулятор, гашение помнится', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  function openAm() {
    UI.openAmount({ kind: 'exp', walletId: circle('wallet', 0).dataset.id, catId: circle('exp', 0).dataset.id });
  }
  try {
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = {}; UI.save();
    openAm();
    var el = document.getElementById('amHint');
    ok(el && !el.hidden, 'на экране суммы подсказки нет');
    ok(el.textContent.indexOf('150+300') >= 0, 'текст подсказки суммы не про калькулятор');
    UI.closeAmount();
    UI.dismissHint('amount'); UI.save();
    openAm();
    ok(document.getElementById('amHint').hidden, 'погашенная подсказка суммы вернулась');
    UI.closeAmount();
  } finally {
    UI.S.ui.hints = wasHints; UI.S.ui.hintsDismissed = JSON.parse(wasDis); UI.save(); UI.render();
  }
});

// (25ж) окно «Категории»: подсказка про лимит; общий выключатель её гасит
add('подсказки: в «Категориях» про лимит, слушается выключателя', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  try {
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = {}; UI.save();
    UI.openCats('exp');
    var el = document.getElementById('dlgHint');
    ok(el && !el.hidden, 'в «Категориях» подсказки нет');
    ok(el.textContent.indexOf('лимит') >= 0, 'текст подсказки категорий не про лимит: ' + el.textContent);
    UI.closeDlg();
    UI.S.ui.hints = false; UI.save();
    UI.openCats('exp');
    ok(document.getElementById('dlgHint').hidden, 'при выкл. подсказках в «Категориях» осталась');
    UI.closeDlg();
  } finally {
    UI.S.ui.hints = wasHints; UI.S.ui.hintsDismissed = JSON.parse(wasDis); UI.save(); UI.render();
  }
});

// (25з) режим правки: подсказка про перестановку; погашенная не возвращается
add('подсказки: в режиме правки про перестановку, гашение помнится', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  var wasEdit = document.body.classList.contains('editmode');
  try {
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = {}; UI.save();
    UI.enterEdit();
    var el = document.getElementById('editHint');
    ok(el && !el.hidden, 'в режиме правки подсказки нет');
    ok(el.textContent.indexOf('Перетаскивай') >= 0, 'текст подсказки правки не тот');
    UI.dismissHint('edit'); UI.exitEdit();
    UI.enterEdit();
    ok(document.getElementById('editHint').hidden, 'погашенная подсказка правки вернулась');
    UI.exitEdit();
  } finally {
    if (!wasEdit) UI.exitEdit();
    UI.S.ui.hints = wasHints; UI.S.ui.hintsDismissed = JSON.parse(wasDis); UI.save(); UI.render();
  }
});

// (25и) карточка кошелька: очередь cardSwipe → adjust. Пока cardSwipe жива и есть
// операции — adjust ждёт; как только cardSwipe погашена — встаёт adjust про «Изменить баланс».
add('подсказки: в карточке кошелька очередь cardSwipe → adjust', function () {
  var wasHints = UI.S.ui.hints;
  var wasDis = JSON.stringify(UI.S.ui.hintsDismissed || {});
  try {
    var w = circle('wallet', 0);
    var hasOps = Engine.txOfWallet(UI.S, w.dataset.id, UI.curYM()).length > 0;
    // cardSwipe жива: при наличии операций она главнее adjust
    UI.S.ui.hints = true; UI.S.ui.hintsDismissed = {}; UI.save();
    UI.openCard({ kind: 'wallet', id: w.dataset.id });
    if (hasOps) {
      ok(!document.getElementById('cardHint').hidden, 'cardSwipe не показана при операциях');
      ok(document.getElementById('cardAdjustHint').hidden, 'adjust вылезла раньше cardSwipe');
    }
    UI.closeCard();
    // cardSwipe погашена — на её место встаёт adjust
    UI.S.ui.hintsDismissed = { cardSwipe: true }; UI.save();
    UI.openCard({ kind: 'wallet', id: w.dataset.id });
    var adj = document.getElementById('cardAdjustHint');
    ok(adj && !adj.hidden, 'после гашения cardSwipe adjust не встала');
    ok(adj.textContent.indexOf('Изменить баланс') >= 0, 'текст adjust не про изменение баланса');
    ok(document.getElementById('cardHint').hidden, 'cardSwipe и adjust показаны разом');
    UI.closeCard();
  } finally {
    UI.S.ui.hints = wasHints; UI.S.ui.hintsDismissed = JSON.parse(wasDis); UI.save(); UI.render();
  }
});

// (25г) светлая тема: плитки меню отделены от фона — либо своим фоном, либо гранью/тенью
add('меню: плитки читаются на фоне (контраст в светлой теме)', function () {
  UI.openMenu();
  var mi = document.querySelector('#menu .menu-list .mi');
  var menu = document.getElementById('menu');
  ok(mi && menu, 'нет плиток меню');
  var cs = getComputedStyle(mi);
  var tileBg = cs.backgroundColor, menuBg = getComputedStyle(menu).backgroundColor;
  var hasBorder = parseFloat(cs.borderTopWidth) > 0 &&
    cs.borderTopColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopColor !== 'transparent';
  var hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
  // плитка отделена, если её фон отличается от фона меню ИЛИ у неё есть видимая грань/тень
  ok(tileBg !== menuBg || hasBorder || hasShadow,
    'плитка сливается с фоном меню: bg ' + tileBg + ' vs ' + menuBg);
  if (UI.S.ui.theme === 'light') {
    ok(tileBg !== menuBg, 'в светлой теме фон плитки совпал с фоном меню: ' + tileBg);
  }
  UI.closeMenu();
});

// ---------- прогон ----------
function run() {
  mount();
  // На первом запуске демо поверх главного висит приветствие (онбординг). Оно перекрывает
  // экран и мешает проверкам слоёв и подсказок - гасим его так же, как кнопка «Понятно».
  var ob = document.getElementById('onboard');
  if (ob && !ob.hidden) { var d = document.getElementById('obDone'); if (d) d.click(); }
  var snap = JSON.stringify(UI.S);
  var chain = Promise.resolve();
  CHECKS.forEach(function (c) {
    chain = chain.then(function () {
      total++;
      return Promise.resolve().then(c.fn).then(function () {
        passed++;
        line('pass', 'PASS ' + c.name);
      }, function (e) {
        line('fail', 'FAIL ' + c.name + ': ' + (e && e.message ? e.message : e));
      }).then(function () {
        // Между тестами возвращаем интерактив в покой: упавший на середине тест мог
        // оставить залипший режим правки или открытый слой, и это роняло бы следующие
        // проверки (шапка «0 px», подсказки «не показана»). Изоляция тестов.
        try {
          if (window.UI) {
            if (UI.exitEdit && document.body.classList.contains('editmode')) UI.exitEdit();
            if (UI.closeTop) { for (var g = 0; g < 8 && UI.closeTop(); g++) {} }
          }
        } catch (x) {}
      });
    });
  });
  return chain.then(function () {
    forceReduced(false);
    try {
      UI.S = Engine.migrate(JSON.parse(snap));               // всё, что натрогали, возвращаем как было
      UI.save(); UI.render();
    } catch (e) {
      line('fail', 'FAIL восстановление состояния: ' + e.message);
      total++;
    }
    var sum = 'SELFTEST ' + passed + '/' + total + ' ' + (passed === total ? 'PASS' : 'FAIL');
    var el = document.getElementById('stSum');
    el.textContent = sum;
    el.className = 'st-sum ' + (passed === total ? 'pass' : 'fail');
    panel.setAttribute('data-result', sum);
  });
}

setTimeout(run, 0);

})();
