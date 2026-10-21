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
  assert.ok(h.indexOf('откроются в браузере') >= 0, 'нет подписи, что ссылки откроются в браузере');
  assert.ok(h.indexOf('Пользовательское соглашение') >= 0);
  assert.ok(h.indexOf('dorokhin-finance.ru') >= 0, 'пропал сайт автора');
  assert.ok(h.indexOf('Финансовый консультант Алексей Дорохин') >= 0, 'пропала строка автора');
});

test('style.css: мёртвого правила .ab-mail нет', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'style.css'), 'utf8');
  assert.equal(css.indexOf('ab-mail'), -1);
});

// 05.10.2026: почты нет во всём приложении (решение Алексея: RuStore её не требует).
test('www/: ни одного адреса почты в коде приложения', () => {
  const dir = path.join(__dirname, '..', 'www');
  const bad = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(js|html|css|json)$/.test(f)) continue;
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g);
    if (m) bad.push(f + ': ' + m.join(', '));
  }
  assert.deepEqual(bad, [], 'в приложении нашлась почта');
});

// 05.10.2026: почты нет и в юрдоках - обращения только через страницу в RuStore
// (решение Алексея: личная почта делает его оператором переписки по 152-ФЗ).
test('legal/: нет почты, контакт - страница в RuStore', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'legal', f), 'utf8');
    assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(t), false, f + ': нашлась почта');
    assert.ok(t.includes('https://www.rustore.ru/catalog/app/ru.dorokhin.homyak'), f + ': нет ссылки на RuStore');
  }
});

// Решение Алексея 05.10.2026: опция ключа в приложении есть, в юрдоках о ключе ни слова.
test('legal/: лицензионный ключ не упоминается', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'legal', f), 'utf8');
    assert.equal(/лицензионн[а-яё]* ключ|офлайн-ключ/i.test(t), false, f + ': упомянут лицензионный ключ');
  }
});

// ЗоЗПП ст.9 п.1 (06.10.2026): рядом с ОГРНИП - орган и дата госрегистрации ИП (выписка ЕГРИП).
test('legal/: при ОГРНИП указан регистрирующий орган (УФНС по Вологодской области) и дата 16.09.2026', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'legal', f), 'utf8').replace(/\s+/g, ' ');
    assert.match(t, /ОГРНИП 326350000053331, ИНН 352819731060; зарегистрирован Управлением Федеральной налоговой службы по Вологодской области 16\.09\.2026\)/, f + ': нет сведений о госрегистрации ИП рядом с ОГРНИП');
  }
});
