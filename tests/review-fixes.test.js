/* Адверсариальное ревью релиза 0.1.6 → 0.1.7: сохранность денег и гейт.
   Каждый тест - воспроизведение найденной дыры; движок чистый, DOM не нужен.
   Плюс сторожа исходников там, где логика живёт в UI (edit.js / backup.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');

const WWW = path.join(__dirname, '..', 'www');
const src = (f) => fs.readFileSync(path.join(WWW, f), 'utf8');

// ---------- 2. удаление кошелька не трогает чужие балансы ----------
test('deleteWallet: перевод A→B уходит с A, а баланс B стоит на месте', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', base: 10000 });
  const b = Engine.addWallet(S, { name: 'B', base: 0 });
  Engine.addTx(S, { kind: 'transfer', amount: 10000, walletId: a.id, toWalletId: b.id, date: '2026-09-05' });
  assert.equal(Engine.walletBalance(S, b.id), 10000);
  Engine.deleteWallet(S, a.id);
  assert.equal(S.tx.length, 0, 'перевод остался без кошелька-источника');
  assert.equal(Engine.walletBalance(S, b.id), 10000, 'деньги B пропали вместе с A');
});

test('deleteWallet: перевод B→A тоже вшивается в base B (баланс B не растёт обратно)', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', base: 0 });
  const b = Engine.addWallet(S, { name: 'B', base: 5000 });
  Engine.addTx(S, { kind: 'transfer', amount: 2000, walletId: b.id, toWalletId: a.id, date: '2026-09-05' });
  assert.equal(Engine.walletBalance(S, b.id), 3000);
  Engine.deleteWallet(S, a.id);
  assert.equal(Engine.walletBalance(S, b.id), 3000, 'после удаления A деньги B «вернулись» - двойной счёт');
});

test('deleteWallet: перевод, замороженный для B, в base B не вшивается второй раз', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', base: 0 });
  const b = Engine.addWallet(S, { name: 'B', base: 0 });
  const t = Engine.addTx(S, { kind: 'transfer', amount: 700, walletId: a.id, toWalletId: b.id, date: '2026-09-05' });
  t.ts = 1000;
  b.base = 700; b.baseTs = 5000;          // хозяин зафиксировал остаток B уже с этим переводом
  assert.equal(Engine.walletBalance(S, b.id), 700);
  Engine.deleteWallet(S, a.id);
  assert.equal(Engine.walletBalance(S, b.id), 700, 'замороженный перевод вшили дважды');
});

// ---------- 3. правка замороженной операции ----------
test('updateTx: правка замороженной траты и её удаление не удваивают деньги', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'ЕКП', base: 0 });
  const t = Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: w.id, date: '2026-09-05' });
  t.ts = 1000;
  w.base = 900; w.baseTs = 5000;          // «Изменить баланс»: 900 уже с учётом траты 100
  assert.equal(Engine.walletBalance(S, w.id), 900);
  Engine.updateTx(S, t.id, { amount: 500 });
  assert.equal(Engine.walletBalance(S, w.id), 500, 'правка замороженной суммы не двинула баланс');
  assert.ok(t.ts >= w.baseTs, 'после правки операция должна стать живой');
  Engine.deleteTx(S, t.id);
  assert.equal(Engine.walletBalance(S, w.id), 1000, 'удаление вернуло не ту сумму (ожидали 1000, не 1400)');
});

test('updateTx: перенос замороженной траты на другой кошелёк не удваивает деньги', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', base: 0 });
  const b = Engine.addWallet(S, { name: 'B', base: 0 });
  const t = Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: a.id, date: '2026-09-05' });
  t.ts = 1000;
  a.base = 900; a.baseTs = 5000;
  Engine.updateTx(S, t.id, { walletId: b.id });
  assert.equal(Engine.walletBalance(S, a.id), 1000, 'A не получил свои 100 обратно');
  assert.equal(Engine.walletBalance(S, b.id), -100, 'B не списал перенесённую трату');
  assert.equal(Engine.walletsTotal(S), 900, 'сумма денег изменилась от переноса');
});

test('updateTx: замороженный доход и перевод правятся так же честно', () => {
  const S = Engine.defaultState();
  const a = Engine.addWallet(S, { name: 'A', base: 0 });
  const b = Engine.addWallet(S, { name: 'B', base: 0 });
  const inc = Engine.addTx(S, { kind: 'inc', amount: 300, catId: 'i1', walletId: a.id, date: '2026-09-05' });
  const tr = Engine.addTx(S, { kind: 'transfer', amount: 50, walletId: a.id, toWalletId: b.id, date: '2026-09-06' });
  inc.ts = 1000; tr.ts = 1000;
  a.base = 250; a.baseTs = 5000;          // 300 - 50 уже в базе A
  b.base = 50; b.baseTs = 5000;           // 50 уже в базе B
  Engine.updateTx(S, inc.id, { amount: 400 });
  assert.equal(Engine.walletBalance(S, a.id), 350);
  Engine.updateTx(S, tr.id, { amount: 80 });
  assert.equal(Engine.walletBalance(S, a.id), 320);
  assert.equal(Engine.walletBalance(S, b.id), 80);
  Engine.deleteTx(S, tr.id);
  assert.equal(Engine.walletBalance(S, a.id), 400);
  assert.equal(Engine.walletBalance(S, b.id), 0);
});

test('updateTx: живую операцию база не трогает, ts не меняется', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'A', base: 1000 });
  w.baseTs = 0;
  const t = Engine.addTx(S, { kind: 'exp', amount: 100, catId: 'e1', walletId: w.id, date: '2026-09-05' });
  t.ts = 1000;
  Engine.updateTx(S, t.id, { amount: 200 });
  assert.equal(t.ts, 1000);
  assert.equal(w.base, 1000);
  assert.equal(Engine.walletBalance(S, w.id), 800);
  assert.equal(Engine.isFrozen(S, t), false);
});

// ---------- 5. враждебный бэкап ----------
test('normalize: суммы и базы клампятся, лимиты ≥ 0, месяц 01-12, id без повторов, иконки - строки', () => {
  const S = Engine.migrate({
    wallets: [{ id: 'w1', base: 1e300 }, { id: 'w2', base: -1e300 }],
    tx: [
      { id: 'a', kind: 'exp', amount: 1e15, date: '2026-09-05', walletId: 'w1' },
      { id: 'a', kind: 'exp', amount: 5, date: '2026-09-06', walletId: 'w1' },
      { id: 'b', kind: 'inc', amount: 7, date: '2026-09-06', walletId: 'w1' }
    ],
    categories: { exp: [{ id: 'c1', name: 'Еда' }], inc: [] },
    limits: { '2026-09': { c1: -500, c2: 1e300 }, '2026-13': { c1: 5 } },
    icons: { c1: 'food', c2: 5, c3: { evil: true }, c4: '' },
    ui: { month: '2026-13' }
  });
  assert.equal(S.wallets[0].base, Engine.MAX_AMOUNT);
  assert.equal(S.wallets[1].base, -Engine.MAX_AMOUNT);
  assert.equal(S.tx.length, 2, 'повторный id не отсеян');
  assert.equal(S.tx[0].amount, Engine.MAX_AMOUNT);
  assert.equal(S.tx[1].id, 'b');
  assert.equal(S.limits['2026-09'].c1, 0);
  assert.equal(S.limits['2026-09'].c2, Engine.MAX_AMOUNT);
  assert.equal(S.limits['2026-13'], undefined);
  assert.deepEqual(S.icons, { c1: 'food' });
  assert.equal(S.ui.month, null);
  assert.equal(Engine.migrate({ ui: { month: '2026-00' } }).ui.month, null);
  assert.equal(Engine.migrate({ ui: { month: '2026-12' } }).ui.month, '2026-12');
});

test('importJSON: враждебный бэкап проходит через тот же normalize', () => {
  const s = JSON.stringify({ app: 'homyak', ver: 1, state: {
    wallets: [{ id: 'w1', base: 1e18 }], tx: [{ id: 'x', amount: 1e18, date: '2026-09-05' }],
    icons: { c1: ['no'] }, ui: { month: '1999-99' }
  } });
  const S = Engine.importJSON(s);
  assert.equal(S.wallets[0].base, Engine.MAX_AMOUNT);
  assert.equal(S.tx[0].amount, Engine.MAX_AMOUNT);
  assert.deepEqual(S.icons, {});
  assert.equal(S.ui.month, null);
});

// ---------- 16. «Осталось» без лимитов ----------
test('summary: без единого лимита remaining = null, с явным лимитом 0 - считается', () => {
  const S = Engine.defaultState();
  const eda = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 });
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-09-05', catId: eda.id, walletId: w.id });
  let r = Engine.summary(S, '2026-09');
  assert.equal(r.planned, 0);
  assert.equal(r.spent, 500);
  assert.equal(r.remaining, null, 'без лимитов «Осталось» не должно быть числом');
  assert.equal(r.hasLimits, false);
  Engine.setLimit(S, '2026-09', eda.id, 0);
  r = Engine.summary(S, '2026-09');
  assert.equal(r.hasLimits, true);
  assert.equal(r.remaining, -500, 'явный лимит 0 - это лимит, перерасход виден');
  assert.equal(Engine.limitedCount(S, '2026-09', 'exp'), 1);
});

// ---------- 17. процент сводки только по категориям с лимитом ----------
test('limitProgress: лимит у одной категории, траты в другой - процент 0, «лимит у 1 из 2»', () => {
  const S = Engine.defaultState();
  const eda = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const dom = Engine.addCategory(S, 'exp', { name: 'Дом' });
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 });
  Engine.setLimit(S, '2026-09', eda.id, 1000);
  Engine.addTx(S, { kind: 'exp', amount: 24690, date: '2026-09-05', catId: dom.id, walletId: w.id });
  const lp = Engine.limitProgress(S, '2026-09', 'exp');
  assert.deepEqual(lp, { fact: 0, plan: 1000, limited: 1, total: 2 });
  Engine.addTx(S, { kind: 'exp', amount: 250, date: '2026-09-06', catId: eda.id, walletId: w.id });
  assert.deepEqual(Engine.limitProgress(S, '2026-09', 'exp'), { fact: 250, plan: 1000, limited: 1, total: 2 });
  const rows = Engine.monthBreakdown(S, '2026-09', 'exp');
  assert.equal(rows.find(r => r.catId === dom.id).hasPlan, false);
  assert.equal(rows.find(r => r.catId === eda.id).hasPlan, true);
});

// ---------- 15. компактная запись длинных сумм ----------
test('fmtCompact: три значащих цифры и слово, ниже миллиона - обычный fmt', () => {
  assert.equal(Engine.fmtCompact(1234567), '1,23' + Engine.NBSP + 'млн');
  assert.equal(Engine.fmtCompact(11111111), '11,1' + Engine.NBSP + 'млн');
  assert.equal(Engine.fmtCompact(123456789), '123' + Engine.NBSP + 'млн');
  assert.equal(Engine.fmtCompact(1500000000), '1,5' + Engine.NBSP + 'млрд');
  assert.equal(Engine.fmtCompact(-2000000), '−2' + Engine.NBSP + 'млн');
  assert.equal(Engine.fmtCompact(999999), Engine.fmt(999999));
  assert.equal(Engine.fmtCompact('мусор'), '0');
});

// ---------- 1. гейт на возврате из архива / скрытых (сторож исходников) ----------
test('edit.js: возврат из архива и показ скрытого кошелька идут через гейт', () => {
  const s = src('edit.js');
  // каждая разархивация - только внутри restoreCat, а тот начинается с catGate
  const unarchive = s.split('archiveCategory(UI.S').filter(p => /^,\s*[^,]+,\s*false\)/.test(p));
  assert.equal(unarchive.length, 1, 'разархивация должна быть в одном месте (restoreCat)');
  const rc = s.slice(s.indexOf('function restoreCat'), s.indexOf('function addCat'));
  assert.ok(rc.indexOf('catGate(') >= 0 && rc.indexOf('catGate(') < rc.indexOf('archiveCategory('),
    'restoreCat не проверяет гейт до разархивации');
  // hidden:false - только в unhideWallet, после walletGate
  const parts = s.split('hidden: false');
  assert.equal(parts.length, 2, 'показ скрытого кошелька должен быть в одном месте (unhideWallet)');
  const uw = s.slice(s.indexOf('function unhideWallet'), s.indexOf('hidden: false'));
  assert.ok(uw.indexOf('walletGate(') >= 0, 'unhideWallet не проверяет гейт до показа');
  // сам гейт - через движок, тот же, что у добавления
  assert.ok(s.indexOf('Engine.canAddWallet(UI.S, full())') >= 0);
  assert.ok(s.indexOf('Engine.canAddExpCat(UI.S, full())') >= 0);
  assert.ok(s.indexOf('Engine.canAddIncCat(UI.S, full())') >= 0);
});

// ---------- 7. paywall без оплаты ----------
test('edit.js: без Access.PAY баннер не рисует «Купить» и цену, «Купить» ведёт в buyFullAccess(ret)', () => {
  const s = src('edit.js');
  const pw = s.slice(s.indexOf('function paywall'), s.indexOf('function capMsg'));
  assert.ok(pw.indexOf('Access.PAY') >= 0 || s.indexOf('Access.PAY') >= 0, 'paywall не смотрит на Access.PAY');
  assert.ok(pw.indexOf('Оплата подключится в ближайшем обновлении') >= 0, 'нет честной строки без оплаты');
  assert.ok(pw.indexOf('buyFullAccess(ret)') >= 0, '«Купить» не передаёт колбэк возврата');
  assert.ok(/if \(pay\) buttons\.push\(\{ label: 'Купить/.test(pw), 'кнопка «Купить» не под условием оплаты');
  assert.equal(pw.indexOf('респект'), -1, 'старая строка про респект осталась');
  assert.ok(pw.indexOf('лента событий') >= 0);
  assert.equal(pw.indexOf('—'), -1, 'в тексте баннера длинное тире');
});

// ---------- 6. один источник «полный доступ» ----------
test('full() в edit.js и меню в ui.js берут полный доступ из UI.hasFullAccess', () => {
  const e = src('edit.js'), u = src('ui.js');
  assert.ok(/function full\(\)[\s\S]{0,200}UI\.hasFullAccess/.test(e));
  assert.ok(/function hasFull\(\)[\s\S]{0,200}hasFullAccess/.test(u));
  const menu = u.slice(u.indexOf('function renderMenu'), u.indexOf('// ---------- снимок отображаемых чисел'));
  assert.equal(menu.indexOf('Access.FULL'), -1, 'renderMenu читает Access.FULL напрямую');
  assert.ok(menu.indexOf('hasFull()') >= 0);
});

// ---------- 21-22. тексты автономной модели ----------
test('в текстах для пользователя нет «Казны», «компа», «синка», «Бюджета»', () => {
  const dead = ['«Казны»', 'на компе', 'из «Бюджета»', 'при следующем синке', 'Night Hamster', 'Day Hamster'];
  ['edit.js', 'sheet.js', 'summary.js', 'backup.js', 'ui.js', 'index.html'].forEach((f) => {
    const s = src(f);
    dead.forEach((d) => assert.equal(s.indexOf(d), -1, f + ': осталось «' + d + '»'));
  });
  assert.ok(src('backup.js').indexOf('бэкапа «Хомяка»') >= 0);
});

// ---------- 11. онбординг - слой для «назад» ----------
test('онбординг - верхний слой: «назад» на нём закрывает приветствие, а не приложение', () => {
  assert.equal(Engine.OVERLAY_ORDER[0], 'onboard');
  assert.equal(Engine.topOverlay({ onboard: true, dialog: true, menu: true }), 'onboard');
  const u = src('ui.js');
  assert.ok(/case 'onboard':[^\n]*obDone/.test(u), 'closeTop не жмёт «Понятно» на онбординге');
  assert.ok(u.indexOf('onboard: onboardOpen()') >= 0, 'overlayFlags не знает про онбординг');
});
