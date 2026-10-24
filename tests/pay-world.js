'use strict';
/* pay-world.js - песочница покупки «Полного доступа» для node-тестов: настоящие www/pay-config.js + pay.js +
   purchase.js в vm, плагин RuStorePay - мок по контракту (tests/pay-mock.js), окно - модель единственного #dlg
   из ui.js: openDlg заменяет окно и ВЫБРАСЫВАЕТ прошлый onClose (как в ui.js), closeDlg зовёт onClose, кнопка
   с onClick → false окно не закрывает. Пейволл - модель edit.js paywall(back, why): тело с .pw, «Позже» → back,
   «Купить в RuStore» → UI.buyFullAccess(back, why). Чужое окно - card(): карточка категории (без .pw/.pay-win). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { payPlugin } = require('./pay-mock.js');

const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function world(o) {
  o = o || {};
  const pl = o.plugin || payPlugin(o.mock || {});
  const calls = { paywall: 0, ret: 0, render: 0, resumeListeners: [] };
  const opened = [];
  let cur = null;
  const anchors = new WeakMap();
  const store = new Map(o.ls || []);
  const UI = {
    openDlg(d) { cur = d; opened.push(d); if (d.onOpen) d.onOpen(); },
    closeDlg() { const d = cur; cur = null; if (d && d.onClose) d.onClose(); },
    dlgOpen() { return !!cur; },
    dlgAlert(text, title, onClose) { UI.openDlg({ title, body: text, buttons: [{ label: 'Понятно' }], onClose }); },
    render() { calls.render++; }, haptic() {},
    paywall(back, why) {
      calls.paywall++;
      const ret = typeof back === 'function' ? back : null;
      UI.openDlg({ title: 'Полный доступ', kind: 'paywall', why: why || null,
        body: '<div class="pw">' + (why ? '<div class="pw-why">' + why + '</div>' : '') + '</div>',
        buttons: [{ label: 'Позже', onClick() { if (ret) { ret(); return false; } } },
          { label: 'Купить в RuStore - 990 ₽', onClick() { UI.buyFullAccess(ret, why); return false; } }],
        onClose: ret || undefined });
    }
  };
  const dlgBody = {
    querySelector(sel) {
      if (!cur) return null;
      const want = sel.split(',').map((x) => x.trim().replace(/^\./, ''));
      const hit = want.some((c) => new RegExp('class="' + c + '[" ]').test(cur.body || ''));
      if (!hit) return null;
      if (!anchors.has(cur)) { const d = cur; anchors.set(d, { get isConnected() { return cur === d; } }); }
      return anchors.get(cur);
    }
  };
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, style: {}, querySelector() { return null; } });
  const ctx = {
    console, Promise, JSON, Date, Math, Object, Array, String, Number, Error, Buffer, RegExp,
    setTimeout, clearTimeout, setInterval, clearInterval,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { getElementById: (id) => (id === 'dlgBody' ? dlgBody : el()), addEventListener() {}, visibilityState: 'visible' },
    isNativeApp: () => true,
    NativePlugins: { RuStorePay: pl, App: { addListener(ev, fn) { if (ev === 'resume') calls.resumeListeners.push(fn); } } },
    Access: { PAY: o.pay !== false, FULL: false },
    UI
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  // PAY_WWW_ROOT - прогнать те же тесты на другой копии www (пруф «тест красный на старом коде»)
  const W = process.env.PAY_WWW_ROOT || ROOT;
  ['www/pay-config.js', 'www/pay.js', 'www/purchase.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(W, f), 'utf8'), ctx, { filename: f }));
  if (ctx.UI.purchaseTimings) ctx.UI.purchaseTimings(Object.assign({ pollMs: 15, waitMs: 5000, ownsMs: 150, restoreMs: 150, resumeGapMs: 0, queueMs: 10 }, o.timings || {}));
  const w = {
    ctx, pl, calls, opened, UI: ctx.UI, Pay: ctx.Pay,
    get cur() { return cur; },
    title() { return cur ? cur.title : ''; },
    text() { return cur ? String(cur.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; },
    labels() { return cur ? Array.from(cur.buttons || [], (b) => b.label) : []; },
    titles() { return Array.from(opened, (d) => d.title); },
    click(label) {
      const d = cur; if (!d) throw new Error('нет окна, кнопка ' + label);
      const b = (d.buttons || []).find((x) => x.label.indexOf(label) === 0);
      if (!b) throw new Error('нет кнопки «' + label + '» в окне «' + d.title + '»: ' + w.labels().join(' | '));
      if (b.onClick && b.onClick() === false) return;
      UI.closeDlg();
    },
    close() { UI.closeDlg(); },
    /* «откуда пришли»: карточка категории (чужое окно) */
    card() { UI.openDlg({ title: 'Карточка', body: '<div class="cat-card"></div>', buttons: [{ label: 'Закрыть' }] }); },
    ret() { calls.ret++; w.card(); },
    resume() { calls.resumeListeners.forEach((f) => f()); },
    full() { return ctx.Pay.isPurchasedSync(); }
  };
  return w;
}
const settle = async (n) => { for (let i = 0; i < (n || 10); i++) await tick(3); };
/* ждать условия (под нагрузкой npm test таймеры опаздывают): опрос раз в 10 мс до ms */
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < (ms || 3000)) await tick(10); return cond(); };

module.exports = { world, payPlugin, tick, settle, until, rd, ROOT };
