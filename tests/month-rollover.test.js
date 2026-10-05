/* month-rollover.test.js — главный экран начинает новый месяц с нуля (RuStore-«Хомяк»).
   Баг 01.10.2026 (найден в личном «Хомяке», тот же код здесь): приложение на телефоне
   живёт в памяти сутками, а «текущий месяц» считался только в момент рендера. Рендер
   зовут действия хозяина, возврат из фона - нет: после полуночи экран продолжал
   показывать сентябрьский факт («Потрачено», кольца, «Осталось»).

   Проверяем на НАСТОЯЩЕМ экране (headless Edge, часовой пояс Europe/Moscow, подменённые
   часы страницы), а не вызовом той же функции:
     А. холодный старт 01.10 00:30 МСК (= 30.09 21:30 UTC) - октябрь, факт 0;
     Б. открыто 30.09 23:59, ушло в фон, вернулось 01.10 09:00 - октябрь, факт 0,
        кольца пустые; сентябрь в выборе месяца со старыми суммами; лимиты сентября
        на месте, в октябрь сами не переехали, free-гейт отвечает так же;
     В. открыта карточка категории в момент полуночи - карточка не меняет месяц,
        экран перелистывается после её закрытия;
     Г. 31.12.2026 → 01.01.2027 (смена года);
     Д. сводка подменяет месяц на время карточки - в хранилище это не попадает.
   Мутации: checkDay() ничего не делает → Б и Г красные. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { edgePath, launchEdge, serveStatic, waitFor, sleep } = require('./lib/edge-cdp.js');

const WWW = path.resolve(__dirname, '..', 'www');
const SHOTS = process.env.HOMYAK_SHOTS || '';   // папка для скриншотов QA (необязательно)

// Подменённые часы страницы: ставятся до любого скрипта приложения, переживают reload.
// window.__setNow(ms) переводит часы, дальше они идут своим ходом.
function clockScript(ms) {
  return `(function () {
    var RD = Date, base = ${ms}, t0 = RD.now();
    function now() { return base + (RD.now() - t0); }
    function FD(a, b, c, d, e, f, g) {
      if (!(this instanceof FD)) return new RD(now()).toString();
      switch (arguments.length) {
        case 0: return new RD(now());
        case 1: return new RD(a);
        default: return new RD(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
      }
    }
    FD.prototype = RD.prototype; FD.now = now; FD.UTC = RD.UTC; FD.parse = RD.parse;
    window.Date = FD;
    window.__setNow = function (m) { base = m; t0 = RD.now(); };
  })();`;
}
const MSK = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 3, mi);   // МСК = UTC+3 круглый год

const have = !!edgePath();

async function openAt(edge, url, ms) {
  const page = await edge.open('about:blank');
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Moscow' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript(ms) });
  await page.goto(url);
  await waitFor(() => page.eval('!!window.APP_READY'), 15000, 'приложение нарисовалось');
  await dismissOnboard(page);
  return page;
}
// первый запуск демо показывает приветствие поверх экрана - гасим его, как «Понятно»
function dismissOnboard(page) {
  return page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return true; })()`);
}
// то, что видно на экране
function screen(page) {
  return page.eval(`(() => {
    var num = function (s) { return Number(String(s).replace(/[^\\d-]/g, '')) || 0; };
    var rings = Array.prototype.map.call(document.querySelectorAll('#app .circle[data-kind="exp"] .ring'), function (r) { return parseFloat(r.getAttribute('data-pct')) || 0; });
    var facts = Array.prototype.map.call(document.querySelectorAll('#app .circle[data-kind="exp"] .cnum'), function (e) { return num(e.textContent); });
    return {
      spent: num(document.querySelector('#sumSpent .sv').textContent),
      left: num(document.querySelector('#sumRemaining .sv').textContent),
      label: document.getElementById('sums').getAttribute('aria-label'),
      topMonth: document.getElementById('topMonth').textContent,
      ringsFull: rings.filter(function (p) { return p > 0; }).length, rings: rings.length,
      factSum: facts.reduce(function (a, b) { return a + b; }, 0),
      ym: UI.curYM()
    };
  })()`);
}
// «ушли в фон и вернулись»: так это видит WebView на телефоне
function resume(page) {
  return page.eval(`(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); return true; })()`);
}
async function shot(page, name) {
  if (!SHOTS) return;
  await sleep(700);   // одометры и заливка колец доехали
  await page.shot(path.join(SHOTS, name));
}

test('новый месяц на главном экране начинается с нуля', { skip: have ? false : 'нет Edge', timeout: 180000 }, async (t) => {
  const srv = await serveStatic(WWW);
  const edge = await launchEdge();
  t.after(async () => { await edge.close(); await srv.close(); });
  const base = 'http://localhost:' + srv.port + '/index.html';
  // чистое хранилище: демо засевается под «сегодня» подменённых часов
  async function clean(url, ms) {
    const pg = await openAt(edge, url, ms);
    await pg.eval('localStorage.clear(), true');
    await pg.goto(url);
    await sleep(300);
    await waitFor(() => pg.eval('!!window.APP_READY'), 15000, 'старт ' + url);
    await dismissOnboard(pg);
    return pg;
  }
  let seeded = null;   // состояние с сентябрьскими операциями - для холодного старта

  await t.test('Б. открыто 30.09 23:59, фон, возврат 01.10 09:00 - октябрь с нуля, сентябрь в истории', async () => {
    const p = await clean(base + '?demo', MSK(2026, 9, 30, 23, 59));
    try {
      const sep = await screen(p);
      assert.equal(sep.ym, '2026-09');
      assert.match(sep.label, /Сентябрь 2026/);
      assert.ok(sep.spent > 0 && sep.ringsFull > 0, 'в демо сентябре должен быть факт: ' + JSON.stringify(sep));
      await shot(p, 'b1-30sep-2359.png');
      seeded = await p.eval('JSON.stringify(UI.S)');
      const gate = `JSON.stringify({ limits: UI.S.limits, w: Engine.canAddWallet(UI.S, false), e: Engine.canAddExpCat(UI.S, false), i: Engine.canAddIncCat(UI.S, false) })`;
      const gateSep = JSON.parse(await p.eval(gate));
      assert.ok(gateSep.limits['2026-09'], 'в демо у сентября есть лимиты');

      await p.eval('__setNow(' + MSK(2026, 10, 1, 9, 0) + '), true');
      await resume(p);
      const oct = await screen(p);
      await shot(p, 'b2-01oct-0900-resume.png');
      assert.match(oct.label, /Октябрь 2026/, 'после возврата 01.10 экран обязан перейти на октябрь');
      assert.equal(oct.ym, '2026-10');
      assert.equal(oct.spent, 0, '«Потрачено» в октябре 0, а на экране ' + oct.spent);
      assert.equal(oct.factSum, 0, 'факт под кольцами в октябре 0');
      assert.equal(oct.ringsFull, 0, 'кольца пустые');
      assert.ok(oct.rings > 0, 'кольца категорий на экране есть');
      assert.equal(oct.topMonth, '', 'текущий месяц - без строки «к текущему»');
      const gateOct = JSON.parse(await p.eval(gate));
      // лимиты сентября на месте, а октябрь получил их копию сам (решение 01.10.2026)
      assert.deepEqual(gateOct.limits['2026-09'], gateSep.limits['2026-09'], 'сентябрьские лимиты изменились от смены месяца');
      assert.equal(gateSep.limits['2026-10'], undefined, 'до полуночи у октября лимитов нет');
      assert.deepEqual(gateOct.limits['2026-10'], gateSep.limits['2026-09'], 'в октябрь не переехали лимиты сентября');
      assert.equal(await p.eval('JSON.parse(localStorage.getItem("homyak-demo")).limits["2026-10"] ? 1 : 0'), 1, 'перенесённые лимиты не сохранились');
      assert.deepEqual([gateOct.w, gateOct.e, gateOct.i], [gateSep.w, gateSep.e, gateSep.i], 'free-гейт отвечает так же и в новом месяце');

      // сентябрь в истории: выбор месяца → Сентябрь → старые суммы на месте
      await p.eval(`(() => { document.getElementById('sums').click(); return true; })()`);
      await waitFor(() => p.eval(`!!document.querySelector('#dlgBody .chip[data-ym="2026-09"]')`), 5000, 'выбор месяца');
      assert.equal(await p.eval(`document.querySelector('#dlgBody .chip.now').getAttribute('data-ym')`), '2026-10', 'в выборе месяца «сейчас» - октябрь');
      await p.eval(`(() => { document.querySelector('#dlgBody .chip[data-ym="2026-09"]').click(); return true; })()`);
      const back = await screen(p);
      await shot(p, 'b3-history-september.png');
      assert.equal(back.ym, '2026-09');
      assert.equal(back.spent, sep.spent, 'сентябрь в истории со старыми суммами');
      assert.match(back.topMonth, /Сентябрь 2026/);
      await p.eval(`(() => { document.querySelector('#topMonth .tm-back').click(); return true; })()`);
      assert.equal((await screen(p)).ym, '2026-10', '«к текущему» ведёт в октябрь');
    } finally { p.close(); }
  });

  await t.test('А. холодный старт 01.10 00:30 МСК (= 30.09 21:30 UTC) - октябрь', async () => {
    const at = MSK(2026, 10, 1, 0, 30);
    assert.equal(new Date(at).toISOString().slice(0, 10), '2026-09-30', 'в UTC это ещё 30 сентября');
    assert.ok(seeded, 'нужно состояние из сценария Б');
    const a = await clean(base, at);   // адрес без demo: боевой ключ хранилища, кладём сентябрь
    try {
      await a.eval(`(() => { var s = JSON.parse(${JSON.stringify(seeded)}); s.ui.month = null; localStorage.setItem(UI.KEY, JSON.stringify(s)); return true; })()`);
      await a.goto(base);
      await waitFor(() => a.eval('!!window.APP_READY && UI.S.tx.length > 0'), 15000, 'старт с сентябрьскими операциями');
      await dismissOnboard(a);
      const cold = await screen(a);
      await shot(a, 'a1-cold-01oct-0030.png');
      assert.equal(cold.ym, '2026-10', 'холодный старт 01.10 00:30 МСК - октябрь, а не UTC-сентябрь');
      assert.match(cold.label, /Октябрь 2026/);
      assert.equal(cold.spent, 0);
      assert.equal(cold.ringsFull, 0);
    } finally { a.close(); }
  });

  await t.test('В. карточка открыта в полночь - не меняет месяц, экран догоняет после закрытия', async () => {
    const a = await clean(base + '?demo', MSK(2026, 9, 30, 23, 58));
    try {
      assert.equal((await screen(a)).ym, '2026-09');
      await a.eval(`(() => { UI.openCard({ kind: 'exp', id: UI.S.categories.exp[0].id }); return true; })()`);
      await waitFor(() => a.eval(`document.getElementById('card').classList.contains('open')`), 5000, 'карточка');
      const cardBefore = await a.eval(`document.getElementById('card').textContent`);
      await a.eval('__setNow(' + MSK(2026, 10, 1, 0, 1) + '), true');
      await resume(a);
      assert.equal(await a.eval('UI.curYM()'), '2026-09', 'пока открыта карточка, месяц у неё в руках не меняется');
      assert.equal(await a.eval(`document.getElementById('card').textContent`), cardBefore, 'карточка не перерисовалась');
      await a.eval(`(() => { UI.closeCard(); return true; })()`);
      await waitFor(() => a.eval(`!document.getElementById('card').classList.contains('open')`), 5000, 'карточка закрылась');
      await resume(a);
      const after = await screen(a);
      assert.equal(after.ym, '2026-10', 'карточку закрыли - экран перешёл на октябрь');
      assert.equal(after.spent, 0);
    } finally { a.close(); }
  });

  await t.test('Д. месяц сводки на время карточки не попадает в хранилище', async () => {
    const a = await clean(base + '?demo', MSK(2026, 10, 1, 10, 0));
    try {
      await a.eval(`(() => { UI.openSummary({ kind: 'exp', view: 'summary', ym: '2026-09' }); return true; })()`);
      assert.ok(await a.eval(`(() => { var r = document.querySelector('#smBody .sm-row'); if (!r) return false; r.click(); return true; })()`), 'строка сводки');
      const taken = await a.eval(`(() => { UI.save(); return { mem: UI.S.ui.month, disk: JSON.parse(localStorage.getItem(UI.KEY)).ui.month }; })()`);
      assert.equal(taken.mem, '2026-09', 'сценарий: карточка из сводки сентября держит месяц в памяти');
      assert.equal(taken.disk, null, 'временный месяц сводки не должен сохраняться: вылет приложения оставил бы экран на нём навсегда (' + JSON.stringify(taken) + ')');
    } finally { a.close(); }
  });

  await t.test('Г. 31.12.2026 23:59 → 01.01.2027 - январь с нуля', async () => {
    const g = await clean(base + '?demo', MSK(2026, 12, 31, 23, 59));
    try {
      const dec = await screen(g);
      assert.equal(dec.ym, '2026-12');
      assert.ok(dec.spent > 0);
      await g.eval('__setNow(' + MSK(2027, 1, 1, 0, 5) + '), true');
      await resume(g);
      const jan = await screen(g);
      await shot(g, 'g1-01jan-2027.png');
      assert.match(jan.label, /Январь 2027/, 'новый год - январь 2027');
      assert.equal(jan.ym, '2027-01');
      assert.equal(jan.spent, 0);
      assert.equal(jan.ringsFull, 0);
    } finally { g.close(); }
  });
});
