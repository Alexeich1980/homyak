/* boot.js — заслон от кирпича при бесшовном обновлении.

   Грузится ПЕРВЫМ после version.js и capacitor.js, до всего приложения: если новая
   веб-сборка, приехавшая обновлением, не умеет запускаться, вернуться назад должен
   кто-то, кому для работы не нужны ни движок, ни UI. Это он.

   Как устроена страховка (ключи в localStorage, он общий для всех сборок — привязан
   к адресу https://localhost, а не к папке):
     homyak-ota-try  {version, ts, boots, sha256} — поставлен ПЕРЕД перезапуском на новую
     homyak-ota-ok   "0.3.1"               — сборка доказала, что живая (дошла до appReady)
     homyak-ota-fail {version,count,sha256}— сборка не завелась; UI скажет хозяину, а
                                             update.js больше не предложит эту версию

   Правило: первый запуск новой сборки помечаем boots=1 и пропускаем. Если дошли сюда
   ВТОРОЙ раз, а подтверждения «ok» так и нет — сборка падает до appReady, откатываемся.

   Куда откатываемся, по порядку:
     1) на ПРЕЖНЮЮ РАБОЧУЮ сборку — её номер лежит в ota/state.json {current, previousOk},
        она же не подметается уборкой, пока новая не подтвердится;
     2) на копию заводской www в ota/base/ (её делает update.js на первом запуске);
     3) на встроенные ассеты APK: WebView.setServerAssetPath('public').
   Именно первый шаг и есть «вернул прежнюю версию» из CHANGELOG: без него откат уводил
   хозяина сразу на заводскую, то есть на две версии назад.
   Проверено по исходникам Capacitor 6.2.2:
     Bridge.java:280-284 — при старте сохранённый путь берётся, только если он не пуст И
       папка существует; «public» — относительный путь, new File("public").exists() = false,
       то есть сохранение после setServerAssetPath работает как «сбросить на заводское»;
     Bridge.java:1381-1394 — setServerBasePath/setServerAssetPath сами перезагружают webView;
     Bridge.java:415-435 — установка нового APK и так стирает сохранённый путь (isNewBinary).

   Файл двойного назначения: в браузере выполняется сразу, в node-тестах экспортирует
   чистое решение decide() — его и проверяют тесты. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Boot = factory(); root.Boot.run(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var K_TRY = 'homyak-ota-try';
  var K_OK = 'homyak-ota-ok';
  var K_FAIL = 'homyak-ota-fail';

  // ---------- чистая часть ----------

  // get(key) → строка или null; ver — версия сборки, которая сейчас исполняется.
  // Ответ: 'none' (не наше дело), 'arm' (первый запуск, взвести счётчик),
  // 'clear' (метка протухла, убрать), 'revert' (сборка не завелась, откат).
  function decide(get, ver, isStore) {
    var raw = null;
    // Сторовая сборка (HOMYAK_STORE): код меняет только RuStore, откатываться на скачанные
    // OTA-папки ей некуда и нельзя - любую метку попытки просто снимаем.
    if (isStore) {
      try { raw = get(K_TRY); } catch (e) { return { action: 'none' }; }
      return raw ? { action: 'clear' } : { action: 'none' };
    }
    try { raw = get(K_TRY); } catch (e) { return { action: 'none' }; }
    if (!raw) return { action: 'none' };

    var t = null;
    try { t = JSON.parse(raw); } catch (e) { t = null; }
    if (!t || typeof t !== 'object' || !t.version) return { action: 'clear' };

    // метка про другую сборку (например, откатились и работаем со старой) — не наше дело
    if (String(t.version) !== String(ver)) return { action: 'clear' };

    var ok = null;
    try { ok = get(K_OK); } catch (e) {}
    if (String(ok) === String(ver)) return { action: 'clear' };   // уже подтверждена

    var boots = (typeof t.boots === 'number' && isFinite(t.boots)) ? t.boots : 0;
    var sha = (typeof t.sha256 === 'string') ? t.sha256 : '';
    if (boots >= 1) return { action: 'revert', version: String(ver), sha256: sha };
    return { action: 'arm', mark: { version: String(ver), ts: t.ts || 0, boots: boots + 1, sha256: sha } };
  }

  // Запись о провале копится: считаем, сколько раз эта версия не завелась, и запоминаем
  // sha архива — по нему update.js отличит «ту же сломанную» от перевыложенной.
  function failRecord(prev, version, sha) {
    var was = null;
    if (typeof prev === 'string' && prev) {
      try { was = JSON.parse(prev); } catch (e) { was = { version: prev, count: 1 }; }
      if (typeof was === 'string') was = { version: was, count: 1 };
    }
    var same = was && was.version != null && String(was.version) === String(version);
    var n = (same && typeof was.count === 'number' && isFinite(was.count) && was.count > 0) ? was.count : 0;
    return { version: String(version), count: n + 1, sha256: sha || (same && was.sha256) || '', shown: false };
  }

  // ---------- браузер / телефон ----------

  function store() {
    try { return (typeof window !== 'undefined' && window.localStorage) || null; } catch (e) { return null; }
  }

  function native() {
    try {
      var C = (typeof window !== 'undefined') ? window.Capacitor : null;
      if (!C || typeof C.registerPlugin !== 'function') return null;
      if (!(C.isNativePlatform && C.isNativePlatform())) return null;
      return C;
    } catch (e) { return null; }
  }

  // Откат. setServerBasePath/setServerAssetPath сами перезагружают WebView, поэтому
  // persistServerBasePath зовём В ТОМ ЖЕ такте, не дожидаясь ответа: оба вызова уходят
  // в мост по порядку и выполняются одной фоновой очередью (Bridge.java:840 —
  // taskHandler.post), а вот обещание уже может не вернуться — страницу к тому моменту
  // сносит перезагрузкой.
  function revert(C) {
    var W, F;
    try {
      W = C.registerPlugin('WebView');
      F = C.registerPlugin('Filesystem');
    } catch (e) { return; }

    function toAssets() {
      try { W.setServerAssetPath({ path: 'public' }); W.persistServerBasePath(); } catch (e) {}
    }

    // Переставить WebView на папку сборки. Оба вызова одним тактом (см. комментарий выше).
    function toDir(dir) {
      return F.stat({ directory: 'DATA', path: dir + '/.complete' })
        .then(function () { return F.getUri({ directory: 'DATA', path: dir }); })
        .then(function (r) {
          var p = String((r && r.uri) || '').replace(/^file:\/\//, '');
          if (!p) throw new Error('нет пути');
          W.setServerBasePath({ path: p });
          W.persistServerBasePath();
          return true;
        });
    }

    // Прежняя рабочая сборка из карты ota/state.json — первая цель отката.
    function prevOk() {
      return F.readFile({ directory: 'DATA', path: 'ota/state.json', encoding: 'utf8' })
        .then(function (r) {
          var o = null;
          try { o = JSON.parse(String((r && r.data) || '')); } catch (e) { o = null; }
          var v = (o && typeof o.previousOk === 'string') ? o.previousOk.trim() : '';
          if (!v || !/^\d+(\.\d+){0,2}$/.test(v)) throw new Error('нет прежней');
          return v;
        });
    }

    try {
      prevOk()
        .then(function (v) { return toDir('ota/' + v); })
        .catch(function () { return toDir('ota/base'); })
        .catch(function () { toAssets(); });
    } catch (e) { toAssets(); }
  }

  function run() {
    var ls = store();
    if (!ls) return;
    // Не загрузился version.js — считаем версию нулевой, ровно как update.js: два
    // заслона не должны расходиться в трактовке одной и той же дыры. Говорим об этом
    // в консоль один раз, чтобы такое не проходило молча.
    var raw = (typeof window !== 'undefined') ? window.APP_VERSION : null;
    var ver = String(raw || '0');
    if (!raw) {
      try { console.warn('boot.js: нет APP_VERSION (version.js не загрузился), считаю версию «0»'); } catch (e) {}
    }

    var d;
    var isStore = (typeof window !== 'undefined' && window.HOMYAK_STORE === true);
    try { d = decide(function (k) { return ls.getItem(k); }, ver, isStore); }
    catch (e) { return; }

    try {
      if (d.action === 'clear') { ls.removeItem(K_TRY); return; }
      if (d.action === 'arm') { ls.setItem(K_TRY, JSON.stringify(d.mark)); return; }
      if (d.action !== 'revert') return;
      // метку снимаем ДО отката: второй попытки быть не должно ни при каком раскладе
      ls.removeItem(K_TRY);
      var was = null;
      try { was = ls.getItem(K_FAIL); } catch (e) {}
      ls.setItem(K_FAIL, JSON.stringify(failRecord(was, d.version, d.sha256)));
    } catch (e) { return; }

    var C = native();
    if (C) revert(C);
  }

  return { decide: decide, failRecord: failRecord, run: run, K_TRY: K_TRY, K_OK: K_OK, K_FAIL: K_FAIL };
});
