/* update.js — проверка обновления и само обновление.

   СТОРОВАЯ сборка (Access.STORE, вшивается build-lib.js при --store), с 1.0.3: обновления
   ТОЛЬКО через RuStore App Update SDK (нативный плагин RuStoreUpdate,
   android/.../RuStoreUpdatePlugin.java, перенесён из «Карты года»). SDK спрашивает у
   приложения RuStore на телефоне, есть ли в магазине версия новее, и само ставит её своим
   окном. Свой манифест на CDN стор-сборка НЕ читает (05.10.2026: CDN не отдавал CORS,
   корень домена лёг - проверка писала «Нет связи» при живом интернете). Веб-часть стор-сборки
   в сеть не ходит вовсе: CSP connect-src 'none' (build-lib.js shipCsp). Проверка тихо раз в
   неделю при запуске (метка updCheckAt) и по кнопке «Проверить»; найденная версия живёт
   между запусками (updNewer), пока её не поставят.

   ТЕСТ-СБОРКА (только Алексею): прежний путь через свой манифест, описан ниже. SDK в ней не
   зовём: у неё тот же applicationId, и RuStore предложил бы поставить магазинную версию
   поверх тестовой. Сеть - только к www.dorokhin-finance.ru (CSP в index.html).

   Канал тест-сборки: https://www.dorokhin-finance.ru/homyak-store/update.json, вид манифеста

     {
       "version": "0.3.0",                                  // версия ОБОЛОЧКИ (APK)
       "apkUrl":  "https://www.dorokhin-finance.ru/homyak-store/homyak-0.3.0.apk",
       "size":    3120000,
       "notes":   "что нового",
       "web": {                                             // необязательный раздел
         "version":  "0.3.1",                               // версия ВЕБ-СБОРКИ
         "url":      "https://www.dorokhin-finance.ru/homyak-store/www-0.3.1.zip",
         "sha256":   "…64 шестнадцатеричных знака…",
         "size":     520000,
         "minShell": "0.3.0"                                // с какой оболочки поедет
       }
     }

   Два канала (только не-стор):
     1. ВЕБ. Приложение — это папка www; её и подменяем: качаем zip, сверяем sha256,
        распаковываем в личную папку телефона, показываем WebView на новую папку и
        перезапускаемся. Заслон от кирпича — в boot.js.
     2. APK (когда меняется сама оболочка): открываем файл в системном браузере.
        Новых разрешений не просим - REQUEST_INSTALL_PACKAGES в приложении нет.

   Чистая часть (сравнение версий, разбор манифеста и ответа RuStore, решение «что делать»,
   безопасность путей из архива) вынесена наружу как у engine.js: её проверяют node-тесты. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Update = factory(); root.Update.mount(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // www: корень домена висел на IP узла CDN и лёг 05.10.2026, www (CNAME) живой
  var URL_MANIFEST = 'https://www.dorokhin-finance.ru/homyak-store/update.json';
  // Страница приложения в RuStore - туда уводим сторовую сборку за обновлением.
  var URL_RUSTORE = 'https://www.rustore.ru/catalog/app/ru.dorokhin.homyak';
  // Файлы берём только со своего домена: подменённый манифест не должен уметь
  // отправить хозяина ставить чужой файл.
  var HOST = 'dorokhin-finance.ru';
  var T_NET = 8000;          // манифест — маленький
  var T_ZIP = 20000;         // база на архив сборки; дальше по размеру, см. zipTimeout
  var T_ZIP_MB = 10000;      // ещё столько секунд на каждый мегабайт
  var T_ZIP_MAX = 120000;    // но не больше двух минут
  var T_SHELL = 3000;        // сколько ждём номер оболочки от App.getInfo()
  var MAX_ZIP = 8 * 1024 * 1024;
  // Предел на сжатый размер ничего не говорит про распакованный: 60 МБ нулей ужимаются
  // в 60 КБ. Поэтому второй заслон — на то, что реально ляжет в память WebView.
  var MAX_RAW = 30 * 1024 * 1024;        // вся сборка в распакованном виде
  var MAX_FILE = 8 * 1024 * 1024;        // один файл сборки

  var K_TRY = 'homyak-ota-try';
  var K_OK = 'homyak-ota-ok';
  var K_FAIL = 'homyak-ota-fail';
  // Карта сборок на диске рядом с ними же: localStorage может обнулиться (очистка
  // данных, переезд WebView), а знать, куда откатываться, надо всё равно.
  var STATE_PATH = 'ota/state.json';

  var ERR_NET = 'Нет связи с интернетом. Проверьте Wi-Fi или мобильный интернет';
  var ERR_SERVER = 'Сервер обновлений не ответил. Попробуйте позже';
  var ERR_SLOW = 'Обновление качается слишком долго - сеть слишком медленная. Попробуйте по Wi-Fi';
  var ERR_BAD = 'Сервер прислал непонятный ответ. Попробуйте позже';
  var ERR_HASH = 'Файл обновления скачался повреждённым. Ничего не изменено, попробуйте ещё раз';
  var ERR_ZIP = 'Файл обновления не распаковался. Ничего не изменено, попробуйте ещё раз';
  var ERR_BIG = 'Файл обновления подозрительно большой. Ничего не изменено';
  var ERR_WRITE = 'Не удалось записать обновление в память телефона. Ничего не изменено';
  var ERR_ONLYAPP = 'Доступно только в приложении на телефоне';

  // ---------- чистая часть ----------

  // Сравнение версий «0.10.0» и «0.9.3» по числам, а не по строке: -1 / 0 / 1.
  // Недостающие части считаем нулями («0.3» = «0.3.0»), мусор — нулём.
  function cmpVer(a, b) {
    var x = parts(a), y = parts(b);
    for (var i = 0; i < 3; i++) {
      if (x[i] > y[i]) return 1;
      if (x[i] < y[i]) return -1;
    }
    return 0;
  }

  function parts(v) {
    var s = String(v == null ? '' : v).trim().split('.');
    var out = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var n = parseInt(s[i], 10);
      out[i] = isFinite(n) && n >= 0 ? n : 0;
    }
    return out;
  }

  function isVer(v) { return /^\d+(\.\d+){0,2}$/.test(String(v == null ? '' : v).trim()); }

  // Архив веб-сборки качает сама веб-часть (fetch), а CSP тест-сборки пускает только
  // https://www.dorokhin-finance.ru (index.html, build-lib.js CSP_CONNECT_DEV). Адрес на голом
  // домене переводим на www (тот же сайт), прочие поддомены CSP закроет - такой раздел web
  // не принимаем: иначе вместо обновления «Нет связи» (ревью 1.0.3).
  var WEB_HOST = 'www.' + HOST;
  function webUrl(url) {
    var m = String(url).match(/^https:\/\/([^\/:?#]+)(.*)$/i);
    if (!m) return null;
    var h = m[1].toLowerCase();
    if (h === HOST) return 'https://' + WEB_HOST + m[2];
    return h === WEB_HOST ? url : null;
  }

  // адрес должен вести на свой домен (или его поддомен) и только по https
  function hostOf(url) {
    var m = String(url).match(/^https:\/\/([^\/:?#]+)/i);
    if (!m) return false;
    var h = m[1].toLowerCase();
    return h === HOST || h.slice(-(HOST.length + 1)) === '.' + HOST;
  }

  // Раздел «web» манифеста. Разбирается отдельно и мягко: не понравился — просто
  // нет бесшовного обновления, APK-канал при этом продолжает работать.
  function parseWeb(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (!isVer(o.version)) return null;
    var url = String(o.url == null ? '' : o.url);
    if (!/^https:\/\//i.test(url)) return null;
    if (!/\.zip(\?|$)/i.test(url)) return null;
    if (!hostOf(url)) return null;
    url = webUrl(url);
    if (!url) return null;
    var sha = String(o.sha256 == null ? '' : o.sha256).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) return null;
    var size = typeof o.size === 'number' && isFinite(o.size) && o.size > 0 ? Math.round(o.size) : 0;
    if (size > MAX_ZIP) return null;
    var minShell = isVer(o.minShell) ? String(o.minShell).trim() : '0';
    return { version: String(o.version).trim(), url: url, sha256: sha, size: size, minShell: minShell };
  }

  // Разбор манифеста: либо готовый объект, либо null, если пришло не то.
  // Никаких исключений наружу — вызывающий печатает своё сообщение.
  function parseManifest(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (!isVer(o.version)) return null;
    var url = String(o.apkUrl == null ? '' : o.apkUrl);
    if (!/^https:\/\//i.test(url)) return null;
    if (!/\.apk(\?|$)/i.test(url)) return null;
    if (!hostOf(url)) return null;
    var size = typeof o.size === 'number' && isFinite(o.size) && o.size > 0 ? Math.round(o.size) : 0;
    var notes = typeof o.notes === 'string' ? o.notes.trim() : '';
    return {
      version: String(o.version).trim(), apkUrl: url, size: size, notes: notes,
      web: parseWeb(o.web)
    };
  }

  // Память о провале: {version, count, sha256}. Сборка, которая уже не завелась на
  // ЭТОМ телефоне, второй раз не предлагается — иначе хозяин ходит по кругу «обновил →
  // откатило → обновил». Исключение одно: в манифесте под тем же номером лежит ДРУГОЙ
  // архив (другой sha256) — значит починили и перевыложили, можно пробовать.
  function failBlocks(fail, w) {
    if (!fail || !w) return false;
    if (String(fail.version) !== String(w.version)) return false;
    var n = (typeof fail.count === 'number' && isFinite(fail.count)) ? fail.count : 1;
    if (n < 1) return false;
    if (fail.sha256 && w.sha256 && !sameHash(fail.sha256, w.sha256)) return false;   // перевыложили
    return true;
  }

  // Что делать с этим манифестом. webVer — версия работающей сейчас веб-сборки
  // (APP_VERSION), shellVer — версия APK (null/'' = ещё не ответил App.getInfo()),
  // fail — память о провалившейся сборке.
  // Ответ: 'ota' | 'apk' | 'skipped' | 'none' | 'error'.
  function decide(m, webVer, shellVer, fail) {
    if (!m) return { kind: 'error' };
    // Номер оболочки не выдумываем: пока Android не ответил, сверять minShell нечем.
    // В таком состоянии бесшовное обновление не предлагаем вовсе (кроме сборок без
    // требований к оболочке) и честно уводим на канал APK.
    var unknown = (shellVer == null || String(shellVer) === '');
    var sv = unknown ? '0' : String(shellVer);
    var w = m.web, skipped = '';
    if (w && cmpVer(w.version, webVer) > 0 && !(unknown && w.minShell !== '0') &&
        cmpVer(w.minShell, sv) <= 0) {
      if (failBlocks(fail, w)) skipped = w.version;
      else return { kind: 'ota', version: w.version, size: w.size, notes: m.notes, web: w };
    }
    if (cmpVer(m.version, sv) > 0) {
      return { kind: 'apk', version: m.version, size: m.size, notes: m.notes,
               apkUrl: m.apkUrl, shellUnknown: unknown };
    }
    if (skipped) return { kind: 'skipped', version: skipped, shellUnknown: unknown };
    return { kind: 'none', shellUnknown: unknown };
  }

  // Устарела ли работающая веб-сборка относительно оболочки (APK). Версия вшитой в APK
  // веб-сборки == версии оболочки (build-apk.js держит их в одном номере). Значит если
  // сейчас грузимся НЕ со встроенных ассетов (а из OTA-папки) и загруженная версия
  // НЕ НОВЕЕ оболочки (меньше ИЛИ РАВНА) — эта OTA-папка лишняя: встроенные ассеты не
  // хуже, а тест и релиз одной версии различаются только вшитыми флагами (папка «той
  // же» версии могла остаться от сборки другого типа - так в 0.1.6 грузился старый www
  // без онбординга). Сбрасываем на ассеты. true ровно в этом случае.
  //   loadedVer   — версия работающей сейчас веб-сборки (APP_VERSION);
  //   shellVer    — версия оболочки (SHELL_VERSION), '' / null = ещё не известна;
  //   onAssetsBool— true, если WebView уже на встроенных ассетах ('public').
  function staleWww(loadedVer, shellVer, onAssetsBool) {
    if (onAssetsBool !== false) return false;            // на ассетах или неизвестно
    var s = String(shellVer == null ? '' : shellVer);
    if (!s) return false;                                // оболочка ещё не ответила
    return cmpVer(loadedVer, s) <= 0;
  }

  // ---------- стор: RuStore App Update SDK (чистая часть) ----------
  // Ответ плагина RuStoreUpdate.checkUpdate() → решение:
  //   {kind:'store', versionCode} - в RuStore есть версия новее;
  //   {kind:'none'}               - новее нет;
  //   {kind:'error', message}     - нет RuStore / сбой SDK / нет ответа (честная строка на «вы»).
  var MSG_NO_RUSTORE = 'На телефоне нет приложения RuStore - проверить обновление не получится. «Хомяк» обновляется через RuStore.';
  var MSG_SDK_FAIL = 'RuStore сейчас не ответил. Проверьте интернет и попробуйте позже.';
  var T_SDK = 15000;              // RuStore отвечает через своё приложение; дольше не ждём
  var UNKNOWN = 'unknown';        // RuStore сказал «есть», но без номера

  function vcode(v) { var n = Number(v); return (isFinite(n) && n > 0) ? Math.floor(n) : 0; }

  function decideSdk(r) {
    if (!r || typeof r !== 'object') return { kind: 'error', message: MSG_SDK_FAIL };
    if (r.ok !== true) return { kind: 'error', message: r.reason === 'no-rustore' ? MSG_NO_RUSTORE : MSG_SDK_FAIL };
    var nv = vcode(r.versionCode), cur = vcode(r.currentVersionCode);
    if (r.available === true && (!cur || !nv || nv > cur)) return { kind: 'store', versionCode: nv };
    return { kind: 'none' };
  }

  // versionCode стор-сборки → номер версии для человека. Формула сборки (build-lib.js
  // versionCodeOf): code = (major*10000 + minor*100 + patch)*2 + 1. 20007 → «1.0.3».
  // Не похоже на наш код - '' (окно скажет «новая версия» без номера).
  function verOfCode(code) {
    var c = vcode(code);
    if (!c || c % 2 !== 1) return '';
    var base = (c - 1) / 2;
    var major = Math.floor(base / 10000), minor = Math.floor((base % 10000) / 100), patch = base % 100;
    return major + '.' + minor + '.' + patch;
  }
  function codeOfVer(v) {
    if (!isVer(v)) return 0;
    var p = parts(v);
    return (p[0] * 10000 + p[1] * 100 + p[2]) * 2 + 1;
  }

  // Найденная версия ещё актуальна? stored - versionCode из памяти (или UNKNOWN), shell -
  // версия установленной оболочки (null - Android ещё не ответил). Поставили её или новее -
  // отметку снимаем. «Есть, но без номера» (UNKNOWN) помним вместе с оболочкой, при которой
  // RuStore это сказал (base): оболочка сменилась - значит обновление поставили, точка
  // «новая» на актуальной версии не висит (ревью 1.0.3).
  function stillNewer(stored, shell, base) {
    if (stored === UNKNOWN) return !(base && shell && String(base) !== String(shell));
    var v = vcode(stored);
    if (!v) return false;
    var cur = codeOfVer(shell);
    return !cur || v > cur;
  }

  // Запись K_NEWER: versionCode числом, '?' или '?@<оболочка>' → {stored, base} | null
  function parseNewer(raw) {
    var s = String(raw == null ? '' : raw);
    if (!s) return null;
    if (s.charAt(0) === '?') return { stored: UNKNOWN, base: s.indexOf('?@') === 0 ? s.slice(2) : '' };
    var v = vcode(s);
    return v ? { stored: v, base: '' } : null;
  }
  function newerRecord(d, shell) {
    if (d.versionCode) return String(d.versionCode);
    return '?' + (shell ? '@' + shell : '');
  }

  // Пора ли тихо спрашивать RuStore: прошло >= 7 дней с последней удачной проверки. Метка
  // из будущего (часы перевели назад) - пора, иначе проверка застряла бы надолго.
  function weekDue(last, now) {
    var l = Number(last) || 0;
    if (l > now) return true;
    return now - l >= 7 * 24 * 60 * 60 * 1000;
  }

  // Спросить RuStore. opts.native - подложенный плагин (тесты/self-test), opts.timeout.
  // Promise<решение>, никогда не отклоняется.
  function checkSdk(opts) {
    opts = opts || {};
    var p = sdkPlugin(opts);
    if (!p || typeof p.checkUpdate !== 'function') return Promise.resolve({ kind: 'error', message: MSG_NO_RUSTORE });
    var timer = null;
    var clock = new Promise(function (res) { timer = setTimeout(function () { res(null); }, opts.timeout || T_SDK); });
    var req = Promise.resolve().then(function () { return p.checkUpdate(); }).then(null, function () { return null; });
    return Promise.race([req, clock]).then(function (r) { clearTimeout(timer); return decideSdk(r); });
  }

  // «Обновить»: окно обновления RuStore; не открылось (сбой потока, {ok:false}) - карточка
  // приложения в самом RuStore (deeplink плагина openStore, RuStoreUpdatePlugin.java); нет
  // плагина или и он отказал - страница RuStore в браузере (ревью 1.0.3: раньше сбой потока
  // сразу уводил в браузер).
  function startSdkUpdate(opts, openExternal) {
    opts = opts || {};
    var p = sdkPlugin(opts);
    var web = function () { if (typeof openExternal === 'function') openExternal(URL_RUSTORE); return { ok: true, via: 'web' }; };
    if (!p || typeof p.startUpdate !== 'function') return Promise.resolve(web());
    var card = function () {
      if (typeof p.openStore !== 'function') return web();
      return Promise.resolve().then(function () { return p.openStore(); })
        .then(function (r) { return (r && r.ok) ? r : web(); }, function () { return web(); });
    };
    return Promise.resolve().then(function () { return p.startUpdate(); })
      .then(function (r) { return (r && r.ok) ? r : card(); }, function () { return card(); });
  }

  function sdkPlugin(opts) {
    if (opts && 'native' in opts) return opts.native;
    if (sdkOverride !== undefined) return sdkOverride;
    try {
      if (typeof window === 'undefined' || !(window.isNativeApp && window.isNativeApp())) return null;
      var N = window.NativePlugins;
      if (N && N.RuStoreUpdate) return N.RuStoreUpdate;
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.RuStoreUpdate) ||
        (C && typeof C.registerPlugin === 'function' ? C.registerPlugin('RuStoreUpdate') : null);
    } catch (e) { return null; }
  }
  var sdkOverride;   // self-test: подложенный плагин (undefined - настоящий)

  // Имя файла из архива → безопасный относительный путь или null.
  // Архив приходит со своего домена и проверен по sha256, но пишем мы им в личную
  // папку приложения: «../» и абсолютные пути отсекаем до записи, а не после.
  function safeName(name) {
    var s = String(name == null ? '' : name);
    if (!s) return null;
    if (s.indexOf('\\') >= 0) return null;                 // Windows-разделитель
    if (/[\u0000-\u001f]/.test(s)) return null;            // управляющие символы
    if (s.charAt(0) === '/') return null;                  // абсолютный путь
    if (/^[a-zA-Z]:/.test(s)) return null;                 // C:\…
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return null;   // схема
    if (s.charAt(s.length - 1) === '/') return null;       // запись папки, не файл
    var segs = s.split('/');
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (g === '' || g === '.' || g === '..') return null;
    }
    return segs.join('/');
  }

  // «3120000» → «3,0 МБ»; 0 или мусор → пусто
  function mbOf(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) return '';
    return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  }

  // байты → строка из 64 шестнадцатеричных знаков (для сверки с sha256 манифеста)
  function hex(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  // сравнение хешей без оглядки на регистр и пробелы
  function sameHash(a, b) {
    return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  // Uint8Array → base64 (плагину Filesystem байты отдаются только так)
  function b64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }

  // ---------- сеть ----------

  // Обёртка с часами: сеть на телефоне умеет «висеть» без ответа и без ошибки.
  function withClock(make, ms, errText) {
    var ctl = null, timer = null;
    try { ctl = new AbortController(); } catch (e) {}
    var clock = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        try { if (ctl) ctl.abort(); } catch (e) {}
        reject(new Error(errText));
      }, ms);
    });
    return Promise.race([Promise.resolve().then(function () { return make(ctl); }), clock]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  // Возвращает обещание с манифестом или отклоняется понятным по-русски текстом.
  function fetchManifest(opts) {
    opts = opts || {};
    var f = opts.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
    if (!f) return Promise.reject(new Error(ERR_NET));
    var url = opts.url || URL_MANIFEST;

    return withClock(function (ctl) {
      var init = { method: 'GET', cache: 'no-store' };
      if (ctl) init.signal = ctl.signal;
      return Promise.resolve()
        .then(function () { return f(url, init); })
        .then(function (r) {
          if (!r || !r.ok) throw new Error(ERR_SERVER);
          return r.text();
        }, function () {
          throw new Error(ERR_NET);              // сети нет, DNS не разрешился, соединение отбито
        })
        .then(function (text) {
          var o = null;
          try { o = JSON.parse(text); } catch (e) { throw new Error(ERR_BAD); }
          var m = parseManifest(o);
          if (!m) throw new Error(ERR_BAD);
          return m;
        });
    }, opts.timeout || T_NET, ERR_SERVER);
  }

  // Сколько ждать архив. Двадцати секунд хватает только на пустяк: сборка 1,3 МБ на
  // мобильном интернете 64 КБ/с качается двадцать секунд и дольше. Даём базу плюс по
  // десять секунд на мегабайт, но не больше двух минут - иначе окно «Обновляю» висит.
  function zipTimeout(size) {
    var mbs = Math.max(0, Number(size) || 0) / 1048576;
    return Math.min(T_ZIP_MAX, Math.round(T_ZIP + mbs * T_ZIP_MB));
  }

  // Архив сборки: качаем, сверяем размер и sha256. Ни байта на диск до сверки.
  function fetchBundle(web, opts) {
    opts = opts || {};
    var f = opts.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
    var subtle = opts.subtle || (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!f) return Promise.reject(new Error(ERR_NET));

    return withClock(function (ctl) {
      var init = { method: 'GET', cache: 'no-store' };
      if (ctl) init.signal = ctl.signal;
      return Promise.resolve()
        .then(function () { return f(web.url, init); })
        .then(function (r) {
          if (!r || !r.ok) throw new Error(ERR_SERVER);
          return r.arrayBuffer();
        }, function (e) {
          if (e && e.message === ERR_SERVER) throw e;
          throw new Error(ERR_NET);
        })
        .then(function (buf) {
          if (!buf || buf.byteLength <= 0) throw new Error(ERR_BAD);
          if (buf.byteLength > MAX_ZIP) throw new Error(ERR_BIG);
          if (!subtle) throw new Error(ERR_HASH);
          return subtle.digest('SHA-256', buf).then(function (d) {
            if (!sameHash(hex(d), web.sha256)) throw new Error(ERR_HASH);
            return new Uint8Array(buf);
          }, function () { throw new Error(ERR_HASH); });
        });
    }, opts.timeout || zipTimeout(web && web.size), ERR_SLOW);
  }

  // ---------- окна ----------
  // Всё, что ниже, живёт только в браузере: в node-тестах mount() не зовётся.

  var UI = null;
  var busy = false;
  // Что показала последняя проверка В ЭТОМ запуске: меню рисует по ней точку «есть
  // обновление» и строку у хомяка. Само по себе приложение в сеть не ходит, поэтому
  // до первого нажатия «Проверить» тут пусто, и меню молчит.
  var newerVer = '';

  // Стор: найденная в RuStore версия живёт между запусками (K_NEWER), пока её не поставят -
  // точка на плитке «Обновление» не гаснет до следующей недельной проверки.
  var K_NEWER = 'updNewer';
  function newer() {
    if (!isStore()) return newerVer;
    var raw = null, st = ls();
    try { raw = st ? st.getItem(K_NEWER) : null; } catch (e) {}
    var p = parseNewer(raw);
    if (!p) return '';
    var stored = p.stored;
    if (!stillNewer(stored, shellVer(), p.base)) {
      if (shellVer()) { try { st.removeItem(K_NEWER); } catch (e) {} }
      return '';
    }
    return stored === UNKNOWN ? 'новая' : (verOfCode(stored) || 'новая');
  }
  function setNewerSdk(d) {
    var st = ls(); if (!st) return;
    try {
      if (d.kind === 'store') st.setItem(K_NEWER, newerRecord(d, shellVer()));
      else if (d.kind === 'none') st.removeItem(K_NEWER);
    } catch (e) {}
  }

  function ver() { return String((typeof window !== 'undefined' && window.APP_VERSION) || '0'); }
  // Номер ОБОЛОЧКИ или null, если Android ещё не ответил. Подставлять сюда версию
  // веб-сборки нельзя: после бесшовного обновления она уезжает вперёд, и заслон
  // minShell начинает сверяться с завышенным номером - телефон примет сборку, которую
  // его оболочка не потянет. Лучше честное «не знаю».
  function shellVer() {
    if (typeof window === 'undefined') return null;
    var s = window.SHELL_VERSION;
    return (typeof s === 'string' && s) ? s : null;
  }
  // Ждём ответа App.getInfo(), но не дольше трёх секунд: кнопка «Проверить» не должна
  // висеть из-за плагина. Не ответил - работаем с «не знаю» (см. decide).
  function waitShell(ms) {
    if (shellVer()) return Promise.resolve(shellVer());
    var p = (typeof window !== 'undefined') ? window.SHELL_READY : null;
    if (!p || typeof p.then !== 'function') return Promise.resolve(shellVer());
    var clock = new Promise(function (res) { setTimeout(function () { res(null); }, ms || T_SHELL); });
    return Promise.race([Promise.resolve(p).catch(function () { return null; }), clock])
      .then(function () { return shellVer(); });
  }

  function isNative() {
    try { return !!(window.isNativeApp && window.isNativeApp()); } catch (e) { return false; }
  }

  // Сторовая сборка? access.js грузится раньше update.js, читаем его флаг.
  var storeOverride;   // self-test: прогнать стор-путь в демо (undefined - как собрано)
  function isStore() {
    if (storeOverride !== undefined) return !!storeOverride;
    try { return !!(window.Access && window.Access.STORE); } catch (e) { return false; }
  }

  function plugins() {
    try { return (isNative() && window.NativePlugins) || null; } catch (e) { return null; }
  }

  function ls() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function box(html) { return '<div class="upd">' + html + '</div>'; }

  function verLine() {
    var w = ver(), s = shellVer();
    return (!s || w === s) ? w : w + ' · оболочка ' + s;
  }

  // ---------- память о провалившейся сборке ----------
  // Запись живёт в localStorage: {version, count, sha256, shown}. Старый вид (просто
  // строка с номером) читаем тоже - на телефоне может лежать метка от версии 0.3.0.
  function readFail() {
    var store = ls();
    if (!store) return null;
    var raw = '';
    try { raw = store.getItem(K_FAIL) || ''; } catch (e) { return null; }
    if (!raw) return null;
    var o = null;
    try { o = JSON.parse(raw); } catch (e) { o = null; }
    if (typeof o === 'string') o = { version: o, count: 1 };
    if (!o || typeof o !== 'object' || !o.version) {
      if (isVer(raw)) return { version: String(raw).trim(), count: 1, sha256: '', shown: false };
      return null;
    }
    return {
      version: String(o.version),
      count: (typeof o.count === 'number' && isFinite(o.count) && o.count > 0) ? o.count : 1,
      sha256: typeof o.sha256 === 'string' ? o.sha256 : '',
      shown: !!o.shown
    };
  }

  function writeFail(rec) {
    var store = ls();
    if (!store) return;
    try {
      if (!rec) store.removeItem(K_FAIL);
      else store.setItem(K_FAIL, JSON.stringify(rec));
    } catch (e) {}
  }

  function dlgInstalled() {
    UI.openDlg({
      title: 'Обновление',
      body: box('<p>Установлена версия ' + UI.esc(verLine()) + '</p>'),
      buttons: [
        { label: 'Закрыть', cls: 'nav' },
        { label: 'Проверить', cls: 'primary', onClick: function () { check(); return false; } }
      ]
    });
  }

  // Окно ожидания с меткой #updWait. Ответ проверки показываем, только если оно ещё на
  // экране: «Отмена», «назад» или другое окно поверх - хозяин занят другим, и окно с
  // результатом через 15 с ему не нужно (ревью 1.0.3). Память (точка в меню) обновляется всё равно.
  function dlgWait() {
    UI.openDlg({
      title: 'Обновление',
      body: box('<p id="updWait">' + (isStore() ? 'Спрашиваю RuStore…' : 'Смотрю на сервере…') + '</p>'),
      buttons: [{ label: 'Отмена', cls: 'nav' }]
    });
  }
  function waiting() {
    // closeDlg очищает тело окна, новое окно его заменяет - метки нет ровно тогда, когда ждать некому
    try { return !!document.getElementById('updWait'); } catch (e) { return false; }
  }

  function dlgFresh() {
    UI.openDlg({
      title: 'Обновление',
      body: box('<p>У вас последняя версия<span class="upd-v">' + UI.esc(verLine()) + '</span></p>'),
      buttons: [{ label: 'Понятно', cls: 'primary' }]
    });
  }

  function notesHtml(notes) {
    return notes ? '<p class="upd-n">' + UI.esc(notes).replace(/\n/g, '<br>') + '</p>' : '';
  }

  // Бесшовное: одна кнопка, несколько секунд, окна установки Android нет.
  function dlgOta(d) {
    if (isStore()) return;   // стор: самоподмены кода нет ни при каком раскладе (и манифест не читается)
    var size = mbOf(d.size);
    var head = 'Обновление ' + d.version + (size ? ' · ' + size : '') + ' · без переустановки';
    var can = isNative();
    var btns = [{ label: 'Закрыть', cls: 'nav' }];
    if (can) btns.push({ label: 'Обновить', cls: 'primary', onClick: function () { apply(d.web); return false; } });
    UI.openDlg({
      title: 'Есть обновление',
      body: box(
        '<p class="upd-h">' + UI.esc(head) + '</p>' +
        notesHtml(d.notes) +
        '<p class="upd-hint">' + (can
          ? 'Обновится прямо в приложении за несколько секунд. Данные, кошельки и настройки останутся на месте.'
          : UI.esc(ERR_ONLYAPP)) + '</p>'
      ),
      buttons: btns
    });
  }

  // Эта версия у нас уже не запустилась: предлагать её снова — водить хозяина по кругу.
  function dlgSkipped(d) {
    UI.openDlg({
      title: 'Обновление',
      body: box(
        '<p>Версия ' + UI.esc(d.version) + ' не запустилась на этом телефоне и пропущена; жду следующую</p>' +
        '<p class="upd-hint">Сейчас работает ' + UI.esc(verLine()) + '.</p>'
      ),
      buttons: [{ label: 'Понятно', cls: 'primary' }]
    });
  }

  // APK: меняется сама оболочка, тут без Android не обойтись.
  function dlgApk(d) {
    if (isStore()) return;   // стор: никаких скачиваний APK в обход RuStore
    var size = mbOf(d.size);
    var can = isNative();
    var btns = [{ label: 'Закрыть', cls: 'nav' }];
    // Бэкап предлагаем только на телефоне: обновление с переустановкой уводит хозяина в
    // системный установщик Android, риск для данных выше, чем при бесшовном OTA.
    if (can) btns.push({ label: 'Сохранить копию', cls: 'ghost', onClick: function () {
      try { if (window.Backup && window.Backup.backup) window.Backup.backup(); } catch (e) {}
      return false;   // окно не закрываем: после копии хозяин нажмёт «Скачать»
    } });
    btns.push({ label: 'Скачать', cls: 'primary', onClick: function () { UI.openExternal(d.apkUrl); } });
    UI.openDlg({
      title: 'Есть обновление',
      body: box(
        '<p class="upd-h">Версия ' + UI.esc(d.version) + (size ? ' <span class="upd-v">' + UI.esc(size) + '</span>' : '') + '</p>' +
        notesHtml(d.notes) +
        (d.shellUnknown
          ? '<p class="upd-hint">Телефон не сказал, какая у него оболочка, поэтому обновление без переустановки сейчас предложить не могу.</p>'
          : '') +
        '<p class="upd-hint">Нужна переустановка приложения. После загрузки откройте файл - Android предложит обновить, данные сохранятся.</p>' +
        (can ? '<p class="upd-hint">Перед обновлением с переустановкой стоит на всякий случай сохранить копию данных в файл.</p>' : '')
      ),
      buttons: btns
    });
  }

  // Сторовая сборка: RuStore нашёл версию новее. Ставит её сам RuStore своим окном.
  function dlgStore(d) {
    var v = verOfCode(d.versionCode);
    UI.openDlg({
      title: 'Есть обновление',
      body: box(
        '<p class="upd-h">' + (v ? 'Версия ' + UI.esc(v) + ' ждёт в RuStore.' : 'В RuStore есть новая версия.') + '</p>' +
        '<p class="upd-hint">Обновление поставит RuStore. Данные, кошельки и настройки останутся на месте.</p>'
      ),
      buttons: [
        { label: 'Закрыть', cls: 'nav' },
        { label: 'Обновить', cls: 'primary', onClick: function () {
          var release = null;
          try { if (window.AppLock && window.AppLock.away) release = window.AppLock.away(window.AppLock.AWAY_CALL); } catch (e) {}
          // окно RuStore не открылось и в фон не ушли - отметку «своё окно» снимаем
          startSdkUpdate({}, UI.openExternal).then(function () { if (typeof release === 'function') release(); });
        } }
      ]
    });
  }

  function dlgFail(msg) {
    UI.openDlg({
      title: 'Обновление',
      body: box('<p>' + UI.esc(msg) + '</p>'),
      buttons: [
        { label: 'Закрыть', cls: 'nav' },
        { label: 'Повторить', cls: 'primary', onClick: function () { check(); return false; } }
      ]
    });
  }

  // Окно хода работ: одно и то же окно, меняется только строка внутри.
  function dlgProgress(step) {
    UI.openDlg({
      title: 'Обновляю',
      body: box('<p class="upd-step" id="updStep">' + UI.esc(step) + '</p>' +
                '<p class="upd-hint">Не закрывайте приложение.</p>'),
      buttons: []
    });
  }

  function step(text) {
    var el = document.getElementById('updStep');
    if (el) el.textContent = text;
    else if (UI) dlgProgress(text);
  }

  // opts прокидываются в fetchManifest — так self-test подсовывает свой fetch
  function check(opts) {
    if (busy) return Promise.resolve(null);
    busy = true;
    dlgWait();
    if (isStore()) {
      // стор: только RuStore App Update SDK, свой манифест не запрашиваем
      return checkSdk(opts).then(function (d) {
        busy = false;
        if (d.kind !== 'error') { setNewerSdk(d); markChecked(); }
        if (UI && UI.renderMenu) UI.renderMenu();
        if (!waiting()) return d;
        if (d.kind === 'store') dlgStore(d);
        else if (d.kind === 'none') dlgFresh();
        else dlgFail(d.message);
        return d;
      });
    }
    // Сначала дожидаемся номера оболочки (до трёх секунд), потом решаем: сверять
    // minShell с выдуманным номером хуже, чем подождать.
    return waitShell().then(function () { return fetchManifest(opts); }).then(function (m) {
      busy = false;
      var d = decide(m, ver(), shellVer(), readFail());
      newerVer = (d.kind === 'ota' || d.kind === 'apk') ? d.version : '';
      if (UI && UI.renderMenu) UI.renderMenu();
      if (!waiting()) return m;
      if (d.kind === 'ota') dlgOta(d);
      else if (d.kind === 'apk') dlgApk(d);
      else if (d.kind === 'skipped') dlgSkipped(d);
      else dlgFresh();
      return m;
    }, function (e) {
      busy = false;
      newerVer = '';
      if (waiting()) dlgFail(e && e.message ? e.message : ERR_BAD);
      return null;
    });
  }

  // Тихая проверка: то же, что check(), но БЕЗ окон. Ходит в сеть, обновляет newerVer
  // и перерисовывает меню (иконка обновления замигает). Ошибку не показывает — молча
  // ничего. Зовётся еженедельным таймером на старте (weeklyCheck).
  function silentCheck(opts) {
    if (busy) return Promise.resolve(null);
    if (isStore()) {
      // стор: RuStore App Update SDK. Ошибка (нет RuStore, нет сети) - молча, метку недели
      // не двигаем: попробуем при следующем запуске. «Есть, но без номера» - тоже не двигаем.
      return checkSdk(opts).then(function (d) {
        if (d.kind === 'error') return null;
        setNewerSdk(d);
        if (UI && UI.renderMenu) UI.renderMenu();
        return (d.kind === 'store' && !d.versionCode) ? null : d;
      });
    }
    return waitShell().then(function () { return fetchManifest(opts); }).then(function (m) {
      var d = decide(m, ver(), shellVer(), readFail());
      newerVer = (d.kind === 'ota' || d.kind === 'apk') ? d.version : '';
      if (UI && UI.renderMenu) UI.renderMenu();
      return m;
    }, function () { return null; });
  }

  // Раз в неделю (не при каждом запуске) тихо проверяем канал и, если есть обновление,
  // подсвечиваем иконку в меню. Метку времени храним локально; на неуспехе не сдвигаем —
  // значит при следующем запуске попробуем снова.
  var K_CHECK = 'updCheckAt';
  function markChecked() { var s = ls(); if (s) { try { s.setItem(K_CHECK, String(Date.now())); } catch (e) {} } }
  function weeklyCheck(opts) {
    var s = ls(); if (!s) return Promise.resolve(null);
    var last = 0;
    try { last = parseInt(s.getItem(K_CHECK), 10) || 0; } catch (e) {}
    if (!weekDue(last, Date.now())) return Promise.resolve(null);
    return silentCheck(opts).then(function (m) {
      if (m) markChecked();
      return m;
    });
  }

  // ---------- бесшовное обновление ----------

  // fflate нужен ровно один раз за всю жизнь приложения — грузим по требованию,
  // чтобы 33 КБ не разбирались при каждом запуске.
  var fflatePromise = null;
  function loadFflate(opts) {
    if (opts && opts.fflate) return Promise.resolve(opts.fflate);
    if (window.fflate) return Promise.resolve(window.fflate);
    if (fflatePromise) return fflatePromise;
    fflatePromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/fflate.min.js';
      s.onload = function () { window.fflate ? res(window.fflate) : rej(new Error(ERR_ZIP)); };
      s.onerror = function () { fflatePromise = null; rej(new Error(ERR_ZIP)); };
      document.head.appendChild(s);
    });
    return fflatePromise;
  }

  // Архив → карта «безопасное имя → байты». Мусорные имена валят всю распаковку:
  // сборка либо целая, либо её нет. Заодно второй заслон по размеру — на РАСПАКОВАННОЕ:
  // предел на сам архив от зип-бомбы не спасает, 60 МБ нулей ужимаются в 60 КБ.
  function unpack(zipBytes, fflate) {
    var raw;
    try { raw = fflate.unzipSync(zipBytes); } catch (e) { throw new Error(ERR_ZIP); }
    var out = {}, n = 0, total = 0;
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (k.charAt(k.length - 1) === '/') continue;          // папки в архиве пропускаем
      var name = safeName(k);
      if (!name) throw new Error(ERR_ZIP);
      var size = (raw[k] && raw[k].length) || 0;
      if (size > MAX_FILE) throw new Error(ERR_BIG);
      total += size;
      if (total > MAX_RAW) throw new Error(ERR_BIG);
      out[name] = raw[k];
      n++;
    }
    if (!n || !out['index.html']) throw new Error(ERR_ZIP);
    return out;
  }

  // Запись папки сборки. Всё через base64: так текст и картинки идут одной дорогой,
  // и ни один байт не портится перекодировкой.
  function writeAll(F, dir, files, onProgress) {
    var names = Object.keys(files).sort();
    var chain = Promise.resolve();
    names.forEach(function (name, i) {
      chain = chain.then(function () {
        return F.writeFile({
          directory: 'DATA', path: dir + '/' + name,
          data: b64(files[name]), recursive: true
        });
      }).then(function () {
        if (onProgress) onProgress(i + 1, names.length);
      });
    });
    return chain.then(function () { return names.length; });
  }

  // Главный путь: скачать → сверить → распаковать → записать → переставить → перезапуск.
  function apply(web, opts) {
    opts = opts || {};
    // Заслон стора в самой точке подмены: даже если сюда придёт вызов в обход окон,
    // сторовая сборка код не скачивает и WebView не переставляет (правило RuStore).
    if (isStore()) return Promise.resolve(false);
    if (busy) return Promise.resolve(false);
    var N = plugins();
    if (!N || !N.Filesystem || !N.WebView) {
      if (UI) dlgFail(ERR_ONLYAPP);
      return Promise.resolve(false);
    }
    busy = true;
    var F = N.Filesystem, W = N.WebView;
    var dir = 'ota/' + web.version;

    dlgProgress('Скачиваю…');
    return Promise.resolve()
      .then(function () { return fetchBundle(web, opts); })
      .then(function (bytes) {
        step('Проверяю подпись…');
        return loadFflate(opts).then(function (ff) {
          step('Распаковываю…');
          return unpack(bytes, ff);
        });
      })
      .then(function (files) {
        // старую попытку с тем же номером сносим целиком: половина сборки хуже, чем ничего
        return Promise.resolve()
          .then(function () { return F.rmdir({ directory: 'DATA', path: dir, recursive: true }); })
          .catch(function () {})
          .then(function () { return files; });
      })
      .then(function (files) {
        var total = Object.keys(files).length;
        return writeAll(F, dir, files, function (done) {
          step('Записываю… ' + done + ' из ' + total);
        }).then(function () {
          // маркер целостности пишем последним: boot.js и откат верят только ему
          return F.writeFile({
            directory: 'DATA', path: dir + '/.complete',
            data: web.version, encoding: 'utf8', recursive: true
          });
        });
      })
      .then(function () {
        // Куда мы уходим - на неё и вернёмся, если новая не заведётся. Прежней рабочей
        // считаем только ту сборку, что лежит в ota/<номер> И уже доказала живучесть.
        return currentBase(W).then(function (base) {
          var prev = buildOf(base), okv = '';
          var store = ls();
          try { okv = store ? (store.getItem(K_OK) || '') : ''; } catch (e) {}
          if (!prev || prev === web.version || okv !== prev) prev = '';
          return writeState(F, { current: web.version, previousOk: prev });
        }).then(function () { return F.getUri({ directory: 'DATA', path: dir }); });
      })
      .then(function (r) {
        var path = String((r && r.uri) || '').replace(/^file:\/\//, '');
        if (!path) throw new Error(ERR_WRITE);
        var store = ls();
        if (store) {
          try {
            store.setItem(K_TRY, JSON.stringify({
              version: web.version, ts: Date.now(), boots: 0, sha256: web.sha256 || ''
            }));
          } catch (e) {}
        }
        // Метку провала стираем ТОЛЬКО про эту же версию (её перевыложили и мы решились
        // попробовать снова). Память о чужом провале — не наше дело, её читает decide.
        var f = readFail();
        if (f && String(f.version) === String(web.version)) writeFail(null);
        step('Перезапускаюсь…');
        // Оба вызова — одним тактом, без ожидания: setServerBasePath сам перезагружает
        // WebView (Bridge.java:1381-1389), и ответ первого обещания может уже не
        // вернуться. В мост они уходят по порядку и выполняются одной очередью.
        W.setServerBasePath({ path: path });
        W.persistServerBasePath();
        setTimeout(function () { try { location.reload(); } catch (e) {} }, 1200);
        return true;
      })
      .catch(function (e) {
        busy = false;
        var msg = (e && e.message) ? e.message : ERR_WRITE;
        // ошибки плагина приходят по-английски — переводим на понятное
        if ([ERR_NET, ERR_SERVER, ERR_SLOW, ERR_BAD, ERR_HASH, ERR_ZIP, ERR_BIG, ERR_WRITE, ERR_ONLYAPP].indexOf(msg) < 0) {
          msg = ERR_WRITE;
        }
        if (UI) dlgFail(msg);
        return false;
      });
  }

  // ---------- заводская копия и уборка ----------

  // Куда приложение показывает прямо сейчас: 'public' (встроенные ассеты APK) или
  // абсолютный путь к распакованной сборке.
  function currentBase(W) {
    return W.getServerBasePath().then(function (r) {
      return String((r && r.path) || '');
    }, function () { return ''; });
  }

  function onAssets(p) { return !p || p.charAt(0) !== '/'; }

  // «/data/user/0/…/files/ota/0.3.2» → «0.3.2»; заводская копия и встроенные ассеты → ''
  function buildOf(p) {
    var s = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '');
    var i = s.lastIndexOf('/ota/');
    if (i < 0) return '';
    var name = s.slice(i + 5);
    if (!name || name.indexOf('/') >= 0 || name === 'base') return '';
    return name;
  }

  // ---------- карта сборок (ota/state.json) ----------
  // {current, previousOk}: какая сборка работает и на какую откатываться. Лежит на
  // диске рядом со сборками, потому что localStorage могут очистить, а вернуться на
  // прежнюю рабочую версию надо всё равно.
  function normState(o) {
    var cur = (o && typeof o.current === 'string' && isVer(o.current)) ? String(o.current).trim() : '';
    var prev = (o && typeof o.previousOk === 'string' && isVer(o.previousOk)) ? String(o.previousOk).trim() : '';
    if (prev === cur) prev = '';
    return { current: cur, previousOk: prev };
  }

  function readState(F) {
    return F.readFile({ directory: 'DATA', path: STATE_PATH, encoding: 'utf8' }).then(function (r) {
      var o = null;
      try { o = JSON.parse(String((r && r.data) || '')); } catch (e) { o = null; }
      return normState(o);
    }, function () { return normState(null); });
  }

  function writeState(F, st) {
    return F.writeFile({
      directory: 'DATA', path: STATE_PATH,
      data: JSON.stringify(normState(st)), encoding: 'utf8', recursive: true
    }).then(function () { return true; }, function () { return false; });
  }

  // Заводская копия www — то, куда откатывается boot.js. Делается один раз на
  // оболочку: файлы берём у самого себя (мы сейчас на встроенных ассетах) по списку
  // files.json, который кладёт сборка.
  function ensureBase(F, W, shell) {
    return F.readFile({ directory: 'DATA', path: 'ota/base/.complete', encoding: 'utf8' })
      .then(function (r) {
        var was = String((r && r.data) || '').trim();
        return was === shell;                       // копия свежая — ничего не делаем
      }, function () { return false; })
      .then(function (fresh) {
        if (fresh) return 0;
        return fetch('files.json', { cache: 'no-store' })
          .then(function (r) {
            if (!r || !r.ok) throw new Error('files.json не отдался');
            return r.json();
          })
          .then(function (j) {
            var list = (j && j.files) || [];
            if (!list.length) throw new Error('пустой files.json');
            return Promise.resolve()
              .then(function () { return F.rmdir({ directory: 'DATA', path: 'ota/base', recursive: true }); })
              .catch(function () {})
              .then(function () {
                var chain = Promise.resolve(), n = 0;
                list.forEach(function (name) {
                  var safe = safeName(name);
                  if (!safe) return;
                  chain = chain.then(function () {
                    return fetch(safe, { cache: 'no-store' })
                      // r.ok обязателен: тело ошибки 404 молча ляжет вместо файла, и
                      // заводская копия - последняя, куда откатываться - окажется порченой.
                      // Один промах валит всю сборку копии: .complete не появится.
                      .then(function (r) {
                        if (!r || !r.ok) throw new Error('не отдался файл ' + safe);
                        return r.arrayBuffer();
                      })
                      .then(function (buf) {
                        n++;
                        return F.writeFile({
                          directory: 'DATA', path: 'ota/base/' + safe,
                          data: b64(new Uint8Array(buf)), recursive: true
                        });
                      });
                  });
                });
                return chain.then(function () {
                  return F.writeFile({
                    directory: 'DATA', path: 'ota/base/.complete',
                    data: shell, encoding: 'utf8', recursive: true
                  });
                }).then(function () { return n; });
              });
          });
      });
  }

  // Лишние папки сборок: держим ТРИ - текущую, прежнюю рабочую и заводскую копию.
  // Прежняя рабочая и есть «прежняя версия», которую CHANGELOG обещает хозяину при
  // откате: снести её на первом же запуске новой сборки - значит оставить откату
  // только заводскую, то есть отбросить хозяина на две версии назад.
  function sweep(F, keep, keepPrev) {
    return F.readdir({ directory: 'DATA', path: 'ota' }).then(function (r) {
      var files = (r && r.files) || [];
      var chain = Promise.resolve();
      files.forEach(function (f) {
        var name = (typeof f === 'string') ? f : (f && f.name);
        if (!name || name === 'base' || name === 'state.json') return;
        if (name === keep || (keepPrev && name === keepPrev)) return;
        chain = chain.then(function () {
          return F.rmdir({ directory: 'DATA', path: 'ota/' + name, recursive: true }).catch(function () {});
        });
      });
      return chain;
    }, function () {});
  }

  // Стор: вся папка ota/ - лишняя. Нет её - ничего не делаем. Promise<true - удалили>.
  function dropOta(F) {
    if (!F || typeof F.readdir !== 'function' || typeof F.rmdir !== 'function') return Promise.resolve(false);
    return Promise.resolve().then(function () { return F.readdir({ directory: 'DATA', path: 'ota' }); }).then(function (r) {
      if (!r || !r.files || !r.files.length) return false;
      return F.rmdir({ directory: 'DATA', path: 'ota', recursive: true }).then(function () { return true; }, function () { return false; });
    }, function () { return false; });
  }

  // Приложение дожило до живого экрана — значит эта сборка рабочая. Ставим печать,
  // снимаем метку попытки, заодно готовим заводскую копию и подметаем старое.
  function confirmBoot() {
    var store = ls();
    var v = ver();
    if (store) {
      try {
        store.setItem(K_OK, v);
        store.removeItem(K_TRY);
      } catch (e) {}
    }

    // Стор-сборка код не подменяет (MainActivity забывает OTA-путь на старте): заводская
    // копия ей не нужна, а files.json читать незачем - сеть веб-части стора закрыта CSP
    // connect-src 'none'. Но папку ota/ (заводскую копию делала стор-сборка 1.0.2) убираем
    // целиком: иначе мегабайты навсегда остаются в данных телефона (ревью 1.0.3).
    if (isStore()) return dropOta(plugins() && plugins().Filesystem);
    var N = plugins();
    if (!N || !N.Filesystem || !N.WebView) return Promise.resolve(false);
    var F = N.Filesystem, W = N.WebView;

    return currentBase(W).then(function (base) {
      // Сохранение пути повторяем и здесь: при переключении ответ моста мог не успеть
      // вернуться, а тут мы уже точно работаем с той папкой, которую надо запомнить.
      if (!onAssets(base)) { try { W.persistServerBasePath(); } catch (e) {} }
      var job = onAssets(base)
        ? ensureBase(F, W, shellVer() || ver()).catch(function () { return 0; })
        : Promise.resolve(0);
      return job.then(function () { return readState(F); }).then(function (st) {
        // Работаем не с той сборкой, что записана в карте, — значит откатились:
        // прежней рабочей больше нет, карту пишем заново под себя.
        var prev = (st.current === v) ? st.previousOk : '';
        return writeState(F, { current: v, previousOk: prev })
          .then(function () { return sweep(F, v, prev); });
      }).then(function () { return true; });
    });
  }

  // Откат случился — скажем честно, один раз. Саму запись НЕ стираем: по ней decide
  // больше не предложит эту версию (иначе хозяин ходит по кругу).
  function reportFail() {
    var rec = readFail();
    if (!rec || rec.shown) return '';
    rec.shown = true;
    writeFail(rec);
    if (UI && UI.toast) UI.toast('Обновление ' + rec.version + ' не запустилось, вернул прежнюю версию');
    return rec.version;
  }

  function open() {
    if (busy) return;
    dlgInstalled();
  }

  // Страж устаревшей веб-сборки. После переустановки APK телефон может остаться на
  // старой OTA-папке (Capacitor сохранил serverBasePath и не сбросил его, например при
  // переустановке с тем же versionCode). Тогда грузится старый www без свежих фич.
  // Если мы НЕ на встроенных ассетах и загруженная версия не новее оболочки (та же
  // или старше) — сбрасываем WebView на встроенные ассеты (public) и перезапускаемся.
  // ВАЖНО: трогаем ТОЛЬКО serverBasePath. localStorage НЕ трогаем — пользовательские
  // данные привязаны к адресу https://localhost, а не к папке сборки, и так остаются
  // на месте. Дальше обычный confirmBoot запишет ota/state.json, а sweep() уберёт
  // устаревшую папку.
  var staleGuarded = false;                              // одноразово за запуск, без цикла
  function guardStaleWww() {
    if (staleGuarded) return Promise.resolve(false);
    staleGuarded = true;
    var N = plugins();
    if (!N || !N.WebView) return Promise.resolve(false); // только на телефоне
    var W = N.WebView;
    return waitShell().then(function () {
      return currentBase(W);
    }).then(function (base) {
      if (onAssets(base)) return false;                  // уже на ассетах — ничего не делаем
      if (!staleWww(ver(), shellVer(), onAssets(base))) return false;
      try {
        W.setServerAssetPath({ path: 'public' });
        W.persistServerBasePath();
      } catch (e) {}
      // цикла нет: после сброса мы на ассетах, guardStaleWww выходит по onAssets(base)
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 200);
      return true;
    }).catch(function () { return false; });
  }

  // Подтверждение живости — один раз за запуск и НЕ раньше, чем ui.js отрисовал
  // приложение (window.APP_READY): если приложение падает по дороге, подтверждать
  // нечего, и boot.js на следующем запуске откатит сборку.
  var confirmDone = false;
  function ensureConfirmed() {
    if (confirmDone) return false;
    if (!(typeof window !== 'undefined' && window.APP_READY)) return false;
    confirmDone = true;
    try { confirmBoot(); } catch (e) {}
    try { reportFail(); } catch (e) {}
    return true;
  }

  // Три дороги к подтверждению, и ни одна не зависит от разметки меню:
  //   1) полторы секунды живого экрана — обычный путь;
  //   2) хозяин свернул или закрыл приложение раньше — это тоже «запустилось»,
  //      иначе быстрый выход считался бы провалом сборки и вёл к откату.
  var armed = false;
  function armConfirm() {
    if (typeof document === 'undefined' || armed) return;
    armed = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') ensureConfirmed();
    });
    window.addEventListener('pagehide', function () { ensureConfirmed(); });
    setTimeout(ensureConfirmed, 1500);
  }

  function mount() {
    if (typeof document === 'undefined') return;
    UI = (typeof window !== 'undefined') ? window.UI : null;
    var btn = document.getElementById('mUpdate');
    // кнопка меню — дело десятое: нет её, значит просто не открыть окно вручную
    if (UI && btn) btn.addEventListener('click', function () { UI.closeMenu(); open(); });
    guardStaleWww();   // как можно раньше: старую OTA-папку после переустановки APK сбросить на ассеты
    armConfirm();
    weeklyCheck();   // раз в неделю тихо проверить и подсветить иконку, если есть обновление
  }

  // Только для self-test: в жизни подтверждение одноразовое, а проверке нужно взвести
  // его заново и убедиться, что оно доезжает БЕЗ кнопки меню.
  function resetConfirm() { confirmDone = false; armed = false; }

  return {
    cmpVer: cmpVer, isVer: isVer, parseManifest: parseManifest, parseWeb: parseWeb,
    decide: decide, decideSdk: decideSdk, verOfCode: verOfCode, codeOfVer: codeOfVer, stillNewer: stillNewer, weekDue: weekDue,
    parseNewer: parseNewer, newerRecord: newerRecord, dropOta: dropOta, webUrl: webUrl,
    checkSdk: checkSdk, startSdkUpdate: startSdkUpdate, weeklyCheck: weeklyCheck, staleWww: staleWww, safeName: safeName, hex: hex, sameHash: sameHash, mbOf: mbOf,
    failBlocks: failBlocks, zipTimeout: zipTimeout, buildOf: buildOf, normState: normState,
    fetchManifest: fetchManifest, fetchBundle: fetchBundle, unpack: unpack,
    apply: apply, confirmBoot: confirmBoot, sweep: sweep, readState: readState, writeState: writeState,
    check: check, silentCheck: silentCheck, open: open, mount: mount, newer: newer, resetConfirm: resetConfirm,
    shellVersion: shellVer, waitShell: waitShell, readFail: readFail, writeFail: writeFail,
    MSG_NO_RUSTORE: MSG_NO_RUSTORE, MSG_SDK_FAIL: MSG_SDK_FAIL, K_NEWER: K_NEWER, K_CHECK: K_CHECK,
    _sdk: function (p) { sdkOverride = p; }, _store: function (v) { storeOverride = v; },
    URL: URL_MANIFEST, URL_RUSTORE: URL_RUSTORE, HOST: HOST, MAX_ZIP: MAX_ZIP, MAX_RAW: MAX_RAW, MAX_FILE: MAX_FILE,
    STATE: STATE_PATH,
    KEY: { tryK: K_TRY, okK: K_OK, failK: K_FAIL },
    ERR: {
      net: ERR_NET, server: ERR_SERVER, slow: ERR_SLOW, bad: ERR_BAD, hash: ERR_HASH,
      zip: ERR_ZIP, big: ERR_BIG, write: ERR_WRITE, onlyApp: ERR_ONLYAPP
    }
  };
});
