/* debts-1410.test.js - решения Алексея 14.10.2026 по долгам: «мне должны» хранит ставку
   только для наглядности (вариант А) - проценты не начисляются, возврат и «дали ещё»
   целиком двигают сам долг; у «я должен» ставка работает как раньше. */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/engine.js');

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 200000 });
  card.baseTs = 0;
  return { S, card };
}

test('14.10: «мне должны» хранит ставку, но проценты не начисляет', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owed', name: 'Саша', amount: 100000, rate: 12.9, date: '2026-01-10', now: 0 });
  assert.strictEqual(d.rate, 12.9, 'ставка «мне должны» не сохранилась');
  assert.strictEqual(Engine.previewPay(S, { debtId: d.id, amount: 10000, date: '2026-02-15' }).interest, 0, 'у «мне должны» начислились проценты');
  const before = Engine.walletBalance(S, card.id);
  const ops = [Engine.payDebt, Engine.takeDebt];
  ops.forEach((fn) => fn(S, { debtId: d.id, walletId: card.id, amount: 10000, date: '2026-02-15' }));
  S.tx.filter((t) => t.kind === 'debt').forEach((t) => assert.ok(!(t.int > 0), 'у операции «мне должны» есть проценты'));
  assert.strictEqual(Engine.debtBalance(S, d.id), 100000, 'возврат и «дали ещё» двигают долг не целиком');
  assert.strictEqual(Engine.walletBalance(S, card.id), before, 'кошелёк сдвинулся не на всю сумму');
  // миграция (копия данных, перезапуск) ставку «мне должны» не теряет
  const M = Engine.migrate(JSON.parse(JSON.stringify(S)));
  assert.strictEqual(Engine.findDebt(M, d.id).rate, 12.9, 'миграция стёрла ставку «мне должны»');
  // правка: ставку можно поменять и убрать
  Engine.updateDebt(S, d.id, { rate: 18 });
  assert.strictEqual(d.rate, 18);
  Engine.updateDebt(S, d.id, { rate: null });
  assert.strictEqual(d.rate, null);
  assert.throws(() => Engine.updateDebt(S, d.id, { rate: 150 }), /rate/);
});

test('14.10: «я должен» со ставкой - проценты по-прежнему считаются', () => {
  const { S, card } = fresh();
  const d = Engine.addDebt(S, { type: 'owe', name: 'Кредит', amount: 120000, pay: 10000, day: 15, rate: 12, date: '2026-01-10', now: 0 });
  const r = Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 10000, date: '2026-02-15' });
  assert.strictEqual(r.interest, 1200);
});

const fs = require('node:fs');
const path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('14.10: тексты подсказок без удалённой «Поправить остаток в карточке», один путь к уведомлениям', () => {
  const d = rd('www/debts.js'), u = rd('www/ui.js');
  for (const [f, src] of [['debts.js', d], ['ui.js', u]]) {
    assert.ok(!/поправьте (его|остаток) в карточке/.test(src), f + ': отсылка к удалённой кнопке в карточке');
  }
  assert.ok(u.indexOf('Проверьте сумму или исправьте остаток в карточке долга - «Настроить».') > 0, '«Не сохранилось»');
  assert.ok(d.indexOf('Запишите последний платёж или исправьте остаток в «Настроить».') > 0, '«Пока рано»');
  assert.ok(d.indexOf('поправьте его кнопкой «Поправить остаток».') > 0, 'баннер просрочки - про свою кнопку');
  // путь к настройке уведомлений - одна строка NOTIF_PATH во всех окнах
  assert.ok(d.indexOf("var NOTIF_PATH = 'Разрешить: «Открыть настройки» → «Уведомления» → включить.';") > 0);
  assert.strictEqual((d.match(/«Уведомления»/g) || []).length, 1, 'путь к уведомлениям описан не одной строкой');
  assert.ok((d.match(/NOTIF_PATH \+/g) || []).length >= 2, 'окна про уведомления не берут общий путь');
});

test('14.10: «Динамика» доходов - monthlyTotals по доходам и плану дохода', () => {
  const S = Engine.defaultState();
  const w = Engine.addWallet(S, { name: 'Карта', base: 0 });
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.addTx(S, { kind: 'inc', amount: 50000, catId: sal.id, walletId: w.id, date: '2026-03-05' });
  Engine.addTx(S, { kind: 'exp', amount: 700, catId: food.id, walletId: w.id, date: '2026-03-06' });
  Engine.setLimit(S, '2026-03', sal.id, 40000);
  const inc = Engine.monthlyTotals(S, 2026, 'inc'), exp = Engine.monthlyTotals(S, 2026);
  assert.deepStrictEqual([inc[2].fact, inc[2].plan], [50000, 40000]);
  assert.strictEqual(exp[2].fact, 700, 'расходы по умолчанию сломались');
});

// Решение владельца 14.10: одни слова закрытия долга для «я должен» и «мне должны» - «Долг
// погашен»; приложение не судит, как закрыт долг. В коде приложения (кроме self-test) нет слов
// «прощён», «простил», «списан», «Долг вернули», «Отметить возвращённым», «Записать возврат».
// Слова импорта («списание», «счёт списания») и «деньги не списаны» у покупки - не про долги,
// их отсекают границы слова.
test('14.10: слова закрытия долга - только «Долг погашен», без «прощён/списан/вернули»', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'www');
  const bad = /(?<![а-яё])(прощ[её]н|простил(?!ся)|списан(?![а-яё]))|Долг вернули|Отметить возвращённым|Записать возврат/i;
  const hits = [];
  fs.readdirSync(dir).filter((f) => /\.js$/.test(f) && f !== 'selftest.js').forEach((f) => {
    fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).forEach((l, i) => { if (bad.test(l)) hits.push(f + ':' + (i + 1) + ': ' + l.trim()); });
  });
  assert.deepStrictEqual(hits, [], 'слова закрытия долга, которых владелец не хочет:\n' + hits.join('\n'));
});

// Решение владельца 14.10: в карточке долга нет дубля «Записать платёж» - кнопки «Долг погашен»
// при остатке нет, строки «Без денег» в окне кошелька нет (закрыть без денег - остаток 0 в «Настроить»).
test('14.10: без дублей - нет кнопки dbClose и строки «Без денег» в коде карточки долга', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'www', 'debts.js'), 'utf8');
  assert.ok(src.indexOf('id="dbClose"') < 0, 'вернулась кнопка «Долг погашен» (dbClose)');
  assert.ok(src.indexOf("'Без денег") < 0 && src.indexOf('id="dbNone"') < 0, 'вернулась строка «Без денег»');
});
