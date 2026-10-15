/* card-fit.test.js - карточка долга на экране телефона Алексея (OnePlus: 360 css px в ширину,
   ~720 в высоту) видна целиком: условия, напоминание, «Записать платёж», «Настроить» и строка истории -
   без прокрутки списка (Алексей 13.10: «нижняя часть скролится, хотя места достаточно»).
   В self-test (375x812) прокрутки не было и при старой жёсткой высоте 78% - поэтому проверка
   здесь, на настоящем размере. Длинная карточка кошелька при этом упирается в 90% экрана. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { edgePath, launchEdge, waitFor, sleep } = require('./lib/edge-cdp.js');

const WWW = path.resolve(__dirname, '..', 'www');

test('карточка долга на 360x720: всё без прокрутки; длинный кошелёк - не выше 90%', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    const page = await edge.open('about:blank', { width: 360, height: 720 });
    await page.goto('file:///' + path.join(WWW, 'index.html').split(path.sep).join('/'));
    await waitFor(() => page.eval('!!window.APP_READY'), 20000, 'приложение нарисовалось');
    await waitFor(() => page.eval("typeof UI.openCard === 'function' && !!window.Debts"), 20000, 'карточки и долги загрузились');
    await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
    const r = JSON.parse(await page.eval(`(async () => {
      var S = UI.S, w = S.wallets[0];
      var d = Engine.addDebt(S, { type: 'owe', name: 'Автокредит', amount: 300000, pay: 15000, day: 20, rate: 18, now: 0, date: '2026-01-01' });
      Engine.payDebt(S, { debtId: d.id, walletId: w.id, amount: 15000, date: Engine.today() });
      UI.save(); UI.render();
      UI.openCard({ kind: 'debt', id: d.id });
      await new Promise(function (ok) { setTimeout(ok, 400); });
      var l = document.getElementById('cardList');
      var debt = { sh: l.scrollHeight, ch: l.clientHeight, remind: !!document.getElementById('dbRemind'), pay: !!document.getElementById('dbPay'), close: !!document.getElementById('dbClose') };
      UI.closeCard();
      await new Promise(function (ok) { setTimeout(ok, 400); });
      for (var i = 0; i < 40; i++) Engine.addTx(S, { kind: 'exp', amount: 10, catId: S.categories.exp[0].id, walletId: w.id, date: Engine.today() });
      UI.save(); UI.render();
      UI.openCard({ kind: 'wallet', id: w.id });
      await new Promise(function (ok) { setTimeout(ok, 400); });
      var card = document.getElementById('card').getBoundingClientRect().height;
      return JSON.stringify({ debt: debt, walletCard: card, vh: innerHeight });
    })()`));
    assert.ok(r.debt.remind && r.debt.pay, 'в карточке нет напоминания или «Записать платёж» - тест не про то: ' + JSON.stringify(r.debt));
    assert.ok(!r.debt.close, 'вернулась кнопка «Долг погашен» при остатке (дубль, решение 14.10)');
    assert.ok(r.debt.sh <= r.debt.ch + 1, 'карточка долга прокручивается: ' + r.debt.sh + ' > ' + r.debt.ch);
    assert.ok(r.walletCard <= r.vh * 0.9 + 1, 'длинная карточка кошелька выше 90%: ' + r.walletCard);
    await sleep(100);
  } finally { await edge.close(); }
});

// 14.10: чип «Весь остаток X ₽» на экране суммы платежа по долгу. На 320x640 чип вместе с разовой
// подсказкой про калькулятор обрезали саму сумму (qa 14.10) - здесь подсказки нет, сумма и чип
// видны целиком.
test('экран суммы платежа по долгу на 320x640: сумма и «Весь остаток» не обрезаны', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    const page = await edge.open('about:blank', { width: 320, height: 640 });
    await page.goto('file:///' + path.join(WWW, 'index.html').split(path.sep).join('/'));
    await waitFor(() => page.eval('!!window.APP_READY'), 20000, 'приложение нарисовалось');
    await waitFor(() => page.eval("typeof UI.openAmount === 'function' && !!window.Debts"), 20000, 'экран суммы и долги загрузились');
    await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
    const r = JSON.parse(await page.eval(`(async () => {
      var S = UI.S, w = S.wallets[0];
      var d = Engine.addDebt(S, { type: 'owe', name: 'Ипотека', amount: 2381913.75, pay: 32000, day: 15, rate: 11.5, now: 0, date: '2026-01-01' });
      S.ui.hints = true; S.ui.hintsDismissed = {};   // разовая подсказка экрана суммы ещё не погашена
      UI.save(); UI.render();
      UI.openAmount({ kind: 'debtpay', debtId: d.id, walletId: w.id });
      await new Promise(function (ok) { setTimeout(ok, 300); });
      var hint0 = !document.getElementById('amHint').hidden;   // сразу после открытия, до касания чипа
      document.getElementById('amAll').click();
      await new Promise(function (ok) { setTimeout(ok, 100); });
      var num = document.querySelector('.am-num'), nr = num.getBoundingClientRect();
      var e = document.getElementById('amExpr').getBoundingClientRect(), a = document.getElementById('amAll').getBoundingClientRect();
      var out = { hint: hint0 || !document.getElementById('amHint').hidden, chip: !document.getElementById('amAll').hidden, numTop: nr.top, numBottom: nr.bottom, exprTop: e.top, exprBottom: e.bottom, chipTop: a.top, chipBottom: a.bottom };
      // второй путь: «+» без долга (подсказка видна), долг выбран фишкой на экране суммы - чип
      // появился, подсказка ушла
      UI.closeAmount();
      UI.openAmount({ kind: 'debtpay', walletId: w.id });
      out.hintNoDebt = !document.getElementById('amHint').hidden;
      document.querySelector('#amTo .am-pick').click();
      await new Promise(function (ok) { setTimeout(ok, 100); });
      document.querySelector('#dlgBody .wtile[data-id="' + d.id + '"]').click();
      await new Promise(function (ok) { setTimeout(ok, 100); });
      out.chipPicked = !document.getElementById('amAll').hidden;
      out.hintPicked = !document.getElementById('amHint').hidden;
      return JSON.stringify(out);
    })()`));
    assert.ok(r.chip, 'нет чипа «Весь остаток» - тест не про то');
    assert.ok(!r.hint, 'подсказка про калькулятор вместе с чипом - на 640 они обрезают сумму');
    assert.ok(r.exprTop >= r.numTop - 1 && r.exprBottom <= r.chipTop + 1, 'сумма обрезана или под чипом: ' + JSON.stringify(r));
    assert.ok(r.chipBottom <= r.numBottom + 1, 'чип обрезан: ' + JSON.stringify(r));
    assert.ok(r.hintNoDebt && r.chipPicked, 'второй путь не про то (подсказка без долга / чип после выбора): ' + JSON.stringify(r));
    assert.ok(!r.hintPicked, 'долг выбран на экране суммы - подсказка осталась вместе с чипом');
  } finally { await edge.close(); }
});
