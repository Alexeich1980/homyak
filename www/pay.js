/* pay.js - оплата «Полного доступа» через RuStore Pay (разовая непотребляемая покупка)
   и её восстановление. Второй вход к Pro наравне с лицензионным ключом (license.js):
   Access.PRO = лицензионный ключ ИЛИ RuStore-покупка ИЛИ Access.FULL.

   1.0.6 (ревью кода max 24.10.2026): механика «Понятной пенсии» 1.0.7 (эталон - Проекты/Пенсия/www/pay.js) -
   память android-app-build-checklist, «Покупка через RuStore Pay: обязательные механики», п.1-14. Раньше JS сам
   угадывал судьбу шторки (таймер stuckMs/grace/rescue/released), и сбой проверки владения значил «не куплено».

   Слои:
   1) Адаптер оплаты поверх нативного плагина RuStorePay (android/.../RuStorePayPlugin.java), «недоступно»
      (натив без плагина - FAIL-CLOSED) или mock (только браузер/дев: на телефоне не выбирается никогда).
   2) Снимок владения (snapshot) - ОДНА функция «что магазин знает о товаре»: owned | none | unknown, с таймаутом.
      unknown (сбой, таймаут) нигде не значит «не куплено»; поздний ответ того же запроса не теряется (late).
      Предпроверка (precheck) - одна функция; окончательные причины «оплата недоступна» - только finalKind.
   3) Кэш владения в localStorage (homyak.pf, обфусцирован) - мгновенный офлайн-старт; авторитетная ре-проверка
      через getPurchases при запуске и при возврате в приложение без доступа (refresh, purchase.js).
      Флаг пишется ТОЛЬКО после подтверждения магазином (markPurchased); сетевой сбой доступ не снимает.
   Машина состояний самой покупки - purchase.js (idle → precheck → sheet → ok | pending | failed | cancelled).

   Контракт плагина (сессия покупки в плагине):
     purchase({productId}) → один итог: {status:'ok', ok:true, purchaseId} | {status:'pending', purchaseId}
       | {status:'cancelled', cancelled:true, purchaseId?} | {status:'error', code?, purchaseId?}
       | {status:'unavailable', unavailable:true} | {status:'busy'}   (+ paying: оплата начата - ушёл в банк)
     checkPurchase({purchaseId}) → {status:'ok'|'pending'|'open'|'cancelled'|'error', purchaseId} | reject (сеть)
     getPurchases({productId, auth}) → {owned, revoked, pending, pendingId?, pendingAgeMs?, purchaseId?, ackPending?, authorized?}
       | {owned:false, unavailable:true} | reject
     precheck({productId}) → {installed?, authorized?, available?, code?}
     acknowledge({purchaseId}) → {ok}
     событие 'purchaseLate' {status:'ok', purchaseId} - шторка ответила успехом уже ПОСЛЕ итога (итог дал resume).

   UMD: в браузере - window.Pay (+ фабрики на нём); в node (тесты) - module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pay-config.js'));
  else root.Pay = factory(root.PayConfig);
})(typeof self !== 'undefined' ? self : this, function (PayConfig) {
  'use strict';

  var CFG = PayConfig || { PRODUCT_ID: 'full_access' };
  var PRODUCT_ID = CFG.PRODUCT_ID || 'full_access';

  // ---------- 1) адаптеры ----------

  var STATUSES = ['ok', 'pending', 'cancelled', 'error', 'unavailable', 'busy'];
  /* итог шторки из плагина → {status, ok, purchaseId, code, paying}. Старые поля (ok/cancelled/unavailable/pending) -
     запасной путь. FAIL-CLOSED: 'ok' - только при ok === true строго (ok:"true"/1 - не покупка). */
  function normPurchase(r) {
    r = r || {};
    var st = STATUSES.indexOf(r.status) >= 0 ? r.status
      : (r.ok === true ? 'ok' : r.unavailable === true ? 'unavailable' : r.cancelled === true ? 'cancelled' : r.pending === true ? 'pending' : 'error');
    if (st === 'ok' && r.ok !== true) st = 'error';
    return { status: st, ok: st === 'ok', cancelled: st === 'cancelled', unavailable: st === 'unavailable',
             purchaseId: r.purchaseId ? String(r.purchaseId) : null, code: r.code != null ? String(r.code) : null,
             // оплата начата (плагин видел onPaymentStarted) - счёт «open» не значит «не платил»
             paying: r.paying === true };
  }

  // Mock для браузера/дева: покупка сразу «успех», владение держим в замыкании. На телефоне не выбирается.
  function createMockPayment(opts) {
    opts = opts || {};
    var owned = !!opts.owned;
    return {
      kind: 'mock',
      status: function () { return Promise.resolve({ owned: owned, revoked: false, authorized: true, unavailable: false, pending: false, pendingId: null, pendingAgeMs: null, ackId: null }); },
      isPurchased: function () { return Promise.resolve(owned); },
      purchase: function () { owned = true; return Promise.resolve(normPurchase({ status: 'ok', ok: true, purchaseId: 'mock-' + Date.now() })); },
      restore: function () { return Promise.resolve({ ok: true, purchased: owned }); },
      checkPurchase: function () { return Promise.resolve({ status: owned ? 'ok' : 'cancelled', code: null }); },
      onLate: function () {},
      getPriceLabel: function () { return Promise.resolve(null); },  // цены у мока нет - UI берёт свою строку
      precheck: function () { return Promise.resolve(null); },
      acknowledge: function () { return Promise.resolve(false); }
    };
  }

  // Боевая реализация поверх нативного плагина RuStorePay (см. RuStorePayPlugin.java).
  function createRuStorePayment(plugin, productId) {
    productId = productId || PRODUCT_ID;
    // Нормализованный ответ getPurchases. opts.auth === false - без вопроса о входе в RuStore (снимку он не нужен).
    function status(opts) {
      var arg = { productId: productId };
      if (opts && opts.auth === false) arg.auth = false;
      return Promise.resolve(plugin.getPurchases(arg)).then(function (r) {
        r = r || {};
        var owned = r.owned === true;
        return { owned: owned, revoked: r.revoked === true, authorized: r.authorized === true, unavailable: r.unavailable === true,
                 // покупка товара в промежуточном статусе (PROCESSING / EXECUTING или начатая оплата): её id и возраст
                 pending: !owned && r.pending === true, pendingId: (!owned && r.pending === true && r.pendingId) ? String(r.pendingId) : null,
                 pendingAgeMs: (typeof r.pendingAgeMs === 'number' && isFinite(r.pendingAgeMs)) ? r.pendingAgeMs : null,
                 // purchaseId оплаченной, но не отмеченной выдачей покупки (ackPending) - отметим её
                 ackId: (owned && r.ackPending === true && r.purchaseId) ? String(r.purchaseId) : null };
      });
    }
    return {
      kind: 'rustore',
      status: status,
      isPurchased: function () { return status().then(function (st) { return st.owned; }); },
      purchase: function () {
        // шторка оплаты уводит приложение в фон - «Защита входа» после неё не запирает
        // (вызов кончился без ухода в фон - RuStore сразу ответил ошибкой - отметку снимаем)
        var release = function () {};
        try {
          if (typeof window !== 'undefined' && window.AppLock && window.AppLock.away) {
            var rl = window.AppLock.away(window.AppLock.AWAY_CALL);
            if (typeof rl === 'function') release = rl;
          }
        } catch (e) {}
        return Promise.resolve().then(function () { return plugin.purchase({ productId: productId }); })
          .then(function (r) { release(); return normPurchase(r); }, function (e) { release(); throw e; });
      },
      // статус СВОЕЙ покупки по её id (опрос «оплата обрабатывается»). Нет метода/сбой - reject (= «не знаем»)
      checkPurchase: function (purchaseId) {
        if (!purchaseId || typeof plugin.checkPurchase !== 'function') return Promise.reject(new Error('no-check'));
        return Promise.resolve(plugin.checkPurchase({ purchaseId: String(purchaseId) })).then(function (r) {
          var st = r && ['ok', 'pending', 'open', 'cancelled', 'error'].indexOf(r.status) >= 0 ? r.status : null;
          if (!st) throw new Error('bad-check');
          return { status: st, code: r.code != null ? String(r.code) : null };
        });
      },
      // поздний успех шторки (плагин: событие purchaseLate)
      onLate: function (fn) {
        if (typeof plugin.addListener !== 'function') return;
        try { plugin.addListener('purchaseLate', function (d) { fn(normPurchase(d)); }); } catch (e) {}
      },
      // до шторки - установлен ли RuStore, вошёл ли человек и доступна ли оплата. Нет метода или сбой - null
      precheck: function () {
        if (typeof plugin.precheck !== 'function') return Promise.resolve(null);
        return Promise.resolve().then(function () { return plugin.precheck({ productId: productId }); }).then(function (r) {
          if (!r) return null;
          if (r.unavailable === true) return { authorized: null, installed: null, available: false, code: 'NotConfigured' };
          return { authorized: tri(r.authorized), installed: tri(r.installed), available: tri(r.available),
                   code: r.code != null ? String(r.code) : null };
        }, function () { return null; });
      },
      // отметка выдачи товара (updateAcknowledgementState ACKNOWLEDGED)
      acknowledge: function (purchaseId) {
        if (!purchaseId || typeof plugin.acknowledge !== 'function') return Promise.resolve(false);
        return Promise.resolve().then(function () { return plugin.acknowledge({ purchaseId: String(purchaseId) }); })
          .then(function (r) { return !!(r && r.ok === true); }, function () { return false; });
      },
      restore: function () {
        return status().then(function (st) {
          if (st.unavailable) return { ok: false, unavailable: true, purchased: false };
          return st.ackId ? { ok: true, purchased: st.owned, purchaseId: st.ackId } : { ok: true, purchased: st.owned };
        });
      },
      getPriceLabel: function () {
        if (typeof plugin.getProducts !== 'function') return Promise.resolve(null);
        return Promise.resolve(plugin.getProducts({ productId: productId })).then(function (r) {
          return (r && r.ok && r.priceLabel) ? String(r.priceLabel) : null;
        }, function () { return null; });
      }
    };
  }
  // true / false / null («не знаем»): плагин мог не прислать поле - это не «нет»
  function tri(v) { return v === true ? true : (v === false ? false : null); }

  // Адаптер «оплата недоступна»: покупка отвечает unavailable, владения не подтверждает.
  function createUnavailablePayment() {
    return {
      kind: 'unavailable',
      status: function () { return Promise.resolve({ owned: false, revoked: false, pending: false, authorized: false, unavailable: true }); },
      isPurchased: function () { return Promise.resolve(false); },
      purchase: function () { return Promise.resolve(normPurchase({ status: 'unavailable', unavailable: true })); },
      restore: function () { return Promise.resolve({ ok: false, unavailable: true, purchased: false }); },
      checkPurchase: function () { return Promise.reject(new Error('unavailable')); },
      onLate: function () {},
      getPriceLabel: function () { return Promise.resolve(null); },
      precheck: function () { return Promise.resolve(null); },
      acknowledge: function () { return Promise.resolve(false); }
    };
  }

  // На ТЕЛЕФОНЕ mock не выбирается никогда: mock «покупает» мгновенно и бесплатно. Натив без плагина →
  // адаптер «недоступно». Mock - только браузер/дев. env инъектируется в тестах.
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

  // ---------- 2) чистая логика ----------

  // Непотребляемым товаром владеем в этих статусах RuStore (совпадает с нативным ownsProduct).
  var OWNED_STATUSES = ['PAID', 'CONFIRMED'];
  function isOwnedStatus(status) { return OWNED_STATUSES.indexOf(String(status)) >= 0; }

  // Итог покупки открывает Pro? Только явный ok. Итог восстановления - только подтверждённое владение.
  function purchaseGrantsPro(result) { return !!(result && result.ok === true); }
  function restoreGrantsPro(result) { return !!(result && result.ok === true && result.purchased === true); }

  // Ре-проверка владения → новое значение кэша. Возврат (refund) снимает доступ, но ложно отобрать его нельзя:
  //   owned → true; unavailable → как было; revoked (REFUNDED/REVERSED) → false;
  //   не владеет + авторизован в RuStore → false; не владеет и НЕ авторизован → как было.
  function ownershipAfterCheck(prevOwned, st) {
    if (!st || st.unavailable) return !!prevOwned;
    if (st.owned === true) return true;
    if (st.revoked === true || st.authorized === true) return false;
    return !!prevOwned;
  }

  // Код ошибки RuStore (плагин: RuStorePaymentNetworkException.getCode() или имя исключения SDK) → вид итога.
  // Коды - https://www.rustore.ru/help/sdk/pay/kotlin-java/11-1-0 («Обработка ошибок»). Неизвестный - 'failed'.
  var CODE_KIND = {
    '4000020': 'already',            // продукт уже приобретён
    '4000021': 'unfinished',         // незавершённая покупка продукта (ревью P5)
    'InvalidActivePurchase': 'unfinished',   // RuStorePayInvalidActivePurchase: «запущен процесс оплаты» (ревью P5)
    '4000025': 'nomethod',           // не найден подходящий способ оплаты
    'RuStoreOutdated': 'outdated',
    'RuStoreNotInstalled': 'notinstalled',
    'UserUnauthorized': 'unauthorized',
    'UserBanned': 'banned',
    'ApplicationBanned': 'banned',
    'NotConfigured': 'notconfigured'
  };
  function kindOfCode(code) {
    return (code != null && Object.prototype.hasOwnProperty.call(CODE_KIND, String(code))) ? CODE_KIND[String(code)] : 'failed';
  }

  /* «Оплата недоступна» до шторки - только окончательные причины: пользователь или приложение заблокированы
     (решение Н6 владельца: при бане шторку не открываем), монетизация не подключена (NotConfigured - плагин без id).
     Сеть, «не вошёл», RuStore не установлен/устарел - шторку открываем (правило «Пенсии» 1.0.7: в шторке можно войти
     через VK ID или оплатить по СБП, настоящую ошибку покажет она сама). Итог - вид окна или null. */
  var FINAL = { 'UserBanned': 'banned', 'ApplicationBanned': 'banned', 'NotConfigured': 'notconfigured' };
  function finalKind(pc) {
    if (!pc || pc.available !== false || pc.code == null) return null;
    return Object.prototype.hasOwnProperty.call(FINAL, String(pc.code)) ? FINAL[String(pc.code)] : null;
  }

  /* Покупка «оплата запущена» свежая? Застрявшая в PROCESSING без возраста блокировала бы оплату навсегда.
     Старше PENDING_FRESH_MS - не ждём её (банк столько не думает). Совпадает с Java STARTED_TTL_MS. */
  var PENDING_FRESH_MS = 30 * 60 * 1000;
  function freshPending(st) {
    if (!st || st.pending !== true) return false;
    return st.pendingAgeMs == null || st.pendingAgeMs < PENDING_FRESH_MS;
  }

  // Цена из магазина приходит строкой amountLabel («990.00 руб.») - показываем как в приложении: «990 ₽»
  // (решение Алексея 22.10). Целая сумма - без копеек, копейки не нули - через запятую («1 290,50 ₽»), разряды
  // и пробел перед ₽ - неразрывные. Незнакомый формат (другая валюта, текст) - как пришёл.
  var NBSP = '\u00a0';
  function formatPrice(label) {
    if (label == null) return null;
    var s = String(label).replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var m = /^(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))? ?(?:руб\.?|р\.?|₽|RUB)$/i.exec(s);
    if (!m) return s;
    var whole = m[1].replace(/ /g, '').replace(/^0+(?=\d)/, '');
    var kop = m[2] ? (m[2].length === 1 ? m[2] + '0' : m[2]) : '';
    var grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return grouped + (kop && kop !== '00' ? ',' + kop : '') + NBSP + '₽';
  }

  // ---------- 3) локальный кэш владения ----------

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
  var _pendingAtStart = null;   // магазин видит свежую «оплата запущена»: { id } - purchase.js ждёт её итога
  // Поколение владения: любое действие с покупкой (beginAction, markPurchased, clearPurchase) увеличивает _gen.
  // refresh() применяет ответ магазина, только если поколение не изменилось за время запроса.
  var _gen = 0;
  function bumpGen() { _gen++; return _gen; }
  function generation() { return _gen; }
  function isPurchasedSync() { return _owned === true; }
  function pendingAtStart() { return _owned !== true ? _pendingAtStart : null; }
  function markPurchased(storage) { bumpGen(); _owned = true; _pendingAtStart = null; writeFlag(true, storage); }   // данные пользователя не трогаем - только флаг
  function clearPurchase(storage) { bumpGen(); _owned = false; writeFlag(false, storage); }

  // Текущий адаптер (по окружению приложения). Тесты и self-test подменяют api.currentAdapter.
  function currentAdapter() {
    var env = {};
    try {
      env.isNativeApp = (typeof window !== 'undefined') ? window.isNativeApp : null;
      env.NativePlugins = (typeof window !== 'undefined') ? window.NativePlugins : null;
      env.PRODUCT_ID = PRODUCT_ID;
    } catch (e) {}
    return selectPaymentAdapter(env);
  }
  function adapterOr(a) { if (a) return a; try { return api.currentAdapter(); } catch (e) { return null; } }

  var REFRESH_TIMEOUT_MS = 20000;
  var PRECHECK_TIMEOUT_MS = 4000;
  var TIMEOUT = {};
  function withTimeout(p, ms) {
    var timer = null;
    var t = new Promise(function (resolve) { timer = setTimeout(function () { resolve(TIMEOUT); }, ms); });
    return Promise.race([p, t]).then(function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; });
  }

  /* СНИМОК ВЛАДЕНИЯ - единственная проверка «что магазин знает о товаре» для покупки и восстановления (ревью P1, P3).
     → { state:'owned', ackId } | { state:'none', pending, pendingId, unavailable } | { state:'unknown', late }
     unknown - сбой или таймаут: это НЕ «не куплено». late - тот же запрос, который ещё может ответить: поздний owned
     не теряется (purchase.js откроет доступ). */
  function snapshot(adapter, opts) {
    var a = adapterOr(adapter);
    if (!a || a.kind === 'unavailable' || typeof a.status !== 'function') return Promise.resolve({ state: 'none', pending: false, pendingId: null, unavailable: true });
    var ms = (opts && opts.timeoutMs > 0) ? opts.timeoutMs : REFRESH_TIMEOUT_MS;
    var req = Promise.resolve().then(function () { return a.status({ auth: false }); }).then(function (st) {
      if (!st) return { state: 'unknown' };
      if (st.owned === true) return { state: 'owned', ackId: st.ackId || null };
      var fresh = freshPending(st);
      return { state: 'none', pending: fresh, pendingId: fresh ? (st.pendingId || null) : null, unavailable: st.unavailable === true };
    }, function () { return { state: 'unknown' }; });
    return withTimeout(req, ms).then(function (v) { return v === TIMEOUT ? { state: 'unknown', late: req } : v; });
  }

  // Ре-проверка через магазин (правило - ownershipAfterCheck): при запуске и при возврате в приложение без доступа.
  // Возвращает true, если доступ изменился. Устаревший ответ (поколение сменилось за время запроса), сбой и таймаут
  // ничего не меняют. Изменился - перерисовать главный экран (лимиты).
  function refresh(adapter, storage, opts) {
    var a = adapterOr(adapter);
    if (!a || a.kind !== 'rustore') return Promise.resolve(false);   // mock/браузер - верим локальному флагу
    var gen = _gen;
    var ms = (opts && opts.timeoutMs > 0) ? opts.timeoutMs : REFRESH_TIMEOUT_MS;
    return withTimeout(Promise.resolve().then(function () { return a.status(); }), ms).then(function (st) {
      if (st === TIMEOUT || gen !== _gen) return false;
      // владеет, а выдача не отмечена (купил в 1.0.5 и раньше, ответ шторки потерялся) - отмечаем
      if (st && st.owned === true && st.ackId) acknowledge(a, st.ackId);
      _pendingAtStart = (st && st.owned !== true && freshPending(st)) ? { id: st.pendingId || null } : null;
      var was = _owned;
      _owned = ownershipAfterCheck(was, st); writeFlag(_owned, storage);
      if (was !== _owned && typeof window !== 'undefined' && window.UI && window.UI.render) {
        try { window.UI.render(); } catch (e) {}
      }
      return was !== _owned;
    }, function () { return false; });   // ошибка получения списка - оставляем как было
  }

  // Цена из магазина для пейволла (или null → UI показывает свою строку), уже в виде «990 ₽».
  function getPriceLabel(adapter) {
    var a = adapterOr(adapter);
    if (!a || typeof a.getPriceLabel !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return a.getPriceLabel(); })
      .then(function (v) { return formatPrice(v) || null; }, function () { return null; });
  }

  // Отметка выдачи товара. Сбой - не беда: доступ уже открыт, refresh при запуске увидит ackId и повторит.
  function acknowledge(adapter, purchaseId) {
    if (!adapter || !purchaseId || typeof adapter.acknowledge !== 'function') return Promise.resolve(false);
    return Promise.resolve().then(function () { return adapter.acknowledge(purchaseId); })
      .then(function (v) { return v === true; }, function () { return false; });
  }
  // Предпроверка перед шторкой и для строки пейволла (одна функция). null - не знаем (браузер, сбой, таймаут).
  function precheck(adapter) {
    var a = adapterOr(adapter);
    if (!a || a.kind !== 'rustore' || typeof a.precheck !== 'function') return Promise.resolve(null);
    return withTimeout(Promise.resolve().then(function () { return a.precheck(); }), PRECHECK_TIMEOUT_MS)
      .then(function (v) { return (v && v !== TIMEOUT) ? v : null; }, function () { return null; });
  }
  // Статус своей покупки по id: { status } | reject («не знаем»: сеть, нет метода, таймаут)
  function checkPurchase(adapter, purchaseId, opts) {
    if (!adapter || typeof adapter.checkPurchase !== 'function') return Promise.reject(new Error('no-check'));
    var ms = (opts && opts.timeoutMs > 0) ? opts.timeoutMs : REFRESH_TIMEOUT_MS;
    return withTimeout(Promise.resolve().then(function () { return adapter.checkPurchase(purchaseId); }), ms)
      .then(function (v) { if (v === TIMEOUT || !v) throw new Error('timeout'); return v; });
  }

  // Старт: оптимистично из кэш-флага (мгновенно), затем авторитетная ре-проверка на нативе. Её итог (изменился
  // ли доступ) - bootCheck(): purchase.js покажет «Готово» и подождёт начатую оплату.
  var _boot = null;
  function init() {
    _owned = readFlag();
    _boot = null;
    try { if (typeof window !== 'undefined' && window.isNativeApp && window.isNativeApp()) _boot = refresh(); } catch (e) {}
  }
  function bootCheck() { return _boot || Promise.resolve(false); }

  var api = {
    PRODUCT_ID: PRODUCT_ID, LS_FLAG: LS_FLAG, PENDING_FRESH_MS: PENDING_FRESH_MS, REFRESH_TIMEOUT_MS: REFRESH_TIMEOUT_MS,
    createMockPayment: createMockPayment, createRuStorePayment: createRuStorePayment,
    createUnavailablePayment: createUnavailablePayment, selectPaymentAdapter: selectPaymentAdapter, normPurchase: normPurchase,
    OWNED_STATUSES: OWNED_STATUSES, isOwnedStatus: isOwnedStatus,
    purchaseGrantsPro: purchaseGrantsPro, restoreGrantsPro: restoreGrantsPro, ownershipAfterCheck: ownershipAfterCheck,
    isPurchasedSync: isPurchasedSync, pendingAtStart: pendingAtStart, markPurchased: markPurchased, clearPurchase: clearPurchase,
    readFlag: readFlag, writeFlag: writeFlag, obf: obf, deobf: deobf,
    currentAdapter: currentAdapter, refresh: refresh, getPriceLabel: getPriceLabel, init: init, bootCheck: bootCheck,
    generation: generation, beginAction: bumpGen,
    formatPrice: formatPrice, kindOfCode: kindOfCode, finalKind: finalKind, freshPending: freshPending,
    snapshot: snapshot, precheck: precheck, checkPurchase: checkPurchase, acknowledge: acknowledge, withTimeout: withTimeout
  };

  if (typeof window !== 'undefined') { try { init(); } catch (e) {} }
  return api;
});
