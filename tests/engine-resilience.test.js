/* Стойкость движка к порченому хранилищу и мусору из сети.
   Входы из адверсариального ревью: раньше каждый ронял приложение, портил бюджет или
   молча съедал деньги. Адаптировано под автономную модель «Хомяка» (categories + limits). */
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../www/engine.js');

test('migrate: любой мусор вместо ui.order переживается', () => {
  ['no', 5, true, [], null, undefined, { inc: 'нет', exp: 7 }].forEach((bad) => {
    const S = Engine.migrate({ ver: 1, ui: { order: bad } });
    assert.ok(Array.isArray(S.ui.order.inc), 'inc не массив при order=' + JSON.stringify(bad));
    assert.ok(Array.isArray(S.ui.order.exp), 'exp не массив при order=' + JSON.stringify(bad));
  });
});

test('migrate: не бросает ни на одном мусорном входе', () => {
  const garbage = [
    null, undefined, 0, 1, '', 'строка', true, [], [1, 2, 3],
    { ver: 'нет' },
    { ui: 'нет' }, { ui: 5 }, { ui: [] },
    { wallets: 'нет' }, { wallets: [null, 5, 'x'] },
    { tx: 'нет' }, { tx: [null, 'x', {}] },
    { categories: 'нет' }, { categories: { exp: 'x', inc: 5 } },
    { limits: 'нет' }, { limits: { 'bad': 5, '2026-09': 'x' } },
    { icons: 'нет' },
    { ui: { theme: 'фиолетовая', month: 'мусор', haptics: 'да' } },
    JSON.parse('{"ver":1,"ui":{"order":"no"}}'),
  ];
  garbage.forEach((g) => {
    let S;
    assert.doesNotThrow(() => { S = Engine.migrate(g); }, 'бросок на ' + JSON.stringify(g));
    assert.equal(S.ver, 1);
    assert.ok(Array.isArray(S.wallets) && Array.isArray(S.tx), 'форма поехала на ' + JSON.stringify(g));
    assert.ok(S.ui && Array.isArray(S.ui.order.inc), 'ui поехал на ' + JSON.stringify(g));
    assert.ok(S.categories && Array.isArray(S.categories.exp) && Array.isArray(S.categories.inc));
    assert.ok(S.limits && typeof S.limits === 'object' && !Array.isArray(S.limits));
  });
});

test('migrate: нормальное состояние переживает нормализацию без потерь', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 1000, icon: 'card' });
  const eda = Engine.addCategory(S, 'exp', { name: 'Магазины', icon: 'cart' });
  Engine.setLimit(S, '2026-09', eda.id, 20000);
  const t = Engine.addTx(S, { kind: 'exp', amount: 100, catId: eda.id, walletId: w.id, date: '2026-09-05' });
  S.ui.order.exp = [eda.id];

  const out = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.equal(out.wallets.length, 1);
  assert.equal(out.wallets[0].name, 'ЕКП');
  assert.equal(out.tx.length, 1);
  assert.equal(out.tx[0].id, t.id);
  assert.equal(out.tx[0].amount, 100);
  assert.equal(out.categories.exp.length, 1);
  assert.equal(out.categories.exp[0].name, 'Магазины');
  assert.equal(Engine.catLimit(out, eda.id, '2026-09'), 20000);
  assert.deepEqual(out.ui.order.exp, [eda.id]);
});

test('parseNum: мусор больше не принимается молча', () => {
  assert.ok(Number.isNaN(Engine.parseNum('12abc')), '12abc');
  assert.ok(Number.isNaN(Engine.parseNum('1,000,50')), '1,000,50');
  assert.ok(Number.isNaN(Engine.parseNum('5.5.5')), '5.5.5');
  assert.ok(Number.isNaN(Engine.parseNum('')), 'пусто');
  assert.ok(Number.isNaN(Engine.parseNum('--5')), '--5');
  assert.ok(Number.isNaN(Engine.parseNum('1e5')), '1e5');
  assert.equal(Engine.parseNum('999'), 999);
  assert.equal(Engine.parseNum('1 200,5'), 1200.5);
  assert.equal(Engine.parseNum('−4 100'), -4100);
  assert.equal(Engine.parseNum(Engine.fmt(1234567.89)), 1234567.89);
});

test('isDate: календарь, а не шаблон', () => {
  assert.equal(Engine.isDate('2026-01-05'), true);
  assert.equal(Engine.isDate('2026-02-29'), false);
  assert.equal(Engine.isDate('2024-02-29'), true);
  assert.equal(Engine.isDate('2026-13-45'), false);
  assert.equal(Engine.isDate('2026-1-5'), false);
  assert.equal(Engine.isDate(''), false);
  assert.equal(Engine.isDate(null), false);
});

test('addTx: верхняя граница суммы', () => {
  const S = Engine.defaultState();
  assert.equal(Engine.MAX_AMOUNT, 999999999);
  const t = Engine.addTx(S, { kind: 'exp', amount: Engine.MAX_AMOUNT, catId: 'e1', date: '2026-01-05' });
  assert.equal(t.amount, Engine.MAX_AMOUNT);
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: Engine.MAX_AMOUNT + 1, catId: 'e1', date: '2026-01-05' }), /amount-max/);
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: 1e15, catId: 'e1', date: '2026-01-05' }), /amount-max/);
});

test('updateTx: патч проверяется ДО записи, состояние не портится', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'A', base: 1000 });
  w.baseTs = 0;
  const t = Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: w.id, date: '2026-01-05' });
  t.ts = 1000;
  assert.equal(Engine.walletBalance(S, w.id), 900);

  assert.throws(() => Engine.updateTx(S, t.id, { amount: -50 }), /amount/);
  assert.equal(t.amount, 100, 'сумма испортилась при броске');
  assert.equal(Engine.walletBalance(S, w.id), 900, 'баланс вырос от неудачной правки');

  assert.throws(() => Engine.updateTx(S, t.id, { amount: 1e12 }), /amount-max/);
  assert.equal(t.amount, 100);

  assert.throws(() => Engine.updateTx(S, t.id, { date: '2026-13-45' }), /date/);
  assert.equal(t.date, '2026-01-05');

  Engine.updateTx(S, t.id, { amount: 200 });
  assert.equal(t.amount, 200);
});

test('importJSON: обрезанный и подменённый бэкап отвергается', () => {
  const bad = [
    '{"app":"homyak","ver":1,"state":{"tx":"нет"}}',
    '{"app":"homyak","ver":1,"state":{"wallets":"нет","tx":[]}}',
    '{"app":"homyak","ver":1,"state":{"wallets":[],"tx":[{"id":"a","amount":"сто","date":"2026-01-05"}]}}',
    '{"app":"homyak","ver":1,"state":{"wallets":[],"tx":[{"id":"a","amount":10,"date":"2026-13-45"}]}}',
    '{"app":"homyak","ver":1,"state":{"wallets":[{"id":"","base":0}],"tx":[]}}',
    '{"app":"homyak","ver":1,"state":{"wallets":[],"tx":[],"ui":"нет"}}',
    '{"app":"homyak","ver":1,"state":{"wallets":[],"tx":[],"categories":"нет"}}',
    '{"app":"homyak","ver":1,"state":{"wallets":[],"tx":[],"limits":"нет"}}',
  ];
  bad.forEach((s) => {
    assert.throws(() => Engine.importJSON(s), /schema/, 'принят битый файл: ' + s);
  });
  // не наш файл — другая ошибка, другой текст в диалоге
  assert.throws(() => Engine.importJSON('{"app":"budget-phone","state":{}}'), /format/);
  assert.throws(() => Engine.importJSON('{"app":"другое","state":{}}'), /format/);
  assert.throws(() => Engine.importJSON('не json'), /format/);
});

test('importJSON: целый бэкап принимается', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 500 });
  const eda = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.setLimit(S, '2026-09', eda.id, 10000);
  Engine.addTx(S, { kind: 'exp', amount: 100, catId: eda.id, walletId: w.id, date: '2026-09-05' });
  const back = Engine.importJSON(Engine.exportJSON(S));
  assert.equal(back.wallets.length, 1);
  assert.equal(back.tx.length, 1);
  assert.equal(back.categories.exp.length, 1);
  assert.equal(Engine.catLimit(back, eda.id, '2026-09'), 10000);
});

test('exportJSON: пишет тег app:"homyak"', () => {
  const str = Engine.exportJSON(Engine.defaultState());
  assert.ok(str.indexOf('"app":"homyak"') >= 0, 'экспорт должен нести тег homyak');
});

test('importJSON: легаси-бэкап с тегом app:"kazna" восстанавливается', () => {
  // Файл, снятый до переименования (старое рабочее имя): импорт обязан его принять,
  // иначе бэкапы существующих клиентов не восстановятся.
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 500 });
  const eda = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.addTx(S, { kind: 'exp', amount: 100, catId: eda.id, walletId: w.id, date: '2026-09-05' });
  const legacy = JSON.stringify({ app: 'kazna', ver: 1, exportedAt: '2026-09-01T00:00:00.000Z', state: S });
  const back = Engine.importJSON(legacy);
  assert.equal(back.wallets.length, 1);
  assert.equal(back.tx.length, 1);
  assert.equal(back.categories.exp.length, 1);
});
