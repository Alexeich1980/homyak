/* lock.js - «Защита входа»: замок от посторонних глаз (1.0.3).

   Что делает: экран с кодом из 4 цифр при запуске и после фона дольше 5 минут (Алексей 13.10: минута - маловато); вход по
   отпечатку, если хозяин его включил и телефон умеет. Данные замок НЕ шифрует - это
   честно сказано в окне настройки. Решения (формат кода, хэш, пауза после неверных
   попыток, запирать ли после фона) - чистые функции в guards.js, здесь только экран.

   Хранение: отдельный ключ localStorage 'homyak-lock' (не в общем состоянии S): S уезжает
   в файл бэкапа, а замок - свойство телефона. Восстановление копии на новом телефоне не
   должно запирать его чужим кодом. В ключе: {on, salt, hash, iter, bio, fails, lockouts,
   until} - открытого кода нет.

   Грузится ДО ui.js: при включённом замке экран закрывается раньше, чем ui.js нарисует
   хоть одно число. Окна настройки - через UI.openDlg (в гамме приложения), они нужны
   только когда приложение уже открыто. На самом экране замка свои панели (#lockSheet):
   обычное окно могло бы оказаться под замком или вынести наружу чужое открытое окно.

   Свои системные окна (сохранение файла, выбор файла, оплата, окно оценки, отпечаток)
   уводят приложение в фон - это не уход хозяина. Перед ними зовут AppLock.away(): если
   уход в фон случился в ближайшие 10 с (вызов плагина с ответом - AWAY_CALL: пока он идёт,
   но не дольше минуты), после возврата не запираем и шторку не ставим. away() возвращает
   release(): вызов кончился, а в фон так и не ушли (RuStore сразу ответил ошибкой) -
   отметку снимаем, иначе настоящий уход «Домой» в эти секунды простился бы без шторки.
   Метка одноразовая (только ближайший уход) и прощает только фон короче LOCK.AWAY_MAX
   (10 мин): из окна сохранения ушли на «Домой» на час - замок запирает (ревью 1.0.3).

   Пока заперто, всё приложение под замком inert + aria-hidden: ни одна кнопка не
   получает фокус с клавиатуры и не читается экранным диктором. */
(function () {
'use strict';

var G = window.Guards;
var KEY = 'homyak-lock';
var $ = function (id) { return document.getElementById(id); };
if (!G || !$('lock')) return;

// ---------- хранение ----------
function load() {
  try {
    var o = JSON.parse(localStorage.getItem(KEY) || 'null');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}
// Счётчик неверных попыток и пауза, которые телефон не дал записать (хранилище забито),
// живут в памяти: иначе пауза после неверного кода не наступала бы никогда - перебор кода
// (ревью 1.0.3). Удачная запись снимает память: в хранилище уже правда.
var mem = null;
function store(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); mem = null; return true; } catch (e) { return false; }
}
function storeFails(o) { if (!store(o)) mem = o; }
function rec() { return mem || load(); }
function isOn() { var s = load(); return !!(s.on && s.hash && s.salt); }
// Состояние паузы с потолком: часы перевели назад - until обрезаем до PAUSE_MAX и пишем.
function lockSt() {
  var s = rec(), n = G.lockNormalize(s, Date.now());
  if (n.until !== s.until) storeFails(n);
  return n;
}
// Флаг «вход по отпечатку» - выбор хозяина. Умеет ли телефон отпечаток СЕЙЧАС (отпечатки
// могли удалить в настройках) - отдельно, bioAvailable(): без него экран замка не тянется
// к отпечатку, а в настройках остаётся кнопка выключить флаг (ревью 1.0.3).
function bioOn() { var s = load(); return isOn() && !!s.bio; }

// ---------- родные возможности ----------
function NP() { return (window.isNativeApp && window.isNativeApp()) ? (window.NativePlugins || null) : null; }
function bioPlugin() { var n = NP(); return n && n.NativeBiometric ? n.NativeBiometric : null; }
function bioAvailable() {
  var p = bioPlugin();
  if (!p) return Promise.resolve(false);
  try {
    return Promise.resolve(p.isAvailable()).then(function (r) { return !!(r && r.isAvailable); }, function () { return false; });
  } catch (e) { return Promise.resolve(false); }
}
function bioVerify(subtitle) {
  var p = bioPlugin();
  if (!p) return Promise.reject(new Error('no-bio'));
  var release = away(AWAY_CALL);
  return Promise.resolve().then(function () {
    return p.verifyIdentity({ title: 'Хомяк', subtitle: subtitle || 'Вход по отпечатку',
      negativeButtonText: 'Ввести код', maxAttempts: 3 });
  }).then(function (r) { release(); return r; }, function (e) { release(); throw e; });
}
// capacitor-native-biometric 4.2.2 (AuthActivity): 16 - хозяин сам нажал «Ввести код» или
// «Назад» (ERROR_NEGATIVE_BUTTON / ERROR_USER_CANCELED - плагин их не различает), 15 - окно
// закрыла система (тайм-аут, ушли из приложения), 10 - окно закрылось само после maxAttempts
// неудачных касаний (onAuthenticationFailed считает касания), 4/2 - датчик заблокирован.
function bioCode(e) { return e && e.code != null ? String(e.code) : ''; }
// миниатюра в «недавних» (Android 13+): прячем, пока замок включён
function syncRecents() {
  var n = NP();
  if (!n || !n.AppPrivacy) return;
  try { Promise.resolve(n.AppPrivacy.setRecentsHidden({ hidden: isOn() })).catch(function () {}); } catch (e) {}
}

// ---------- свои системные окна ----------
var AWAY_SOON = 10000;     // окно без ответа (выбор файла): фон должен наступить в эти 10 с
var AWAY_CALL = 60000;     // вызов плагина с ответом: пока идёт, но не дольше минуты
var awayAt = 0, awayFor = 0;
function away(ms) {
  var at = Date.now();
  awayAt = at; awayFor = ms > 0 ? ms : AWAY_SOON;
  return function release() { if (awayAt === at && !bgAt) { awayAt = 0; awayFor = 0; } };
}

// ---------- клавиатура ----------
var BIO_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 5.2A8 8 0 0 1 20 12v1.5"/><path d="M4.4 9A8 8 0 0 0 4 12v3"/><path d="M8 19.5c1-1.8 1.5-4 1.5-7.5a2.5 2.5 0 0 1 5 0c0 1.2 0 2.4-.2 3.5"/><path d="M12 12c0 3.5-.6 6.4-2 8.5"/><path d="M16.8 16.5c-.3 1.4-.8 2.7-1.4 3.8"/></svg>';
var BACK_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z"/><path d="m12 10 4 4M16 10l-4 4"/></svg>';
function padHtml(withBio) {
  var h = '';
  for (var i = 1; i <= 9; i++) h += '<button type="button" class="lk-key" data-k="' + i + '">' + i + '</button>';
  h += withBio
    ? '<button type="button" class="lk-key lk-bio" data-k="bio" aria-label="Войти по отпечатку">' + BIO_SVG + '</button>'
    : '<span class="lk-key lk-empty" aria-hidden="true"></span>';
  h += '<button type="button" class="lk-key" data-k="0">0</button>';
  h += '<button type="button" class="lk-key lk-back" data-k="back" aria-label="Стереть">' + BACK_SVG + '</button>';
  return h;
}
function paintDots(box, n, bad) {
  if (!box) return;
  var d = box.querySelectorAll('i');
  for (var i = 0; i < d.length; i++) d[i].className = i < n ? 'on' : '';
  box.classList.toggle('bad', !!bad);
}

// ---------- экран замка ----------
var locked = false, covered = false, entry = '', checking = false, waitTimer = null;

// Всё, что под замком (прямые дети body, кроме самого #lock и скриптов): inert и
// aria-hidden. Прежнее aria-hidden (у меню его ведёт ui.js) запоминаем и возвращаем.
function underLock(on) {
  var kids = document.body ? document.body.children : [];
  for (var i = 0; i < kids.length; i++) {
    var el = kids[i];
    if (el.id === 'lock' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.id === 'selftest') continue;
    if (on) {
      if (!el.hasAttribute('data-lk-inert')) {
        el.setAttribute('data-lk-inert', el.hasAttribute('aria-hidden') ? el.getAttribute('aria-hidden') : '-');
      }
      el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    } else if (el.hasAttribute('data-lk-inert')) {
      var was = el.getAttribute('data-lk-inert');
      el.removeAttribute('data-lk-inert');
      el.inert = false;
      if (was === '-') el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', was);
    }
  }
}

function showLock() {
  var el = $('lock');
  locked = true; covered = false; entry = ''; checking = false;
  el.classList.remove('cover');
  el.hidden = false;
  document.body.classList.add('locked');
  underLock(true);
  $('lockSheet').hidden = true;
  // Вход по отпечатку (Алексей 14.10): под системным окном отпечатка - не клавиатура кода,
  // а спокойный экран «Вход по отпечатку»; код - запасной путь кнопкой «Ввести код» или
  // сам, если отпечаток не сработал.
  bioFirst(bioOn());
  $('lockPad').innerHTML = padHtml(bioOn());
  paintDots($('lockDots'), 0);
  setMsg('');
  paintWait();
  // отпечаток предлагаем сразу и во время паузы: пауза - против перебора кода, а не пальца.
  // Телефон отпечаток больше не умеет (удалили в настройках) - клавишу убираем и не зовём.
  if (bioOn()) bioAvailable().then(function (can) {
    if (!locked) return;
    if (can) { setTimeout(tryBio, 250); return; }
    bioFirst(false);
    $('lockPad').innerHTML = padHtml(false);
    paintWait();
  });
}
// три неудачи отпечатка, потом код (Алексей 14.10). Три касания считает само системное окно
// (maxAttempts: 3 в bioVerify) и закрывается с кодом 10 - тогда сразу код. Раньше поверх
// этого был свой счётчик окон (3 окна × 3 касания = до 9 касаний, «осталось 2 попытки»
// после трёх неудач) - ревью 14.10 №6.
function bioFirst(on) {
  $('lock').classList.toggle('bio-first', !!on);
  $('lockTitle').textContent = on ? 'Вход по отпечатку' : 'Введите код';
}
function hideLock() {
  locked = false; covered = false; entry = '';
  $('lock').classList.remove('bio-first');
  $('lock').hidden = true;
  $('lock').classList.remove('cover');
  $('lockSheet').hidden = true;
  document.body.classList.remove('locked');
  underLock(false);
  clearInterval(waitTimer); waitTimer = null;
}
function coverOn() {
  if (locked) return;
  var el = $('lock');
  covered = true;
  el.classList.add('cover');
  el.hidden = false;
  underLock(true);
}
function coverOff() {
  if (locked || !covered) return;
  covered = false;
  $('lock').hidden = true;
  $('lock').classList.remove('cover');
  underLock(false);
}
function setMsg(t, warn) {
  var m = $('lockMsg');
  m.textContent = t || '';
  m.classList.toggle('warn', !!warn);
}
function secs(ms) { return Math.ceil(ms / 1000); }
function waitText(ms) {
  var s = secs(ms);
  if (s >= 120) { var m = Math.ceil(s / 60); return 'Слишком много попыток. Подождите ' + m + ' мин'; }
  return 'Слишком много попыток. Подождите ' + s + ' с';
}
// пауза после неверных попыток: клавиши кода гаснут (отпечаток - нет), на экране отсчёт
function paintWait() {
  clearInterval(waitTimer); waitTimer = null;
  var w = G.lockWait(lockSt(), Date.now());
  var keys = $('lockPad').querySelectorAll('.lk-key[data-k]:not([data-k="bio"])');
  for (var i = 0; i < keys.length; i++) keys[i].disabled = w > 0;
  $('lockPad').classList.toggle('wait', w > 0);
  if (w <= 0) return;
  setMsg(waitText(w), true);
  waitTimer = setInterval(function () {
    var left = G.lockWait(rec(), Date.now());
    if (left <= 0) { setMsg(''); paintWait(); return; }
    setMsg(waitText(left), true);
  }, 1000);
}

function unlockOk() {
  storeFails(G.lockOk(rec()));
  hideLock();
  if (window.UI && window.UI.haptic) window.UI.haptic('light');
  var after = pendingAfterUnlock; pendingAfterUnlock = null;
  if (after) { try { after(); } catch (e) {} }
  else if (reopenProblem) {
    // окно «Данные не прочитались» закрылось при запирании - оно одноразовое, показываем снова
    reopenProblem = false;
    setTimeout(function () { try { window.UI.showProblem(); } catch (e) {} }, 0);
  }
  if (window.Nudges && window.Nudges.checkRemind) setTimeout(function () { window.Nudges.checkRemind(); }, 600);
}
var pendingAfterUnlock = null;

function submit(pin) {
  checking = true;
  return G.checkPin(load(), pin).then(function (good) {
    checking = false;
    if (!locked) return good;
    if (good) { unlockOk(); return true; }
    var st = G.lockFail(rec(), Date.now());
    storeFails(st);
    entry = '';
    paintDots($('lockDots'), 0, true);
    if (window.UI && window.UI.haptic) window.UI.haptic('medium');
    if (G.lockWait(st, Date.now()) > 0) paintWait();
    else {
      var left = G.LOCK.MAX_FAILS - (st.fails || 0);
      setMsg('Неверный код. Осталось попыток до паузы: ' + left, true);
    }
    return false;
  });
}

function onKey(k) {
  if (!locked || checking) return;
  if (k === 'bio') { tryBio(); return; }
  if (G.lockWait(lockSt(), Date.now()) > 0) { paintWait(); return; }
  if (k === 'back') entry = entry.slice(0, -1);
  else if (/^[0-9]$/.test(k) && entry.length < G.LOCK.PIN_LEN) entry += k;
  paintDots($('lockDots'), entry.length);
  if (entry.length === G.LOCK.PIN_LEN) { var p = entry; submit(p); }
  else if (entry.length) setMsg('');
}

function tryBio() {
  if (!locked || !bioOn()) return Promise.resolve(false);
  return bioVerify('Вход в приложение').then(function () {
    if (locked) unlockOk();
    return true;
  }, function (e) {
    var c = bioCode(e);
    // окно закрыла система - остаёмся на экране отпечатка (кнопки «Войти по отпечатку» /
    // «Ввести код»)
    if (c === '15') { setMsg(''); return false; }
    // «Ввести код» в системном окне - сразу код, а не снова экран отпечатка (ревью 14.10 №5)
    if (c === '16') { bioFirst(false); setMsg(''); return false; }
    // три неудачных касания (10), датчик заблокирован или сбой - код
    bioFirst(false);
    setMsg('Не получилось по отпечатку - введите код');
    return false;
  });
}

// ---------- «Забыл код» ----------
function sheet(title, text, buttons) {
  $('lockSheetT').textContent = title;
  $('lockSheetP').textContent = text;
  var box = $('lockSheetBtns');
  box.innerHTML = '';
  buttons.forEach(function (b) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'btn ' + (b.cls || 'ghost');
    el.textContent = b.label;
    el.addEventListener('click', function () { $('lockSheet').hidden = true; if (b.onClick) b.onClick(); });
    box.appendChild(el);
  });
  $('lockSheet').hidden = false;
}
// Отпечаток включён, но телефон его больше не умеет - честно про переустановку, а не
// кнопка «Войти по отпечатку», которая не сработает.
function forgot() {
  if (!bioOn()) { forgotNoBio(); return; }
  bioAvailable().then(function (can) { if (!locked) return; if (can) forgotBio(); else forgotNoBio(); });
}
function forgotBio() {
  sheet('Забыли код?', 'Войдите по отпечатку - и сразу задайте новый код.', [
    { label: 'Отмена', cls: 'nav' },
    { label: 'Войти по отпечатку', cls: 'primary', onClick: function () {
      pendingAfterUnlock = function () { setTimeout(function () { setupPin(true); }, 300); };
      tryBio().then(function (okk) { if (!okk) pendingAfterUnlock = null; });
    } }
  ]);
}
function forgotNoBio() {
  sheet('Код не сбросить', 'Код хранится только на этом телефоне, подсмотреть его нельзя. Сбросить код можно только переустановкой приложения, а при ней все данные удалятся. Если у вас есть копия данных в файле, после переустановки откройте меню → «Копия данных» → «Восстановить из файла».', [
    { label: 'Понятно', cls: 'primary' }
  ]);
}

$('lockPad').addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('.lk-key[data-k]') : null;
  if (b && !b.disabled) onKey(b.getAttribute('data-k'));
});
$('lockForgot').addEventListener('click', forgot);
$('lockBioTry').addEventListener('click', function () { tryBio(); });
$('lockToCode').addEventListener('click', function () { bioFirst(false); setMsg(''); });
// с клавиатуры (эмулятор, внешняя клавиатура): цифры и Backspace
document.addEventListener('keydown', function (e) {
  if (!locked) return;
  if (/^[0-9]$/.test(e.key)) { onKey(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { onKey('back'); e.preventDefault(); }
}, true);

// ---------- фон ----------
var bgAt = 0, bgAway = false;
function onBackground() {
  if (bgAt) return;
  var now = Date.now();
  bgAt = now;
  bgAway = !!awayAt && (now - awayAt < awayFor);
  awayAt = 0; awayFor = 0;
  // шторка: данные не видны ни в «недавних» (где нет родной защиты), ни при возврате
  if (isOn() && !bgAway) coverOn();
}
function onForeground() {
  if (!bgAt) return false;
  var need = G.resumeLock({ on: isOn(), bgAt: bgAt, now: Date.now(), away: bgAway });
  bgAt = 0; bgAway = false;
  if (need) {
    // Шторка снимает своё inert/aria-hidden ДО закрытия окон: иначе она запомнила aria-hidden
    // открытого меню, и после входа закрытое меню вернулось бы «видимым» диктору (ревью 1.0.3).
    // Всё в одном такте - между шагами экран не рисуется.
    if (covered) { covered = false; underLock(false); }
    if (window.UI && window.UI.closeTop) closeOverlays();
    showLock();
  }
  else coverOff();
  return need;
}
// под замком не должно остаться открытых окон с данными (карточка, сводка, меню). Окно
// «Данные не прочитались» одноразовое (в нём «Сохранить повреждённые данные в файл») -
// запоминаем и показываем снова после входа (ревью 1.0.3).
var reopenProblem = false;
function closeOverlays() {
  try { if (window.UI.problemOpen && window.UI.problemOpen()) reopenProblem = true; } catch (e) {}
  try { for (var g = 0; g < 8 && window.UI.closeTop(); g++) {} } catch (e) {}
  try { if (window.UI.hideToast) window.UI.hideToast(); } catch (e) {}
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') onBackground(); else onForeground();
});
try {
  var N0 = NP();
  if (N0 && N0.App && N0.App.addListener) {
    N0.App.addListener('pause', onBackground);
    N0.App.addListener('resume', onForeground);
    N0.App.addListener('appStateChange', function (st) { if (st && st.isActive === false) onBackground(); else onForeground(); });
  }
} catch (e) {}

// ---------- настройка в меню ----------
function UIok() { return !!(window.UI && window.UI.openDlg); }
// Окно с клавиатурой кода (настройка). cb(pin) - когда набраны 4 цифры; вернуть
// строку - показать её ошибкой и набирать заново.
function askPin(o) {
  var entryD = '';
  var body = '<div class="lk-dlg">' +
    (o.text ? '<div class="lk-dlg-p">' + UI.esc(o.text) + '</div>' : '') +
    '<div class="lk-dots" id="pinDots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
    '<div class="lk-msg" id="pinMsg" role="status"></div>' +
    '<div class="lk-pad" id="pinPad">' + padHtml(!!o.bio) + '</div></div>';
  UI.openDlg({
    title: o.title, body: body,
    buttons: [{ label: 'Отмена', cls: 'nav', onClick: function () { if (o.onCancel) o.onCancel(); } }],
    onOpen: function () {
      var pad = $('pinPad');
      if (!pad) return;
      pad.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.lk-key[data-k]') : null;
        if (!b) return;
        var k = b.getAttribute('data-k');
        if (k === 'bio') { if (o.onBio) o.onBio(); return; }
        if (k === 'back') entryD = entryD.slice(0, -1);
        else if (entryD.length < G.LOCK.PIN_LEN) entryD += k;
        paintDots($('pinDots'), entryD.length);
        if (entryD.length === G.LOCK.PIN_LEN) {
          var pin = entryD; entryD = '';
          Promise.resolve(o.onPin(pin)).then(function (err) {
            if (typeof err === 'string' && $('pinMsg')) {
              paintDots($('pinDots'), 0, true);
              $('pinMsg').textContent = err; $('pinMsg').classList.add('warn');
            }
          });
        } else if ($('pinMsg')) { $('pinMsg').textContent = ''; $('pinMsg').classList.remove('warn'); }
      });
    }
  });
}

// задать код (дважды). keepBio - оставить выбор отпечатка как был (смена кода).
function setupPin(keepBio, bioChoice, done) {
  // с отпечатком код - запасной вход, а не то, что вводят каждый раз (Алексей 14.10)
  var bio = keepBio ? !!load().bio : !!bioChoice;
  askPin({
    title: 'Придумайте код',
    text: bio ? 'Четыре цифры - запасной вход: если отпечаток не сработает или его выключат.'
      : 'Четыре цифры. Их нужно будет вводить при входе в приложение.',
    onPin: function (first) {
      if (!G.validPin(first)) return 'Нужны четыре цифры';
      setTimeout(function () {
        askPin({
          title: 'Повторите код', text: 'Введите те же четыре цифры ещё раз.',
          onPin: function (second) {
            if (second !== first) {
              setTimeout(function () { UI.toast('Коды не совпали - задайте заново'); setupPin(keepBio, bioChoice, done); }, 0);
              UI.closeDlg();
              return;
            }
            return G.makePinRecord(first).then(function (rec) {
              var s = load();
              var wasOn = isOn();
              s.on = true; s.salt = rec.salt; s.hash = rec.hash; s.iter = rec.iter;
              if (!keepBio) s.bio = !!bioChoice;
              s.fails = 0; s.lockouts = 0; s.until = 0;
              if (!store(s)) { UI.closeDlg(); UI.dlgAlert('Телефон не дал сохранить код. Попробуйте ещё раз.', 'Защита входа'); return; }
              UI.closeDlg();
              syncRecents();
              UI.toast(wasOn ? 'Код изменён' : 'Защита входа включена');
              if (UI.haptic) UI.haptic('medium');
              if (UI.renderMenu) UI.renderMenu();
              if (done) done();
            }, function () {
              UI.closeDlg();
              UI.dlgAlert('Не получилось сохранить код на этом телефоне.', 'Защита входа');
            });
          }
        });
      }, 0);
    }
  });
}

var BACKUP_WAIT = { ms: 20000 };
function once(f) { var done = false; return function () { if (!done) { done = true; f(); } }; }
// f() после ms непрерывного «приложение на экране» (уход в окно сохранения счёт сбрасывает)
function waitVisible(ms, f) {
  var since = Date.now(), t = setInterval(function () {
    if (document.visibilityState === 'hidden') { since = Date.now(); return; }
    if (Date.now() - since >= ms) { clearInterval(t); f(); }
  }, Math.min(1000, Math.max(50, Math.round(ms / 4))));
  return t;
}
// Перед включением без отпечатка - честно про «забыл код» и предложение копии.
function warnNoBio(next) {
  UI.openDlg({
    title: 'Сначала сохраните копию',
    body: UI.esc('Если вы забудете код, сбросить его можно только переустановкой приложения, а при ней все данные на телефоне удалятся. Копия в файле поможет всё вернуть.'),
    buttons: [
      { label: 'Дальше', cls: 'ghost', onClick: function () { setTimeout(next, 0); } },
      { label: 'Сохранить копию', cls: 'primary', onClick: function () {
        setTimeout(function () {
          var p = (window.Backup && window.Backup.backup) ? window.Backup.backup() : Promise.resolve(null);
          var go = once(function () { setTimeout(next, 400); });
          Promise.resolve(p).then(go, go);
          // окно сохранения так и не ответило (плагин потерял вызов) - настройку кода не
          // обрываем молча: после возврата в приложение ждём ещё BACKUP_WAIT и идём дальше
          waitVisible(BACKUP_WAIT.ms, go);
        }, 0);
      } }
    ]
  });
}

function enableFlow() {
  UI.openDlg({
    title: 'Защита входа',
    body: '<div class="lk-dlg-p">' + UI.esc('При входе в приложение и после перерыва дольше 5 минут нужно подтвердить, что это вы: отпечатком или кодом из 4 цифр.') + '</div>' +
      '<div class="lk-dlg-p lk-dim">' + UI.esc('Это замок от посторонних глаз: данные на телефоне он не шифрует.') + '</div>',
    buttons: [
      { label: 'Отмена', cls: 'nav' },
      { label: 'Задать код', cls: 'primary', onClick: function () { setTimeout(chooseBio, 0); } }
    ]
  });
}
function chooseBio() {
  bioAvailable().then(function (can) {
    if (!can) { warnNoBio(function () { setupPin(false, false); }); return; }
    UI.openDlg({
      title: 'Входить по отпечатку?',
      body: UI.esc('Отпечаток - быстрый вход. Код всё равно нужен: на случай, если отпечаток не сработает.'),
      buttons: [
        { label: 'Только код', cls: 'ghost', onClick: function () { setTimeout(function () { warnNoBio(function () { setupPin(false, false); }); }, 0); } },
        { label: 'Да, отпечаток', cls: 'primary', onClick: function () {
          setTimeout(function () {
            bioVerify('Проверка отпечатка').then(function () { setupPin(false, true); }, function () {
              UI.toast('Отпечаток не подтвердился - включим только код');
              warnNoBio(function () { setupPin(false, false); });
            });
          }, 0);
        } }
      ]
    });
  });
}

// Действия при включённом замке требуют текущий код (или отпечаток).
function confirmOwner(title, then) {
  if (!bioOn()) { askOwner(title, then, false); return; }
  bioAvailable().then(function (can) { askOwner(title, then, can); });
}
function askOwner(title, then, useBio) {
  askPin({
    title: title, text: 'Введите текущий код.', bio: useBio,
    onBio: function () { bioVerify('Подтвердите, что это вы').then(function () { UI.closeDlg(); setTimeout(then, 0); }, function () {}); },
    onPin: function (pin) {
      var w = G.lockWait(lockSt(), Date.now());
      if (w > 0) return waitText(w);
      return G.checkPin(load(), pin).then(function (good) {
        if (good) { storeFails(G.lockOk(rec())); UI.closeDlg(); setTimeout(then, 0); return; }
        var st = G.lockFail(rec(), Date.now()); storeFails(st);
        var w2 = G.lockWait(st, Date.now());
        return w2 > 0 ? waitText(w2) : 'Неверный код';
      });
    }
  });
}

function disable() {
  var s = load();
  s.on = false; delete s.salt; delete s.hash; delete s.iter; s.bio = false;
  s.fails = 0; s.lockouts = 0; s.until = 0;
  store(s);
  syncRecents();
  UI.toast('Защита входа выключена');
  if (UI.renderMenu) UI.renderMenu();
}
function setBio(on) {
  var s = load(); s.bio = !!on; store(s);
  UI.toast(on ? 'Вход по отпечатку включён' : 'Вход по отпечатку выключен');
  if (UI.renderMenu) UI.renderMenu();
}

function settingsFlow() {
  bioAvailable().then(function (can) {
    var bio = bioOn();
    var body = '<div class="lk-dlg-p lk-dim">' + UI.esc('Замок закрывает вход от посторонних глаз. Данные на телефоне он не шифрует.') + '</div>' +
      '<div class="op-pick">' +
      '<button type="button" class="btn ghost" data-lk="change">Сменить код</button>' +
      // отпечатки удалили в телефоне, а флаг включён - кнопка «Выключить» всё равно нужна
      ((can || bio) ? '<button type="button" class="btn ghost" data-lk="bio">' + (bio ? 'Выключить вход по отпечатку' : 'Включить вход по отпечатку') + '</button>' : '') +
      '<button type="button" class="btn ghost lk-off" data-lk="off">Выключить код</button>' +
      '</div>';
    UI.openDlg({
      title: 'Защита входа', body: body,
      buttons: [{ label: 'Закрыть', cls: 'nav' }],
      onOpen: function () {
        var box = $('dlgBody').querySelector('.op-pick');
        if (!box) return;
        box.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('[data-lk]') : null;
          if (!b) return;
          var a = b.getAttribute('data-lk');
          UI.closeDlg();
          setTimeout(function () {
            if (a === 'change') confirmOwner('Сменить код', function () { setupPin(true); });
            else if (a === 'off') confirmOwner('Выключить код', disable);
            else if (a === 'bio') {
              if (bio) setBio(false);
              else bioVerify('Проверка отпечатка').then(function () { setBio(true); }, function () { UI.toast('Отпечаток не подтвердился'); });
            }
          }, 0);
        });
      }
    });
  });
}

function onMenuTile() {
  if (!UIok()) return;
  if (UI.closeMenu) UI.closeMenu();
  if (isOn()) settingsFlow(); else enableFlow();
}
var tile = $('mLock');
if (tile) tile.addEventListener('click', onMenuTile);

function menuInfo() { return isOn() ? (bioOn() ? 'вкл · отпечаток' : 'вкл') : 'выкл'; }

// ---------- старт ----------
// Замок включён - закрываем экран сразу, до ui.js и его чисел.
if (isOn()) showLock();
syncRecents();

window.AppLock = {
  KEY: KEY,
  isOn: isOn, bioOn: bioOn, isLocked: function () { return locked; }, isCovered: function () { return covered; },
  away: away, AWAY_CALL: AWAY_CALL, menuInfo: menuInfo, lockNow: function () { if (isOn()) showLock(); },
  onBackground: onBackground, onForeground: onForeground,
  // для self-test: перевести часы фона, включить с известным кодом
  _bgAt: function (ms) { bgAt = ms; },
  _setupPin: setupPin,
  _awayAge: function (ms) { if (awayAt) awayAt = Date.now() - ms; },
  _backupWait: function (ms) { BACKUP_WAIT.ms = ms; },
  _enable: function (pin, bio) {
    return G.makePinRecord(pin).then(function (rec) {
      var s = load(); s.on = true; s.salt = rec.salt; s.hash = rec.hash; s.iter = rec.iter; s.bio = !!bio;
      s.fails = 0; s.lockouts = 0; s.until = 0; store(s); return true;
    });
  },
  _disable: function () { try { localStorage.removeItem(KEY); } catch (e) {} mem = null; hideLock(); },
  _unlockState: function () { store(G.lockOk(load())); paintWait(); setMsg(''); },
  _setupPin: setupPin, _forgot: forgot, _warnNoBio: warnNoBio
};

})();
