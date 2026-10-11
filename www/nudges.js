/* nudges.js - две ненавязчивые просьбы (1.0.3). Решения - чистые функции guards.js.

   1. Окно оценки RuStore (Review SDK, плагин RuStoreReview). Зовёт ui.js сразу после
      удачной записи операции (Nudges.afterTx). Своих окон, предварительного вопроса и своей
      кнопки нет (запрещено правилами RuStore): только системное окно RuStore, и то один раз.
      Любой ответ SDK записываем молча. В браузере и без плагина - ничего не делаем.
   2. Напоминание «сохрани копию данных»: спокойная карточка #remind внизу, не чаще раза
      в месяц, с кнопками «Сохранить копию» (бэкап из backup.js) и «Позже» (не раньше чем
      через GAP_DAYS дней и не в этом месяце). Автокопии в «Загрузки» нет: ей нужны лишние разрешения.

   Флаги - в отдельных ключах localStorage рядом с данными (UI.KEY + '.review' и
   Backup.STAMP_KEY = UI.KEY + '.backup'), а не в состоянии S: S уезжает в файл бэкапа,
   а «уже спрашивали» и «когда была копия» - про этот телефон и этот набор данных. */
(function () {
'use strict';

var G = window.Guards, UI = window.UI;
if (!G || !UI) return;
var $ = function (id) { return document.getElementById(id); };

var RKEY = UI.KEY + '.review';
var BKEY = (window.Backup && window.Backup.STAMP_KEY) || (UI.KEY + '.backup');

function get(k) {
  try { var o = JSON.parse(localStorage.getItem(k) || 'null'); return (o && typeof o === 'object') ? o : {}; }
  catch (e) { return {}; }
}
function put(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); return true; } catch (e) { return false; } }

function locked() { return !!(window.AppLock && window.AppLock.isLocked && window.AppLock.isLocked()); }
function busy() {
  if (locked()) return true;
  try { if (UI.topOverlay && UI.topOverlay()) return true; } catch (e) {}
  return !!(UI.onboardOpen && UI.onboardOpen());
}

// ---------- 1. окно оценки ----------
var REVIEW_DELAY = 1500;   // после записи: тост, звук и полёт фишки успевают отыграть
var asking = false;
// «Уже спрашивали» в памяти сессии: флаги в localStorage могут не лечь (хранилище забито),
// и без этой отметки окно оценки запрашивалось бы после каждой операции (ревью 1.0.3).
var askedSession = false;
var pluginOverride = null;  // self-test подкладывает поддельный плагин

function reviewPlugin() {
  if (pluginOverride) return pluginOverride;
  // тест-сборка окно оценки не зовёт никогда (guards.js reviewAllowed)
  if (!G.reviewAllowed(window.Access)) return null;
  if (!(window.isNativeApp && window.isNativeApp())) return null;
  var N = window.NativePlugins;
  return (N && N.RuStoreReview) ? N.RuStoreReview : null;
}
function reviewCtx() {
  var S = UI.S || {};
  var list = Array.isArray(S.tx) ? S.tx : [];
  return { now: Date.now(), txCount: list.length, firstTs: G.firstTxTime(list) };
}
// Пора ли (без побочных эффектов) - для self-test и для afterTx
function reviewDue() { return G.reviewDue(get(RKEY), reviewCtx()); }

// Сразу после удачной записи операции. true - окно запланировано.
function afterTx() {
  var p = reviewPlugin();
  if (!p || asking || askedSession) return false;
  if (!reviewDue()) return false;
  asking = true;
  setTimeout(function () { launch(p); }, pluginOverride ? 0 : REVIEW_DELAY);
  return true;
}
function launch(p) {
  // за полторы секунды хозяин мог открыть окно или уйти - тогда не мешаем, спросим
  // после следующей записи (флаги не тронуты)
  if (busy() || document.visibilityState === 'hidden') { asking = false; return Promise.resolve(null); }
  var now = Date.now();
  // флаги не легли (хранилище забито) - «уже спрашивали» держим в памяти до конца сессии
  if (!put(RKEY, G.reviewStart(get(RKEY), now))) askedSession = true;
  // окно RuStore уводит в фон - «Защита входа» не запирает; вызов кончился без ухода в фон
  // (RuStore сразу ответил ошибкой) - отметку снимаем, иначе следующий настоящий уход простился бы
  var release = (window.AppLock && window.AppLock.away) ? window.AppLock.away(window.AppLock.AWAY_CALL) : null;
  var res;
  try { res = Promise.resolve(p.requestAndLaunch()); } catch (e) { res = Promise.reject(e); }
  return res.then(function (r) { return r || { shown: false, code: 'ERROR' }; }, function () { return { shown: false, code: 'ERROR' }; })
    .then(function (r) {
      if (typeof release === 'function') release();
      put(RKEY, G.reviewAfter(get(RKEY), r, Date.now()));
      asking = false;
      return r;
    });
}

// ---------- 2. напоминание о копии ----------
function stamp() { return get(BKEY); }
function remindCtx() {
  var s = stamp(), S = UI.S || {};
  return {
    now: Date.now(), lastAt: s.lastAt, shownYM: s.shownYM, snoozeYM: s.snoozeYM,
    shownAt: s.shownAt, snoozeAt: s.snoozeAt, off: !!s.off,
    txCount: Array.isArray(S.tx) ? S.tx.length : 0,
    demo: !!(UI.DEMO || (S.ui && S.ui.demo))
  };
}
function remindEl() { return $('remind'); }
function remindShown() { var el = remindEl(); return !!el && !el.hidden; }
function showRemind() {
  var el = remindEl();
  if (!el) return false;
  el.hidden = false;
  var s = stamp(), now = Date.now(); s.shownYM = G.ymOf(now); s.shownAt = now; put(BKEY, s);
  syncMain();
  return true;
}
function hideRemind() { var el = remindEl(); if (el && !el.hidden) { el.hidden = true; syncMain(); } }
// карточка стоит на месте «плюса» и нижней подсказки - ui.js прячет их, пока она видна
function syncMain() { try { if (UI.updateMainHint) UI.updateMainHint(); } catch (e) {} }

// ctxPatch - только для self-test (например, снять «демо», чтобы увидеть карточку)
function checkRemind(ctxPatch) {
  if (remindShown() || busy()) return false;
  var c = remindCtx();
  if (ctxPatch) for (var k in ctxPatch) c[k] = ctxPatch[k];
  if (!G.backupDue(c)) return false;
  return showRemind();
}
function later() {
  var s = stamp(), now = Date.now(); s.snoozeYM = G.ymOf(now); s.snoozeAt = now; put(BKEY, s);
  hideRemind();
  if (UI.haptic) UI.haptic('light');
}
function saveNow() {
  hideRemind();
  if (window.Backup && window.Backup.backup) window.Backup.backup();
}
function remindOff() { return !!stamp().off; }
function setRemindOff(off) {
  var s = stamp(); s.off = !!off; put(BKEY, s);
  if (off) hideRemind();
}

if ($('remindLater')) $('remindLater').addEventListener('click', later);
if ($('remindSave')) $('remindSave').addEventListener('click', saveNow);
// тумблер «Напоминать раз в месяц» в подменю «Копия данных» (ui.js openCopy)
function toggleRemind() {
  var off = !remindOff();
  setRemindOff(off);
  UI.toast(off ? 'Напоминания о копии выключены' : 'Напомню о копии раз в месяц');
  if (UI.haptic) UI.haptic('light');
  if (UI.renderMenu) UI.renderMenu();
}

// Спокойный момент: через пару секунд после запуска и при возврате в приложение.
setTimeout(function () { try { checkRemind(); } catch (e) {} }, 2500);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'hidden') setTimeout(function () { try { checkRemind(); } catch (e) {} }, 1200);
});

window.Nudges = {
  RKEY: RKEY, BKEY: BKEY,
  afterTx: afterTx, reviewDue: reviewDue, launch: launch,
  checkRemind: checkRemind, hideRemind: hideRemind, remindShown: remindShown,
  later: later, remindOff: remindOff, setRemindOff: setRemindOff, toggleRemind: toggleRemind,
  _plugin: function (p) { pluginOverride = p || null; asking = false; askedSession = false; }
};

if (UI.renderMenu) { try { UI.renderMenu(); } catch (e) {} }

})();
