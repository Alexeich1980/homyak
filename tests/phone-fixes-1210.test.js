/* phone-fixes-1210.test.js - мелочи, найденные живой проверкой тестовой сборки на телефоне
   (12.10.2026). Экранные стороны (раскладка, жест, кнопка проверки) - в self-test
   (www/selftest.js), здесь - то, что проверяется без браузера.
   1) тёмная тема прятала вторую строку истории долга (.txmeta.db-meta)
   2) висячее «В» в подписях «...В 10:00»
   3) зона перелистывания ленты при переносе - 10% ширины экрана от края ЭКРАНА
   5) кнопка «Проверить напоминание» у кредитки - сразу после тумблера
   6) публичная (экран блокировки) версия уведомления кредитки - своя строка */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');

const ROOT = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = 'android/app/src/main/java/ru/dorokhin/budgetphone/';
const NBSP = String.fromCharCode(0xA0);

test('1) тёмная тема не прячет строку истории долга (.db-meta)', () => {
  const css = rd('www/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // любое правило с display:none, где селектор цепляет .txmeta без исключения .db-meta
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m, bad = [];
  while ((m = re.exec(css))) {
    if (!/display\s*:\s*none/.test(m[2])) continue;
    m[1].split(',').forEach((sel) => {
      sel = sel.trim();
      if (/\.txmeta(?![\w-])/.test(sel) && !/:not\(\.db-meta\)/.test(sel)) bad.push(sel);
    });
  }
  assert.deepStrictEqual(bad, [], 'правило прячет и строку истории долга: ' + bad.join(' | '));
  assert.match(css, /\.txmeta\.db-meta\s*\{[^}]*display:\s*block/);
});

test('2) «В 10:00»: между «В» и временем неразрывный пробел (escape), литерала U+00A0 нет', () => {
  const files = fs.readdirSync(path.join(ROOT, 'www')).filter((f) => f.endsWith('.js'));
  const hang = [], lit = [];
  files.forEach((f) => {
    const s = rd('www/' + f);
    if (s.indexOf(NBSP) >= 0) lit.push(f);
    if (f === 'selftest.js') return;   // сообщения проверок, не экран
    s.split('\n').forEach((l, i) => {
      // в строковом литерале: предлог «В»/«в» + обычный пробел + время
      if (/['"][^'"]*(^|[\s.])[Вв] \d{1,2}:\d{2}[^'"]*['"]/.test(l)) hang.push(f + ':' + (i + 1));
    });
  });
  assert.deepStrictEqual(lit, [], 'литеральный неразрывный пробел в коде');
  assert.deepStrictEqual(hang, [], 'висячее «В» перед временем');
  const d = rd('www/debts.js');
  const esc = String.fromCharCode(92) + 'u00a0';
  ['Накануне и в день возврата. В', 'Накануне и в день платежа. В', 'Накануне и в день платежа, в'].forEach((p) =>
    assert.ok(d.indexOf(p + esc + '10:00') >= 0, 'нет неразрывного пробела: ' + p));
});

test('3) край ленты при переносе - 10% ширины экрана от края экрана (dEdgeSide из ui.js)', () => {
  const ui = rd('www/ui.js');
  const head = /var D_EDGE_PAD = (\d+), D_EDGE_FRAC = ([\d.]+), D_EDGE_HOLD = (\d+);/.exec(ui);
  assert.ok(head, 'нет констант края');
  assert.strictEqual(+head[2], 0.1, 'зона края не 10%');
  const fn = /function dEdgeSide\(x, rect, vw\) \{[\s\S]*?\n\}/.exec(ui);
  assert.ok(fn, 'нет dEdgeSide');
  // eslint-disable-next-line no-new-func
  const side = new Function('D_EDGE_PAD', 'D_EDGE_FRAC', 'dViewW', fn[0] + '; return dEdgeSide;')(+head[1], +head[2], () => 400);
  // лента с отступами от краёв экрана 400 px (рамка 40..360)
  const r = { left: 40, right: 360, width: 320 };
  assert.strictEqual(side(0, r, 400), -1, 'самый левый край экрана (за рамкой ленты)');
  assert.strictEqual(side(399, r, 400), 1, 'самый правый край экрана (за рамкой ленты)');
  assert.strictEqual(side(64, r, 400), -1, 'у рамки слева');
  assert.strictEqual(side(361, r, 400), 1, 'у рамки справа');
  // рамка во весь экран: зона - 10% ширины, а не 24 px
  const full = { left: 0, right: 400, width: 400 };
  assert.strictEqual(side(38, full, 400), -1, '9,5% от левого края - уже край');
  assert.strictEqual(side(362, full, 400), 1, '9,5% от правого края - уже край');
  assert.strictEqual(side(80, full, 400), 0, '20% - не край');
  assert.strictEqual(side(200, full, 400), 0, 'середина');
  assert.strictEqual(side(10, null, 400), 0, 'без рамки');
  // за рамкой поле ищется по строке пальца (середина экрана)
  assert.match(ui, /if \(!box && vw > 0 && \(x <= vw \* D_EDGE_FRAC \|\| x >= vw \* \(1 - D_EDGE_FRAC\)\)\) box = boxUnder\(vw \/ 2, y\);/);
});

test('5) кредитка: «Проверить напоминание» не требует сохранённой карты', () => {
  const d = rd('www/debts.js');
  const m = /if \(testBuild\(\) && on([^)]*)\) h \+= '<button type="button" class="btn ghost db-test" id="' \+ pfx \+ 'CrTest">/.exec(d);
  assert.ok(m, 'нет кнопки проверки в форме кредитки');
  assert.strictEqual(m[1], '', 'кнопка ждёт сохранения карты: ' + m[1]);
  assert.match(d, /testCardReminder\(w \? w\.id : '', name\)/);
});

test('6) экран блокировки: у кредитки своя общая строка, у долга - прежняя', () => {
  const S = Engine.defaultState();
  const cc = Engine.addWallet(S, { name: 'Кредитка', base: 0 }); cc.baseTs = 0;
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 15, remind: true }, '2026-06-01');
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-06-30', walletId: cc.id, catId: food.id });
  const d = Engine.addDebt(S, { type: 'owe', name: 'Ипотека', amount: 100000, pay: 1000, day: 20, now: 0, date: '2026-06-01' });
  d.remind = true;
  const plan = Engine.reminderPlan(S, new Date(2026, 6, 1, 12).getTime(), 2);
  const card = plan.filter((e) => e.id.indexOf(cc.id + '|') === 0), debt = plan.filter((e) => e.id.indexOf(d.id + '|') === 0);
  assert.ok(card.length && debt.length);
  card.forEach((e) => assert.strictEqual(e.kind, 'credit'));
  debt.forEach((e) => assert.strictEqual(e.kind, 'debt'));

  const recv = rd(J + 'ReminderReceiver.java'), plug = rd(J + 'ReminderPlugin.java');
  assert.match(recv, /PUBLIC_TITLE_CARD = "Напоминание о платеже по кредитной карте";/);
  assert.match(recv, /PUBLIC_TITLE = "Напоминание о платеже по долгу";/);
  assert.match(recv, /return "credit"\.equals\(kind\) \? PUBLIC_TITLE_CARD : PUBLIC_TITLE;/);
  assert.match(recv, /\.setContentTitle\(publicTitle\(kind\)\)/);
  assert.match(recv, /notify\(ctx, id, [^;]*, kindOf\(e\)\);/);
  // план и проверка доносят kind до приёмника
  assert.match(plug, /x\.put\("kind", e\.optString\("kind", ""\)\);/);
  assert.match(plug, /x\.put\("kind", call\.getString\("kind", ""\)\);/);
  const dj = rd('www/debts.js');
  assert.match(dj, /function testCardReminder[\s\S]{0,400}kind: 'credit'/);
  assert.match(dj, /kind: 'debt',\s*\n\s*title: \(d\.type === 'owe'/);
});
