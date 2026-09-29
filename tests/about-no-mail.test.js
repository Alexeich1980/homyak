/* about-no-mail.test.js - заслон: в окне «О приложении» нет почты автора
   (убрана по решению Алексея), но ссылки на юрдоки (требование RuStore) на месте. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'www', 'ui.js'), 'utf8');

function aboutHandler() {
  const start = ui.indexOf("$('mAbout')");
  assert.ok(start >= 0, 'не найден обработчик $(\'mAbout\') в ui.js');
  const end = ui.indexOf('\n});', start);
  assert.ok(end > start, 'не найден конец обработчика «О приложении»');
  return ui.slice(start, end);
}

test('«О приложении»: нет почты (mailto, avdorohin@)', () => {
  const h = aboutHandler();
  assert.equal(/mailto/i.test(h), false, 'в «О приложении» осталась mailto-ссылка');
  assert.equal(h.indexOf('avdorohin@'), -1, 'в «О приложении» остался адрес почты');
  assert.equal(h.indexOf('ab-mail'), -1, 'в «О приложении» остался класс ab-mail');
});

test('«О приложении»: юрдоки и сайт на месте', () => {
  const h = aboutHandler();
  assert.ok(h.indexOf("data-ext=\"' + PRIVACY_URL + '\"") >= 0, 'пропала ссылка на Политику (PRIVACY_URL)');
  assert.ok(h.indexOf("data-ext=\"' + TERMS_URL + '\"") >= 0, 'пропала ссылка на Соглашение (TERMS_URL)');
  assert.ok(h.indexOf('Политика конфиденциальности') >= 0);
  assert.ok(h.indexOf('Пользовательское соглашение') >= 0);
  assert.ok(h.indexOf('dorokhin-finance.ru') >= 0, 'пропал сайт автора');
  assert.ok(h.indexOf('Финансовый консультант Алексей Дорохин') >= 0, 'пропала строка автора');
});

test('style.css: мёртвого правила .ab-mail нет', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'style.css'), 'utf8');
  assert.equal(css.indexOf('ab-mail'), -1);
});
