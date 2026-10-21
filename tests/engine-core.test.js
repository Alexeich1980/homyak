const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../www/engine.js');

test('defaultState + migrate идемпотентен', () => {
  const S = Engine.migrate(Engine.defaultState());
  assert.equal(S.ver, 1);
  assert.deepEqual(S.wallets, []);
  assert.deepEqual(S.tx, []);
  assert.deepEqual(S.categories, { exp: [], inc: [] });
  assert.deepEqual(S.limits, {});
  const again = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.deepEqual(again, S);
});

test('migrate добивает поля у старого состояния', () => {
  const S = Engine.migrate({ ver: 1, wallets: [{ id: 'w1', name: 'Нал' }] });
  assert.equal(S.wallets[0].base, 0);
  assert.equal(S.wallets[0].hidden, false);
  assert.ok(Array.isArray(S.tx));
  assert.ok(S.ui && S.ui.theme === 'dark');
});

test('кошелёк: баланс = base + операции после baseTs', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', icon: 'card', base: 1000 });
  const w2 = Engine.addWallet(S, { name: 'Нал', icon: 'cash', base: 0 });
  Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'c1', walletId: w.id });
  Engine.addTx(S, { kind: 'inc', amount: 5000, catId: 'i1', walletId: w.id });
  Engine.addTx(S, { kind: 'transfer', amount: 200, walletId: w.id, toWalletId: w2.id });
  assert.equal(Engine.walletBalance(S, w.id), 1000 - 300 + 5000 - 200);
  assert.equal(Engine.walletBalance(S, w2.id), 200);
});

test('setWalletBase — новая точка отсчёта, старые операции не считаются', async () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', icon: 'card', base: 0 });
  Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'c1', walletId: w.id });
  await new Promise(r => setTimeout(r, 2));
  Engine.setWalletBase(S, w.id, 777);
  assert.equal(Engine.walletBalance(S, w.id), 777);
  Engine.addTx(S, { kind: 'exp', amount: 77, catId: 'c1', walletId: w.id });
  assert.equal(Engine.walletBalance(S, w.id), 700);
});

test('addTx валидирует сумму и ставит дату/ts', () => {
  const S = Engine.defaultState();
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: 0, catId: 'c', walletId: 'w' }), /amount/);
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: 'abc', catId: 'c', walletId: 'w' }), /amount/);
  const t = Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w' });
  assert.equal(t.date, Engine.today());
  assert.equal(t.synced, undefined);
  assert.ok(t.ts > 0 && t.id.length > 4);
});

// задним числом - можно, вперёд - нет: факта, которого ещё не было, в «Бюджете года»
// быть не должно
test('addTx / updateTx не пускают дату в будущее', () => {
  const S = Engine.defaultState();
  const t0 = Engine.today();
  const day = (n) => {
    const d = new Date(+t0.slice(0, 4), +t0.slice(5, 7) - 1, +t0.slice(8, 10) + n);
    return d.getFullYear() + '-' + Engine.pad2(d.getMonth() + 1) + '-' + Engine.pad2(d.getDate());
  };
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w', date: day(1) }), /date-future/);
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w', date: day(40) }), /date-future/);
  assert.throws(() => Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w', date: '2026-02-30' }), /date/);
  assert.equal(S.tx.length, 0, 'битая операция всё-таки записалась');

  const ok = Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w', date: t0 });
  assert.equal(ok.date, t0, 'сегодняшнюю дату не пустили');
  const back = Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w', date: day(-30) });
  assert.equal(back.date, day(-30), 'задним числом ставить по-прежнему можно');

  assert.throws(() => Engine.updateTx(S, ok.id, { date: day(1) }), /date-future/);
  assert.equal(Engine.findTx(S, ok.id).date, t0, 'дата испортилась после отказа');
  Engine.updateTx(S, ok.id, { date: day(-2) });
  assert.equal(Engine.findTx(S, ok.id).date, day(-2));

  assert.equal(Engine.futureDate(day(1)), true);
  assert.equal(Engine.futureDate(t0), false);
  assert.equal(Engine.futureDate(day(-1)), false);
});

test('updateTx / deleteTx / txOfWallet', () => {
  const S = Engine.defaultState();
  const a = Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'c', walletId: 'w', date: '2026-09-01' });
  const b = Engine.addTx(S, { kind: 'exp', amount: 20, catId: 'c', walletId: 'w', date: '2026-09-02' });
  Engine.updateTx(S, a.id, { amount: 15, tags: ['#кафе'] });
  assert.equal(S.tx.find(t => t.id === a.id).amount, 15);
  assert.deepEqual(Engine.txOfWallet(S, 'w').map(t => t.id), [b.id, a.id]);
  assert.equal(Engine.deleteTx(S, a.id), true);
  assert.equal(Engine.deleteTx(S, 'nope'), false);
  assert.equal(S.tx.length, 1);
});

test('deleteTx: замороженная операция (ts < baseTs) возвращает деньги в base', () => {
  const S = Engine.defaultState();
  S.startYM = '2026-01';
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 1000 });
  const w2 = Engine.addWallet(S, { name: 'Нал', base: 500 });
  w.baseTs = 5000; w2.baseTs = 5000;                 // точка отсчёта позже операций
  // замороженная трата: в balance не входит (её деньги «вшиты» в base)
  const exp = Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: w.id, date: '2026-01-05' });
  exp.ts = 1000;
  assert.equal(Engine.walletBalance(S, w.id), 1000, 'замороженная трата не должна двигать баланс');
  Engine.deleteTx(S, exp.id);
  assert.equal(Engine.walletBalance(S, w.id), 1300, 'деньги за удалённую замороженную трату не вернулись');
  // замороженный доход — в другую сторону
  const inc = Engine.addTx(S, { kind: 'inc', amount: 200, catId: 'i1', walletId: w.id, date: '2026-01-05' });
  inc.ts = 1000;
  Engine.deleteTx(S, inc.id);
  assert.equal(Engine.walletBalance(S, w.id), 1100, 'удаление замороженного дохода не убрало его из base');
  // замороженный перевод: «откуда» получает назад, «куда» теряет
  const tr = Engine.addTx(S, { kind: 'transfer', amount: 150, walletId: w.id, toWalletId: w2.id, date: '2026-01-05' });
  tr.ts = 1000;
  assert.equal(Engine.walletBalance(S, w.id), 1100, 'перевод не должен был двигать баланс (заморожен)');
  assert.equal(Engine.walletBalance(S, w2.id), 500);
  Engine.deleteTx(S, tr.id);
  assert.equal(Engine.walletBalance(S, w.id), 1250, 'откуда-кошелёк не получил перевод назад');
  assert.equal(Engine.walletBalance(S, w2.id), 350, 'куда-кошелёк не отдал перевод');
});

test('deleteTx: живую операцию (ts >= baseTs) база не трогается дважды', () => {
  const S = Engine.defaultState();
  S.startYM = '2026-01';
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 1000 });
  w.baseTs = 1000;
  const exp = Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: w.id, date: '2026-01-05' });
  exp.ts = 5000;                                      // после baseTs — живая
  assert.equal(Engine.walletBalance(S, w.id), 700);
  Engine.deleteTx(S, exp.id);
  assert.equal(Engine.walletBalance(S, w.id), 1000, 'живую удалили — база не должна была прибавиться');
});

test('повторить операцию: новая запись сегодняшним числом, оригинал цел', () => {
  const S = Engine.defaultState();
  const orig = Engine.addTx(S, { kind: 'exp', amount: 777, catId: 'e1', walletId: 'w1', date: '2026-05-05' });
  // «Повторить» = взять поля операции и записать новую с датой «сегодня»
  const copy = Engine.addTx(S, {
    kind: orig.kind, amount: orig.amount, catId: orig.catId,
    walletId: orig.walletId, toWalletId: orig.toWalletId, date: Engine.today()
  });
  assert.notEqual(copy.id, orig.id, 'повтор должен быть новой операцией, а не тем же id');
  assert.equal(copy.date, Engine.today(), 'у повтора дата не сегодня');
  assert.equal(copy.amount, 777);
  assert.equal(copy.catId, 'e1');
  assert.equal(copy.walletId, 'w1');
  // оригинал не тронут
  const back = Engine.findTx(S, orig.id);
  assert.equal(back.date, '2026-05-05', 'оригинал сдвинулся по дате');
  assert.equal(S.tx.length, 2, 'должно быть две операции: оригинал и повтор');
});

test('повторить перевод: подставляются оба кошелька', () => {
  const S = Engine.defaultState();
  const tr = Engine.addTx(S, { kind: 'transfer', amount: 500, walletId: 'w1', toWalletId: 'w2', date: '2026-04-01' });
  const copy = Engine.addTx(S, {
    kind: tr.kind, amount: tr.amount, walletId: tr.walletId,
    toWalletId: tr.toWalletId, date: Engine.today()
  });
  assert.equal(copy.kind, 'transfer');
  assert.equal(copy.walletId, 'w1');
  assert.equal(copy.toWalletId, 'w2');
  assert.equal(copy.date, Engine.today());
});

test('addTx больше не пишет метки в новую операцию', () => {
  const S = Engine.defaultState();
  const t = Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'e1', walletId: 'w1', tags: ['#x'] });
  assert.equal(t.tags, undefined, 'новая операция не должна нести поле tags');
});

test('parseTags', () => {
  assert.deepEqual(Engine.parseTags('кофе #Кафе с #дети #кафе'), ['#кафе', '#дети']);
  assert.deepEqual(Engine.parseTags(''), []);
});

test('ym / today формат', () => {
  assert.equal(Engine.ym('2026-09-14'), '2026-09');
  assert.match(Engine.today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('цвет кошелька: по умолчанию жёлтый, чужой ключ откатывается', () => {
  assert.equal(Engine.WALLET_COLORS.length, 10);
  assert.deepEqual(Engine.WALLET_COLORS.slice(0, 5), ['yellow', 'red', 'green', 'blue', 'white']);
  assert.equal(Engine.WALLET_COLOR_DEFAULT, 'yellow');
  assert.equal(Engine.walletColor('blue'), 'blue');
  assert.equal(Engine.walletColor('чужое'), 'yellow');
  assert.equal(Engine.walletColor(undefined), 'yellow');
  assert.equal(Engine.walletColor(42), 'yellow');
});

test('migrate: кошельки без цвета становятся жёлтыми, свой цвет цел', () => {
  const S = Engine.migrate({ ver: 1, wallets: [
    { id: 'w1', name: 'Старый', base: 0 },
    { id: 'w2', name: 'Синий', base: 0, color: 'blue' },
    { id: 'w3', name: 'Порченый', base: 0, color: { a: 1 } }
  ] });
  assert.deepEqual(S.wallets.map(w => w.color), ['yellow', 'blue', 'yellow']);
});

test('addWallet и updateWallet чистят цвет', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', color: 'graphite' });
  const b = Engine.addWallet(S, { name: 'B' });
  const c = Engine.addWallet(S, { name: 'C', color: 'ультрамарин' });
  assert.equal(a.color, 'graphite');
  assert.equal(b.color, 'yellow');
  assert.equal(c.color, 'yellow');
  Engine.updateWallet(S, a.id, { color: 'pink' });
  assert.equal(Engine.findWallet(S, a.id).color, 'pink');
  Engine.updateWallet(S, a.id, { color: 'нет такого' });
  assert.equal(Engine.findWallet(S, a.id).color, 'yellow');
});

test('deleteWallet: кошелёк уходит вместе со своими операциями', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'ЕКП', base: 1000 });
  const b = Engine.addWallet(S, { name: 'Нал', base: 500 });
  Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: a.id, date: '2026-03-05' });
  Engine.addTx(S, { kind: 'inc', amount: 700, catId: 'i1', walletId: a.id, date: '2026-03-06' });
  Engine.addTx(S, { kind: 'transfer', amount: 50, walletId: b.id, toWalletId: a.id, date: '2026-03-07' });
  Engine.addTx(S, { kind: 'exp', amount: 90, catId: 'e1', walletId: b.id, date: '2026-03-08' });

  assert.equal(Engine.walletTxCount(S, a.id), 3, 'перевод считается обоим кошелькам');
  assert.equal(Engine.walletTxCount(S, b.id), 2);

  const r = Engine.deleteWallet(S, a.id);
  assert.deepEqual({ id: r.id, name: r.name, removed: r.removed }, { id: a.id, name: 'ЕКП', removed: 3 });
  assert.equal(Engine.findWallet(S, a.id), null, 'кошелёк остался');
  assert.equal(S.wallets.length, 1);
  assert.equal(S.tx.length, 1, 'операции удалённого кошелька остались');
  assert.equal(S.tx[0].walletId, b.id);
  // перевод уехал вместе с кошельком, но баланс второго НЕ двинулся: эффект перевода
  // вшит в его base (500 - 50 - 90 = 360 и до удаления, и после)
  assert.equal(Engine.walletBalance(S, b.id), 360);
});

test('deleteWallet: порядок оставшихся пересобирается подряд', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A' });
  const b = Engine.addWallet(S, { name: 'B' });
  const c = Engine.addWallet(S, { name: 'C' });
  assert.deepEqual(S.wallets.map(w => w.order), [0, 1, 2]);
  Engine.deleteWallet(S, b.id);
  assert.deepEqual(S.wallets.map(w => [w.id, w.order]), [[a.id, 0], [c.id, 1]]);
});

test('deleteWallet: чужого кошелька нет — ничего не трогаем', () => {
  const S = Engine.defaultState();
  Engine.addWallet(S, { name: 'A' });
  Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'e1', walletId: S.wallets[0].id });
  assert.equal(Engine.deleteWallet(S, 'нетакого'), null);
  assert.equal(S.wallets.length, 1);
  assert.equal(S.tx.length, 1);
  assert.equal(Engine.walletTxCount(S, 'нетакого'), 0);
});

test('ui.sound: по умолчанию включён и переживает старое состояние', () => {
  assert.equal(Engine.defaultState().ui.sound, true, 'в состоянии по умолчанию звука нет');
  // состояние из версии до 0.3.0 поля не знало — оно должно появиться включённым
  const old = Engine.migrate({ ver: 1, wallets: [], tx: [], ui: { theme: 'light', haptics: false } });
  assert.equal(old.ui.sound, true);
  assert.equal(old.ui.haptics, false, 'соседняя настройка не пострадала');
  // выключённый звук так и остаётся выключенным, мусор откатывается на «вкл»
  assert.equal(Engine.migrate({ ui: { sound: false } }).ui.sound, false);
  assert.equal(Engine.migrate({ ui: { sound: 'да' } }).ui.sound, true);
});

// Волна 6: одно удаление операции убирает её ВЕЗДЕ атомарно — из S.tx, из баланса
// кошелька, из факта категории и из списка операций кошелька. Один канонический
// store S.tx, отдельного «списка на экране» нет.
test('deleteTx: операция уходит из S.tx, баланса, факта и списка кошелька разом', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 1000 });
  const a = Engine.addTx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: w.id, date: Engine.today() });
  const b = Engine.addTx(S, { kind: 'exp', amount: 200, catId: 'e1', walletId: w.id, date: Engine.today() });
  const ym = Engine.ym(Engine.today());
  assert.equal(Engine.walletBalance(S, w.id), 500, 'старт: 1000 - 300 - 200');
  assert.equal(Engine.catFact(S, 'e1', ym), 500);
  assert.equal(Engine.txOfWallet(S, w.id).length, 2);

  assert.equal(Engine.deleteTx(S, a.id), true);

  assert.equal(Engine.findTx(S, a.id), null, 'нет в S.tx');
  assert.equal(S.tx.length, 1);
  assert.equal(Engine.walletBalance(S, w.id), 800, 'баланс пересчитан: 300 вернулись');
  assert.equal(Engine.catFact(S, 'e1', ym), 200, 'факт категории пересчитан');
  assert.deepEqual(Engine.txOfWallet(S, w.id).map(t => t.id), [b.id], 'список кошелька без удалённой');
});

// Волна 6: перестановка в режиме правки не выходит за своё поле (доход только среди
// доходов и т.д.). Операции-переносы (доход→кошелёк) этой развилкой не ограничены.
test('reorderAllowed: только свой вид', () => {
  assert.equal(Engine.reorderAllowed('inc', 'inc'), true);
  assert.equal(Engine.reorderAllowed('exp', 'exp'), true);
  assert.equal(Engine.reorderAllowed('wallet', 'wallet'), true);
  assert.equal(Engine.reorderAllowed('inc', 'wallet'), false, 'доход в кошельки не переставить');
  assert.equal(Engine.reorderAllowed('inc', 'exp'), false, 'доход в расходы не переставить');
  assert.equal(Engine.reorderAllowed('wallet', 'exp'), false);
  assert.equal(Engine.reorderAllowed('', 'inc'), false);
  assert.equal(Engine.reorderAllowed(undefined, undefined), false);
});
