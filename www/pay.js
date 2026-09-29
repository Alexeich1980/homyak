/* pay.js — оплата «Полного доступа» через RuStore Pay (разовая непотребляемая покупка)
   и её восстановление. Второй вход к Pro наравне с лицензионным ключом (license.js):
   Access.PRO = лицензионный ключ ИЛИ RuStore-покупка ИЛИ Access.FULL.

   Слои:
   1) Адаптер оплаты (seam). Интерфейс:
        purchase()      → { ok, purchaseId?, cancelled?, unavailable?, error? }
        restore()       → { ok, purchased:boolean }
        isPurchased()   → boolean
        getPriceLabel() → строка цены из магазина или null
      Две реализации: RuStorePay (нативный плагин, боевой Android) и Mock (браузер/дев/тесты).
      selectPaymentAdapter выбирает нужную по окружению.
   2) Чистые функции маппинга статусов покупки → доступ (тестируются без девайса).
   3) window.Pay — локальный кэш владения (мгновенный офлайн-старт) + авторитетная
      ре-проверка через getPurchases, когда есть сеть/натив. По образцу license.js:
      подделанному флагу доверия нет, но и сетевой сбой доступ не снимает.

   UMD: в браузере — window.Pay (+ фабрики на нём); в node (тесты) — module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pay-config.js'));
  else root.Pay = factory(root.PayConfig);
})(typeof self !== 'undefined' ? self : this, function (PayConfig) {
  'use strict';

  var CFG = PayConfig || { PRODUCT_ID: 'full_access' };
  var PRODUCT_ID = CFG.PRODUCT_ID || 'full_access';

  // ---------- 1) адаптеры ----------

  // Mock для браузера/дева/тестов: покупка сразу «успех», владение держим в замыкании.
  function createMockPayment(opts) {
    opts = opts || {};
    var owned = !!opts.owned;
    return {
      kind: 'mock',
      isPurchased: function () { return Promise.resolve(owned); },
      purchase: function () { owned = true; return Promise.resolve({ ok: true, purchaseId: 'mock-' + Date.now() }); },
      restore: function () { return Promise.resolve({ ok: true, purchased: owned }); },
      getPriceLabel: function () { return Promise.resolve(null); }   // цены у мока нет — UI берёт свою строку
    };
  }

  // Боевая реализация поверх нативного плагина RuStorePay (см. RuStorePayPlugin.java).
  // Плагин отдаёт уже нормализованный результат (owned / ok+purchaseId / cancelled / unavailable / error).
  function createRuStorePayment(plugin, productId) {
    productId = productId || PRODUCT_ID;
    // Нормализованный ответ getPurchases: {owned, revoked, authorized, unavailable}.
    function status() {
      return Promise.resolve(plugin.getPurchases({ productId: productId })).then(function (r) {
        r = r || {};
        return { owned: r.owned === true, revoked: r.revoked === true,
                 authorized: r.authorized === true, unavailable: r.unavailable === true };
      });
    }
    return {
      kind: 'rustore',
      status: status,
      isPurchased: function () {
        return status().then(function (st) { return st.owned; });
      },
      purchase: function () {
        return Promise.resolve(plugin.purchase({ productId: productId })).then(function (r) {
          r = r || {};
          return { ok: !!r.ok, purchaseId: r.purchaseId, cancelled: !!r.cancelled,
                   unavailable: !!r.unavailable, error: r.error };
        });
      },
      restore: function () {
        return status().then(function (st) {
          if (st.unavailable) return { ok: false, unavailable: true, purchased: false };
          return { ok: true, purchased: st.owned };
        });
      },
      getPriceLabel: function () {
        return Promise.resolve(plugin.getProducts({ productId: productId })).then(function (r) {
          return (r && r.ok && r.priceLabel) ? String(r.priceLabel) : null;
        }, function () { return null; });
      }
    };
  }

  // Выбор реализации. Нативное окружение + зарегистрированный плагин RuStorePay → боевой адаптер,
  // иначе (браузерный QA, дев, сборка без SDK) — безопасный mock. env инъектируется в тестах.
  // Адаптер «оплата недоступна»: покупка отвечает unavailable, владения не подтверждает.
  function createUnavailablePayment() {
    return {
      kind: 'unavailable',
      status: function () { return Promise.resolve({ owned: false, revoked: false, authorized: false, unavailable: true }); },
      isPurchased: function () { return Promise.resolve(false); },
      purchase: function () { return Promise.resolve({ ok: false, unavailable: true }); },
      restore: function () { return Promise.resolve({ ok: false, unavailable: true, purchased: false }); },
      getPriceLabel: function () { return Promise.resolve(null); }
    };
  }

  // На ТЕЛЕФОНЕ mock не выбирается никогда: mock «покупает» мгновенно и бесплатно, и если
  // бы нативного плагина вдруг не оказалось (старая оболочка, сбой регистрации), Pro
  // открывался бы даром. Натив без плагина → адаптер «недоступно». Mock - только браузер/дев.
  function selectPaymentAdapter(env) {
    env = env || {};
    var native = !!(env.isNativeApp && env.isNativeApp());
    var np = env.NativePlugins;
    if (native) {
      if (np && np.RuStorePay) return createRuStorePayment(np.RuStorePay, env.PRODUCT_ID || PRODUCT_ID);
      return createUnavailablePayment();
    }
    return createMockPayment({ owned: !!env.mockOwned });
  }

  // ---------- 2) маппинг статусов покупки → доступ (чистые, тестируемые) ----------

  // Непотребляемым товаром владеем в этих статусах RuStore (совпадает с нативным ownsProduct).
  var OWNED_STATUSES = ['PAID', 'CONFIRMED'];
  function isOwnedStatus(status) { return OWNED_STATUSES.indexOf(String(status)) >= 0; }

  // Итог покупки открывает Pro? Только явный ok. Отмена/недоступность/ошибка — нет.
  function purchaseGrantsPro(result) { return !!(result && result.ok === true); }
  // Итог восстановления открывает Pro? Только когда магазин подтвердил владение.
  function restoreGrantsPro(result) { return !!(result && result.ok === true && result.purchased === true); }

  // Итог ре-проверки владения на старте → новое значение кэша. Возврат (refund) снимает
  // доступ, но ложно отобрать его у купившего нельзя:
  //   owned                           → true  (магазин подтвердил);
  //   unavailable (id не вписан/натив) → как было;
  //   не владеет + revoked (REFUNDED/REVERSED) → false (возврат);
  //   не владеет + авторизован в RuStore → false (магазин видит аккаунт - покупки нет);
  //   не владеет, НЕ авторизован, без revoked → как было (без входа RuStore видит не всё).
  function ownershipAfterCheck(prevOwned, st) {
    if (!st || st.unavailable) return !!prevOwned;
    if (st.owned) return true;
    if (st.revoked || st.authorized) return false;
    return !!prevOwned;
  }

  // ---------- 3) локальный кэш владения (браузер/телефон) ----------

  var LS_FLAG = 'homyak.pf';   // обфусцированный булев кэш-флаг владения покупкой
  var OBF = 0x5c;

  function ls() { try { return (typeof window !== 'undefined') ? window.localStorage : null; } catch (e) { return null; } }
  function xorStr(s) { var o = ''; for (var i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ OBF); return o; }
  function b64(s) { try { return (typeof btoa === 'function') ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); } catch (e) { return ''; } }
  function unb64(s) { try { return (typeof atob === 'function') ? atob(s) : Buffer.from(String(s || ''), 'base64').toString('binary'); } catch (e) { return ''; } }
  function obf(str) { var b = b64(xorStr(String(str))); return b == null ? '' : b; }
  function deobf(str) { var bin = unb64(str); return bin == null ? '' : xorStr(bin); }

  function readFlag(storage) {
    var st = storage || ls(); if (!st) return false;
    try { var v = st.getItem(LS_FLAG); return !!v && deobf(v) === '1'; } catch (e) { return false; }
  }
  function writeFlag(b, storage) {
    var st = storage || ls(); if (!st) return;
    try { if (b) st.setItem(LS_FLAG, obf('1')); else st.removeItem(LS_FLAG); } catch (e) {}
  }

  var _owned = false;
  function isPurchasedSync() { return _owned; }
  function markPurchased() { _owned = true; writeFlag(true); }   // данные пользователя не трогаем — только флаг
  function clearPurchase(storage) { _owned = false; writeFlag(false, storage); }

  // Текущий адаптер (по окружению приложения). В node/тестах не используется.
  function currentAdapter() {
    var env = {};
    try {
      env.isNativeApp = (typeof window !== 'undefined') ? window.isNativeApp : null;
      env.NativePlugins = (typeof window !== 'undefined') ? window.NativePlugins : null;
      env.PRODUCT_ID = PRODUCT_ID;
    } catch (e) {}
    return selectPaymentAdapter(env);
  }

  // Ре-проверка владения через магазин (правило - ownershipAfterCheck): подтвердил → флаг;
  // возврат или авторизованный «не владеет» → снять; сеть/натив недоступны, ошибка или
  // неавторизованный пустой список → флаг не трогаем (офлайн не должен ронять доступ).
  function refresh() {
    var a;
    try { a = currentAdapter(); } catch (e) { return Promise.resolve(_owned); }
    if (!a || a.kind !== 'rustore') return Promise.resolve(_owned);   // mock/браузер — верим локальному флагу
    return Promise.resolve(a.status()).then(function (st) {
      var was = _owned;
      _owned = ownershipAfterCheck(was, st); writeFlag(_owned);
      if (was !== _owned && typeof window !== 'undefined' && window.UI && window.UI.render) {
        try { window.UI.render(); } catch (e) {}
      }
      return _owned;
    }, function () { return _owned; });   // ошибка получения списка — оставляем как было
  }

  // Цена из магазина для пейволла (или null → UI показывает свою строку).
  function getPriceLabel() {
    var a;
    try { a = currentAdapter(); } catch (e) { return Promise.resolve(null); }
    if (!a || typeof a.getPriceLabel !== 'function') return Promise.resolve(null);
    return Promise.resolve(a.getPriceLabel()).then(function (v) { return v || null; }, function () { return null; });
  }

  // Старт в браузере: оптимистично из кэш-флага (мгновенно), затем авторитетная ре-проверка на нативе.
  function init() {
    _owned = readFlag();
    try { if (typeof window !== 'undefined' && window.isNativeApp && window.isNativeApp()) refresh(); } catch (e) {}
  }

  var api = {
    PRODUCT_ID: PRODUCT_ID,
    createMockPayment: createMockPayment, createRuStorePayment: createRuStorePayment,
    selectPaymentAdapter: selectPaymentAdapter,
    OWNED_STATUSES: OWNED_STATUSES, isOwnedStatus: isOwnedStatus,
    purchaseGrantsPro: purchaseGrantsPro, restoreGrantsPro: restoreGrantsPro,
    ownershipAfterCheck: ownershipAfterCheck, createUnavailablePayment: createUnavailablePayment,
    isPurchasedSync: isPurchasedSync, markPurchased: markPurchased, clearPurchase: clearPurchase,
    readFlag: readFlag, writeFlag: writeFlag, obf: obf, deobf: deobf,
    currentAdapter: currentAdapter, refresh: refresh, getPriceLabel: getPriceLabel, init: init
  };

  if (typeof window !== 'undefined') { try { init(); } catch (e) {} }
  return api;
});
