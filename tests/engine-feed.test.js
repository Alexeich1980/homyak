/* Лента операций по дням (вкладка «Лента» в «Аналитике»): группировка, порядок,
   изменение дня и остаток на конец дня. Всё считает движок — экран только печатает. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../www/engine.js');

// Кошельки с baseTs = 0: все операции «живые», ни одна не заморожена.
// Категории в лентовых тестах не нужны (feedByDay/txDelta/walletsTotal их не читают),
// операции строятся вручную через tx() с произвольными catId.
function seeded() {
  const S = Engine.defaultState();
  S.wallets = [
    { id: 'w1', name: 'Т-Банк', icon: 'card', color: 'yellow', base: 100000, baseTs: 0, order: 0, hidden: false },
    { id: 'w2', name: 'Запас', icon: 'cash', color: 'green', base: 50000, baseTs: 0, order: 1, hidden: false }
  ];
  return S;
}

// Операция с заданным ts и датой: порядок внутри дня строится именно по ts, а даты
// в тесте зафиксированы календарём (addTx не пустил бы «вперёд» и тест зависел бы от
// того, в какой день его запускают).
function tx(S, o, ts) {
  const t = { id: 't' + (S.tx.length + 1), kind: o.kind, amount: o.amount, date: o.date, ts: ts,
    catId: o.catId || null, walletId: o.walletId || null, toWalletId: o.toWalletId || null,
    tags: [], synced: false };
  S.tx.push(t);
  return t;
}

test('feedByDay: дни идут сверху вниз от новых к старым', () => {
  const S = seeded();
  tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-09-01' }, 10);
  tx(S, { kind: 'exp', amount: 200, catId: 'e1', walletId: 'w1', date: '2026-09-05' }, 20);
  tx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: 'w1', date: '2026-09-03' }, 30);
  const days = Engine.feedByDay(S, '2026-09');
  assert.deepEqual(days.map(d => d.date), ['2026-09-05', '2026-09-03', '2026-09-01']);
  assert.deepEqual(days.map(d => d.rows.length), [1, 1, 1]);
});

test('feedByDay: внутри дня новые операции сверху (по ts)', () => {
  const S = seeded();
  const a = tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-09-03' }, 10);
  const b = tx(S, { kind: 'exp', amount: 200, catId: 'e2', walletId: 'w1', date: '2026-09-03' }, 30);
  const c = tx(S, { kind: 'inc', amount: 300, catId: 'i1', walletId: 'w1', date: '2026-09-03' }, 20);
  const days = Engine.feedByDay(S, '2026-09');
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].rows.map(r => r.id), [b.id, c.id, a.id]);
});

test('feedByDay: чужие месяцы в ленту не попадают', () => {
  const S = seeded();
  tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-08-31' }, 10);
  tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-10-01' }, 20);
  tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-09-30' }, 30);
  const days = Engine.feedByDay(S, '2026-09');
  assert.deepEqual(days.map(d => d.date), ['2026-09-30']);
});

test('feedByDay: пустой месяц — пустая лента', () => {
  const S = seeded();
  tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-09-02' }, 10);
  assert.deepEqual(Engine.feedByDay(S, '2026-11'), []);
});

test('feedByDay: изменение дня = доход минус расход, перевод даёт ноль', () => {
  const S = seeded();
  tx(S, { kind: 'exp', amount: 3599, catId: 'e1', walletId: 'w1', date: '2026-09-03' }, 10);
  tx(S, { kind: 'exp', amount: 5720, catId: 'e2', walletId: 'w1', date: '2026-09-03' }, 20);
  tx(S, { kind: 'transfer', amount: 10000, walletId: 'w2', toWalletId: 'w1', date: '2026-09-03' }, 30);
  tx(S, { kind: 'inc', amount: 50000, catId: 'i1', walletId: 'w1', date: '2026-09-02' }, 40);
  const days = Engine.feedByDay(S, '2026-09');
  assert.equal(days[0].change, -(3599 + 5720));
  assert.equal(days[1].change, 50000);
});

test('feedByDay: остаток на конец дня = сегодняшний минус всё, что было позже', () => {
  const S = seeded();
  const total0 = Engine.walletsTotal(S);            // 150 000
  assert.equal(total0, 150000);
  tx(S, { kind: 'exp', amount: 1000, catId: 'e1', walletId: 'w1', date: '2026-09-02' }, 10);
  tx(S, { kind: 'inc', amount: 5000, catId: 'i1', walletId: 'w1', date: '2026-09-04' }, 20);
  tx(S, { kind: 'exp', amount: 500, catId: 'e2', walletId: 'w2', date: '2026-09-06' }, 30);
  const now = Engine.walletsTotal(S);               // 150 000 − 1000 + 5000 − 500
  assert.equal(now, 153500);
  const days = Engine.feedByDay(S, '2026-09');
  assert.deepEqual(days.map(d => d.date), ['2026-09-06', '2026-09-04', '2026-09-02']);
  assert.equal(days[0].balanceEnd, 153500);
  assert.equal(days[1].balanceEnd, 154000);         // до траты 6-го
  assert.equal(days[2].balanceEnd, 149000);         // до дохода 4-го
});

test('feedByDay: перевод между кошельками остаток не двигает', () => {
  const S = seeded();
  tx(S, { kind: 'transfer', amount: 20000, walletId: 'w1', toWalletId: 'w2', date: '2026-09-05' }, 10);
  tx(S, { kind: 'exp', amount: 1000, catId: 'e1', walletId: 'w1', date: '2026-09-02' }, 20);
  const days = Engine.feedByDay(S, '2026-09');
  assert.equal(days[0].change, 0);
  assert.equal(days[0].balanceEnd, 149000);
  assert.equal(days[1].balanceEnd, 149000);         // перевод позже ничего не изменил
});

test('feedByDay: замороженная операция (ts < baseTs) остаток не двигает', () => {
  const S = seeded();
  S.wallets[0].base = 100000;
  S.wallets[0].baseTs = 5000;                       // «Изменить баланс» после старых операций
  tx(S, { kind: 'exp', amount: 700, catId: 'e1', walletId: 'w1', date: '2026-09-01' }, 1000);  // заморожена
  tx(S, { kind: 'exp', amount: 300, catId: 'e1', walletId: 'w1', date: '2026-09-04' }, 9000);  // живая
  assert.equal(Engine.walletsTotal(S), 149700);
  const days = Engine.feedByDay(S, '2026-09');
  assert.equal(days[0].balanceEnd, 149700);         // 4-е: всё уже учтено
  assert.equal(days[1].balanceEnd, 150000);         // 1-е: живая трата 4-го ещё не случилась
  assert.equal(days[1].change, -700);               // в «изменение» дня заморозка всё равно входит
});

test('feedByDay: скрытый кошелёк в общий остаток не входит', () => {
  const S = seeded();
  S.wallets[1].hidden = true;                       // «Запас» с 50 000 спрятан
  tx(S, { kind: 'exp', amount: 1000, catId: 'e1', walletId: 'w1', date: '2026-09-03' }, 10);
  assert.equal(Engine.walletsTotal(S), 99000);
  assert.equal(Engine.feedByDay(S, '2026-09')[0].balanceEnd, 99000);
});

test('feedByDay: подпись дня — день недели, число и месяц', () => {
  const S = seeded();
  tx(S, { kind: 'exp', amount: 10, catId: 'e1', walletId: 'w1', date: '2026-09-03' }, 10);
  assert.equal(Engine.feedByDay(S, '2026-09')[0].label, 'ЧТ, 3 сентября');
});

test('dayLabel: все дни недели и месяцы по-русски', () => {
  assert.equal(Engine.dayLabel('2026-09-03'), 'ЧТ, 3 сентября');
  assert.equal(Engine.dayLabel('2026-09-06'), 'ВС, 6 сентября');
  assert.equal(Engine.dayLabel('2026-01-01'), 'ЧТ, 1 января');
  assert.equal(Engine.dayLabel('2026-12-31'), 'ЧТ, 31 декабря');
  assert.equal(Engine.dayLabel('2026-05-11'), 'ПН, 11 мая');
  assert.equal(Engine.dayLabel('мусор'), 'мусор');
});

test('txDelta: расход, доход и перевод двигают общий остаток по правилам walletBalance', () => {
  const S = seeded();
  const e = tx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: 'w1', date: '2026-09-02' }, 10);
  const i = tx(S, { kind: 'inc', amount: 200, catId: 'i1', walletId: 'w1', date: '2026-09-02' }, 20);
  const tr = tx(S, { kind: 'transfer', amount: 300, walletId: 'w1', toWalletId: 'w2', date: '2026-09-02' }, 30);
  assert.equal(Engine.txDelta(S, e), -100);
  assert.equal(Engine.txDelta(S, i), 200);
  assert.equal(Engine.txDelta(S, tr), 0);
  S.wallets[1].hidden = true;                       // перевод «в никуда»: деньги ушли из видимых
  assert.equal(Engine.txDelta(S, tr), -300);
});

test('ui.analyticsView: по умолчанию выбор (null), чужое значение чинится', () => {
  assert.equal(Engine.defaultState().ui.analyticsView, null);
  assert.equal(Engine.migrate({ ui: { analyticsView: 'feed' } }).ui.analyticsView, 'feed');
  assert.equal(Engine.migrate({ ui: { analyticsView: 'summary' } }).ui.analyticsView, 'summary');
  assert.equal(Engine.migrate({ ui: { analyticsView: 'ерунда' } }).ui.analyticsView, null);
  assert.equal(Engine.migrate({ ui: {} }).ui.analyticsView, null);
});

test('ui.hints и hintsDismissed: по умолчанию вкл и пустой набор', () => {
  assert.equal(Engine.defaultState().ui.hints, true);
  assert.deepEqual(Engine.defaultState().ui.hintsDismissed, {});
  assert.equal(Engine.migrate({ ui: { hints: false } }).ui.hints, false);
  assert.equal(Engine.migrate({ ui: { hints: 'да' } }).ui.hints, true);
  assert.deepEqual(Engine.migrate({ ui: { hintsDismissed: 'мусор' } }).ui.hintsDismissed, {});
  assert.deepEqual(Engine.migrate({ ui: { hintsDismissed: { mainDrag: true } } }).ui.hintsDismissed, { mainDrag: true });
});

test('txOfWallet с месяцем: только операции этого месяца', () => {
  const S = Engine.defaultState();
  S.startYM = '2026-01';
  const w = Engine.addWallet(S, { name: 'A', base: 0 });
  Engine.addTx(S, { kind: 'exp', amount: 10, catId: 'e1', walletId: w.id, date: '2026-01-05' });
  Engine.addTx(S, { kind: 'exp', amount: 20, catId: 'e1', walletId: w.id, date: '2026-02-05' });
  Engine.addTx(S, { kind: 'inc', amount: 30, catId: 'i1', walletId: w.id, date: '2026-01-20' });
  assert.equal(Engine.txOfWallet(S, w.id).length, 3, 'без месяца — все');
  assert.equal(Engine.txOfWallet(S, w.id, '2026-01').length, 2, 'за январь — две');
  assert.equal(Engine.txOfWallet(S, w.id, '2026-02').length, 1, 'за февраль — одна');
  assert.equal(Engine.txOfWallet(S, w.id, '2026-03').length, 0, 'за март — ноль');
});

test('walletsTotal совпадает с summary.balance', () => {
  const S = seeded();
  tx(S, { kind: 'exp', amount: 1234.5, catId: 'e1', walletId: 'w1', date: '2026-09-02' }, 10);
  assert.equal(Engine.summary(S, '2026-09').balance, Math.round(Engine.walletsTotal(S)));
});
