/* csp-store.test.js - 1.0.3: стор-сборка (та же чистая копия, что едет в APK: build-lib makeShip
   {store}) запускается в headless Edge под своей CSP с connect-src 'none':
     - приложение рисуется, меню и «Обновление» работают, нарушений CSP нет (локальным файлам
       сеть не нужна, files.json стор не читает);
     - чужой адрес и свой сайт fetch не достаёт (политика действует);
     - «Проверить» в сторе не ходит в сеть: без плагина RuStore - честное окно. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../build-lib.js');
const { edgePath, launchEdge, serveStatic, waitFor, sleep } = require('./lib/edge-cdp.js');

const WWW = path.resolve(__dirname, '..', 'www');

test('стор-сборка под CSP connect-src \'none\': запуск без нарушений, сеть веб-части закрыта', { skip: edgePath() ? false : 'нет Edge', timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-store-csp-'));
  const ship = path.join(dir, 'ship');
  L.makeShip(WWW, ship, { release: true, store: true });
  L.writeFilesJson(ship, null, '0');
  const srv = await serveStatic(path.resolve(ship));
  const edge = await launchEdge();
  try {
    const page = await edge.open('about:blank', { width: 360, height: 640 });
    const csp = [];
    await page.send('Log.enable').catch(() => {});
    page.ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (e) { return; }
      const t = (m.params && m.params.entry && m.params.entry.text) ||
        (m.method === 'Runtime.consoleAPICalled' && m.params.args ? m.params.args.map((a) => a.value || a.description || '').join(' ') : '');
      if (t && /Content Security Policy/i.test(t)) csp.push(String(t).slice(0, 200));
    });
    // file://, а не localhost: на машине разработчика AdGuard переписывает CSP страниц,
    // которые идут через http (дописывает свой connect-src) - проверка врала бы
    await page.goto('file:///' + path.join(ship, 'index.html').split(path.sep).join('/'));
    await waitFor(() => page.eval('!!window.APP_READY'), 20000, 'стор-сборка нарисовалась');
    const flags = await page.eval('JSON.stringify({ store: Access.STORE, full: Access.FULL, csp: document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\').content })');
    const f = JSON.parse(flags);
    assert.equal(f.store, true);
    assert.equal(f.full, false);
    assert.match(f.csp, /connect-src 'none'/);
    // онбординг, меню, «Обновление» → «Проверить»: без плагина RuStore - честное окно
    await page.eval(`(() => { var ob = document.getElementById('onboard'); if (ob && !ob.hidden) document.getElementById('obDone').click(); UI.openMenu(); return 1; })()`);
    await sleep(400);
    await page.eval(`(() => { document.getElementById('mUpdate').click(); return 1; })()`);
    await waitFor(() => page.eval(`(() => { var b = document.getElementById('dlgBtns').lastChild; return !!b && b.textContent === 'Проверить'; })()`), 5000, 'окно «Обновление» с «Проверить»');
    await page.eval(`(() => { document.getElementById('dlgBtns').lastChild.click(); return 1; })()`);
    await sleep(800);
    const body = await page.eval(`document.getElementById('dlgBody').textContent`);
    assert.match(body, /нет приложения RuStore/, 'стор без плагина: ' + body);
    await sleep(1800);   // подтверждение запуска (confirmBoot) и недельная проверка успели отработать
    assert.deepEqual(csp, [], 'стор-сборка наткнулась на свою CSP: ' + csp.join(' | '));
    // политика действует: ни свой сайт, ни чужой fetch не достаёт
    const probe = await page.eval(`Promise.all(['https://www.dorokhin-finance.ru/homyak-store/update.json', 'https://example.com/'].map(function (u) {
      return fetch(u).then(function () { return 'open'; }, function () { return 'closed'; });
    })).then(function (r) { return r.join(','); })`);
    assert.equal(probe, 'closed,closed');
    await sleep(200);
    assert.ok(csp.length >= 2, 'попытки сети не отмечены как нарушение CSP');
  } finally {
    await edge.close(); await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
