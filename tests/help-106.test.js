/* help-106.test.js - 1.0.6 окно «Как пользоваться» (ui.js openHelp, стили #dlg.dlg-howto):
   ревью «сломать» Н4 (23.10) - со всеми свёрнутыми темами окно прокручивалось на 360x640 (574/549).
   Строки тем уплотнены, но не ниже 32 px (под палец). Проверка - настоящий экран 360x640 в Edge,
   обе темы. Остальное про инструкцию (темы, тексты, одна открыта, «Назад») - self-test www/selftest.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { edgePath, launchEdge, waitFor, sleep } = require('./lib/edge-cdp.js');

const ROOT = path.resolve(__dirname, '..');

test('экран 360x640: «Как пользоваться» со свёрнутыми темами - без прокрутки, строка темы не ниже 32 px, обе темы', { skip: edgePath() ? false : 'нет Edge' }, async () => {
  const edge = await launchEdge();
  try {
    for (const th of ['', '&light']) {
      const page = await edge.open('about:blank', { width: 360, height: 640 });
      await page.goto('file:///' + path.join(ROOT, 'www', 'index.html').split(path.sep).join('/') + '?demo' + th);
      await waitFor(() => page.eval("!!window.APP_READY && !!document.getElementById('mAbout')"), 20000, 'приложение загрузилось');
      await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); return 1; })()`);
      const r = JSON.parse(await page.eval(`(async () => {
        var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
        document.getElementById('mAbout').click(); await wait(200);
        var aboutLook = getComputedStyle(document.getElementById('dlgTitle')).color + '|' + getComputedStyle(document.getElementById('dlg')).marginTop;
        document.getElementById('abHowto').click(); await wait(300);
        var helpLook = getComputedStyle(document.getElementById('dlgTitle')).color + '|' + getComputedStyle(document.getElementById('dlg')).marginTop;
        var d = document.getElementById('dlg'), qa = document.querySelectorAll('#dlgBody details.ab-qa');
        var hs = [].map.call(qa, function (x) { return x.querySelector('summary').getBoundingClientRect().height; });
        return JSON.stringify({ theme: document.body.dataset.theme, title: document.getElementById('dlgTitle').textContent,
          sh: d.scrollHeight, ch: d.clientHeight, n: qa.length, open: [].some.call(qa, function (x) { return x.open; }), minH: Math.min.apply(null, hs), aboutLook: aboutLook, helpLook: helpLook });
      })()`));
      const tn = th ? 'светлая' : 'тёмная';
      assert.equal(r.title, 'Как пользоваться');
      assert.equal(r.n, 11, 'тем в инструкции');
      // проход по USB 23.10: класс окна совпадал с подсказкой .dlg-help (серый мелкий текст) - заголовок
      // «Как пользоваться» был серым. Окно инструкции выглядит как «О приложении».
      assert.equal(r.helpLook, r.aboutLook, tn + ' тема: заголовок/отступ окна инструкции не как у «О приложении»');
      assert.equal(r.open, false, 'тема открыта сразу');
      assert.ok(r.sh <= r.ch + 1, tn + ' тема: свёрнутое окно «Как пользоваться» прокручивается: ' + r.sh + ' > ' + r.ch);
      assert.ok(r.minH >= 32, tn + ' тема: строка темы ниже 32 px - трудно попасть пальцем: ' + r.minH);
      assert.deepEqual(page.logs, [], 'ошибки в консоли: ' + page.logs.join(' | '));
      page.close();
    }
    await sleep(50);
  } finally { await edge.close(); }
});
