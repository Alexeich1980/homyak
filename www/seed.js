/* seed.js — построители стартового состояния. Без DOM, тестируется в Node.
   demoState  — наполненное демо для тест-режима (кошельки, категории, лимиты, операции);
                помечает ui.demo=true (по нему меню рисует плашку «Очистить демо»).
   presetState — чистый старт реального пользователя (8 расходных + доход + 2 кошелька). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Seed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function shiftMonth(todayStr, delta) {
    var y = +todayStr.slice(0, 4), m = +todayStr.slice(5, 7) - 1 + delta, d = todayStr.slice(8, 10);
    var dt = new Date(Date.UTC(y, m, 1));
    var yy = dt.getUTCFullYear(), mm = dt.getUTCMonth() + 1;
    return yy + '-' + (mm < 10 ? '0' : '') + mm + '-' + d;
  }
  function ymOf(s) { return s.slice(0, 7); }

  // 8 базовых расходных категорий + доход — для чистого старта реального пользователя
  var EXP_PRESET = [
    { name: 'Еда', icon: 'food', color: 'red' },
    { name: 'Транспорт', icon: 'bus', color: 'blue' },
    { name: 'Дом', icon: 'home', color: 'teal' },
    { name: 'Здоровье', icon: 'health', color: 'green' },
    { name: 'Развлечения', icon: 'play', color: 'purple' },
    { name: 'Одежда', icon: 'bag', color: 'pink' },
    { name: 'Связь', icon: 'mobile', color: 'orange' },
    { name: 'Прочее', icon: 'other', color: 'graphite' }
  ];
  var INC_PRESET = [{ name: 'Зарплата', icon: 'salary', color: 'green' }];

  function presetState(Engine) {
    var S = Engine.defaultState();
    EXP_PRESET.forEach(function (c) { Engine.addCategory(S, 'exp', c); });
    INC_PRESET.forEach(function (c) { Engine.addCategory(S, 'inc', c); });
    Engine.addWallet(S, { name: 'Карта', icon: 'card', color: 'blue', base: 0 });
    Engine.addWallet(S, { name: 'Наличные', icon: 'cash', color: 'yellow', base: 0 });
    return S;
  }

  // расширенное демо: 5 кошельков, 17 категорий расходов, 4 источника дохода
  var DEMO_EXP = [
    { name: 'Еда', icon: 'food', color: 'red', lim: 32000 },
    { name: 'Кафе', icon: 'coffee', color: 'orange', lim: 8000 },
    { name: 'Транспорт', icon: 'bus', color: 'blue', lim: 6000 },
    { name: 'Бензин', icon: 'fuel', color: 'graphite', lim: 9000 },
    { name: 'Дом', icon: 'home', color: 'teal', lim: 15000 },
    { name: 'ЖКХ', icon: 'homekey', color: 'blue', lim: 8500 },
    { name: 'Здоровье', icon: 'health', color: 'green', lim: 7000 },
    { name: 'Аптека', icon: 'pharmacy', color: 'green', lim: null },
    { name: 'Развлечения', icon: 'play', color: 'purple', lim: 10000 },
    { name: 'Одежда', icon: 'bag', color: 'pink', lim: 12000 },
    { name: 'Связь', icon: 'mobile', color: 'orange', lim: 2000 },
    { name: 'Подписки', icon: 'laptop', color: 'graphite', lim: 2500 },
    { name: 'Дети', icon: 'baby', color: 'yellow', lim: 20000 },
    { name: 'Питомец', icon: 'pet', color: 'teal', lim: null },
    { name: 'Подарки', icon: 'gift', color: 'red', lim: 5000 },
    { name: 'Путешествия', icon: 'plane', color: 'blue', lim: null },
    { name: 'Прочее', icon: 'other', color: 'graphite', lim: null }
  ];
  var DEMO_INC = [
    { name: 'Зарплата', icon: 'salary', color: 'green' },
    { name: 'Фриланс', icon: 'briefcase', color: 'teal' },
    { name: 'Проценты', icon: 'percent', color: 'blue' },
    { name: 'Прочее', icon: 'other', color: 'graphite' }
  ];

  function demoState(Engine, todayStr) {
    todayStr = todayStr || Engine.today();
    var S = Engine.defaultState();
    var exp = DEMO_EXP.map(function (c) { return Engine.addCategory(S, 'exp', { name: c.name, icon: c.icon, color: c.color }); });
    var inc = DEMO_INC.map(function (c) { return Engine.addCategory(S, 'inc', c); });

    var card = Engine.addWallet(S, { name: 'Карта', icon: 'card', color: 'blue', base: 74000 });
    var cash = Engine.addWallet(S, { name: 'Наличные', icon: 'cash', color: 'yellow', base: 8500 });
    var save = Engine.addWallet(S, { name: 'Накопления', icon: 'piggy', color: 'teal', base: 240000 });
    var credit = Engine.addWallet(S, { name: 'Кредитка', icon: 'credit', color: 'red', base: -18000 });
    var bonus = Engine.addWallet(S, { name: 'Бонусы', icon: 'bonus', color: 'purple', base: 3200 });

    var curYM = ymOf(todayStr), prevYM = ymOf(shiftMonth(todayStr, -1));
    var curDay = +todayStr.slice(8, 10);
    function cc(day) { return Math.max(1, Math.min(day, curDay)); }
    function d(ymStr, day) { return ymStr + '-' + (day < 10 ? '0' : '') + day; }

    // лимиты текущего месяца (у части категорий намеренно не задан — серые кружки)
    exp.forEach(function (c, i) { if (DEMO_EXP[i].lim != null) Engine.setLimit(S, curYM, c.id, DEMO_EXP[i].lim); });
    Engine.copyLimits(S, curYM, prevYM);   // прошлый месяц с теми же планами — для динамики

    // доходы
    Engine.addTx(S, { kind: 'inc', amount: 140000, date: d(curYM, cc(5)), catId: inc[0].id, walletId: card.id });
    Engine.addTx(S, { kind: 'inc', amount: 23000, date: d(curYM, cc(6)), catId: inc[1].id, walletId: card.id });
    Engine.addTx(S, { kind: 'inc', amount: 140000, date: d(prevYM, 5), catId: inc[0].id, walletId: card.id });
    // расходы текущего месяца (Кафе — перебор для «Зоны внимания»)
    var e = {};
    exp.forEach(function (c, i) { e[i] = c.id; });
    Engine.addTx(S, { kind: 'exp', amount: 4200, date: d(curYM, cc(1)), catId: e[0], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 3100, date: d(curYM, cc(2)), catId: e[0], walletId: cash.id });
    Engine.addTx(S, { kind: 'exp', amount: 5200, date: d(curYM, cc(2)), catId: e[1], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 4300, date: d(curYM, cc(3)), catId: e[1], walletId: card.id }); // Кафе 9500 > 8000
    Engine.addTx(S, { kind: 'exp', amount: 2600, date: d(curYM, cc(3)), catId: e[2], walletId: cash.id });
    Engine.addTx(S, { kind: 'exp', amount: 3000, date: d(curYM, cc(4)), catId: e[3], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 8500, date: d(curYM, cc(4)), catId: e[5], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 6400, date: d(curYM, cc(5)), catId: e[9], walletId: credit.id });
    Engine.addTx(S, { kind: 'exp', amount: 1990, date: d(curYM, cc(6)), catId: e[11], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 3500, date: d(curYM, cc(6)), catId: e[8], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 1200, date: d(curYM, cc(6)), catId: e[7], walletId: cash.id });
    // перевод карта → накопления
    Engine.addTx(S, { kind: 'transfer', amount: 20000, date: d(curYM, cc(5)), walletId: card.id, toWalletId: save.id });
    // прошлый месяц — для динамики
    Engine.addTx(S, { kind: 'exp', amount: 30500, date: d(prevYM, 8), catId: e[0], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 9200, date: d(prevYM, 12), catId: e[4], walletId: card.id });
    Engine.addTx(S, { kind: 'exp', amount: 7300, date: d(prevYM, 20), catId: e[9], walletId: credit.id });

    S.ui.demo = true;   // метка демо: меню покажет плашку «Очистить демо»
    return S;
  }

  // ---------- reel-персоны (промо-скринкасты) -------------------------------
  // Три готовых набора под трёх персонажей рекламного ролика. Грузятся только в
  // reel-сборке (Access.REEL, флаг HOMYAK_REEL) под своим ключом хранилища
  // 'homyak-reel'. Каждая персона — валидное состояние на текущей автономной
  // модели: те же конструкторы addWallet/addCategory/addTx/setLimit, что и в demo.
  // S.ui.onboarded=true — чтобы приветствие не закрывало кадр; S.ui.reel — номер персоны.
  // Значения плана/факта подобраны под пороги fill() из engine.js:
  //   зелёный 0<доля<0.8 · оранжевый 0.8<=доля<1 · красный доля>=1.
  function reelState(Engine, persona, todayStr) {
    todayStr = todayStr || Engine.today();
    var p = (persona >= 1 && persona <= 3) ? persona : 1;
    var S = Engine.defaultState();
    var curYM = ymOf(todayStr), curDay = +todayStr.slice(8, 10);
    function cc(day) { return Math.max(1, Math.min(day, curDay)); }
    function dt(day) { var d = cc(day); return curYM + '-' + (d < 10 ? '0' : '') + d; }
    // расходная категория с планом и (необязательно) одним фактом на кошельке
    function exp(name, icon, color, plan, fact, walletId, day) {
      var c = Engine.addCategory(S, 'exp', { name: name, icon: icon, color: color });
      if (plan != null) Engine.setLimit(S, curYM, c.id, plan);
      if (fact) Engine.addTx(S, { kind: 'exp', amount: fact, date: dt(day || 3), catId: c.id, walletId: walletId });
      return c;
    }
    // источник дохода в верхнем поле: категория + один факт-поступление на кошелёк
    function inc(name, icon, color, amount, walletId, day) {
      var c = Engine.addCategory(S, 'inc', { name: name, icon: icon, color: color });
      if (amount) Engine.addTx(S, { kind: 'inc', amount: amount, date: dt(day || 5), catId: c.id, walletId: walletId });
      return c;
    }

    if (p === 1) {
      // «Кофе»: живой активный бюджет из ~11 категорий (микс зелёных, пара оранжевых
      // 80-99%, одна красная). Наличные — для сцены перетаскивания; «Кафе» в зелёной
      // зоне (30%), чтобы после «кофе ~200 ₽» кольцо подросло, но осталось зелёным (<80%).
      var p1cash = Engine.addWallet(S, { name: 'Наличные', icon: 'cash', color: 'yellow', base: 5000 });
      var p1card = Engine.addWallet(S, { name: 'Карта', icon: 'card', color: 'blue', base: 38000 });
      Engine.addWallet(S, { name: 'Накопления', icon: 'piggy', color: 'teal', base: 120000 });
      inc('Зарплата', 'salary', 'green', 95000, p1card.id, 5);
      exp('Кафе', 'coffee', 'orange', 3000, 900, p1cash.id, 2);        // 30% зелёный (якорь)
      exp('Продукты', 'food', 'red', 15000, 6000, p1card.id, 3);       // 40% зелёный
      exp('Транспорт', 'bus', 'blue', 5000, 2500, p1cash.id, 4);       // 50% зелёный
      exp('ЖКХ', 'homekey', 'blue', 7000, 6500, p1card.id, 5);         // 92.9% оранжевый
      exp('Связь', 'mobile', 'orange', 800, 700, p1card.id, 6);        // 87.5% оранжевый
      exp('Развлечения', 'play', 'purple', 4000, 4600, p1card.id, 7);  // 115% красный
      exp('Здоровье', 'health', 'green', 3000, 1000, p1card.id, 8);    // 33% зелёный
      exp('Одежда', 'bag', 'pink', 8000, 2000, p1card.id, 9);          // 25% зелёный
      exp('Подписки', 'laptop', 'graphite', 1500, 990, p1card.id, 10); // 66% зелёный
      exp('Дом', 'home', 'teal', 6000, 3200, p1card.id, 11);           // 53% зелёный
      exp('Подарки', 'gift', 'red', 3000, 500, p1card.id, 12);         // 17% зелёный
    } else if (p === 2) {
      // «Парфюм»: «Красота» глубоко в красном — ровно 153% (план 6000, факт 9200,
      // числа не менять); вокруг — наполненный бюджет из зелёных для контраста и
      // пары оранжевых. Красное кольцо получает доводчик (fill-pulse) в revealRingFills.
      var p2card = Engine.addWallet(S, { name: 'Карта', icon: 'card', color: 'blue', base: 45000 });
      Engine.addWallet(S, { name: 'Наличные', icon: 'cash', color: 'yellow', base: 7000 });
      Engine.addWallet(S, { name: 'Накопления', icon: 'piggy', color: 'teal', base: 90000 });
      inc('Зарплата', 'salary', 'green', 110000, p2card.id, 5);
      exp('Красота', 'bag', 'pink', 6000, 9200, p2card.id, 3);         // 153% красный (якорь)
      exp('Продукты', 'food', 'red', 20000, 9000, p2card.id, 2);       // 45% зелёный
      exp('Транспорт', 'bus', 'blue', 6000, 2400, p2card.id, 4);       // 40% зелёный
      exp('Дом', 'home', 'teal', 10000, 3000, p2card.id, 5);           // 30% зелёный
      exp('Кафе', 'coffee', 'orange', 5000, 2000, p2card.id, 6);       // 40% зелёный
      exp('Здоровье', 'health', 'green', 4000, 1500, p2card.id, 7);    // 37.5% зелёный
      exp('ЖКХ', 'homekey', 'blue', 8000, 7500, p2card.id, 8);         // 93.75% оранжевый
      exp('Связь', 'mobile', 'orange', 900, 800, p2card.id, 9);        // 88.9% оранжевый
      exp('Развлечения', 'play', 'purple', 5000, 2500, p2card.id, 10); // 50% зелёный
      exp('Подписки', 'laptop', 'graphite', 2000, 1200, p2card.id, 11);// 60% зелёный
      exp('Подарки', 'gift', 'red', 4000, 600, p2card.id, 12);         // 15% зелёный
    } else {
      // «Дом»: заполненная сводка (разброс зелёный/оранжевый/красный, ~11 категорий).
      // Зарплатная карта = 85000 (зарплата пришла: база 0 + поступление 85000, баланс
      // ровно 85000). Кредитка −30000 (долг). Сцена: перетащить Зарплатную → Кредитку
      // на 30000 → долг ровно в ноль (Зарплатная → 55000). Все траты сводки идут с
      // Наличных, чтобы Зарплатная держала ровно 85000 в кадре до перевода.
      var p3salary = Engine.addWallet(S, { name: 'Зарплатная карта', icon: 'card', color: 'blue', base: 0 });
      var p3cash = Engine.addWallet(S, { name: 'Наличные', icon: 'cash', color: 'yellow', base: 90000 });
      Engine.addWallet(S, { name: 'Кредитка', icon: 'credit', color: 'red', base: -30000 });
      Engine.addWallet(S, { name: 'Накопления', icon: 'piggy', color: 'teal', base: 200000 });
      inc('Зарплата', 'salary', 'green', 85000, p3salary.id, 5);       // Зарплатная: 0 + 85000 = 85000
      exp('Продукты', 'food', 'red', 20000, 12000, p3cash.id, 2);      // 60% зелёный
      exp('Транспорт', 'bus', 'blue', 6000, 3000, p3cash.id, 3);       // 50% зелёный
      exp('ЖКХ', 'homekey', 'blue', 8000, 7000, p3cash.id, 4);         // 87.5% оранжевый
      exp('Кафе', 'coffee', 'orange', 5000, 4500, p3cash.id, 5);       // 90% оранжевый
      exp('Развлечения', 'play', 'purple', 4000, 5200, p3cash.id, 6);  // 130% красный
      exp('Здоровье', 'health', 'green', 3000, 900, p3cash.id, 7);     // 30% зелёный
      exp('Одежда', 'bag', 'pink', 10000, 3500, p3cash.id, 8);         // 35% зелёный
      exp('Дом', 'home', 'teal', 7000, 6600, p3cash.id, 9);            // 94.3% оранжевый
      exp('Связь', 'mobile', 'orange', 900, 850, p3cash.id, 10);       // 94.4% оранжевый
      exp('Подарки', 'gift', 'red', 5000, 700, p3cash.id, 11);         // 14% зелёный
      exp('Питомец', 'pet', 'teal', 3000, 6500, p3cash.id, 12);        // 216% красный
    }

    S.ui.onboarded = true;   // приветствие не показываем — не мешать съёмке
    S.ui.reel = p;           // номер текущей персоны
    return S;
  }

  return { demoState: demoState, presetState: presetState, reelState: reelState,
    EXP_PRESET: EXP_PRESET, INC_PRESET: INC_PRESET };
});
