/* license.js — офлайн-активация Полного доступа лицензионным ключом.
   Эталон — Сейф/mobile/www/js/license.js, подход 1:1 для единообразия продуктов.
   Асимметрия: ECDSA P-256 + SHA-256 через WebCrypto (crypto.subtle) — поддержана ЛЮБЫМ
   Android WebView (в отличие от Ed25519, который есть лишь в новых). В приложение вшит
   ТОЛЬКО ПУБЛИЧНЫЙ ключ; подписать валидный ключ можно лишь приватным (tools/license-key.json,
   НЕ в git). Ключ нельзя подделать, вытащив что-либо из APK.

   Формат ключа: "HOMYAK-PRO." + b64url(payloadJSON) + "." + b64url(signature).
   payload = { product:'homyak', id, iat, [note] }. Подпись покрывает БАЙТЫ payloadJSON.
   product ОБЯЗАН быть "homyak" — ключ от «Сейфа» (product "seyf-pro") сюда не подойдёт, и наоборот.

   Кэш для мгновенного офлайн-старта: сам подписанный ключ хранится в localStorage
   (обфусцирован) + обфусцированный булев кэш-флаг. На КАЖДОМ запуске подпись пере-проверяется
   против вшитого публичного ключа: голому флагу доверия нет — если хранилище подделали
   (флаг true без валидного ключа), на ре-проверке доступ снимается. Данные пользователя
   (кошельки/операции) при этом НЕ трогаются — только флаг доступа.

   UMD: в браузере — window.License; в node (тесты) — module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.License = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Публичный ключ (raw uncompressed P-256, 65 байт, base64url). Пара сгенерирована
  // tools/gen-license.mjs; приватная половина у Алексея и в git не попадает.
  var PUB_KEY_B64 = 'BI1vSdRm5ZhuuiXwPa3L5wGYzEZMbEjeW9hlnm3jYi8GKBYihQrqgxm36lQK3AISmr1W7j9t2DjM6_hfaPXkZD8';

  var PRODUCT = 'homyak';
  var PREFIX = 'HOMYAK-PRO.';
  var LS_KEY = 'homyak.lic';    // обфусцированный лицензионный ключ
  var LS_FLAG = 'homyak.lf';    // обфусцированный булев кэш-флаг (оптимистичный старт)
  var OBF = 0x5c;               // байт XOR для обфускации (не защита, а «не голым текстом»)

  // ---------- base64 без исключений наружу ----------
  function atobSafe(s) {
    try {
      if (typeof atob === 'function') return atob(s);
      return Buffer.from(s, 'base64').toString('binary');   // node-тест
    } catch (e) { return null; }
  }
  function btoaSafe(s) {
    try {
      if (typeof btoa === 'function') return btoa(s);
      return Buffer.from(s, 'binary').toString('base64');    // node-тест
    } catch (e) { return null; }
  }

  // base64url → Uint8Array (битый ключ → null у вызывающего).
  function fromB64u(s) {
    var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    var pad = t.length % 4 === 2 ? '==' : t.length % 4 === 3 ? '=' : '';
    var bin = atobSafe(t + pad);
    if (bin == null) return null;
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');   // node без TextDecoder
  }
  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  // ---------- чистый разбор ключа (без крипто) — под тест ----------
  // Нормализует, режет префикс/пробелы, достаёт части, проверяет product === 'homyak'.
  // Возвращает { payloadB64, sigB64, payloadBytes, sig, payload } или null.
  function parseLicenseKey(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    s = s.replace(/\s+/g, '');                                // пробелы/переводы внутри убираем
    if (s.toUpperCase().indexOf(PREFIX) === 0) s = s.slice(PREFIX.length);   // префикс не обязателен
    var parts = s.split('.');
    if (parts.length !== 2) return null;
    var payloadB64 = parts[0], sigB64 = parts[1];
    var payloadBytes = fromB64u(payloadB64);
    var sig = fromB64u(sigB64);
    if (!payloadBytes || !sig || payloadBytes.length === 0 || sig.length !== 64) return null;
    var payload = null;
    try { payload = JSON.parse(decodeUtf8(payloadBytes)); } catch (e) { return null; }
    if (!payload || typeof payload !== 'object' || payload.product !== PRODUCT) return null;
    return { payloadB64: payloadB64, sigB64: sigB64, payloadBytes: payloadBytes, sig: sig, payload: payload };
  }

  // Импорт публичного ключа (raw P-256) как CryptoKey для verify.
  function importPublicKey(rawB64, subtle) {
    var raw = fromB64u(rawB64);
    if (!raw) return Promise.reject(new Error('bad public key'));
    return subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }

  // Проверка ключа против ГОТОВОГО публичного CryptoKey (общий путь теста и прод).
  function verifyToken(raw, publicKey, subtle) {
    var parsed = parseLicenseKey(raw);
    if (!parsed) return Promise.resolve({ valid: false, reason: 'format' });
    return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, parsed.sig, parsed.payloadBytes)
      .then(function (ok) { return ok ? { valid: true, payload: parsed.payload } : { valid: false, reason: 'signature' }; })
      .catch(function () { return { valid: false, reason: 'crypto' }; });
  }

  // Прод-точка: проверка против ВШИТОГО публичного ключа. subtle/publicKeyB64 инъектируются в тестах.
  function verifyLicense(raw, opts) {
    opts = opts || {};
    var subtle = opts.subtle || (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!subtle) return Promise.resolve({ valid: false, reason: 'no-webcrypto' });
    return importPublicKey(opts.publicKeyB64 || PUB_KEY_B64, subtle)
      .then(function (pub) { return verifyToken(raw, pub, subtle); })
      .catch(function () { return { valid: false, reason: 'no-webcrypto' }; });
  }

  // ---------- обфускация и хранилище ----------
  function xorStr(s) {
    var o = '';
    for (var i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ OBF);
    return o;
  }
  function obf(str) { var b = btoaSafe(xorStr(String(str))); return b == null ? '' : b; }
  function deobf(str) { var bin = atobSafe(String(str || '')); return bin == null ? '' : xorStr(bin); }

  // localStorage может быть недоступен (приватный режим/политика) — безопасный доступ.
  function ls() { try { return (typeof window !== 'undefined') ? window.localStorage : null; } catch (e) { return null; } }

  function storeKey(key, storage) {
    var st = storage || ls(); if (!st) return;
    try { st.setItem(LS_KEY, obf(String(key))); } catch (e) {}
  }
  function loadStoredKey(storage) {
    var st = storage || ls(); if (!st) return '';
    try { var v = st.getItem(LS_KEY); return v ? deobf(v) : ''; } catch (e) { return ''; }
  }
  function clearStored(storage) {
    var st = storage || ls(); if (!st) return;
    try { st.removeItem(LS_KEY); st.removeItem(LS_FLAG); } catch (e) {}
  }
  function writeFlag(b, storage) {
    var st = storage || ls(); if (!st) return;
    try { if (b) st.setItem(LS_FLAG, obf('1')); else st.removeItem(LS_FLAG); } catch (e) {}
  }
  function readFlag(storage) {
    var st = storage || ls(); if (!st) return false;
    try { var v = st.getItem(LS_FLAG); return !!v && deobf(v) === '1'; } catch (e) { return false; }
  }

  // ---------- состояние доступа ----------
  var _active = false;
  function isActiveSync() { return _active; }
  function setActive(b) { _active = !!b; }   // для тестов/восстановления

  // Пере-проверка ключа из хранилища (тестируемо: storage/subtle/publicKeyB64 инъектируются).
  // Флаг всегда синхронизируется с РЕАЛЬНЫМ результатом проверки: подделанный флаг гаснет.
  function verifyStored(opts) {
    opts = opts || {};
    var storage = opts.storage || ls();
    var key = loadStoredKey(storage);
    if (!key) { writeFlag(false, storage); return Promise.resolve({ active: false, reason: 'no-key' }); }
    return verifyLicense(key, opts).then(function (r) {
      writeFlag(!!r.valid, storage);
      return { active: !!r.valid, reason: r.reason, payload: r.payload };
    });
  }

  // Браузерная ре-проверка на старте: обновляет in-memory флаг и, если изменился, перерисовывает UI.
  function refresh() {
    return verifyStored({}).then(function (r) {
      var was = _active; _active = r.active;
      if (was !== _active && typeof window !== 'undefined' && window.UI && window.UI.render) {
        try { window.UI.render(); } catch (e) {}
      }
      return r.active;
    });
  }

  // Активация вставленным ключом: проверяем подпись → при успехе храним ключ и поднимаем флаг.
  // Данные пользователя не трогаем. Возвращает результат verifyLicense.
  function activate(raw, opts) {
    return verifyLicense(raw, opts).then(function (r) {
      if (r.valid) { storeKey(String(raw).trim()); writeFlag(true); _active = true; }
      return r;
    });
  }

  // Снятие доступа: чистит ТОЛЬКО лицензию и флаг, кошельки/операции не трогает.
  function deactivate(storage) { clearStored(storage); _active = false; }

  // Инициализация в браузере: оптимистично из кэш-флага (мгновенный старт), затем
  // авторитетная асинхронная ре-проверка подписи вшитым ключом.
  function init() {
    _active = readFlag();
    if (typeof crypto !== 'undefined' && crypto.subtle) refresh();
  }

  var api = {
    PUB_KEY_B64: PUB_KEY_B64, PRODUCT: PRODUCT, PREFIX: PREFIX,
    parseLicenseKey: parseLicenseKey, importPublicKey: importPublicKey,
    verifyToken: verifyToken, verifyLicense: verifyLicense,
    verifyStored: verifyStored, refresh: refresh, activate: activate, deactivate: deactivate,
    isActiveSync: isActiveSync, setActive: setActive,
    storeKey: storeKey, loadStoredKey: loadStoredKey, clearStored: clearStored,
    writeFlag: writeFlag, readFlag: readFlag, obf: obf, deobf: deobf
  };

  if (typeof window !== 'undefined') { try { init(); } catch (e) {} }
  return api;
});
