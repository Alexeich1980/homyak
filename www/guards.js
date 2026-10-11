/* guards.js - чистые решения трёх функций 1.0.3, без DOM (тестируются в Node,
   tests/guards.test.js). Связки с экраном живут в lock.js (замок) и nudges.js (окно
   оценки и напоминание о копии).

   1. Окно оценки RuStore (Review SDK). Правила RuStore: просить один раз в момент
      пользы, без предварительного вопроса и без своей кнопки. У нас: сразу после удачной
      записи операции, когда операций >= 20 и с первой прошло >= 7 дней. После любого
      ответа больше не зовём; единственный повтор - через 60 дней и только если SDK
      сказал «не показано» (RuStore не стоит, не вошёл, устарел).
   2. Замок на вход: код из 4 цифр (хэш PBKDF2-SHA256 с солью, открытого кода нигде
      нет), пауза после 5 неверных попыток (30 с, дальше вдвое больше), запирать после
      фона - только если прошла минута и это был уход хозяина, а не наше системное окно.
      Это замок от посторонних глаз, данные он НЕ шифрует.
   3. Напоминание «сохрани копию данных»: не чаще раза в месяц, не если копию делали
      в этом месяце или меньше 30 дней назад, не новичку (< 10 операций) и не в демо. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Guards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;

  function obj(v) { return (v && typeof v === 'object') ? v : {}; }
  function copy(v) { var o = {}, s = obj(v); for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k]; return o; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  // ---------- 1. окно оценки ----------
  var REVIEW = { MIN_TX: 20, MIN_DAYS: 7, RETRY_DAYS: 60 };
  // Коды ответа плагина RuStoreReview, после которых окно НЕ было показано по причине
  // на стороне телефона - их можно попробовать ещё раз (один раз, через 60 дней).
  var REVIEW_RETRY = ['NOT_INSTALLED', 'UNAUTHORIZED', 'OUTDATED'];

  // Время первой операции: метка создания ts (её ставит Engine.addTx), у старых
  // операций без ts - полдень даты операции.
  function firstTxTime(list) {
    var best = null;
    (Array.isArray(list) ? list : []).forEach(function (t) {
      if (!t) return;
      var v = num(t.ts);
      if (!(v > 0) && typeof t.date === 'string') {
        var p = t.date.split('-');
        v = new Date(+p[0], +p[1] - 1, +p[2], 12).getTime();
      }
      if (v > 0 && (best === null || v < best)) best = v;
    });
    return best;
  }

  // Окно оценки - только в стор-сборке (Access.STORE). У тест-сборки тот же applicationId:
  // на телефоне с RuStore всплыло бы настоящее окно оценки магазинного приложения, и отзыв
  // ушёл бы с тестовой сборки (решение 05.10.2026, 1.0.3).
  function reviewAllowed(access) { return !!(access && access.STORE === true); }

  // st - флаги из localStorage: {done, retryAt, retried, startedAt, code}
  function reviewDue(st, ctx) {
    var s = obj(st), c = obj(ctx);
    if (s.done) return false;
    // окно запускали, а ответ не дошёл (приложение закрыли посреди) - считаем показанным
    if (s.startedAt && !s.answered) return false;
    if (s.retryAt && num(c.now) < num(s.retryAt)) return false;
    if (num(c.txCount) < REVIEW.MIN_TX) return false;
    if (!(num(c.firstTs) > 0)) return false;
    return num(c.now) - num(c.firstTs) >= REVIEW.MIN_DAYS * DAY;
  }
  function reviewStart(st, now) {
    var s = copy(st);
    s.startedAt = num(now); s.answered = false;
    return s;
  }
  function reviewAfter(st, res, now) {
    var s = copy(st), r = obj(res);
    s.answered = true; s.at = num(now); s.code = r.shown ? 'SHOWN' : String(r.code || 'ERROR');
    if (!r.shown && REVIEW_RETRY.indexOf(r.code) >= 0 && !s.retried) {
      s.retried = true;
      s.retryAt = num(now) + REVIEW.RETRY_DAYS * DAY;
      s.done = false;
    } else {
      s.done = true;
    }
    return s;
  }

  // ---------- 2. замок ----------
  // AWAY_MAX - потолок «своего системного окна»: выбор папки, оплата, отпечаток дольше
  // 5 минут не длятся. Фон дольше - хозяин ушёл (например, из окна сохранения на «Домой»),
  // и замок обязан закрыть экран (находка ревью 1.0.3: после away замок не запирался вовсе).
  var LOCK = { PIN_LEN: 4, BG_MS: 60000, AWAY_MAX: 5 * 60000, MAX_FAILS: 5, PAUSE_MS: 30000, PAUSE_MAX: 30 * 60000, ITER: 100000 };

  function validPin(p) { return typeof p === 'string' && /^[0-9]{4}$/.test(p); }

  function cryptoObj() {
    if (typeof crypto !== 'undefined' && crypto && crypto.subtle) return crypto;
    if (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) return self.crypto;
    return null;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), out = '';
    for (var i = 0; i < b.length; i++) out += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return out;
  }
  function newSalt() {
    var c = cryptoObj(), b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return hex(b);
  }
  function utf8(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    var e = unescape(encodeURIComponent(s)), b = new Uint8Array(e.length);
    for (var i = 0; i < e.length; i++) b[i] = e.charCodeAt(i);
    return b;
  }
  // PBKDF2-SHA256: код из 4 цифр подбирается перебором в любом случае, поэтому хэш тут -
  // чтобы код не лежал открытым текстом, а не криптозащита данных (их замок не шифрует).
  function hashPin(pin, salt, iter) {
    var c = cryptoObj();
    if (!c) return Promise.reject(new Error('no-crypto'));
    return c.subtle.importKey('raw', utf8(String(pin)), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (key) {
        return c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8(String(salt)), iterations: iter || LOCK.ITER }, key, 256);
      })
      .then(hex);
  }
  function makePinRecord(pin) {
    if (!validPin(pin)) return Promise.reject(new Error('pin'));
    var salt = newSalt();
    return hashPin(pin, salt, LOCK.ITER).then(function (h) { return { salt: salt, hash: h, iter: LOCK.ITER }; });
  }
  function checkPin(rec, pin) {
    var r = obj(rec);
    if (!r.salt || !r.hash || !validPin(pin)) return Promise.resolve(false);
    return hashPin(pin, r.salt, r.iter || LOCK.ITER).then(function (h) { return h === r.hash; }, function () { return false; });
  }

  // Пауза не длиннее PAUSE_MAX: если часы перевели назад, until оказывается на сутки
  // вперёд, и без потолка экран просил бы «Подожди 1441 мин».
  function lockWait(st, now) {
    var w = num(obj(st).until) - num(now);
    return w > 0 ? Math.min(w, LOCK.PAUSE_MAX) : 0;
  }
  // То же для записи в хранилище: обрезаем until, иначе обрезанная пауза тянулась бы
  // до тех пор, пока часы не догонят старое until.
  function lockNormalize(st, now) {
    var s = copy(st);
    if (num(s.until) - num(now) > LOCK.PAUSE_MAX) s.until = num(now) + LOCK.PAUSE_MAX;
    return s;
  }
  function lockFail(st, now) {
    var s = copy(st);
    if (lockWait(s, now) > 0) return s;          // во время паузы нажатия не считаются
    s.fails = num(s.fails) + 1;
    if (s.fails >= LOCK.MAX_FAILS) {
      s.lockouts = num(s.lockouts) + 1;
      s.until = num(now) + Math.min(LOCK.PAUSE_MAX, LOCK.PAUSE_MS * Math.pow(2, s.lockouts - 1));
      s.fails = 0;
    }
    return s;
  }
  function lockOk(st) {
    var s = copy(st);
    s.fails = 0; s.lockouts = 0; s.until = 0;
    return s;
  }
  // away - мы сами открыли системное окно (сохранение файла, выбор файла, оплата,
  // отпечаток, окно оценки): приложение ушло в фон, но хозяин никуда не уходил. Прощаем
  // только короткий такой уход (< AWAY_MAX); дольше - запираем, как обычный фон.
  function resumeLock(o) {
    var c = obj(o);
    if (!c.on) return false;
    if (!(num(c.bgAt) > 0)) return false;
    var gone = num(c.now) - num(c.bgAt);
    if (gone < 0) return true;                    // часы перевели назад: сколько прошло - не знаем
    if (c.away && gone < LOCK.AWAY_MAX) return false;
    return gone >= LOCK.BG_MS;
  }

  // ---------- 3. напоминание о копии ----------
  // GAP_DAYS - сколько дней после показа карточки или «Позже» молчим. Одного календарного
  // месяца мало: показ 31 октября + «Позже» → снова 1 ноября (ревью 1.0.3).
  var BACKUP = { MIN_TX: 10, MIN_DAYS: 30, GAP_DAYS: 25 };
  function ymOf(ms) {
    var d = new Date(num(ms));
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m;
  }
  // o: {now, lastAt, shownYM, snoozeYM, shownAt, snoozeAt, txCount, demo, off}
  // Метка из будущего (часы перевели назад) паузу не держит.
  function recent(at, now) { var a = num(at), g = now - a; return a > 0 && g >= 0 && g < BACKUP.GAP_DAYS * DAY; }
  function backupDue(o) {
    var c = obj(o), now = num(c.now), ym = ymOf(now);
    if (c.off || c.demo) return false;
    if (num(c.txCount) < BACKUP.MIN_TX) return false;
    if (c.shownYM === ym || c.snoozeYM === ym) return false;
    if (recent(c.shownAt, now) || recent(c.snoozeAt, now)) return false;
    var last = num(c.lastAt);
    if (last > 0) {
      if (ymOf(last) === ym) return false;
      if (now - last < BACKUP.MIN_DAYS * DAY) return false;
    }
    return true;
  }

  return {
    DAY: DAY,
    REVIEW: REVIEW, REVIEW_RETRY: REVIEW_RETRY, firstTxTime: firstTxTime,
    reviewAllowed: reviewAllowed, reviewDue: reviewDue, reviewStart: reviewStart, reviewAfter: reviewAfter,
    LOCK: LOCK, validPin: validPin, newSalt: newSalt, hashPin: hashPin,
    makePinRecord: makePinRecord, checkPin: checkPin,
    lockWait: lockWait, lockNormalize: lockNormalize, lockFail: lockFail, lockOk: lockOk, resumeLock: resumeLock,
    BACKUP: BACKUP, ymOf: ymOf, backupDue: backupDue
  };
});
