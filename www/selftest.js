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
// 1.0.3 (решение Алексея 05.10): меню из 8 плиток. Звук, вибрация и подсказки - в подменю
// «Звук и подсказки» (mPrefs), сохранение, восстановление и напоминание - в «Копия данных» (mCopy).
var MENU_ORDER = ['mTheme', 'mUpdate', 'mCats', 'mWallets', 'mPrefs', 'mCopy', 'mLock', 'mAbout'];
var MENU_TITLES = ['Тема', 'Обновление', 'Настроить категории', 'Настроить кошельки',
                   'Звук и подсказки', 'Копия данных', 'Защита входа', 'О приложении'];
// старые плитки, переехавшие в подменю: в меню их быть не должно
var MENU_GONE = ['mSound', 'mHaptic', 'mHints', 'mRemind', 'mBackup', 'mRestore'];
// Открыть подменю плитки (меню под ним остаётся открытым), выполнить fn, всё закрыть.
function withSub(tileId, fn) {
  UI.openMenu();
  document.getElementById(tileId).click();
  // окна-внуки (напр. «Таблица Excel») по закрытию возвращают в своё подменю - закрываем все слои
  var done = function () { for (var i = 0; i < 4 && UI.dlgOpen(); i++) UI.closeDlg(); UI.closeMenu(); };
  try {
    ok(!document.getElementById('dlg').hidden, 'подменю ' + tileId + ' не открылось');
    var r = fn();
    if (r && r.then) return r.then(function (v) { done(); return v; }, function (e) { done(); throw e; });
    done();
    return r;
  } catch (e) { done(); throw e; }
}

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
  eq(document.getElementById('incHeadText').textContent,
    'Доходы · ' + UI.fmt(inc) + incSuf + '\u00a0₽', 'заголовок доходов');
  // 1.0.3: факт расходов - только в шапке («Потрачено»), в заголовке блока - сумма лимитов
  eq(document.getElementById('expHead').textContent,
    plan > 0 ? 'Расходы · лимит ' + UI.fmt(plan) + '\u00a0₽' : 'Расходы', 'заголовок расходов');
  ok(document.getElementById('expHead').textContent.indexOf(UI.fmt(fact)) < 0 || fact === plan, 'факт расходов повторён в заголовке блока');
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
    UI.money(Engine.walletBalance(UI.S, id)) + '\u00a0₽', 'сумма на карточке');
  ok(document.getElementById('cardBase'), 'нет кнопки «Изменить баланс»');
  ok(!document.getElementById('cardTransfer'), 'вернулась кнопка «Перевести» (дубль «+» и перетаскивания, 14.10)');
  eq([].map.call(document.querySelectorAll('#cardActs button'), function (b) { return b.textContent; }).join('|'), 'Изменить баланс|Настроить', 'кнопки карточки кошелька');
  ok(document.getElementById('cardSetup'), 'нет кнопки «Настроить»');
  ok(!document.getElementById('cardHide'), '«Скрыть» осталось в карточке: оно живёт в форме');
  ok(document.getElementById('cardHint'), 'нет подсказки хомяка');
  ok(document.getElementById('cardIco').classList.contains('wallet'), 'иконка кошелька без класса wallet');
  UI.closeCard();
  eq(UI.cardOpen(), false, 'карточка не закрылась');
});

// (17б) порченое хранилище: приложение не умирает, битый текст откладывается на разбор
// в карантин со своим ключом (1.0.3: BROKEN_KEY-<дата-время>, копия проверена чтением)
add('порча базы: откат на пустое состояние, битое отложено в карантин', function () {
  function qKeys() {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(UI.BROKEN_KEY + '-') === 0) out.push(k); } } catch (e) {}
    return out;
  }
  var before = qKeys();
  try {
    // ровно те входы из ревью, что валили запуск целиком
    ['{"ver":1,"ui":{"order":"no"}}', '{обрезан', '"строка"', '[1,2,3]'].forEach(function (raw) {
      var st = null;
      try { st = UI.loadFrom(raw); } catch (e) { fail('loadFrom бросил на ' + raw + ': ' + e.message); }
      ok(st && typeof st === 'object', 'нет состояния для ' + raw);
      ok(Array.isArray(st.tx) && Array.isArray(st.wallets), 'форма поехала на ' + raw);
      ok(st.ui && Array.isArray(st.ui.order.exp), 'ui.order не массив на ' + raw);
      // первый вход - наши данные с кривым полем: миграция чинит его, это не порча
      if (raw.charAt(1) === '"' && raw.indexOf('"ver"') === 1) return;
      var pr = UI.loadProblem();
      ok(pr && pr.kind === 'broken' && pr.copied === true, 'копия битого не легла для ' + raw);
      eq(localStorage.getItem(pr.key), raw, 'в карантине не тот текст для ' + raw);
    });
    var made = qKeys().filter(function (k) { return before.indexOf(k) < 0; });
    eq(made.length, 3, 'каждая порча - своя копия в карантине (вторая не затирает первую)');
    ok(typeof UI.wasRecovered() === 'boolean', 'нет признака восстановления');
  } finally {
    try { qKeys().forEach(function (k) { if (before.indexOf(k) < 0) localStorage.removeItem(k); }); } catch (e) {}
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
  ok(warn.textContent.indexOf('Копия данных') >= 0, 'полоса не зовёт сохранить копию: ' + warn.textContent);
  eq(UI.save(), true, 'после починки хранилища save() не прошёл');
  eq(warn.hidden, true, 'полоса не убралась после успешной записи');
});

// (17в-2) Р16 ревью 15.10: места не хватило, а в хранилище лежит копия перед загрузкой таблицы -
// save() сначала убирает её и пишет ещё раз; окна «Не удалось сохранить» и полосы нет
add('отказ записи: сначала убирается копия перед загрузкой таблицы, потом окно', function () {
  var real = localStorage.setItem, snapKey = UI.KEY + '.preimport', res, tries = 0;
  var warn = document.getElementById('saveWarn');
  UI.closeDlg();
  real.call(localStorage, snapKey, '{"tx":[]}');
  try {
    localStorage.setItem = function (k, v) {
      if (k === UI.KEY) { tries++; if (localStorage.getItem(snapKey) != null) throw new Error('QuotaExceededError'); }
      return real.call(localStorage, k, v);
    };
    res = UI.save();
  } finally {
    localStorage.setItem = real;
    localStorage.removeItem(snapKey);
  }
  eq(res, true, 'save() не записал после уборки копии');
  eq(tries, 2, 'запись не повторили после уборки копии');
  ok(!UI.dlgOpen(), 'окно «Не удалось сохранить» показано, хотя место нашлось');
  eq(warn.hidden, true, 'красная полоса, хотя запись прошла');
});

// (17г) архивная категория: шапка и «Аналитика» об одних и тех же деньгах.
// Своя категория с тратой уходит в архив - её факт обязан остаться в разрезе месяца.
add('архивная категория: шапка и аналитика сходятся', function () {
  var S = UI.S, ymStr = UI.curYM();
  var w = S.wallets[0];
  ok(w, 'нет кошелька');
  if (!w) return;
  var wasCats = S.categories.exp.slice();
  var victim = Engine.addCategory(S, 'exp', { name: 'Архив-тест' });
  var tx = null;
  try {
    tx = Engine.addTx(S, { kind: 'exp', amount: 7000, catId: victim.id, walletId: w.id,
      date: ymStr < Engine.ym(Engine.today()) ? ymStr + '-10' : Engine.today() });
    Engine.archiveCategory(S, victim.id, true);   // хозяин убрал категорию в архив
    UI.render();
    var spent = Engine.summary(S, ymStr).spent;
    var rows = Engine.monthBreakdown(S, ymStr, 'exp');
    var sum = 0;
    rows.forEach(function (r) { sum += r.fact; });
    eq(Math.round(sum), spent, 'сумма строк «Аналитики» разошлась с шапкой «Потрачено»');
    var row = null;
    rows.forEach(function (r) { if (r.catId === victim.id) row = r; });
    ok(row && row.fact === 7000, 'факта архивной категории нет в разрезе');
    ok(row && row.archived === true, 'строка не помечена как архивная');
    var tile = document.querySelector('#app .circle[data-id="' + victim.id + '"]');
    ok(tile && tile.classList.contains('retired'), 'плитка архивной категории не приглушена');
  } finally {
    if (tx) Engine.deleteTx(S, tx.id);
    S.categories.exp = wasCats;
    UI.render();
  }
});

// (17) карточка категории: вместо кнопок строка «план · осталось»
// 14.10: плана/лимита нет - статус-строки нет (дубль строки «План/Лимит на месяц: не задан»)
add('карточка: у категории строка плана вместо кнопок', function () {
  var S = UI.S, ymStr = UI.curYM();
  [['exp', 'Лимита на месяц нет', 'Лимит на месяц'], ['inc', 'Плана на месяц нет', 'План на месяц']].forEach(function (k) {
    var c = circle(k[0], 0);
    ok(c, 'нет категории ' + k[0]);
    var id = c.dataset.id, was = Engine.catLimit(S, id, ymStr);
    try {
      Engine.setLimit(S, ymStr, id, 5000);
      UI.openCard({ kind: k[0], id: id });
      ok(document.querySelector('#cardActs .sh-plan'), k[0] + ': при заданном плане нет статус-строки');
      ok(/осталось|перевыполнен|выполнен/.test(document.querySelector('#cardActs .sh-plan').textContent), k[0] + ': статус без «осталось»');
      ok(!document.getElementById('cardBase'), 'у категории не должно быть «Изменить баланс»');
      UI.closeCard();
      Engine.setLimit(S, ymStr, id, null);
      UI.openCard({ kind: k[0], id: id });
      ok(!document.querySelector('#cardActs .sh-plan'), k[0] + ': без плана осталась статус-строка');
      ok(document.getElementById('cardActs').textContent.indexOf(k[1]) < 0, k[0] + ': дубль «' + k[1] + '»');
      ok(new RegExp(k[2] + '\\s*не задан\\s*Задать').test(document.getElementById('cardActs').textContent), k[0] + ': нет строки «' + k[2] + ': не задан [Задать]»');
      UI.closeCard();
    } finally { Engine.setLimit(S, ymStr, id, was); UI.closeCard(); UI.render(); }
  });
});

// (18) меню: состав и порядок плиток. Карточка-статус («хомяк-помощник») убрана,
// плитки идут ровными парами: связь+вид, обновление+кошельки, звук+вибрация,
// подсказки+«О приложении», бэкап+восстановление. Проверка держит этот состав.
add('меню: ровно те плитки и в том порядке', function () {
  var ids = [].map.call(document.querySelectorAll('#menu .menu-list .mi'), function (b) { return b.id; });
  eq(ids.join(','), MENU_ORDER.join(','), 'состав меню');
  eq(document.querySelector('#mCats .mi-t').textContent, 'Настроить категории', 'подпись категорий');
  eq(document.querySelector('#mWallets .mi-t').textContent, 'Настроить кошельки', 'подпись кошельков');
  var titles = [].map.call(document.querySelectorAll('#menu .menu-list .mi .mi-t'), function (t) { return t.textContent; });
  eq(titles.join('|'), MENU_TITLES.join('|'), 'названия плиток');
  eq(ids.length, 8, 'в меню не 8 плиток');
  MENU_GONE.forEach(function (id) { ok(!document.getElementById(id), 'в меню осталась старая плитка ' + id); });
  eq(document.getElementById('mCopyInfo').textContent, 'копия, таблица Excel', 'подпись «Копия данных»');
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
    UI.S.ui.haptics = true; UI.S.ui.sound = true; UI.S.ui.hints = true; UI.renderMenu();
    withSub('mPrefs', function () {
      eq(document.getElementById('dlgTitle').textContent, 'Звук и подсказки', 'заголовок подменю');
      var row = document.getElementById('snHaptic');
      ok(row, 'в подменю нет «Вибрация»');
      ok(row.querySelector('.mi-sw').classList.contains('on'), 'включённая вибрация без «on»');
      eq(row.getAttribute('aria-pressed'), 'true', 'aria-pressed');
      eq(document.getElementById('mPrefsInfo').textContent, 'всё вкл', 'подпись плитки «всё вкл»');
      row.click();
      eq(UI.S.ui.haptics, false, 'тумблер не выключил вибрацию');
      ok(!row.querySelector('.mi-sw').classList.contains('on'), 'выключатель остался включённым');
      eq(row.getAttribute('aria-pressed'), 'false', 'aria-pressed после выключения');
      eq(document.getElementById('mPrefsInfo').textContent, 'вибро выкл', 'подпись плитки после выключения');
      ok(!document.getElementById('dlg').hidden, 'тумблер закрыл подменю');
      ok(UI.overlayFlags().menu, 'подменю закрыло меню');
    });
  } finally { UI.S.ui.haptics = was; UI.save(); UI.renderMenu(); }
});

// (18в3) выключатель звука: та же механика, что у вибрации, и своя настройка
add('меню: выключатель звука отражает настройку', function () {
  var was = UI.S.ui.sound;
  try {
    UI.S.ui.sound = true; UI.S.ui.haptics = true; UI.S.ui.hints = true; UI.renderMenu();
    withSub('mPrefs', function () {
      var row = document.getElementById('snSound');
      ok(row, 'в подменю нет «Звук»');
      ok(row.querySelector('.mi-sw').classList.contains('on'), 'включённый звук без «on»');
      eq(row.getAttribute('aria-pressed'), 'true', 'aria-pressed');
      row.click();
      eq(UI.S.ui.sound, false, 'тумблер не выключил звук');
      ok(!row.querySelector('.mi-sw').classList.contains('on'), 'выключатель остался включённым');
      eq(document.getElementById('mPrefsInfo').textContent, 'звук выкл', 'подпись плитки');
      // вибрация - отдельная настройка, звук её не трогает
      eq(UI.S.ui.haptics !== false, true, 'звук выключил заодно и вибрацию');
      ok(document.getElementById('snHaptic').querySelector('.mi-sw').classList.contains('on'), 'выключатель вибрации погас вместе со звуком');
      row.click();
      eq(UI.S.ui.sound, true, 'второй тап не включил звук');
      eq(document.getElementById('mPrefsInfo').textContent, 'всё вкл', 'подпись не вернулась');
    });
    // все три выключены - «всё выкл»
    UI.S.ui.sound = false; UI.S.ui.haptics = false; UI.S.ui.hints = false; UI.renderMenu();
    eq(document.getElementById('mPrefsInfo').textContent, 'всё выкл', 'подпись при всех выключенных');
    UI.S.ui.hints = true; UI.renderMenu();
    eq(document.getElementById('mPrefsInfo').textContent, 'только подсказки', 'подпись при одном включённом');
    eq(UI.prefsInfo(), 'только подсказки', 'UI.prefsInfo разошлась с плиткой');
  } finally { UI.S.ui.sound = was; UI.S.ui.haptics = true; UI.S.ui.hints = true; UI.save(); UI.renderMenu(); }
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
      UI.S.ui.theme === 'dark' ? 'Тёмная' : 'Светлая', 'название темы');
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
      UI.S.ui.theme === 'dark' ? 'Тёмная' : 'Светлая', 'название новой темы');
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
  ok(items.length === 5, 'в списке не 5 пунктов, а ' + items.length);
  ['кошелёк на категорию расхода - расход', 'источник дохода на кошелёк - доход',
   'кошелёк на кошелёк - перевод', 'кошелёк на долг - платёж по долгу', 'долг на кошелёк - взяли в долг или вам вернули']
    .forEach(function (t, i) { eq(items[i], t, 'пункт ' + (i + 1)); });
  ok(body.textContent.indexOf('Финансовый консультант Алексей Дорохин') >= 0, 'нет строки автора');
  var a = body.querySelector('.ab-contacts .ab-link[data-ext]');
  ok(a && a.tagName === 'A', 'ссылка не ссылка');
  eq(a.getAttribute('href'), 'https://www.dorokhin-finance.ru/', 'адрес ссылки');
  eq(a.textContent, 'dorokhin-finance.ru ↗', 'подпись ссылки');
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

// (19-стор) 1.0.3: стор-сборка спрашивает RuStore App Update SDK (подложенный плагин), в сеть
// не ходит; нашлась версия - точка на плитке и «Обновить», который запускает обновление SDK.
// Нет RuStore - честное окно. Тест-сборку (как здесь) не трогает: переключатель только на проверку.
add('обновление (стор): RuStore App Update SDK вместо своего манифеста', function () {
  var fetched = 0, started = 0, realFetch = window.fetch;
  var K = Update.K_NEWER, KC = Update.K_CHECK, keep = {};
  [K, KC].forEach(function (k) { try { keep[k] = localStorage.getItem(k); localStorage.removeItem(k); } catch (e) {} });
  window.fetch = function () { fetched++; return Promise.reject(new TypeError('Failed to fetch')); };
  Update._store(true);
  // «новее» считаем от текущей версии, а не числом: с 1.0.3 код 20007 - уже своя версия
  var curCode = Update.codeOfVer(window.APP_VERSION), nextCode = curCode + 2, nextVer = Update.verOfCode(nextCode);
  Update._sdk({
    checkUpdate: function () { return Promise.resolve({ ok: true, available: true, versionCode: nextCode, currentVersionCode: curCode }); },
    startUpdate: function () { started++; return Promise.resolve({ ok: true, via: 'sdk' }); }
  });
  function restore() {
    window.fetch = realFetch; Update._store(undefined); Update._sdk(undefined);
    // «Обновить» помечает уход в окно RuStore (AppLock.away) - как будто вернулись из него,
    // иначе следующая проверка замка приняла бы свой фон за «своё окно»
    try { if (window.AppLock && AppLock.onBackground) { AppLock.onBackground(); AppLock.onForeground(); } } catch (e) {}
    [K, KC].forEach(function (k) { try { if (keep[k] === null || keep[k] === undefined) localStorage.removeItem(k); else localStorage.setItem(k, keep[k]); } catch (e) {} });
    UI.closeDlg(); UI.renderMenu();
  }
  return Update.check().then(function (d) {
    eq(d && d.kind, 'store', 'RuStore не нашёл подложенную версию');
    eq(fetched, 0, 'стор-сборка полезла в сеть за своим манифестом');
    var body = document.getElementById('dlgBody').textContent;
    ok(body.indexOf('Версия ' + nextVer + ' ждёт в RuStore') >= 0, 'в окне нет версии из RuStore: ' + body);
    ok(document.getElementById('mUpdate').classList.contains('has-upd'), 'точка «есть обновление» на плитке не встала');
    var upd = document.getElementById('dlgBtns').lastChild;
    eq(upd.textContent, 'Обновить', 'нет кнопки «Обновить»');
    upd.click();
    return new Promise(function (r) { setTimeout(r, 30); });
  }).then(function () {
    eq(started, 1, '«Обновить» не запустил обновление через RuStore');
    Update._sdk({ checkUpdate: function () { return Promise.resolve({ ok: false, reason: 'no-rustore' }); } });
    return Update.check();
  }).then(function (d) {
    eq(d && d.kind, 'error', 'нет RuStore - не ошибка');
    ok(document.getElementById('dlgBody').textContent.indexOf('нет приложения RuStore') >= 0, 'нет честной строки про RuStore');
    eq(fetched, 0, 'после отказа RuStore стор пошёл в сеть');
    restore();
  }, function (e) { restore(); throw e; });
});

// (CSP) 1.0.3: в index.html одна политика; свои файлы читаются (files.json - опись сборки).
// Что чужое закрыто, проверяет tests/csp-store.test.js (здесь проба дала бы нарушение). В стор-сборке connect-src 'none' вшивает build-lib.js shipCsp.
add('CSP: своя политика стоит, свои файлы читаются', function () {
  var metas = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
  eq(metas.length, 1, 'мета-тегов CSP не один');
  var c = metas[0].getAttribute('content');
  ok(/connect-src 'self' https:\/\/www\.dorokhin-finance\.ru/.test(c), 'в CSP превью нет своих файлов и сайта: ' + c);
  ok(/object-src 'none'/.test(c), 'object-src не закрыт');
  return fetch('files.json', { cache: 'no-store' }).then(function (r) {
    ok(r && r.ok, 'files.json не прочитался под CSP');
    return r.json();
  }).then(function (j) {
    ok(j && Array.isArray(j.files) && j.files.length > 5, 'files.json пустой');
  });
});

// (19) «Обновление»: окно «установлена версия» → «Проверить» с подставным сервером.
// Настоящая сеть не трогается — fetch подсовываем свой.
add('обновление: окно с подставным манифестом', function () {
  var manifest = {
    version: '9.9.9',
    apkUrl: 'https://www.dorokhin-finance.ru/homyak/homyak-9.9.9.apk',
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
      version: o.apk, apkUrl: 'https://www.dorokhin-finance.ru/homyak/homyak-' + o.apk + '.apk',
      size: 3120000, notes: 'что нового в сборке',
      web: o.web ? {
        version: o.web, url: 'https://www.dorokhin-finance.ru/homyak/www-' + o.web + '.zip',
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
    version: UI.shellVersion(), apkUrl: 'https://www.dorokhin-finance.ru/homyak/h.apk', size: 1, notes: '',
    web: { version: '9.9.9', url: 'https://www.dorokhin-finance.ru/homyak/www-9.9.9.zip',
           sha256: sha, size: 100, minShell: '0' }
  });
  try {
    eq(Update.decide(m, UI.appVersion(), UI.shellVersion()).kind, 'ota', 'без памяти о провале обновление не предлагается');
    localStorage.setItem(K, JSON.stringify({ version: '9.9.9', count: 1, sha256: sha, shown: true }));
    eq(Update.decide(m, UI.appVersion(), UI.shellVersion(), Update.readFail()).kind, 'skipped',
      'сломавшуюся версию предлагают снова');
    // перевыложили тот же номер другим архивом - можно пробовать
    var m2 = Update.parseManifest({
      version: UI.shellVersion(), apkUrl: 'https://www.dorokhin-finance.ru/homyak/h.apk', size: 1, notes: '',
      web: { version: '9.9.9', url: 'https://www.dorokhin-finance.ru/homyak/www-9.9.9.zip',
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
  eq(el.textContent, UI.fmt(plan) + '\u00a0₽', 'строка плана');
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

// (18д) лист «Куда перевести» (кнопки «Перевести» в карточке нет с 14.10; лист открывает тап
// по напоминанию кредитки) → плитки → экран суммы «A › B»
add('перевод: лист «Куда перевести» доводит до экрана суммы', function () {
  var ws = UI.S.wallets.filter(function (w) { return !w.hidden; });
  ok(ws.length > 1, 'для проверки нужно два кошелька');
  var from = ws[0], to = ws[1];
  UI.openCard({ kind: 'wallet', id: from.id });
  UI.openTransfer(from.id);
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

// Баг 12.10 (телефон, 412 px): «Накоплен… → Наличн…» при свободном месте в шапке. Имена,
// которые влезают без спейсера и лишних полей, показываются целиком; длинные - с многоточием,
// но обе фишки видны в шапке. На телефоне стрелка шире (запасной шрифт) - имитируем.
add('перевод: оба выбранных кошелька в шапке - имена целиком, если помещаются', function () {
  var a = Engine.addWallet(UI.S, { name: 'Накопления', color: 'teal' });
  var b = Engine.addWallet(UI.S, { name: 'Наличные', color: 'teal' });
  var arrow = document.querySelector('.am-path .am-arrow'), pad0 = arrow.style.padding;
  function cut(el) { return el.scrollWidth > el.clientWidth + 1; }
  try {
    UI.render();
    arrow.style.padding = '0 8px';
    UI.openAmount({ kind: 'transfer', walletId: a.id, toWalletId: b.id });
    UI.amFitPath();
    var f = document.querySelector('#amFrom .am-pick'), t = document.querySelector('#amTo .am-pick');
    eq(f.textContent + '|' + t.textContent, 'Накопления|Наличные', 'не те имена');
    ok(!cut(f) && !cut(t), 'имена обрезаны при свободном месте: ' + f.clientWidth + '/' + f.scrollWidth + ', ' + t.clientWidth + '/' + t.scrollWidth);
    // Шрифт телефона шире, чем в Edge: растим шрифт шапки до первого размера, при котором имена
    // режутся при старой раскладке (спейсер 44 px справа, полные поля). Шапка обязана отдать
    // это место именам - иначе «Накоплен… → Наличн…» при пустом месте справа (как на телефоне).
    var pathEl = document.querySelector('.am-path'), head = pathEl.parentNode, F = 0;
    for (var fs = 15; fs <= 30; fs += 0.5) {
      pathEl.style.fontSize = fs + 'px';
      head.classList.remove('am-tight');
      if (cut(f) || cut(t)) { F = fs; break; }
    }
    ok(F > 0, 'не нашли размер шрифта, при котором имена режутся');
    UI.amFitPath();
    ok(!cut(f) && !cut(t), 'шрифт ' + F + 'px: имена режутся, хотя место у спейсера/полей есть: ' +
      f.clientWidth + '/' + f.scrollWidth + ', ' + t.clientWidth + '/' + t.scrollWidth);
    pathEl.style.fontSize = '';
    UI.closeAmount();
    // длинные имена: многоточие допустимо, но обе фишки целиком внутри шапки
    Engine.updateWallet(UI.S, a.id, { name: 'Накопления на отпуск и ремонт квартиры' });
    Engine.updateWallet(UI.S, b.id, { name: 'Наличные в конверте на чёрный день' });
    UI.openAmount({ kind: 'transfer', walletId: a.id, toWalletId: b.id });
    UI.amFitPath();
    var path = document.querySelector('.am-path').getBoundingClientRect();
    [document.querySelector('#amFrom .am-pick'), document.querySelector('#amTo .am-pick')].forEach(function (el) {
      var r = el.getBoundingClientRect();
      ok(r.width >= 40 && r.left >= path.left - 0.5 && r.right <= path.right + 0.5, 'фишка вне шапки: ' + el.textContent);
    });
  } finally {
    arrow.style.padding = pad0;
    document.querySelector('.am-path').style.fontSize = '';
    UI.closeAmount();
    Engine.deleteWallet(UI.S, a.id); Engine.deleteWallet(UI.S, b.id);
    UI.save(); UI.render();
  }
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

// (1.0.2) калькулятор в правке операции: проверяем то, что видно на экране, а не только
// Engine.calcAmount - кнопки-знаки, строку итога, сворачивание по «=» и запись суммы.
add('правка операции: калькулятор + − × ÷ = на экране и в сохранённой сумме', function () {
  var src = UI.S.tx.filter(function (t) { return t.kind === 'exp'; })[0];
  ok(src, 'нет операции-расхода');
  if (!src) return;
  var was = src.amount;
  function $(id) { return document.getElementById(id); }
  function op(k) { var b = $('etOps').querySelector('[data-op="' + k + '"]'); ok(b, 'нет кнопки ' + k); b.click(); }
  function type(s) { var i = $('etAmount'); i.value += s; i.dispatchEvent(new Event('input', { bubbles: true })); }
  UI.editTx(src.id);
  try {
    var inp = $('etAmount');
    ok(inp && $('etOps') && $('etRes'), 'в окне операции нет поля с калькулятором');
    inp.focus(); inp.value = '100';
    try { inp.setSelectionRange(3, 3); } catch (e) {}
    op('+'); type('50'); op('×'); type('2');
    eq(inp.value, '100+50×2', 'знаки встали не на место');
    ok(!$('etRes').hidden, 'строка итога спрятана при выражении');
    eq($('etRes').textContent.replace(/[\s\u00a0 ]/g, ''), '=200₽', 'итог: умножение раньше сложения');
    op('×');                                       // второй знак подряд меняет первый
    eq(inp.value, '100+50×2×', 'знак после числа');
    op('÷');
    eq(inp.value, '100+50×2÷', 'второй знак подряд не заменил первый');
    inp.value = '1000−250'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    op('=');
    eq(Engine.parseNum(inp.value), 750, '«=» не свернул выражение в сумму');
    ok($('etRes').hidden, 'строка итога осталась после «=»');
    inp.value = '5÷0'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    ok(/посчитать/.test($('etRes').textContent), 'деление на ноль не подсвечено');
    inp.value = '1 990+10'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    var save = null;
    [].forEach.call($('dlgBtns').querySelectorAll('button'), function (b) { if (b.textContent.trim() === 'Сохранить') save = b; });
    ok(save, 'нет кнопки «Сохранить»');
    save.click();
    eq(Engine.findTx(UI.S, src.id).amount, 2000, 'сохранилась не посчитанная сумма');
  } finally {
    if (UI.dlgOpen && UI.dlgOpen()) UI.closeDlg();
    Engine.updateTx(UI.S, src.id, { amount: was });
    UI.save(); UI.render();
  }
});

// Лимит категории на текущий месяц: запомнить как было и вернуть (для проверок заливки).
// Раньше эти проверки брали планы с ПК, которых в автономном «Хомяке» нет, и
// молча засчитывались без проверки. Теперь - те же лимиты, что задаёт хозяин.
function limSnap(S, ymStr, catId) {
  var m = S.limits[ymStr];
  return (m && Object.prototype.hasOwnProperty.call(m, catId)) ? m[catId] : null;
}

// (19г) ровно сто процентов - жёлтый, копейка сверх - красный (решение 29.09.2026):
// проверяем не только движок, но и саму плитку на экране
add('заливка: ровно 100 % лимита - жёлтая плитка, сверх лимита - красная', function () {
  var S = UI.S, ymStr = UI.curYM();
  var cat = Engine.listCategories(S, 'exp', { ymStr: ymStr })[0], w = S.wallets[0];
  ok(cat && w, 'нет категории расхода или кошелька');
  if (!cat || !w) return;
  var wasLim = limSnap(S, ymStr, cat.id);
  var fact = Engine.catFact(S, cat.id, ymStr);
  var added = [];
  function ring() { return document.querySelector('#app .circle[data-kind="exp"][data-id="' + cat.id + '"] .ring'); }
  try {
    if (!(fact > 0)) {
      added.push(Engine.addTx(S, { kind: 'exp', amount: 1000, catId: cat.id, walletId: w.id, date: Engine.today() }));
      fact = Engine.catFact(S, cat.id, ymStr);
    }
    // лимит ровно равен факту: 100 % - впритык, жёлтый
    Engine.setLimit(S, ymStr, cat.id, fact);
    UI.render();
    eq(Engine.fill(fact, Engine.catLimit(S, cat.id, ymStr)).level, 'warn', 'движок на 100 %');
    eq(UI.levelOf('exp', 100, 100).lvl, 'warn', 'levelOf на границе');
    ok(ring(), 'плитки категории нет на экране');
    ok(ring().classList.contains('lvl-warn'), 'плитка на 100 % не жёлтая: ' + ring().className);
    ok(!ring().classList.contains('lvl-over'), 'плитка на 100 % красная');

    // лимит на копейку меньше факта - перерасход, красный
    Engine.setLimit(S, ymStr, cat.id, Math.round((fact - 0.01) * 100) / 100);
    UI.render();
    ok(ring().classList.contains('lvl-over'), 'плитка сверх лимита не красная: ' + ring().className);

    eq(Engine.fill(1000.01, 1000).level, 'over', 'копейка сверх');
    eq(Engine.fill(999, 1000).level, 'warn', '0.999');
  } finally {
    Engine.setLimit(S, ymStr, cat.id, wasLim);
    added.forEach(function (t) { Engine.deleteTx(S, t.id); });
    UI.render();
  }
});

// (19д) дата операции не уходит вперёд: ни календарём, ни через движок
add('дата: вперёд не пускают ни календарь, ни движок', function () {
  var t = Engine.today();
  eq(document.getElementById('amDateInput'), null, 'на экране суммы осталось системное поле даты');
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

  // сам экран суммы дату вперёд не отдаёт: своё окно календаря, дни после сегодня неактивны
  UI.openAmount({ kind: 'exp' });
  try {
    document.getElementById('amPick').click();
    var pk = document.getElementById('pk');
    ok(pk && !pk.hidden, 'кнопка календаря не открыла своё окно');
    var dTom = pk.querySelector('[data-pk-day="' + tomorrow + '"]');
    if (dTom) eq(dTom.disabled, true, 'завтра в календаре можно выбрать');
    else eq(pk.querySelector('[data-pk-nav="1"]').disabled, true, 'календарь листается в будущий месяц');
    var dT = pk.querySelector('[data-pk-day="' + t + '"]');
    ok(dT && dT.classList.contains('today') && dT.classList.contains('on'), 'сегодня не отмечено');
    eq(pk.querySelectorAll('.pk-wd')[0].textContent + pk.querySelectorAll('.pk-wd')[6].textContent, 'ПнВс', 'неделя не Пн..Вс');
  } finally { if (window.Picker) Picker.close(); UI.closeAmount(); UI.hideToast(); }
});

// (14.10) свои окна выбора вместо системных Android: каждое поле открывает своё окно и
// пишет выбранное обратно (экран суммы, правка операции, «Дата возврата»; импорт - ниже)
add('свои окна: дата и списки выбираются в окне приложения и пишутся в поле', function () {
  var t = Engine.today(), pk = function () { return document.getElementById('pk'); };
  function open() { return !!pk() && !pk().hidden; }
  var MN = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var prevYm = (function () { var y = +t.slice(0, 4), m = +t.slice(5, 7) - 1; if (m === 0) { y--; m = 12; } return y + '-' + Engine.pad2(m); })();
  // экран суммы: прошлый месяц, 15-е -> подпись 15.ММ
  UI.openAmount({ kind: 'exp' });
  try {
    document.getElementById('amPick').click();
    ok(open(), 'календарь экрана суммы не открылся');
    pk().querySelector('[data-pk-nav="-1"]').click();
    ok(document.getElementById('pkMonth').textContent.indexOf(MN[+prevYm.slice(5) - 1]) === 0, '‹ не перелистнул месяц: ' + document.getElementById('pkMonth').textContent);
    pk().querySelector('[data-pk-day="' + prevYm + '-15"]').click();
    ok(!open(), 'окно не закрылось после выбора дня');
    eq(document.getElementById('amDateVal').textContent, '15.' + prevYm.slice(5), 'выбранная дата не дошла до экрана суммы');
  } finally { if (window.Picker) Picker.close(); UI.closeAmount(); }

  // правка операции: дата, категория, кошелёк; перевод - «куда»
  var S = UI.S, ws = S.wallets.filter(function (w) { return !w.hidden; });
  ok(ws.length >= 2, 'нужно два кошелька');
  var cats = Engine.listCategories(S, 'exp', { ymStr: UI.curYM() });
  ok(cats.length >= 2, 'нужно две категории');
  var tx = Engine.addTx(S, { kind: 'exp', amount: 7, catId: cats[0].id, walletId: ws[0].id, date: t });
  var tr = Engine.addTx(S, { kind: 'transfer', amount: 5, walletId: ws[0].id, toWalletId: ws[1].id, date: t });
  try {
    UI.editTx(tx.id);
    ['etDate', 'etCat', 'etWallet'].forEach(function (id) {
      var el = document.getElementById(id);
      ok(el && el.tagName === 'BUTTON' && el.classList.contains('pk-f'), id + ' - не своё поле выбора');
    });
    var changed = 0;
    document.getElementById('etCat').addEventListener('change', function () { changed++; });
    document.getElementById('etCat').click();
    ok(open(), 'категория: своё окно не открылось');
    ok(!document.getElementById('dlg').hidden && document.getElementById('etAmount'), 'своё окно стёрло форму под собой');
    ok(pk().querySelector('.pk-row.on[data-pk-val="' + cats[0].id + '"]'), 'текущая категория не отмечена');
    pk().querySelector('[data-pk-val="' + cats[1].id + '"]').click();
    eq(document.getElementById('etCat').value, cats[1].id, 'категория не записалась в поле');
    eq(document.getElementById('etCat').textContent, cats[1].name, 'подпись поля не сменилась');
    eq(changed, 1, 'поле не сообщило об изменении');
    document.getElementById('etWallet').click();
    pk().querySelector('[data-pk-val="' + ws[1].id + '"]').click();
    eq(document.getElementById('etWallet').value, ws[1].id, 'кошелёк не записался');
    document.getElementById('etDate').click();
    ok(open(), 'дата операции: своё окно не открылось');
    pk().querySelector('[data-pk-nav="-1"]').click();
    pk().querySelector('[data-pk-day="' + prevYm + '-15"]').click();
    eq(document.getElementById('etDate').value, prevYm + '-15', 'дата не записалась');
    eq(document.getElementById('etDate').textContent, '15.' + prevYm.slice(5) + '.' + prevYm.slice(0, 4), 'подпись даты');
    document.getElementById('dlgBtns').lastChild.click();   // «Сохранить»
    var nt = Engine.findTx(S, tx.id);
    eq(nt.catId + '|' + nt.walletId + '|' + nt.date, cats[1].id + '|' + ws[1].id + '|' + prevYm + '-15', 'правка из своих окон не сохранилась');
    UI.editTx(tr.id);
    var to = document.getElementById('etTo');
    ok(to && to.classList.contains('pk-f'), '«Куда» - не своё поле');
    to.click();
    ok(open(), '«Куда»: своё окно не открылось');
    eq(document.getElementById('pkTitle').textContent, 'Куда', 'заголовок окна «Куда»');
  } finally { if (window.Picker) Picker.close(); UI.closeDlg(); Engine.deleteTx(S, tx.id); Engine.deleteTx(S, tr.id); UI.save(); UI.render(); }

  // «Дата возврата» (мне должны): будущее можно, «Очистить» стирает, сохраняется в долг
  var h0 = UI.hasFullAccess;
  UI.hasFullAccess = function () { return true; };
  try {
    Debts.addDebt('owed');
    var due = document.getElementById('dnDue');
    ok(due && due.classList.contains('pk-f'), '«Дата возврата» - не своё поле');
    eq(due.textContent, 'Не выбрана', 'пустая дата возврата без подсказки');
    due.click();
    ok(open(), 'дата возврата: своё окно не открылось');
    eq(pk().querySelector('[data-pk-nav="1"]').disabled, false, 'дату возврата нельзя в будущем');
    pk().querySelector('[data-pk-nav="1"]').click();
    var nx = pk().querySelector('.pk-d[data-pk-day$="-10"]');
    var nv = nx.getAttribute('data-pk-day');
    eq(nx.disabled, false, 'будущий день неактивен');
    nx.click();
    eq(due.value, nv, 'будущая дата возврата не записалась');
    due.click();
    var clr = pk().querySelector('[data-pk-act="clear"]');
    ok(clr, 'нет «Очистить» у необязательной даты');
    clr.click();
    eq(due.value, '', '«Очистить» не стёр дату');
    eq(due.textContent, 'Не выбрана', 'после «Очистить» нет подсказки');
    due.click();
    pk().querySelector('[data-pk-nav="1"]').click();
    pk().querySelector('.pk-d[data-pk-day$="-10"]').click();
    document.getElementById('dnName').value = 'Саша пикер';
    document.getElementById('dnAmount').value = '1000';
    document.getElementById('dlgBtns').lastChild.click();
    var dd = (UI.S.debts || []).filter(function (x) { return x.name === 'Саша пикер'; })[0];
    ok(dd, 'долг не завёлся');
    eq(dd.due, nv, 'дата возврата из своего окна не сохранилась');
  } finally { UI.hasFullAccess = h0; if (window.Picker) Picker.close(); UI.closeDlg(); dropDebts(); }
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
  var ymStr = UI.curYM();
  var cat = Engine.listCategories(S, 'exp', { ymStr: ymStr })[0];
  ok(cat, 'нет категории расхода');
  if (!w || !cat) return;
  var wasLim = limSnap(S, ymStr, cat.id);
  var heard = [], play0 = window.Sound.play;
  var added = [];
  try {
    window.Sound.play = function (n) { heard.push(n); return true; };
    Engine.setLimit(S, ymStr, cat.id, 100);                        // лимит заведомо мал
    added.push(Engine.addTx(S, { kind: 'exp', amount: 500, catId: cat.id, walletId: w.id, date: Engine.today() }));
    UI.soundTx('exp', cat.id, ymStr);
    added.push(Engine.addTx(S, { kind: 'exp', amount: 500, catId: cat.id, walletId: w.id, date: Engine.today() }));
    UI.soundTx('exp', cat.id, ymStr);                              // второй расход по той же категории
    added.push(Engine.addTx(S, { kind: 'exp', amount: 500, catId: cat.id, walletId: w.id, date: Engine.today() }));
    UI.soundTx('exp', cat.id, ymStr);                              // и третий
    eq(heard.join(','), 'over,over,over', 'перебор звучал не каждый раз');
  } finally {
    window.Sound.play = play0;
    Engine.setLimit(S, ymStr, cat.id, wasLim);
    added.forEach(function (t) { Engine.deleteTx(S, t.id); });
    UI.render();
  }
});

// (20б) меню закрывается смахиванием откуда угодно, а не только с шапки
add('меню: смахивание влево работает с плитки, вертикаль не закрывает', function () {
  var tile = document.getElementById('mPrefs');
  ok(tile, 'нет плитки «Звук и подсказки»');

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

    // 3) клик, прилетевший следом за смахиванием, плитку не нажимает (подменю не открылось)
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    ok(document.getElementById('dlg').hidden, 'смахивание заодно нажало плитку меню');
    pev(document, 'pointerup', p.x - 140, p.y + 4, true);

    // 4) обычный тап по плитке по-прежнему работает: открывает подменю поверх меню
    UI.openMenu();
    pev(tile, 'pointerdown', p.x, p.y, false);
    pev(document, 'pointerup', p.x, p.y, true);
    tile.click();
    ok(!document.getElementById('dlg').hidden, 'тап по плитке перестал открывать подменю');
    eq(document.getElementById('dlgTitle').textContent, 'Звук и подсказки', 'открылось не то подменю');
    ok(UI.overlayFlags().menu, 'подменю закрыло меню');
    UI.closeDlg();
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

// Долив своих категорий расхода на две страницы (с лимитом 1000 на текущий месяц) и
// возврат как было. Раньше долив шёл в планы с ПК, которых в автономном
// «Хомяке» нет, и обе проверки страниц молча засчитывались.
function padCats(S, n, name) {
  var ymStr = UI.curYM();
  var snap = { cats: S.categories.exp.slice(), order: (S.ui.order.exp || []).slice(),
    lim: S.limits[ymStr] ? JSON.parse(JSON.stringify(S.limits[ymStr])) : null, ids: [] };
  for (var i = 1; i <= n; i++) {
    var c = Engine.addCategory(S, 'exp', { name: name + ' ' + i, icon: 'other' });
    Engine.setLimit(S, ymStr, c.id, 1000);
    snap.ids.push(c.id);
  }
  snap.restore = function () {
    S.categories.exp = snap.cats;
    S.ui.order.exp = snap.order;
    if (snap.lim) S.limits[ymStr] = snap.lim; else delete S.limits[ymStr];
    snap.ids.forEach(function (id) { delete S.icons[id]; });
    UI.relayout();
  };
  return snap;
}

// (20е) перестановка на второй странице расходов не кидает на первую
add('страницы: перестановка на второй странице оставляет вторую страницу', function () {
  var S = UI.S, ymStr = UI.curYM();
  var box = document.querySelector('#fieldExp .pages');
  var pad = padCats(S, 12, 'Стр');
  try {
    UI.relayout();
    var pages = document.querySelectorAll('#fieldExp .page').length;
    ok(pages >= 2, 'страниц расходов меньше двух: ' + pages);

    box.scrollLeft = box.clientWidth;
    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'лента не встала на вторую страницу');

    var per = document.querySelectorAll('#fieldExp .page:first-child .circle').length;
    var list = Engine.listCategories(S, 'exp').map(function (c) { return c.id; });
    ok(list.length > per + 1, 'на второй странице меньше двух плиток');
    var a = list[per], b = list[per + 1];
    list[per] = b; list[per + 1] = a;               // меняем местами две плитки ВТОРОЙ страницы
    Engine.reorder(S, 'exp', list);
    UI.render();

    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'после перестановки лента прыгнула на первую страницу');
    var now = Engine.listCategories(S, 'exp', { ymStr: ymStr }).map(function (c) { return c.id; });
    eq(now[per], b, 'порядок не сохранился');
    eq(now[per + 1], a, 'порядок не сохранился');

    // вход и выход из режима правки страницу тоже не теряют
    UI.enterEdit();
    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'вход в правку сбросил страницу');
    UI.exitEdit();
    eq(Math.round(box.scrollLeft / box.clientWidth), 1, 'выход из правки сбросил страницу');
  } finally {
    pad.restore();
  }
});

// (20ж) перестановка едет плавно: соседи сдвигаются, призрак садится в ячейку
add('правка: соседи переезжают плавно, призрак садится в ячейку', function () {
  eq(UI.REORDER_MS, 160, 'длительность переезда соседей');
  eq(UI.SETTLE_MS, 200, 'посадка призрака');

  var a = circle('wallet', 0), b = circle('wallet', 1);
  ok(a && b, 'нужны два кошелька');
  var idA = a.dataset.id, idB = b.dataset.id;
  // Прежняя проверка могла оставить ленту кошельков на второй странице (на экране
  // телефона 5 кошельков + «+» = две страницы): тогда первые две плитки за левым краем
  // (x < 0), жест уходит в пустоту и «сосед переставился без перехода». Возвращаем ленту
  // на первую страницу - изоляция стенда, не приложение (разобрано 01.10.2026).
  var wstrip = document.querySelector('#fieldWallets .strip');
  if (wstrip) wstrip.scrollLeft = 0;

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

// (21в) шеврон поля выбора (своё окно вместо системного списка, 14.10): свой значок,
// отступ справа 38px, стрелка не липнет к краю
add('форма: у поля списка свой шеврон с нормальным отступом', function () {
  var box = document.createElement('div');
  box.innerHTML = Picker.listField({ id: 'stSel', items: [{ value: '1', label: 'раз' }, { value: '2', label: 'два' }], value: '1' });
  document.body.appendChild(box);
  try {
    var el = document.getElementById('stSel');
    eq(el.tagName, 'BUTTON', 'поле списка - не кнопка своего окна');
    var cs = getComputedStyle(el);
    eq(cs.paddingRight, '38px', 'отступ справа под шеврон не 38px');
    ok(/data:image\/svg/.test(cs.backgroundImage), 'своего шеврона-картинки нет');
    ok(/(right|100%)/.test(cs.backgroundPositionX) || cs.backgroundPosition.indexOf('14px') >= 0 || cs.backgroundPosition.indexOf('100%') >= 0,
      'шеврон не у правого края: ' + cs.backgroundPosition);
    eq(cs.textAlign, 'left', 'подпись поля не слева');
  } finally { document.body.removeChild(box); }
});

// (21г) перенос операции: призрак position:fixed и попадание в цель на ДРУГОЙ странице.
// Долив категорий делаем на две страницы, поднимаем кошелёк, у края поле листается само,
// и цель на 2-й странице ловится elementFromPoint.
add('перенос: призрак fixed и цель на другой странице расходов', function () {
  var S = UI.S;
  var box = document.querySelector('#fieldExp .pages');
  var pad = padCats(S, 12, 'Пер');
  UI.relayout();
  var pages = document.querySelectorAll('#fieldExp .page').length;
  if (pages < 2) pad.restore();
  ok(pages >= 2, 'страниц расходов меньше двух: ' + pages);

  var wal = circle('wallet', 0);
  // панель прячем на всё время жеста руками: withoutPanel вернул бы её сразу, а её
  // угол внизу-справа наезжает на 2-ю страницу расходов и перехватывал бы elementFromPoint
  var pvis = panel ? panel.style.visibility : null;
  if (panel) panel.style.visibility = 'hidden';
  function done() { if (panel) panel.style.visibility = pvis; box.scrollLeft = 0; pad.restore(); }
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

// (22б) поле даты: свой шеврон, как у полей списка «Откуда/Куда»
add('форма: у поля даты свой шеврон, как у полей списка', function () {
  var box = document.createElement('div');
  box.innerHTML = Picker.dateField({ id: 'stDate', value: Engine.today() });
  document.body.appendChild(box);
  try {
    var el = document.getElementById('stDate');
    eq(el.tagName, 'BUTTON', 'поле даты - не кнопка своего окна');
    var cs = getComputedStyle(el);
    eq(cs.paddingRight, '38px', 'отступ справа под шеврон не 38px');
    ok(/data:image\/svg/.test(cs.backgroundImage), 'своего шеврона-картинки у даты нет');
    ok(/(right|100%|14px)/.test(cs.backgroundPositionX + ' ' + cs.backgroundPosition),
      'шеврон даты не у правого края: ' + cs.backgroundPosition);
    eq(el.textContent, Engine.today().slice(8, 10) + '.' + Engine.today().slice(5, 7) + '.' + Engine.today().slice(0, 4), 'подпись даты не ДД.ММ.ГГГГ');
  } finally { document.body.removeChild(box); }
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
      // нарезка не поехала: страницы по-прежнему 4 + 2. Считаем только кошельки
      // (.wcard[data-id]): плитка «+ кошелёк» тоже .wcard и стоит в конце второй страницы -
      // из-за неё проверка ждала 2, а видела 3 (стенд, не приложение; разобрано 01.10.2026)
      var wp = document.querySelectorAll('#fieldWallets .wpage');
      eq(wp[0].querySelectorAll('.wcard[data-id]').length, 4, 'первая страница расползлась во время переноса');
      eq(wp[1].querySelectorAll('.wcard[data-id]').length, 2, 'вторая страница расползлась во время переноса');
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
      eq(wp[0].querySelectorAll('.wcard[data-id]').length, 4, 'после перестановки на первой странице не четыре');
      eq(wp[1].querySelectorAll('.wcard[data-id]').length, 2, 'после перестановки на второй странице не два');
      var ids = [].map.call(document.querySelectorAll('#fieldWallets .wcard[data-id]'), function (c) { return c.dataset.id; });
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

// Баг 12.10 (телефон): лента листалась, только если палец в узкой полоске у рамки ленты;
// упёртый в самый край экрана палец (уже за рамкой) ничего не листал. Зона - 10% ширины
// экрана с каждой стороны. Проверяем настоящим переносом: самый правый пиксель экрана и
// точка в 9% от края листают вперёд, самый левый - назад, 20% от края - не листает.
add('кошельки: перенос - лента листается у самого края экрана (зона 10% ширины с обеих сторон)', function () {
  return withSixWallets(function () {
    var strip = document.querySelector('#fieldWallets .strip');
    var pw = strip.clientWidth, vw = window.innerWidth;
    if (UI.S.ui.incomeCollapsed) { UI.S.ui.incomeCollapsed = false; UI.render(); }
    strip.scrollLeft = 0;
    var inc = circle('inc', 0);
    ok(inc && inc.getBoundingClientRect().width > 0, 'нужен видимый доход на экране');
    var pvis = panel ? panel.style.visibility : null;
    if (panel) panel.style.visibility = 'hidden';
    function done() { if (panel) panel.style.visibility = pvis; strip.scrollLeft = 0; }
    var r = null, y = 0, n = 0;
    function hold(x, until, ms) {
      n = 0;
      return waitFor(until, ms, function () { pev(document, 'pointermove', x - (n++ % 2), y, false, 'mouse'); });
    }
    var a = center(inc);
    pev(inc, 'pointerdown', a.x, a.y, false, 'mouse');
    pev(document, 'pointermove', a.x, a.y + 4, false, 'mouse');
    return sleep(Engine.PRESS_PICKUP + 60).then(function () {
      r = strip.getBoundingClientRect(); y = r.top + r.height / 2;
      pev(document, 'pointermove', r.left + r.width / 2, y, false, 'mouse');
      ok(document.querySelector('.dragghost'), 'перенос не начался: призрака под пальцем нет');
      // самый правый пиксель экрана
      return hold(vw - 1, function () { return Math.round(strip.scrollLeft) >= pw - 2; }, 2500);
    }).then(function () {
      ok(Math.abs(strip.scrollLeft - pw) <= 1.5, 'палец у самого правого края экрана не перелистнул ленту: ' + Math.round(strip.scrollLeft));
      // самый левый пиксель экрана - назад
      return hold(1, function () { return strip.scrollLeft <= 2; }, 2500);
    }).then(function () {
      ok(strip.scrollLeft <= 2, 'палец у самого левого края экрана не вернул ленту: ' + Math.round(strip.scrollLeft));
      // 9% ширины от правого края (за пределами старых 24 px от рамки) - тоже край
      return hold(Math.round(vw * 0.91), function () { return Math.round(strip.scrollLeft) >= pw - 2; }, 2500);
    }).then(function () {
      ok(Math.abs(strip.scrollLeft - pw) <= 1.5, 'в 9% от правого края лента не листается: ' + Math.round(strip.scrollLeft));
      // 20% от края - не край: держим дольше D_EDGE_HOLD, страница стоит
      var x = Math.round(vw * 0.2), t0 = Date.now();
      return hold(x, function () { return Date.now() - t0 > 900; }, 2000);
    }).then(function () {
      ok(Math.abs(strip.scrollLeft - pw) <= 1.5, 'в 20% от края лента перелистнулась: ' + Math.round(strip.scrollLeft));
      pev(document, 'pointercancel', 0, 0, true, 'mouse');
      return sleep(60);
    }).then(function () { done(); }, function (e) {
      pev(document, 'pointercancel', 0, 0, true, 'mouse');
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
      eq(d.querySelector('.fd-bal').textContent, 'остаток на конец дня ' + UI.fmt(g.balanceEnd) + '\u00a0₽', 'остаток дня ' + g.date);
      eq(d.querySelector('.fd-ch').textContent,
        'изменение ' + (g.change > 0 ? '+' : '') + UI.fmt(g.change) + '\u00a0₽', 'изменение дня ' + g.date);
      ok(g.change >= 0 || d.querySelector('.fd-ch').classList.contains('neg'), 'минус не покрашен красным');
      ok(g.change <= 0 || d.querySelector('.fd-ch').classList.contains('pos'), 'плюс не покрашен зелёным');
    }
    // строка: кошелёк сверху, категория снизу, знак и цвет по виду операции.
    // Берём первую строку дохода/расхода: у перевода внизу маршрут «Карта → Накопления»,
    // а не категория. Раньше брали просто первую строку, и 1-го числа (все операции демо
    // в одном дне, порядок по ts в пределах миллисекунды) проверка то падала, то нет.
    var row = [].filter.call(document.querySelectorAll('#smBody .txrow'), function (r) {
      var t = Engine.findTx(S, r.dataset.id); return t && t.kind !== 'transfer';
    })[0];
    ok(row, 'в ленте нет строки дохода или расхода');
    var t0 = Engine.findTx(S, row.dataset.id);
    ok(row.querySelector('.fd-w') && row.querySelector('.fd-n'), 'в строке нет кошелька над категорией');
    eq(row.querySelector('.fd-n').textContent, UI.catName(t0.catId), 'категория в строке');
    eq(row.querySelector('.fd-w').textContent, UI.walletName(t0.walletId), 'кошелёк в строке');
    var amt = row.querySelector('.txa');
    eq(amt.textContent, (t0.kind === 'inc' ? '+' : '−') + UI.money(t0.amount) + '\u00a0₽', 'сумма в строке');
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
    // 1.0.4: за «Динамикой» - «Капитал и обязательства» (одна карточка, видна при долгах)
    eq(ids.join(','), 'smGoSummary,smGoFeed,smGoHeat,smGoAttn,smGoDyn,smGoDebt', 'порядок карточек чузера');
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

// (24б-3) 1.0.3: «Копия данных» - подменю: сохранить, восстановить, напоминание. Кнопки
// зовут те же Backup.backup / Backup.pickRestore, что раньше стояли на плитках.
add('меню: «Копия данных» - сохранить, восстановить, тумблер напоминания', function () {
  var s = document.querySelector('#mCopy .mi-s');
  ok(s, 'нет плитки «Копия данных»');
  eq(s.textContent, 'копия, таблица Excel', 'подпись «Копия данных» не та');
  var b0 = Backup.backup, r0 = Backup.pickRestore, calls = [];
  Backup.backup = function () { calls.push('save'); };
  Backup.pickRestore = function () { calls.push('restore'); };
  try {
    ok(typeof r0 === 'function', 'нет Backup.pickRestore');
    withSub('mCopy', function () {
      eq(document.getElementById('dlgTitle').textContent, 'Копия данных', 'заголовок подменю');
      eq(document.getElementById('cpSave').textContent, 'Сохранить копию в файл', 'кнопка сохранения');
      eq(document.getElementById('cpRestore').textContent, 'Восстановить из файла', 'кнопка восстановления');
      ok(document.getElementById('cpRemind'), 'нет тумблера «Напоминать раз в месяц»');
      ok(/Напоминать раз в месяц/.test(document.getElementById('cpRemind').textContent), 'подпись тумблера');
      document.getElementById('cpSave').click();
      eq(calls.join(','), 'save', '«Сохранить копию в файл» не позвал backup()');
      ok(document.getElementById('dlg').hidden && !UI.overlayFlags().menu, 'перед сохранением окно и меню не закрылись');
    });
    withSub('mCopy', function () {
      document.getElementById('cpRestore').click();
      eq(calls.join(','), 'save,restore', '«Восстановить из файла» не позвал pickRestore()');
    });
  } finally { Backup.backup = b0; Backup.pickRestore = r0; }
});

// (24б-4) 1.0.4: «Выгрузить в Excel» - только «Полный доступ». В free строка с замком ведёт
// в баннер покупки (тем же UI.paywall, что у других платных функций), выгрузка не зовётся.
// 11.10: выгрузка и загрузка - одна строка «Таблица Excel» (решение Алексея), не две.
add('Копия данных: «Таблица Excel» в бесплатной версии - замок и баннер покупки', function () {
  var h0 = UI.hasFullAccess, p0 = UI.paywall, x0 = Backup.exportXlsx, pw = [], ex = 0;
  UI.hasFullAccess = function () { return false; };
  UI.paywall = function (back) { pw.push(back); };
  Backup.exportXlsx = function () { ex++; };
  try {
    withSub('mCopy', function () {
      var row = document.getElementById('cpTable');
      ok(row, 'нет строки «Таблица Excel»');
      ok(/Таблица Excel/.test(row.textContent) && /выгрузить или загрузить/.test(row.textContent), 'подпись строки: ' + row.textContent);
      ok(row.classList.contains('locked') && row.querySelector('.set-lock'), 'в бесплатной версии нет замка');
      row.click();
      eq(pw.length, 1, 'тап по строке с замком не открыл баннер покупки');
      eq(pw[0], UI.openCopy, 'из баннера нет возврата в «Копию данных»');
      eq(ex, 0, 'в бесплатной версии выгрузка всё равно пошла');
      ok(!/Таблица Excel/.test(document.getElementById('dlgTitle').textContent), 'в бесплатной версии открылось окно таблицы');
    });
    UI.openTable();
    eq(pw.length, 2, 'UI.openTable в бесплатной версии не ушёл в баннер покупки');
  } finally { UI.hasFullAccess = h0; UI.paywall = p0; Backup.exportXlsx = x0; UI.closeDlg(); UI.closeMenu(); }
});

// 11.10: «Копия данных» - две кнопки и две строки (таблица, напоминание), без старых
// отдельных строк выгрузки/загрузки/отмены; окно «Таблица Excel»: «Закрыть», «назад» и фон
// возвращают в «Копию данных».
add('Копия данных: одна строка «Таблица Excel», её окно возвращает в «Копию данных»', function () {
  var h0 = UI.hasFullAccess;
  UI.hasFullAccess = function () { return true; };
  function title() { return document.getElementById('dlgTitle').textContent; }
  try {
    withSub('mCopy', function () {
      var ids = Array.prototype.map.call(document.querySelectorAll('#dlgBody .set-row'), function (b) { return b.id; });
      eq(ids.join(','), 'cpTable,cpRemind', 'строки «Копии данных»');
      ['cpExcel', 'cpImport', 'cpUndoImport', 'tbExport', 'tbImport'].forEach(function (id) { ok(!document.getElementById(id), 'в «Копии данных» осталась строка #' + id); });
      ok(!document.getElementById('cpTable').classList.contains('locked'), 'в полном доступе замок');
      document.getElementById('cpTable').click();
      eq(title(), 'Таблица Excel', 'окно таблицы не открылось');
      ok(document.getElementById('tbExport') && /Выгрузить в Excel/.test(document.getElementById('tbExport').textContent) && /отправить файл \.xlsx/.test(document.getElementById('tbExport').textContent), 'нет строки выгрузки');
      ok(document.getElementById('tbImport') && /Загрузить из таблицы/.test(document.getElementById('tbImport').textContent) && /CSV или Excel из другого приложения/.test(document.getElementById('tbImport').textContent), 'нет строки загрузки');
      ok(/Выгрузите операции/.test(document.querySelector('#dlgBody .set-p').textContent), 'нет строки-пояснения');
      eq(document.getElementById('dlgBtns').textContent, 'Закрыть', 'кнопки окна таблицы');
      ok(UI.overlayFlags().menu, 'окно таблицы закрыло меню');
      document.getElementById('dlgBtns').firstChild.click();       // «Закрыть»
      eq(title(), 'Копия данных', '«Закрыть» не вернул в «Копию данных»');
      ok(UI.dlgOpen(), '«Закрыть» закрыл всё');
      document.getElementById('cpTable').click();
      UI.closeTop();                                               // «назад»
      eq(title(), 'Копия данных', '«назад» не вернул в «Копию данных»');
      ok(UI.dlgOpen() && UI.overlayFlags().menu, '«назад» закрыл подменю или меню');
      document.getElementById('cpTable').click();
      UI.closeDlg();                                               // тап по фону = closeDlg
      eq(title(), 'Копия данных', 'фон не вернул в «Копию данных»');
    });
  } finally { UI.hasFullAccess = h0; }
});

// (24б-5) 1.0.4: в полном доступе тап собирает .xlsx и отдаёт его в окно «Отправить»
// (плагин ShareFile подменён заглушкой): имя Хомяк-операции-ГГГГ-ММ-ДД.xlsx, MIME таблицы,
// в base64 настоящий zip; перед окном - AppLock.away(), после ответа - release().
// Отказ плагина - окно в гамме приложения, не нативный alert.
add('Таблица Excel: «Выгрузить в Excel» в полном доступе - файл уходит в «Отправить»', function () {
  var h0 = UI.hasFullAccess, n0 = window.isNativeApp, np0 = window.NativePlugins, a0 = AppLock.away;
  var calls = [], aways = 0, released = 0, fail = null;
  UI.hasFullAccess = function () { return true; };
  window.isNativeApp = function () { return true; };
  window.NativePlugins = { ShareFile: { share: function (o) {
    calls.push(o);
    return fail ? Promise.reject(fail) : Promise.resolve({ ok: true });
  } } };
  AppLock.away = function (ms) { aways++; return function () { released++; }; };
  function restore() { UI.hasFullAccess = h0; window.isNativeApp = n0; window.NativePlugins = np0; AppLock.away = a0; }
  function waitCalls(n) {
    var t0 = Date.now();
    return (function loop() {
      if (calls.length >= n && released >= n) return sleep(20);
      if (Date.now() - t0 > 4000) return Promise.reject(new Error('окно «Отправить» не позвали'));
      return sleep(30).then(loop);
    })();
  }
  try {
    withSub('mCopy', function () {
      document.getElementById('cpTable').click();
      var row = document.getElementById('tbExport');
      ok(row && !row.classList.contains('locked') && !row.querySelector('.set-lock'), 'в полном доступе остался замок');
      row.click();
      ok(document.getElementById('dlg').hidden && !UI.overlayFlags().menu, 'перед отправкой окно и меню не закрылись (или вернулась «Копия данных»)');
    });
  } catch (e) { restore(); throw e; }
  return waitCalls(1).then(function () {
    var o = calls[0];
    eq(o.name, Xlsx.fileName(), 'имя файла');
    ok(/^Хомяк-операции-\d{4}-\d{2}-\d{2}\.xlsx$/.test(o.name), 'имя файла не по образцу: ' + o.name);
    eq(o.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'MIME');
    var head = atob(o.base64.slice(0, 8));
    eq(head.slice(0, 2), 'PK', 'в файле не zip');
    ok(o.base64.length > 1000, 'файл подозрительно мал: ' + o.base64.length);
    eq(aways, 1, 'перед окном «Отправить» не позвали AppLock.away()');
    eq(released, 1, 'после ответа не сняли отметку away');
    // отказ плагина - своё окно с понятным текстом
    fail = { code: 'NO_SHARE' };
    Backup.exportXlsx();
    return waitCalls(2);
  }).then(function () {
    return sleep(30);
  }).then(function () {
    ok(UI.dlgOpen(), 'на отказ отправки не показали окно');
    eq(document.getElementById('dlgTitle').textContent, 'Выгрузка в Excel', 'заголовок окна ошибки');
    ok(/окна «Отправить»/.test(document.getElementById('dlgBody').textContent), 'текст ошибки: ' + document.getElementById('dlgBody').textContent);
    UI.closeDlg();
    restore();
  }, function (e) { restore(); throw e; });
});

// (24б-6) 1.0.4: в выгрузке четыре листа - «Операции», «По категориям», «Кошельки»,
// «Итоги по месяцам»; на текущих данных приложения «Всего расходов/доходов» по месяцам =
// сводке (до рубля), остаток кошелька на сегодня = его балансу, «Всего» = «В кошельках».
add('Выгрузка в Excel: «По категориям» и «Кошельки» сходятся со сводкой и балансами', function () {
  var p = Xlsx.parts(UI.S, Engine);
  var names = []; p.files['xl/workbook.xml'].replace(/<sheet name="([^"]+)"/g, function (m, n) { names.push(n); return m; });
  eq(names.join('|'), 'Операции|По категориям|Кошельки|Итоги по месяцам', 'порядок листов');
  var wd = p.data.wallets, now = wd.yms[wd.yms.length - 1];
  eq(now, wd.nowYM, 'последний месяц листа «Кошельки» - не текущий');
  wd.list.forEach(function (w) { eq(w.m[now] || 0, Engine.walletBalance(UI.S, w.id), w.name + ': остаток ≠ балансу'); });
  eq(wd.total[now], Engine.walletsTotal(UI.S), '«Всего» ≠ «В кошельках»');
  eq(document.querySelector('#sumBalance .sv').textContent, Engine.fmt(Math.round(wd.total[now])), '«Всего» листа ≠ «В кошельках» на экране');
  ok(p.files['xl/worksheets/sheet2.xml'].indexOf('xSplit="1" ySplit="1"') > 0, 'на листе статей не закреплены шапка и колонка');
  p.data.months.forEach(function (m) {
    var sm = Engine.summary(UI.S, m.ym), e = 0, n = 0;
    p.data.cats.exp.forEach(function (c) { e += c.m[m.ym] || 0; });
    p.data.cats.inc.forEach(function (c) { n += c.m[m.ym] || 0; });
    eq(Math.round(e), sm.spent, m.ym + ': расходы по статьям ≠ сводке');
    eq(Math.round(n), sm.earned, m.ym + ': доходы по статьям ≠ сводке');
    eq(Math.round(e * 100) / 100, m.exp, m.ym + ': расходы по статьям ≠ «Итогам по месяцам»');
    eq(Math.round(n * 100) / 100, m.inc, m.ym + ': доходы по статьям ≠ «Итогам по месяцам»');
  });
  ok(p.data.months.length > 0, 'на данных self-test нет ни одного месяца - проверять нечего');
});

// (24б-7) 1.0.4: «Загрузить из таблицы» - только «Полный доступ». В free строка с замком
// ведёт в баннер покупки, выбор файла не открывается.
add('Таблица Excel: «Загрузить из таблицы» в бесплатной версии - замок и баннер покупки', function () {
  var h0 = UI.hasFullAccess, p0 = UI.paywall, pw = [], fi = document.getElementById('fileImport'), clicks = 0;
  UI.hasFullAccess = function () { return false; };
  UI.paywall = function (back) { pw.push(back); };
  fi.click = function () { clicks++; };
  try {
    withSub('mCopy', function () {
      var row = document.getElementById('cpTable');
      ok(row && row.classList.contains('locked') && row.querySelector('.set-lock'), 'в бесплатной версии нет замка у «Таблицы Excel»');
      row.click();
      eq(pw.length, 1, 'тап по строке с замком не открыл баннер покупки');
      eq(clicks, 0, 'в бесплатной версии открылся выбор файла');
    });
    ImportUI.pick();
    eq(clicks, 0, 'ImportUI.pick в бесплатной версии открыл выбор файла');
  } finally { UI.hasFullAccess = h0; UI.paywall = p0; delete fi.click; UI.closeDlg(); }
});

function ruDay(shift) {
  var d = new Date(); d.setDate(d.getDate() + shift);
  return (d.getDate() < 10 ? '0' : '') + d.getDate() + '.' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '.' + d.getFullYear();
}
function sp(s) { return String(s).replace(/\s+/g, ' '); }
function dlgText() { return document.getElementById('dlgBody').textContent.replace(/\s+/g, ' '); }
function stateCore() {
  return JSON.stringify({ tx: UI.S.tx, w: UI.S.wallets, c: UI.S.categories, i: UI.S.imports || [], l: UI.S.limits });
}

// (24б-8) 1.0.4: полный доступ - строка открывает выбор файла (подменён), файл в формате
// «Хомяка» → новые названия → предпросмотр (числа на экране = файлу) → запись → балансы
// (операция раньше точки отсчёта кошелька его не двигает) → «Отменить последний импорт»
// возвращает данные ровно как были.
add('Загрузка из таблицы: выбор файла, предпросмотр, запись и отмена последнего импорта', function () {
  var h0 = UI.hasFullAccess, a0 = AppLock.away, fi = document.getElementById('fileImport'), clicks = 0, aways = 0;
  UI.hasFullAccess = function () { return true; };
  fi.click = function () { clicks++; };
  // окно выбора файла уводит приложение в фон - это не уход хозяина (как у восстановления)
  AppLock.away = function () { aways++; return function () {}; };
  function restore() { UI.hasFullAccess = h0; AppLock.away = a0; delete fi.click; }
  var before = stateCore();
  var card = UI.S.wallets.filter(function (w) { return w.name === 'Карта'; })[0];
  ok(card, 'в демо нет кошелька «Карта»');
  var bal0 = Engine.walletBalance(UI.S, card.id), td = ruDay(0), old = ruDay(-40);
  var csv = Xlsx.HEAD_OPS.join(';') + '\n' +
    td + ';Расход;1 234,50;Еда;Карта;;\n' +
    td + ';Доход;10 000;Зарплата;Карта;;\n' +
    old + ';Расход;700;Новая статья;Карта;;\n' +
    old + ';Корректировка;5 000;;Карта;;Остаток\n' +
    td + ';Перевод;300;;Карта;Новый кошелёк;\n';
  try {
    withSub('mCopy', function () {
      document.getElementById('cpTable').click();
      var row = document.getElementById('tbImport');
      ok(row && !row.classList.contains('locked'), 'в полном доступе остался замок');
      row.click();
      eq(clicks, 1, 'тап не открыл выбор файла');
      eq(aways, 1, 'перед выбором файла не позвали AppLock.away()');
      ok(document.getElementById('dlg').hidden && !UI.overlayFlags().menu, 'перед выбором файла окно и меню не закрылись');
    });
  } catch (e) { restore(); throw e; }
  var cnt = { plan: 0 }, plan0 = Import.plan, apply0 = Import.apply, snapAt = null;
  Import.plan = function () { cnt.plan++; return plan0.apply(this, arguments); };
  // копия данных лежит в хранилище на время записи (смотрим в момент Import.apply)
  Import.apply = function () { snapAt = localStorage.getItem(ImportUI.SNAP_KEY); return apply0.apply(this, arguments); };
  var restore0 = restore;
  restore = function () { Import.plan = plan0; Import.apply = apply0; restore0(); };
  return ImportUI.fromBytes(new TextEncoder().encode(csv), 'тест.csv').then(function () {
    eq(document.getElementById('dlgTitle').textContent, 'Новые категории и кошельки', 'нет экрана новых названий');
    eq(document.querySelectorAll('#dlgBody .pk-f[data-key]').length, 2, 'новых названий не два');
    ok(/Новая статья/.test(dlgText()) && /Новый кошелёк/.test(dlgText()), 'названия: ' + dlgText());
    document.getElementById('dlgBtns').lastChild.click();
    return sleep(60);
  }).then(function () {
    eq(document.getElementById('dlgTitle').textContent, 'Проверьте перед загрузкой', 'нет предпросмотра');
    var t = dlgText();
    ok(t.indexOf('Добавится 4 операции') >= 0, 'число операций: ' + t);
    ok(t.indexOf('Формат распознан: выгрузка «Хомяка».') >= 0, 'строка формата: ' + t);
    ok(!/CoinKeeper|Дзен|ZenMoney|Zenmoney/.test(t), 'название чужого приложения на экране: ' + t);
    ok(t.indexOf('Расходы: 2') >= 0 && t.indexOf(sp(Engine.fmt(1934.5) + ' ₽')) >= 0, 'расходы на экране: ' + t);
    ok(t.indexOf('Доходы: 1') >= 0 && t.indexOf(sp(Engine.fmt(10000) + ' ₽')) >= 0, 'доходы на экране: ' + t);
    ok(t.indexOf('Переводы: 1') >= 0, 'переводы на экране: ' + t);
    ok(/1 операция - с датой раньше/.test(t), 'нет пояснения про точку отсчёта: ' + t);
    ok(/корректировка баланса/.test(t), 'нет причины пропуска корректировки: ' + t);
    ok(t.indexOf('—') < 0, 'длинное тире в тексте');
    document.getElementById('dlgBtns').lastChild.click();   // «Загрузить»
    return sleep(80);
  }).then(function () {
    var b = Import.lastBatch(UI.S);
    ok(b && b.count === 4, 'партия не записалась: ' + JSON.stringify(b));
    eq(Engine.walletBalance(UI.S, card.id), Math.round((bal0 - 1234.5 + 10000 - 300) * 100) / 100, 'баланс «Карты» (старая трата не должна двигать)');
    var nw = UI.S.wallets.filter(function (w) { return w.name === 'Новый кошелёк'; })[0];
    ok(nw && Engine.walletBalance(UI.S, nw.id) === 300, 'новый кошелёк: баланс не 300');
    eq(document.querySelector('#sumBalance .sv').textContent, Engine.fmt(Math.round(Engine.walletsTotal(UI.S))), '«В кошельках» на экране не обновилось');
    var saved = JSON.parse(localStorage.getItem(UI.KEY) || 'null');
    ok(saved && saved.tx.length === UI.S.tx.length && saved.imports.length === UI.S.imports.length, 'загрузка не сохранилась в хранилище');
    // Р16 ревью 15.10: копия перед загрузкой живёт только на время записи
    ok(snapAt && JSON.parse(snapAt).tx.length === JSON.parse(before).tx.length, 'нет копии данных перед загрузкой на время записи');
    eq(localStorage.getItem(ImportUI.SNAP_KEY), null, 'копия данных перед загрузкой не убрана после удачной записи');
    eq(ImportUI.state(), null, 'после записи загрузка не забыта');
    eq(cnt.plan, 1, 'план загрузки посчитан ' + cnt.plan + ' раз (экран названий и предпросмотр - один план)');
    ok(/Загружено: 4/.test(document.getElementById('toastText').textContent), 'тост: ' + document.getElementById('toastText').textContent);
    // повтор того же файла - ничего не добавится
    return ImportUI.fromBytes(new TextEncoder().encode(csv), 'тест.csv');
  }).then(function () {
    var t = dlgText();
    ok(/Добавлять нечего/.test(t) && /уже есть в «Хомяке»/.test(t), 'повторная загрузка: ' + t);
    UI.closeDlg();
    eq(ImportUI.state(), null, '«Понятно»: загрузка не забыта');
    UI.openMenu(); document.getElementById('mCopy').click();
    ok(!document.getElementById('cpUndoImport') && !document.getElementById('tbUndoImport'), 'отмена импорта осталась в «Копии данных»');
    document.getElementById('cpTable').click();
    var un = document.getElementById('tbUndoImport');
    ok(un && /4 операции из «тест\.csv»/.test(un.textContent), 'строка отмены: ' + (un && un.textContent));
    un.click();
    eq(document.getElementById('dlgTitle').textContent, 'Отменить последнюю загрузку?', 'нет подтверждения отмены');
    document.getElementById('dlgBtns').lastChild.click();   // «Убрать»
    UI.closeMenu();
    eq(stateCore(), before, 'после отмены данные не как были');
    ok(!Import.lastBatch(UI.S), 'отменять ещё есть что');
    restore();
  }, function (e) { restore(); UI.closeDlg(); UI.closeMenu(); throw e; });
});

// (24б-8а) 11.10: отмена последнего импорта - защита данных, не платная функция. В бесплатной
// версии после импорта «Таблица Excel» без замка открывает окно: замки на «Выгрузить» и
// «Загрузить» (ведут в баннер, «Позже» - обратно в окно), «Отменить последний импорт» работает.
// Окна импорта: кнопки закреплены внизу (dlg-sticky), в остальных окнах - нет.
add('Таблица Excel: в бесплатной версии отмена последнего импорта доступна', function () {
  var h0 = UI.hasFullAccess, p0 = UI.paywall, pw = [], before = stateCore(), fi = document.getElementById('fileImport'), clicks = 0;
  UI.hasFullAccess = function () { return true; };
  fi.click = function () { clicks++; };
  function restore() { UI.hasFullAccess = h0; UI.paywall = p0; delete fi.click; for (var i = 0; i < 4 && UI.dlgOpen(); i++) UI.closeDlg(); UI.closeMenu(); }
  var csv = Xlsx.HEAD_OPS.join(';') + '\n' + ruDay(0) + ';Расход;321;Еда;Карта;;\n' + ruDay(-1) + ';Расход;123;Еда;Карта;;\n';
  return ImportUI.fromBytes(new TextEncoder().encode(csv), 'free.csv').then(function () {
    eq(document.getElementById('dlgTitle').textContent, 'Проверьте перед загрузкой', 'нет предпросмотра');
    ok(document.getElementById('dlg').classList.contains('dlg-sticky'), 'в предпросмотре кнопки не закреплены внизу');
    ok(getComputedStyle(document.getElementById('dlgBtns')).position === 'sticky', 'ряд кнопок предпросмотра не sticky');
    document.getElementById('dlgBtns').lastChild.click();   // «Загрузить»
    return sleep(80);
  }).then(function () {
    ok(Import.lastBatch(UI.S), 'импорт не записался');
    UI.hasFullAccess = function () { return false; };
    UI.paywall = function (back) { pw.push(back); };
    UI.openMenu(); document.getElementById('mCopy').click();
    ok(!document.getElementById('dlg').classList.contains('dlg-sticky'), '«Копия данных» с закреплёнными кнопками');
    var row = document.getElementById('cpTable');
    ok(row && !row.classList.contains('locked') && !row.querySelector('.set-lock'), 'есть что отменять, а у «Таблицы Excel» замок');
    row.click();
    eq(pw.length, 0, 'при непустой отмене ушли в баннер покупки');
    eq(document.getElementById('dlgTitle').textContent, 'Таблица Excel', 'окно таблицы не открылось');
    ['tbExport', 'tbImport'].forEach(function (id) {
      var b = document.getElementById(id);
      ok(b && b.classList.contains('locked') && b.querySelector('.set-lock'), 'в бесплатной версии без замка: #' + id);
    });
    var un = document.getElementById('tbUndoImport');
    ok(un && !un.classList.contains('locked') && !un.querySelector('.set-lock'), 'у отмены импорта замок');
    document.getElementById('tbImport').click();
    eq(pw.length, 1, '«Загрузить» в бесплатной версии не открыл баннер');
    eq(pw[0], UI.openTable, 'из баннера нет возврата в окно таблицы');
    eq(clicks, 0, 'в бесплатной версии открылся выбор файла');
    document.getElementById('tbExport').click();
    eq(pw.length, 2, '«Выгрузить» в бесплатной версии не открыл баннер');
    UI.openTable();
    document.getElementById('tbUndoImport').click();
    eq(document.getElementById('dlgTitle').textContent, 'Отменить последнюю загрузку?', 'нет подтверждения отмены');
    document.getElementById('dlgBtns').lastChild.click();   // «Убрать»
    eq(stateCore(), before, 'после отмены в бесплатной версии данные не как были');
    ok(!Import.lastBatch(UI.S), 'отменять ещё есть что');
    UI.closeMenu(); UI.openMenu(); document.getElementById('mCopy').click();
    ok(document.getElementById('cpTable').classList.contains('locked'), 'отменять нечего, а замка снова нет');
    restore();
  }, function (e) { restore(); throw e; }).catch(function (e) { restore(); throw e; });
});

// (24б-9) 1.0.4: неизвестная таблица - экран сопоставления колонок; без даты дальше не
// пускает (сообщение в окне, не alert); выбрали колонки - предпросмотр; «Отмена» ничего не пишет.
add('Загрузка из таблицы: неизвестный CSV - экран сопоставления колонок', function () {
  var n0 = UI.S.tx.length;
  var csv = 'Когда;Сколько;На что;Откуда\n' + ruDay(0) + ';-150;Еда;Наличные\n' + ruDay(-1) + ';+2 000;Зарплата;Карта\n';
  var nEx = 0, ex0 = Import.extract;
  Import.extract = function () { nEx++; return ex0.apply(this, arguments); };
  function back() { Import.extract = ex0; }
  return ImportUI.fromBytes(new TextEncoder().encode(csv), 'своя.csv').then(function () {
    eq(document.getElementById('dlgTitle').textContent, 'Какая колонка что значит', 'нет экрана сопоставления');
    ok(document.querySelectorAll('#dlgBody .imp-prev td').length >= 8, 'нет первых строк файла');
    var more = document.getElementById('impMore');
    ok(more && document.querySelector('.imp-more').hidden, 'редкие колонки не спрятаны');
    document.getElementById('dlgBtns').lastChild.click();
    ok(UI.dlgOpen(), 'без даты окно закрылось');
    ok(!document.getElementById('impErr').hidden && /дат/.test(document.getElementById('impErr').textContent), 'нет подсказки про дату');
    function set(role, v) { var s = document.querySelector('#dlgBody .pk-f[data-role="' + role + '"]'); s.value = String(v); }
    var fd = document.querySelector('#dlgBody .pk-f[data-role="date"]');
    fd.click();
    ok(!document.getElementById('pk').hidden, 'импорт: колонка не открыла своё окно');
    document.querySelector('#pk [data-pk-val="0"]').click();
    eq(fd.value, '0', 'импорт: колонка из своего окна не записалась');
    set('amount', 1); set('cat', 2); set('wallet', 3);
    more.click();
    ok(!document.querySelector('.imp-more').hidden, '«Ещё колонки» не открыли редкие');
    document.getElementById('dlgBtns').lastChild.click();
    return sleep(60);
  }).then(function () {
    eq(document.getElementById('dlgTitle').textContent, 'Проверьте перед загрузкой', 'нет предпросмотра');
    var t = dlgText();
    ok(/Добавится 2 операции/.test(t) && /Колонки выбраны вами/.test(t), 'предпросмотр: ' + t);
    // Р16/Р20 ревью 15.10: файл по выбранным колонкам разобран один раз (проверка «Дальше» и
    // предпросмотр - один разбор)
    eq(nEx, 1, 'файл разобран ' + nEx + ' раз');
    back();
    document.getElementById('dlgBtns').firstChild.click();   // «Отмена»
    eq(UI.S.tx.length, n0, '«Отмена» записала операции');
    eq(ImportUI.state(), null, '«Отмена»: загрузка не забыта (таблица файла держится в памяти)');
  }, function (e) { back(); throw e; });
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
  // галочку ждём условием, а не 60 мс: под нагрузкой (сборка APK) кадр с поворотом
  // приходил позже и тест через раз краснел при живом приложении (11.10.2026)
  return sleep(60).then(function () { return waitFor(function () { return !chevUp(); }, 1500); }).then(function () {
    eq(UI.S.ui.incomeCollapsed, true, 'состояние не записалось');
    ok(document.getElementById('fieldInc').classList.contains('collapsed'), 'поле не свернулось');
    eq(body.getBoundingClientRect().height, 0, 'плитки доходов остались на экране');
    // Точки живут внутри #incBody: свёрнутое тело режет их своей рамкой (max-height 0 +
    // overflow hidden), а собственный прямоугольник точек остаётся 10 px. Раньше мерили
    // его и ловили ложное «точки остались» при двух страницах доходов (демо: 4 дохода +
    // «+»). Меряем видимую часть - пересечение с телом (стенд, разобрано 01.10.2026).
    var dr = document.getElementById('incDots').getBoundingClientRect(), br = body.getBoundingClientRect();
    eq(Math.max(0, Math.min(dr.bottom, br.bottom) - Math.max(dr.top, br.top)), 0, 'точки доходов остались');
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
    return sleep(60).then(function () { return waitFor(chevUp, 1500); });
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
  eq(ab.querySelector('.mi-s').textContent.trim(), 'помощь и автор', 'подпись плитки «О приложении»');

  // 3. порядок плиток меню: ровно как задал хозяин, парами, без пустой ячейки
  var ids = [].map.call(document.querySelectorAll('#menu .menu-list .mi'), function (b) { return b.id; });
  eq(ids.join(','),
    MENU_ORDER.join(','),
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
    ok(mh.textContent.indexOf('ведите пальцем') >= 0, 'главная подсказка не про перенос');
    // карточка кошелька: подсказка про свайп по строке, НЕ про «подними и неси»
    var w = circle('wallet', 0);
    UI.openCard({ kind: 'wallet', id: w.dataset.id });
    var ch = document.getElementById('cardHint');
    var ht = ch.querySelector('.sh-ht').textContent;
    ok(ht.indexOf('Потяните строку') >= 0, 'в карточке кошелька не подсказка про свайп: ' + ht);
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
    withSub('mPrefs', function () {
      var row = document.getElementById('snHints');
      ok(row, 'нет тумблера «Подсказки» в подменю');
      ok(row.querySelector('.mi-sw').classList.contains('on'), 'выключатель подсказок не «вкл»');
      row.click();     // выключаем
      eq(UI.S.ui.hints, false, 'подсказки не выключились');
      eq(row.getAttribute('aria-pressed'), 'false', 'aria-pressed не «false»');
      eq(document.getElementById('mPrefsInfo').textContent, 'подсказки выкл', 'подпись плитки после выключения подсказок');
    });
    UI.render();
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
    ok(txt().indexOf('ведите пальцем') >= 0, 'первой в очереди должна быть mainDrag');
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
    ok(el.textContent.indexOf('Перетаскивайте') >= 0, 'текст подсказки правки не тот');
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

// (26) смена месяца, пока приложение открыто/в фоне (баг 01.10.2026, найден в личном
// «Хомяке»): экран не рисовался заново после полуночи и показывал прошлый месяц.
// Подменяем «сегодня» на 1-е число следующего месяца, зовём ту же проверку, что стоит на
// возврате из фона, и смотрим экран. Заодно: лимиты не тронуты, free-гейт отвечает так же.
add('новый месяц: после полуночи экран с нуля, прошлый - в истории, лимиты переехали, гейт на месте', function () {
  var realToday = Engine.today, savedMonth = UI.S.ui.month;
  var cur = Engine.ym(realToday()), y = +cur.slice(0, 4), m = +cur.slice(5, 7);
  var next = (m === 12 ? (y + 1) + '-01' : y + '-' + (m < 9 ? '0' : '') + (m + 1));
  function spent() { return Number(document.querySelector('#sumSpent .sv').textContent.replace(/[^\d-]/g, '')) || 0; }
  function gate() {
    return JSON.stringify({ l: UI.S.limits[cur], w: Engine.canAddWallet(UI.S, false), e: Engine.canAddExpCat(UI.S, false), i: Engine.canAddIncCat(UI.S, false) });
  }
  UI.S.ui.month = null; UI.render();
  var before = spent(), gateBefore = gate(), hadNext = !!UI.S.limits[next], hadMark = !!UI.S.limitsCarried[next];
  ok(before > 0, 'в демо текущего месяца нет факта');
  try {
    Engine.today = function () { return next + '-01'; };
    ok(UI.checkDay(), 'проверка дня не перерисовала экран');
    eq(UI.curYM(), next, 'месяц экрана после полуночи');
    eq(spent(), 0, '«Потрачено» в новом месяце');
    ok(document.getElementById('sums').getAttribute('aria-label').indexOf(UI.monthLabel(next)) >= 0, 'шапка не подписана новым месяцем');
    ok(!document.querySelector('#app .circle[data-kind="exp"] .ring:not([data-pct="0"])'), 'кольца расходов не пустые');
    eq(gate(), gateBefore, 'лимиты или free-гейт изменились от смены месяца');
    // лимиты прошлого месяца сами переезжают в новый (решение 01.10.2026)
    if (!hadNext && UI.S.limits[cur]) ok(UI.S.limits[next] && Object.keys(UI.S.limits[next]).length, 'лимиты не переехали в новый месяц');
    UI.S.ui.month = cur; UI.render();
    eq(spent(), before, 'прошлый месяц в истории со старыми суммами');
  } finally {
    Engine.today = realToday;
    if (!hadNext) delete UI.S.limits[next];
    if (!hadMark) delete UI.S.limitsCarried[next];
    UI.S.ui.month = savedMonth; UI.render(); UI.save();
  }
  eq(UI.curYM(), savedMonth || cur, 'месяц вернулся');
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

// ---------- 1.0.3: замок, окно оценки, напоминание о копии ----------
// Проверки через экран: что видно поверх данных, какие окна появились, какие нет.
function lockEl() { return document.getElementById('lock'); }
function lockDotsOn() { return document.querySelectorAll('#lockDots i.on').length; }
function lockType(pin) {
  pin.split('').forEach(function (d) {
    var b = document.querySelector('#lockPad [data-k="' + d + '"]');
    if (b && !b.disabled) b.click();
  });
  // проверка кода асинхронная (PBKDF2): ждём, пока точки сбросятся или замок уйдёт
  return waitFor(function () { return lockEl().hidden || lockDotsOn() === 0; }, 4000);
}
function withLockKey(fn) {
  var saved = null;
  try { saved = localStorage.getItem(AppLock.KEY); } catch (e) {}
  function restore() {
    AppLock._disable();
    try { if (saved !== null) localStorage.setItem(AppLock.KEY, saved); } catch (e) {}
  }
  return Promise.resolve().then(fn).then(function (v) { restore(); return v; }, function (e) { restore(); throw e; });
}

// (Алексей 14.10) вход по отпечатку: под окном отпечатка - экран «Вход по отпечатку» без
// клавиатуры кода; «Ввести код» на экране и в системном окне показывает код; системное окно
// закрылось после 3 неудачных касаний - сразу код (ревью 14.10 №5-6)
add('замок с отпечатком: сначала экран отпечатка, код - по кнопке, из системного окна или после 3 неудач', function () {
  var np0 = window.NativePlugins, nat0 = window.isNativeApp, fail = { code: '15' }, calls = 0, opts = null;
  window.isNativeApp = function () { return true; };
  window.NativePlugins = Object.assign({}, np0 || {}, { NativeBiometric: {
    isAvailable: function () { return Promise.resolve({ isAvailable: true }); },
    verifyIdentity: function (o) { calls++; opts = o; return Promise.reject(fail); } } });
  function padShown() { return document.getElementById('lockPad').getClientRects().length > 0; }
  function msg() { return document.getElementById('lockMsg').textContent; }
  return withLockKey(function () {
    return AppLock._enable('2468', true).then(function () {
      AppLock.lockNow();
      ok(lockEl().classList.contains('bio-first'), 'нет экрана отпечатка');
      eq(document.getElementById('lockTitle').textContent, 'Вход по отпечатку', 'заголовок');
      ok(!padShown(), 'под отпечатком видна клавиатура кода');
      ok(document.getElementById('lockToCode').getClientRects().length > 0, 'нет «Ввести код»');
      return sleep(500);
    }).then(function () {
      // 15 - окно закрыла система (тайм-аут, ушли из приложения): остаёмся на экране отпечатка
      ok(calls === 1, 'системное окно отпечатка не позвали');
      eq(opts && opts.maxAttempts, 3, 'системное окно: 3 касания');
      eq(opts && opts.negativeButtonText, 'Ввести код', 'кнопка системного окна');
      ok(lockEl().classList.contains('bio-first'), 'после закрытия окна системой экран отпечатка пропал');
      document.getElementById('lockToCode').click();
      ok(padShown(), '«Ввести код» не показал клавиатуру');
      return lockType('2468');
    }).then(function () {
      ok(lockEl().hidden, 'код не открыл');
      fail = { code: '16' };                         // «Ввести код» в системном окне
      AppLock.lockNow();
      return sleep(500);
    }).then(function () {
      ok(!lockEl().classList.contains('bio-first') && padShown(), '«Ввести код» в системном окне вернул на экран отпечатка, а не на код');
      eq(document.getElementById('lockTitle').textContent, 'Введите код', 'заголовок после «Ввести код»');
      return lockType('2468');
    });
  }).then(function () { window.NativePlugins = np0; window.isNativeApp = nat0; },
    function (e) { window.NativePlugins = np0; window.isNativeApp = nat0; throw e; });
});
// правило Алексея «3 неудачи отпечатка → код»: системное окно само считает 3 касания
// (maxAttempts: 3) и закрывается с кодом 10 - сразу код, без второго и третьего окна
// (было до 9 касаний и «осталось 2 попытки» после трёх неудач)
add('замок с отпечатком: 3 неудачных касания в системном окне - сразу код', function () {
  var np0 = window.NativePlugins, nat0 = window.isNativeApp, calls = 0;
  window.isNativeApp = function () { return true; };
  window.NativePlugins = Object.assign({}, np0 || {}, { NativeBiometric: {
    isAvailable: function () { return Promise.resolve({ isAvailable: true }); },
    verifyIdentity: function () { calls++; return Promise.reject({ code: '10' }); } } });
  function padShown() { return document.getElementById('lockPad').getClientRects().length > 0; }
  function msg() { return document.getElementById('lockMsg').textContent; }
  return withLockKey(function () {
    return AppLock._enable('2468', true).then(function () {
      AppLock.lockNow();
      return sleep(500);
    }).then(function () {
      eq(calls, 1, 'системное окно позвали больше одного раза');
      ok(!lockEl().classList.contains('bio-first') && padShown(), 'после 3 неудачных касаний нет клавиатуры кода');
      ok(/введите код/.test(msg()), 'нет подсказки «введите код»: ' + msg());
      ok(!/осталось/.test(msg()), 'после 3 неудач обещаны ещё попытки: ' + msg());
      return lockType('2468');
    });
  }).then(function () { window.NativePlugins = np0; window.isNativeApp = nat0; },
    function (e) { window.NativePlugins = np0; window.isNativeApp = nat0; throw e; });
});

add('1.0.3 замок: экран закрывает данные, 5 неверных - пауза, верный код открывает', function () {
  return withLockKey(function () {
    return AppLock._enable('1357', false).then(function () {
      AppLock.lockNow();
      var el = lockEl();
      ok(!el.hidden && AppLock.isLocked(), 'экран замка не показан');
      var r = el.getBoundingClientRect();
      ok(r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1, 'замок не на весь экран');
      var sp = document.getElementById('sumSpent').getBoundingClientRect();
      var hit = withoutPanel(function () { return document.elementFromPoint(sp.left + sp.width / 2, sp.top + sp.height / 2); });
      ok(hit && el.contains(hit), 'под замком видно «Потрачено»: ' + (hit && (hit.id || hit.className)));
      var bg = getComputedStyle(el).backgroundColor;
      ok(bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg), 'фон замка прозрачный: ' + bg);
      ok(!!document.querySelector('#lockPad [data-k="0"]'), 'нет клавиатуры кода');
      ok(localStorage.getItem(AppLock.KEY).indexOf('1357') < 0, 'код лежит открытым текстом');
      var chain = Promise.resolve();
      for (var i = 0; i < 5; i++) chain = chain.then(function () { return lockType('0000'); });
      return chain.then(function () {
        ok(!el.hidden, 'неверный код открыл приложение');
        ok(/Подождите 30 с/.test(document.getElementById('lockMsg').textContent),
          'после 5 неверных нет паузы: ' + document.getElementById('lockMsg').textContent);
        ok(document.querySelector('#lockPad [data-k="1"]').disabled, 'во время паузы клавиши живые');
        AppLock._unlockState();                 // как будто 30 секунд прошли
        return lockType('1357');
      }).then(function () {
        ok(el.hidden && !AppLock.isLocked(), 'верный код не открыл приложение');
        ok(!document.body.classList.contains('locked'), 'метка locked осталась');
      });
    });
  });
});

add('1.0.3 замок: после фона - шторка; меньше 5 минут - без кода, 5 минут - код; своё окно - не запираем', function () {
  return withLockKey(function () {
    return AppLock._enable('2468', false).then(function () {
      var el = lockEl();
      AppLock._bgAt(0);
      AppLock.onBackground();
      ok(!el.hidden && AppLock.isCovered(), 'в фоне данные не закрыты шторкой');
      var pad = document.getElementById('lockPad');
      ok(pad.getBoundingClientRect().height === 0, 'на шторке видна клавиатура');
      AppLock._bgAt(Date.now() - 4 * 60000);
      AppLock.onForeground();
      ok(el.hidden && !AppLock.isLocked(), '4 минуты в фоне - не должно запирать (порог 5 минут)');
      AppLock.onBackground();
      AppLock._bgAt(Date.now() - 5 * 60000 - 1000);
      AppLock.onForeground();
      ok(!el.hidden && AppLock.isLocked(), '5 минут в фоне - должен быть замок');
      ok(pad.getBoundingClientRect().height > 0, 'на замке нет клавиатуры');
      return lockType('2468').then(function () {
        ok(el.hidden, 'код не открыл');
        AppLock._bgAt(0);
        AppLock.away();                       // своё системное окно (сохранение файла и т.п.)
        AppLock.onBackground();
        ok(el.hidden, 'своё системное окно - шторка не нужна');
        AppLock._bgAt(Date.now() - 7 * 60000);
        AppLock.onForeground();
        ok(el.hidden && !AppLock.isLocked(), 'после своего окна запирать нельзя');
        // метка одноразовая: следующий уход на 7 минут без своего окна - замок
        AppLock.onBackground();
        AppLock._bgAt(Date.now() - 7 * 60000);
        AppLock.onForeground();
        ok(!el.hidden && AppLock.isLocked(), 'метка своего окна сработала второй раз');
        // 9 (ревью 1.0.3): под замком приложение inert, ничего не фокусируется
        var app = document.getElementById('app');
        ok(app.inert === true && app.getAttribute('aria-hidden') === 'true', 'под замком #app не inert');
        return lockType('2468');
      }).then(function () {
        ok(el.hidden && document.getElementById('app').inert === false, 'после входа #app остался inert');
        // ревью 1.0.3: из своего окна ушли надолго (дольше AWAY_MAX) - запираем
        AppLock.away();
        AppLock.onBackground();
        AppLock._bgAt(Date.now() - Guards.LOCK.AWAY_MAX - 1000);
        AppLock.onForeground();
        ok(!el.hidden && AppLock.isLocked(), 'ушёл из окна сохранения надолго - замка нет');
      });
    });
  });
});

add('1.0.3 замок: «Забыли код?» без отпечатка честно говорит про переустановку', function () {
  return withLockKey(function () {
    return AppLock._enable('1111', false).then(function () {
      AppLock.lockNow();
      document.getElementById('lockForgot').click();
      var sh = document.getElementById('lockSheet');
      ok(!sh.hidden && sh.getBoundingClientRect().height > 0, 'панель «Забыли код?» не видна');
      var t = sh.textContent;
      ok(/переустановк/.test(t) && /удалятся/.test(t), 'нет честного объяснения: ' + t);
      ok(/меню → «Копия данных» → «Восстановить из файла»/.test(t), 'нет подсказки про копию (новый путь)');
      ok(document.getElementById('dlg').hidden, 'вылезло обычное окно поверх/под замком');
      sh.querySelector('.btn').click();
      ok(sh.hidden, 'панель не закрылась');
    });
  });
});

add('1.0.3 замок: плитка меню, честный текст, код задаётся дважды через экран', function () {
  return withLockKey(function () {
    AppLock._disable();
    UI.renderMenu();
    eq(document.getElementById('mLockInfo').textContent, 'выкл', 'по умолчанию замок выключен');
    UI.openMenu();
    document.getElementById('mLock').click();
    var dlg = document.getElementById('dlg');
    ok(!dlg.hidden, 'окно настройки не открылось');
    eq(document.getElementById('dlgTitle').textContent, 'Защита входа', 'заголовок окна');
    ok(/не шифрует/.test(document.getElementById('dlgBody').textContent), 'нет честного «не шифрует»');
    UI.closeDlg();
    AppLock._setupPin(false, false);
    function press(pin) {
      pin.split('').forEach(function (d) { document.querySelector('#pinPad [data-k="' + d + '"]').click(); });
    }
    eq(document.getElementById('dlgTitle').textContent, 'Придумайте код', 'первый шаг');
    press('2580');
    return waitFor(function () { return document.getElementById('dlgTitle').textContent === 'Повторите код'; }, 2000).then(function (s) {
      ok(s, 'нет шага «Повторите код»');
      press('2580');
      return waitFor(function () { return AppLock.isOn() && dlg.hidden; }, 4000);
    }).then(function (on) {
      ok(on, 'код не включился');
      ok(/Защита входа включена/.test(document.getElementById('toastText').textContent), 'нет тоста о включении');
      UI.renderMenu();
      eq(document.getElementById('mLockInfo').textContent, 'вкл', 'подпись плитки');
      ok(localStorage.getItem(AppLock.KEY).indexOf('2580') < 0, 'код лежит открытым текстом');
      UI.hideToast();
    });
  });
});

add('1.0.3 оценка: после 20-й операции на 7-й день - один вызов RuStore, без своих окон', function () {
  var saved = null;
  try { saved = localStorage.getItem(Nudges.RKEY); localStorage.removeItem(Nudges.RKEY); } catch (e) {}
  var snapS = JSON.stringify(UI.S);
  var calls = 0, answer = { shown: false, code: 'NOT_INSTALLED' };
  Nudges._plugin({ requestAndLaunch: function () { calls++; return Promise.resolve(answer); } });
  var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
  var c = Engine.listCategories(UI.S, 'exp', { ymStr: UI.curYM() })[0];
  var first = Date.now() - 8 * 86400000;
  UI.S.tx = [];
  for (var i = 0; i < 18; i++) UI.S.tx.push({ id: 'rv' + i, kind: 'exp', amount: 10, date: Engine.today(), ts: first + i, catId: c.id, walletId: w.id });
  UI.save(); UI.render();
  function saveOp() {
    UI.openAmount({ kind: 'exp', catId: c.id, walletId: w.id });
    document.querySelector('#amKeys .amk[data-k="5"]').click();
    document.getElementById('amConfirm').click();
  }
  function done() {
    Nudges._plugin(null);
    try { if (saved !== null) localStorage.setItem(Nudges.RKEY, saved); else localStorage.removeItem(Nudges.RKEY); } catch (e) {}
    UI.S = Engine.migrate(JSON.parse(snapS)); UI.save(); UI.renderInstant(); UI.hideToast();
  }
  saveOp();                                             // 18 + одна запись = 19: рано
  return sleep(150).then(function () {
    eq(UI.S.tx.length, 19, 'операция не записалась через экран суммы');
    eq(calls, 0, '19 операций - окно звать рано');
    saveOp();                                           // 20-я
    return waitFor(function () { return calls === 1; }, 2000);
  }).then(function () {
    eq(calls, 1, 'после 20-й операции окно не позвали');
    return sleep(100);
  }).then(function () {
    ok(document.getElementById('dlg').hidden, 'своё окно поверх (запрещено правилами RuStore)');
    ok(!/оцен/i.test(document.getElementById('toastText').textContent), 'свой тост про оценку');
    var st = JSON.parse(localStorage.getItem(Nudges.RKEY));
    ok(st && st.retryAt > Date.now() + 59 * 86400000 && !st.done, '«не показано» - повтор через 60 дней: ' + JSON.stringify(st));
    saveOp();
    return sleep(150);
  }).then(function () {
    eq(calls, 1, 'спросили второй раз раньше 60 дней');
    var st = JSON.parse(localStorage.getItem(Nudges.RKEY)); st.retryAt = Date.now() - 1;
    localStorage.setItem(Nudges.RKEY, JSON.stringify(st));
    answer = { shown: true };
    saveOp();
    return waitFor(function () { return calls === 2; }, 2000);
  }).then(function () {
    eq(calls, 2, 'повтор через 60 дней не случился');
    return sleep(100);
  }).then(function () {
    var st = JSON.parse(localStorage.getItem(Nudges.RKEY));
    ok(st.done, 'после показа окна флаг «больше не спрашивать» не встал');
    saveOp();
    return sleep(150);
  }).then(function () {
    eq(calls, 2, 'после показа спросили ещё раз');
    done();
  }, function (e) { done(); throw e; });
});

// (06.10) сводка показывала у категорий угаданную иконку вместо своей: «Еда» - многоточие.
add('сводка: иконка категории та же, что на главном экране (своя иконка категории)', function () {
  var S = UI.S, c = S.categories.exp.filter(function (x) { return !x.archived; })[0];
  ok(c, 'нет расходной категории');
  var oldIc = c.icon, oldOwn = S.icons[c.id], ym = Engine.ym(Engine.today());
  c.icon = 'plane'; delete S.icons[c.id];                    // своя иконка, которую по имени не угадать
  var w = S.wallets[0];
  var tx = Engine.addTx(S, { kind: 'exp', amount: 777, catId: c.id, walletId: w.id, date: Engine.today() });
  UI.render();
  UI.openSummary({ kind: 'exp', ym: ym, view: 'summary' });
  return sleep(60).then(function () {
    var row = document.querySelector('#smBody .sm-row[data-id="' + c.id + '"] .sm-ico');
    ok(row, 'строки категории в сводке нет');
    eq(row.innerHTML, Icons.img('plane', 'exp', 23, c.name), 'в сводке не своя иконка категории');
  }).finally(function () {
    Engine.deleteTx ? Engine.deleteTx(S, tx.id) : null;
    c.icon = oldIc; if (oldOwn) S.icons[c.id] = oldOwn;
    UI.closeTop(); UI.render();
  });
});

add('1.0.3 копия: карточка раз в месяц, «Позже» - до следующего месяца, не новичку и не в демо', function () {
  var key = Nudges.BKEY, saved = null;
  try { saved = localStorage.getItem(key); localStorage.removeItem(key); } catch (e) {}
  var el = document.getElementById('remind');
  function restore() {
    Nudges.hideRemind();
    try { if (saved !== null) localStorage.setItem(key, saved); else localStorage.removeItem(key); } catch (e) {}
    UI.renderMenu(); UI.hideToast();
  }
  try {
    Nudges.hideRemind();
    ok(!Nudges.checkRemind() && el.hidden, 'в демо карточка не нужна');
    ok(Nudges.checkRemind({ demo: false, txCount: 50 }), 'карточка не показалась');
    // въезд сверху (toastDown) доигрываем сразу, иначе замер ловит середину анимации
    if (el.getAnimations) el.getAnimations().forEach(function (an) { try { an.finish(); } catch (e) {} });
    var r = el.getBoundingClientRect();
    ok(!el.hidden && r.height > 40 && r.top >= 0 && r.bottom <= window.innerHeight, 'карточку не видно на экране: ' + JSON.stringify({ h: el.hidden, top: Math.round(r.top), b: Math.round(r.bottom), H: r.height, wh: window.innerHeight }));
    // ревью 1.0.3: карточка не на шапке «Потрачено» и ниже любого слоя (меню, окна)
    var sp = document.getElementById('sumSpent').getBoundingClientRect();
    ok(r.top >= sp.bottom || r.bottom <= sp.top, 'карточка закрывает «Потрачено»');
    var zr = +getComputedStyle(el).zIndex, zm = +getComputedStyle(document.getElementById('menuBg')).zIndex;
    ok(zr < zm, 'карточка выше меню: z ' + zr + ' >= ' + zm);
    ok(document.getElementById('fabAdd').hidden, 'при карточке виден «плюс» под ней');
    eq(document.getElementById('remindSave').textContent, 'Сохранить копию', 'кнопка сохранения');
    eq(document.getElementById('remindLater').textContent, 'Позже', 'кнопка «Позже»');
    ok(el.textContent.indexOf('—') < 0, 'длинное тире в тексте');
    document.getElementById('remindLater').click();
    ok(el.hidden, '«Позже» не убрало карточку');
    ok(!Nudges.checkRemind({ demo: false, txCount: 50 }), 'после «Позже» в этом месяце снова показали');
    localStorage.removeItem(key);
    ok(!Nudges.checkRemind({ demo: false, txCount: 5 }), 'новичку (5 операций) показали');
    Backup.markBackup();
    ok(JSON.parse(localStorage.getItem(key)).lastAt > Date.now() - 5000, 'дата копии не запомнилась');
    ok(!Nudges.checkRemind({ demo: false, txCount: 50 }), 'копию сделали в этом месяце, а карточка есть');
    localStorage.removeItem(key);
    withSub('mCopy', function () {
      var row = document.getElementById('cpRemind');
      eq(row.getAttribute('aria-pressed'), 'true', 'тумблер напоминания не «вкл»');
      row.click();
      eq(row.getAttribute('aria-pressed'), 'false', 'тумблер не выключился');
      ok(!row.querySelector('.mi-sw').classList.contains('on'), 'выключатель остался включённым');
      ok(Nudges.remindOff(), 'настройка не выключилась');
      ok(!Nudges.checkRemind({ demo: false, txCount: 50 }), 'выключено, а показали');
      row.click();
      eq(row.getAttribute('aria-pressed'), 'true', 'тумблер не включился');
      ok(!Nudges.remindOff(), 'настройка не включилась');
    });
  } finally { restore(); }
});

// ---------- 1.0.4: учёт долгов (debts.js, концепция docs/1.0.4-dolgi-koncepciya.md) ----------
// Каждая проверка убирает за собой заведённые долги: остальные проверки видят ленту как была.
function dropDebts() {
  (UI.S.debts || []).slice().forEach(function (d) { Engine.deleteDebt(UI.S, d.id); });
  if (window.Debts) Debts.hideWarn();
  UI.save(); UI.render();
}
function stripOf() { return document.querySelector('#fieldWallets .strip'); }

// (Д1) «+» в ленте → «Долг: я должен» → форма → плитка долга после кошельков, высота та же
add('долги: создание через «+» - плитка в ленте после кошельков, высота экрана не меняется', function () {
  var h0 = UI.hasFullAccess;
  UI.hasFullAccess = function () { return true; };
  try {
    dropDebts();
    var field = document.getElementById('fieldWallets'), fh = field.getBoundingClientRect().height;
    var bal0 = document.querySelector('#sumBalance .sv').textContent;
    document.querySelector('#fieldWallets .addtile[data-add="wallet"]').click();
    eq(document.getElementById('dlgTitle').textContent, 'Что добавить', 'окно выбора');
    var opts = [].map.call(document.querySelectorAll('#dlgBody [data-add-what]'), function (b) { return b.getAttribute('data-add-what'); });
    eq(opts.join(','), 'wallet,owe,owed', 'варианты');
    document.querySelector('#dlgBody [data-add-what="owe"]').click();
    eq(document.getElementById('dlgTitle').textContent, 'Я должен', 'форма «Я должен»');
    document.getElementById('dnName').value = 'Ипотека тест';
    document.getElementById('dnAmount').value = '1 200 000';
    document.getElementById('dnPay').value = '30 000';
    // день платежа - сетка 7 x 5: все 31 число на экране, кнопки не меньше 40px, выбор касанием
    var grid = document.getElementById('dnDayGrid');
    var cells = grid.querySelectorAll('.dg-d');
    eq(cells.length, 31, 'чисел в сетке');
    eq(getComputedStyle(grid).gridTemplateColumns.split(' ').length, 7, 'столбцов');
    ok([].every.call(cells, function (c) { var r = c.getBoundingClientRect(); return r.width >= 39.5 && r.height >= 39.5; }), 'число меньше 40px');
    ok(grid.scrollHeight <= grid.clientHeight + 1, 'сетка прокручивается');
    ok(!/коротком месяце/.test(grid.parentNode.textContent), 'подпись про короткий месяц вернулась (убрана 13.10)');
    grid.querySelector('[data-day="15"]').click();
    ok(grid.querySelector('[data-day="15"]').classList.contains('on') && grid.querySelectorAll('.dg-d.on').length === 1, 'выбранное число не подсвечено');
    eq(document.getElementById('dnDay').value, '15', 'выбор не записан');
    document.getElementById('dnRate').value = '12';
    document.getElementById('dlgBtns').lastChild.click();
    ok(document.getElementById('dlg').hidden, 'форма не закрылась: ' + (document.getElementById('dnErr') || {}).textContent);
    var d = UI.S.debts[0];
    ok(d && d.name === 'Ипотека тест' && d.base === 1200000 && d.pay === 30000 && d.day === 15 && d.rate === 12, 'долг записан не так: ' + JSON.stringify(d));
    var tiles = [].slice.call(stripOf().querySelectorAll('.circle'));
    var di = tiles.findIndex(function (t) { return t.dataset.kind === 'debt'; });
    ok(di >= 0, 'плитки долга нет в ленте');
    ok(tiles.slice(0, di).every(function (t) { return t.dataset.kind === 'wallet'; }) && tiles.slice(di).every(function (t) { return t.dataset.kind === 'debt'; }), 'долг не после кошельков');
    var dt = tiles[di], wt = tiles[0];
    ok(dt.classList.contains('wcard') && dt.classList.contains('debt'), 'плитка долга не своего вида');
    eq(Math.round(dt.getBoundingClientRect().height), Math.round(wt.getBoundingClientRect().height), 'высота плитки долга');
    eq(Math.round(field.getBoundingClientRect().height), Math.round(fh), 'высота ленты изменилась');
    eq(document.querySelector('#sumBalance .sv').textContent, bal0, '«В кошельках» изменилось от долга');
    ok(/Ипотека тест/.test(dt.textContent) && /1\u00a0200\u00a0000/.test(dt.querySelector('.cbal').textContent), 'на плитке не имя и остаток: ' + dt.textContent);
    eq(getComputedStyle(dt).borderTopStyle, 'solid', 'рамки нет');
    // правка долга: та же сетка, текущий день подсвечен, новый выбор сохраняется
    Debts.editDebt(d.id);
    ok(document.querySelector('#deDayGrid [data-day="15"]').classList.contains('on'), 'в правке не подсвечен текущий день');
    document.querySelector('#deDayGrid [data-day="31"]').click();
    document.getElementById('dlgBtns').lastChild.click();
    eq(d.day, 31, 'новый день платежа не сохранился');
    // пустое название - своя строка ошибки в форме, не нативный alert
    Debts.addDebt('owed');
    document.getElementById('dlgBtns').lastChild.click();
    ok(!document.getElementById('dnErr').hidden && /кто должен/.test(document.getElementById('dnErr').textContent), 'нет ошибки про имя');
    UI.closeDlg();
  } finally { UI.hasFullAccess = h0; UI.closeDlg(); dropDebts(); }
});

// (14.10) ставка на плитке долга и в шапке карточки вместо значка «%»: «18 %», «12,94 %» (Р15: как ввели);
// «я должен» красным, «мне должны» зелёным; без ставки - значок «%» того же цвета.
// «Мне должны» - поле «Ставка, % годовых» (только для наглядности)
add('долги: ставка на плитке и в шапке карточки, цвет вида долга', function () {
  var h0 = UI.hasFullAccess;
  UI.hasFullAccess = function () { return true; };
  try {
    var a = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит ставка', amount: 100000, pay: 5000, day: 10, rate: 18 });
    var b = Engine.addDebt(UI.S, { type: 'owe', name: 'Рассрочка ставка', amount: 50000, pay: 5000, day: 10, rate: 12.94 });
    var c = Engine.addDebt(UI.S, { type: 'owe', name: 'Друг без ставки', amount: 10000, pay: 1000, day: 10 });
    UI.save(); UI.render();
    function tile(d) { return document.querySelector('#app .circle.debt[data-id="' + d.id + '"]'); }
    function ico(d) { return tile(d).querySelector('.ico'); }
    eq(ico(a).textContent, '18\u00a0%', 'целая ставка на плитке');
    eq(ico(b).textContent, '12,94\u00a0%', 'дробная ставка на плитке - как ввели (Р15 15.10)');
    ok(ico(c).querySelector('svg') && !ico(c).textContent.trim(), 'без ставки нет значка «%»');
    var red = getComputedStyle(tile(a)).borderTopColor;
    eq(getComputedStyle(ico(a).querySelector('.drate')).color, red, '«я должен»: ставка не красная');
    eq(getComputedStyle(ico(c)).color, red, '«я должен» без ставки: значок не красный');
    // «мне должны»: поле ставки в форме, сохраняется, зелёная ставка на плитке
    Debts.addDebt('owed');
    var rf = document.getElementById('dnRate');
    ok(rf, 'в форме «мне должны» нет поля ставки');
    ok(/Ставка, % годовых/.test(document.getElementById('dlgBody').textContent), 'нет подписи «Ставка, % годовых»');
    document.getElementById('dnName').value = 'Саша ставка';
    document.getElementById('dnAmount').value = '20000';
    rf.value = '7,5';
    document.getElementById('dlgBtns').lastChild.click();
    var o = UI.S.debts.filter(function (x) { return x.name === 'Саша ставка'; })[0];
    ok(o && o.type === 'owed' && o.rate === 7.5, '«мне должны» без ставки: ' + JSON.stringify(o));
    UI.render();
    eq(ico(o).textContent, '7,5\u00a0%', 'ставка «мне должны» на плитке');
    var green = getComputedStyle(tile(o)).borderTopColor;
    ok(green !== red, 'рамки «я должен» и «мне должны» одного цвета');
    eq(getComputedStyle(ico(o).querySelector('.drate')).color, green, '«мне должны»: ставка не зелёная');
    // шапка карточки
    UI.openCard({ kind: 'debt', id: a.id });
    eq(document.getElementById('cardIco').textContent, '18\u00a0%', 'в шапке карточки нет ставки');
    eq(getComputedStyle(document.querySelector('#cardIco .drate')).color, red, 'ставка в шапке не красная');
    UI.closeCard();
    UI.openCard({ kind: 'debt', id: o.id });
    eq(document.getElementById('cardIco').textContent, '7,5\u00a0%', 'в шапке «мне должны» нет ставки');
    eq(getComputedStyle(document.querySelector('#cardIco .drate')).color, green, 'ставка «мне должны» в шапке не зелёная');
    UI.closeCard();
    UI.openCard({ kind: 'debt', id: c.id });
    ok(document.querySelector('#cardIco svg'), 'без ставки в шапке нет значка «%»');
    UI.closeCard();
  } finally { UI.hasFullAccess = h0; UI.closeCard(); UI.closeDlg(); dropDebts(); }
});

// (14.10) подсказки долгов и кредитки - тексты владельца на настоящем экране
add('долги: подсказки 14.10 - пустая история, ставка, архив, free, «О приложении», хомяк', function () {
  var h0 = UI.hasFullAccess, hints0 = UI.S.ui.hints, dis0 = UI.S.ui.hintsDismissed && UI.S.ui.hintsDismissed.debts;
  UI.hasFullAccess = function () { return true; };
  function txt(id) { return document.getElementById(id).textContent.replace(/\s+/g, ' '); }
  try {
    var a = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит подсказки', amount: 100000, pay: 5000, day: 10, rate: 12 });
    var b = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша подсказки', amount: 3000 });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: a.id });
    ok(txt('cardList').indexOf('Платежей пока нет. Перетащите кошелёк на плитку долга - это платёж. Взяли ещё в долг - перетащите плитку долга на кошелёк.') >= 0, 'пустая история «я должен»: ' + txt('cardList'));
    ok(txt('cardList').indexOf('Проценты берутся раз в месяц, с первого платежа. Досрочный платёж целиком идёт в счёт долга.') >= 0, 'нет строки про проценты при ставке');
    UI.closeCard();
    UI.openCard({ kind: 'debt', id: b.id });
    ok(txt('cardList').indexOf('Возвратов пока нет. Вернули - перетащите плитку долга на кошелёк или нажмите «Записать платёж». Дали ещё - перетащите кошелёк на плитку долга.') >= 0, 'пустая история «мне должны»: ' + txt('cardList'));
    ok(txt('cardList').indexOf('Проценты берутся') < 0, 'строка про проценты без ставки');
    UI.closeCard();
    // форма долга: подсказка ставки
    Debts.addDebt('owe');
    ok(txt('dlgBody').indexOf('покажет, сколько из платежа ушло на проценты, а сколько в счёт долга. Проценты считаются раз в месяц, в первом платеже.') >= 0, 'подсказка ставки');
    UI.closeDlg();
    // кредитка: подпись отметки
    var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    UI.editWallet(w.id);
    ok(txt('dlgBody').indexOf('Минус на карте - ваш долг банку. В долговую нагрузку не входит.') >= 0, 'подпись «Кредитная карта»');
    UI.closeDlg();
    // «О приложении»
    document.getElementById('mAbout').click();
    ok(txt('dlgBody').indexOf('долг на кошелёк - взяли в долг или вам вернули') >= 0, 'в «О приложении» нет жеста «долг на кошелёк»');
    UI.closeDlg(); UI.closeMenu();
    // подсказка хомяка после первого долга: одна, гасится, слушает общий выключатель
    UI.S.ui.hints = true;
    if (UI.S.ui.hintsDismissed) delete UI.S.ui.hintsDismissed.debts;
    ['balance', 'mainDrag', 'fill', 'taps'].forEach(function (k) { if (!UI.S.ui.hintsDismissed) UI.S.ui.hintsDismissed = {}; });
    var keep = {};
    ['balance', 'mainDrag'].forEach(function (k) { keep[k] = UI.S.ui.hintsDismissed[k]; UI.S.ui.hintsDismissed[k] = true; });
    try {
      UI.render(); UI.updateMainHint();
      eq(UI.mainHintKey(), 'debts', 'после первого долга нет подсказки про «В кошельках»: ' + JSON.stringify(UI.overlayFlags()) + ' тайлов ' + document.querySelectorAll('#app .circle[data-kind="debt"]').length + ' ' + document.body.className);
      eq(document.querySelector('#mainHint .mh-t').textContent, 'Долги не входят в «В кошельках»: их итог - в «Аналитике» → «Капитал и обязательства».', 'текст подсказки');
      UI.S.ui.hints = false; UI.updateMainHint();
      ok(UI.mainHintKey() !== 'debts' && document.getElementById('mainHint').hidden, 'подсказка не слушает общий выключатель');
      UI.S.ui.hints = true;
      UI.dismissHint('debts'); UI.updateMainHint();
      ok(UI.mainHintKey() !== 'debts', 'погашенная подсказка вернулась');
    } finally { Object.keys(keep).forEach(function (k) { if (keep[k]) UI.S.ui.hintsDismissed[k] = true; else delete UI.S.ui.hintsDismissed[k]; }); }
    // архив: тост говорит, где искать
    Engine.setDebtBase(UI.S, b.id, 0);
    Debts.archive(b.id);
    ok(txt('toastText').indexOf('Найти: меню → «Настроить кошельки» → «Погашенные».') >= 0, 'тост архива без «Найти»: ' + txt('toastText'));
    UI.hideToast();
    // free: под замком «В бесплатной версии - один долг.»
    UI.hasFullAccess = function () { return false; };
    Debts.addToStrip();
    ok(txt('dlgBody').indexOf('В бесплатной версии - один долг.') >= 0, 'free: нет подписи про один долг');
    UI.closeDlg();
    UI.hasFullAccess = function () { return true; };
    Debts.addToStrip();
    ok(txt('dlgBody').indexOf('В бесплатной версии') < 0, 'полный доступ: подпись free');
    UI.closeDlg();
  } finally {
    UI.hasFullAccess = h0; UI.S.ui.hints = hints0;
    if (UI.S.ui.hintsDismissed) { if (dis0) UI.S.ui.hintsDismissed.debts = true; else delete UI.S.ui.hintsDismissed.debts; }
    UI.closeCard(); UI.closeDlg(); UI.hideToast(); dropDebts();
  }
});

// (14.10) аналитика: «Долги» - месяц закрытия в предложном, подвал; «Капитал» - подвал;
// карточка выбора - весы и «расходы и доходы за год»; «Сводка» - палитры; «Динамика» - вкладки
add('аналитика 14.10: подписи «Долгов» и «Капитала», палитры сводки, динамика доходов', function () {
  var h0 = UI.hasFullAccess;
  UI.hasFullAccess = function () { return true; };
  function body() { return document.getElementById('smBody').textContent; }
  try {
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Автокредит анализ', amount: 120000, pay: 10000, day: 10, rate: 12 });
    UI.save(); UI.render();
    UI.openSummary({ view: 'chooser' });
    eq(document.querySelector('#smGoDyn .sm-card-s').textContent, 'расходы и доходы за год', 'подпись «Динамики»');
    ok(document.querySelector('#smGoDebt .ic-scales'), 'на «Капитал и обязательства» не весы');
    document.getElementById('smGoDebt').click();
    ok(body().indexOf('Каждый месяц - сколько было на его последний день. Текущий месяц - на сегодня.') >= 0, 'подвал «Капитала»');
    document.querySelector('#smDebtTabs [data-dv="load"]').click();
    var x = Engine.debtStats(UI.S).list.filter(function (r) { return r.id === d.id; })[0];
    var MP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
    var want = 'закроется в ' + MP[+x.until.slice(5, 7) - 1] + '\u00a0' + x.until.slice(0, 4);
    ok(body().indexOf(want) >= 0, 'нет «' + want + '»');
    ok(body().indexOf('Месяц закрытия - расчёт: если и дальше платить по графику с учётом ставки. Досрочные платежи его приблизят.') >= 0, 'подвал «Долгов»');
    // строка про кредитки - в подвале всегда, когда кредитки есть, и только тогда
    var cc = UI.S.wallets.filter(function (w) { return !w.hidden; })[0], cc0 = cc.credit === true;
    try {
      cc.credit = false; UI.S.wallets.forEach(function (w) { if (w.credit) w.__cc = true, w.credit = false; });
      UI.render();
      ok(document.querySelector('#smBody .ld-foot').textContent.indexOf('Кредитные карты') < 0, 'про кредитки без кредиток');
      cc.credit = true; UI.render();
      ok(document.querySelector('#smBody .ld-foot').textContent.indexOf('Кредитные карты в нагрузку не входят.') >= 0, 'нет строки про кредитки в подвале');
    } finally {
      cc.credit = cc0; UI.S.wallets.forEach(function (w) { if (w.__cc) { w.credit = true; delete w.__cc; } }); UI.render();
    }
    UI.closeSummary();

    // «Сводка»: доходы - оттенки одного зелёного по убыванию доли, расходы - без красного и оранжевого
    UI.openSummary({ view: 'summary' });
    function rgb(c) { var m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? [+m[1], +m[2], +m[3]] : null; }
    function hueOf(c) { var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn; if (!dd) return -1;
      var h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60; return h < 0 ? h + 360 : h; }
    function segs() { return [].map.call(document.querySelectorAll('#smBody .sm-bar i'), function (i) { return rgb(getComputedStyle(i).backgroundColor); }); }
    var ex = segs();
    ok(ex.length >= 2, 'в сводке расходов меньше двух долей');
    ex.forEach(function (c, i) { if (!c) return; var h = hueOf(c); ok(h < 0 || (h > 70 && h < 335), 'доля расходов ' + i + ' красная/оранжевая/жёлтая: ' + c.join(',')); });
    document.querySelector('#smKinds [data-kind="inc"]').click();
    var ic = segs().filter(function (c, i, a) { return c && !(i === a.length - 1 && /Прочее/.test(document.querySelector('#smBody .sm-leg').textContent)); });
    ok(ic.length >= 1, 'нет долей доходов');
    ic.forEach(function (c, i) { var h = hueOf(c); ok(h > 120 && h < 175, 'доля дохода ' + i + ' не зелёная: ' + c.join(',')); });
    for (var i = 1; i < ic.length; i++) ok(ic[i][0] + ic[i][1] + ic[i][2] >= ic[i - 1][0] + ic[i - 1][1] + ic[i - 1][2], 'доля дохода ' + i + ' не светлее предыдущей');
    var bar = document.querySelectorAll('#smBody .sm-bar i');
    if (bar.length > 1) eq(getComputedStyle(bar[1]).borderLeftWidth, '2px', 'нет зазора между долями');
    UI.closeSummary();

    // «Динамика»: вкладки «Расходы | Доходы», доходы зелёные, перевыполнение не красное
    UI.openSummary({ view: 'dyn' });
    var kinds = document.getElementById('smKinds');
    ok(kinds.getClientRects().length, 'в «Динамике» нет вкладок «Расходы | Доходы»');
    kinds.querySelector('[data-kind="inc"]').click();
    ok(document.querySelector('#smBody .dy-list.inc'), 'вкладка «Доходы» не показала доходы');
    var ys = parseInt(Engine.today().slice(0, 4), 10), tot = Engine.monthlyTotals(UI.S, ys, 'inc');
    var mi = +Engine.today().slice(5, 7) - 1;
    eq(document.querySelectorAll('#smBody .dy-row')[mi].querySelector('.dy-v').textContent, (tot[mi].fact > 0 ? Engine.fmt(tot[mi].fact) : '—') + '\u00a0₽', 'доход месяца на экране ≠ движку');
    // перевыполнение плана дохода текущего месяца - зелёное, не красное; цвет - зелёный и в
    // светлой теме (в тёмной акцент и зелёный совпадают, проверка там ничего бы не доказала)
    var ic0 = Engine.listCategories(UI.S, 'inc', { ymStr: Engine.ym(Engine.today()) })[0], ym0 = Engine.ym(Engine.today());
    var lim0 = Engine.catLimit(UI.S, ic0.id, ym0), th0 = UI.S.ui.theme;
    var tx0 = Engine.addTx(UI.S, { kind: 'inc', amount: 1000, catId: ic0.id, walletId: UI.S.wallets[0].id, date: Engine.today() });
    try {
      Engine.setLimit(UI.S, ym0, ic0.id, 1);
      UI.S.ui.theme = 'light';
      UI.render();
      var rowM = document.querySelectorAll('#smBody .dy-row')[mi];
      ok(Engine.monthlyTotals(UI.S, ys, 'inc')[mi].fact > Engine.monthlyTotals(UI.S, ys, 'inc')[mi].plan, 'план дохода не перевыполнен - проверка не про то');
      ok(!rowM.classList.contains('over'), 'перевыполнение плана дохода красным');
      var probe = document.createElement('i'); probe.style.color = 'var(--num-ok)'; document.body.appendChild(probe);
      var okC = getComputedStyle(probe).color; probe.parentNode.removeChild(probe);
      eq(getComputedStyle(rowM.querySelector('.dy-fact')).backgroundColor, okC, 'полоса дохода не зелёная (светлая тема)');
    } finally {
      Engine.setLimit(UI.S, ym0, ic0.id, lim0); Engine.deleteTx(UI.S, tx0.id);
      UI.S.ui.theme = th0;
      UI.render();
    }
    ok(/план/.test(document.querySelector('#smBody .dy-foot').textContent), 'в подвале доходов не «план»');
    UI.closeSummary();
  } finally { UI.hasFullAccess = h0; UI.closeSummary(); dropDebts(); }
});

// (14.10) аудит светлой темы: у кнопки фон не сливается с фоном вокруг, либо есть видимая
// грань или тень. Исключения - то, что кнопкой не выглядит намеренно: крестик-значок, ссылки,
// строки списков, неактивная вкладка внутри переключателя, клавиши кода, кнопка тоста.
add('светлая тема: кнопки не сливаются с фоном', function () {
  var th0 = UI.S.ui.theme, h0 = UI.hasFullAccess;
  var SKIP = /(^|\s)(sh-x|tbtn|ab-link|dy-row|sm-tab|lk-key|ph-btn|lk-link|sm-row|txfront|circle|hm-cell|pk-d|dg-d|amk)(\s|$)/;
  function rgba(c) { var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ''); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : [0, 0, 0, 0]; }
  function bgOf(el) {
    for (var e = el; e && e !== document.documentElement; e = e.parentElement) { var c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return c; }
    return rgba(getComputedStyle(document.body).backgroundColor);
  }
  function near(x, y) { return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 18; }
  function flat(where) {
    var bad = [];
    document.querySelectorAll('button, .btn').forEach(function (b) {
      if (SKIP.test(b.className)) return;
      var r = b.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) return;
      var cs = getComputedStyle(b);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) return;
      var top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      if (!top || !(top === b || b.contains(top))) return;
      // полупрозрачный фон кнопки - смешиваем с фоном вокруг (rgba(255,255,255,.2) на тёмной полосе виден)
      var own = rgba(cs.backgroundColor), around = bgOf(b.parentElement), k = own[3];
      var fill = [0, 1, 2].map(function (i) { return own[i] * k + around[i] * (1 - k); });
      var bc = rgba(cs.borderTopColor), edge = parseFloat(cs.borderTopWidth) > 0 && bc[3] > 0.15 && !near(bc, around);
      if (!near(fill, around) || edge || (cs.boxShadow && cs.boxShadow !== 'none') || (cs.backgroundImage && cs.backgroundImage !== 'none')) return;
      bad.push(where + ': ' + (b.id ? '#' + b.id : '.' + String(b.className).replace(/\s+/g, '.')) + ' «' + (b.textContent || '').trim().slice(0, 24) + '»');
    });
    return bad;
  }
  var bad = [], pv = panel ? panel.style.visibility : null;
  if (panel) panel.style.visibility = 'hidden';   // панель самопроверки накрыла бы кнопки (elementFromPoint)
  UI.hasFullAccess = function () { return true; };
  UI.S.ui.theme = 'light'; UI.render();
  try {
    bad = bad.concat(flat('главный'));
    UI.openCard({ kind: 'wallet', id: UI.S.wallets[0].id }); bad = bad.concat(flat('карточка кошелька')); UI.closeCard();
    UI.openCard({ kind: 'exp', id: UI.S.categories.exp[0].id }); bad = bad.concat(flat('карточка категории')); UI.closeCard();
    var mn = document.getElementById('menu'), mt = mn.style.transition;
    mn.style.transition = 'none';   // меню выезжает анимацией - без неё кнопки сразу на месте
    UI.openMenu(); void mn.offsetHeight; bad = bad.concat(flat('меню')); UI.closeMenu();
    mn.style.transition = mt;
    UI.openAmount({ kind: 'exp' }); bad = bad.concat(flat('экран суммы'));
    document.getElementById('amPick').click(); bad = bad.concat(flat('календарь')); Picker.close(); UI.closeAmount();
    ['chooser', 'summary', 'dyn', 'attn', 'heat', 'feed'].forEach(function (v) { UI.openSummary({ view: v }); bad = bad.concat(flat('аналитика ' + v)); UI.closeSummary(); });
    UI.editTx(UI.S.tx[0].id); bad = bad.concat(flat('правка операции'));
    document.getElementById('etWallet').click(); bad = bad.concat(flat('список кошельков')); Picker.close(); UI.closeDlg();
    Debts.addToStrip(); bad = bad.concat(flat('что добавить')); UI.closeDlg();
    Debts.addDebt('owed'); bad = bad.concat(flat('форма долга')); UI.closeDlg();
  } finally {
    if (window.Picker) Picker.close(); UI.closeDlg(); UI.closeAmount(); UI.closeMenu(); UI.closeCard(); UI.closeSummary();
    UI.hasFullAccess = h0; UI.S.ui.theme = th0; UI.render();
    if (panel) panel.style.visibility = pv;
  }
  eq(bad.join('; '), '', 'в светлой теме кнопки сливаются с фоном');
});

// (Д2) free: один долг; второй - замок на «Долг» и баннер покупки; созданное работает
add('долги: free - один долг, второй открывает баннер покупки', function () {
  var h0 = UI.hasFullAccess, p0 = UI.paywall, pw = 0;
  UI.hasFullAccess = function () { return false; };
  UI.paywall = function () { pw++; };
  try {
    dropDebts();
    Engine.addDebt(UI.S, { type: 'owed', name: 'Саша', amount: 1000, now: 0 });
    UI.save(); UI.render();
    UI.addToStrip();
    ok(document.querySelector('#dlgBody [data-add-what="owe"] .clr-lock'), 'на «Долг» нет замка');
    document.querySelector('#dlgBody [data-add-what="owe"]').click();
    eq(pw, 1, 'второй долг в free не ушёл в баннер покупки');
    eq(UI.S.debts.length, 1, 'второй долг всё-таки завёлся');
    UI.openCard({ kind: 'debt', id: UI.S.debts[0].id });
    ok(document.getElementById('dbPay'), 'созданный долг заблокирован в free');
    UI.closeCard();
  } finally { UI.hasFullAccess = h0; UI.paywall = p0; UI.closeDlg(); dropDebts(); }
});

// (Алексей 13.10) у готового кошелька баланс правится одной кнопкой «Изменить баланс» в карточке,
// в «Настроить» поля баланса нет (дубль); у нового кошелька поле есть
add('кошелёк: в «Настроить» нет поля баланса, у нового - есть', function () {
  var w = UI.S.wallets[0];
  UI.openCard({ kind: 'wallet', id: w.id });
  ok(document.getElementById('cardBase'), 'нет «Изменить баланс» в карточке');
  document.getElementById('cardSetup').click();
  ok(document.getElementById('ecName'), 'форма кошелька не открылась');
  ok(!document.getElementById('ecBase'), 'вернулся дубль: поле баланса в «Настроить»');
  UI.closeDlg(); UI.closeCard();
  UI.addWallet();
  ok(document.getElementById('awBase'), 'у нового кошелька пропало поле баланса');
  UI.closeDlg();
});

// (Алексей 14.10) «Зона внимания»: «+X ₽ сверх лимита», а не голое «сверх»
add('зона внимания: перерасход подписан «сверх лимита»', function () {
  var c = UI.S.categories.exp[0], ym = UI.curYM();
  var lim0 = Engine.catLimit(UI.S, c.id, ym), t = null;
  try {
    if (!(lim0 > 0)) Engine.setLimit(UI.S, ym, c.id, 100);
    var lim = Engine.catLimit(UI.S, c.id, ym);
    var need = Math.max(1, lim - Engine.catFact(UI.S, c.id, ym) + 500);
    t = Engine.addTx(UI.S, { kind: 'exp', amount: need, catId: c.id, walletId: UI.S.wallets[0].id, date: Engine.today() });
    UI.save(); UI.render();
    UI.openSummary({ view: 'attn' });
    var txt = document.getElementById('smBody').textContent;
    ok(/сверх лимита/.test(txt), 'нет «сверх лимита»: ' + txt.slice(0, 200));
  } finally {
    UI.closeSummary();
    if (t) Engine.deleteTx(UI.S, t.id);
    if (!(lim0 > 0)) Engine.setLimit(UI.S, ym, c.id, lim0 == null ? null : lim0);
    UI.save(); UI.render();
  }
});

// (Алексей 14.10) «+»-плитки в светлой теме - сплошная грань и тень, не бледный пунктир
add('светлая тема: «+»-плитки читаются как кнопки (грань и тень)', function () {
  var th = document.body.dataset.theme;
  try {
    document.body.dataset.theme = 'light';
    var els = document.querySelectorAll('.addtile-w, .add-ring');
    ok(els.length >= 2, 'нет «+»-плиток на главном');
    Array.prototype.forEach.call(els, function (e) {
      var c = getComputedStyle(e);
      ok(c.borderTopStyle === 'solid', e.className + ': грань ' + c.borderTopStyle);
      ok(c.boxShadow && c.boxShadow !== 'none', e.className + ': нет тени');
    });
  } finally { document.body.dataset.theme = th; }
});

// (Алексей 14.10) доход без плана - пустое кольцо; план задали после дохода - кольцо по доле
add('доход: без плана кольцо пустое, с планом - доля факта', function () {
  eq(UI.levelOf('inc', 38000, null).pct, 0, 'без плана кольцо залито');
  eq(UI.levelOf('inc', 38000, null).lvl, 'inc', 'без плана сумма не зелёная');
  var L = UI.levelOf('inc', 38000, 80000);
  ok(Math.abs(L.pct - 0.475) < 0.001 && L.lvl === 'warn', 'план после дохода: ' + JSON.stringify(L));
  eq(UI.levelOf('inc', 140000, 100000).pct, 1, 'перевыполнен - полное');
});

// (Алексей 14.10) выбрал вход по отпечатку - экран кода не обещает вводить код при каждом входе
add('защита входа: с отпечатком код - запасной вход, без него - вводить при входе', function () {
  try {
    AppLock._setupPin(false, true);
    var t1 = document.getElementById('dlgBody').textContent;
    ok(/запасной вход/.test(t1) && !/вводить при входе/.test(t1), 'с отпечатком: ' + t1);
    UI.closeDlg();
    AppLock._setupPin(false, false);
    var t2 = document.getElementById('dlgBody').textContent;
    ok(/вводить при входе/.test(t2) && !/запасной/.test(t2), 'без отпечатка: ' + t2);
  } finally { UI.closeDlg(); }
});

// (телефон 13.10) карточка открывается с начала списка: прокрутка прошлой карточки не
// наследуется, иначе самая свежая операция уезжает за верх и кажется пропавшей
add('карточка: новая карточка открывается с начала списка', function () {
  var w = UI.S.wallets[0];
  for (var i = 0; i < 30; i++) Engine.addTx(UI.S, { kind: 'exp', amount: 10, catId: UI.S.categories.exp[0].id, walletId: w.id, date: Engine.today() });
  try {
    UI.save(); UI.render();
    UI.openCard({ kind: 'wallet', id: w.id });
    var l = document.getElementById('cardList');
    l.scrollTop = 400;
    ok(l.scrollTop > 0, 'список карточки не прокручивается - тест ничего не проверит');
    UI.closeCard();
    // как на телефоне: карточка успела спрятаться (hidden), только потом открыта снова -
    // у скрытого списка прокрутка не сбрасывается, поэтому ждём дольше анимации закрытия
    return sleep(400).then(function () {
      ok(document.getElementById('card').hidden, 'карточка не спряталась - тест не про тот путь');
      UI.openCard({ kind: 'wallet', id: w.id });
      eq(document.getElementById('cardList').scrollTop, 0, 'карточка открылась прокрученной');
      UI.closeCard();
    }).then(cleanup, function (e) { cleanup(); throw e; });
  } catch (e) { cleanup(); throw e; }
  function cleanup() {
    UI.S.tx = UI.S.tx.filter(function (t) { return !(t.walletId === w.id && t.amount === 10 && t.date === Engine.today() && t.kind === 'exp'); });
    UI.save(); UI.render();
  }
});

// (Д3) платёж перетаскиванием: кошелёк на долг → экран суммы с ежемесячным платежом →
// «Подтвердить»: одна запись на весь платёж (проценты внутри, не расход - решение 13.10),
// кошелёк минус весь платёж, долг минус тело; «Отменить» убирает платёж
add('долги: платёж перетаскиванием - сумма = платёж, проценты раз в месяц, отмена целиком', function () {
  var hid = [];
  try {
    dropDebts();
    // на одной странице ленты: первый кошелёк и долг (остальные на время прячем)
    UI.S.wallets.forEach(function (w, i) { if (i > 0 && !w.hidden) { w.hidden = true; hid.push(w); } });
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит', amount: 120000, pay: 11000, day: 20, rate: 12, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    var w = circle('wallet', 0), dt = circle('debt', 0);
    ok(w && dt, 'нет плиток для жеста');
    var wid = w.dataset.id, wb0 = Engine.walletBalance(UI.S, wid), n0 = UI.S.tx.length;
    var spent0 = Engine.summary(UI.S, Engine.today().slice(0, 7)).spent;
    gesture(w, dt, 'mouse');
    ok(!document.getElementById('amount').hidden, 'экран суммы не открылся');
    eq(document.getElementById('amKind').textContent, 'Платёж по долгу', 'вид операции');
    eq(document.getElementById('amExpr').textContent.replace(/[₽\s]+$/, ''), '11' + Engine.NBSP + '000', 'сумма не подставлена платежом');
    ok(/проценты 1\u00a0200/.test(document.getElementById('amMini').textContent), 'нет разбивки на проценты: ' + document.getElementById('amMini').textContent);
    document.getElementById('amConfirm').click();
    ok(document.getElementById('amount').hidden, 'экран суммы не закрылся');
    eq(Engine.debtBalance(UI.S, d.id), 110200, 'остаток долга');
    eq(Engine.walletBalance(UI.S, wid), Math.round((wb0 - 11000) * 100) / 100, 'кошелёк');
    eq(UI.S.tx.length, n0 + 1, 'платёж - одна запись');
    var pt = UI.S.tx[UI.S.tx.length - 1];
    eq([pt.kind, pt.amount, pt.int].join('|'), 'debt|11000|1200', 'весь платёж, проценты внутри');
    ok(!UI.S.categories.exp.some(function (c) { return c.name === 'Проценты по долгам'; }), 'появилась категория «Проценты по долгам»');
    eq(Engine.summary(UI.S, Engine.ym(pt.date)).spent, spent0, 'проценты попали в «Потрачено»');
    ok(/Платёж по долгу/.test(document.getElementById('toastText').textContent), 'тост: ' + document.getElementById('toastText').textContent);
    ok(/1\u00a0200\u00a0000|110\u00a0200/.test(circle('debt', 0).querySelector('.cbal').textContent), 'плитка не обновилась');
    document.getElementById('toastBtn').click();   // «Отменить»
    eq(UI.S.tx.length, n0, '«Отменить» оставил половину платежа');
    eq(Engine.debtBalance(UI.S, d.id), 120000, 'остаток после отмены');
    // второй жест в обратную сторону: долг → кошелёк = «Берёте в долг»
    gesture(circle('debt', 0), circle('wallet', 0), 'mouse');
    eq(document.getElementById('amKind').textContent, 'Берёте в долг', 'взятие в долг');
    UI.closeAmount();
  } finally {
    hid.forEach(function (w) { w.hidden = false; });
    UI.closeAmount(); UI.hideToast(); dropDebts();
  }
});

// Баг 12.10 (телефон, тёмная тема): у строки истории долга пропадала вторая строка
// «дата · кошелёк · в счёт долга X ₽, проценты Y ₽» - тёмное правило «.txmeta {display:none}»
// перебивало .db-meta. Проверяем по настоящей раскладке в обеих темах.
add('долги: история - строка «дата · кошелёк · в счёт долга / проценты» видна в светлой и тёмной теме', function () {
  var was = document.body.dataset.theme;
  try {
    dropDebts();
    var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит тема', amount: 120000, pay: 11000, day: 20, rate: 12, now: 0, date: Engine.addMonths(Engine.today().slice(0, 7), -1) + '-01' });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 11000, date: Engine.today() });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    ok(UI.cardOpen(), 'карточка долга не открылась');
    ['light', 'dark'].forEach(function (th) {
      document.body.dataset.theme = th;
      var m = document.querySelector('#cardList .txmeta.db-meta');
      ok(m, th + ': нет строки истории');
      if (!m) return;
      var r = m.getBoundingClientRect();
      ok(getComputedStyle(m).display !== 'none' && r.height > 0 && r.width > 0, th + ': вторая строка истории спрятана');
      ok(/в счёт долга .*проценты /.test(m.textContent) && m.textContent.indexOf(w.name) >= 0, th + ': в строке нет кошелька/разбивки: ' + m.textContent);
    });
    // в тёмной теме строка «только дата» у обычных операций по-прежнему прячется (дата - колонкой .txd)
    UI.closeCard();
    UI.openCard({ kind: 'wallet', id: w.id });
    var plain = document.querySelector('#cardList .txmeta:not(.db-meta)');
    if (plain) {
      document.body.dataset.theme = 'dark';
      eq(getComputedStyle(plain).display, 'none', 'тёмная: дубль даты у операции кошелька виден');
      document.body.dataset.theme = 'light';
      ok(getComputedStyle(plain).display !== 'none', 'светлая: дата у операции кошелька спрятана');
    }
  } finally {
    document.body.dataset.theme = was;
    UI.closeCard(); dropDebts();
  }
});

// Решение 13.10: платёж со ставкой в карточке КОШЕЛЬКА - одна строка на весь платёж, под ней
// разбивка «в счёт долга X ₽, проценты Y ₽»; видна в обеих темах (в тёмной без даты - она колонкой)
add('долги: карточка кошелька - платёж одной суммой с разбивкой на проценты в обеих темах', function () {
  var was = document.body.dataset.theme;
  try {
    dropDebts();
    var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит кошелёк', amount: 120000, pay: 11000, day: 20, rate: 12, now: 0, date: Engine.addMonths(Engine.today().slice(0, 7), -1) + '-01' });
    var r = Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 11000, date: Engine.today() });
    UI.save(); UI.render();
    UI.openCard({ kind: 'wallet', id: w.id });
    var row = document.querySelector('#cardList .txrow[data-id="' + r.txs[0].id + '"]');
    ok(row, 'нет строки платежа в карточке кошелька');
    if (!row) return;
    ok(/11\u00a0000/.test(row.querySelector('.txa').textContent), 'сумма строки - не весь платёж: ' + row.querySelector('.txa').textContent);
    ['light', 'dark'].forEach(function (th) {
      document.body.dataset.theme = th;
      var m = row.querySelector('.tx-split');
      ok(m && getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 0, th + ': разбивка спрятана');
      ok(m && /в счёт долга 9\u00a0800\u00a0₽, проценты 1\u00a0200\u00a0₽/.test(m.textContent), th + ': разбивка: ' + (m && m.textContent));
    });
  } finally {
    document.body.dataset.theme = was;
    UI.closeCard(); dropDebts();
  }
});

// (Д4) карточка долга: было/осталось, полоска, история, правка остатка, «Долг погашен»
add('долги: карточка - было/осталось, история, «Поправить остаток», погашен → архив', function () {
  try {
    dropDebts();
    var w = UI.S.wallets[0];
    // заведён в прошлом месяце после даты платежа: первый срок - этот месяц, платёж сегодня его закрывает
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Рассрочка', amount: 20000, pay: 5000, day: 10, now: 0, date: Engine.addMonths(Engine.today().slice(0, 7), -1) + '-15' });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 5000, date: Engine.today() });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    ok(UI.cardOpen(), 'карточка долга не открылась');
    eq(document.getElementById('cardTitle').textContent, 'Рассрочка', 'заголовок');
    eq(document.getElementById('cardAmt').textContent, '15' + Engine.NBSP + '000' + Engine.NBSP + '₽', 'осталось');
    var acts = document.getElementById('cardActs').textContent;
    ok(/было 20\u00a0000/.test(acts) && /выплачено 25\u00a0%/.test(acts), 'было/выплачено: ' + acts);
    ok(/записан/.test(acts), 'статус оплаченного месяца: ' + acts);
    ok(document.querySelector('#cardList .txrow'), 'нет истории платежей');
    ok(document.getElementById('dbRemind'), 'нет тумблера напоминания');
    eq(document.querySelector('#dbRemind .set-s').textContent, 'Накануне и в день платежа. В\u00a010:00', 'подпись напоминания: «В» оторвалось от «10:00»');
    // остаток правится в «Настроить» (отдельной «Поправить остаток» нет - Алексей 13.10), ноль → предложение архива
    ok(!document.getElementById('dbBase'), 'вернулась кнопка-дубль «Поправить остаток»');
    document.getElementById('dbSetup').click();
    eq(document.getElementById('dlgTitle').textContent, 'Я должен', 'окно настройки');
    document.getElementById('deAmount').value = '0';
    document.getElementById('dlgBtns').lastChild.click();
    UI.closeDlg();
    eq(Engine.debtBalance(UI.S, d.id), 0, 'остаток не поправился');
    ok(document.getElementById('dbArchive'), 'при нуле нет «Долг погашен»');
    document.getElementById('dbArchive').click();
    ok(d.archived, 'не ушёл в архив');
    ok(!circle('debt', 0), 'архивный долг остался на главном');
    // в «Настроить кошельки» он - в «Погашенные»
    UI.openWallets();
    ok(/Погашенные \(1\)/.test(document.getElementById('dlgBody').textContent), 'нет группы погашенных');
    UI.closeDlg();
  } finally { UI.closeCard(); UI.closeDlg(); dropDebts(); }
});

// (Д5) баннер просрочки: на следующий день после даты без платежа (дата подменена),
// текст из концепции, кнопки, один на долг на месяц. «Записать платёж» → «Отмена» баннер не
// гасит (ревью 12.10), гасит запись платежа или «×».
add('долги: баннер просрочки - текст, кнопки, отмена не гасит, запись гасит, один на долг на месяц', function () {
  try {
    dropDebts();
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Ипотека', amount: 900000, pay: 30000, day: 5, now: 0, date: '2026-02-10' });
    UI.save(); UI.render(); Debts.hideWarn();
    ok(Debts.checkWarn('2026-03-06'), 'баннер не показался на следующий день после даты');
    var el = document.getElementById('debtWarn');
    ok(!el.hidden, 'баннер скрыт');
    eq(document.getElementById('dwText').textContent,
      'По «Ипотека» нет платежа за март. Если уже заплатили - запишите платёж. Если пропустили - банк начислит пени и проценты за просрочку: проверьте остаток долга в приложении банка и поправьте его кнопкой «Поправить остаток».', 'текст');
    eq(document.getElementById('dwPay').textContent, 'Записать платёж', 'кнопка платежа');
    eq(document.getElementById('dwFix').textContent, 'Поправить остаток', 'кнопка правки');
    ok(document.getElementById('fabAdd').hidden, 'при баннере виден «плюс»');
    ok(!Nudges.checkRemind({ demo: false, txCount: 50 }), 'карточка копии поверх баннера');
    // передумали: «Записать платёж» → «Отмена» - баннер на месте и не запомнен закрытым
    document.getElementById('dwPay').click();
    eq(document.getElementById('dlgTitle').textContent, 'С какого кошелька платёж?', '«Записать платёж» не спросил кошелёк (14.10)');
    UI.closeDlg();
    ok(!el.hidden, '«Отмена» выбора кошелька погасила баннер');
    document.getElementById('dwPay').click();
    document.querySelector('#dbWl [data-wid]').click();
    ok(!document.getElementById('amount').hidden && document.getElementById('amKind').textContent === 'Платёж по долгу', '«Записать платёж» не открыл платёж');
    UI.closeAmount();
    ok(!el.hidden, '«Отмена» на экране суммы погасила баннер');
    ok(!UI.S.ui.debtWarn[d.id + '|2026-03'], '«Отмена» запомнила баннер закрытым');
    ok(Debts.checkWarn('2026-03-06'), 'после «Отмены» баннер не вернулся');
    // «Поправить остаток» → «Отмена» - тоже на месте
    document.getElementById('dwFix').click();
    eq(document.getElementById('dlgTitle').textContent, 'Поправить остаток', 'окно правки');
    UI.closeDlg();
    ok(!el.hidden && !UI.S.ui.debtWarn[d.id + '|2026-03'], '«Отмена» правки погасила баннер');
    // записали платёж из баннера (кошелёк выбран в окне выбора) - баннер гаснет и запомнен
    document.getElementById('dwPay').click();
    var tile = document.querySelector('#dbWl [data-wid]');
    ok(tile, 'нет выбора кошелька');
    tile.click();
    ok(!document.getElementById('amConfirm').disabled, 'кошелёк не выбрался');
    document.getElementById('amConfirm').click();
    UI.closeDlg();
    // платёж записан сегодня: мартовский баннер погашен (по настоящей дате может всплыть баннер
    // о следующих пропусках - это уже другой месяц)
    ok(el.hidden || !/за март/.test(document.getElementById('dwText').textContent), 'после записи платежа баннер про март остался');
    Debts.hideWarn();
    ok(UI.S.ui.debtWarn[d.id + '|2026-03'], 'не запомнили, что закрыли');
    ok(!Debts.checkWarn('2026-03-20'), 'в том же месяце показали снова');
    // апрель: срок 5-го прошёл без платежа - новый баннер; в сам день платежа - ещё нет
    ok(!Debts.checkWarn('2026-04-05'), 'в день платежа - уже просрочка');
    ok(Debts.checkWarn('2026-04-06'), 'в следующем месяце - снова');
    ok(/нет платежа за апрель/.test(document.getElementById('dwText').textContent), 'текст апреля: ' + document.getElementById('dwText').textContent);
    // два пропуска подряд - оба месяца в тексте
    ok(Debts.checkWarn('2026-05-06'), 'май: баннер');
    ok(/нет платежей за апрель и май/.test(document.getElementById('dwText').textContent), 'два пропуска: ' + document.getElementById('dwText').textContent);
    document.getElementById('dwClose').click();
    ok(el.hidden, '«×» не закрыл');
    ok(UI.S.ui.debtWarn[d.id + '|2026-05'], '«×» не запомнил');
    ok(el.textContent.indexOf('—') < 0, 'длинное тире');
  } finally { UI.closeAmount(); UI.closeDlg(); UI.hideToast(); dropDebts(); }
});

// (Д6) аналитика: «Капитал и обязательства» - одна карточка (видна только при долгах), в free -
// замок и баннер; внутри вкладки «Капитал | Нагрузка» (30% - ещё не красный, 30,4 % - с одним
// знаком и красный, месяц без доходов)
add('долги: аналитика - «Капитал и обязательства» только при долгах, замок в free, капитал и нагрузка вкладками', function () {
  var h0 = UI.hasFullAccess, p0 = UI.paywall, pw = 0;
  try {
    dropDebts();
    UI.hasFullAccess = function () { return false; };
    UI.paywall = function () { pw++; };
    UI.openSummary({ view: 'chooser' });
    ok(!document.getElementById('smGoCap') && !document.getElementById('smGoLoad'), 'остались две отдельные карточки');
    ok(document.getElementById('smGoDebt').hidden, '«Капитал и обязательства» видна без долгов');
    UI.closeSummary();
    var ym = UI.curYM();
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит', amount: 500000, pay: 1, day: 10, now: 0, date: ym + '-01' });
    UI.save(); UI.render();
    UI.openSummary({ view: 'chooser' });
    var card = document.getElementById('smGoDebt');
    ok(!card.hidden, '«Капитал и обязательства» не видна при долге');
    eq(card.querySelector('.sm-card-n').textContent, 'Капитал и обязательства', 'название карточки');
    ok(document.getElementById('summary').classList.contains('sm-free'), 'нет замков в free');
    card.click();
    eq(pw, 1, '«Капитал и обязательства» в free не открыла баннер');
    eq(UI.summaryView(), 'chooser', 'экран открылся без доступа');
    UI.closeSummary();
    UI.hasFullAccess = function () { return true; };
    var inc = Engine.summary(UI.S, ym).earned;
    UI.openSummary({ view: 'chooser' });
    document.getElementById('smGoDebt').click();
    eq(UI.summaryView(), 'cap', 'карточка открыла не капитал');
    var tabs = document.getElementById('smDebtTabs');
    ok(tabs.getClientRects().length, 'нет вкладок «Капитал | Долги»');
    eq(tabs.querySelector('.sm-tab.on').textContent, 'Капитал', 'вкладка');
    var cap = Engine.netCapital(UI.S, ym);
    ok(/я должен/.test(document.getElementById('smBody').textContent), 'нет «я должен» в капитале');
    ok(document.querySelector('#smBody .sm-big').textContent.replace(/\D/g, '') === String(Math.round(Math.abs(cap.net))), 'капитал на экране ≠ движку: ' + document.querySelector('#smBody .sm-big').textContent);
    tabs.querySelector('[data-dv="load"]').click();
    eq(UI.summaryView(), 'load', 'вкладка «Долги» не переключила');
    eq(tabs.querySelector('.sm-tab.on').textContent, 'Долги', 'активная вкладка');
    // (13.10) сверху - сколько должен сейчас, как в движке; ниже по долгу - остаток и прогноз погашения
    var DS = Engine.debtStats(UI.S);
    eq(document.querySelector('#smBody .sm-big').textContent, Engine.fmt(DS.total) + Engine.NBSP + '₽', '«должен сейчас» на экране ≠ движку');
    ok(DS.total > 0 && /общая сумма всех долгов/.test(document.getElementById('smBody').textContent), 'нет подписи «общая сумма всех долгов»');
    ok(document.querySelector('#smBody .ld-row .ld-s') && /закроется в (январе|феврале|марте|апреле|мае|июне|июле|августе|сентябре|октябре|ноябре|декабре)\u00a0\d{4}|не покрывает проценты/.test(document.querySelector('#smBody .ld-row .ld-s').textContent), 'нет «закроется в <месяце> <год>»: ' + document.querySelector('#smBody .ld-row .ld-s').textContent);
    ok(inc > 0, 'в демо нет доходов месяца');
    Engine.updateDebt(UI.S, d.id, { pay: Math.round(inc * 0.3) });   // ровно 30% - ещё не красный
    UI.render();
    eq(document.querySelector('#smBody .ld-load b').textContent, '30' + Engine.NBSP + '%', 'нагрузка');
    ok(!document.querySelector('#smBody .ld-warn'), 'ровно 30% - уже красный баннер');
    // 30,4 % - показываем с одним знаком, порог - по показанному числу
    Engine.updateDebt(UI.S, d.id, { pay: Math.round(inc * 0.304) });
    UI.render();
    var L = Engine.debtLoad(UI.S, ym);
    eq(document.querySelector('#smBody .ld-load b').textContent, String(L.pct).replace('.', ',') + Engine.NBSP + '%', 'нагрузка с одним знаком');
    ok(L.pct > 30 && L.pct < 31 && /,/.test(document.querySelector('#smBody .ld-load b').textContent), 'не 30,x %: ' + document.querySelector('#smBody .ld-load b').textContent);
    ok(document.querySelector('#smBody .ld-warn') && /высокий риск просрочек/.test(document.querySelector('#smBody .ld-warn').textContent), 'нет красного баннера выше 30%');
    // месяц без доходов
    var next = Engine.addMonths(ym, 1);
    document.getElementById('smNext').click();
    eq(UI.S.debts.length, 1, 'долг пропал');
    ok(/доходов в этом месяце нет/.test(document.getElementById('smBody').textContent) || Engine.debtLoad(UI.S, next).ratio !== null, 'месяц без доходов: ' + document.getElementById('smBody').textContent);
    UI.closeSummary();
  } finally { UI.hasFullAccess = h0; UI.paywall = p0; UI.closeSummary(); UI.closeDlg(); dropDebts(); }
});

// (Д7) напоминание: тумблер в карточке, разрешение спрашивается при первом включении
// (плагин подменён), отказ - своё окно; план уходит в плагин без сумм; проверка - только тест-сборка
add('долги: напоминание - разрешение, отказ, план в плагин без сумм', function () {
  var calls = [], grant = false, ask = 0;
  var fake = {
    checkPermission: function () { calls.push('check'); return Promise.resolve({ granted: grant }); },
    requestPermission: function () { ask++; return Promise.resolve({ granted: grant }); },
    schedule: function (o) { calls.push(o); return Promise.resolve({ ok: true, count: o.events.length }); },
    openSettings: function () { calls.push('settings'); return Promise.resolve({ ok: true }); },
    test: function (o) { calls.push(o); return Promise.resolve({ ok: true }); }
  };
  Debts._plugin(fake);
  dropDebts();
  var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Ипотека', amount: 900000, pay: 30000, day: 15, now: 0, date: '2026-01-01' });
  UI.save(); UI.render();
  UI.openCard({ kind: 'debt', id: d.id });
  return Debts.toggleRemind(d.id).then(function (on) {
    ok(!on && !d.remind, 'отказ - тумблер включился');
    eq(ask, 1, 'разрешение не спросили');
    eq(document.getElementById('dlgTitle').textContent, 'Уведомления выключены', 'нет окна отказа');
    ok(/без сумм/.test(document.getElementById('dlgBody').textContent), 'в окне не сказано про приватность');
    document.getElementById('dlgBtns').lastChild.click();   // «Открыть настройки»
    ok(calls.indexOf('settings') >= 0, 'настройки не открылись');
    grant = true;
    return Debts.toggleRemind(d.id);
  }).then(function (on) {
    ok(on && d.remind, 'после разрешения тумблер не включился');
    return sleep(50);
  }).then(function () {
    var sch = calls.filter(function (c) { return c && c.events; });
    ok(sch.length >= 1, 'план не ушёл в плагин');
    var ev = sch[sch.length - 1].events;
    ok(ev.length >= 2 && ev.length <= 24, 'событий в плане: ' + ev.length);
    ok(ev.every(function (e) { return /«Ипотека»/.test(e.title) && !/\d/.test(e.title + e.text) && e.at > Date.now(); }), 'в уведомлении суммы или прошлое: ' + JSON.stringify(ev[0]));
    eq(new Date(ev[0].at).getHours(), Engine.REMIND_HOUR, 'не в 10:00');
    ok(document.getElementById('dbRemind').getAttribute('aria-pressed') === 'true', 'тумблер в карточке не «вкл»');
    ok(document.getElementById('dbTest'), 'в тест-сборке нет кнопки проверки');
    return Debts.testReminder(d.id);
  }).then(function (r) {
    ok(r && calls.some(function (c) { return c && c.delaySec && c.kind === 'debt'; }), 'проверка не дошла до плагина (или без kind debt)');
    return Debts.toggleRemind(d.id);
  }).then(function () {
    ok(!d.remind, 'не выключилось');
    return sleep(50);
  }).then(function () {
    var sch = calls.filter(function (c) { return c && c.events; });
    eq(sch[sch.length - 1].events.length, 0, 'после выключения план не очищен');
    Debts._plugin(null); UI.closeDlg(); UI.closeCard(); dropDebts();
  }, function (e) { Debts._plugin(null); UI.closeDlg(); UI.closeCard(); dropDebts(); throw e; });
});

// (Д8) разрешение на уведомления сняли (или копия с другого телефона принесла долг с
// включённым напоминанием): план вслепую не ставится, тумблер честно выключен с «Открыть
// настройки», мягкое окно - один раз; дали разрешение - план уходит, тумблер включён.
add('долги: нет разрешения на уведомления - план не ставится, тумблер честный, окно один раз (и после восстановления)', function () {
  var calls = [], granted = false;
  var fake = {
    checkPermission: function () { calls.push('check'); return Promise.resolve({ granted: granted }); },
    requestPermission: function () { calls.push('request'); return Promise.resolve({ granted: granted }); },
    schedule: function (o) { calls.push(o); return Promise.resolve({ ok: true, count: o.events.length }); },
    openSettings: function () { calls.push('settings'); return Promise.resolve({ ok: true }); },
    test: function () { return Promise.resolve({ ok: true }); }
  };
  function sched() { return calls.filter(function (c) { return c && c.events; }); }
  function done() { Debts._plugin(null); UI.closeDlg(); UI.closeCard(); dropDebts(); }
  dropDebts();
  UI.S.ui.remindDenied = false;
  UI.save();
  Debts._plugin(fake);
  // копия со старого телефона: долг с включённым напоминанием
  var st = JSON.parse(JSON.stringify(UI.S));
  st.debts = [{ id: 'dold', name: 'Ипотека', type: 'owe', base: 1000000, baseTs: 0, start: 1000000, pay: 30000, day: 20, remind: true, createdDate: '2026-01-01' }];
  Backup.restoreText(Engine.exportJSON(st));
  return sleep(300).then(function () {
    var b = document.getElementById('dlgBtns').querySelectorAll('button');
    b[b.length - 1].click();   // «Заменить»
    return sleep(1200);
  }).then(function () {
    ok(Engine.findDebt(UI.S, 'dold'), 'копия не восстановилась');
    // окно восстановления (или тост) могло занять экран - тогда мягкое окно на следующей проверке
    if (document.getElementById('dlgTitle').textContent !== 'Напоминания не придут') { UI.closeDlg(); return Debts.syncReminders(true).then(function () { return sleep(50); }); }
  }).then(function () {
    ok(calls.indexOf('check') >= 0, 'разрешение не проверили');
    ok(sched().length >= 1 && sched().every(function (c) { return c.events.length === 0; }), 'план ушёл в телефон без разрешения: ' + JSON.stringify(sched().map(function (c) { return c.events.length; })));
    eq(document.getElementById('dlgTitle').textContent, 'Напоминания не придут', 'нет мягкого окна');
    ok(/запрещены в настройках телефона/.test(document.getElementById('dlgBody').textContent), 'текст окна');
    ok(UI.S.ui.remindDenied === true, 'не запомнили, что окно показали');
    UI.closeDlg();
    UI.openCard({ kind: 'debt', id: 'dold' });
    var sw = document.getElementById('dbRemind');
    eq(sw.getAttribute('aria-pressed'), 'false', 'тумблер «вкл» при запрещённых уведомлениях');
    ok(!sw.querySelector('.mi-sw').classList.contains('on'), 'переключатель нарисован включённым');
    ok(/уведомления запрещены в настройках телефона/.test(sw.textContent), 'нет подписи про запрет: ' + sw.textContent);
    ok(!document.getElementById('dbTest'), 'проверка напоминания при запрете');
    document.getElementById('dbPerm').click();
    ok(calls.indexOf('settings') >= 0, '«Открыть настройки» не открыло настройки');
    return Debts.syncReminders(true);
  }).then(function () {
    return sleep(50);
  }).then(function () {
    ok(document.getElementById('dlg').hidden, 'мягкое окно показали второй раз');
    // разрешение дали в настройках - возврат в приложение: план уходит, тумблер включён
    granted = true;
    return Debts.syncReminders(true);
  }).then(function () {
    return sleep(50);
  }).then(function () {
    var last = sched()[sched().length - 1];
    ok(last && last.events.length > 0, 'с разрешением план не ушёл');
    eq(document.getElementById('dbRemind').getAttribute('aria-pressed'), 'true', 'тумблер не включился');
    ok(UI.S.ui.remindDenied === false, 'флаг окна не сброшен');
    done();
  }, function (e) { done(); throw e; });
});

// (Д9) кошелёк, с которого платили по долгам, не удаляется: окно с «Скрыть кошелёк»
add('долги: кошелёк с платежами по долгам - удалить нельзя, «Скрыть кошелёк», история цела', function () {
  var w2 = null;
  try {
    dropDebts();
    w2 = Engine.addWallet(UI.S, { name: 'Старая карта', base: 50000 });
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит', amount: 120000, pay: 20000, day: 10, rate: 12, now: 0, date: '2026-01-01' });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w2.id, amount: 20000, date: Engine.today() });
    UI.save(); UI.render();
    var n0 = UI.S.tx.length, bal0 = Engine.debtBalance(UI.S, d.id), h0 = Engine.debtHistory(UI.S, d.id).length;
    UI.deleteWallet(w2.id, false);
    eq(document.getElementById('dlgTitle').textContent, 'Удалить нельзя', 'окно');
    ok(/платили по долгам/.test(document.getElementById('dlgBody').textContent), 'текст: ' + document.getElementById('dlgBody').textContent);
    var btns = document.getElementById('dlgBtns').querySelectorAll('button');
    eq(btns[btns.length - 1].textContent, 'Скрыть кошелёк', 'кнопка');
    btns[btns.length - 1].click();
    ok(Engine.findWallet(UI.S, w2.id) && Engine.findWallet(UI.S, w2.id).hidden, 'кошелёк не скрыт');
    eq(UI.S.tx.length, n0, 'операции пропали');
    eq(Engine.debtBalance(UI.S, d.id), bal0, 'остаток долга');
    eq(Engine.debtHistory(UI.S, d.id).length, h0, 'история долга');
    UI.deleteWallet(w2.id, false);
    ok(/уже скрыт/.test(document.getElementById('dlgBody').textContent), 'скрытый: ' + document.getElementById('dlgBody').textContent);
    ok(Engine.findWallet(UI.S, w2.id), 'скрытый кошелёк удалился');
    UI.closeDlg();
  } finally {
    UI.closeDlg(); UI.hideToast(); dropDebts();
    if (w2) { try { Engine.deleteWallet(UI.S, w2.id); } catch (e) {} }
    UI.save(); UI.render();
  }
});

// (Д10) правка платежа: переплата долга - то же окно «Не сохранилось», что у записи; дата
// раньше заведения долга - отказ; «Понятно» возвращает форму с введённым
add('долги: правка платежа - переплата и дата до заведения не проходят, форма возвращается', function () {
  try {
    dropDebts();
    var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Друг', amount: 5000, pay: 5000, day: 5, now: 0, date: '2026-01-01' });
    var r = Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 3000, date: Engine.today() });
    UI.save(); UI.render();
    UI.editTx(r.txs[0].id);
    eq(document.getElementById('etAmount').value, Engine.fmt(3000), 'сумма платежа');
    document.getElementById('etAmount').value = '50000';
    document.getElementById('dlgBtns').lastChild.click();
    eq(Engine.debtBalance(UI.S, d.id), 2000, 'переплата записалась');
    eq(document.getElementById('dlgTitle').textContent, 'Не сохранилось', 'нет окна отказа');
    ok(/больше, чем осталось по долгу: 5\u00a0000/.test(document.getElementById('dlgBody').textContent), 'текст: ' + document.getElementById('dlgBody').textContent);
    document.getElementById('dlgBtns').lastChild.click();   // «Понятно»
    eq(document.getElementById('dlgTitle').textContent, 'Операция', 'форма не вернулась');
    eq(document.getElementById('etAmount').value, '50000', 'введённое пропало');
    document.getElementById('etAmount').value = '3000';
    document.getElementById('etDate').value = '2025-12-20';
    document.getElementById('dlgBtns').lastChild.click();
    eq(document.getElementById('dlgTitle').textContent, 'Не сохранилось', 'дата до заведения прошла');
    ok(/Долг заведён 01\.01 - более ранние платежи уже учтены в остатке/.test(document.getElementById('dlgBody').textContent), 'текст: ' + document.getElementById('dlgBody').textContent);
    ok(UI.S.tx.every(function (t) { return t.date !== '2025-12-20'; }), 'дата записалась');
    document.getElementById('dlgBtns').lastChild.click();
    document.getElementById('etAmount').value = '5000';
    document.getElementById('etDate').value = Engine.today();
    document.getElementById('dlgBtns').lastChild.click();
    eq(Engine.debtBalance(UI.S, d.id), 0, 'правка не сохранилась');
  } finally { UI.closeDlg(); UI.hideToast(); dropDebts(); }
});

// (Д11) подсказка «Потяните строку…» в карточке долга - в списке над «Историей», строку
// напоминания не закрывает; в карточке кошелька - снова на своём месте под списком
add('долги: подсказка про свайп в карточке долга не закрывает напоминание и возвращается на место', function () {
  var hd = UI.S.ui.hintsDismissed && UI.S.ui.hintsDismissed.cardSwipe, hon = UI.S.ui.hints;
  try {
    dropDebts();
    UI.S.ui.hints = true;
    if (UI.S.ui.hintsDismissed) delete UI.S.ui.hintsDismissed.cardSwipe;
    var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Ипотека', amount: 900000, pay: 30000, day: 15, now: 0, date: '2026-01-01' });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 30000, date: Engine.today() });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    var h = document.getElementById('cardHint'), list = document.getElementById('cardList');
    ok(!h.hidden, 'подсказка не показана');
    ok(list.contains(h), 'подсказка не в списке');
    ok(h.nextElementSibling && h.nextElementSibling.classList.contains('db-hh'), 'подсказка не над «Историей»');
    var a = h.getBoundingClientRect(), b = document.getElementById('dbRemind').getBoundingClientRect();
    ok(a.top >= b.bottom - 0.5, 'подсказка наезжает на напоминание: ' + Math.round(a.top) + ' < ' + Math.round(b.bottom));
    UI.renderCard();   // перерисовка не съедает узел подсказки
    ok(document.getElementById('cardHint') && list.contains(document.getElementById('cardHint')), 'перерисовка потеряла подсказку');
    UI.closeCard();
    UI.openCard({ kind: 'wallet', id: w.id });
    ok(!list.contains(h) && h.previousElementSibling === list && !h.classList.contains('sh-hint-in'), 'подсказка не вернулась на место');
    UI.closeCard();
  } finally {
    UI.closeCard();
    UI.S.ui.hints = hon;
    if (hd) UI.S.ui.hintsDismissed.cardSwipe = true;
    dropDebts();
  }
});

// (Д12) баг 12.10 (был и в 1.0.3): «+» → «Перевод» → выбрали «откуда» с длинным названием -
// фишка «куда» уезжала за край строки и обрезалась до «…», тап не открывал выбор. Теперь обе
// фишки видны целиком, «куда» открывает выбор кошелька, «Подтвердить» - только с обоими концами.
add('«+» → «Перевод»: фишка «куда» видна и нажимается, перевод записывается', function () {
  var w1 = null, w2 = null;
  try {
    w1 = Engine.addWallet(UI.S, { name: 'Накопления на отпуск и ремонт квартиры', base: 5000 });
    w2 = Engine.addWallet(UI.S, { name: 'Карта для повседневных расходов', base: 0 });
    UI.save(); UI.render();
    document.getElementById('fabAdd').hidden = false;
    document.getElementById('fabAdd').click();
    document.querySelector('#dlgBody [data-add-op="transfer"]').click();
    ok(!document.getElementById('amount').hidden, 'экран суммы не открылся');
    document.querySelector('#amFrom .am-pick').click();
    document.querySelector('#dlgBody .wtile[data-id="' + w1.id + '"]').click();
    // на телефоне стрелка «→» рисуется запасным шрифтом шире, чем в Edge, и две фишки по 42%
    // + стрелка не помещались: «куда» целиком заменялась на «…». Имитируем широкую стрелку.
    document.querySelector('.am-path .am-arrow').style.padding = '0 24px';
    var path = document.querySelector('.am-path').getBoundingClientRect();
    var to = document.querySelector('#amTo .am-pick'), r = to.getBoundingClientRect();
    ok(to.classList.contains('empty'), '«куда» не пустая');
    ok(r.width >= 40 && r.left >= path.left - 0.5 && r.right <= path.right + 0.5, '«куда» не видна целиком: ' + Math.round(r.left) + '..' + Math.round(r.right) + ' при ' + Math.round(path.left) + '..' + Math.round(path.right));
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    ok(hit && to.contains(hit), 'на месте «куда» другой элемент');
    document.querySelector('#amKeys .amk[data-k="5"]').click();
    ok(document.getElementById('amConfirm').disabled, '«Подтвердить» активна без «куда»');
    hit.click();
    eq(document.getElementById('dlgTitle').textContent, 'Выберите кошелёк', 'тап по «куда» не открыл выбор');
    document.querySelector('#dlgBody .wtile[data-id="' + w2.id + '"]').click();
    ok(/Карта для повседневных/.test(document.querySelector('#amTo .am-pick').textContent), '«куда» не выбралась');
    var n0 = UI.S.tx.length;
    ok(!document.getElementById('amConfirm').disabled, '«Подтвердить» неактивна с обоими концами и суммой');
    document.getElementById('amConfirm').click();
    var t = UI.S.tx[UI.S.tx.length - 1];
    ok(UI.S.tx.length === n0 + 1 && t.kind === 'transfer' && t.walletId === w1.id && t.toWalletId === w2.id, 'перевод не записан');
  } finally {
    document.querySelector('.am-path .am-arrow').style.padding = '';
    UI.closeAmount(); UI.closeDlg(); UI.hideToast();
    [w1, w2].forEach(function (w) { if (w) { try { Engine.deleteWallet(UI.S, w.id); } catch (e) {} } });
    UI.save(); UI.render();
  }
});

// (Д13) тап по уведомлению-напоминанию (событие подменено плагином): окно платежа по ЭТОМУ
// долгу - сумма = ежемесячный платёж, «откуда» = кошелёк последнего платежа; срок уже закрыт -
// карточка долга; «Защита входа» - сначала замок; «мне должны» - окно «Мне вернули».
add('долги: тап по напоминанию - платёж по этому долгу, после платежа - карточка, замок раньше', function () {
  var tap = null, lk = window.AppLock, lk0 = lk && lk.isLocked, isLk = false;
  var fake = {
    takeTap: function () { var r = tap || {}; tap = null; return Promise.resolve(r); },
    checkPermission: function () { return Promise.resolve({ granted: true }); },
    schedule: function () { return Promise.resolve({ ok: true }); }
  };
  function done() { Debts._plugin(null); if (lk) lk.isLocked = lk0; UI.closeAmount(); UI.closeCard(); UI.closeDlg(); UI.hideToast(); dropDebts(); }
  dropDebts();
  var ws = UI.S.wallets.filter(function (x) { return !x.hidden; });
  var w = ws[ws.length - 1];
  var cur = Engine.today().slice(0, 7), prev = Engine.addMonths(cur, -1);
  var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит тап', amount: 100000, pay: 7000, day: 28, now: 0, date: Engine.addMonths(cur, -2) + '-01' });
  Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 7000, date: Engine.addMonths(cur, -2) + '-28' });
  Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 7000, date: prev + '-28' });
  UI.save(); UI.render();
  Debts._plugin(fake);
  if (lk) lk.isLocked = function () { return isLk; };
  tap = { debtId: d.id, due: cur + '-28' };
  return Debts.checkTap().then(function (r) {
    eq(r, 'pay', 'тап открыл не платёж');
    // 14.10: сначала окно выбора кошелька, кошелёк последнего платежа - первым, но не выбран сам
    ok(document.getElementById('amount').hidden, 'тап открыл экран суммы без выбора кошелька');
    eq(document.getElementById('dlgTitle').textContent, 'С какого кошелька платёж?', 'тап не спросил кошелёк');
    var first = document.querySelector('#dbWl [data-wid]');
    eq(first.getAttribute('data-wid'), w.id, 'кошелёк последнего платежа не первым');
    ok(/в прошлый раз/.test(first.textContent), 'нет пометки «в прошлый раз»');
    first.click();
    ok(!document.getElementById('amount').hidden, 'экран суммы не открылся');
    eq(document.getElementById('amKind').textContent, 'Платёж по долгу', 'вид операции');
    eq(document.querySelector('#amFrom .am-pick').textContent, w.name, '«откуда» - не выбранный кошелёк');
    ok(/Кредит тап/.test(document.querySelector('#amTo .am-pick').textContent), '«куда» - не этот долг');
    eq(document.getElementById('amExpr').textContent.replace(/[₽\s]+$/, ''), '7' + Engine.NBSP + '000', 'сумма не подставлена');
    ok(!document.getElementById('amConfirm').disabled, '«Подтвердить» неактивна');
    document.getElementById('amConfirm').click();
    UI.hideToast();
    // срок этого месяца закрыт - тот же тап открывает карточку долга
    tap = { debtId: d.id, due: cur + '-28' };
    return Debts.checkTap();
  }).then(function (r) {
    eq(r, 'card', 'после платежа тап открыл не карточку');
    ok(UI.cardOpen() && document.getElementById('cardTitle').textContent === 'Кредит тап', 'карточка не открылась');
    UI.closeCard();
    // замок: пока заперто - ничего, после разблокировки - окно платежа
    isLk = true;
    tap = { debtId: d.id, due: Engine.addMonths(cur, 1) + '-28' };
    return Debts.checkTap();
  }).then(function (r) {
    eq(r, 'wait', 'при замке окно открылось сразу');
    ok(document.getElementById('amount').hidden, 'окно платежа поверх замка');
    isLk = false;
    return sleep(700);
  }).then(function () {
    ok(UI.dlgOpen() && document.getElementById('dlgTitle').textContent === 'С какого кошелька платёж?', 'после разблокировки окно платежа не открылось');
    UI.closeDlg();
    // «мне должны» - сначала «На какой кошелёк платёж?», потом окно «Мне вернули»
    var o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша тап', amount: 3000, now: 0, date: cur + '-01' });
    UI.save();
    tap = { debtId: o.id, due: '' };
    return Debts.checkTap();
  }).then(function (r) {
    eq(r, 'pay', '«мне должны»: не окно возврата');
    eq(document.getElementById('dlgTitle').textContent, 'На какой кошелёк платёж?', '«мне должны»: не спросил кошелёк');
    var rows = document.querySelectorAll('#dbWl [data-wid]'), row = rows[rows.length - 1];
    var wid = row.getAttribute('data-wid');
    row.click();
    ok(/Саша тап/.test(document.querySelector('#amFrom .am-pick').textContent), '«откуда» - не долг');
    eq(document.querySelector('#amTo .am-pick').textContent, Engine.findWallet(UI.S, wid).name, '«куда» - не выбранный кошелёк');
    done();
  }, function (e) { done(); throw e; });
});

// (ревью 12.10 №8) тап по уведомлению при ОТКРЫТОМ приложении: оболочка шлёт событие
// homyakReminderTap на document (MainActivity.onNewIntent → bridge.triggerJSEvent) - окно платежа
// открывается сразу, без visibilitychange (при открытом приложении его нет).
add('долги: тап по напоминанию при открытом приложении - событие оболочки открывает платёж сразу', function () {
  var tap = null;
  var fake = {
    takeTap: function () { var r = tap || {}; tap = null; return Promise.resolve(r); },
    checkPermission: function () { return Promise.resolve({ granted: true }); },
    schedule: function () { return Promise.resolve({ ok: true }); }
  };
  function done() { Debts._plugin(null); UI.closeAmount(); UI.closeCard(); UI.closeDlg(); UI.hideToast(); dropDebts(); }
  dropDebts();
  var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит событие', amount: 50000, pay: 5000, day: 28, now: 0, date: Engine.today() });
  UI.save(); UI.render();
  Debts._plugin(fake);
  tap = { debtId: d.id, due: '' };
  document.dispatchEvent(new Event('homyakReminderTap'));
  return sleep(150).then(function () {
    eq(tap, null, 'событие оболочки не забрало тап');
    eq(document.getElementById('dlgTitle').textContent, 'С какого кошелька платёж?', 'событие оболочки не открыло выбор кошелька');
    document.querySelector('#dbWl [data-wid]').click();
    ok(!document.getElementById('amount').hidden, 'событие оболочки не открыло окно платежа');
    eq(document.getElementById('amKind').textContent, 'Платёж по долгу', 'вид операции');
    ok(/Кредит событие/.test(document.querySelector('#amTo .am-pick').textContent), '«куда» - не этот долг');
    done();
  }, function (e) { done(); throw e; });
});

// (ревью 12.10 №7) экран суммы на узком экране (320px): невыбранная фишка «откуда» не обрезается
// до «Вы…» - она не сжимается, сжимается заполненная; не помещается - короткое «Кошелёк?».
add('экран суммы: невыбранный кошелёк на 320px читается целиком, долг рядом не сжат в точку', function () {
  dropDebts();
  var am = document.getElementById('amount'), w0 = am.style.width;
  var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Потребительский кредит', amount: 300000, pay: 10000, day: 28, now: 0, date: Engine.today() });
  UI.save(); UI.render();
  function done() { am.style.width = w0; UI.closeAmount(); UI.hideToast(); dropDebts(); }
  am.style.width = '320px';
  UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: null });
  return sleep(150).then(function () {
    var e = document.querySelector('#amFrom .am-pick'), f = document.querySelector('#amTo .am-pick');
    var path = e.parentNode.parentNode;
    ok(e.classList.contains('empty'), 'кошелёк не к выбору');
    ok(/^(Выбрать кошелёк|Кошелёк[?])$/.test(e.textContent), 'текст приглашения: ' + e.textContent);
    ok(e.scrollWidth <= e.clientWidth + 1, 'приглашение обрезано: «' + e.textContent + '» ' + e.scrollWidth + ' > ' + e.clientWidth);
    ok(f.getBoundingClientRect().width >= 60, 'долг рядом сжат в точку: ' + Math.round(f.getBoundingClientRect().width));
    ok(path.scrollWidth <= path.clientWidth + 1, 'ряд «откуда → куда» вылез за край');
    // ещё уже (крупный шрифт телефона): даже «тесной» шапке (12.10, без спейсера) не хватает -
    // приглашение короткое «Кошелёк?», целиком
    am.style.width = '250px';
    UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: null });
    return sleep(150);
  }).then(function () {
    var e = document.querySelector('#amFrom .am-pick');
    eq(e.textContent, 'Кошелёк?', 'на 250px нет короткого приглашения');
    ok(e.scrollWidth <= e.clientWidth + 1, 'короткое приглашение обрезано');
    done();
  }, function (er) { done(); throw er; });
});

// ---------- 1.0.4: кредитная карта (отметка у кошелька, решение 12.10) ----------
// Кредитка остаётся кошельком: отметка в форме кошелька, день платежа по карте сеткой,
// напоминание тем же плагином; баннера просрочки у кредитки нет (упрощение 13.10); тап по
// напоминанию - перевод на карту, «Капитал и обязательства» - строка «кредитные карты».
function creditCard(name, base) {
  var w = Engine.addWallet(UI.S, { name: name || 'Кредитка тест', base: base || 0 });
  w.baseTs = 0;
  return w;
}
function dropCredit() {
  UI.S.wallets.filter(function (w) { return / тест$/.test(w.name) && !Engine.walletDebtTxCount(UI.S, w.id); }).forEach(function (w) { Engine.deleteWallet(UI.S, w.id); });
  Object.keys(UI.S.ui.debtWarn || {}).forEach(function (k) { if (!Engine.findDebt(UI.S, k.split('|')[0])) delete UI.S.ui.debtWarn[k]; });
  if (window.Debts) Debts.hideWarn();
  UI.save(); UI.render();
}

// (К1) форма кошелька: отметка «Кредитная карта» открывает сетку дня платежа и тумблер;
// без дня тумблер неактивен; отказ в разрешении - прямо в строке (окно формы не закрылось),
// «Открыть настройки»; разрешили - вкл; «Сохранить» записывает; плитка на главном - обычная.
add('кредитка: отметка в форме кошелька - день платежа, напоминание, отказ в разрешении; плитка как у кошелька', function () {
  var grant = false, ask = 0, calls = [];
  var fake = {
    checkPermission: function () { return Promise.resolve({ granted: grant }); },
    requestPermission: function () { ask++; return Promise.resolve({ granted: grant }); },
    schedule: function (o) { calls.push(o); return Promise.resolve({ ok: true }); },
    openSettings: function () { calls.push('settings'); return Promise.resolve({ ok: true }); },
    test: function (o) { calls.push(o); return Promise.resolve({ ok: true }); }
  };
  function $(id) { return document.getElementById(id); }
  function done() { Debts._plugin(null); UI.closeDlg(); UI.hideToast(); dropCredit(); }
  dropCredit();
  var w = creditCard('Кредитка тест', -20000);
  UI.save(); UI.render();
  Debts._plugin(fake);
  UI.editWallet(w.id);
  var cr = $('ecCredit');
  ok(cr, 'в форме кошелька нет отметки «Кредитная карта»');
  ok(/Кредитная карта/.test(cr.textContent) && cr.getAttribute('aria-pressed') === 'false', 'отметка включена у обычного кошелька');
  ok($('ecCrMore').hidden, 'день платежа виден без отметки');
  cr.click();
  ok(!$('ecCrMore').hidden && cr.getAttribute('aria-pressed') === 'true', 'отметка не открыла день платежа');
  ok(/День платежа по карте/.test($('ecCrMore').textContent) && /Дата из приложения банка, до которой нужно внести платёж/.test($('ecCrMore').textContent), 'подпись поля дня платежа');
  ok(!/коротком месяце/.test($('ecCrMore').textContent), 'подпись про короткий месяц у кредитки');
  eq($('ecCrDayGrid').querySelectorAll('.dg-d').length, 31, 'чисел в сетке');
  ok(/Сначала выберите день платежа/.test($('ecCrRm').textContent), 'тумблер без дня не помечен');
  $('ecCrRemind').click();
  eq(ask, 0, 'без дня платежа спросили разрешение');
  $('ecCrDayGrid').querySelector('[data-day="10"]').click();
  eq($('ecCrDay').value, '10', 'день не записан касанием');
  ok(/Накануне и в день платежа, в\u00a010:00 - пока карта в минусе/.test($('ecCrRm').textContent), 'подпись напоминания');
  $('ecCrRemind').click();
  return sleep(60).then(function () {
    eq(ask, 1, 'разрешение не спросили');
    eq($('dlgTitle').textContent, 'Кошелёк', 'окно формы закрылось');
    ok(/уведомления запрещены в настройках телефона/.test($('ecCrRm').textContent), 'отказ не показан в строке');
    eq($('ecCrRemind').getAttribute('aria-pressed'), 'false', 'тумблер «вкл» без разрешения');
    $('ecCrPerm').click();
    ok(calls.indexOf('settings') >= 0, '«Открыть настройки» не открыла настройки');
    grant = true;
    $('ecCrRemind').click();
    return sleep(60);
  }).then(function () {
    eq($('ecCrRemind').getAttribute('aria-pressed'), 'true', 'после разрешения тумблер не включился');
    // баг 12.10: кнопка проверки - сразу после тумблера, без «Сохранить» и повторного открытия
    ok($('ecCrTest'), 'кнопки «Проверить напоминание» нет до сохранения формы');
    if ($('ecCrTest')) {
      var nt = calls.length;
      $('ecCrTest').click();
      var tc = calls.slice(nt).filter(function (c) { return c && c.delaySec; })[0];
      ok(tc && tc.kind === 'credit' && /платёж по кредитной карте «Кредитка тест»/.test(tc.title), 'проверка карты ушла не так: ' + JSON.stringify(tc));
    }
    // то же число ещё раз - день убран, тумблер неактивен; снова выбрали - вернулся
    $('ecCrDayGrid').querySelector('[data-day="10"]').click();
    eq($('ecCrDay').value, '', 'повторное касание не убрало день');
    ok(/Сначала выберите день платежа/.test($('ecCrRm').textContent), 'без дня тумблер активен');
    $('ecCrDayGrid').querySelector('[data-day="10"]').click();
    $('dlgBtns').lastChild.click();   // «Сохранить»
    ok($('dlg').hidden, 'форма не закрылась: ' + ($('ecErr') || {}).textContent);
    ok(w.credit === true && w.payDay === 10 && w.remind === true, 'отметка записана не так: ' + JSON.stringify(w));
    var tile = document.querySelector('#fieldWallets .circle[data-id="' + w.id + '"]');
    ok(tile, 'кредитки нет на главном');
    eq(tile.className, 'circle wcard ' + UI.wcolor(w), 'плитка кредитки не как у обычного кошелька');
    return sleep(60);
  }).then(function () {
    var sch = calls.filter(function (c) { return c && c.events; });
    ok(sch.length, 'план не ушёл в плагин');
    var ev = sch[sch.length - 1].events.filter(function (e) { return e.id.indexOf(w.id + '|') === 0; });
    ok(ev.length >= 2, 'в плане нет напоминаний кредитки');
    ok(ev.every(function (e) { return /платёж по кредитной карте «Кредитка тест»/.test(e.title) && !/\d/.test(e.title.replace(/«[^»]*»/, '') + e.text); }), 'текст напоминания: ' + JSON.stringify(ev[0]));
    eq(new Date(ev[0].at).getHours(), Engine.REMIND_HOUR, 'не в 10:00');
    // снять отметку - поля ушли, напоминаний нет
    UI.editWallet(w.id);
    document.getElementById('ecCredit').click();
    document.getElementById('dlgBtns').lastChild.click();
    ok(!('credit' in w) && !('payDay' in w), 'снятая отметка оставила поля');
    eq(Engine.reminderPlan(UI.S, Date.now(), 12).filter(function (e) { return e.id.indexOf(w.id + '|') === 0; }).length, 0, 'напоминания остались');
    done();
  }, function (e) { done(); throw e; });
});

// (К2) упрощение 13.10: у кредитки баннера просрочки нет НИКОГДА - карта в минусе месяцами
// после дня платежа, с напоминанием и без, в любой день: баннер на главном не появляется
// (через DOM: #debtWarn скрыт). Долг рядом - баннер по-прежнему долговой.
add('кредитка: баннера просрочки нет никогда - минус после дня платежа баннер не показывает', function () {
  function $(id) { return document.getElementById(id); }
  try {
    dropDebts(); dropCredit();
    var w = creditCard('Кредитка тест', 0);
    Engine.setWalletCredit(UI.S, w.id, { credit: true, payDay: 5, remind: true });
    Engine.addTx(UI.S, { kind: 'exp', amount: 12100, date: '2026-01-02', walletId: w.id, catId: UI.S.categories.exp[0].id });
    UI.save(); UI.render(); Debts.hideWarn();
    ['2026-01-05', '2026-01-06', '2026-02-06', '2026-03-31', '2026-06-15'].forEach(function (day) {
      ok(!Debts.checkWarn(day), 'баннер у кредитки на ' + day);
      ok($('debtWarn').hidden, 'баннер на экране у кредитки на ' + day);
    });
    ok(document.body.textContent.indexOf('Карта не ' + 'погашена') < 0, 'текст баннера кредитки на экране');
    // долг рядом - баннер долговой, про карту ни слова
    Engine.addDebt(UI.S, { type: 'owe', name: 'Ипотека', amount: 900000, pay: 30000, day: 5, now: 0, date: '2026-02-10' });
    UI.save(); UI.render();
    ok(Debts.checkWarn('2026-04-06'), 'баннер долга не показался');
    eq($('debtWarn').querySelector('.dw-t').textContent, 'Нет платежа по долгу', 'заголовок баннера долга');
    ok($('dwText').textContent.indexOf('Кредитка тест') < 0, 'в баннере долга - кредитка');
  } finally { UI.closeAmount(); UI.closeDlg(); UI.hideToast(); dropDebts(); dropCredit(); }
});

// (К3) тап по напоминанию кредитки (id кошелька в интенте): карта в минусе - перевод на неё;
// после пополнения - карточка кошелька; замок - сначала замок.
add('кредитка: тап по напоминанию - перевод на карту, без минуса - карточка, замок раньше', function () {
  var tap = null, lk = window.AppLock, lk0 = lk && lk.isLocked, isLk = false;
  var fake = {
    takeTap: function () { var r = tap || {}; tap = null; return Promise.resolve(r); },
    checkPermission: function () { return Promise.resolve({ granted: true }); },
    schedule: function () { return Promise.resolve({ ok: true }); }
  };
  function done() { Debts._plugin(null); if (lk) lk.isLocked = lk0; UI.closeAmount(); UI.closeCard(); UI.closeDlg(); UI.hideToast(); dropCredit(); }
  dropCredit();
  var w = creditCard('Кредитка тест', -3000);
  Engine.setWalletCredit(UI.S, w.id, { credit: true, payDay: 20, remind: true });
  UI.save(); UI.render();
  Debts._plugin(fake);
  if (lk) lk.isLocked = function () { return isLk; };
  isLk = true;
  tap = { debtId: w.id, due: Engine.today().slice(0, 7) + '-20' };
  return Debts.checkTap().then(function (r) {
    eq(r, 'wait', 'при замке окно открылось сразу');
    ok(document.getElementById('amount').hidden, 'перевод поверх замка');
    isLk = false;
    return sleep(700);
  }).then(function () {
    ok(!document.getElementById('amount').hidden && document.getElementById('amKind').textContent === 'Перевод', 'после разблокировки перевод не открылся');
    ok(/Кредитка тест/.test(document.querySelector('#amTo .am-pick').textContent), '«куда» - не карта');
    eq(document.getElementById('amExpr').textContent.replace(/[₽\s]+$/, ''), '3' + Engine.NBSP + '000', 'сумма - не минус карты');
    UI.closeAmount();
    Engine.setWalletBase(UI.S, w.id, 0);
    UI.save();
    tap = { debtId: w.id, due: '' };
    return Debts.checkTap();
  }).then(function (r) {
    eq(r, 'card', 'карта без минуса - не карточка');
    ok(UI.cardOpen() && document.getElementById('cardTitle').textContent === 'Кредитка тест', 'карточка кошелька не открылась');
    done();
  }, function (e) { done(); throw e; });
});

// (К4) «Капитал и обязательства» видна при одной кредитке (без долгов); минус - строкой «кредитные
// карты», «в кошельках без кредиток», капитал = «В кошельках» (без задвоения); нагрузка - без
// кредиток.
add('кредитка: «Капитал и обязательства» - строка «кредитные карты», капитал без задвоения, нагрузка без кредиток', function () {
  var h0 = UI.hasFullAccess;
  try {
    dropDebts(); dropCredit();
    UI.hasFullAccess = function () { return true; };
    UI.openSummary({ view: 'chooser' });
    var plain = !document.getElementById('smGoDebt').hidden;
    UI.closeSummary();
    var w = creditCard('Кредитка тест', -7000);
    Engine.setWalletCredit(UI.S, w.id, { credit: true, payDay: 5 });
    UI.save(); UI.render();
    UI.openSummary({ view: 'chooser' });
    ok(!plain || Engine.hasCreditCards(UI.S), 'до проверки уже были кредитки');
    ok(!document.getElementById('smGoDebt').hidden, '«Капитал и обязательства» не видна при кредитке');
    document.getElementById('smGoDebt').click();
    var ym = UI.curYM(), cap = Engine.netCapital(UI.S, ym), body = document.getElementById('smBody').textContent;
    ok(cap.credit <= -7000, 'движок не видит минус кредитки');
    ok(body.indexOf('кредитные карты −' + Engine.fmt(-cap.credit) + Engine.NBSP + '₽') >= 0, 'нет строки «кредитные карты»: ' + body);
    ok(body.indexOf('в кошельках без кредиток ' + Engine.fmt(cap.own) + Engine.NBSP + '₽') >= 0, 'нет «в кошельках без кредиток»: ' + body);
    eq(document.querySelector('#smBody .sm-big').textContent, Engine.fmt(cap.net) + Engine.NBSP + '₽', 'капитал на экране');
    eq(cap.net, Engine.walletsTotal(UI.S), 'капитал без долгов ≠ «В кошельках» (задвоение минуса)');
    ok(!/Долгов пока нет/.test(body), 'подсказка «долгов нет» при кредитке');
    // (13.10) долгов «я должен» нет - вкладки «Долги» нет, только капитал
    ok(document.getElementById('smDebtTabs').hidden, 'при одной кредитке видна вкладка «Долги»');
  } finally { UI.hasFullAccess = h0; UI.closeSummary(); dropCredit(); }
});

// (14.10, владелец) в баннере покупки под «Кошельки, категории и долги - сколько нужно» нет строки
// «до N кошельков и долгов, M категорий»: «до 100 категорий» читали как лимит бесплатной версии.
add('баннер покупки: без строки «до N … категорий» под «сколько нужно»', function () {
  try {
    UI.paywall();
    var t = document.getElementById('dlgBody').textContent;
    ok(t.indexOf('Кошельки, категории и долги - сколько нужно') >= 0, 'пропал заголовок «Кошельки, категории и долги - сколько нужно»');
    ok(!/до\s*\d/.test(t), 'в баннере покупки «до N»: ' + t);
    ok(!/\d[\d\u00a0 ]*\s*(кошельк|категори)/.test(t), 'в баннере покупки число кошельков/категорий: ' + t);
  } finally { UI.closeDlg(); }
});

// ---------- 1.0.4, решение владельца 14.10: без дублей кнопок в карточке долга ----------
// (З1) в карточке активного долга с остатком > 0 - «Записать платёж» (одна подпись для «я должен»
// и «мне должны») и «Настроить» во всю ширину. Кнопки «Долг погашен» при остатке нет: она делала
// то же, что платёж на весь остаток. При нуле - «Долг погашен» (архив) и «Настроить».
add('долги 14.10: в карточке нет «Долг погашен» при остатке - только «Записать платёж» и «Настроить»', function () {
  function $(id) { return document.getElementById(id); }
  try {
    dropDebts();
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Рассрочка', amount: 20000, pay: 5000, day: 10, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    ok(!$('dbClose'), 'вернулась кнопка «Долг погашен» рядом с «Записать платёж»');
    ok(!/Долг погашен|Долг вернули/.test($('cardActs').textContent), 'в карточке с остатком надпись закрытия: ' + $('cardActs').textContent);
    eq($('dbPay').textContent, 'Записать платёж', 'главная кнопка');
    ok($('dbSetup') && !$('dbBase'), 'нет «Настроить» или вернулась «Поправить остаток»');
    eq($('cardActs').querySelectorAll('button').length, 2, 'в карточке не две кнопки');
    ok(Math.abs($('dbSetup').getBoundingClientRect().width - $('dbPay').getBoundingClientRect().width) <= 1, '«Настроить» не во всю ширину');
    var o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша', amount: 8000, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: o.id });
    eq($('dbPay').textContent, 'Записать платёж', '«мне должны»: главная кнопка');
    ok(!$('dbClose'), '«мне должны»: вернулась кнопка закрытия');
    eq($('cardActs').querySelectorAll('button').length, 2, '«мне должны»: в карточке не две кнопки');
    UI.closeCard();
    Debts.deleteFlow(o.id);
    ok(/запишите последний платёж или исправьте остаток в «Настроить» и нажмите «Долг погашен»: он уйдёт в архив, а история сохранится\./.test($('dlgBody').textContent), 'текст удаления: ' + $('dlgBody').textContent);
    UI.closeDlg();
    Engine.setDebtBase(UI.S, o.id, 0);
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: o.id });
    ok(!$('dbPay') && $('dbArchive') && $('dbSetup'), 'при нуле: нет «Долг погашен» и «Настроить»');
    eq($('dbArchive').textContent, 'Долг погашен', '«мне должны» при нуле: подпись');
    UI.closeCard();
    Debts.deleteFlow(o.id);
    ok(/нажмите «Долг погашен» в карточке: он уйдёт в архив/.test($('dlgBody').textContent), 'текст удаления при нуле: ' + $('dlgBody').textContent);
  } finally { UI.closeCard(); UI.closeDlg(); UI.hideToast(); dropDebts(); }
});

// (З2) остаток стал 0 действием человека - сразу «Долг погашен?» (те же слова у «мне должны»): платёж
// из окна суммы, «Мне вернули», правка суммы платежа, «Поправить остаток» на 0. «Позже» -
// не спрашиваем снова до новой операции; удаление операции окна не зовёт.
add('долги: остаток 0 - окно «Долг погашен?» на каждом пути, «Позже» не повторяется, удаление не зовёт', function () {
  function $(id) { return document.getElementById(id); }
  var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0], d, o, e, b, r;
  function asked() { return !$('dlg').hidden && /^Долг (погашен|вернули)\?$/.test($('dlgTitle').textContent); }
  function done() { UI.closeAmount(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  // 1) платёж из окна суммы (жест, уведомление, баннер, карточка - все через него)
  d = Engine.addDebt(UI.S, { type: 'owe', name: 'Друг', amount: 7000, pay: 7000, day: 5, now: 0, date: '2026-01-01' });
  UI.save(); UI.render();
  UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: w.id }, 7000);
  $('amConfirm').click();
  UI.hideToast();
  return sleep(450).then(function () {
    ok(asked(), 'платёж до нуля: окна нет');
    eq($('dlgTitle').textContent, 'Долг погашен?', 'заголовок');
    eq($('dlgBody').textContent, 'Остаток по «Друг» - 0' + Engine.NBSP + '₽. Долг уйдёт в архив, история платежей сохранится.', 'текст');
    eq($('dlgBtns').firstChild.textContent, 'Позже', 'кнопка «Позже»');
    eq($('dlgBtns').lastChild.textContent, 'Долг погашен', 'кнопка архива');
    $('dlgBtns').firstChild.click();   // «Позже»
    ok(!d.archived, '«Позже» отправила в архив');
    Debts.offerArchive(d.id);   // то же состояние - не спрашиваем снова
    return sleep(450);
  }).then(function () {
    ok(!asked(), 'после «Позже» спросили снова без новой операции');
    // 2) «Мне вернули» по «мне должны»
    o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша', amount: 4000, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openAmount({ kind: 'debttake', debtId: o.id, walletId: w.id }, 4000);
    $('amConfirm').click();
    UI.hideToast();
    return sleep(450);
  }).then(function () {
    ok(asked(), '«Мне вернули» до нуля: окна нет');
    eq($('dlgTitle').textContent, 'Долг погашен?', 'заголовок «мне должны» - те же слова');
    eq($('dlgBody').textContent, 'Остаток по «Саша» - 0' + Engine.NBSP + '₽. Долг уйдёт в архив, история платежей сохранится.', 'текст «мне должны»');
    eq($('dlgBtns').lastChild.textContent, 'Долг погашен', 'кнопка «мне должны»');
    ok($('dlgBtns').classList.contains('pw-btns'), 'длинные подписи не столбиком (на 320 рвутся на две строки)');
    $('dlgBtns').lastChild.click();
    ok(o.archived, '«Долг погашен» («мне должны») не отправила в архив');
    // 3) правка суммы платежа
    e = Engine.addDebt(UI.S, { type: 'owe', name: 'Займ', amount: 5000, pay: 5000, day: 5, now: 0, date: '2026-01-01' });
    r = Engine.payDebt(UI.S, { debtId: e.id, walletId: w.id, amount: 3000, date: Engine.today() });
    UI.save(); UI.render();
    UI.editTx(r.txs[0].id);
    $('etAmount').value = '5000';
    $('dlgBtns').lastChild.click();
    return sleep(450);
  }).then(function () {
    ok(asked(), 'правка платежа до нуля: окна нет');
    UI.closeDlg();
    // 4) остаток 0 в «Настроить»
    b = Engine.addDebt(UI.S, { type: 'owe', name: 'Карта рассрочки', amount: 9000, pay: 3000, day: 5, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: b.id });
    $('dbSetup').click();
    $('deAmount').value = '0';
    $('dlgBtns').lastChild.click();
    return sleep(450);
  }).then(function () {
    ok(asked(), 'остаток 0 в «Настроить»: окна нет');
    eq($('dlgTitle').textContent, 'Долг погашен?', '«Настроить» → 0: заголовок');
    var w0 = Engine.walletBalance(UI.S, w.id);
    $('dlgBtns').lastChild.click();   // «Долг погашен» - закрыть без денег
    ok(b.archived, '«Настроить» → 0 → «Долг погашен» не отправила в архив');
    eq(Engine.walletBalance(UI.S, w.id), w0, 'закрытие без денег сдвинуло кошелёк');
    UI.closeDlg(); UI.closeCard(); UI.hideToast();
    // 5) «Позже» помнится до новой операции: новая операция по долгу «Друг» - снова спросим
    Engine.takeDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 1000, date: Engine.today() });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 1000, date: Engine.today() });
    UI.save(); UI.render();
    Debts.offerArchive(d.id);
    return sleep(450);
  }).then(function () {
    ok(asked(), 'после новой операции по долгу не спросили');
    UI.closeDlg();
    // 6) удаление операции, после которого остаток стал 0, окна не зовёт
    var z = Engine.addDebt(UI.S, { type: 'owe', name: 'Удалить', amount: 2000, pay: 2000, day: 5, now: 0, date: '2026-01-01' });
    var t = Engine.takeDebt(UI.S, { debtId: z.id, walletId: w.id, amount: 1000, date: Engine.today() });
    Engine.payDebt(UI.S, { debtId: z.id, walletId: w.id, amount: 2000, date: Engine.today() });
    UI.save(); UI.render();
    Engine.deleteTx(UI.S, t.txs[0].id);
    UI.save(); UI.render();
    eq(Engine.debtBalance(UI.S, z.id), 0, 'сценарий удаления: остаток не 0');
    return sleep(450);
  }).then(function () {
    ok(!asked(), 'удаление операции позвало окно');
    done();
  }, function (er) { done(); throw er; });
});

// ---------- короткое ревью 1.0.4 (13.10): закрытый с остатком долг, архивный долг, окно и тост ----------
// (Р1) долг, закрытый с остатком до 14.10 (запись обнуления в данных): в архивной карточке строка
// «Долг погашен · остаток X ₽ обнулён», «Вернуть из архива» - «Остаток X ₽ вернётся» и остаток назад.
add('долги ревью 13.10 №1: старая запись обнуления - строка в истории, возврат из архива с остатком', function () {
  function $(id) { return document.getElementById(id); }
  var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0], d;
  function done() { UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  d = Engine.addDebt(UI.S, { type: 'owe', name: 'Рассрочка', amount: 50000, pay: 5000, day: 5, now: 0, date: '2026-01-01' });
  Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-09-10' });
  var day = Engine.today();
  Engine.closeDebt(UI.S, d.id, day);
  UI.save(); UI.render();
  UI.openCard({ kind: 'debt', id: d.id });
  var ev = $('cardList').querySelector('.db-ev');
  ok(ev, 'нет строки «Долг погашен» в истории');
  eq(ev.textContent, 'Долг погашен' + day.slice(8, 10) + '.' + day.slice(5, 7) + ' · остаток 45' + Engine.NBSP + '000' + Engine.NBSP + '₽ обнулён', 'текст строки обнуления');
  // «Вернуть из архива» - подтверждение с суммой, остаток назад
  $('dbRestore').click();
  eq($('dlgTitle').textContent, 'Вернуть из архива?', 'нет подтверждения возврата');
  ok($('dlgBody').textContent.indexOf('Остаток 45' + Engine.NBSP + '000' + Engine.NBSP + '₽ вернётся') >= 0, 'в подтверждении нет «Остаток X ₽ вернётся»: ' + $('dlgBody').textContent);
  $('dlgBtns').lastChild.click();
  return sleep(50).then(function () {
    ok(!d.archived, 'не вернулся из архива');
    eq(Engine.debtBalance(UI.S, d.id), 45000, 'возврат из архива не вернул остаток');
    done();
  }, function (er) { done(); throw er; });
});

// (Р2) архивный долг: история только для просмотра (без «Править»/«Удалить», свайп не берёт);
// остаток архивного долга стал не ноль (удалили его платёж из карточки кошелька) - долг снова на экране.
add('долги ревью 13.10 №2: архивная история только для просмотра, остаток не ноль - долг из архива', function () {
  function $(id) { return document.getElementById(id); }
  var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0], d, p;
  function done() { UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  d = Engine.addDebt(UI.S, { type: 'owe', name: 'Займ', amount: 30000, pay: 5000, day: 5, now: 0, date: '2026-01-01' });
  p = Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 5000, date: '2026-09-10' });
  Engine.closeDebt(UI.S, d.id, Engine.today());
  UI.save(); UI.render();
  UI.openCard({ kind: 'debt', id: d.id });
  ok(!$('cardList').querySelector('.txrow'), 'в архивной карточке строки со свайпом');
  ok(!$('cardList').querySelector('.txact'), 'в архивной карточке есть «Править»/«Удалить»');
  ok($('cardList').querySelector('.dbro[data-id="' + p.txs[0].id + '"]'), 'платёж пропал из архивной истории');
  ok($('cardHint').hidden, 'подсказка про свайп у архивного долга');
  // свайп влево по строке - окна удаления нет
  var row = $('cardList').querySelector('.dbro[data-id="' + p.txs[0].id + '"]');
  withoutPanel(function () {
    var r = row.getBoundingClientRect(), y = r.top + r.height / 2;
    pev(row, 'pointerdown', r.right - 20, y, false, 'touch');
    for (var i = 1; i <= 10; i++) pev(row, 'pointermove', r.right - 20 - i * 12, y, false, 'touch');
    pev(row, 'pointerup', r.right - 150, y, true, 'touch');
  });
  return sleep(50).then(function () {
    ok(!UI.dlgOpen(), 'свайп по архивной истории открыл окно');
    eq(Engine.debtHistory(UI.S, d.id).length, 1, 'платёж удалился');
    UI.closeCard();
    // другой путь: удалили платёж из карточки кошелька
    UI.openCard({ kind: 'wallet', id: w.id });
    UI.confirmDelTx(p.txs[0].id);
    $('dlgBtns').lastChild.click();
    return sleep(50);
  }).then(function () {
    eq(Engine.debtBalance(UI.S, d.id), 5000, 'остаток после удаления платежа');
    ok(!d.archived, 'архивный долг с остатком 5 000 остался в архиве');
    ok(/снова на экране/.test($('toastText').textContent), 'нет сообщения о возврате: ' + $('toastText').textContent);
    ok(circle('debt', 0), 'вернувшегося долга нет на главном');
    done();
  }, function (er) { done(); throw er; });
});

// ---------- решения владельца 14.10: кошелёк для денег долга, без дублей кнопок ----------
// (К14-1) «Записать платёж»: сначала своё окно выбора кошелька (кошелёк прошлого раза - первым с
// пометкой, но не выбран сам; только кошельки и «Отмена»); экран суммы без выбора не открывается; выбранный кошелёк - на экране суммы, «Подтвердить» активна (платёж подставлен).
add('долги 14.10: «Записать платёж» - сначала выбор кошелька, выбранный на экране суммы', function () {
  function $(id) { return document.getElementById(id); }
  var ws = UI.S.wallets.filter(function (x) { return !x.hidden; });
  var w2 = ws[ws.length - 1], d, o;
  try {
    dropDebts();
    d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит выбор', amount: 60000, pay: 6000, day: 28, now: 0, date: '2026-01-01' });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w2.id, amount: 6000, date: '2026-02-28' });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    eq($('dbPay').textContent, 'Записать платёж', 'кнопка');
    $('dbPay').click();
    ok($('amount').hidden, 'экран суммы открылся без выбора кошелька');
    eq($('dlgTitle').textContent, 'С какого кошелька платёж?', 'нет окна выбора кошелька');
    var rows = $('dlgBody').querySelectorAll('#dbWl [data-wid]');
    eq(rows.length, ws.length, 'в окне не все видимые кошельки');
    eq(rows[0].getAttribute('data-wid'), w2.id, 'кошелёк прошлого платежа не первым');
    ok(/в прошлый раз/.test(rows[0].textContent), 'нет пометки «в прошлый раз»');
    ok(!$('dlgBody').querySelector('.db-wr.on'), 'кошелёк выбран сам, без касания');
    ok(rows[1].textContent.length > 0, 'строка без имени');
    eq($('dlgBtns').children.length, 1, 'в окне кошельков не одна «Отмена»');
    eq($('dlgBody').querySelectorAll('.set-row').length, ws.length, 'в окне кошельков лишние строки');
    ok(!/Без денег/.test($('dlgBody').textContent), 'вернулась строка «Без денег»');
    // «Отмена» - ничего не открыто
    $('dlgBtns').firstChild.click();
    ok($('amount').hidden && !UI.dlgOpen(), '«Отмена» открыла экран суммы');
    UI.openCard({ kind: 'debt', id: d.id });
    $('dbPay').click();
    var pick = $('dlgBody').querySelectorAll('#dbWl [data-wid]')[1], pid = pick.getAttribute('data-wid');
    pick.click();
    ok(!$('amount').hidden, 'касание кошелька не открыло экран суммы');
    eq($('amKind').textContent, 'Платёж по долгу', 'вид операции');
    eq($('amFrom').querySelector('.am-pick').textContent, Engine.findWallet(UI.S, pid).name, 'на экране суммы не выбранный кошелёк');
    ok(!$('amFrom').querySelector('.am-pick').classList.contains('empty'), 'кошелёк на экране суммы пустой');
    eq($('amExpr').textContent.replace(/[₽\s]+$/, ''), '6' + Engine.NBSP + '000', 'платёж не подставлен');
    ok(!$('amConfirm').disabled, '«Подтвердить» неактивна при выбранном кошельке');
    var b0 = Engine.walletBalance(UI.S, pid);
    $('amConfirm').click();
    UI.hideToast(); UI.closeDlg();
    eq(Engine.walletBalance(UI.S, pid), Math.round((b0 - 6000) * 100) / 100, 'платёж ушёл не с выбранного кошелька');
    // «мне должны» - та же «Записать платёж» → «На какой кошелёк платёж?»
    o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша выбор', amount: 9000, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: o.id });
    eq($('dbPay').textContent, 'Записать платёж', 'кнопка «мне должны»');
    $('dbPay').click();
    ok($('amount').hidden, '«мне должны»: экран суммы без выбора кошелька');
    eq($('dlgTitle').textContent, 'На какой кошелёк платёж?', '«мне должны»: нет окна выбора');
    ok(!$('dlgBody').querySelector('.db-wr.on'), '«мне должны»: кошелёк выбран сам');
    pick = $('dlgBody').querySelectorAll('#dbWl [data-wid]')[0]; pid = pick.getAttribute('data-wid');
    pick.click();
    eq($('amKind').textContent, 'Вам вернули долг', '«мне должны»: вид операции');
    eq($('amTo').querySelector('.am-pick').textContent, Engine.findWallet(UI.S, pid).name, '«мне должны»: не выбранный кошелёк');
  } finally { UI.closeAmount(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
});

// (К14-2) «Весь остаток X ₽» на экране суммы: платёж «я должен» со ставкой - одно касание
// заполняет остаток, «Подтвердить» - кошелёк меньше ровно на остаток, долг ровно 0 (проценты
// месяца не отделяются - закрывающий платёж), сразу окно «Долг погашен?»; «Долг погашен» - архив.
add('долги 14.10: «Весь остаток» - платёж на остаток с выбранного кошелька, долг ровно 0, окно «Долг погашен?»', function () {
  function $(id) { return document.getElementById(id); }
  var ws = UI.S.wallets.filter(function (x) { return !x.hidden; });
  var w = ws[ws.length - 1], d, left, b0;
  function done() { UI.closeAmount(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  var prev = Engine.addMonths(Engine.today().slice(0, 7), -1);
  d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит закрыть', amount: 50000, pay: 5000, day: 28, rate: 12, now: 0, date: Engine.addMonths(prev, -1) + '-01' });
  Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 5000, date: prev + '-28' });
  UI.save(); UI.render();
  left = Engine.debtBalance(UI.S, d.id); b0 = Engine.walletBalance(UI.S, w.id);
  ok(left > 0 && Engine.previewPay(UI.S, { debtId: d.id, amount: 5000, date: Engine.today() }).interest > 0, 'сценарий: нет процентов этого месяца');
  UI.openCard({ kind: 'debt', id: d.id });
  $('dbPay').click();
  $('dlgBody').querySelector('#dbWl [data-wid="' + w.id + '"]').click();
  ok(!$('amount').hidden, 'экран суммы не открылся');
  ok(!$('amAll').hidden, 'нет чипа «Весь остаток»');
  ok($('amAll').textContent.indexOf('Весь остаток ') === 0 && /₽$/.test($('amAll').textContent), 'подпись чипа: ' + $('amAll').textContent);
  ok(!$('amAll').classList.contains('on'), 'чип отмечен при сумме платежа');
  ok(/проценты/.test($('amMini').textContent), 'сценарий: у обычного платежа не видно процентов');
  $('amAll').click();
  ok($('amAll').classList.contains('on'), 'чип не отмечен после касания');
  ok(!/проценты/.test($('amMini').textContent), 'у платежа на весь остаток отделены проценты: ' + $('amMini').textContent);
  ok(!$('amConfirm').disabled, '«Подтвердить» неактивна');
  $('amConfirm').click();
  UI.hideToast();
  eq(Engine.debtBalance(UI.S, d.id), 0, 'долг не ровно 0');
  eq(Engine.walletBalance(UI.S, w.id), Math.round((b0 - left) * 100) / 100, 'кошелёк не уменьшился ровно на остаток');
  var t = UI.S.tx.filter(function (x) { return x.debtId === d.id && x.amount === left; })[0];
  ok(t && t.walletId === w.id && t.payoff === true && !t.int, 'платёж на весь остаток не закрывающий: ' + JSON.stringify(t));
  return sleep(450).then(function () {
    ok(UI.dlgOpen(), 'нет окна «Долг погашен?»');
    eq($('dlgTitle').textContent, 'Долг погашен?', 'заголовок окна');
    eq($('dlgBtns').firstChild.textContent, 'Позже', 'кнопка «Позже»');
    eq($('dlgBtns').lastChild.textContent, 'Долг погашен', 'кнопка «Долг погашен»');
    $('dlgBtns').lastChild.click();
    ok(d.archived, '«Долг погашен» не отправила в архив');
    // «дали ещё» по «мне должны» и «взяли ещё» - чипа нет: это не погашение
    var o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша чип', amount: 3000, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openAmount({ kind: 'debtpay', debtId: o.id, walletId: w.id });
    ok($('amAll').hidden, 'чип «Весь остаток» при «дали ещё»');
    UI.closeAmount();
    done();
  }, function (er) { done(); throw er; });
});

// (Б1 15.10, код-ревью max) экран суммы и окна операции по долгу - по датам долга:
// Р14 в своём календаре дни до заведения долга неактивны (и на экране суммы, и в правке операции);
// Р5 подсказка «из них проценты» задним числом = то, что запишется (было 0, записывалось 1 000);
// Р13 чипа «Весь остаток» на дату раньше последней операции долга нет;
// Р3 удалить «взял ещё», после которого остаток стал бы меньше нуля, нельзя - своё окно.
add('долги 15.10: календарь от заведения долга, подсказка процентов задним числом = запись, чип по дате, отказ удаления', function () {
  function $(id) { return document.getElementById(id); }
  var ws = UI.S.wallets.filter(function (x) { return !x.hidden; });
  var w = ws[ws.length - 1];
  function done() { if (window.Picker) Picker.close(); UI.closeAmount(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  var prev = Engine.addMonths(Engine.today().slice(0, 7), -1);
  var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Кредит Б1', amount: 100000, pay: 10000, day: 20, rate: 12, now: 0, date: prev + '-03' });
  var late = Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 10000, date: prev + '-20' }).txs[0];
  UI.save(); UI.render();
  try {
    UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: w.id });
    ok(!$('amAll').hidden, 'нет чипа «Весь остаток» на сегодня');
    $('amPick').click();
    var pk = $('pk');
    ok(pk && !pk.hidden, 'календарь не открылся');
    pk.querySelector('[data-pk-nav="-1"]').click();
    eq(pk.querySelector('[data-pk-day="' + prev + '-02"]').disabled, true, 'день до заведения долга можно выбрать');
    eq(pk.querySelector('[data-pk-day="' + prev + '-03"]').disabled, false, 'день заведения долга неактивен');
    pk.querySelector('[data-pk-day="' + prev + '-10"]').click();
    eq($('amDateVal').textContent, '10.' + prev.slice(5), 'дата не выбрана');
    ok(/проценты 1\u00a0000\u00a0₽/.test($('amMini').textContent), 'подсказка не та, что запишется: ' + $('amMini').textContent);
    ok($('amAll').hidden, 'чип «Весь остаток» на дату раньше последнего платежа');
    $('amConfirm').click();
    UI.hideToast();
    var t = UI.S.tx.filter(function (x) { return x.debtId === d.id && x.date === prev + '-10'; })[0];
    ok(t && t.int === 1000, 'записались другие проценты: ' + JSON.stringify(t));
    ok(!late.int, 'проценты месяца остались у позднего платежа');
    // правка операции: поле даты не раньше заведения долга
    UI.editTx(late.id);
    eq($('etDate').getAttribute('data-min'), prev + '-03', 'в правке операции по долгу нет нижней границы даты');
    UI.closeDlg();
    // «взял ещё», после которого всё выплачено: удаление - отказ своим окном, операция на месте
    var o = Engine.addDebt(UI.S, { type: 'owe', name: 'Друг Б1', amount: 10000, pay: 1000, day: 5, now: 0, date: prev + '-01' });
    var tk = Engine.takeDebt(UI.S, { debtId: o.id, walletId: w.id, amount: 5000, date: prev + '-02' }).txs[0];
    Engine.payDebt(UI.S, { debtId: o.id, walletId: w.id, amount: 15000, date: prev + '-05' });
    UI.save(); UI.render();
    UI.confirmDelTx(tk.id);
    $('dlgBtns').lastChild.click();
  } catch (e) { done(); throw e; }
  return sleep(50).then(function () {
    ok(UI.dlgOpen(), 'нет окна отказа удаления');
    eq($('dlgTitle').textContent, 'Не удалилось', 'заголовок окна отказа');
    ok(/Нельзя удалить: остаток долга станет меньше нуля/.test($('dlgBody').textContent), 'текст окна: ' + $('dlgBody').textContent);
    ok(!!Engine.findTx(UI.S, tk.id), '«взял ещё» удалился');
    eq(Engine.debtBalance(UI.S, o.id), 0, 'остаток после отказа');
    done();
  }, function (er) { done(); throw er; });
});

// (К14-3) «мне должны» - зеркало: «Весь остаток» на кошелёк - кошелёк плюс остаток, долг 0,
// окно «Долг погашен?» с теми же словами.
add('долги 14.10: «мне должны» - «Весь остаток» на кошелёк, кошелёк плюс остаток, «Долг погашен?»', function () {
  function $(id) { return document.getElementById(id); }
  var ws = UI.S.wallets.filter(function (x) { return !x.hidden; }), o;
  function done() { UI.closeAmount(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша вернул', amount: 8000, now: 0, date: '2026-01-01' });
  UI.save(); UI.render();
  var x = ws[1] || ws[0], b0 = Engine.walletBalance(UI.S, x.id);
  UI.openCard({ kind: 'debt', id: o.id });
  $('dbPay').click();
  $('dlgBody').querySelector('#dbWl [data-wid="' + x.id + '"]').click();
  eq($('amAll').textContent, 'Весь остаток 8' + Engine.NBSP + '000' + Engine.NBSP + '₽', 'подпись чипа «мне должны»');
  $('amAll').click();
  eq($('amExpr').textContent.replace(/[₽\s]+$/, ''), '8' + Engine.NBSP + '000', 'чип не заполнил сумму');
  $('amConfirm').click();
  UI.hideToast();
  eq(Engine.debtBalance(UI.S, o.id), 0, 'долг не 0');
  eq(Engine.walletBalance(UI.S, x.id), Math.round((b0 + 8000) * 100) / 100, 'кошелёк не вырос на остаток');
  return sleep(450).then(function () {
    eq($('dlgTitle').textContent, 'Долг погашен?', '«мне должны»: заголовок окна');
    eq($('dlgBtns').lastChild.textContent, 'Долг погашен', '«мне должны»: кнопка');
    $('dlgBtns').lastChild.click();
    ok(o.archived, '«мне должны»: не в архиве');
    ok($('toastText').textContent.indexOf('Долг «Саша вернул» погашен и убран в архив.') === 0, 'тост: ' + $('toastText').textContent);
    done();
  }, function (er) { done(); throw er; });
});

// (К14-4) кошельков на экране нет: «Записать платёж» - окно «Сначала добавьте кошелёк» с «Отмена» и
// «Добавить кошелёк» (не мёртвый экран суммы), других строк нет; «Добавить кошелёк» - форма кошелька.
add('долги 14.10: нет кошельков - «Сначала добавьте кошелёк» и «Добавить кошелёк», ничего больше', function () {
  function $(id) { return document.getElementById(id); }
  var vis = UI.S.wallets.filter(function (x) { return !x.hidden; }), d, o;
  try {
    dropDebts();
    d = Engine.addDebt(UI.S, { type: 'owe', name: 'Без кошельков', amount: 20000, pay: 2000, day: 5, now: 0, date: '2026-01-01' });
    o = Engine.addDebt(UI.S, { type: 'owed', name: 'Саша без кошельков', amount: 3000, now: 0, date: '2026-01-01' });
    vis.forEach(function (w) { w.hidden = true; });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    $('dbPay').click();
    ok($('amount').hidden, 'без кошельков открылся мёртвый экран суммы');
    eq($('dlgTitle').textContent, 'Сначала добавьте кошелёк', 'нет окна «Сначала добавьте кошелёк»');
    eq($('dlgBody').querySelectorAll('button, .set-row').length, 0, 'в окне без кошельков лишние строки или кнопки');
    eq($('dlgBtns').children.length, 2, 'не две кнопки');
    eq($('dlgBtns').firstChild.textContent, 'Отмена', 'нет «Отмена»');
    eq($('dlgBtns').lastChild.textContent, 'Добавить кошелёк', 'нет «Добавить кошелёк»');
    $('dlgBtns').lastChild.click();
    eq($('dlgTitle').textContent, 'Новый кошелёк', '«Добавить кошелёк» не открыл форму кошелька');
    UI.closeDlg();
    UI.openCard({ kind: 'debt', id: o.id });
    $('dbPay').click();
    eq($('dlgTitle').textContent, 'Сначала добавьте кошелёк', '«мне должны»: нет окна «Сначала добавьте кошелёк»');
    eq($('dlgBody').querySelectorAll('button, .set-row').length, 0, '«мне должны»: лишние строки');
  } finally { vis.forEach(function (w) { w.hidden = false; }); UI.save(); UI.render(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
});

// (Р3) окно «Долг погашен?» убирает тост с «Отменить»; к «ОК» остаток уже не ноль - понятное окно, не молча
add('долги ревью 13.10 №3: окно «Долг погашен?» прячет «Отменить», остаток не ноль к «ОК» - сообщение', function () {
  function $(id) { return document.getElementById(id); }
  var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0], d;
  function done() { UI.closeAmount(); UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  d = Engine.addDebt(UI.S, { type: 'owe', name: 'Друг', amount: 7000, pay: 7000, day: 5, now: 0, date: '2026-01-01' });
  UI.save(); UI.render();
  UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: w.id }, 7000);
  $('amConfirm').click();
  return sleep(450).then(function () {
    eq($('dlgTitle').textContent, 'Долг погашен?', 'нет окна');
    ok($('toast').hidden && $('toastBtn').hidden, 'тост с «Отменить» виден под окном «Долг погашен?»');
    // платёж отменили, пока окно открыто - «ОК»
    var t = UI.S.tx.filter(function (x) { return x.debtId === d.id; })[0];
    Engine.deleteTx(UI.S, t.id); UI.save();
    $('dlgBtns').lastChild.click();
    return sleep(60);
  }).then(function () {
    ok(!d.archived, 'долг с остатком ушёл в архив');
    ok(UI.dlgOpen(), 'окно закрылось молча');
    eq($('dlgTitle').textContent, 'Долг не закрыт', 'заголовок сообщения');
    ok(/уже не ноль/.test($('dlgBody').textContent), 'текст сообщения: ' + $('dlgBody').textContent);
    done();
  }, function (er) { done(); throw er; });
});

// (Б3 15.10, код-ревью max) Р10: «выплачено» без потери процента на дробях (100 000 → 80 000 = 20 %, не 19)
add('долги Б3 Р10: 100 000, осталось 80 000 - «выплачено 20 %» и полоска 20 %', function () {
  try {
    dropDebts();
    var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0];
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Доля', amount: 100000, pay: 20000, day: 10, now: 0, date: '2026-01-01' });
    Engine.payDebt(UI.S, { debtId: d.id, walletId: w.id, amount: 20000, date: Engine.today() });
    UI.save(); UI.render();
    eq(Engine.debtBalance(UI.S, d.id), 80000, 'сценарий: остаток не 80 000');
    UI.openCard({ kind: 'debt', id: d.id });
    var acts = document.getElementById('cardActs').textContent;
    ok(/выплачено 20\u00a0%/.test(acts), 'доля: ' + acts);
    eq(document.querySelector('#cardActs .db-bar i').style.width, '20%', 'ширина полоски');
  } finally { UI.closeCard(); dropDebts(); }
});

// Р11: «Меню → Настроить кошельки → долг → остаток 0 → Сохранить» - тоже окно «Долг погашен?»,
// по его кнопкам - обратно в список «Кошельки»
add('долги Б3 Р11: остаток 0 из списка «Кошельки» - «Долг погашен?», потом снова список', function () {
  function $(id) { return document.getElementById(id); }
  var d, e;
  function done() { UI.closeDlg(); UI.closeCard(); UI.hideToast(); dropDebts(); }
  dropDebts();
  d = Engine.addDebt(UI.S, { type: 'owe', name: 'Из списка', amount: 3000, pay: 1000, day: 10, now: 0, date: '2026-01-01' });
  e = Engine.addDebt(UI.S, { type: 'owe', name: 'Из списка 2', amount: 2000, pay: 1000, day: 10, now: 0, date: '2026-01-01' });
  UI.save(); UI.render();
  UI.openWallets();
  $('dlgBody').querySelector('.wtile[data-debt="' + d.id + '"]').click();
  ok($('deAmount'), 'форма долга не открылась');
  $('deAmount').value = '0';
  $('dlgBtns').lastChild.click();
  return sleep(450).then(function () {
    ok(UI.dlgOpen(), 'окна нет');
    eq($('dlgTitle').textContent, 'Долг погашен?', 'вместо «Долг погашен?» - ' + $('dlgTitle').textContent);
    $('dlgBtns').lastChild.click();
    ok(d.archived, '«Долг погашен» не отправила в архив');
    return sleep(60);
  }).then(function () {
    ok(UI.dlgOpen() && $('wlGrid'), 'после «Долг погашен» не вернулись в список «Кошельки»');
    // «Позже» - тоже обратно в список
    $('dlgBody').querySelector('.wtile[data-debt="' + e.id + '"]').click();
    $('deAmount').value = '0';
    $('dlgBtns').lastChild.click();
    return sleep(450);
  }).then(function () {
    eq($('dlgTitle').textContent, 'Долг погашен?', 'второй долг: нет окна');
    $('dlgBtns').firstChild.click();   // «Позже»
    return sleep(60);
  }).then(function () {
    ok(!e.archived, '«Позже» отправила в архив');
    ok(UI.dlgOpen() && $('wlGrid'), 'после «Позже» не вернулись в список «Кошельки»');
    done();
  }, function (er) { done(); throw er; });
});

// Р12: открытая карточка кошелька/долга обновляется после записи с экрана суммы («Повторить»)
// и после «Отменить» в тосте
add('долги Б3 Р12: карточка кошелька и долга обновляется после «Повторить» и «Отменить»', function () {
  function $(id) { return document.getElementById(id); }
  var w = UI.S.wallets.filter(function (x) { return !x.hidden; })[0], d;
  function money(v) { return Engine.fmt(v) + '\u00a0₽'; }
  try {
    dropDebts();
    UI.openCard({ kind: 'wallet', id: w.id });
    var b0 = Engine.walletBalance(UI.S, w.id);
    eq($('cardAmt').textContent, money(b0), 'сценарий: баланс в карточке');
    UI.openAmount({ kind: 'exp', catId: 'e1', walletId: w.id }, 123);
    $('amConfirm').click();
    eq($('cardAmt').textContent, money(Engine.walletBalance(UI.S, w.id)), 'карточка кошелька не обновилась после записи');
    $('toastBtn').click();   // «Отменить»
    eq($('cardAmt').textContent, money(b0), 'карточка кошелька не обновилась после «Отменить»');
    UI.closeCard();
    d = Engine.addDebt(UI.S, { type: 'owe', name: 'Повтор', amount: 50000, pay: 1000, day: 10, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    UI.openCard({ kind: 'debt', id: d.id });
    UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: w.id }, 1000);
    $('amConfirm').click();
    eq($('cardAmt').textContent, money(49000), 'карточка долга не обновилась после записи');
    $('toastBtn').click();
    eq($('cardAmt').textContent, money(50000), 'карточка долга не обновилась после «Отменить»');
  } finally { UI.closeAmount(); UI.hideToast(); UI.closeCard(); dropDebts(); }
});

// Р15: одна ставка - одна цифра. Шапка карточки и строка условий показывают одно и то же
// («5,95 %», как ввели), плитка - тоже; пробел перед % - как везде в приложении. Длинная
// ставка помещается в плитку и в значок шапки.
add('долги Б3 Р15: ставка «5,95 %» одинаково в шапке, в строке карточки, на плитке и в форме', function () {
  function $(id) { return document.getElementById(id); }
  try {
    dropDebts();
    var d = Engine.addDebt(UI.S, { type: 'owe', name: 'Ставка точно', amount: 100000, pay: 5000, day: 10, rate: 5.95, now: 0, date: '2026-01-01' });
    var l = Engine.addDebt(UI.S, { type: 'owe', name: 'Ставка длинная', amount: 100000, pay: 5000, day: 10, rate: 12.95, now: 0, date: '2026-01-01' });
    UI.save(); UI.render();
    var tile = document.querySelector('#app .circle.debt[data-id="' + d.id + '"] .ico');
    eq(tile.textContent, '5,95\u00a0%', 'плитка');
    UI.openCard({ kind: 'debt', id: d.id });
    eq($('cardIco').textContent, '5,95\u00a0%', 'шапка карточки');
    ok($('cardActs').textContent.indexOf('ставка 5,95\u00a0%') >= 0 || ($('cardList') && $('cardList').textContent.indexOf('ставка 5,95\u00a0%') >= 0) ||
      document.getElementById('card').textContent.indexOf('ставка 5,95\u00a0%') >= 0, 'строка условий: ' + document.getElementById('card').textContent.slice(0, 300));
    UI.closeCard();
    // помещается: длинная ставка не вылезает за плитку и за значок шапки
    var lt = document.querySelector('#app .circle.debt[data-id="' + l.id + '"]');
    var r = lt.querySelector('.drate').getBoundingClientRect(), tr = lt.getBoundingClientRect();
    ok(r.width > 0 && r.right <= tr.right - 2, 'ставка 12,95 % вылезает за плитку: ' + r.right + ' > ' + tr.right);
    UI.openCard({ kind: 'debt', id: l.id });
    var hr = document.querySelector('#cardIco .drate').getBoundingClientRect(), ir = $('cardIco').getBoundingClientRect();
    ok(hr.left >= ir.left && hr.right <= ir.right, 'ставка 12,95 % вылезает за значок шапки: ' + hr.width + ' / ' + ir.width);
    UI.closeCard();
    // форма «Настроить» - та же цифра без знака
    UI.editDebt(d.id);
    eq($('deRate').value, '5,95', 'ставка в форме');
    UI.closeDlg();
  } finally { UI.closeDlg(); UI.closeCard(); dropDebts(); }
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
