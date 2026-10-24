/* purchase.js - покупка и восстановление «Полного доступа».
   Оркестрирует пейволл (edit.js) ↔ оплату (pay.js, window.Pay). Окна - свои (UI.openDlg в гамме приложения,
   НЕ нативный alert).

   Полный доступ = лицензионный ключ (license.js) ИЛИ RuStore-покупка (pay.js) ИЛИ Access.FULL (флаг тест/reel-сборки).
   Точки входа:
     window.UI.buyFullAccess(ret, why)    - запустить покупку (ret - куда вернуть после окна; why - строка причины пейволла)
     window.UI.restorePurchase(ret)       - восстановить ранее купленное (сменил телефон и т.п.)
     window.UI.hasFullAccess()            - единый источник правды о доступе
     window.UI.payHint(pc)                - строка пейволла по проверке до шторки
     window.UI.purchaseResume()           - возврат в приложение (App 'resume')

   1.0.6, ревью кода max 24.10.2026: механика «Понятной пенсии» 1.0.7 (эталон - Проекты/Пенсия/www/purchase.js;
   память android-app-build-checklist, «Покупка через RuStore Pay», п.1-14). Раньше JS угадывал судьбу шторки
   таймером stuckMs/grace/rescue/released: заплативший видел «Оплата не прошла» и платил второй раз (P1), оплата
   «в обработке» значила «не куплено» (P2), владение перепроверялось один раз (P3) и только при холодном старте (P4).
   ОДНА МАШИНА СОСТОЯНИЙ:
     idle → precheck → sheet → ok | pending (опрос СВОЕЙ покупки по purchaseId) | failed (код) | cancelled
   - Сессия (S) - единственный замок: снимает только она сама (done(s)). Таймера «зависания» нет: шторку не отпускаем.
     Вернулся из банка по иконке, а шторка убита, - итог даёт ПЛАГИН (на resume спрашивает getPurchase(свой id)).
   - Снимок владения (Pay.snapshot): owned | none | unknown. unknown - НЕ «не куплено»: перед шторкой - окно «Не удалось
     проверить», после неуспеха - окно неуспеха, а поздний owned всё равно откроет доступ.
   - Поздний успех не теряется: событие плагина purchaseLate (и поздний ответ снимка) открывает доступ.
   - «В обработке» (PROCESSING/EXECUTING или начатая оплата) - окно «Оплата обрабатывается», опрос 5 с до 3 мин →
     «Готово» / «Оплата не прошла» / «Проверим позже»; новую шторку не открываем; старше 30 мин - не ждём.
   - Окна покупки не затирают чужое окно (карточку категории, регулярный платёж…): итог ждёт его закрытия (очередь,
     P8); своё окно (пейволл .pw, окна покупки .pay-win) - заменяют. Закрытие итога возвращает туда, откуда пришли (ret).
   - Пейволл закрыли, пока шли проверки до шторки, - шторку не открываем (P7).

   Идентификатор товара и console_app_id - в www/pay-config.js. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.UI) return;
  var UI = window.UI;

  function payOn() {
    try { return !!(window.Access && window.Access.PAY); } catch (e) { return false; }
  }
  function P() { return window.Pay || null; }

  // ---------- тексты (на «вы», дефис вместо длинного тире) ----------
  var TXT = {
    thanks: 'Полный доступ открыт. Спасибо, что поддержали разработку!',
    restored: 'Покупка восстановлена. Полный доступ снова открыт.',
    owned: 'Полный доступ уже куплен в этом аккаунте RuStore. Платить ещё раз не нужно - доступ открыт.',
    authPaywall: 'RuStore может попросить войти. Без входа проще через СБП.',
    vpn: 'Если включён VPN, выключите его на время оплаты.'
  };
  // Итог неуспешной покупки → окно. retry: «Позже» / «Попробовать снова»; restore: «Позже» / «Восстановить покупку».
  var FAIL = {
    failed:       { title: 'Оплата не прошла', retry: true, vpn: true, text: 'Попробуйте через СБП - этот способ уже выбран в окне оплаты.' },
    nomethod:     { title: 'Оплата не прошла', retry: true, vpn: true, text: 'RuStore не нашёл подходящего способа оплаты. Попробуйте через СБП.' },
    unauthorized: { title: 'Оплата не прошла', retry: true, vpn: false, text: 'RuStore попросил войти в аккаунт. Войдите в RuStore или оплатите через СБП.' },
    outdated:     { title: 'Обновите RuStore', retry: true, vpn: false, text: 'Эта версия RuStore не принимает оплату. Обновите RuStore и попробуйте снова.' },
    notinstalled: { title: 'Нужен RuStore', retry: true, vpn: false, text: 'Оплата идёт через приложение RuStore. Установите его и попробуйте снова.' },
    banned:       { title: 'Оплата недоступна', retry: false, vpn: false, text: 'RuStore сейчас не принимает оплату. Подробности - в поддержке RuStore.' },
    // магазин не ответил, куплено ли (unknown): шторку не открываем - могла идти оплата (ревью P1)
    nocheck:      { title: 'Не удалось проверить покупку', retry: true, vpn: false, text: 'RuStore не ответил, куплен ли полный доступ. Проверьте интернет и попробуйте снова.' },
    already:      { title: 'Покупка уже есть', restore: true, text: 'Полный доступ уже куплен в этом аккаунте RuStore. Платить ещё раз не нужно - восстановите покупку.' },
    // 4000020, а getPurchases покупки не видит (ревью P6): честный выход - аккаунт и поддержка RuStore, без тупика
    alreadyhidden:{ title: 'RuStore не показал покупку', restore: true, text: 'RuStore сообщил, что полный доступ уже куплен, но в списке покупок этого аккаунта его нет. Проверьте, что в RuStore выполнен вход в тот же аккаунт, где покупали, и нажмите «Восстановить покупку» ещё раз. Если не поможет - напишите в поддержку RuStore: приложение RuStore, раздел «Помощь».' },
    // 4000021 «незавершённая покупка» / RuStorePayInvalidActivePurchase (ревью P5): второй счёт не открываем
    unfinished:   { title: 'Прошлая оплата не завершена', restore: true, text: 'RuStore ещё не закончил прошлую оплату, платить второй раз не нужно. Если вы уже оплатили, нажмите «Восстановить покупку». Если не оплачивали - попробуйте позже.' },
    // плагин ответил 'busy': прошлое окно оплаты RuStore ещё живо (JS перезапустился при открытой шторке)
    sheetbusy:    { title: 'Оплата ещё не завершена', restore: true, text: 'Прошлое окно оплаты RuStore ещё не закрылось, платить второй раз не нужно. Если вы уже оплатили, нажмите «Восстановить покупку». Если ещё не оплатили - закройте приложение и откройте снова.' },
    // оплату начали (плагин помнит это и после перезапуска), итога всё нет - ждали уже 3 минуты
    /* решение владельца 24.10 (песочница: ушёл в банк по СБП, не заплатил, вернулся - RuStore 30 минут держит оплату «в
       обработке», и «Купить» полчаса не давал заплатить). Как в «Карте года» 1.1.1: выбор «Подождать» / «Оплатить снова»;
       опрос прошлой оплаты идёт в фоне - подтвердится поздно, доступ откроется сам */
    prevpending:  { title: 'Предыдущая оплата ещё проверяется', payagain: true, text: 'Если вы уже заплатили в банке, не платите второй раз - подождите, полный доступ откроется сам. Если не платили - можно оплатить снова.' }
  };
  FAIL.cancelled = FAIL.failed;
  // Окна-сообщения с одной кнопкой «Понятно»
  var INFO = {
    pending:  { title: 'Оплата обрабатывается', text: 'RuStore ещё проверяет оплату. Не платите второй раз: когда оплата пройдёт, полный доступ откроется сам.' },
    later:    { title: 'Проверим позже', text: 'RuStore пока не подтвердил оплату. Приложение проверит её снова, когда вы вернётесь в него. Если деньги списались, а доступ так и не открылся, нажмите «Восстановить покупку» в окне «Полный доступ».' },
    notfound: { title: 'Покупка не найдена', text: 'В этом аккаунте RuStore покупка «Полного доступа» не числится. Проверьте, что вы вошли в тот же аккаунт, с которого покупали. Если есть лицензионный ключ - активируйте его в окне «Полный доступ».' },
    error:    { title: 'Не получилось', text: 'Не удалось проверить покупки. Проверьте связь и попробуйте ещё раз.' }
  };
  var GRANT = { ok: TXT.thanks, owned: TXT.owned, restored: TXT.restored };

  // Проверка владения полным доступом. Три двери к Pro, любая открывает.
  UI.hasFullAccess = function () {
    try { if (window.Access && window.Access.FULL) return true; } catch (e) {}                 // тест/reel/флаг
    try { if (window.License && window.License.isActiveSync()) return true; } catch (e) {}      // офлайн-лицензия
    try { if (window.Pay && window.Pay.isPurchasedSync()) return true; } catch (e) {}           // RuStore-покупка
    return false;
  };
  // Первая отрисовка (ui.js) идёт раньше этого файла, когда hasFullAccess ещё нет, - перерисовать купившему
  // (иначе 🔒 на «+» до первого действия, найдено 05.10.2026).
  try { if (UI.hasFullAccess() && UI.render) UI.render(); } catch (e) {}

  // ================= ядро: одна машина состояний (порт Пенсии 1.0.7) =================

  /* тайминги: опрос своей покупки 5 с до 3 мин; снимок владения перед шторкой - до 8 с; восстановление - до 15 с;
     перепроверка владения при возврате в приложение - не чаще раза в 15 с; очередь окон проверяется раз в 0,4 с */
  var T_ = { pollMs: 5000, waitMs: 180000, ownsMs: 8000, restoreMs: 15000, resumeGapMs: 15000, queueMs: 400 };
  var S = null;             // сессия: { mode:'buy'|'restore'|'watch', state, pid, settle, late, ctx }
  var waited = {};          // purchaseId, чьё ожидание уже истекло («Проверим позже»): второй раз 3 минуты не ждём
  var laterId = null;       // последняя «Проверим позже»: на возврат в приложение перепроверить её
  var adapter = null, adapterFn = null;
  function now() { return Date.now(); }
  /* адаптер берём один раз на окружение (подписка на purchaseLate - один раз); self-test подменяет Pay.currentAdapter */
  function ad() {
    var p = P();
    if (!p) return null;
    if (!adapter || adapterFn !== p.currentAdapter) {
      adapterFn = p.currentAdapter;
      try { adapter = p.currentAdapter(); } catch (e) { adapter = null; }
      if (adapter && adapter.onLate) adapter.onLate(onLate);
    }
    return adapter;
  }
  function begin(mode, ctx) {
    var s = { mode: mode, state: mode === 'buy' ? 'precheck' : mode, ctx: ctx || null };
    S = s; try { P().beginAction(); } catch (e) {}
    if (ctx) { lastCtx = ctx; dropQueuedFail(); }   // новое нажатие: устаревший неуспех из очереди не нужен
    return s;
  }
  /* поздний успех пришёл, пока сессия ещё не дала итог (снимок после неуспеха, восстановление) - итог сессии = этот
     успех: окно «Оплата не прошла» поверх выданного доступа не показываем (повторное адв. ревью Пенсии, ВАЖНО-2) */
  function done(s, r) { if (S === s) S = null; return (s.late && !(r && r.granted)) ? s.late : r; }
  function res(kind, code) { return { kind: kind, granted: false, code: code || null }; }
  /* выдача доступа: флаг владения пишется только по подтверждению магазина; отметка выдачи (acknowledge) */
  function grant(kind, purchaseId) {
    try { P().markPurchased(); } catch (e) { return res('failed'); }
    if (purchaseId) { try { P().acknowledge(ad(), purchaseId); } catch (e) {} }
    if (purchaseId && purchaseId === laterId) laterId = null;
    return { kind: kind, granted: true, code: null };
  }
  var BUSY = { kind: 'busy', granted: false };

  /* доступ открыт вне итога сессии: идёт ожидание - завершить его этим успехом; идёт другая стадия - успех станет её
     итогом (done); сессии нет - отдельное окно «Готово» */
  function lateGrant(g) {
    if (S && S.state === 'pending' && S.settle) S.settle(g);
    else if (S) S.late = g;
    else show(g, lastCtx);
  }
  /* поздний owned из снимка, который не уложился в таймаут: доступ всё равно открыть (ревью P1) */
  function watchLate(sn) {
    if (!sn || !sn.late) return;
    sn.late.then(function (v) { if (v && v.state === 'owned' && !P().isPurchasedSync()) lateGrant(grant('owned', v.ackId || null)); }, function () {});
  }
  /* поздний успех шторки (плагин: purchaseLate) - открыть доступ */
  function onLate(r) {
    if (!r || r.status !== 'ok' || P().isPurchasedSync()) return;
    lateGrant(grant('ok', r.purchaseId));
  }

  /* ожидание итога СВОЕЙ покупки (pid) - окно «Оплата обрабатывается», опрос checkPurchase каждые pollMs до waitMs.
     pid нет - опрос снимком товара. Сбой связи - не вывод, ждём дальше (ревью P3: перепроверка не одна).
     notPaying - плагин знает, что оплата НЕ начиналась: счёт «open» = не оплачен, ждать нечего. Оплата начата -
     «open» значит «банк ещё проводит», ждём. */
  function wait(s, pid, notPaying) {
    if (s.late) return Promise.resolve(done(s, s.late));
    /* уже ждали 3 минуты - сразу честное «позже»; на «Купить» - окно «Первая оплата ещё идёт» */
    if (pid && waited[pid]) {
      if (s.mode === 'buy') { startBg(pid); return Promise.resolve(done(s, res('prevpending'))); }
      return Promise.resolve(done(s, res('later')));
    }
    s.state = 'pending'; s.pid = pid || null; s.paying = notPaying !== true;
    showPending(s.ctx);
    return new Promise(function (resolve) {
      var t0 = now(), timer = null, fin = false;
      s.settle = function (r) { if (fin) return; fin = true; clearTimeout(timer); resolve(done(s, r)); };
      function step() { timer = setTimeout(check, T_.pollMs); }
      function timeUp() { if (now() - t0 < T_.waitMs) return false; if (pid) { waited[pid] = true; laterId = pid; } s.settle(res('later')); return true; }
      function check() {
        if (fin) return;
        var q = pid ? P().checkPurchase(ad(), pid).then(function (c) { return c.status; })
          : P().snapshot(ad(), { timeoutMs: T_.ownsMs }).then(function (sn) { return sn.state === 'owned' ? 'ok' : sn.state === 'unknown' ? null : (sn.pending ? 'pending' : 'cancelled'); });
        q.then(function (st) {
          if (fin) return;
          if (st === 'ok') { s.settle(grant('ok', pid)); return; }
          if (st === 'cancelled' || st === 'error') { s.settle(res('failed')); return; }
          if (st === 'open' && !s.paying) { s.settle(res('cancelled')); return; }   /* счёт без начатой оплаты - не ждём */
          if (!timeUp()) step();
        }, function () { if (!fin && !timeUp()) step(); });
      }
      step();
    });
  }

  /* итог шторки → ok | pending | неуспех (с перепроверкой: закрыл шторку после оплаты в банке - это не отмена) */
  function afterSheet(s, r) {
    r = r || { status: 'error' };
    if (r.status === 'ok' && P().purchaseGrantsPro(r)) return done(s, grant('ok', r.purchaseId));
    if (r.status === 'pending') return wait(s, r.purchaseId);
    if (r.status === 'unavailable') return done(s, res('notconfigured'));
    if (r.status === 'busy') return done(s, res('sheetbusy'));   /* прошлое окно оплаты ещё не закрылось - не «не прошла» */
    /* плагин не смог проверить свою покупку после возврата (сеть) - ждём её итога; оплата не начиналась - первый же
       ответ «open» закончит ожидание */
    if (r.status === 'error' && r.code === 'CheckFailed' && r.purchaseId) return wait(s, r.purchaseId, r.paying !== true);
    var kind = r.status === 'cancelled' ? 'cancelled' : P().kindOfCode(r.code);
    if (kind === 'notconfigured') return done(s, res('notconfigured'));
    s.state = 'precheck';
    return P().snapshot(ad(), { timeoutMs: T_.ownsMs }).then(function (sn) {
      /* отметка выдачи - только оплаченной покупке из снимка (ackId), не неудавшейся покупке из ошибки шторки */
      if (sn.state === 'owned') return done(s, grant(kind === 'already' ? 'restored' : 'ok', sn.ackId));
      if (sn.pending) return wait(s, sn.pendingId || r.purchaseId);
      if (sn.state === 'unknown') watchLate(sn);
      return done(s, res(kind, r.code));
    });
  }

  /* ctx.anchor - узел пейволла, из которого нажали «Купить». Его закрыли (или поверх открыто другое окно), пока шли
     проверки до шторки, - шторку не открываем: она всплыла бы поверх чужого окна (ревью P7) */
  function stillHere(ctx) {
    if (!ctx || !ctx.anchor) return true;
    try { return ctx.anchor.isConnected !== false && UI.dlgOpen(); } catch (e) { return true; }
  }

  /* фоновый опрос прошлой оплаты «в обработке» (окно «Предыдущая оплата ещё проверяется»): НЕ замок - «Оплатить снова»
     не блокирует. Оплатилась - доступ и «Готово» (lateGrant: идёт новая шторка - станет её итогом); отменена/ошибка
     или прошло waitMs - опрос снимается. */
  var bg = null;
  function stopBg() { if (bg) { clearTimeout(bg.timer); bg = null; } }
  function startBg(pid) {
    if (!pid || (bg && bg.pid === pid)) return;
    stopBg();
    var b = { pid: pid, t0: now(), timer: null };
    bg = b;
    function next() {
      if (bg !== b) return;
      if (now() - b.t0 >= T_.waitMs) { stopBg(); return; }
      b.timer = setTimeout(check, T_.pollMs);
      if (b.timer && typeof b.timer.unref === 'function') b.timer.unref();   // node (тесты): опрос не держит процесс
    }
    function check() {
      if (bg !== b) return;
      P().checkPurchase(ad(), pid).then(function (c) {
        if (bg !== b) return;
        if (c && c.status === 'ok') { stopBg(); if (!P().isPurchasedSync()) lateGrant(grant('ok', pid)); return; }
        if (c && (c.status === 'cancelled' || c.status === 'error')) { stopBg(); return; }
        next();
      }, next);
    }
    next();
  }

  /* opts.again - «Оплатить снова» из окна «Предыдущая оплата ещё проверяется»: шторка открывается, опрос прошлой идёт дальше */
  function buy(ctx, opts) {
    var again = !!(opts && opts.again === true);
    if (!payOn() || !P()) return Promise.resolve(res('notconfigured'));
    if (S) return Promise.resolve(BUSY);   /* двойной тап / идёт другая покупка - вторая шторка не открывается */
    var s = begin('buy', ctx), a = ad();
    if (!a) return Promise.resolve(done(s, res('notconfigured')));
    return P().snapshot(a, { timeoutMs: T_.ownsMs }).then(function (sn) {
      if (sn.state === 'owned') return done(s, grant('owned', sn.ackId));
      if (sn.state === 'unknown') { watchLate(sn); return done(s, res('nocheck')); }
      /* оплата в обработке - новую шторку молча не открываем: спрашиваем (решение владельца 24.10) */
      if (sn.pending && !again) { startBg(sn.pendingId); return done(s, res('prevpending')); }
      return P().precheck(a).then(function (pc) {
        var fk = P().finalKind(pc);
        if (fk) return done(s, res(fk, pc.code));   /* Н6: бан / не подключено - шторку не открываем */
        if (s.late) return done(s, s.late);          /* пока проверяли, открылся доступ (поздний успех) */
        if (!stillHere(ctx)) return done(s, res('none'));
        s.state = 'sheet';
        return Promise.resolve().then(function () { return a.purchase(); })
          .then(null, function () { return { status: 'error' }; })
          .then(function (r) { return afterSheet(s, r); });
      });
    }).then(null, function () { return done(s, res('failed')); });
  }

  function restore(ctx, opts) {
    if (!payOn() || !P()) return Promise.resolve(res('notconfigured'));
    if (S) return Promise.resolve(BUSY);
    var s = begin('restore', ctx), already = !!(opts && opts.already);
    /* снимок с таймаутом - замок не залипает, если магазин молчит (ревью P9) */
    return P().snapshot(ad(), { timeoutMs: T_.restoreMs }).then(function (sn) {
      if (sn.state === 'owned') return done(s, grant('restored', sn.ackId));
      if (sn.state === 'unknown') { watchLate(sn); return done(s, res('error')); }
      if (sn.unavailable) return done(s, res('notconfigured'));
      if (sn.pending) return wait(s, sn.pendingId);   /* оплата ещё обрабатывается - не «не найдена», а ждём */
      return done(s, res(already ? 'alreadyhidden' : 'notfound'));
    }).then(null, function () { return done(s, res('error')); });
  }

  /* при запуске магазин видит свежую «оплата запущена»: ждать её итога без шторки */
  function watch() {
    if (!payOn() || !P()) return Promise.resolve(res('none'));
    if (S) return Promise.resolve(BUSY);
    var pa = P().pendingAtStart();
    if (!pa) return Promise.resolve(res('none'));
    return wait(begin('watch', null), pa.id);
  }

  /* возврат в приложение (App 'resume'). Сессия идёт - её итог даёт плагин, JS ничего не угадывает.
     «Проверим позже» - перепроверить ту покупку; доступа нет - перепроверить владение (ревью P4: кэш владения
     обновлялся только при холодном старте, купившему в другом месте/поздно ничего не открывалось до перезапуска). */
  var lastResume = 0;
  function resume() {
    if (!payOn() || !P() || S) return false;
    if (laterId) {
      var pid = laterId;
      P().checkPurchase(ad(), pid).then(function (c) {
        if (c && c.status === 'ok' && !P().isPurchasedSync() && !S) show(grant('ok', pid), lastCtx);
      }, function () {});
      return true;
    }
    if (UI.hasFullAccess()) return false;
    if (now() - lastResume < T_.resumeGapMs) return false;
    lastResume = now();
    P().refresh(ad()).then(function (changed) {
      if (S) return;
      if (changed && P().isPurchasedSync()) show({ kind: 'ok', granted: true }, lastCtx);
      else if (!UI.hasFullAccess() && P().pendingAtStart()) watch().then(function (r) { show(r, lastCtx); });
    }, function () {});
    return true;
  }

  // ================= окна: очередь поверх единственного #dlg =================

  /* Своё окно - пейволл (.pw) или окно покупки (.pay-win). Чужое (карточка категории, регулярный платёж, настройки…)
     итог покупки не затирает: ждёт его закрытия (ревью P8; Пенсия 1.0.7 «очередь окон»). В очереди - последнее. */
  function dlgShown() { try { return !!(UI.dlgOpen && UI.dlgOpen()); } catch (e) { return false; } }
  function ours() {
    if (!dlgShown()) return true;
    try { var b = document.getElementById('dlgBody'); return !!(b && b.querySelector && b.querySelector('.pw, .pay-win')); } catch (e) { return true; }
  }
  var queued = null, qTimer = null;
  function openPay(o) {
    UI.openDlg({ title: o.title, body: '<div class="pay-win">' + o.body + '</div>', buttons: o.buttons, onClose: o.onClose });
    try { var bb = document.getElementById('dlgBtns'); if (bb && bb.classList && o.stack) bb.classList.add('pw-btns'); } catch (e) {}
  }
  function payDlg(o) {
    if (ours()) { openPay(o); return; }
    queued = o;
    if (!qTimer) qTimer = setInterval(flushQueue, T_.queueMs);
  }
  function flushQueue() {
    if (!queued) { clearInterval(qTimer); qTimer = null; return; }
    if (dlgShown()) return;   /* ждём, пока чужое окно закроют (пейволл, открытый заново, - тоже ждёт) */
    var o = queued; queued = null; clearInterval(qTimer); qTimer = null;
    openPay(o);
  }
  // новая покупка/восстановление: устаревший неуспех из очереди не нужен (успех - нужен всегда)
  function dropQueuedFail() { if (queued && !queued.granted) queued = null; }

  /* контекст одного нажатия: куда вернуть (ret, один раз), строка причины (why), узел пейволла (anchor) */
  var lastCtx = null;
  function mkCtx(ret, why) {
    var c = { ret: (typeof ret === 'function') ? ret : null, why: why || null, used: false, anchor: null };
    try { var b = document.getElementById('dlgBody'); c.anchor = (b && b.querySelector) ? b.querySelector('.pw') : null; } catch (e) {}
    c.back = function () { if (c.used) return; c.used = true; if (c.ret) { try { c.ret(); } catch (e) {} } };
    return c;
  }
  var NOCTX = { back: function () {}, ret: null, why: null };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  function notConfiguredDlg(ctx) {
    payDlg({ title: 'Полный доступ',
      body: '<p>Оплата подключится в ближайшем обновлении. Всё бесплатное работает без ограничений по времени.</p>',
      buttons: [{ label: 'Понятно', cls: 'primary' }], onClose: (ctx || NOCTX).back });
  }
  function showPending(ctx) {
    var m = INFO.pending;
    payDlg({ title: m.title, body: '<p>' + esc(m.text) + '</p>', buttons: [{ label: 'Понятно', cls: 'primary' }], onClose: (ctx || NOCTX).back });
  }

  // Окно неуспеха. «Деньги не списаны» не обещаем, на кнопки, которых в окне нет, не ссылаемся (1.0.5).
  function failDlg(kind, ctx) {
    var f = FAIL[kind] || FAIL.failed;
    var buttons = [{ label: 'Позже', cls: 'nav' }];
    if (f.restore) {
      /* ревью P9: восстановление с таймаутом (снимок до 15 с), второе нажатие ничего не делает; «Позже» во время
         проверки возвращает туда, откуда пришли (ret), а итог дождётся закрытия чужого окна */
      var pressed = false;
      buttons.push({ label: 'Восстановить покупку', cls: 'primary', onClick: function () {
        if (pressed || S) return false;
        pressed = true;
        try {
          var bb = document.getElementById('dlgBtns'), el = bb && bb.querySelector ? bb.querySelector('.btn.primary') : null;
          if (el) { el.disabled = true; el.textContent = 'Проверяю…'; }
        } catch (e) {}
        runRestore(ctx, { already: kind === 'already' || kind === 'alreadyhidden' });
        return false;
      } });
    } else if (f.payagain) {
      // «Подождать» - закрыть окно (фоновый опрос прошлой идёт); «Оплатить снова» - пейволл с той же причиной и шторка
      buttons = [{ label: 'Подождать', cls: 'nav' }, { label: 'Оплатить снова', cls: 'primary', onClick: function () {
        if (UI.paywall) UI.paywall(ctx.ret, ctx.why);
        UI.buyFullAccess(ctx.ret, ctx.why, { again: true });
        return false;
      } }];
    } else if (f.retry) {
      // «Попробовать снова»: вернуть пейволл (с той же строкой причины why, ревью P10) и сразу шторку
      buttons.push({ label: 'Попробовать снова', cls: 'primary', onClick: function () {
        if (UI.paywall) UI.paywall(ctx.ret, ctx.why);
        UI.buyFullAccess(ctx.ret, ctx.why);
        return false;
      } });
    } else {
      buttons = [{ label: 'Понятно', cls: 'primary' }];
    }
    payDlg({ title: f.title, stack: true,
      body: '<p>' + esc(f.text) + '</p>' + (f.vpn ? '<p class="pay-vpn">' + esc(TXT.vpn) + '</p>' : ''),
      buttons: buttons, onClose: ctx.back });
  }

  /* итог сессии → окно. Успех - «Готово», закрытие возвращает туда, откуда пришли (ret: карточка категории…) */
  function show(r, ctx) {
    if (!r || r.kind === 'busy' || r.kind === 'none') return;
    ctx = ctx || NOCTX;
    if (r.granted) {
      try { UI.render(); } catch (e) {}          // лимиты сняты сразу (фон под окном)
      try { UI.haptic('medium'); } catch (e) {}
      var o = { title: 'Готово', body: '<p>' + esc(GRANT[r.kind] || TXT.thanks) + '</p>', buttons: [{ label: 'Понятно', cls: 'primary' }], onClose: ctx.back, granted: true };
      payDlg(o);
      return;
    }
    if (r.kind === 'notconfigured') { notConfiguredDlg(ctx); return; }
    if (FAIL[r.kind]) { failDlg(r.kind, ctx); return; }
    var m = INFO[r.kind] || INFO.error;
    payDlg({ title: m.title, body: '<p>' + esc(m.text) + '</p>', buttons: [{ label: 'Понятно', cls: 'primary' }], onClose: ctx.back });
  }

  function runRestore(ctx, opts) {
    return restore(ctx, opts).then(function (r) { show(r, ctx); }, function () { show(res('error'), ctx); });
  }

  // Строка пейволла по проверке до шторки: бан - причина; не вошёл в RuStore - совет про СБП; RuStore устарел или
  // не установлен - подсказка. Сбой сети и «не знаем» - строки нет (сеть ≠ «оплата недоступна», Пенсия 1.0.7).
  function payHint(pc) {
    if (!pc) return null;
    var p = P();
    var fk = p ? p.finalKind(pc) : null;
    if (fk === 'banned') return FAIL.banned.text;
    if (fk) return null;   // заглушка id - пейволл и так честно говорит о «Купить»
    if (pc.available === false && p) {
      var k = p.kindOfCode(pc.code);
      // Н6: до оплаты - «может попросить», а не «попросил» (текст окна после неудачи - FAIL.unauthorized)
      if (k === 'unauthorized') return TXT.authPaywall;
      if (k === 'outdated' || k === 'notinstalled') return FAIL[k].text;
    }
    if (pc.authorized === false && pc.installed !== false) return TXT.authPaywall;
    return null;
  }
  UI.payHint = payHint;

  // Запуск покупки. ret - куда вернуть после окна итога; why - строка причины пейволла (для «Попробовать снова»).
  UI.buyFullAccess = function (ret, why, opts) {
    var ctx = mkCtx(ret, why);
    if (!payOn() || !P()) { notConfiguredDlg(ctx); return; }
    /* идёт ожидание прошлой оплаты (в том числе начатой до запуска) - «Купить» спрашивает: «Подождать» / «Оплатить снова»
       (решение владельца 24.10). «Оплатить снова» снимает замок ожидания, а опрос прошлой оплаты переводит в фон.
       Другая стадия (шторка, проверки) - buy() ответит BUSY: двойной тап по «Купить» вторую шторку не открывает */
    if (S && S.state === 'pending') {
      if (!(opts && opts.again === true)) { if (!S.ctx) S.ctx = ctx; lastCtx = ctx; failDlg('prevpending', ctx); return; }
      var ws = S;
      if (ws.pid) startBg(ws.pid);
      ws.settle(res('none'));
    }
    buy(ctx, opts).then(function (r) { show(r, ctx); }, function () { show(res('failed'), ctx); });
  };
  // Восстановление покупки: getPurchases по тому же аккаунту RuStore («купил, сменил телефон»).
  UI.restorePurchase = function (ret) {
    var ctx = mkCtx(ret, null);
    if (!payOn() || !P()) { notConfiguredDlg(ctx); return; }
    runRestore(ctx, null);
  };

  UI.purchaseResume = resume;
  UI.purchaseBusy = function () { return !!S; };
  UI.purchaseState = function () { return S ? S.state : 'idle'; };
  UI.purchaseTimings = function (o) {
    o = o || {};
    ['pollMs', 'waitMs', 'ownsMs', 'restoreMs', 'resumeGapMs', 'queueMs'].forEach(function (k) { if (o[k] >= 0 && typeof o[k] === 'number') T_[k] = o[k]; });
    return { pollMs: T_.pollMs, waitMs: T_.waitMs, ownsMs: T_.ownsMs, restoreMs: T_.restoreMs, resumeGapMs: T_.resumeGapMs };
  };
  UI.payTexts = { TXT: TXT, FAIL: FAIL, INFO: INFO };

  // Возврат в приложение - только App 'resume' (visibilitychange у прозрачной шторки будил бы проверки, Пенсия №11).
  try {
    var N = window.NativePlugins;
    if (window.isNativeApp && window.isNativeApp() && N && N.App && N.App.addListener) N.App.addListener('resume', resume);
  } catch (e) {}

  // Запуск: ре-проверка владения в магазине (pay.js init). Доступ открылся (оплатил, пока процесс был убит в банке) -
  // окно «Готово»; магазин видит свежую «оплата запущена» и доступа нет - ждём её итога без новой шторки.
  try {
    if (payOn() && P() && P().bootCheck) {
      ad();   // подписка на purchaseLate
      P().bootCheck().then(function (changed) {
        if (S) return;
        if (changed && P().isPurchasedSync()) show({ kind: 'ok', granted: true }, null);
        else if (!UI.hasFullAccess() && P().pendingAtStart()) watch().then(function (r) { show(r, lastCtx); });
      }, function () {});
    }
  } catch (e) {}
})();
