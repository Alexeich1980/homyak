/* screen-polish.test.js - полировка интерфейса 1.0.3 на НАСТОЯЩЕМ экране (headless Edge,
   tools/qa-shots.js + tools/qa-checks.js): 360x640 и 375x812, обе темы, главный экран, меню,
   карточки, аналитика, экран суммы и окна. Замеры:
     NUMS  - ни одно число не разорвано переносом (разряды, «N ₽», «N %»);         (п. 7)
     ROWS  - ряды кнопок-вариантов: одна высота, подпись в одну строку;              (п. 9)
     MENU  - все плитки меню на одном экране без прокрутки;                           (п. 10)
     KINDS - каждая кнопка ровно одного из трёх видов и выглядит как свой вид;        (п. 11)
     DUPS  - одна сумма не стоит в двух итоговых местах экрана;                       (п. 12)
     CSP   - ни одного нарушения своей политики.
   Плюс заслоны по исходникам (то же правило, где экран не достаёт) и своя заставка (п. 13). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { edgePath } = require('./lib/edge-cdp.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// tools/qa-shots.js и tools/qa-checks.js - внутренний стенд скриншотов, в публичный репозиторий не входит
const NO_QA = !fs.existsSync(path.join(ROOT, 'tools', 'qa-shots.js')) && 'внутренний файл не входит в публичный репозиторий';
const skipEdge = () => NO_QA || (edgePath() ? false : 'нет Edge');

test('экран: числа целые, ряды ровные, меню на одном экране, три вида кнопок, одно число - одно место, без CSP', { skip: skipEdge(), timeout: 400000 }, async () => {
  const Q = require('../tools/qa-shots.js');
  const res = await Q.shootAll({});
  const bad = [];
  res.forEach((r) => r.bad.forEach((b) => bad.push(r.tag + ': ' + b)));
  assert.ok(res.length >= 80, 'мало экранов: ' + res.length);
  assert.deepEqual(bad, [], 'находки на экране:\n' + bad.join('\n'));
});

test('приветствие: карточка не наезжает на подписи «Меню / Аналитика» на 320x640, 360x640, 360x800, 412x915, обе темы', { skip: skipEdge(), timeout: 200000 }, async () => {
  const Q = require('../tools/qa-shots.js');
  const res = await Q.shootAll({ sizes: Q.ONBOARD_SIZES, only: { onboard: Q.SCREENS.onboard } });
  assert.equal(res.length, Q.ONBOARD_SIZES.length * Q.THEMES.length);
  const bad = [];
  res.forEach((r) => r.bad.forEach((b) => bad.push(r.tag + ': ' + b)));
  assert.deepEqual(bad, [], 'находки на приветствии:\n' + bad.join('\n'));
});

test('три вида кнопок по исходникам: «Отмена/Закрыть/Позже» - переход (nav), не действие', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'www')).filter((n) => /\.(js|html)$/.test(n) && n !== 'selftest.js')) {
    const s = rd('www/' + f);
    const re = /label: (?:o\.cancelLabel \|\| )?'(Отмена|Закрыть|Позже|Назад)'(?:, cls: ([^,}]+))?/g;
    let m;
    while ((m = re.exec(s))) if (!m[2] || !/^'nav'$/.test(m[2].trim())) bad.push(f + ': «' + m[1] + '» cls=' + (m[2] || 'нет'));
    const re2 = /class="btn (?!nav)[^"]*"[^>]*>(Отмена|Закрыть|Позже)</g;
    while ((m = re2.exec(s))) bad.push(f + ': «' + m[1] + '» не .btn.nav');
  }
  assert.deepEqual(bad, []);
  const css = rd('www/style.css');
  assert.match(css, /\.btn\.nav \{ background: transparent;[^}]*border: 1\.5px solid var\(--btn-nav-bd\)/);
  assert.match(css, /\.i-ico::before \{ content: "i"; \}/);
  assert.match(css, /\.info-row::after \{ content: "›"/);
});

test('одно число - одно место по исходникам: факт расходов не повторяется в заголовке блока, лимит - в строке статуса карточки', () => {
  const ui = rd('www/ui.js');
  assert.match(ui, /\$\('expHead'\)\.textContent = limited \? 'Расходы · лимит ' \+ fmt\(plan\) \+ '\\u00a0₽' : 'Расходы';/);
  const sh = rd('www/sheet.js');
  assert.ok(!/statusHtml = 'лимит <b>'|statusHtml = 'план <b>'/.test(sh), 'в строке статуса карточки снова лимит/план (он уже строкой ниже)');
});

test('своя заставка: хомяк на фоне тёмной темы, без растягивания; иконка приложения не тронута', () => {
  const st = rd('android/app/src/main/res/values/styles.xml');
  const launch = st.slice(st.indexOf('name="AppTheme.NoActionBarLaunch"'));
  assert.match(launch, /<item name="android:background">@drawable\/splash_screen<\/item>/);
  assert.match(launch, /<item name="windowSplashScreenBackground">@color\/splash_bg<\/item>/);
  const xml = rd('android/app/src/main/res/drawable/splash_screen.xml');
  assert.match(xml, /<item android:drawable="@color\/splash_bg" \/>/);
  assert.match(xml, /<bitmap android:gravity="center" android:src="@drawable\/splash_hamster" \/>/);
  const bg = /<color name="splash_bg">(#[0-9A-Fa-f]{6})<\/color>/.exec(rd('android/app/src/main/res/values/colors.xml'))[1];
  const theme = /<meta name="theme-color" content="(#[0-9A-Fa-f]{6})">/.exec(rd('www/index.html'))[1];
  assert.equal(bg.toUpperCase(), theme.toUpperCase(), 'фон заставки не совпал с фоном темы');
  assert.equal(JSON.parse(rd('capacitor.config.json')).android.backgroundColor.toUpperCase(), theme.toUpperCase());
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const f = path.join(ROOT, 'android/app/src/main/res/drawable-' + d + '/splash_hamster.png');
    assert.ok(fs.existsSync(f) && fs.readFileSync(f).subarray(0, 4).equals(sig), 'нет хомяка заставки для ' + d);
  }
  // иконка приложения - прежняя (manifest ссылается на те же mipmap)
  const man = rd('android/app/src/main/AndroidManifest.xml');
  assert.match(man, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(man, /android:roundIcon="@mipmap\/ic_launcher_round"/);
});
