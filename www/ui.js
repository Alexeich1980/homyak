/* ui.js — оболочка: состояние, рендер главного экрана (доходы → кошельки → расходы),
   меню, диалоги, тост, тема, демо-сид, перетаскивание плиток и экран суммы с калькулятором.
   Карточка кошелька/категории живёт в sheet.js, аналитика — в summary.js. */
(function () {
'use strict';

// Параметры адреса (?demo, ?reel, ?light...) - QA-удобство браузера. В релиз/стор-сборке
// (Access.RELEASE) они не действуют вовсе: ни демо-данных, ни reel-персон, ни переключателя.
var Q = (typeof Access !== 'undefined' && Access.RELEASE) ? '' : location.search;
// reel-режим: промо-скринкасты (reel-сборка Access.REEL или ?reel в адресе). Свой ключ
// хранилища и reel-персоны вместо обычного demo; скрытый переключатель по long-press шапки.
var REEL = (typeof Access !== 'undefined' && Access.REEL) || Q.indexOf('reel') >= 0;
// reel-сборка: метка на корне <html>, чтобы CSS замедлил заливку колец до 1.5 с (съёмка
// хука на 2 сек). Область строго reel — штатные .tfill/.arc не трогаем. Вне reel класса нет.
if (REEL) { try { document.documentElement.classList.add('reel'); } catch (e) {} }
// демо-режим: включён на тест-сборке (Access.DEMO) или явным ?demo в адресе (для QA-скриншотов).
// В reel-режиме demo не активируем — reel имеет приоритет и свой сид/ключ.
var DEMO = !REEL && ((typeof Access !== 'undefined' && Access.DEMO) || Q.indexOf('demo') >= 0);
var KEY = REEL ? 'homyak-reel' : (DEMO ? 'homyak-demo' : 'homyak_v1');
var KEY_OLD = REEL ? 'homyak-reel' : (DEMO ? 'kazna-demo' : 'kazna_v1');   // прежнее рабочее имя — для миграции
var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Объявлены ДО load(): она их и выставляет, а «var … = false» ниже по файлу
// выполнилось бы позже и молча стёрло результат.
var recovered = false;   // упали на состояние по умолчанию из-за порчи хранилища
var saveBroken = false;  // запись в хранилище не проходит

var S = load();
// Порченое хранилище: состояние по умолчанию записываем СРАЗУ, иначе битый текст лежал
// бы под ключом и дальше, и «Данные повреждены» всплывало бы при каждом запуске
// (сам битый текст уже отложен в KEY + '.broken').
if (recovered) save();
if (DEMO || REEL) {   // demo/reel детерминированы параметрами адреса, чтобы кадры повторялись
  S.ui.theme = Q.indexOf('light') >= 0 ? 'light' : 'dark';
  S.ui.incomeCollapsed = Q.indexOf('collapsed') >= 0;
}

// ---------- состояние ----------
// Порченое хранилище раньше валило запуск целиком: window.UI не создавался, на экране
// оставался скелет, меню и восстановление из файла были недоступны — на телефоне это
// лечилось только переустановкой, то есть потерей всех данных. Теперь любой сбой разбора
// откатывает на пустое состояние, а битый текст откладывается в KEY + '.broken' —
// оттуда его ещё можно вытащить руками.
function load() {
  var raw = null, fromOld = false;
  try { raw = localStorage.getItem(KEY); } catch (e) {}
  // Миграция со старого рабочего имени: если под новым ключом пусто, а под прежним
  // (kazna_v1/kazna-demo) данные есть - берём их. Под новый ключ копируем ТОЛЬКО после
  // удачного разбора: битый старый текст иначе переезжал бы под новый ключ и валил бы
  // каждый следующий запуск в «Данные повреждены».
  if (!raw) {
    var old = null;
    try { old = localStorage.getItem(KEY_OLD); } catch (e) {}
    if (old) { raw = old; fromOld = true; }
  }
  var s = loadFrom(raw);
  if (fromOld && !recovered) { try { localStorage.setItem(KEY, raw); } catch (e) {} }
  return s;
}

// вынесено из load() отдельной чистой ступенью: так путь восстановления можно
// прогнать в self-test прямо на телефоне, не подкладывая мусор в боевой ключ
function loadFrom(raw) {
  if (!raw) return Engine.migrate(initialSeed());

  var parsed = null, bad = false;
  try { parsed = JSON.parse(raw); } catch (e) { bad = true; }
  if (!bad && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) bad = true;

  var s = null;
  if (!bad) {
    try { s = Engine.migrate(parsed); } catch (e) { bad = true; }
    if (!s || !Array.isArray(s.tx) || !Array.isArray(s.wallets)) bad = true;
  }
  if (!bad) return s;

  keepBroken(raw);
  recovered = true;
  return Engine.migrate(initialSeed());
}

// Какой сид класть при пустом/порченом хранилище: reel-персона (reel-сборка),
// наполненное демо (тест-сборка) или чистый пресет (релиз). Объявлением, а не
// присваиванием: loadFrom зовётся выше по файлу, до строк инициализации.
function initialSeed() {
  if (REEL) return reelState();
  return DEMO ? demoState() : presetState();
}

function keepBroken(raw) {
  try { localStorage.setItem(KEY + '.broken', String(raw).slice(0, 4 * 1024 * 1024)); } catch (e) {}
}

// Отказ записи раньше глотался молча: экран показывал правду, в хранилище оставалось
// старое, и всё внесённое исчезало при следующем запуске без единого слова. Теперь
// save() честно возвращает false, вешает несъезжающую красную полосу и один раз
// показывает окно — чтобы хозяин успел сделать бэкап в файл.
function save() {
  // сводка на время карточки подменяет S.ui.month в памяти; в хранилище пишем настоящий
  // (иначе вылет приложения с открытой карточкой оставлял экран на чужом месяце навсегда)
  var mem = S.ui.month, keep = (window.UI && window.UI.persistMonth) ? window.UI.persistMonth() : mem;
  try {
    S.ui.month = keep;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } finally { S.ui.month = mem; }
    if (saveBroken) { saveBroken = false; saveBanner(false); }
    return true;
  } catch (e) {
    var first = !saveBroken;
    saveBroken = true;
    saveBanner(true);
    if (first) dlgAlert('Телефон не даёт сохранить данные - в памяти нет места или хранилище закрыто. Сделай бэкап в файл, пока приложение открыто.', 'Не удалось сохранить');
    return false;
  }
}

function saveBanner(on) {
  var el = $('saveWarn');
  if (!el) return;
  el.hidden = !on;
  if (on) el.textContent = 'Не удалось сохранить данные - сделай бэкап в файл';
}

// ---------- утилиты ----------
function $(id) { return document.getElementById(id); }
function each(list, fn) { Array.prototype.forEach.call(list, fn); }
// один pad2 на всё приложение — он живёт в движке. Объявлением, а не присваиванием:
// load() зовётся выше по файлу, до строки инициализации.
function pad2(n) { return Engine.pad2(n); }
// Числа печатает один форматтер — Engine.fmt. На плитках и в шапке показываем целыми
// рублями (копейки там не читаются и дёргают одометр), в карточках и списках операций —
// как есть, с копейками, если они есть.
function fmt(n) { return Engine.fmt(Math.round(Number(n) || 0)); }
function money(v) { return Engine.fmt(v); }
// «Сегодня» главного экрана. Раньше текущий месяц считался только в момент рендера, а
// рендер зовут действия хозяина: приложение на телефоне живёт в памяти сутками, и после
// полуночи 1-го числа экран продолжал показывать прошлый месяц (баг 01.10.2026, найден
// в личном «Хомяке»). Теперь день экрана пересчитывает сам render() и проверка дня на
// возврате из фона / раз в 20 секунд (checkDay ниже). Пока открыто окно (карточка,
// сводка, сумма, диалог, меню, режим правки) или тащат плитку - день не двигаем: месяц
// у окна в руках не меняется, экран догонит после закрытия. Лимиты нового месяца
// render() один раз берёт из прошлого (Engine.carryLimits, решение 01.10.2026), если
// своих нет. Free-гейт от смены месяца не зависит: он считает кошельки и категории.
var screenDay = Engine.today();
function screenYM() { return Engine.ym(screenDay); }
function curYM() { return S.ui.month || screenYM(); }
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function monthLabel(ymStr) {
  var m = parseInt(ymStr.slice(5, 7), 10) - 1;
  return (MONTHS[m] || '') + ' ' + ymStr.slice(0, 4);
}

// уровень и доля заполнения плитки — ровно как в макете:
// расход — движок fill (none / ok / warn / over, over красный);
// доход — по ПЛАНУ, семантика позитивная и НИКОГДА не красная (Engine.fillInc):
//   план не задан (null) — прежний вид: доход есть → синий 'inc', нет → серый 'none';
//   план задан — none/warn(в процессе)/ok(цель взята, зелёный).
function levelOf(kind, fact, plan) {
  if (kind === 'inc') {
    if (plan == null) return { lvl: fact > 0 ? 'inc' : 'none', pct: fact > 0 ? 1 : 0 };
    var fi = Engine.fillInc(fact, plan);
    return { lvl: fi.level, pct: Math.min(fi.ratio, 1) };
  }
  var f = Engine.fill(fact, plan);
  return { lvl: f.level, pct: Math.min(f.ratio, 1) };
}

// Размер кольца адаптивный: его считает fitExp() по ширине колонки и отдаёт сюда.
// Ни одного зашитого 54 / 24.75 / 155.51 в вёрстке плитки не осталось — вся геометрия
// (радиус, обводка, ядро, глиф) выводится из размера в Engine.ringGeom.
var GEO = Engine.ringGeom(Engine.RING_MIN);

// Цветная иллюстрация занимает в кольце больше места, чем линейный глиф: у картинки
// свои поля (краска живёт на ~0.88 её ширины), поэтому коробку берём крупнее — иначе
// иконка выглядит мельче прежней. 0.62 кольца по коробке = ~0.55 по краске.
var ICO_IMG_K = 0.62;
function icoImgPx() { return Math.round(GEO.size * ICO_IMG_K); }
// иконка в кольце: картинка своего размера, а если её на этот ключ нет — цветная
// фишка (диск + глиф в тоне категории), а не голый линейный глиф. hueKey (имя
// категории) задаёт стабильный тон.
function tileIco(icon, kind, hueKey) {
  return Icons.hasImg(icon, kind) ? Icons.img(icon, kind, icoImgPx()) : Icons.chip(icon, kind, icoImgPx(), hueKey);
}

// Размер уезжает в CSS переменными на <body>: строчный стиль перебивает и тёмную,
// и светлую тему, поэтому кольцо в обеих одинаковое.
function applyRingVars(size) {
  GEO = Engine.ringGeom(size);
  var st = document.body.style;
  st.setProperty('--ring', GEO.size + 'px');
  st.setProperty('--ico-size', GEO.ico + 'px');
  st.setProperty('--ico-img', icoImgPx() + 'px');
  st.setProperty('--arc-sw', String(GEO.sw));
  st.setProperty('--arc-in', GEO.inset + 'px');
  return GEO.size;
}

// Эмблемы тем для плитки «Тема»: месяц (ночь) и солнце (день). Линейные глифы в общем
// стиле меню, а не эмодзи — рисуются одинаково в любом WebView и берут цвет плитки.
var MOON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.3A8 8 0 0 1 9.7 4 7 7 0 1 0 20 14.3z"/></svg>';
var SUN_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';

// ---------- рендер плиток ----------
// Значок правки: висит на каждой плитке, но виден только в режиме правки (CSS).
// Тап по нему открывает форму этой плитки — обработчик в edit.js.
var EDIT_BADGE =
  '<button class="tedit" type="button" tabindex="-1" aria-label="Изменить">' +
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 20h4L18.5 9.5l-4-4L4 16z"/><path d="m13.4 6.6 4 4"/>' +
    '</svg>' +
  '</button>';

function tileHtml(kind, id, name, icon, fact, plan, idx, retired) {
  var L = levelOf(kind, fact, plan);
  var pct = L.pct;
  var cls = 'lvl-' + L.lvl + (pct > 0.45 ? ' on-fill' : '');
  return '<div class="circle tile t' + (idx % 6) + (retired ? ' retired' : '') + '" data-kind="' + kind + '" data-id="' + esc(id) + '">' +
    '<div class="ring ' + cls + '" data-pct="' + pctAttr(pct) + '">' +
      '<i class="tfill" style="transform:scaleY(' + pct + ')"></i>' +
      '<svg class="tarc" viewBox="0 0 ' + GEO.size + ' ' + GEO.size + '" aria-hidden="true">' +
        '<circle class="trk" cx="' + (GEO.size / 2) + '" cy="' + (GEO.size / 2) + '" r="' + GEO.r + '"/>' +
        '<circle class="arc" cx="' + (GEO.size / 2) + '" cy="' + (GEO.size / 2) + '" r="' + GEO.r +
          '" style="stroke-dasharray:' + GEO.circ + ';stroke-dashoffset:' + (GEO.circ * (1 - pct)).toFixed(2) + '"/>' +
      '</svg>' +
      '<i class="tin"></i>' +
      '<span class="ico">' + tileIco(icon, kind, name) + '</span>' +
    '</div>' +
    '<div class="cname">' + esc(name) + '</div>' +
    '<div class="cnum lvl-' + L.lvl + '">' + fmt(fact) + ' ₽</div>' +
    '<div class="cplan">' + (plan == null ? '—' : fmt(plan) + ' ₽') + '</div>' +
    EDIT_BADGE +
  '</div>';
}

// класс цвета кошелька: сам градиент и цвет чернил живут в CSS (wc-yellow … wc-graphite)
function wcolor(w) { return 'wc-' + Engine.walletColor(w && w.color); }

function walletHtml(w, bal) {
  return '<div class="circle wcard ' + wcolor(w) + '" data-kind="wallet" data-id="' + esc(w.id) + '">' +
    '<span class="ico">' + Icons.svg(Icons.walletKey(w.icon), 22) + '</span>' +
    '<div class="cname">' + esc(w.name) + '</div>' +
    '<div class="cbal">' + fmt(bal) + ' ₽</div>' +
    EDIT_BADGE +
  '</div>';
}

// Плитка кошелька для списков в окнах: «Настроить кошельки» и «Куда перевести».
// Это та же карточка, что на главном экране (цвет, иконка, имя, баланс), только крупнее
// и кнопкой - хозяин узнаёт свой кошелёк по цвету, а не читает строку списка.
function walletTileHtml(w, o) {
  o = o || {};
  return '<button type="button" class="wtile ' + wcolor(w) + (o.off ? ' off' : '') +
    '" data-id="' + esc(w.id) + '">' +
    '<span class="ico">' + Icons.svg(Icons.walletKey(w.icon), 22) + '</span>' +
    '<span class="wt-n">' + esc(w.name) + '</span>' +
    '<span class="wt-b">' + fmt(Engine.walletBalance(S, w.id)) + ' ₽</span>' +
  '</button>';
}

// Проценты на кольце ОКРУГЛЯЕМ ВНИЗ: 99,999 % не должны читаться как «100». Заливка
// и дуга берут долю сырой, округление живёт только здесь, в надписи-атрибуте.
function pctAttr(p) { return Math.floor(Math.max(0, Math.min(1, p)) * 1000) / 10; }

// ---------- разовая заливка колец при появлении экрана ----------
// Плитки рисуются сразу в КОНЕЧНОМ состоянии (inline scaleY/dashoffset), поэтому без
// анимации (reduced-motion, любой ре-рендер) кольцо всегда показывает верную долю. Один
// раз за сессию, на первом появлении главного экрана, кольца «наливаются» от нуля до
// своей доли: сбрасываем в пустое БЕЗ перехода, дёргаем reflow, возвращаем в цель — и
// CSS-переход .tfill/.arc (уже описан в style.css, ~.45s) проигрывает заливку сам, без
// JS-таймера по кадрам. Категории за лимитом (lvl-over) получают класс .fill-pulse —
// один мягкий доводчик-свечение (CSS-анимация, iteration 1, с задержкой на время
// заливки), затем статично. Никакого бесконечного цикла.
var fillRevealed = false;
function revealRingFills() {
  if (fillRevealed) return;   // «уже проиграно» — минорные ре-рендеры не пере-триггерят
  fillRevealed = true;
  var rings = document.querySelectorAll('#fieldExp .ring, #fieldInc .ring');
  if (!rings.length) { fillRevealed = false; return; }   // ещё нечего наливать — дождёмся сетки
  // доводчик красных колец — одноразовый, только если движение разрешено
  if (!lessMotion()) each(rings, function (r) {
    if (r.classList.contains('lvl-over')) r.classList.add('fill-pulse');
  });
  if (lessMotion()) return;   // без движения заливка уже стоит в конечном виде — выходим
  var saved = [];
  each(rings, function (r) {
    var tf = r.querySelector('.tfill'), a = r.querySelector('.arc');
    var s = { tf: tf, a: a, toTf: tf ? tf.style.transform : '', toArc: a ? a.style.strokeDashoffset : '' };
    if (tf) { tf.style.transition = 'none'; tf.style.transform = 'scaleY(0)'; }
    if (a) { a.style.transition = 'none'; a.style.strokeDashoffset = (parseFloat(a.style.strokeDasharray) || GEO.circ).toFixed(2); }
    saved.push(s);
  });
  void document.getElementById('fieldExp').offsetWidth;   // reflow: зафиксировать пустое состояние
  each(saved, function (s) {
    if (s.tf) { s.tf.style.transition = ''; s.tf.style.transform = s.toTf; }   // '' → вернуть CSS-переход
    if (s.a) { s.a.style.transition = ''; s.a.style.strokeDashoffset = s.toArc; }
  });
}

// уровень плитки без перерисовки — им пользуется анимация прилёта (anim.js)
function applyFill(ring, p) {
  if (!ring) return;
  p = Math.max(0, Math.min(1, p));
  ring.setAttribute('data-pct', pctAttr(p));
  var f = ring.querySelector('.tfill');
  if (f) f.style.transform = 'scaleY(' + p + ')';
  var a = ring.querySelector('.arc');
  // длину окружности читаем с самой дуги: плитка могла быть нарисована другим размером
  if (a) a.style.strokeDashoffset = ((parseFloat(a.style.strokeDasharray) || GEO.circ) * (1 - p)).toFixed(2);
}

// ---------- рендер экранов ----------
// none - значения нет (лимиты не заданы): «—» серым, не отрицательное красное
function sumHtml(el, label, value, neg, none) {
  el.innerHTML = '<div class="sl">' + label + '</div>' +
    '<div class="sv' + (neg ? ' neg' : '') + (none ? ' none' : '') + '" data-suf="">' + value + '</div>';
}

function renderTop() {
  var s = Engine.summary(S, curYM());
  sumHtml($('sumBalance'), 'В кошельках', fmt(s.balance), s.balance < 0);
  sumHtml($('sumSpent'), 'Потрачено', fmt(s.spent), false);
  // Пока не задан ни один лимит, «остаток» считать не из чего. Глухой прочерк «Осталось —»
  // читался как сбой - показываем понятное «Лимиты нет» (задать их можно в карточке категории).
  if (s.remaining === null) sumHtml($('sumRemaining'), 'Лимиты', 'нет', false, true);
  else sumHtml($('sumRemaining'), 'Осталось', fmt(s.remaining), s.remaining < 0);
  $('sums').setAttribute('aria-label', 'Месяц: ' + monthLabel(curYM()) + '. Сменить месяц');
  // во время сворачивания класс ставит сама анимация: перерисовка посреди перехода
  // (пришла операция, синк) иначе схлопнула бы поле рывком
  if (!incAnim) $('fieldInc').classList.toggle('collapsed', !!S.ui.incomeCollapsed);
  renderTopMonth();
}

// строка под шапкой появляется, только когда смотрим не текущий месяц
function renderTopMonth() {
  var el = $('topMonth');
  if (!el) return;
  var cur = curYM(), other = cur !== screenYM();
  if (!other) { el.innerHTML = ''; return; }
  el.innerHTML = '<span class="tm-l">' + esc(monthLabel(cur)) + '</span>' +
    '<button class="tm-back" type="button">к текущему</button>';
  el.querySelector('.tm-back').addEventListener('click', function () {
    S.ui.month = null; save(); render(); haptic('light');
  });
}

function chunk(arr, n) {
  var out = [];
  for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Полный доступ: один источник правды - UI.hasFullAccess (purchase.js). До его загрузки
// (первая отрисовка идёт раньше purchase.js) - флаг сборки Access.FULL.
function hasFull() {
  if (window.UI && window.UI.hasFullAccess) return !!window.UI.hasFullAccess();
  return (typeof Access !== 'undefined') ? !!Access.FULL : true;
}
// упёрлись ли в лимит free по виду плитки: тогда на «+» висит замок, и тап по нему
// ведёт в баннер «Полный доступ» не внезапно
function addLocked(kind) {
  var f = hasFull();
  if (kind === 'wallet') return !Engine.canAddWallet(S, f);
  if (kind === 'inc') return !Engine.canAddIncCat(S, f);
  return !Engine.canAddExpCat(S, f);
}
var LOCK_HTML = '<span class="add-lock" aria-hidden="true">🔒</span>';

// Серая «+»-плитка добавления в конце ленты. НЕ .circle — система перетаскивания её
// не трогает; тап ловит делегированный обработчик ниже и открывает добавление.
function addTileHtml(kind) {
  var locked = addLocked(kind);
  return '<button type="button" class="tile addtile' + (locked ? ' locked' : '') + '" data-add="' + kind +
    '" aria-label="' + (locked ? 'Добавить - нужен полный доступ' : 'Добавить') + '">' +
    '<span class="add-ring" style="width:' + GEO.size + 'px;height:' + GEO.size + 'px">' +
      '<span class="add-plus" aria-hidden="true">+</span>' + (locked ? LOCK_HTML : '') +
    '</span>' +
    '<div class="cname add-cn">Добавить</div>' +
  '</button>';
}
// «+»-плитка кошелька: та же ширина карточки (.wcard), но не .circle — перетаскивание её не трогает
function addWalletTileHtml() {
  var locked = addLocked('wallet');
  return '<button type="button" class="wcard addtile addtile-w' + (locked ? ' locked' : '') + '" data-add="wallet"' +
    ' aria-label="' + (locked ? 'Добавить кошелёк - нужен полный доступ' : 'Добавить кошелёк') + '">' +
    '<span class="add-plus" aria-hidden="true">+</span>' + (locked ? LOCK_HTML : '') +
    '<span class="add-cn">Добавить</span>' +
  '</button>';
}
// тап по «+»-плитке (доход/расход/кошелёк) — открыть добавление
document.addEventListener('click', function (e) {
  var b = e.target && e.target.closest ? e.target.closest('.addtile[data-add]') : null;
  if (!b) return;
  var k = b.getAttribute('data-add');
  haptic('light');
  if (k === 'wallet') { if (window.UI.addWallet) window.UI.addWallet(); }
  else if (window.UI.addCat) { window.UI.addCat(k); }
});

// одна лента страниц: rows рядов по 4 плитки. Возвращает число страниц.
function paintPages(box, dots, list, ymStr, kind, rows, keepPage, addKind) {
  // серая «+»-плитка в конце ленты: тапом открывает добавление (addKind = 'inc'|'exp')
  var items = addKind ? list.concat([{ __add: addKind }]) : list;
  var pages = chunk(items, rows * 4);
  var html = pages.map(function (page, pi) {
    return '<div class="page">' + page.map(function (c, ci) {
      if (c.__add) return addTileHtml(c.__add);
      var idx = pi * rows * 4 + ci;
      var f = Engine.catFact(S, c.id, ymStr), p = Engine.catLimit(S, c.id, ymStr);
      return tileHtml(kind, c.id, c.name, c.icon || Icons.guessKind(c.name, kind), f, p, idx, c.archived);
    }).join('') + '</div>';
  }).join('');
  box.innerHTML = html;
  var n = Math.max(1, pages.length);
  dots.innerHTML = n > 1 ? pages.map(function (p, i) { return '<i></i>'; }).join('') : '';
  var target = Math.max(0, Math.min(keepPage || 0, n - 1));
  box.scrollLeft = target * box.clientWidth;
  each(dots.children, function (d, j) { d.classList.toggle('on', j === target); });
  return n;
}

function curPageOf(box, key, lastKey) {
  return (box.clientWidth && key === lastKey) ? Math.round(box.scrollLeft / box.clientWidth) : 0;
}

// Ключ ленты: по НЕМУ решают, сохранять ли открытую страницу. Раньше в него шёл
// порядок плиток — и перестановка на второй странице выглядела как «пришёл другой
// список», лента прыгала на первую. Состав важен (категорию добавили/увели — начинаем
// с начала), порядок нет: сортируем.
function pagesKey(list, ymStr) {
  return list.map(function (c) { return c.id; }).sort().join(',') + '|' + ymStr;
}

// подсветить точку номер i (остальные погасить)
function paintDots(dots, i) {
  each(dots.children, function (d, j) { d.classList.toggle('on', j === i); });
}

// Тап по точке листает ленту на её страницу. Один обработчик на все три ленты:
// доходы, кошельки, расходы — точки везде одинаковые, значит и поведение одно.
function bindDots(dots, box) {
  if (!dots || !box) return;
  dots.addEventListener('click', function (e) {
    var t = (e.target && e.target.closest) ? e.target.closest('i') : null;
    if (!t || !box.clientWidth) return;
    var i = Array.prototype.indexOf.call(dots.children, t);
    if (i < 0) return;
    scrollToPage(box, i, dots.children.length);
    haptic('light');
  });
}
function scrollToPage(box, i, count) {
  var to = Engine.pageLeft(i, box.scrollWidth, box.clientWidth, count || 1);
  try { box.scrollTo({ left: to, behavior: 'smooth' }); }
  catch (e) { box.scrollLeft = to; }
}

var incLastKey = null;

function renderInc() {
  var ymStr = curYM();
  // с ymStr в хвост попадают архивные категории, по которым в этом месяце всё-таки
  // есть факт: иначе их деньги видны в шапке и не видны на плитках
  var list = Engine.listCategories(S, 'inc', { ymStr: ymStr });
  var box = $('fieldInc').querySelector('.pages');
  var key = pagesKey(list, ymStr);
  var keep = curPageOf(box, key, incLastKey);
  incLastKey = key;
  paintPages(box, $('incDots'), list, ymStr, 'inc', 1, keep, 'inc');
  var fact = 0, plan = 0;
  list.forEach(function (c) {
    fact += Engine.catFact(S, c.id, ymStr);
    plan += Engine.planOr0(S, c.id, ymStr);
  });
  // «из N ₽» только когда план дохода задан хоть у одного источника: «из 0 ₽» на чистом
  // старте читается как ошибка
  var incPlanned = Engine.limitedCount(S, ymStr, 'inc') > 0;
  $('incHeadText').textContent = 'Доходы · ' + fmt(fact) + (incPlanned ? ' из ' + fmt(plan) : '') + ' ₽';
  var col = !!S.ui.incomeCollapsed;
  $('incHead').setAttribute('aria-expanded', col ? 'false' : 'true');
  $('incHead').setAttribute('aria-label',
    (col ? 'Развернуть доходы. ' : 'Свернуть доходы. ') + $('incHeadText').textContent);
}

// ---------- сворачивание доходов ----------
// Тап по заголовку «Доходы · … ₽» убирает плитки доходов, и освободившаяся высота
// уходит в сетку расходов (там становится на ряд больше).
//
// Плавность без прыжка соседей строится так: во время перехода СЕТКА РАСХОДОВ НЕ
// пересчитывается — число рядов держим прежним, и лента кошельков едет вверх/вниз
// только за высотой доходов, а не отдельным скачком. Анимируем ровно два числа:
// высоту блока доходов (max-height/opacity, CSS-переход) и синхронно с ней зазоры
// #app (--fgap, rAF-твин). Зазор конечного состояния меряем ЗАРАНЕЕ — скрытым
// пересчётом в один синхронный проход, без отрисовки, — и доводим до него твином:
// без этого balanceGaps лязгнул бы сеткой в самом конце (соседи «доезжали» бы, а
// потом дёргались назад). Пятый ряд расходов добавляем/убираем уже ПОСЛЕ перехода
// (transitionend), одним relayout — на нём соседи уже стоят на финальных местах.
var INC_MS = 260;
var incAnim = null;      // идёт ли переход (true/таймер) — блокирует второй тап
var incRaf = null;       // rAF-твин зазоров #app

function incBodyEl() { return $('incBody'); }
function appGap() { return px(getComputedStyle($('app')).getPropertyValue('--fgap')) || GAP_MIN; }

function incFinish(body, field) {
  body.style.maxHeight = '';
  body.style.opacity = '';
  field.classList.remove('inc-anim', 'inc-collapsing', 'inc-expanding');
  field.classList.toggle('collapsed', !!S.ui.incomeCollapsed);
}

// линейный твин --fgap от from к to за ms; идёт параллельно CSS-переходу высоты доходов,
// чтобы лента кошельков ползла к финальному месту монотонно, без обгона и отскока
function tweenGap(from, to, ms) {
  var app = $('app');
  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  if (incRaf) cancelAnimationFrame(incRaf);
  (function step() {
    if (!incAnim) { incRaf = null; return; }
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var k = Math.min(1, (now - t0) / ms);
    app.style.setProperty('--fgap', (from + (to - from) * k).toFixed(2) + 'px');
    incRaf = k < 1 ? requestAnimationFrame(step) : null;
  })();
}

function toggleIncome() {
  if (incAnim) return;                        // второй тап посреди перехода не ломает поле
  var field = $('fieldInc'), body = incBodyEl();
  var to = !S.ui.incomeCollapsed;

  if (lessMotion() || !body) {                // «меньше движения» — переложить экран сразу
    S.ui.incomeCollapsed = to; save(); haptic('light');
    if (body) { body.style.maxHeight = ''; body.style.opacity = ''; }
    field.classList.remove('inc-anim', 'inc-collapsing', 'inc-expanding');
    field.classList.toggle('collapsed', to);
    relayout();
    return;
  }

  // 1. Узнаём зазор и высоту доходов КОНЕЧНОГО состояния, затем возвращаем раскладку к
  //    НАЧАЛЬНОЙ. Всё в одном синхронном проходе — между мутациями браузер не рисует,
  //    промежуточных «прыжков» не видно.
  var was = S.ui.incomeCollapsed;
  S.ui.incomeCollapsed = to; relayout();
  var gapEnd = appGap();
  var hEnd = to ? 0 : body.getBoundingClientRect().height;
  S.ui.incomeCollapsed = was; relayout();
  var gapStart = appGap();
  var hStart = to ? body.getBoundingClientRect().height : 0;

  // 2. Фиксируем намерение и запускаем переход от начального вида к конечному.
  S.ui.incomeCollapsed = to; save(); haptic('light');
  incAnim = true;
  $('app').style.setProperty('--fgap', gapStart + 'px');
  field.classList.remove('collapsed');        // высоту во время перехода держим inline
  field.classList.add('inc-anim', to ? 'inc-collapsing' : 'inc-expanding');
  body.style.maxHeight = hStart + 'px';
  body.style.opacity = to ? '1' : '0';
  void body.offsetHeight;                      // старт зафиксирован — дальше один переход
  body.style.maxHeight = hEnd + 'px';
  body.style.opacity = to ? '0' : '1';

  var done = false;
  function finish() {
    if (done) return; done = true;
    clearTimeout(timer);
    body.removeEventListener('transitionend', onEnd);
    incAnim = null;
    if (incRaf) { cancelAnimationFrame(incRaf); incRaf = null; }
    incFinish(body, field);
    relayout();                               // ряды расходов пересчитываем ПОСЛЕ перехода
  }
  function onEnd(e) { if (e.target === body && e.propertyName === 'max-height') finish(); }
  body.addEventListener('transitionend', onEnd);        // штатное завершение
  var timer = setTimeout(finish, INC_MS + 80);          // страховка, если transitionend не придёт
  tweenGap(gapStart, gapEnd, INC_MS);
}

$('incHead').addEventListener('click', toggleIncome);

// Номер открытой страницы ленты кошельков. Держим его снаружи: перерисовка
// затирает содержимое ленты вместе с прокруткой, и без этого перестановка кошелька
// на второй странице кидала бы ленту в начало.
var walPage = 0;

function renderWallets() {
  var ws = S.wallets.filter(function (w) { return !w.hidden; })
    .sort(function (a, b) { return a.order - b.order; });
  var strip = $('fieldWallets').querySelector('.strip');
  var dots = $('walDots');
  // серая «+»-плитка добавления в конце ленты кошельков
  var items = ws.concat([{ __add: 'wallet' }]);
  var pages = Engine.pageCount(items.length, Engine.PAGE_WALLETS);

  // страницу читаем ДО подмены содержимого: после innerHTML прокрутка уже нулевая,
  // и считаем по СТАРОМУ числу страниц - лента сейчас ещё старая
  if (strip.clientWidth) {
    walPage = Engine.pageAt(strip.scrollLeft, strip.scrollWidth, strip.clientWidth, dots.children.length || 1);
  }
  walPage = Math.max(0, Math.min(walPage, pages - 1));

  // Лента разложена СТРАНИЦАМИ ровно по четыре — той же вёрсткой, что доходы и расходы.
  // Раньше это была сплошная прокрутка, которая упиралась в конец: шесть кошельков
  // листались на два, и первые две иконки «второй страницы» повторяли хвост первой.
  // Теперь на странице N стоят кошельки 4N+1…4N+4, а недостающие места остаются
  // пустыми — повторов нет, ход прокрутки кратен ширине окна.
  var html = chunk(items, Engine.PAGE_WALLETS).map(function (page) {
    return '<div class="wpage">' + page.map(function (w) {
      return w.__add ? addWalletTileHtml() : walletHtml(w, Engine.walletBalance(S, w.id));
    }).join('') + '</div>';
  }).join('');
  strip.innerHTML = html;
  // ширина карточки одна и та же при любом числе кошельков (CSS), больше четырёх —
  // лента едет страницами по четыре; класс включает прилипание и точки
  $('fieldWallets').classList.toggle('many', pages > 1);

  dots.innerHTML = pages > 1 ? new Array(pages + 1).join('<i></i>') : '';
  strip.scrollLeft = Engine.pageLeft(walPage, strip.scrollWidth, strip.clientWidth, pages);
  paintDots(dots, walPage);
}

// Выровнять ленту кошельков обратно «по четыре на страницу». Во время перестановки
// палец вставляет карточку в ЧУЖУЮ страницу — в ней становится пять, в соседней три,
// и страницы разъезжаются. Здесь карточки в их текущем порядке в документе
// раскладываются по страницам заново: лента снова читается как сплошной список,
// нарезанный по четыре. Порядок карточек не трогаем — только их родителей, поэтому
// commitOrder читает ровно то, что видит хозяин.
function balanceStrip(strip) {
  if (!strip) return;
  var per = Engine.PAGE_WALLETS;
  var cards = [].slice.call(strip.querySelectorAll('.wcard'));
  if (!cards.length) return;
  var pages = [].slice.call(strip.querySelectorAll('.wpage'));
  var need = Engine.pageCount(cards.length, per);
  while (pages.length < need) {
    var p = document.createElement('div');
    p.className = 'wpage';
    strip.appendChild(p);
    pages.push(p);
  }
  for (var i = 0; i < need; i++) {
    cards.slice(i * per, (i + 1) * per).forEach(function (c) { pages[i].appendChild(c); });
  }
  pages.slice(need).forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); });
}

var expRowsCache = null; // рядов на странице расходов; сброс на resize, пересчёт по замерам
var expRingCache = null; // подобранный размер кольца; сбрасывается вместе с рядами
var expLastKey = null;
var EXP_ROWS = 4;                     // цель: четыре ряда расходов на любом телефоне
// Свёрнутые доходы освобождают ровно высоту одного ряда плиток — значит, целимся
// в пятый ряд. Влезет он или нет, решают те же замеры (Engine.ringFit / ringRows):
// на низком экране останется четыре, меньше прежнего не станет никогда.
var EXP_ROWS_OPEN = 5;
function expRowsMax() { return S.ui.incomeCollapsed ? EXP_ROWS_OPEN : EXP_ROWS; }
var GRID_GAP_X = 2, GRID_GAP_Y = 6;   // те же зазоры, что в .page { gap: 6px 2px }
// Зазоры между шапкой и полями в #app. Нижняя граница опущена с 8 до 6: шапка со
// сводкой стала выше (56 px вместо 44), и на 360×760 четвёртый ряд расходов держится
// именно этими шестью пикселями. Ряд дороже зазора - его не отдаём.
var GAP_MIN = 6, GAP_MAX = 28;

function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

// ширина сетки без внутренних отступов страницы — из неё считается колонка и кольцо
function gridWidth(box) {
  var pg = box.querySelector('.page');
  if (!pg) return box.clientWidth;
  var cs = getComputedStyle(pg);
  return pg.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
}

// высота подписей под кольцом: от размера кольца она не зависит, меряем живую плитку
function labelHeight(box) {
  var c = box.querySelector('.circle');
  if (!c) return 0;
  var r = c.querySelector('.ring');
  return Math.max(0, c.getBoundingClientRect().height - (r ? r.getBoundingClientRect().height : 0));
}

// Сколько высоты остаётся сетке расходов: окно минус остальные блоки #app, минус
// минимальные зазоры между ними, минус собственная обвязка карточки (заголовок,
// точки, отступы). Считаем по минимальному зазору: больше он становится только тогда,
// когда место уже осталось, и рядам это не мешает.
function expAvail(box) {
  var app = $('app'), field = $('fieldExp');
  var acs = getComputedStyle(app);
  var inner = app.clientHeight - px(acs.paddingTop) - px(acs.paddingBottom);
  var used = 0, n = 0;
  each(app.children, function (el) {
    if (getComputedStyle(el).display === 'none') return;
    n++;
    if (el !== field) used += el.getBoundingClientRect().height;
  });
  var bcs = getComputedStyle(box);
  var chrome = field.getBoundingClientRect().height - box.getBoundingClientRect().height
    + px(bcs.paddingTop) + px(bcs.paddingBottom);
  return inner - used - GAP_MIN * Math.max(0, n - 1) - chrome;
}

// Подбор кольца и числа рядов. Идём от «идеального» размера по ширине колонки вниз
// шагами по 2 px, пока четыре ряда не встанут; ниже 54 не опускаемся — если и там не
// влезло (совсем низкий экран), убираем ряд. Кольцо только уменьшается — иначе проход
// за проходом качало бы туда-сюда: высота доходов сама зависит от кольца.
function fitExp(box, dots, list, ymStr, keep) {
  var max = expRowsMax();
  var ring = Engine.ringSize(gridWidth(box), GRID_GAP_X), rows = max;
  for (var pass = 0; pass < 4; pass++) {
    applyRingVars(ring);
    renderInc();                       // доходы на том же кольце: их высота входит в расчёт
    paintPages(box, dots, list, ymStr, 'exp', rows, keep, 'exp');
    if (!list.length) break;
    var label = labelHeight(box), avail = expAvail(box);
    var r2 = Math.min(ring, Engine.ringFit({
      gridW: gridWidth(box), gapX: GRID_GAP_X, rows: max,
      label: label, gap: GRID_GAP_Y, avail: avail
    }));
    var n2 = Engine.ringRows({ ring: r2, label: label, gap: GRID_GAP_Y, avail: avail, max: max });
    if (r2 === ring && n2 === rows) break;
    ring = r2; rows = n2;
  }
  expRingCache = list.length ? ring : null;
  expRowsCache = list.length ? rows : null;
}

// Свободную высоту раздаём ПОРОВНУ в зазоры между шапкой, доходами, кошельками и
// расходами: от 8 до 28 px. Что осталось сверх 28 — остаётся внизу, иначе блоки
// расползались бы к краям экрана.
function balanceGaps() {
  var app = $('app');
  var cs = getComputedStyle(app);
  var inner = app.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  var used = 0, n = 0;
  each(app.children, function (el) {
    if (getComputedStyle(el).display === 'none') return;
    n++; used += el.getBoundingClientRect().height;
  });
  var slots = Math.max(1, n - 1);
  var free = inner - used - GAP_MIN * slots;
  var gap = GAP_MIN + (free > 0 ? Math.min(GAP_MAX - GAP_MIN, Math.floor(free / slots)) : 0);
  app.style.setProperty('--fgap', gap + 'px');
}

function renderExp() {
  var ymStr = curYM();
  var list = Engine.listCategories(S, 'exp', { ymStr: ymStr });
  var box = $('fieldExp').querySelector('.pages');
  var dots = $('expDots');

  var key = pagesKey(list, ymStr);
  var keep = curPageOf(box, key, expLastKey);
  expLastKey = key;

  if (expRingCache === null) {
    fitExp(box, dots, list, ymStr, keep);
  } else {
    applyRingVars(expRingCache);
    paintPages(box, dots, list, ymStr, 'exp', expRowsCache || expRowsMax(), keep, 'exp');
  }
  balanceGaps();

  var fact = 0, plan = 0;
  list.forEach(function (c) {
    fact += Engine.catFact(S, c.id, ymStr);
    plan += Engine.planOr0(S, c.id, ymStr);
  });
  // без единого лимита - просто «Расходы · 500 ₽», без «из 0 ₽»
  var limited = Engine.limitedCount(S, ymStr, 'exp') > 0;
  $('expHead').textContent = 'Расходы · ' + fmt(fact) + (limited ? ' из ' + fmt(plan) : '') + ' ₽';
}

// ---------- длинные суммы в узких местах ----------
// «1 234 567» в колонке шапки и на плитке кошелька обрезалось многоточием: «1 234 5…».
// Ступенчато уменьшаем кегль (по пикселю, до 60 % от штатного), пока число не влезет;
// если не влезло и так - компактная запись «1,23 млн» (полная сумма живёт в data-full и
// в карточке). Одометр (anim.js) после перерисовки пишет в подпись полное число заново -
// наблюдатель ниже перечитывает такие подписи и подгоняет их снова.
var FIT_MIN = 0.6;
var fitMO = null;
function shrinkToFit(el, base) {
  var fs = base;
  while (el.scrollWidth > el.clientWidth && fs - 1 >= base * FIT_MIN) { fs -= 1; el.style.fontSize = fs + 'px'; }
  return el.scrollWidth <= el.clientWidth;
}
function fitOne(el) {
  // прошлая подгонка: вернуть полное число (если наша ужатая подпись ещё на месте) и мерить заново
  var full = el.getAttribute('data-full');
  if (full !== null) {
    if (el.textContent === el.getAttribute('data-short')) el.textContent = full;
    el.removeAttribute('data-full'); el.removeAttribute('data-short');
  }
  el.style.fontSize = '';
  if (!el.clientWidth || el.scrollWidth <= el.clientWidth) return;
  var base = parseFloat(getComputedStyle(el).fontSize) || 14;
  if (shrinkToFit(el, base)) return;
  var text = el.textContent, suf = /\s₽$/.test(text) ? Engine.NBSP + '₽' : '';
  var short = Engine.fmtCompact(unfmt(text)) + suf;
  if (short === text) return;
  el.setAttribute('data-full', text);
  el.setAttribute('data-short', short);
  el.textContent = short;
  el.style.fontSize = '';
  shrinkToFit(el, base);
}
function fitSums() {
  each(document.querySelectorAll('#sums .sv, #fieldWallets .wcard .cbal'), fitOne);
  if (fitMO) fitMO.takeRecords();   // свои же правки подписей наблюдателю не отдаём - иначе петля
}
// одометр пишет полное число обратно в подпись - подгоняем её заново
(function () {
  if (typeof MutationObserver !== 'function') return;
  fitMO = new MutationObserver(function () { fitSums(); });
  var top = $('sums'), strip = $('fieldWallets');
  if (top) fitMO.observe(top, { childList: true, characterData: true, subtree: true });
  if (strip) fitMO.observe(strip, { childList: true, characterData: true, subtree: true });
})();

// Перерисовка с ПОЛНЫМ пересчётом сетки: кольцо и число рядов меряются заново.
// Зовётся там, где поменялась не начинка, а высота экрана — смена темы, поворот,
// сворачивание доходов.
function relayout() { expRowsCache = expRingCache = null; render(); }

function updateDots(box, dots) {
  if (!dots.children.length || !box.clientWidth) return;
  var i = Math.round(box.scrollLeft / box.clientWidth);
  each(dots.children, function (d, j) { d.classList.toggle('on', j === i); });
}

// Номер версии в приложении один и приезжает из package.json через version.js.
// В шапке меню показываем коротко: «0.2.0» → «v0.2» (хвостовой ноль патча не читается),
// в «О приложении» — как есть, полностью.
function appVersion() { return String(window.APP_VERSION || '0'); }
function shortVersion() { return appVersion().replace(/\.0$/, ''); }
// В шапке меню — только major.minor: «0.4.1» → «0.4». Номер сборки и оболочки
// в шапку не выносим, полную версию видно в «Обновление» и «О приложении».
function menuVersion() { return appVersion().split('.').slice(0, 2).join('.'); }
// Версия ОБОЛОЧКИ (APK) — её ставит native.js из App.getInfo(). Бесшовное обновление
// подменяет только www, поэтому номера расходятся: показываем оболочку, лишь когда
// она отстала, чтобы в обычной жизни строка не пестрила.
function shellVersion() { return String(window.SHELL_VERSION || appVersion()); }
function verSuffix() { var s = shellVersion(); return s === appVersion() ? '' : ' · оболочка ' + s; }

// Меню рисуется целиком отсюда: и карточка хомяка-помощника, и подписи плиток.
// sync.js больше не пишет в подписи сам — иначе одно и то же считалось бы дважды.
function renderMenu() {
  var mv = $('menuVer');
  mv.textContent = 'v' + menuVersion();   // только major.minor, без оболочки/сборки
  mv.classList.remove('two');

  // Чип статуса рядом с версией: Pro (золото/ценность) при полном доступе, иначе Free
  // (приглушённый, не красный - это не ошибка). Free тапабельный - мягкий апселл.
  var tier = $('menuTier');
  if (tier) {
    var pro = hasFull();
    tier.textContent = pro ? 'Pro' : 'Free';
    tier.className = 'tier-chip ' + (pro ? 'pro' : 'free');
    tier.hidden = false;
    if (pro) { tier.removeAttribute('role'); tier.removeAttribute('tabindex'); }
    else { tier.setAttribute('role', 'button'); tier.setAttribute('tabindex', '0'); }
  }

  var dark = S.ui.theme === 'dark';
  $('mThemeInfo').textContent = dark ? 'Ночная' : 'Дневная';
  // Иконка = эмблема ТЕКУЩЕЙ темы: месяц у ночной, солнце у дневной. Подпись и значок
  // всегда согласованы; сам тап по-прежнему переключает тему.
  var sw = $('mThemeSwatch');
  sw.className = 'mi-ic';
  sw.innerHTML = dark ? MOON_SVG : SUN_SVG;
  sw.setAttribute('data-theme-ic', dark ? 'moon' : 'sun');

  var hap = S.ui.haptics !== false;
  $('mHapticInfo').textContent = hap ? 'вкл' : 'выкл';
  $('mHapticSw').className = 'mi-sw' + (hap ? ' on' : '');
  $('mHaptic').setAttribute('aria-pressed', hap ? 'true' : 'false');

  var snd = S.ui.sound !== false;
  $('mSoundInfo').textContent = snd ? 'вкл' : 'выкл';
  $('mSoundSw').className = 'mi-sw' + (snd ? ' on' : '');
  $('mSound').setAttribute('aria-pressed', snd ? 'true' : 'false');

  var hnt = S.ui.hints !== false;
  $('mHintsInfo').textContent = hnt ? 'вкл' : 'выкл';
  $('mHintsSw').className = 'mi-sw' + (hnt ? ' on' : '');
  $('mHints').setAttribute('aria-pressed', hnt ? 'true' : 'false');

  var nw = S.wallets.filter(function (w) { return !w.hidden; }).length;
  $('mWalletsInfo').textContent = nw + ' ' + Engine.plural(nw, 'кошелёк', 'кошелька', 'кошельков');

  $('mUpdateInfo').textContent = 'версия ' + appVersion() + verSuffix();
  // Единственный маркер «есть обновление» — мигающая иконка обновления (по просьбе
  // Алексея, других маркеров нет). newer() ставит еженедельная тихая проверка или
  // ручное «Проверить».
  var newer = (window.Update && window.Update.newer) ? window.Update.newer() : '';
  $('mUpdate').classList.toggle('has-upd', !!newer);

  var ci = $('mCatsInfo');
  if (ci) {
    var full = hasFull();
    var ne = Engine.expCatsActiveCount(S);
    ci.textContent = ne + ' ' + Engine.plural(ne, 'категория', 'категории', 'категорий') +
      (full ? '' : ' · до ' + Engine.FREE.expCats);
  }
  var db = $('demoBar');
  if (db) db.hidden = !(S.ui && S.ui.demo);
}

// ---------- снимок отображаемых чисел (для анимаций) ----------
function unfmt(s) {
  var n = Engine.parseNum(String(s == null ? '' : s).replace(/[^\d,.−\-]/g, ''));
  return isFinite(n) ? n : 0;
}
function numEl(c) { return c.querySelector(c.dataset.kind === 'wallet' ? '.cbal' : '.cnum'); }
// подпись могла быть ужата до «1,23 млн» (fitOne) - настоящее число лежит в data-full
function valOf(el) { var f = el.getAttribute('data-full'); return unfmt(f !== null ? f : el.textContent); }
function eachVal(fn) {
  ['sumBalance', 'sumSpent', 'sumRemaining'].forEach(function (id) {
    var box = $(id), el = box ? box.querySelector('.sv') : null;
    if (el) fn('n|' + id, el, valOf(el));
  });
  each(document.querySelectorAll('#app .circle[data-id]'), function (c) {
    var key = c.dataset.kind + '|' + c.dataset.id;
    var v = numEl(c);
    if (v) fn('n|' + key, v, valOf(v));
    var r = c.querySelector('.ring[data-pct]');
    if (r) fn('f|' + key, r, parseFloat(r.getAttribute('data-pct')));
  });
}
function snapVals() {
  var m = {};
  eachVal(function (k, el, v) { m[k] = v; });
  return m;
}
function diffVals(prev) {
  var out = [];
  eachVal(function (k, el, v) {
    if (!(k in prev) || prev[k] === v || !isFinite(v)) return;
    out.push({ type: k.charAt(0) === 'f' ? 'fill' : 'num', el: el, from: prev[k], to: v });
  });
  return out;
}

var firstRender = true;   // первую отрисовку не анимируем: сравнивать не с чем
// Состояние заменили целиком (восстановление из файла, пересев демо, импорт с компа) -
// одометры крутить не с чего: старые числа к новым отношения не имеют, и первый кадр
// после подмены застаёт цифры на полпути. Такую перерисовку делаем мгновенной.
var instantOnce = false;

function dayBusy() {
  if (drag || incAnim) return true;
  try { return !!topOverlay(); } catch (e) { return false; }
}
// Наступил новый день, пока приложение открыто или лежало в фоне: перерисовать экран.
// Смена месяца = «Потрачено», кольца, «Осталось» и доходы с нуля; прошлый месяц
// остаётся в выборе месяца (операции не трогаем - они привязаны к своей дате).
function checkDay() {
  var now = Engine.today();
  if (now === screenDay || dayBusy()) return false;
  renderInstant();          // одометры с прошлого месяца не крутим - это другой месяц
  return true;
}

function render() {
  if (!dayBusy()) {
    var newDay = Engine.today();
    // сменился месяц посреди обычной перерисовки (палец успел раньше проверки дня):
    // одометры с прошлого месяца не крутим и не выдаём разницу за эффект операции
    if (Engine.ym(newDay) !== Engine.ym(screenDay)) instantOnce = true;
    screenDay = newDay;
  }
  // новый месяц получает лимиты прошлого, если своих нет (один раз, см. Engine.carryLimits)
  if (Engine.carryLimits(S, screenYM())) save();
  var prev = (firstRender || instantOnce) ? null : snapVals();
  instantOnce = false;
  document.body.dataset.theme = S.ui.theme;
  renderTop(); renderInc(); renderWallets(); renderExp(); renderMenu();
  fitSums();
  document.querySelector('meta[name=theme-color]').content = S.ui.theme === 'dark' ? '#0F1F24' : '#E9E7F2';
  if (prev && window.UI.onValuesChanged) {
    var ch = diffVals(prev);
    if (ch.length) window.UI.onValuesChanged(ch);
  }
  firstRender = false;
  updateMainHint();
  if (window.UI.afterRender) window.UI.afterRender();
  revealRingFills();   // разовая заливка колец при первом появлении экрана
}

// то же самое, но без анимации чисел: зовётся после полной замены состояния
function renderInstant() { instantOnce = true; render(); }

// ---------- диалоги ----------
// #dlgHint - стабильный узел (свайп гашения привязан один раз). Окно «Категории»
// переносит его к себе в тело, под вкладки; перед любым новым окном и при закрытии
// возвращаем на штатное место - иначе innerHTML='' тела унёс бы его с собой.
function homeDlgHint() {
  var dh = $('dlgHint'), dlg = $('dlg');
  if (dh && dlg && dh.parentNode !== dlg) dlg.insertBefore(dh, $('dlgBtns'));
}
function openDlg(o) {
  homeDlgHint();
  // Свайп-вниз по шапке закрывает только те окна, что сами себя пометят (список
  // кошельков). Каждое новое окно стартует без метки — прошлая на нём не остаётся.
  $('dlg').classList.remove('dlg-swipe');
  var t = $('dlgTitle');
  t.textContent = o.title || ''; t.hidden = !o.title;
  var b = $('dlgBody');
  b.innerHTML = o.body || ''; b.hidden = !o.body;
  var box = $('dlgBtns'); box.innerHTML = '';
  // три кнопки в ряду не помещаются подписями — им отдельный, более плотный набор
  box.className = 'dlg-btns' + ((o.buttons || []).length > 2 ? ' three' : '');
  (o.buttons || []).forEach(function (spec) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'btn ' + (spec.cls || 'ghost');
    el.textContent = spec.label;
    el.addEventListener('click', function () {
      if (spec.onClick && spec.onClick() === false) return;
      closeDlg();
    });
    box.appendChild(el);
  });
  // onClose — вызывается при закрытии окна (кнопка без onClick→false, фон, свайп).
  // Одноразовый и привязан к текущему окну: новое openDlg перезаписывает его. Кнопка,
  // чей onClick вернул false, окно не закрывает — значит onClose тут и не сработает.
  dlgOnClose = (typeof o.onClose === 'function') ? o.onClose : null;
  // Ситуативная подсказка внутри окна: стабильный узел #dlgHint (свайп привязан один раз),
  // текст и видимость ставит вызывающий через o.hint = {key, text}. По умолчанию скрыта -
  // так каждое новое окно стартует без чужой подсказки.
  var dh = $('dlgHint');
  if (dh) {
    var hk = o.hint && o.hint.key, showH = !!(hk && hintShouldShow(hk));
    if (showH) { dh.setAttribute('data-hint', hk); dh.querySelector('.dh-t').textContent = o.hint.text || ''; }
    else dh.setAttribute('data-hint', '');
    dh.hidden = !showH;
  }
  $('dlgBg').hidden = false;
  $('dlg').hidden = false;
  if (o.onOpen) o.onOpen();
  updateMainHint();
}
var dlgOnClose = null;
function closeDlg() {
  var cb = dlgOnClose; dlgOnClose = null;   // снимаем до вызова: cb может открыть новое окно
  homeDlgHint();
  $('dlg').hidden = true;
  $('dlgBg').hidden = true;
  $('dlgBtns').innerHTML = '';
  $('dlgBody').innerHTML = '';
  updateMainHint();
  if (cb) { try { cb(); } catch (e) {} }
}
function dlgOpen() { return !$('dlg').hidden; }

function dlgConfirm(o) {
  o = o || {};
  openDlg({
    title: o.title || '',
    body: o.text ? esc(o.text) : '',
    buttons: [
      { label: o.cancelLabel || 'Отмена', cls: 'ghost' },
      { label: o.okLabel || 'Да', cls: o.danger ? 'danger' : 'primary', onClick: function () { if (o.onOk) o.onOk(); } }
    ]
  });
}
function dlgAlert(text, title) {
  openDlg({ title: title || '', body: esc(text || ''), buttons: [{ label: 'Понятно', cls: 'primary' }] });
}
function dlgPrompt(o) {
  o = o || {};
  var body = (o.label ? '<span class="lbl">' + esc(o.label) + '</span>' : '') +
    '<input class="inp" id="dlgInput" type="' + (o.type || 'text') + '"' +
    (o.inputmode ? ' inputmode="' + esc(o.inputmode) + '"' : '') +
    ' value="' + esc(o.value == null ? '' : o.value) + '"' +
    (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>';
  openDlg({
    title: o.title || '',
    body: body,
    buttons: [
      { label: 'Отмена', cls: 'ghost' },
      { label: o.okLabel || 'Сохранить', cls: 'primary', onClick: function () {
        var v = $('dlgInput').value;
        return o.onOk ? o.onOk(v) : undefined;
      } }
    ],
    onOpen: function () {
      var i = $('dlgInput');
      if (o.money) moneyInput(i);
      i.focus(); i.select();
      i.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('dlgBtns').lastChild.click(); }
      });
    }
  });
}

// Поле, куда вводят сумму: пока курсор внутри — не мешаем, разряды расставляем по blur.
// Ноль по тапу уходит сам: иначе на телефоне приходится сначала стирать «0», а мимо
// него палец промахивается и в базу уезжает «0 12 000».
function moneyInput(el) {
  if (!el || el.dataset.money) return;
  el.dataset.money = '1';
  el.addEventListener('focus', function () {
    if (Engine.parseNum(el.value) === 0) el.value = '';
  });
  el.addEventListener('blur', function () {
    if (String(el.value).trim() === '') { el.value = Engine.fmt(0); return; }
    var n = Engine.parseNum(el.value);
    if (isFinite(n)) el.value = Engine.fmt(n);
  });
}

// Поле суммы с калькулятором (правка операции): под полем ряд кнопок + − × ÷ =,
// потому что на цифровой клавиатуре Android этих знаков нет. Пока в поле выражение,
// под кнопками виден итог «= 450 ₽»; по «=» и при уходе из поля выражение сворачивается
// в сумму. Кнопки не отнимают фокус (pointerdown без действия по умолчанию), иначе
// клавиатура прыгала бы на каждом знаке. Считает Engine.calcAmount.
var CALC_OPS = '+−×÷';
function calcInput(el, ops, res) {
  if (!el || el.dataset.calc) return;
  el.dataset.calc = '1';
  function paint() {
    if (!res) return;
    if (!Engine.hasCalcOp(el.value)) { res.hidden = true; return; }
    var v = Engine.calcAmount(el.value);
    res.textContent = isFinite(v) ? '= ' + Engine.fmt(v) + ' ₽' : 'Не получается посчитать';
    res.classList.toggle('bad', !isFinite(v));
    res.hidden = false;
  }
  function collapse() {
    if (String(el.value).trim() === '') { el.value = Engine.fmt(0); paint(); return; }
    var v = Engine.calcAmount(el.value);
    if (isFinite(v)) el.value = Engine.fmt(v);
    paint();
  }
  // ноль по тапу уходит сам, но только голый ноль: «0+» после нажатия знака не стираем
  el.addEventListener('focus', function () {
    if (!Engine.hasCalcOp(el.value) && Engine.calcAmount(el.value) === 0) el.value = '';
  });
  el.addEventListener('input', paint);
  // уход фокуса на кнопку-знак - не уход из поля: иначе «100+50», нажали «×» -
  // выражение свернулось бы в «150×» и порядок действий поменялся
  el.addEventListener('blur', function (e) {
    if (ops && e.relatedTarget && ops.contains(e.relatedTarget)) return;
    collapse();
  });
  if (!ops) return;
  // и сами кнопки не забирают фокус: pointerdown на части WebView фокус всё равно
  // переносит, надёжно держит только mousedown
  ['pointerdown', 'mousedown'].forEach(function (ev) {
    ops.addEventListener(ev, function (e) { if (e.target.closest('[data-op]')) e.preventDefault(); });
  });
  ops.addEventListener('click', function (e) {
    var b = e.target.closest('[data-op]');
    if (!b) return;
    var k = b.dataset.op;
    if (k === '=') { collapse(); return; }
    var v = String(el.value);
    var at = document.activeElement === el && el.selectionStart != null ? el.selectionStart : v.length;
    var to = document.activeElement === el && el.selectionEnd != null ? el.selectionEnd : v.length;
    var head = v.slice(0, at);
    if (!head.trim()) return;                                   // знак без числа перед ним - мимо
    if (CALC_OPS.indexOf(head.slice(-1)) >= 0 || /[+\-*/]$/.test(head)) head = head.slice(0, -1);   // второй знак подряд меняет первый
    el.value = head + k + v.slice(to);
    el.focus();
    try { el.setSelectionRange(head.length + 1, head.length + 1); } catch (x) {}
    haptic('light');
    paint();
  });
}

// закрытие по фону — только если pointerdown И pointerup оба на фоне (не задеть выделение текста)
function bindBackdropClose(el, closeFn) {
  var down = false;
  el.addEventListener('pointerdown', function (e) { down = (e.target === el); });
  el.addEventListener('pointerup', function (e) {
    if (down && e.target === el) closeFn();
    down = false;
  });
}
bindBackdropClose($('dlgBg'), closeDlg);

// ---------- закрывающий свайп ----------
// Жест ЗАЧИНАЕТСЯ только на переданном элементе (ручка листа, его шапка, панель меню),
// а дальше следим за пальцем по всему документу: 80 px вниз уводят палец с шапки, и
// слушатель на ней самой потерял бы жест. Списки внутри листов при этом прокручиваются
// как обычно - оттуда свайп просто не начинается.
function bindSwipeClose(el, dir, closeFn, guard) {
  if (!el) return;
  var g = null;
  function stop() { g = null; }
  el.addEventListener('pointerdown', function (e) {
    if (e.button) return;
    if (guard && !guard()) return;   // напр. закрывать телом только когда список прокручен вверх
    g = { pid: e.pointerId, x: e.clientX, y: e.clientY };
  });
  document.addEventListener('pointermove', function (e) {
    if (!g || e.pointerId !== g.pid) return;
    if (!Engine.swipeCloses(e.clientX - g.x, e.clientY - g.y, dir)) return;
    stop();
    haptic('light');
    closeFn();
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (g && e.pointerId === g.pid) stop(); });
  });
}

// ---------- тост ----------
var toastTimer = null;
function hideToast() {
  clearTimeout(toastTimer); toastTimer = null;
  $('toast').hidden = true;
  $('toastBtn').onclick = null;
}
function toast(text, o) {
  o = o || {};
  clearTimeout(toastTimer);
  $('toastText').textContent = text;
  var b = $('toastBtn');
  if (o.action) {
    b.textContent = o.action; b.hidden = false;
    b.onclick = function () { hideToast(); if (o.onAction) o.onAction(); };
  } else {
    b.hidden = true; b.onclick = null;
  }
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, o.ms || 5000);
}

// ---------- вибро ----------
// Хозяин сказал: отклик почти не чувствуется. Подняли ещё на ступень:
// «средний» - это удар HEAVY И следом вибрация 120 мс (impact один почти не слышно);
// бросок/успех операции - короткий ДВОЙНОЙ толчок (две вибрации по 60 мс с зазором
// ~90 мс) - его хочется отчётливо почувствовать. «Лёгкий» остаётся MEDIUM. В браузере
// (QA в браузере) плагина нет - падаем на navigator.vibrate с тем же рисунком.
// Вызывается только по явному действию (тап/бросок/сохранение), не на прокрутке.
function hapGuard(p) { try { if (p && typeof p.catch === 'function') p.catch(function () {}); } catch (e) {} }
function haptic(kind) {
  if (S && S.ui && S.ui.haptics === false) return;   // выключено в настройках
  try {
    var N = window.NativePlugins;
    if (window.isNativeApp && window.isNativeApp() && N && N.Haptics) {
      var H = N.Haptics;
      if (kind === 'drop') {
        hapGuard(H.vibrate({ duration: 60 }));
        setTimeout(function () { hapGuard(H.vibrate({ duration: 60 })); }, 90);
      } else if (kind === 'medium') {
        hapGuard(H.impact({ style: 'HEAVY' }));
        hapGuard(H.vibrate({ duration: 120 }));
      } else {
        hapGuard(H.impact({ style: 'MEDIUM' }));
      }
      return;
    }
  } catch (e) {}
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'drop' ? [60, 40, 60] : kind === 'medium' ? 120 : 45);
    }
  } catch (e) {}
}

// ---------- звук ----------
// Звук - украшение: его может не быть (файлы кладут отдельно), он может быть выключен
// в меню, и падать из-за него приложение не должно. Поэтому одна обёртка на всех.
function sound(name) {
  try { if (window.Sound) window.Sound.play(name); } catch (e) {}
}

// ---------- подсказки-хомяки ----------
// Общий выключатель S.ui.hints и набор погашенных свайпом подсказок S.ui.hintsDismissed
// (ключ подсказки → true). Подсказку показываем только там, где её действие возможно.
// reel-сборка: ситуативные подсказки засоряют кадр промо-скринкаста — глушим их
// насовсем (централизованный гейт, через него проходит и hintShouldShow). Вне reel
// поведение прежнее: общий выключатель S.ui.hints.
function hintsOn() { return !REEL && (!S || !S.ui || S.ui.hints !== false); }
function hintDismissed(key) { return !!(S && S.ui && S.ui.hintsDismissed && S.ui.hintsDismissed[key]); }
function hintShouldShow(key) { return hintsOn() && !hintDismissed(key); }
function dismissHint(key) {
  if (!S.ui.hintsDismissed) S.ui.hintsDismissed = {};
  if (S.ui.hintsDismissed[key]) return;
  S.ui.hintsDismissed[key] = true;
  save();
}
// Свайп в ЛЮБУЮ сторону по подсказке гасит её навсегда (для этого ключа). key может быть
// функцией — тогда ключ вычисляется в момент жеста (у карточки он зависит от вида).
// Порог короткий, чтобы смахнуть было легко, но случайный тап подсказку не убирал.
function bindHintSwipe(el, key, onGone) {
  if (!el) return;
  var g = null;
  // Жест ловим на документе по ПОПАДАНИЮ в рамку подсказки: так это работает и когда у
  // подсказки pointer-events:none (главная подсказка сквозная, чтобы не блокировать плитки).
  function inEl(x, y) {
    if (el.hidden) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  document.addEventListener('pointerdown', function (e) {
    if (e.button) { g = null; return; }
    g = inEl(e.clientX, e.clientY) ? { pid: e.pointerId, x: e.clientX, y: e.clientY } : null;
  }, true);
  function fire() {
    var k = (typeof key === 'function') ? key() : key;
    haptic('light');
    if (k) dismissHint(k);
    if (onGone) onGone();
  }
  document.addEventListener('pointermove', function (e) {
    if (!g || e.pointerId !== g.pid) return;
    if (Math.abs(e.clientX - g.x) < 24 && Math.abs(e.clientY - g.y) < 24) return;
    g = null;
    fire();
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (g && e.pointerId === g.pid) g = null; });
  });

  // Тач: пассивный pointermove браузер на телефоне уводит в нативную прокрутку (страница
  // или лента расходов под подсказкой) и шлёт pointercancel — жест гас, не дойдя до порога.
  // Тут ловим свой touchmove НЕ passive: как только жест из рамки подсказки прошёл порог,
  // гасим прокрутку preventDefault и смахиваем. Только для жеста, начатого в подсказке —
  // прочие прокрутки не трогаем.
  var t = null;
  function touchIn(list) { for (var i = 0; i < list.length; i++) if (list[i].identifier === t.id) return list[i]; return null; }
  document.addEventListener('touchstart', function (e) {
    var to = e.changedTouches && e.changedTouches[0];
    t = (to && inEl(to.clientX, to.clientY)) ? { x: to.clientX, y: to.clientY, id: to.identifier } : null;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!t) return;
    var to = touchIn(e.touches); if (!to) return;
    if (Math.abs(to.clientX - t.x) < 24 && Math.abs(to.clientY - t.y) < 24) return;
    if (e.cancelable) e.preventDefault();   // не отдаём жест прокрутке
    t = null;
    fire();
  }, { passive: false });
  ['touchend', 'touchcancel'].forEach(function (ev) {
    document.addEventListener(ev, function () { t = null; }, { passive: true });
  });
}

// Главный экран показывает подсказки ОЧЕРЕДЬЮ, по одной за раз: сперва «задай баланс»
// (balance - пока есть кошелёк с нулевой точкой отсчёта и ни одной операции: пресет
// первого запуска даёт кошельки с 0), затем «подними и неси» (mainDrag), затем - когда
// та погашена - про цвет кружка (fill, только если на экране есть цветной, не серый
// кружок расхода), затем про тапы (taps). Первую непогашенную применимую из этой
// цепочки и показываем; текст в #mainHint подменяем под неё.
// Текст mainDrag — из разметки (там его правит регламент og/копий), не дублируем строкой.
var MAIN_HINT_DEFAULT = (function () {
  var t = $('mainHint'); t = t && t.querySelector('.mh-t');
  return t ? t.textContent : '';
})();
var MAIN_HINTS = {
  balance: 'Сначала укажи, сколько у тебя сейчас в кошельке: тап по кошельку → «Изменить баланс».',
  fill: 'Кружок - траты к лимиту: зелёный - в норме, оранжевый - близко к лимиту, красный - лимит превышен, серый - лимита нет.',
  taps: 'Тап по плитке - её операции и детали. Долгий тап - изменить порядок и иконку.'
};
function mainHintText(key) { return key === 'mainDrag' ? MAIN_HINT_DEFAULT : (MAIN_HINTS[key] || ''); }
// есть ли на экране хоть один ЦВЕТНОЙ (не серый) кружок расхода — тогда уместна подсказка про цвет
function hasColorCircle() {
  return !!document.querySelector('#app .circle[data-kind="exp"] .ring.lvl-ok,' +
    '#app .circle[data-kind="exp"] .ring.lvl-warn,#app .circle[data-kind="exp"] .ring.lvl-over');
}
// баланс ещё не задан: есть видимый кошелёк с base 0 и ни одной операции
function needsBalance() {
  if (S.tx.length) return false;
  return S.wallets.some(function (w) { return !w.hidden && w.base === 0; });
}
// какую подсказку главного экрана показывать сейчас (null — никакую)
function mainHintKey() {
  var haveTiles = document.querySelectorAll('#app .circle[data-kind="wallet"]').length > 0 &&
                  document.querySelectorAll('#app .circle[data-kind="exp"]').length > 0;
  if (!haveTiles || overlayBlocks() || editModeOn() || document.body.classList.contains('dragging')) return null;
  if (hintShouldShow('balance') && needsBalance()) return 'balance';
  if (hintShouldShow('mainDrag')) return 'mainDrag';
  if (hintShouldShow('fill') && hasColorCircle()) return 'fill';
  if (hintShouldShow('taps')) return 'taps';
  return null;
}
function updateMainHint() {
  // «+» видно только на чистом главном экране: любой открытый поверх слой (лист суммы,
  // карточка, меню, аналитика, онбординг, окно) его прячет. Режим правки гасит CSS.
  var fab = $('fabAdd');
  if (fab) fab.hidden = !!topOverlay();
  var el = $('mainHint');
  if (!el) return;
  var key = mainHintKey();
  if (key) { var t = el.querySelector('.mh-t'); if (t) t.textContent = mainHintText(key); }
  el.setAttribute('data-hint', key || '');
  el.hidden = !key;
}

// ---------- отклик на касание ----------
// Палец лёг на плитку — она подрастает (класс is-pressed, дальше всё делает CSS).
// Один зажатый элемент на всё приложение: второй палец перехватывает отклик у первого.
var pressEl = null, pressPid = -1, pressX = 0, pressY = 0, pressTimer = null;

function pressSet(el, e) {
  pressUnset();
  pressEl = el; pressPid = e.pointerId; pressX = e.clientX; pressY = e.clientY;
  el.classList.add('is-pressed');
}
function pressUnset() {
  clearTimeout(pressTimer); pressTimer = null;
  if (pressEl) pressEl.classList.remove('is-pressed', 'is-lifted');
  pressEl = null; pressPid = -1;
}
// плитку «подняли» (см. pickUp): она растёт ещё заметнее, чем под простым нажатием
function pressLift() { if (pressEl) pressEl.classList.add('is-lifted'); }
// Тап открывает карточку не мгновенно: если снять увеличение прямо в pointerup, палец
// увидит только мигание. Держим ещё ms, пока экран поверх не выехал; pressEl при этом
// остаётся выставленным — тогда следующий pressSet/pressUnset честно снимет класс.
function pressUnsetSoon(ms) {
  if (!pressEl) return;
  pressPid = -1;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(pressUnset, ms);
}
function lessMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

// ---------- перетаскивание плиток ----------
var drag = null;      // {srcEl, kind, id, ghost, gw, gh, gs, startX, startY, active, picked, tapOnly, pid}
var dragOver = null;

// что значит бросок «источник → цель» (null = ничего не делаем). Разрешён ли сам
// вид переноса — решает движок (Engine.dropAllowed); здесь только собираем операцию
// и отсеиваем кошелёк, брошенный сам на себя.
function resolveDrop(srcKind, srcId, tgtKind, tgtId) {
  if (!srcKind || !tgtKind || !Engine.dropAllowed(srcKind, tgtKind)) return null;
  if (srcKind === 'wallet' && tgtKind === 'exp') return { kind: 'exp', walletId: srcId, catId: tgtId };
  if (srcKind === 'inc' && tgtKind === 'wallet') return { kind: 'inc', catId: srcId, walletId: tgtId };
  if (srcKind === 'wallet' && tgtKind === 'wallet' && tgtId !== srcId) return { kind: 'transfer', walletId: srcId, toWalletId: tgtId };
  return null;
}

// призрак — клон самой плитки: у кошелька и категории разная форма, копировать
// одно кольцо больше нельзя
function makeGhost(el) {
  var r = el.getBoundingClientRect();
  var g = el.cloneNode(true);
  g.removeAttribute('data-id');
  g.classList.add('dragghost');
  g.style.width = r.width + 'px';
  document.body.appendChild(g);
  return { el: g, w: r.width, h: r.height };
}

function targetAt(x, y) {
  var g = drag && drag.ghost;
  if (g) g.style.visibility = 'hidden';
  var el = document.elementFromPoint(x, y);
  if (g) g.style.visibility = '';
  var c = (el && el.closest) ? el.closest('.circle') : null;
  return (c && c !== drag.srcEl && !c.classList.contains('dragghost')) ? c : null;
}

// Подсвечиваем только ту плитку, на которую бросок правда сработает: расход под
// кошельком, кошелёк под доходом или другим кошельком. Решает это тот же resolveDrop,
// что и сам бросок в pointerup, — второй проверки «можно ли сюда» в приложении нет.
function highlight(t) {
  if (t && drag && !resolveDrop(drag.kind, drag.id, t.dataset.kind, t.dataset.id)) t = null;
  if (dragOver === t) return;
  if (dragOver) dragOver.classList.remove('is-target');
  dragOver = t;
  if (t) t.classList.add('is-target');
}

// Лента крадёт горизонтальный жест только когда ей правда есть куда ехать,
// и только под пальцем: мышью ленту не тянут.
function stripScrolls(el, pointerType) {
  if (pointerType === 'mouse') return false;
  var sc = (el && el.closest) ? el.closest('.strip, .pages') : null;
  return !!sc && sc.scrollWidth - sc.clientWidth > 4;
}

// ---------- край поля во время ПЕРЕНОСА операции ----------
// Пока плитку несут пальцем, у полей overflow:hidden — сами они не листаются. Но цель
// переноса может лежать на другой странице: кошелёк на 2-й странице ленты, категория
// на 2-й странице расходов. Поэтому палец, задержавшийся у края того поля, что сейчас
// ПОД пальцем, сам листает — и сетки (.pages), и лента кошельков (.strip)
// переворачиваются ЦЕЛОЙ страницей: у ленты они теперь такие же, по четыре карточки.
// Подкрутки по пикселям больше нет. Тот же приём, что и в режиме правки (edit.js).
var D_EDGE_PAD = 24, D_EDGE_HOLD = 500;
var dEdge = null;   // {box, side, timer, raf} — держится, только пока палец у края

function dEdgeSide(x, rect) {
  if (!rect || !(rect.width > 0)) return 0;
  if (x <= rect.left + D_EDGE_PAD) return -1;
  if (x >= rect.right - D_EDGE_PAD) return 1;
  return 0;
}
function dEdgeStop() {
  if (!dEdge) return;
  clearTimeout(dEdge.timer);
  if (dEdge.raf) { try { cancelAnimationFrame(dEdge.raf); } catch (e) {} }
  dEdge = null;
}
// какое прокручиваемое поле сейчас под пальцем (призрак на миг прячем, как в targetAt)
function boxUnder(x, y) {
  var g = drag && drag.ghost;
  if (g) g.style.visibility = 'hidden';
  var el = document.elementFromPoint(x, y);
  if (g) g.style.visibility = '';
  return (el && el.closest) ? el.closest('.pages, .strip') : null;
}
function dFlipPage(box, side) {
  var w = box.clientWidth;
  if (!w) return;
  var to = Math.max(0, Math.min(box.scrollWidth - w, Math.round(box.scrollLeft / w) * w + side * w));
  if (Math.abs(to - box.scrollLeft) < 2) return;             // дальше листать некуда
  try { box.scrollTo({ left: to, behavior: 'smooth' }); }
  catch (e) { box.scrollLeft = to; }
  haptic('light');
}
function dEdgeWatch(x, y) {
  if (!drag || !drag.active) return dEdgeStop();
  var box = boxUnder(x, y);
  if (!box || box.scrollWidth - box.clientWidth <= 4) return dEdgeStop();
  var side = dEdgeSide(x, box.getBoundingClientRect());
  if (!side) return dEdgeStop();
  if (dEdge && dEdge.box === box && dEdge.side === side) return;   // уже ждём с этой стороны
  dEdgeStop();
  dEdge = { box: box, side: side, timer: null, raf: 0 };
  dEdge.timer = setTimeout(function () { dFlipPage(box, side); dEdgeStop(); }, D_EDGE_HOLD);
}

// Бросок мимо валидной цели ничего не пишет — но и не должен «телепортировать»
// плитку домой рывком: призрак плавно уезжает в свою ячейку за 200 мс (без звука
// и вибро), и только потом источник снова проявляется. При reduced-motion — сразу.
var SNAP_MS = 200;
function endDrag(snap) {
  dEdgeStop();
  pressUnset();
  if (dragOver) { dragOver.classList.remove('is-target'); dragOver = null; }
  var d = drag;
  drag = null;
  document.body.classList.remove('dragging');
  updateMainHint();
  if (!d) return;
  var done = function () {
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.srcEl) {
      d.srcEl.classList.remove('dragsrc');
      try { d.srcEl.releasePointerCapture(d.pid); } catch (e) {}
    }
  };
  if (snap && d.ghost && d.srcEl && d.srcEl.isConnected && !lessMotion()) {
    var r = d.srcEl.getBoundingClientRect();
    var tx = r.left + r.width / 2 - d.gw / 2, ty = r.top + r.height / 2 - d.gh / 2;
    d.ghost.classList.add('snapback');
    d.ghost.style.transition = 'transform ' + SNAP_MS + 'ms cubic-bezier(.22,.68,.32,1)';
    // конечный transform — следующим кадром, иначе перехода не будет
    requestAnimationFrame(function () {
      if (!d.ghost) return;
      d.ghost.style.transform = 'translate(' + tx + 'px,' + ty + 'px)' + (d.gs || '');
    });
    setTimeout(done, SNAP_MS + 40);
  } else {
    done();
  }
}
function cancelDrag() { if (drag) endDrag(); }

// Нажатие делится по времени - пороги и сама развилка живут в движке (Engine.pressPhase),
// поэтому её можно проверить без браузера:
//   0…150 мс   сдвинул - лента листается, как раньше;
//   150 мс     плитка «поднята»: дальше она едет за пальцем В ЛЮБУЮ сторону, лента стоит;
//   500 мс     не двигал вовсе - режим правки (живёт в edit.js).
// До этого кошелёк на кошелёк можно было перенести только дугой сверху: любой
// горизонтальный сдвиг лента забирала себе.
var lp = null;        // {pid, x, y, pick, edit}
function lpCancel() {
  if (!lp) return;
  clearTimeout(lp.pick); clearTimeout(lp.edit);
  lp = null;
}
// сдвинулись - в правку уже не попадаем; а если не успели подняться, то это прокрутка
function lpMoved() {
  if (!lp) return;
  clearTimeout(lp.edit);
  if (drag && drag.picked) { lp.edit = null; return; }
  lpCancel();
}

function cardOpen() { return !!(window.UI.cardOpen && window.UI.cardOpen()); }
function summaryOpen() { return !!(window.UI.summaryOpen && window.UI.summaryOpen()); }
function transferOpen() { return !!(window.UI.transferOpen && window.UI.transferOpen()); }
function iconSheetOpen() { return !!(window.UI.iconSheetOpen && window.UI.iconSheetOpen()); }
function editModeOn() { return document.body.classList.contains('editmode'); }
function onboardOpen() { var ob = $('onboard'); return !!ob && !ob.hidden; }

// Что сейчас лежит поверх главного экрана. Порядок слоёв (кто «верхний») знает движок:
// Engine.topOverlay. Отсюда же берут ответ и кнопка «назад», и Escape, и запрет жестов.
function overlayFlags() {
  return {
    onboard: onboardOpen(),
    icons: iconSheetOpen(), dialog: dlgOpen(), amount: amountOpen(),
    transfer: transferOpen(), card: cardOpen(), summary: summaryOpen(),
    menu: menuOpen(), edit: editModeOn()
  };
}
function topOverlay() { return Engine.topOverlay(overlayFlags()); }
// режим правки жестам не мешает - в нём как раз переставляют плитки
function overlayBlocks() { var t = topOverlay(); return !!t && t !== 'edit'; }

// плитку подняли: с этого мига она едет за пальцем, а лента под ней стоит
function pickUp() {
  if (!drag || drag.active || drag.picked || drag.tapOnly) return;
  drag.picked = true;
  pressLift();
  haptic('light');
  try { drag.srcEl.setPointerCapture(drag.pid); } catch (e) {}
}

document.addEventListener('pointerdown', function (e) {
  if (drag) return;
  if (e.button) return;
  if (overlayBlocks()) return;
  var c = e.target.closest ? e.target.closest('.circle') : null;
  if (!c || c.classList.contains('dragghost')) return;
  pressSet(c, e);                  // отклик даём и в режиме правки: там тап тоже открывает окно
  if (editModeOn()) {
    if (window.UI.onEditPointerDown) window.UI.onEditPointerDown(e, c);
    return;
  }
  drag = { srcEl: c, kind: c.dataset.kind, id: c.dataset.id, ghost: null, gw: 0, gh: 0,
    startX: e.clientX, startY: e.clientY, active: false, picked: false,
    // расход тащить нельзя, но запись нужна: по ней в pointerup ловится тап (карточка)
    tapOnly: c.dataset.kind === 'exp',
    pid: e.pointerId };
  lpCancel();
  lp = { pid: e.pointerId, x: e.clientX, y: e.clientY,
    pick: setTimeout(pickUp, Engine.PRESS_PICKUP),
    edit: setTimeout(function () {
      lpCancel();
      cancelDrag();
      haptic('medium');
      if (window.UI.onLongPress) window.UI.onLongPress({ kind: c.dataset.kind, id: c.dataset.id, el: c });
    }, Engine.PRESS_EDIT) };
});

document.addEventListener('pointermove', function (e) {
  if (lp && e.pointerId === lp.pid &&
      (Math.abs(e.clientX - lp.x) > 8 || Math.abs(e.clientY - lp.y) > 8)) lpMoved();
  // палец поехал — это уже не тап: отклик снимаем, что бы дальше ни вышло
  // (перенос, скролл ленты, перестановка в режиме правки)
  if (pressEl && e.pointerId === pressPid &&
      (Math.abs(e.clientX - pressX) > 8 || Math.abs(e.clientY - pressY) > 8)) pressUnset();
  if (!drag || e.pointerId !== drag.pid) return;
  var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (!drag.active) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (drag.tapOnly) { drag = null; pressUnset(); return; }
    // поднятая плитка ленте больше не уступает: в этом весь смысл «подними и неси»
    if (!drag.picked && Math.abs(dx) > Math.abs(dy) * 1.5 && stripScrolls(drag.srcEl, e.pointerType)) return cancelDrag();
    drag.active = true;
    pressUnset();                  // старт переноса гасит отклик: дальше растёт цель, а не источник
    var g = makeGhost(drag.srcEl);
    drag.ghost = g.el; drag.gw = g.w; drag.gh = g.h;
    // призрак кошелька — сам .wcard, у него нет кольца, куда CSS положил бы масштаб;
    // дописываем его в тот же transform, где едет сдвиг
    drag.gs = (!lessMotion() && drag.srcEl.classList.contains('wcard')) ? ' scale(1.04)' : '';
    drag.srcEl.classList.add('dragsrc');
    document.body.classList.add('dragging');
    updateMainHint();
    haptic('light');
    try { drag.srcEl.setPointerCapture(e.pointerId); } catch (x) {}
  }
  drag.ghost.style.transform = 'translate(' + (e.clientX - drag.gw / 2) + 'px,' + (e.clientY - drag.gh / 2) + 'px)' + (drag.gs || '');
  dEdgeWatch(e.clientX, e.clientY);            // у края поля под пальцем — листаем к цели на другой странице
  highlight(targetAt(e.clientX, e.clientY));
}, { passive: true });

// Жест уже начался, а значит touch-action браузер для него больше не перечитывает:
// пока плитка поднята, прокрутку ленты гасим здесь, руками. Слушатель НЕ passive -
// иначе preventDefault() ничего не сделает.
document.addEventListener('touchmove', function (e) {
  if (drag && (drag.picked || drag.active) && e.cancelable) e.preventDefault();
}, { passive: false });

document.addEventListener('pointerup', function (e) {
  if (lp && e.pointerId === lp.pid) lpCancel();
  // ~120 мс — пока едет карточка/окно поверх: увеличение держится и читается как ответ
  if (pressEl && e.pointerId === pressPid) pressUnsetSoon(120);
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.active) {                       // драг не стартовал: короткое касание = тап
    var tapK = drag.kind, tapId = drag.id;
    var still = Math.abs(e.clientX - drag.startX) < 8 && Math.abs(e.clientY - drag.startY) < 8;
    drag = null;
    if (still && window.UI.openCard) window.UI.openCard({ kind: tapK, id: tapId });
    return;
  }
  var t = targetAt(e.clientX, e.clientY);
  var op = t ? resolveDrop(drag.kind, drag.id, t.dataset.kind, t.dataset.id) : null;
  if (op) { endDrag(); haptic('drop'); openAmount(op); }
  else { endDrag(true); }          // мимо/брак: тихий возврат плитки, без звука и вибро
});
document.addEventListener('pointercancel', function (e) {
  if (lp && e.pointerId === lp.pid) lpCancel();
  if (pressEl && e.pointerId === pressPid) pressUnset();
  if (!drag || e.pointerId !== drag.pid) return;
  cancelDrag();
});

// ---------- экран суммы: калькулятор, метки, дата ----------
var amOp = null;
var amExpr = '';
var amDate = null;
var OPS = '+−×÷';
var AM_MAX = 18;                       // длина выражения (в нём бывают знаки, не только цифры)
var AM_TOP = Engine.MAX_AMOUNT;        // предел самой суммы: 999 999 999 ₽
var AM_TOP_MSG = 'Слишком большая сумма. Максимум ' + Engine.fmt(AM_TOP) + ' ₽.';

function catName(id) {
  var f = Engine.findCategory(S, id);
  return f ? f.cat.name : '';
}
function walletName(id) { var w = Engine.findWallet(S, id); return w ? w.name : ''; }

function amEnds(op) {
  if (op.kind === 'exp') return { from: walletName(op.walletId), to: catName(op.catId) };
  if (op.kind === 'inc') return { from: catName(op.catId), to: walletName(op.walletId) };
  return { from: walletName(op.walletId), to: walletName(op.toWalletId) };
}
function amEndEls(op) {
  if (op.kind === 'exp') return [circleEl('wallet', op.walletId), circleEl('exp', op.catId)];
  if (op.kind === 'inc') return [circleEl('inc', op.catId), circleEl('wallet', op.walletId)];
  return [circleEl('wallet', op.walletId), circleEl('wallet', op.toWalletId)];
}
function circleEl(kind, id) {
  return document.querySelector('#app .circle[data-kind="' + kind + '"][data-id="' + id + '"]');
}

function shiftDate(dateStr, days) {
  var p = String(dateStr).split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// Разбор выражения экрана суммы - тем же калькулятором, что и поле суммы в правке
// операции (Engine.calcAmount): одно и то же «150+300» считается одинаково везде, и
// без eval (раньше тут был new Function).
function evalExpr(e) { return Engine.calcAmount(e); }

function lastIsOp(e) { return e.length > 0 && OPS.indexOf(e.charAt(e.length - 1)) >= 0; }
function tailNum(e) {
  for (var i = e.length - 1; i >= 0; i--) if (OPS.indexOf(e.charAt(i)) >= 0) return e.slice(i + 1);
  return e;
}

function amKey(k) {
  if (k === 'back') {
    amExpr = amExpr.slice(0, -1);
  } else if (k === '=') {
    var v = evalExpr(amExpr);
    amExpr = isFinite(v) ? String(v).replace('.', ',') : '';
  } else if (OPS.indexOf(k) >= 0) {
    if (!amExpr) return;
    if (lastIsOp(amExpr)) amExpr = amExpr.slice(0, -1);
    if (amExpr.length >= AM_MAX) return;
    amExpr += k;
  } else if (k === ',') {
    if (amExpr.length >= AM_MAX) return;
    var t = tailNum(amExpr);
    if (t.indexOf(',') >= 0) return;
    amExpr += (t === '' ? '0,' : ',');
  } else {
    if (amExpr.length >= AM_MAX) return;
    var t2 = tailNum(amExpr);
    if (t2 === '0') amExpr = amExpr.slice(0, -1) + k;
    else amExpr += k;
  }
  amPaint();
}

function amPaint() {
  var v = evalExpr(amExpr);
  var hasOp = /[+−×÷]/.test(amExpr);
  var big;
  if (!amExpr) big = '0';
  else if (hasOp) big = isFinite(v) ? money(v) : '—';
  else big = Engine.fmtTyped(amExpr);
  var el = $('amExpr');
  el.innerHTML = esc(big) + ' <span class="cur">₽</span>';
  var over = v > AM_TOP;
  el.classList.toggle('zero', !(v > 0));
  el.classList.toggle('over', over);
  $('amMini').textContent = over ? AM_TOP_MSG : (hasOp ? Engine.fmtTyped(amExpr) : '');
  $('amMini').classList.toggle('warn', over);
  // «Подтвердить» гаснет и пока не выбраны оба конца (кнопочный путь): без кошелька/категории
  // операцию записать нельзя. У drag концы всегда заданы - для него условие всегда истинно.
  $('amConfirm').disabled = !(v > 0) || over || !Engine.amountReady(amOp);
}

// Вперёд датировать операции нельзя: денег, которых ещё не потратили, в факте быть
// не должно. Календарю ставим предел, а выбранную дату всё равно подрезаем руками -
// на части Android поле date предел показывает, но выбрать позже не мешает.
var FUTURE_MSG = 'Дата не может быть в будущем';
function clampDate(v) {
  var t = Engine.today();
  return (typeof v === 'string' && v > t) ? t : v;
}
// вешается на любое поле type="date" под операции: предел + подрезка с тостом
function noFutureDate(el, onSet) {
  if (!el) return el;
  el.max = Engine.today();
  el.addEventListener('change', function () {
    if (!el.value) return;
    var c = clampDate(el.value);
    if (c !== el.value) { el.value = c; toast(FUTURE_MSG); }
    if (onSet) onSet(c);
  });
  return el;
}

function renderAmDate() {
  var t = Engine.today(), y = shiftDate(t, -1);
  var isT = amDate === t, isY = amDate === y;
  $('amBtnToday').classList.toggle('on', isT);
  $('amBtnYest').classList.toggle('on', isY);
  $('amPick').classList.toggle('on', !isT && !isY);
  var lbl = $('amDateVal');
  if (!isT && !isY) { lbl.hidden = false; lbl.textContent = amDate.slice(8, 10) + '.' + amDate.slice(5, 7); }
  else lbl.hidden = true;
  $('amDateInput').max = t;
  $('amDateInput').value = amDate;
}

// prefill (необязательно) — сумма, которой открыть экран заранее заполненным
// (используется «Повторить»); дата при этом всегда «сегодня».
function openAmount(op, prefill) {
  if (!op || !op.kind) return;
  amOp = { kind: op.kind, catId: op.catId || null, walletId: op.walletId || null, toWalletId: op.toWalletId || null };
  amExpr = (prefill != null && prefill > 0) ? String(prefill).replace('.', ',') : '';
  amDate = Engine.today();
  amPathRefresh();
  var kindLbl = { exp: 'Расход', inc: 'Доход', transfer: 'Перевод' };
  $('amKind').textContent = kindLbl[amOp.kind] || '';
  renderAmDate();
  amPaint();
  var ah = $('amHint');
  if (ah) ah.hidden = !hintShouldShow('amount');
  $('amount').hidden = false;
  updateMainHint();
}
function closeAmount() {
  $('amount').hidden = true;
  amOp = null; amExpr = '';
  updateMainHint();
}
function amountOpen() { return !$('amount').hidden; }

// ---------- кнопочный путь записи: «+» → выбор типа → лист суммы с выбором концов ----------
// Drag остаётся; это второй, заметный путь. У кнопки нет неявных источника/цели, поэтому
// оба конца операции выбираются прямо в шапке листа суммы (фишки «откуда → куда»).
// Что за конец в каждой позиции: расход = кошелёк → категория; доход = источник → кошелёк;
// перевод = кошелёк → кошелёк.
function amSlotMeta(pos) {
  var k = amOp.kind;
  if (pos === 'from') {
    if (k === 'inc') return { field: 'catId', pick: 'inc', ph: 'Выбрать источник' };
    return { field: 'walletId', pick: 'wallet', ph: 'Выбрать кошелёк' };
  }
  if (k === 'exp') return { field: 'catId', pick: 'exp', ph: 'Выбрать категорию' };
  if (k === 'inc') return { field: 'walletId', pick: 'wallet', ph: 'Выбрать кошелёк' };
  return { field: 'toWalletId', pick: 'wallet', ph: 'Выбрать кошелёк' };
}
function amSlotName(m) {
  var id = amOp[m.field];
  if (!id) return '';
  return m.pick === 'wallet' ? walletName(id) : catName(id);
}
// Каждый конец - фишка. Заполненная показывает имя (textContent = имя, как и было при drag,
// поэтому старые проверки целы) и остаётся нажимаемой (сменить выбор). Пустая - пунктирная
// акцентная фишка с приглашением. Тап открывает пикер соответствующего списка.
function amPathRefresh() {
  ['from', 'to'].forEach(function (pos) {
    var m = amSlotMeta(pos), name = amSlotName(m), empty = !name;
    var el = $(pos === 'from' ? 'amFrom' : 'amTo');
    el.innerHTML = '<span class="am-pick' + (empty ? ' empty' : '') + '" role="button" tabindex="0" data-pos="' +
      pos + '">' + esc(empty ? m.ph : name) + '</span>';
  });
}
function amOpenPicker(pos) {
  if (!amOp) return;
  var m = amSlotMeta(pos);
  if (m.pick === 'wallet') amPickWallet(m.field);
  else amPickCat(m.field, m.pick);
}
function amPickWallet(field) {
  var exclude = amOp.kind === 'transfer'
    ? (field === 'walletId' ? amOp.toWalletId : amOp.walletId) : null;
  var list = S.wallets
    .filter(function (w) { return !w.hidden && w.id !== exclude; })
    .sort(function (a, b) { return a.order - b.order; });
  var body = list.length
    ? '<div class="wgrid">' + list.map(function (w) { return walletTileHtml(w); }).join('') + '</div>'
    : '<div class="empty">Кошельков нет - заведи в меню «Настроить кошельки»</div>';
  openDlg({
    title: 'Выбери кошелёк', body: body, buttons: [{ label: 'Отмена', cls: 'ghost' }],
    // Слушатель вешаем на СВЕЖУЮ сетку, а не на общий #dlgBody: тот переживает окна,
    // и его обработчики копились бы, перекрёстно срабатывая (тап по категории задевал
    // бы старый обработчик кошелька). Сетка пересоздаётся каждым openDlg - утечки нет.
    onOpen: function () {
      var grid = $('dlgBody').querySelector('.wgrid');
      if (!grid) return;
      grid.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.wtile') : null;
        if (!b) return;
        amOp[field] = b.getAttribute('data-id');
        closeDlg(); amPathRefresh(); amPaint(); haptic('light');
      });
    }
  });
}
function catPickTileHtml(c, i, kind) {
  var icon = c.icon || Icons.guessKind(c.name, kind);
  return '<button type="button" class="wtile ptile t' + (i % 6) + '" data-id="' + esc(c.id) + '">' +
    '<span class="ico">' + Icons.img(icon, kind, 22, c.name) + '</span>' +
    '<span class="wt-n">' + esc(c.name) + '</span></button>';
}
function amPickCat(field, kind) {
  var list = Engine.listCategories(S, kind, { ymStr: curYM() });
  var body = list.length
    ? '<div class="wgrid">' + list.map(function (c, i) { return catPickTileHtml(c, i, kind); }).join('') + '</div>'
    : '<div class="empty">' + (kind === 'inc' ? 'Источников дохода нет' : 'Категорий нет') + ' - заведи в меню «Настроить категории»</div>';
  openDlg({
    title: kind === 'inc' ? 'Выбери источник дохода' : 'Выбери категорию',
    body: body, buttons: [{ label: 'Отмена', cls: 'ghost' }],
    onOpen: function () {
      var grid = $('dlgBody').querySelector('.wgrid');
      if (!grid) return;
      grid.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.wtile') : null;
        if (!b) return;
        amOp[field] = b.getAttribute('data-id');
        closeDlg(); amPathRefresh(); amPaint(); haptic('light');
      });
    }
  });
}
// «+» на главном: выбор типа операции, дальше - тот же лист суммы (openAmount) уже без
// неявных концов. Тип задаёт только вид, кошелёк и категорию выбирают в самом листе.
function openAdd() {
  openDlg({
    title: 'Новая операция',
    body: '<div class="op-pick">' +
      '<button type="button" class="btn primary" data-add-op="exp">Расход</button>' +
      '<button type="button" class="btn ghost" data-add-op="inc">Доход</button>' +
      '<button type="button" class="btn ghost" data-add-op="transfer">Перевод</button>' +
      '</div>',
    buttons: [{ label: 'Отмена', cls: 'ghost' }],
    onOpen: function () {
      var box = $('dlgBody').querySelector('.op-pick');
      if (!box) return;
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-add-op]') : null;
        if (!b) return;
        var kind = b.getAttribute('data-add-op');
        closeDlg();
        openAmount({ kind: kind });
      });
    }
  });
}

function txLabel(tx, op) {
  if (op.kind === 'exp') return '−' + money(tx.amount) + ' → ' + catName(op.catId);
  if (op.kind === 'inc') return '+' + money(tx.amount) + ' → ' + walletName(op.walletId);
  return money(tx.amount) + ': ' + walletName(op.walletId) + ' → ' + walletName(op.toWalletId);
}

// уровень категории в месяце операции — по нему выбирается звук
function catLevelIn(catId, kind, mo) {
  return levelOf(kind, Engine.catFact(S, catId, mo), Engine.catLimit(S, catId, mo)).lvl;
}

// Звук операции. Раньше «перебор» звучал ТОЛЬКО в тот раз, когда категория впервые
// перевалила за план, а дальше шёл обычный звук траты — и хозяин по звуку не отличал
// «ещё в плане» от «давно за планом». Теперь помнить нечего: имя звука выбирает
// Engine.txSound по УРОВНЮ категории уже после записи. Зовут её и запись операции,
// и правка суммы в карточке.
function soundTx(kind, catId, mo) {
  var lvl = (kind === 'exp' && catId) ? catLevelIn(catId, 'exp', mo) : null;
  sound(Engine.txSound(kind, lvl));
}

function amSave() {
  if (!amOp) return;
  if (!Engine.amountReady(amOp)) return;   // концы не выбраны (кнопочный путь) - молчим
  var v = evalExpr(amExpr);
  if (!(v > 0)) return;
  if (v > AM_TOP) { dlgAlert(AM_TOP_MSG, 'Не сохранилось'); return; }
  var op = amOp, tx;
  amDate = clampDate(amDate);              // последний заслон: вперёд датировать нельзя
  var mo = Engine.ym(amDate);
  try {
    tx = Engine.addTx(S, {
      kind: op.kind, amount: v, date: amDate,
      catId: op.catId, walletId: op.walletId, toWalletId: op.toWalletId
    });
  } catch (e) {
    var m = e && e.message;
    dlgAlert(m === 'amount-max' ? AM_TOP_MSG
      : (m === 'date-future' || m === 'date') ? FUTURE_MSG + '.'
      : 'Сумма должна быть больше нуля.', 'Не сохранилось');
    return;
  }
  save(); closeAmount(); render(); haptic('medium');
  soundTx(op.kind, op.catId, mo);
  if (window.UI.animateTx) {
    var els = amEndEls(op);
    window.UI.animateTx(tx, els[0], els[1]);
  }
  toast(txLabel(tx, op), {
    action: 'Отменить',
    onAction: function () { Engine.deleteTx(S, tx.id); save(); render(); }
  });
}

$('amCancel').addEventListener('click', closeAmount);
$('amConfirm').addEventListener('click', amSave);
// «+» на главном экране открывает выбор типа операции
$('fabAdd').addEventListener('click', openAdd);
// тап по концу-фишке в шапке листа суммы открывает пикер кошелька/категории
$('amount').querySelector('.am-path').addEventListener('click', function (e) {
  var chip = e.target.closest ? e.target.closest('.am-pick') : null;
  if (chip) amOpenPicker(chip.getAttribute('data-pos'));
});
$('amKeys').addEventListener('click', function (e) {
  var b = e.target.closest('.amk');
  if (b) amKey(b.getAttribute('data-k'));
});
$('amDate').addEventListener('click', function (e) {
  var b = e.target.closest('.amd[data-d]');
  if (!b) return;
  amDate = b.getAttribute('data-d') === 'yest' ? shiftDate(Engine.today(), -1) : Engine.today();
  renderAmDate();
});
noFutureDate($('amDateInput'), function (v) { amDate = v; renderAmDate(); });

// ---------- меню ----------
function openMenu() {
  renderMenu();
  $('menu').classList.add('open');
  $('menu').setAttribute('aria-hidden', 'false');
  $('menuBg').hidden = false;
  updateMainHint();
  haptic('light');
}
function closeMenu() {
  menuUnpress();
  $('menu').classList.remove('open');
  $('menu').setAttribute('aria-hidden', 'true');
  $('menuBg').hidden = true;
  updateMainHint();
}
function menuOpen() { return $('menu').classList.contains('open'); }

function pickMonth() { if (window.UI.pickMonth) window.UI.pickMonth(); }

$('btnMenu').addEventListener('click', openMenu);
$('btnMenuClose').addEventListener('click', closeMenu);
bindBackdropClose($('menuBg'), closeMenu);
// Меню закрывается смахиванием влево - туда, куда оно и уезжает. Жест начинается
// в ЛЮБОМ месте панели (плитка, зазор, низ) и на фоне, а не только на шапке: раньше
// хозяин вёл пальцем с плитки, и ничего не происходило.
//
// Почему не bindSwipeClose: во-первых, вертикальную прокрутку тела меню отдаём
// браузеру (движение вниз-вверх снимает жест), во-вторых, после смахивания с плитки
// на неё прилетит click - и меню заодно нажало бы этот пункт. Поэтому свой сторож
// и один съеденный клик.
var menuG = null;       // {pid, x, y} - палец, который может оказаться смахиванием
var menuSwiped = false; // только что закрыли смахиванием: ближайший клик съедаем
function menuSwipeStop() { menuG = null; }
function bindMenuSwipe(el) {
  if (!el) return;
  el.addEventListener('pointerdown', function (e) {
    if (e.button || !menuOpen()) return;
    menuG = { pid: e.pointerId, x: e.clientX, y: e.clientY };
  });
}
bindMenuSwipe($('menu'));
bindMenuSwipe($('menuBg'));
document.addEventListener('pointermove', function (e) {
  if (!menuG || e.pointerId !== menuG.pid) return;
  var dx = e.clientX - menuG.x, dy = e.clientY - menuG.y;
  // палец пошёл вертикально - это прокрутка списка настроек, жест снимаем
  if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) return menuSwipeStop();
  if (!Engine.swipeCloses(dx, dy, 'left')) return;
  menuSwipeStop();
  menuSwiped = true;
  menuUnpress();
  haptic('light');
  if (menuOpen()) closeMenu();
}, { passive: true });
['pointerup', 'pointercancel'].forEach(function (t) {
  document.addEventListener(t, function (e) { if (menuG && e.pointerId === menuG.pid) menuSwipeStop(); });
});
// флаг живёт ровно до следующего касания: иначе он съел бы чужой клик через час
document.addEventListener('pointerdown', function () { menuSwiped = false; }, true);
document.addEventListener('click', function (e) {
  if (!menuSwiped) return;
  menuSwiped = false;
  e.stopPropagation();
  e.preventDefault();
}, true);
// экран суммы и аналитика закрываются свайпом вниз по своей шапке
bindSwipeClose(document.querySelector('#amount .am-head'), 'down', function () { if (amountOpen()) closeAmount(); });
bindSwipeClose(document.querySelector('#summary .sm-head'), 'down', function () { if (summaryOpen() && window.UI.closeSummary) window.UI.closeSummary(); });
// Список «Настроить кошельки» — тот же диалог #dlg, что и остальные окна, поэтому
// жест берём только на его ручке и заголовке (тело со списком прокручивается как
// обычно) и закрываем лишь помеченное свайпом окно (метку ставит openWallets).
var dlgSwipeClose = function () { if (dlgOpen() && $('dlg').classList.contains('dlg-swipe')) closeDlg(); };
bindSwipeClose(document.querySelector('#dlg .dlg-grip'), 'down', dlgSwipeClose);
bindSwipeClose($('dlgTitle'), 'down', dlgSwipeClose);
bindSwipeClose($('dlgBody'), 'down', dlgSwipeClose, function () { var b = $('dlgBody'); return $('dlg').classList.contains('dlg-swipe') && b && b.scrollTop <= 0; });
$('sums').addEventListener('click', pickMonth);
$('sums').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickMonth(); } });

// Смена темы — единственный пункт меню, результат которого виден не в меню, а на
// главном экране. Поэтому закрываем всё, что стоит поверх (меню, карточку, аналитику),
// и показываем перекрашенный экран сразу, без второго тапа «закрыть».
$('mTheme').addEventListener('click', function () {
  S.ui.theme = S.ui.theme === 'dark' ? 'light' : 'dark';
  expRowsCache = expRingCache = null;   // плитки в темах разной высоты — сетку меряем заново
  closeMenu();
  if (window.UI.closeSummary) window.UI.closeSummary();
  if (window.UI.closeCard) window.UI.closeCard();
  save(); render();
});
$('mHaptic').addEventListener('click', function () {
  S.ui.haptics = S.ui.haptics === false;   // переключить; по умолчанию (undefined) = вкл
  save(); renderMenu(); if (S.ui.haptics !== false) haptic('light');
});
// Тот же выключатель, что у вибрации: включили - сразу слышно, на чём остановились.
$('mSound').addEventListener('click', function () {
  S.ui.sound = S.ui.sound === false;
  save(); renderMenu(); haptic('light');
  if (S.ui.sound !== false) sound('expense');   // проба звука при включении
});
// Общий выключатель подсказок-хомяков: выкл — их нет нигде, вкл — показываются заново
// (уважая уже погашенные свайпом). Ставит/снимает главную подсказку тут же.
$('mHints').addEventListener('click', function () {
  S.ui.hints = S.ui.hints === false;
  save(); renderMenu(); haptic('light');
  if (window.UI.renderCard && cardOpen()) window.UI.renderCard();
  updateMainHint();
});
// Чип «Free» - мягкий апселл: открывает баннер «Полный доступ» поверх меню (без аргумента
// закрытие вернёт в меню). Чип «Pro» - просто статус, не тапается (role снят в renderMenu).
(function () {
  var tier = $('menuTier');
  if (!tier) return;
  function tap() { if (!hasFull() && window.UI.paywall) window.UI.paywall(); }
  tier.addEventListener('click', tap);
  tier.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && !hasFull()) { e.preventDefault(); tap(); }
  });
})();
$('mWallets').addEventListener('click', function () { closeMenu(); if (window.UI.openWallets) window.UI.openWallets(); });
$('mCats').addEventListener('click', function () { closeMenu(); if (window.UI.openCats) window.UI.openCats(); });
// Плашка «Очистить демо-данные»: сброс к чистому старту (пресет), метка demo снимается,
// плашка исчезает (видимость держит renderMenu по S.ui.demo).
$('demoBar').addEventListener('click', function () {
  window.UI.dlgConfirm({ title: 'Очистить демо-данные?', danger: true, okLabel: 'Очистить',
    text: 'Тестовые данные удалятся, приложение начнёт с чистого старта. Плашка исчезнет.',
    onOk: function () {
      S = Engine.migrate(presetState());
      save(); renderInstant(); haptic('medium');
      window.UI.toast('Демо очищено');
    } });
});

// Отклик на палец в меню: плитка растёт, как на главном экране. Снимаем не сразу -
// иначе на быстром тапе виден только мигающий рост.
function menuUnpress() {
  each(document.querySelectorAll('#menu .is-pressed'), function (el) { el.classList.remove('is-pressed'); });
}
$('menu').addEventListener('pointerdown', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('.mi') : null;
  if (!el) return;
  menuUnpress();
  el.classList.add('is-pressed');
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
  $('menu').addEventListener(t, function () { setTimeout(menuUnpress, 140); });
});
// #mBackup / #mRestore живут в backup.js, #mUpdate — в update.js, #mCats — открывает экран категорий

// Внешняя ссылка. В APK Capacitor уводит любой чужой адрес в системный браузер:
// window.open с любым target, кроме _self, проходит через onCreateWindow моста и
// открывается интентом. Запасной путь — обычная ссылка с target="_blank":
// на случай, если WebView вернёт null (блокировка всплывающих окон в браузере QA).
function openExternal(url) {
  var w = null;
  try { w = window.open(url, '_system'); } catch (e) {}
  if (!w) { try { w = window.open(url, '_blank'); } catch (e2) {} }
  if (w) return true;
  var a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 500);
  return true;
}

var PRIVACY_URL = 'https://dorokhin-finance.ru/homyak/privacy.html';
var TERMS_URL = 'https://dorokhin-finance.ru/homyak/terms.html';
var SITE = 'https://dorokhin-finance.ru';

$('mAbout').addEventListener('click', function () {
  closeMenu();
  openDlg({
    title: 'О приложении',
    body:
      '<div class="about">' +
        '<div class="ab-head">' +
          '<span class="ab-ham" aria-hidden="true"><img src="hamster.png" alt=""></span>' +
          '<div class="ab-ttl"><b>Хомяк</b> · v' + esc(menuVersion()) + '</div>' +
        '</div>' +
        '<p class="ab-lead">Учёт личных финансов без облака и <b>без рекламы</b>. Кошельки, категории и месячные лимиты живут только на твоём телефоне.</p>' +

        '<div class="ab-h">Как записывать операции</div>' +
        '<p class="ab-p">Перетаскивай плитки: нажми на плитку и, не отпуская, веди пальцем на нужную.</p>' +
        '<ul class="ab-list">' +
          '<li>кошелёк на категорию расхода - расход</li>' +
          '<li>источник дохода на кошелёк - доход</li>' +
          '<li>кошелёк на кошелёк - перевод</li>' +
        '</ul>' +

        '<div class="ab-h">Жесты и настройки</div>' +
        '<p class="ab-p">Короткий тап по плитке открывает её операции, долгий - правку и порядок. Кошельки, категории и лимиты настраиваются в меню - хомяк сверху слева, аналитика - справа.</p>' +

        '<div class="ab-h">Документы</div>' +
        '<p class="ab-linkrow"><a class="ab-link" data-ext="' + PRIVACY_URL + '" href="' + PRIVACY_URL + '">Политика конфиденциальности</a></p>' +
        '<p class="ab-linkrow"><a class="ab-link" data-ext="' + TERMS_URL + '" href="' + TERMS_URL + '">Пользовательское соглашение</a></p>' +

        '<div class="ab-h">Автор</div>' +
        '<p class="ab-author">Финансовый консультант Алексей Дорохин</p>' +
        '<p class="ab-contacts">' +
          '<a class="ab-link" data-ext="' + SITE + '" href="' + SITE + '">' +
            '<svg class="ab-cico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18" stroke-linecap="round"/><path d="M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>' +
            'dorokhin-finance.ru</a></p>' +
      '</div>',
    buttons: [{ label: 'Понятно', cls: 'primary' }],
    // Возврат в «Меню» при любом закрытии (кнопка, фон, свайп вниз) - окно вызвано из меню.
    onClose: openMenu,
    onOpen: function () {
      // dlg-about: своя, более плотная вёрстка, чтобы всё влезло без прокрутки.
      // dlg-swipe: смахивание вниз закрывает окно (тело без скролла, scrollTop<=0).
      $('dlg').classList.add('dlg-about', 'dlg-swipe');
      Array.prototype.forEach.call($('dlgBody').querySelectorAll('.ab-link[data-ext]'), function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); openExternal(a.getAttribute('data-ext')); });
      });
    }
  });
});

$('fieldExp').querySelector('.pages').addEventListener('scroll', function () {
  updateDots(this, $('expDots'));
}, { passive: true });
$('fieldInc').querySelector('.pages').addEventListener('scroll', function () {
  updateDots(this, $('incDots'));
}, { passive: true });
$('fieldWallets').querySelector('.strip').addEventListener('scroll', function () {
  var dots = $('walDots');
  if (!dots.children.length || !this.clientWidth) return;
  walPage = Engine.pageAt(this.scrollLeft, this.scrollWidth, this.clientWidth, dots.children.length);
  paintDots(dots, walPage);
}, { passive: true });

bindDots($('incDots'), $('fieldInc').querySelector('.pages'));
bindDots($('expDots'), $('fieldExp').querySelector('.pages'));
bindDots($('walDots'), $('fieldWallets').querySelector('.strip'));

// Главную подсказку гасит свайп в любую сторону. Ключ — функция: гасим ту из очереди
// (mainDrag/fill/taps), что сейчас на экране, и updateMainHint показывает следующую.
bindHintSwipe($('mainHint'), mainHintKey, updateMainHint);
// Ситуативные подсказки на стабильных узлах — свайп привязываем ОДИН раз (узлы живут
// в разметке, не пересоздаются), утечки document-слушателей не копятся.
bindHintSwipe($('amHint'), 'amount', function () { var e = $('amHint'); if (e) e.hidden = true; });
bindHintSwipe($('dlgHint'), function () { var e = $('dlgHint'); return e ? e.getAttribute('data-hint') : ''; },
  function () { var e = $('dlgHint'); if (e) e.hidden = true; });

var expResizeTimer = null;
window.addEventListener('resize', function () {
  clearTimeout(expResizeTimer);
  expResizeTimer = setTimeout(function () { expRowsCache = expRingCache = null; renderExp(); }, 150);
});

// ---------- «назад»: одна лестница на кнопку Android и Escape ----------
// Верхний слой считает Engine.topOverlay по тому же порядку, что и z-index в вёрстке.
// Раньше на телефоне кнопка «назад» не делала НИЧЕГО: WebView её проглатывал, и выйти
// из карточки можно было только крестиком, а из приложения - жестом системы.
function closeTop() {
  switch (topOverlay()) {
    case 'onboard': $('obDone').click(); return true;   // «назад» на приветствии = «Понятно», а не выход
    case 'icons': if (window.UI.closeIconSheet) window.UI.closeIconSheet(); return true;
    case 'dialog': closeDlg(); return true;
    case 'amount': closeAmount(); return true;
    case 'transfer': if (window.UI.closeTransfer) window.UI.closeTransfer(); return true;
    case 'card': if (window.UI.closeCard) window.UI.closeCard(); return true;
    case 'summary': if (window.UI.summaryBack) window.UI.summaryBack(); else if (window.UI.closeSummary) window.UI.closeSummary(); return true;
    case 'menu': closeMenu(); return true;
    case 'edit': if (window.UI.exitEdit) window.UI.exitEdit(); return true;
  }
  return false;
}

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  closeTop();
});

// Кнопка «назад» на телефоне. Ничего открыто - выходим из приложения, как это делают
// обычные приложения; в браузере (QA) плагина нет и всё держится на Escape.
(function () {
  try {
    var N = window.NativePlugins;
    if (!(window.isNativeApp && window.isNativeApp()) || !N || !N.App || !N.App.addListener) return;
    N.App.addListener('backButton', function () {
      if (closeTop()) return;
      try { N.App.exitApp(); } catch (e) {}
    });
  } catch (e) {}
})();

// ---------- демо-сид ----------
// Демо и пресет собирает Seed (www/seed.js) на новой автономной модели.
function demoState() { return Seed.demoState(Engine, Engine.today()); }
function presetState() { return Seed.presetState(Engine); }

// ---------- reel-персоны (промо-скринкасты) ----------
// Номер текущей персоны храним отдельным ключом, чтобы «Сброс» знал, что пересеять,
// и выбор пережил перезапуск. Значение вне 1..3 трактуем как первую персону.
// Ключ - строковый литерал прямо в функциях: load() зовётся в самом верху файла (var S),
// а присваивание любой var ниже по файлу к тому моменту ещё не выполнилось бы (было бы
// undefined) - и первый сид всегда падал бы на персону 1.
function reelPersona() {
  var v = 1;
  try { v = +localStorage.getItem('homyak-reel-persona') || 1; } catch (e) {}
  return (v >= 1 && v <= 3) ? v : 1;
}
function setReelPersona(p) { try { localStorage.setItem('homyak-reel-persona', String(p)); } catch (e) {} }
function reelState() { return Seed.reelState(Engine, reelPersona(), Engine.today()); }
// Пере-сеять выбранную персону заново (чистый старт для дубля) через тот же путь
// сохранения, что и остальное приложение.
function applyReelPersona(p, silent) {
  setReelPersona(p);
  // Тема живёт В рабочем состоянии (S.ui.theme, ложится атрибутом на body при рендере).
  // reel-сид кладёт свою тему по умолчанию, поэтому пересев её затирал бы выбор оператора
  // (снимал светлый фон для блондинки → сброс возвращал тёмную). Запоминаем активную тему
  // ДО пересева и возвращаем ПОСЛЕ — так «Сброс»/смена персоны тему не трогают.
  var keepTheme = (S && S.ui && S.ui.theme) ? S.ui.theme : null;
  S = Engine.migrate(reelState());
  if (keepTheme) S.ui.theme = keepTheme;
  // reel-режим: пере-проигрываем заливку колец на каждой смене персоны / «Сбросе»,
  // чтобы анимацию можно было снять заново. В обычном приложении applyReelPersona
  // не вызывается вовсе — там fillRevealed остаётся одноразовым (заслон одноразовости).
  fillRevealed = false;
  save(); renderInstant(); haptic('medium');
  // reel-режим: без toast — плашка перекрывала шапку в кадре скринкаста. Персона
  // переключается и экран перерисовывается молча. (applyReelPersona вызывается только
  // в reel-сборке; параметр silent сохранён для совместимости вызова «Сброса».)
}
var REEL_NAMES = { 1: 'Персона 1 · Кофе', 2: 'Персона 2 · Парфюм', 3: 'Персона 3 · Дом' };
// Скрытый лист выбора персоны (только reel-сборка). Механизм — штатное окно openDlg,
// не нативный alert. Персоны стопкой в теле окна, текущая подсвечена.
function openReelSheet() {
  var cur = reelPersona();
  var html = '<div style="display:flex;flex-direction:column;gap:8px">';
  [1, 2, 3].forEach(function (p) {
    html += '<button type="button" class="btn ' + (p === cur ? 'primary' : 'ghost') +
      '" data-reel-p="' + p + '" style="width:100%">' + esc(REEL_NAMES[p]) + '</button>';
  });
  html += '<button type="button" class="btn ghost" data-reel-reset="1" style="width:100%">' +
    'Сброс (пересеять текущую)</button>';
  html += '</div>';
  openDlg({
    title: 'Демо-ролик',
    body: html,
    buttons: [{ label: 'Закрыть', cls: 'ghost' }],
    onOpen: function () {
      each(document.querySelectorAll('#dlgBody [data-reel-p]'), function (b) {
        b.addEventListener('click', function () {
          closeDlg(); applyReelPersona(+b.getAttribute('data-reel-p'));
        });
      });
      var rb = document.querySelector('#dlgBody [data-reel-reset]');
      if (rb) rb.addEventListener('click', function () {
        closeDlg(); applyReelPersona(reelPersona(), true);   // без toast: плашка перекрывала шапку в кадре
      });
    }
  });
}
// long-press по шапке открывает лист персон. Ставится только в reel-сборке, поэтому в
// релиз/стор/тест переключателя нет вовсе. Клик, следующий за сработавшим удержанием,
// глушим в фазе перехвата, чтобы тап по шапке не сменил заодно месяц/не открыл меню.
if (REEL) (function () {
  var top = $('top'); if (!top) return;
  var timer = null, fired = false;
  function clear() { if (timer) { clearTimeout(timer); timer = null; } }
  top.addEventListener('pointerdown', function () {
    fired = false; clear();
    timer = setTimeout(function () { timer = null; fired = true; haptic('medium'); openReelSheet(); }, 650);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    top.addEventListener(t, clear);
  });
  top.addEventListener('click', function (e) {
    if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; }
  }, true);
})();

// ---------- экспорт ----------
window.UI = {
  get S() { return S; },
  set S(v) { S = v; },
  save: save, render: render, renderInstant: renderInstant, renderMenu: renderMenu, curYM: curYM, screenYM: screenYM, checkDay: checkDay, fmt: fmt, esc: esc, MONTHS: MONTHS,
  openDlg: openDlg, dlgConfirm: dlgConfirm, dlgAlert: dlgAlert, dlgPrompt: dlgPrompt,
  closeDlg: closeDlg, dlgOpen: dlgOpen, bindBackdropClose: bindBackdropClose, bindSwipeClose: bindSwipeClose,
  overlayFlags: overlayFlags, topOverlay: topOverlay, closeTop: closeTop,
  toast: toast, hideToast: hideToast, haptic: haptic, sound: sound, soundTx: soundTx,
  openMenu: openMenu, closeMenu: closeMenu, makeGhost: makeGhost,
  openAmount: openAmount, closeAmount: closeAmount, amountOpen: amountOpen, resolveDrop: resolveDrop, evalExpr: evalExpr, SNAP_MS: SNAP_MS,
  tileHtml: tileHtml, walletHtml: walletHtml, walletTileHtml: walletTileHtml, applyFill: applyFill, levelOf: levelOf, wcolor: wcolor,
  monthLabel: monthLabel, money: money, moneyInput: moneyInput, calcInput: calcInput,
  noFutureDate: noFutureDate, clampDate: clampDate, FUTURE_MSG: FUTURE_MSG,
  catName: catName, walletName: walletName,
  loadFrom: loadFrom, saveBanner: saveBanner,
  openExternal: openExternal, appVersion: appVersion, shortVersion: shortVersion,
  menuVersion: menuVersion, shellVersion: shellVersion, verSuffix: verSuffix,
  hintsOn: hintsOn, hintShouldShow: hintShouldShow, dismissHint: dismissHint,
  bindHintSwipe: bindHintSwipe, updateMainHint: updateMainHint, mainHintKey: mainHintKey,
  fitSums: fitSums, hasFull: hasFull, onboardOpen: onboardOpen,
  wasRecovered: function () { return recovered; },
  ringPx: function () { return GEO.size; },
  ringGeo: function () { return GEO; },
  expRows: function () { return expRowsCache; },
  walletPage: function () { return walPage; },
  scrollToPage: scrollToPage, balanceStrip: balanceStrip, GAP_MIN: GAP_MIN,
  fieldGap: function () { return px(getComputedStyle($('app')).getPropertyValue('--fgap')); },
  relayout: relayout, toggleIncome: toggleIncome,
  incomeAnimating: function () { return !!incAnim; },
  KEY: KEY, BROKEN_KEY: KEY + '.broken', DEMO: DEMO
};

// Приветственный онбординг: показываем один раз (на первом запуске), пока хозяин не
// нажал «Понятно». Флаг живёт в S.ui.onboarded.
function maybeOnboard() {
  if (!Engine.shouldOnboard(S)) return;
  var ob = $('onboard');
  if (ob) { ob.hidden = false; updateMainHint(); }
}
$('obDone').addEventListener('click', function () {
  if (!S.ui.onboarded) { S.ui.onboarded = true; save(); }
  $('onboard').hidden = true;
  haptic('light');
  updateMainHint();   // пока приветствие открыто, очередь подсказок молчит - теперь её черёд
});

if (DEMO || REEL) save();
render();

// Возврат в приложение и полночь, пока оно открыто. Любой из путей может не сработать
// на конкретной оболочке (WebView не всегда шлёт visibilitychange при resume), поэтому
// их несколько, а проверка дешёвая - сравнение двух строк.
(function () {
  function safeCheck() { try { checkDay(); } catch (e) {} }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') safeCheck(); });
  window.addEventListener('focus', safeCheck);
  window.addEventListener('pageshow', safeCheck);
  try {
    var N = window.NativePlugins;
    if (window.isNativeApp && window.isNativeApp() && N && N.App && N.App.addListener) {
      // результат не ждём: на устройстве addListener может вернуть не-Promise
      N.App.addListener('resume', safeCheck);
      N.App.addListener('appStateChange', function (st) { if (!st || st.isActive) safeCheck(); });
    }
  } catch (e) {}
  (function tick() {
    setTimeout(function () {
      if (document.visibilityState !== 'hidden') safeCheck();
      tick();
    }, 20000);
  })();
})();

// Приложение нарисовалось и не упало по дороге — это и есть «сборка живая».
// По этой отметке update.js подтверждает бесшовное обновление, а boot.js решает,
// откатывать ли следующий запуск. Ставим её ПОСЛЕ render(), иначе доказательства нет.
window.APP_READY = true;

// О порче говорим один раз и уже на живом экране: хозяин должен понять, почему пусто,
// и что бэкап из файла ещё спасает.
if (recovered) {
  setTimeout(function () {
    dlgAlert('Данные были повреждены, восстановлены настройки по умолчанию. Если есть бэкап - восстанови из файла.', 'Данные не прочитались');
  }, 0);
} else {
  maybeOnboard();
}

})();
