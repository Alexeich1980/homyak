const test = require('node:test'); const assert = require('node:assert');
const Engine = require('../www/engine.js');

test('лимит не задан = null, серый даже при факте', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-09'), null);
  assert.deepStrictEqual(Engine.fill(500, Engine.catLimit(S, a.id, '2026-09')), { ratio: 0, level: 'none' });
});

test('явный лимит 0 при факте = over (красный)', () => {
  assert.strictEqual(Engine.fill(100, 0).level, 'over');
});

// Самопроверка в браузере сторожит ту же границу на живой плитке. Раньше она брала планы
// с ПК (S.plans), которых в автономной версии нет, и молча засчитывалась - так пропустила
// смену правила 100 %. Держим её на лимитах и на жёлтом для ровно 100 %.
test('selftest: проверка 100 % идёт на лимитах и ждёт жёлтый', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'www', 'selftest.js'), 'utf8');
  const at = src.indexOf("add('заливка: ровно 100 %");
  assert.ok(at > 0, 'в selftest нет проверки границы 100 %');
  const body = src.slice(at, src.indexOf('\n});', at));
  assert.ok(!/S\.plans/.test(body), 'проверка снова завязана на планы с ПК - в автономной версии она пустая');
  assert.ok(/Engine\.setLimit\(/.test(body), 'проверка не ставит лимит');
  assert.ok(body.includes("'warn', 'движок на 100 %'"), 'проверка не ждёт жёлтый на ровно 100 %');
});

// Во всём selftest планов с ПК быть не должно: в автономной версии их нет, и проверка на
// них превращается в пустую «засчитано» (так три проверки страниц и архива ничего не ловили).
test('selftest: ни одной проверки на планах с ПК', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'www', 'selftest.js'), 'utf8');
  assert.ok(!/S\.plans/.test(src), 'в selftest снова есть S.plans - проверка на нём в автономной версии пустая');
  assert.ok(!/Engine\.(monthIndex|cats)\(/.test(src), 'в selftest снова вызов движка личного Хомяка (monthIndex/cats)');
});

test('пороги заливки: none/ok/warn/over', () => {
  assert.strictEqual(Engine.fill(0, 1000).level, 'none');
  assert.strictEqual(Engine.fill(500, 1000).level, 'ok');
  assert.strictEqual(Engine.fill(800, 1000).level, 'warn');
  assert.strictEqual(Engine.fill(1000, 1000).level, 'warn'); // ровно 100% — жёлтый (решение 29.09.2026)
  assert.strictEqual(Engine.fill(1000.01, 1000).level, 'over'); // копейка сверх — красный
  assert.strictEqual(Engine.fill(333.33 + 333.33 + 333.34, 1000).level, 'warn'); // плавающая точка не краснит ровный план
});

test('setLimit / catLimit / удаление лимита', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.setLimit(S, '2026-08', a.id, 10000);
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-08'), 10000);
  Engine.setLimit(S, '2026-08', a.id, null);
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-08'), null);
  assert.ok(!('2026-08' in S.limits)); // пустой месяц вычищается
});

test('copyLimits переносит планы месяц→месяц', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const b = Engine.addCategory(S, 'exp', { name: 'Дом' });
  Engine.setLimit(S, '2026-08', a.id, 10000);
  Engine.setLimit(S, '2026-08', b.id, 5000);
  const n = Engine.copyLimits(S, '2026-08', '2026-09');
  assert.strictEqual(n, 2);
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-09'), 10000);
  assert.strictEqual(Engine.catLimit(S, b.id, '2026-09'), 5000);
});

test('copyLimits с пустого месяца ничего не создаёт', () => {
  const S = Engine.defaultState();
  assert.strictEqual(Engine.copyLimits(S, '2026-01', '2026-02'), 0);
  assert.ok(!('2026-02' in S.limits));
});

// Правка лимита из карточки категории (sheet.js): сохранение идёт в ТЕКУЩИЙ открытый
// месяц и не задевает соседние; пусто снимает лимит только у этого месяца. Логика ввода
// (пусто → null, отрицательное отклоняется) валидируется в UI, движок получает уже число.
test('лимит из карточки пишется только в открытый месяц', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.setLimit(S, '2026-09', a.id, 15000);          // «Задать» в сентябре
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-09'), 15000);
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-08'), null); // август не затронут
  Engine.setLimit(S, '2026-09', a.id, null);           // пусто = снять лимит сентября
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-09'), null);
});

// ---------- ПЛАН ДОХОДА: то же хранилище (setLimit/catLimit), позитивная заливка ----------

test('план дохода: set / read / снятие через то же хранилище', () => {
  const S = Engine.defaultState();
  const inc = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-09'), null);   // плана нет
  Engine.setLimit(S, '2026-09', inc.id, 120000);
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-09'), 120000);
  assert.strictEqual(Engine.planOr0(S, inc.id, '2026-09'), 120000);
  Engine.setLimit(S, '2026-09', inc.id, null);
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-09'), null);
});

test('план дохода: помесячная изоляция', () => {
  const S = Engine.defaultState();
  const inc = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  Engine.setLimit(S, '2026-09', inc.id, 100000);
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-09'), 100000);
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-08'), null);   // соседний месяц не затронут
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-10'), null);
});

test('copyLimits по kind: планы доходов не затирают лимиты расходов', () => {
  const S = Engine.defaultState();
  const exp = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const inc = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  Engine.setLimit(S, '2026-08', exp.id, 10000);
  Engine.setLimit(S, '2026-08', inc.id, 90000);
  Engine.setLimit(S, '2026-09', exp.id, 15000);            // в сентябре уже свой лимит расхода
  // «Скопировать планы» на вкладке доходов: тянет только доходы
  const n = Engine.copyLimits(S, '2026-08', '2026-09', 'inc');
  assert.strictEqual(n, 1);
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-09'), 90000); // план дохода перенесён
  assert.strictEqual(Engine.catLimit(S, exp.id, '2026-09'), 15000); // лимит расхода НЕ затёрт
});

test('copyLimits по kind: расходы не тянут планы доходов', () => {
  const S = Engine.defaultState();
  const exp = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const inc = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  Engine.setLimit(S, '2026-08', exp.id, 10000);
  Engine.setLimit(S, '2026-08', inc.id, 90000);
  const n = Engine.copyLimits(S, '2026-08', '2026-09', 'exp');
  assert.strictEqual(n, 1);
  assert.strictEqual(Engine.catLimit(S, exp.id, '2026-09'), 10000);
  assert.strictEqual(Engine.catLimit(S, inc.id, '2026-09'), null);  // план дохода не тронут
});

test('copyLimits без kind — прежнее поведение (весь месяц)', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const b = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  Engine.setLimit(S, '2026-08', a.id, 10000);
  Engine.setLimit(S, '2026-08', b.id, 90000);
  assert.strictEqual(Engine.copyLimits(S, '2026-08', '2026-09'), 2);
  assert.strictEqual(Engine.catLimit(S, a.id, '2026-09'), 10000);
  assert.strictEqual(Engine.catLimit(S, b.id, '2026-09'), 90000);
});

// ---------- fillInc: заливка дохода по плану, НИКОГДА не красная ----------

test('fillInc: план не задан → none (серый)', () => {
  assert.deepStrictEqual(Engine.fillInc(50000, null), { ratio: 0, level: 'none' });
  assert.deepStrictEqual(Engine.fillInc(0, null), { ratio: 0, level: 'none' });
});

test('fillInc: факт 0 при заданном плане → none (серый)', () => {
  assert.deepStrictEqual(Engine.fillInc(0, 100000), { ratio: 0, level: 'none' });
});

test('fillInc: доля < 100% → warn (в процессе, не зелёный, не красный)', () => {
  assert.strictEqual(Engine.fillInc(50000, 100000).level, 'warn');
  assert.strictEqual(Engine.fillInc(99999, 100000).level, 'warn');
  assert.strictEqual(Engine.fillInc(1, 100000).level, 'warn');
});

test('fillInc: доля ≥ 100% → ok (зелёный: цель взята/перевыполнена)', () => {
  assert.strictEqual(Engine.fillInc(100000, 100000).level, 'ok');  // ровно 100% — уже зелёный
  assert.strictEqual(Engine.fillInc(150000, 100000).level, 'ok');  // перевыполнение — тоже зелёный
});

test('fillInc: план 0 при живом факте → ok (позитив), не over', () => {
  assert.strictEqual(Engine.fillInc(5000, 0).level, 'ok');
});

test('fillInc: НИКОГДА не возвращает over (красный) при любых входах', () => {
  const cases = [[0, 0], [0, 100], [100, 0], [100, 100], [1e9, 1], [1, 1e9], [50, 100]];
  for (const [f, p] of cases) assert.notStrictEqual(Engine.fillInc(f, p).level, 'over');
});

// ---------- лимиты сами переезжают в новый месяц (решение 01.10.2026) ----------
test('carryLimits: новый месяц получает лимиты ближайшего прошлого, без архивных', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const b = Engine.addCategory(S, 'exp', { name: 'Кафе' });
  const z = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  Engine.setLimit(S, '2026-08', a.id, 1);                 // старый месяц - не источник
  Engine.setLimit(S, '2026-09', a.id, 30000);
  Engine.setLimit(S, '2026-09', b.id, 8000);
  Engine.setLimit(S, '2026-09', z.id, 140000);             // план дохода едет тоже
  Engine.archiveCategory(S, b.id);
  assert.strictEqual(Engine.carryLimits(S, '2026-10'), 2);
  assert.deepStrictEqual(S.limits['2026-10'], { [a.id]: 30000, [z.id]: 140000 });
  assert.deepStrictEqual(S.limits['2026-09'], { [a.id]: 30000, [b.id]: 8000, [z.id]: 140000 }, 'источник не тронут');
  assert.strictEqual(Engine.fill(30000, Engine.catLimit(S, a.id, '2026-10')).level, 'warn');
});

test('carryLimits: свои лимиты месяца не перезаписывает; перенос один раз; без источника - ничего', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  Engine.setLimit(S, '2026-09', a.id, 30000);
  Engine.setLimit(S, '2026-10', a.id, 5);
  assert.strictEqual(Engine.carryLimits(S, '2026-10'), 0);
  assert.strictEqual(S.limits['2026-10'][a.id], 5, 'свой лимит октября на месте');

  assert.strictEqual(Engine.carryLimits(S, '2026-11'), 1, 'ближайший прошлый - октябрь');
  assert.strictEqual(S.limits['2026-11'][a.id], 5);
  Engine.setLimit(S, '2026-11', a.id, null);               // хозяин сам убрал все лимиты ноября
  assert.strictEqual(Engine.carryLimits(S, '2026-11'), 0, 'убранные хозяином лимиты не возвращаются');
  assert.strictEqual(S.limits['2026-11'], undefined);

  const E = Engine.defaultState();
  assert.strictEqual(Engine.carryLimits(E, '2026-10'), 0);
  assert.deepStrictEqual(E.limitsCarried, {}, 'без источника месяц не помечается');
  assert.strictEqual(Engine.carryLimits(S, 'мусор'), 0);
});

test('carryLimits: пометка переноса переживает сохранение и чистится от мусора', () => {
  const S = Engine.migrate({ limitsCarried: { '2026-10': true, '2026-13': true, 'x': true, '2026-11': 1 } });
  assert.deepStrictEqual(S.limitsCarried, { '2026-10': true });
  assert.deepStrictEqual(Engine.migrate({}).limitsCarried, {});
});

test('carryLimits: месяц со своими лимитами помечается - убрал последний, прошлые не вернутся', () => {
  const S = Engine.defaultState();
  const a = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const b = Engine.addCategory(S, 'exp', { name: 'Кафе' });
  Engine.setLimit(S, '2026-09', a.id, 30000);
  Engine.setLimit(S, '2026-09', b.id, 8000);
  Engine.setLimit(S, '2026-10', a.id, 25000);              // задано руками (или версией 1.0.1)
  assert.strictEqual(Engine.carryLimits(S, '2026-10'), 0);
  assert.strictEqual(S.limitsCarried['2026-10'], true, 'месяц со своими лимитами не помечен');
  Engine.setLimit(S, '2026-10', a.id, null);               // хозяин убрал последний лимит
  assert.strictEqual(S.limits['2026-10'], undefined);
  assert.strictEqual(Engine.carryLimits(S, '2026-10'), 0, 'лимиты сентября вернулись после удаления');
  assert.strictEqual(S.limits['2026-10'], undefined);
});
