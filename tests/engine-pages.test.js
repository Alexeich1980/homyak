// Страницы лент и звук операции — чистые ступени движка, вынесенные из оболочки.
// Ошибка тут видна на телефоне так: «точек под кошельками не столько», «лента встала
// не на ту страницу» или «после перебора расход снова звучит обычной тратой».
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../www/engine.js');

// ---------- сколько страниц у ленты ----------
test('pageCount: кошельки едут по четыре, пустая лента - всё равно одна страница', () => {
  assert.equal(Engine.PAGE_WALLETS, 4);
  assert.equal(Engine.pageCount(0, 4), 1);
  assert.equal(Engine.pageCount(1, 4), 1);
  assert.equal(Engine.pageCount(4, 4), 1);
  assert.equal(Engine.pageCount(5, 4), 2);
  assert.equal(Engine.pageCount(8, 4), 2);
  assert.equal(Engine.pageCount(9, 4), 3);
  assert.equal(Engine.pageCount(16, 4), 4);
});

test('pageCount: мусор вместо чисел не роняет счёт', () => {
  assert.equal(Engine.pageCount(), 1);
  assert.equal(Engine.pageCount(null, null), 1);
  assert.equal(Engine.pageCount(-5, 4), 1, 'отрицательное число кошельков');
  assert.equal(Engine.pageCount(6, 0), 2, 'нулевой размер страницы падает на четвёрку');
  assert.equal(Engine.pageCount('7', '4'), 2, 'строки считаются как числа');
});

// ---------- какая страница сейчас видна ----------
// Страница у ленты кошельков теперь настоящая: во всю ширину окна, а недобор
// кошельков на последней остаётся пустыми местами. Значит ход прокрутки РОВНО кратен
// ширине окна, и шаг - это она сама. Прежняя формула «весь ход, поделённый на
// промежутки» была заплаткой под неполную последнюю страницу: шесть кошельков ехали
// на 171 px вместо 348, и вторая страница повторяла хвост первой.
test('pageStep: шаг страницы - это ширина окна ленты', () => {
  assert.equal(Engine.pageStep(696, 348, 2), 348, 'шесть кошельков: две страницы по 348');
  assert.equal(Engine.pageStep(1044, 348, 3), 348, 'три страницы - тот же шаг');
  assert.equal(Engine.pageStep(348, 348, 1), 0, 'одна страница - шага нет');
  assert.equal(Engine.pageStep(300, 348, 2), 0, 'лента короче окна - ехать некуда');
  assert.equal(Engine.pageStep(696, 0, 2), 0, 'окно ещё не измерили');
  assert.equal(Engine.pageStep(), 0);
});

test('pageStep: ход прокрутки кратен ширине окна', () => {
  [[696, 348, 2], [1044, 348, 3], [1200, 300, 4]].forEach(([sw, cw, n]) => {
    assert.equal((sw - cw) % Engine.pageStep(sw, cw, n), 0, `${sw}/${cw}/${n}`);
    assert.equal((sw - cw) / Engine.pageStep(sw, cw, n), n - 1, `${sw}/${cw}/${n}: промежутков`);
  });
});

test('pageAt: страница считается по целым шагам в ширину окна', () => {
  assert.equal(Engine.pageAt(0, 696, 348, 2), 0);
  assert.equal(Engine.pageAt(173, 696, 348, 2), 0, 'меньше половины шага - ещё первая');
  assert.equal(Engine.pageAt(175, 696, 348, 2), 1, 'больше половины шага - уже вторая');
  assert.equal(Engine.pageAt(348, 696, 348, 2), 1, 'край ленты - последняя страница');
  assert.equal(Engine.pageAt(696, 1044, 348, 3), 2, 'три страницы');
});

test('pageAt: номер не выходит за число страниц и переживает нули', () => {
  assert.equal(Engine.pageAt(99999, 696, 348, 2), 1, 'подрезан сверху');
  assert.equal(Engine.pageAt(-500, 696, 348, 2), 0, 'подрезан снизу');
  assert.equal(Engine.pageAt(100, 348, 348, 2), 0, 'ленту ещё не измерили');
  assert.equal(Engine.pageAt(), 0);
  assert.equal(Engine.pageAt(100, 696, 348, 0), 0, 'страниц ноль - всё равно нулевая');
});

test('pageLeft: тап по точке приводит ленту ровно на край своей страницы', () => {
  assert.equal(Engine.pageLeft(0, 696, 348, 2), 0);
  assert.equal(Engine.pageLeft(1, 696, 348, 2), 348, 'вторая страница = ровно одна ширина окна');
  assert.equal(Engine.pageLeft(1, 1044, 348, 3), 348);
  assert.equal(Engine.pageLeft(2, 1044, 348, 3), 696);
  assert.equal(Engine.pageLeft(9, 696, 348, 2), 348, 'номер подрезан по числу страниц');
  assert.equal(Engine.pageLeft(-3, 696, 348, 2), 0);
  assert.equal(Engine.pageLeft(1, 348, 348, 1), 0, 'одна страница - никуда не едем');
});

// последняя страница доезжает ровно до конца ленты: пустых мест на ней может быть
// сколько угодно, но за край прокрутки она не выходит и до края не недоезжает
test('pageLeft: последняя страница встаёт точно в конец прокрутки', () => {
  [[696, 348, 2], [1044, 348, 3], [1200, 300, 4]].forEach(([sw, cw, n]) => {
    assert.equal(Engine.pageLeft(n - 1, sw, cw, n), sw - cw, `${sw}/${cw}/${n}`);
  });
});

// туда и обратно: куда лента приехала по тапу, ту страницу и показывает точка
test('pageLeft и pageAt согласованы на любом числе страниц', () => {
  [[696, 348, 2], [1044, 348, 3], [1200, 300, 4]].forEach(([sw, cw, n]) => {
    for (let i = 0; i < n; i++) {
      assert.equal(Engine.pageAt(Engine.pageLeft(i, sw, cw, n), sw, cw, n), i, `${sw}/${cw}/${n} стр. ${i}`);
    }
  });
});

// ---------- звук операции ----------
// Хозяин: пока категория за планом, каждый следующий расход по ней должен звучать
// перебором. Памяти «первый раз» в приложении больше нет - решает только уровень.
test('txSound: расход за планом звучит перебором каждый раз', () => {
  assert.equal(Engine.txSound('exp', 'over'), 'over');
  assert.equal(Engine.txSound('exp', 'over'), 'over', 'второй подряд - тоже перебор');
  assert.equal(Engine.txSound('exp', 'warn'), 'expense');
  assert.equal(Engine.txSound('exp', 'ok'), 'expense');
  assert.equal(Engine.txSound('exp', 'none'), 'expense');
  assert.equal(Engine.txSound('exp', null), 'expense', 'уровень неизвестен - обычная трата');
});

test('txSound: доход и перевод перебором не звучат никогда', () => {
  assert.equal(Engine.txSound('inc', 'over'), 'income');
  assert.equal(Engine.txSound('inc', null), 'income');
  assert.equal(Engine.txSound('transfer', 'over'), 'transfer');
  assert.equal(Engine.txSound('transfer', null), 'transfer');
});

test('txSound: возвращает только имена из белого списка sound.js', () => {
  const Sound = require('../www/sound.js');
  ['exp', 'inc', 'transfer', 'чушь'].forEach(k => {
    ['over', 'warn', 'ok', 'none', null].forEach(l => {
      assert.equal(Sound.isName(Engine.txSound(k, l)), true, k + '/' + l);
    });
  });
});

// ---------- намерение свайпа ----------
// Меню закрывается смахиванием откуда угодно по панели, в том числе поверх
// прокручиваемого списка настроек: горизонталь должна быть заметно длиннее вертикали.
test('swipeCloses: косой жест по списку меню его не закрывает', () => {
  assert.equal(Engine.SWIPE_RATIO, 1.5);
  assert.equal(Engine.swipeCloses(-120, 10, 'left'), true, 'честная горизонталь');
  assert.equal(Engine.swipeCloses(-120, 79, 'left'), true, '120 > 79 * 1.5');
  assert.equal(Engine.swipeCloses(-120, 81, 'left'), false, '120 < 81 * 1.5');
  assert.equal(Engine.swipeCloses(-120, -81, 'left'), false, 'вверх наискось - тоже нет');
  assert.equal(Engine.swipeCloses(-59, 0, 'left'), false, 'порог длины остался 60');
});
