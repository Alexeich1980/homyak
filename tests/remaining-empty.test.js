/* Т3: на старте без единого лимита метрика «Осталось» показывала глухой прочерк «—»,
   читалось как сбой. Заменяем на понятное «Лимиты нет». Движок (remaining === null без
   лимитов) уже покрыт review-fixes; здесь сторож видимого текста в renderTop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');

const WWW = path.join(__dirname, '..', 'www');
const src = (f) => fs.readFileSync(path.join(WWW, f), 'utf8');

test('движок: без лимитов remaining = null (основа пустого состояния)', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 });
  const c = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-09-05', catId: c.id, walletId: w.id });
  assert.equal(Engine.summary(S, '2026-09').remaining, null);
});

test('ui.js: пустое «Осталось» - понятный текст, а не глухой прочерк', () => {
  const u = src('ui.js');
  const rt = u.slice(u.indexOf('function renderTop'), u.indexOf('function renderTopMonth'));
  const at = rt.indexOf('s.remaining === null');
  assert.ok(at >= 0, 'в renderTop нет ветки пустого «Осталось»');
  const branch = rt.slice(at, at + 170);
  assert.ok(/'Лимиты'/.test(branch) && /'нет'/.test(branch), 'нет понятного текста «Лимиты нет»');
  assert.equal(branch.indexOf('—'), -1, 'в пустой ветке остался прочерк «—»');
});
