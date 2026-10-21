/* Т1: кнопочный путь записи операции (кнопка «+» вместо только-drag).
   У кнопки нет неявных источника/цели - лист суммы получает выбор кошелька и категории.
   Engine.amountReady - гейт кнопки «Подтвердить»: пока концы не выбраны, писать нельзя.
   Поведенческая часть: операция, собранная кнопочным путём, двигает баланс и сводку
   ровно так же, как drag'ом (тот же Engine.addTx, та же форма op, что у resolveDrop). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');

const WWW = path.join(__dirname, '..', 'www');
const src = (f) => fs.readFileSync(path.join(WWW, f), 'utf8');

// ---------- гейт готовности листа суммы ----------
test('amountReady: расход и доход требуют и кошелёк, и категорию', () => {
  assert.equal(Engine.amountReady({ kind: 'exp' }), false, 'пустой расход не готов');
  assert.equal(Engine.amountReady({ kind: 'exp', walletId: 'w1' }), false, 'без категории');
  assert.equal(Engine.amountReady({ kind: 'exp', catId: 'e1' }), false, 'без кошелька');
  assert.equal(Engine.amountReady({ kind: 'exp', walletId: 'w1', catId: 'e1' }), true, 'оба конца выбраны');
  assert.equal(Engine.amountReady({ kind: 'inc', catId: 'i1', walletId: 'w1' }), true, 'доход: источник + кошелёк');
  assert.equal(Engine.amountReady({ kind: 'inc', walletId: 'w1' }), false, 'доход без источника');
});

test('amountReady: перевод требует два РАЗНЫХ кошелька', () => {
  assert.equal(Engine.amountReady({ kind: 'transfer', walletId: 'w1' }), false, 'без второго кошелька');
  assert.equal(Engine.amountReady({ kind: 'transfer', walletId: 'w1', toWalletId: 'w1' }), false, 'сам на себя');
  assert.equal(Engine.amountReady({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2' }), true, 'два разных');
  assert.equal(Engine.amountReady(null), false, 'пусто');
  assert.equal(Engine.amountReady({}), false, 'без вида');
});

// ---------- поведение: кнопочный путь == drag ----------
test('кнопочный путь пишет расход как drag: баланс кошелька и факт категории меняются', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 5000 });
  const c = Engine.addCategory(S, 'exp', { name: 'Еда' });
  // ровно та форма op, что кнопочный лист кладёт в amOp (drag её строит через resolveDrop:
  // wallet -> exp = { kind:'exp', walletId, catId })
  const op = { kind: 'exp', walletId: w.id, catId: c.id };
  assert.equal(Engine.amountReady(op), true, 'выбор кошелька+категории готов к записи');
  Engine.addTx(S, Object.assign({ amount: 1500, date: '2026-09-10' }, op));
  assert.equal(Engine.walletBalance(S, w.id), 3500, 'баланс не уменьшился на трату');
  assert.equal(Engine.catFact(S, c.id, '2026-09'), 1500, 'факт категории не учёл трату');
  const s = Engine.summary(S, '2026-09');
  assert.equal(s.spent, 1500, 'сводка «потрачено» не сошлась');
});

test('кнопочный путь пишет доход и перевод корректно', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', base: 0 });
  const b = Engine.addWallet(S, { name: 'B', base: 0 });
  const inc = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  Engine.addTx(S, { kind: 'inc', amount: 100000, date: '2026-09-05', catId: inc.id, walletId: a.id });
  assert.equal(Engine.walletBalance(S, a.id), 100000);
  Engine.addTx(S, { kind: 'transfer', amount: 40000, date: '2026-09-06', walletId: a.id, toWalletId: b.id });
  assert.equal(Engine.walletBalance(S, a.id), 60000);
  assert.equal(Engine.walletBalance(S, b.id), 40000);
  assert.equal(Engine.walletsTotal(S), 100000, 'перевод не должен менять общую сумму');
});

// ---------- сторож исходников: кнопка есть и ведёт в общий лист суммы ----------
test('index.html: на главном есть заметная кнопка «+» для записи операции', () => {
  const h = src('index.html');
  assert.ok(/id="fabAdd"/.test(h), 'нет кнопки-плюса #fabAdd');
});

test('ui.js: кнопка «+» открывает выбор типа и общий лист суммы, лист требует выбор концов', () => {
  const u = src('ui.js');
  // «+» ведёт к выбору типа (Расход/Доход/Перевод), каждый открывает openAmount
  assert.ok(u.indexOf("$('fabAdd')") >= 0 && /fabAdd'\)\.addEventListener\('click', *openAdd\)/.test(u), 'кнопка «+» не привязана к openAdd');
  // выбор типа ведёт в общий лист суммы: openAdd открывает openAmount с выбранным видом
  assert.ok(/data-add-op="exp"/.test(u), 'нет входа «Расход»');
  assert.ok(/data-add-op="inc"/.test(u), 'нет входа «Доход»');
  assert.ok(/data-add-op="transfer"/.test(u), 'нет входа «Перевод»');
  assert.ok(/openAmount\(\{ kind: kind \}\)/.test(u), 'выбор типа не открывает общий лист суммы');
  // лист суммы не даёт записать неполную операцию (гейт через amountReady)
  assert.ok(u.indexOf('Engine.amountReady') >= 0, 'лист суммы не сверяется с amountReady');
  // выбор кошелька и категории переиспользует существующие списки, не новый UI
  assert.ok(u.indexOf('walletTileHtml') >= 0 && u.indexOf('listCategories') >= 0, 'пикеры не переиспользуют существующие списки');
});

test('ui.js: кнопочный путь без нативных диалогов', () => {
  const u = src('ui.js');
  const seg = u.slice(u.indexOf('function openAdd'), u.indexOf('function openAdd') + 3000);
  assert.equal(/\balert\(|\bconfirm\(|\bprompt\(/.test(seg), false, 'нативный диалог в кнопочном пути');
});
