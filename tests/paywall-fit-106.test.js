/* paywall-fit-106.test.js - окно «Полный доступ» целиком на экране 360x640 без прокрутки
   (правило 18.10). Нашёл проход в песочнице RuStore Pay 23.10: «Купить» и «Позже» были ниже
   сгиба. Худший случай - причина сверху (упор в лимит) + строка проверки до шторки, обе темы.
   «Есть ключ» - раскрывашка: поле ключа появляется только по нажатию. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { edgePath, launchEdge, waitFor } = require('./lib/edge-cdp.js');

const ROOT = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('пейволл: ключ под раскрывашкой «Есть ключ», «Восстановить покупку» рядом, без старого списка', () => {
  const s = rd('www/edit.js');
  const pw = s.slice(s.indexOf('function paywall'), s.indexOf('function bindRestore'));
  assert.match(pw, /id="pwKeyTg" aria-expanded="false" aria-controls="pwKeyBox">Есть ключ</);
  assert.match(pw, /<div class="pw-key" id="pwKeyBox" hidden>/);
  assert.ok(pw.indexOf('pw-list') < 0 && pw.indexOf('pw-lead') < 0, 'вернулся длинный список/дублирующий заход');
  assert.match(pw, /bindKeyToggle\(\);/);
});

test('экран 360x640: «Полный доступ» без прокрутки, кнопки видны, обе темы', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    for (const th of ['', '&light']) {
      const page = await edge.open('about:blank', { width: 360, height: 640 });
      await page.goto('file:///' + path.join(ROOT, 'www', 'index.html').split(path.sep).join('/') + '?demo' + th);
      await waitFor(() => page.eval("!!window.APP_READY && typeof UI.paywall === 'function' && !!window.Pay"), 20000, 'приложение загрузилось');
      await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
      const r = JSON.parse(await page.eval(`(async () => {
        var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
        function fit() {
          var d = document.getElementById('dlg'), bs = document.querySelectorAll('#dlgBtns .btn'), last = bs[bs.length - 1];
          return { sh: d.scrollHeight, ch: d.clientHeight, btnBottom: last ? Math.round(last.getBoundingClientRect().bottom) : -1,
                   hint: !document.getElementById('pwPayHint').hidden, buttons: bs.length };
        }
        // строка проверки появляется после ответа Pay.precheck: ждём её, а не фиксированный таймер
        // (на загруженной машине 400 мс не хватало; худший случай - со строкой - проверяем всё равно)
        async function settle() { var t0 = Date.now(); await wait(400); while (document.getElementById('pwPayHint').hidden && Date.now() - t0 < 5000) await wait(100); await wait(100); }
        Access.PAY = true;
        Pay.precheck = function () { return Promise.resolve({ authorized: false, available: true }); };
        Pay.getPriceLabel = function () { return Promise.resolve('990\u00a0₽'); };
        var out = { theme: document.body.dataset.theme };
        UI.paywall();
        await settle();
        out.plain = fit();
        var box = document.getElementById('pwKeyBox');
        out.keyHidden = box.hidden;
        document.getElementById('pwKeyTg').click();
        await wait(100);
        out.keyOpen = !box.hidden && box.offsetHeight > 0;
        out.keyExp = document.getElementById('pwKeyTg').getAttribute('aria-expanded');
        UI.closeDlg(); await wait(150);
        UI.paywall(null, 'В бесплатной версии - один регулярный платёж.');
        await settle();
        out.why = fit();
        UI.closeDlg(); await wait(150);
        Access.PAY = false;
        UI.paywall();
        await wait(300);
        var d = document.getElementById('dlg');
        out.nopay = { sh: d.scrollHeight, ch: d.clientHeight };
        UI.closeDlg();
        return JSON.stringify(out);
      })()`));
      const tag = 'тема ' + (r.theme || '?') + ': ';
      for (const k of ['plain', 'why']) {
        assert.ok(r[k].hint, tag + k + ': строка проверки до шторки не показана - худший случай не проверен');
        assert.equal(r[k].buttons, 2, tag + k + ': нет кнопок «Купить»/«Позже»');
        assert.ok(r[k].sh <= r[k].ch, tag + k + ': окно прокручивается ' + r[k].sh + ' > ' + r[k].ch);
        assert.ok(r[k].btnBottom > 0 && r[k].btnBottom <= 640, tag + k + ': кнопка ниже экрана ' + r[k].btnBottom);
      }
      assert.ok(r.nopay.sh <= r.nopay.ch, tag + 'без оплаты окно прокручивается');
      assert.equal(r.keyHidden, true, tag + 'поле ключа раскрыто сразу');
      assert.equal(r.keyOpen, true, tag + '«Есть ключ» не раскрыл поле');
      assert.equal(r.keyExp, 'true', tag + 'стрелка «Есть ключ» не повернулась');
      await page.close();
    }
  } finally { await edge.close(); }
});
