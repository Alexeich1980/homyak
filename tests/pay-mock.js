'use strict';
/* pay-mock.js - мок нативного плагина RuStorePay ПО КОНТРАКТУ сессии покупки (перенесён из «Понятной пенсии» 1.0.7,
   Проекты/Пенсия/tests/pay-mock.js; плагин Хомяка - android/.../budgetphone/RuStorePayPlugin.java, тот же контракт). Моделирует то, что делает Java, чтобы экранные тесты проверяли JS против
   настоящего поведения плагина:
   - магазин: store (purchaseId → { status: ProductPurchaseStatus, age: мс }), владение/«в обработке» считаются из него;
   - purchase(): сессия со своим purchaseId (onPurchaseCreated); итог отдаётся РОВНО ОДИН РАЗ; неуспех шторки при
     известном id перепроверяется статусом покупки (PAID → ok, PROCESSING/EXECUTING → pending);
   - appResume(): Java handleOnResume, когда шторки на экране уже нет (вернулся по иконке, шторка убита): итог по
     статусу своей покупки; поздний успех Task после итога - событие purchaseLate;
   - checkPurchase({purchaseId}) - статус своей покупки; getPurchases({productId, auth}) - список покупок товара.
   - повторное адв. ревью 1.0.7 (ВАЖНО-1): событие шторки «оплата начата» (Java lastEvent started/completed) -
     s.started() или s.pay(статус). Счёт INVOICE_CREATED («open») при начатой оплате - pending, а не отмена; итог несёт paying.
   Параметры o:
     sheet: итог шторки сразу ({status:'ok'|'cancelled'|'error', code}) или функция (s) => {...} - сценарий: s.pay(статус),
            s.end(итог); без sheet - шторка открыта и ждёт теста (pl.session.end / pl.appResume)
     noId: плагин не узнаёт purchaseId (событие не пришло) - Java не может перепроверить итог
     unavailable: плагин без id приложения (заглушка) - {status:'unavailable'}
     precheck: ответ precheck (значение/функция); owned: ответ getPurchases целиком (значение/функция) - старый стиль
     getPurchases: (n, def) => ответ/промис/throw - вмешаться в n-й вызов; checkFail: checkPurchase и проверка на resume падают
     priceLabel: строка цены магазина */
const OK = ['PAID', 'CONFIRMED'], PEND = ['PROCESSING', 'EXECUTING'];
const STARTED_TTL_MS = 30 * 60 * 1000;   // Java STARTED_TTL_MS

function payPlugin(o) {
  o = o || {};
  const calls = { purchase: 0, getPurchases: 0, precheck: 0, acknowledge: 0, checkPurchase: 0 };
  const acks = [], gpArgs = [], late = [], store = new Map();
  let seq = 0, sess = null;
  const val = (v, d) => (typeof v === 'function' ? v() : (v === undefined ? d : v));
  const statusOf = (id) => {
    const p = store.get(id); if (!p) return 'error';
    const st = p.status;
    return OK.includes(st) ? 'ok' : PEND.includes(st) ? 'pending' : st === 'INVOICE_CREATED' ? 'open' : st === 'REJECTED' ? 'error' : 'cancelled';
  };
  const out = (status, id, code) => {
    const r = { status, ok: status === 'ok' };
    if (status === 'cancelled') r.cancelled = true;
    if (status === 'pending') r.pending = true;
    if (status === 'error') r.error = 'Платёж не прошёл';
    if (id) r.purchaseId = id;
    if (code) r.code = code;
    return r;
  };
  function settle(s, r) {
    if (s.resolved) { if (r.status === 'ok') late.forEach((f) => f(r)); return; }
    s.resolved = true; r.paying = !!s.paying; s.resolve(r);
  }
  function derived(arg) {
    let owned = false, revoked = false, pend = null, ack = null;
    for (const [id, p] of store) {
      if (OK.includes(p.status)) { owned = true; if (!p.acked) ack = id; }
      if (p.status === 'REFUNDED' || p.status === 'REVERSED') revoked = true;
      if (PEND.includes(p.status) && (!pend || p.age <= pend.age)) pend = { id, age: p.age };
    }
    /* третье адв. ревью (R1/R2): Java пишет «оплата начата» в SharedPreferences (переживает процесс) и отдаёт такой счёт
       INVOICE_CREATED как pending, пока нет финального статуса. Запись - про purchaseId: моделируем флагом started на
       записи магазина (переезжает вместе с ней в новый процесс), возраст - p.age */
    if (!pend) for (const [id, p] of store) if (p.started && p.status === "INVOICE_CREATED" && p.age < STARTED_TTL_MS) pend = { id, age: p.age, started: true };
    const r = { owned, revoked, pending: !!pend };
    if (pend) { r.pendingId = pend.id; r.pendingAgeMs = pend.age; if (pend.started) r.pendingStarted = true; }
    if (ack) { r.purchaseId = ack; r.ackPending = true; }
    if (!(arg && arg.auth === false)) r.authorized = true;
    return r;
  }
  const pl = {
    calls, acks, gpArgs, store, o,
    get session() { return sess; },
    statusOf,
    /* покупка в магазине (например, оставшаяся с прошлого запуска): статус и возраст */
    addPurchase(status, age) { const id = 'p' + (++seq); store.set(id, { status, age: age || 0 }); return id; },
    setStatus(id, status) { store.get(id).status = status; },
    /* Java handleOnResume: наша активность на переднем плане дольше паузы, шторки нет, а Task молчит */
    appResume() {
      const s = sess;
      if (!s || s.resolved) return;
      if (val(o.checkFail, false) || !s.id) { settle(s, s.id ? out('error', s.id, 'CheckFailed') : out('cancelled', null)); return; }
      const st = statusOf(s.id);
      if (st === 'ok' || st === 'pending') settle(s, out(st, s.id));
      else if (st === 'error') settle(s, out('error', s.id, 'REJECTED'));
      else if (st === 'open' && s.paying) settle(s, out('pending', s.id));
      else settle(s, out('cancelled', s.id));
    },
    addListener(ev, fn) { if (ev === 'purchaseLate') late.push(fn); return Promise.resolve({ remove() {} }); },
    purchase: () => {
      calls.purchase++;
      if (o.unavailable) return Promise.resolve({ ok: false, status: 'unavailable', unavailable: true });
      return new Promise((resolve) => {
        const id = 'p' + (++seq);
        store.set(id, { status: 'INVOICE_CREATED', age: 0 });
        const s = { id: o.noId ? null : id, realId: id, resolved: false, resolve, paying: false };
        sess = s;
        // onPaymentStarted: человек ушёл платить в банк; Java сохраняет запись «оплата начата» (saveStarted)
        s.started = () => { s.paying = true; store.get(s.realId).started = true; };
        s.pay = (status) => { s.paying = true; store.get(s.realId).started = true; store.get(s.realId).status = status; };
        /* Task шторки: успех или неуспех (Java onSheetFailure: свой id известен - перепроверка статуса) */
        s.end = (r) => {
          r = r || {};
          if (r.status === 'ok') { if (r.purchaseId && !store.has(r.purchaseId)) { store.set(r.purchaseId, store.get(id)); store.delete(id); s.realId = r.purchaseId; if (s.id) s.id = r.purchaseId; } store.get(s.realId).status = 'PAID'; settle(s, out('ok', s.id)); return; }
          const base = out(r.status === 'cancelled' ? 'cancelled' : 'error', s.id, r.code);
          if (s.resolved) return;
          if (!s.id) { settle(s, base); return; }
          const st = statusOf(s.id);
          settle(s, (st === 'ok' || st === 'pending') ? out(st, s.id) : (st === 'open' && s.paying) ? out('pending', s.id) : base);
        };
        if (typeof o.sheet === 'function') o.sheet(s);
        else if (o.sheet) Promise.resolve().then(() => s.end(o.sheet));
      });
    },
    checkPurchase: async (a) => {
      calls.checkPurchase++;
      if (val(o.checkFail, false)) throw new Error('net');
      return { status: statusOf(a && a.purchaseId), purchaseId: a && a.purchaseId };
    },
    getPurchases: (arg) => {
      const n = ++calls.getPurchases;
      gpArgs.push(arg || {});
      const def = () => (o.owned !== undefined ? val(o.owned) : derived(arg));
      if (typeof o.getPurchases === 'function') return Promise.resolve().then(() => o.getPurchases(n, def));
      return Promise.resolve().then(def);
    },
    getProducts: async () => (o.priceLabel ? { ok: true, priceLabel: o.priceLabel } : { ok: false }),
    precheck: async () => { calls.precheck++; return val(o.precheck, { authorized: true, installed: true, available: true }); },
    acknowledge: async (a) => {
      calls.acknowledge++; acks.push(a && a.purchaseId);
      const p = store.get(a && a.purchaseId); if (p) p.acked = true;
      return { ok: true };
    }
  };
  return pl;
}

module.exports = { payPlugin };
