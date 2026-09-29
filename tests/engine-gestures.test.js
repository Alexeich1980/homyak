// Жесты «Хомяка» вынесены в движок чистыми ступенями: их можно проверить без браузера.
// Ошибка тут — это либо «лента не листается», либо «перевод не начать», либо «кнопка
// назад закрывает не тот слой»: всё то, что на телефоне ловится только руками.
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../www/engine.js');

// ---------- «подними и неси»: 0–150 листаем, 150–500 несём, 500 правим ----------
test('pressPhase: пороги ровно там, где обещано', () => {
  assert.equal(Engine.PRESS_PICKUP, 150);
  assert.equal(Engine.PRESS_EDIT, 500);
});

test('pressPhase: короткое нажатие — ещё ничего не решено', () => {
  assert.equal(Engine.pressPhase(0, null), 'wait');
  assert.equal(Engine.pressPhase(149, null), 'wait');
});

test('pressPhase: сдвиг раньше 150 мс — это прокрутка ленты', () => {
  assert.equal(Engine.pressPhase(20, 10), 'scroll');
  assert.equal(Engine.pressPhase(149, 149), 'scroll');
  // и дальше он остаётся прокруткой, сколько бы палец потом ни держали
  assert.equal(Engine.pressPhase(900, 10), 'scroll');
  assert.equal(Engine.pressPhase(5000, 0), 'scroll');
});

test('pressPhase: подержал 150 мс — плитка поднята и едет за пальцем', () => {
  assert.equal(Engine.pressPhase(150, null), 'pickup');
  assert.equal(Engine.pressPhase(300, null), 'pickup');
  // сдвинулся уже после подъёма — несём, а не листаем
  assert.equal(Engine.pressPhase(200, 160), 'pickup');
  assert.equal(Engine.pressPhase(499, 150), 'pickup');
  // и после 500 мс тоже несём: в правку пускает только НЕПОДВИЖНОЕ нажатие
  assert.equal(Engine.pressPhase(800, 200), 'pickup');
  assert.equal(Engine.pressPhase(3000, 499), 'pickup');
});

test('pressPhase: 500 мс без движения — режим правки', () => {
  assert.equal(Engine.pressPhase(500, null), 'edit');
  assert.equal(Engine.pressPhase(1200, null), 'edit');
});

test('pressPhase: мусор на входе не роняет и не выдумывает фазу', () => {
  assert.equal(Engine.pressPhase(undefined, undefined), 'wait');
  assert.equal(Engine.pressPhase(null, null), 'wait');
  assert.equal(Engine.pressPhase('600', null), 'edit');
  assert.equal(Engine.pressPhase(600, '10'), 'scroll');
});

// ---------- перенос операции: три осмысленных броска, всё прочее — брак ----------
test('dropAllowed: полная таблица 3×3 источник→цель', () => {
  const kinds = ['inc', 'wallet', 'exp'];
  // ожидаемое: доход→кошелёк, кошелёк→расход, кошелёк→кошелёк — да; остальное — нет
  const want = {
    'inc>inc': false,    'inc>wallet': true,    'inc>exp': false,
    'wallet>inc': false, 'wallet>wallet': true, 'wallet>exp': true,
    'exp>inc': false,    'exp>wallet': false,   'exp>exp': false,
  };
  kinds.forEach((s) => kinds.forEach((t) => {
    const key = s + '>' + t;
    assert.equal(Engine.dropAllowed(s, t), want[key], key);
  }));
});

test('dropAllowed: ровно три пары разрешены', () => {
  const kinds = ['inc', 'wallet', 'exp'];
  let yes = 0;
  kinds.forEach((s) => kinds.forEach((t) => { if (Engine.dropAllowed(s, t)) yes++; }));
  assert.equal(yes, 3);
});

test('dropAllowed: категория расхода источником не бывает', () => {
  assert.equal(Engine.dropAllowed('exp', 'wallet'), false);
  assert.equal(Engine.dropAllowed('exp', 'inc'), false);
  assert.equal(Engine.dropAllowed('exp', 'exp'), false);
});

test('dropAllowed: мусор на входе — брак, без падения', () => {
  assert.equal(Engine.dropAllowed(null, 'wallet'), false);
  assert.equal(Engine.dropAllowed('inc', undefined), false);
  assert.equal(Engine.dropAllowed('', ''), false);
  assert.equal(Engine.dropAllowed('walletx', 'exp'), false);
});

// ---------- кнопка «назад»: закрывается ровно верхний слой ----------
test('topOverlay: порядок слоёв совпадает с z-index в вёрстке', () => {
  assert.deepEqual(Engine.OVERLAY_ORDER,
    ['onboard', 'icons', 'dialog', 'amount', 'transfer', 'card', 'summary', 'menu', 'edit']);
});

test('topOverlay: пусто — значит закрывать нечего (выход из приложения)', () => {
  assert.equal(Engine.topOverlay({}), null);
  assert.equal(Engine.topOverlay(null), null);
  assert.equal(Engine.topOverlay({ menu: false, card: false }), null);
});

test('topOverlay: каждый слой в одиночку узнаётся', () => {
  Engine.OVERLAY_ORDER.forEach((name) => {
    const flags = {};
    flags[name] = true;
    assert.equal(Engine.topOverlay(flags), name, name);
  });
});

test('topOverlay: из стопки выбирается верхний', () => {
  // лист иконок выехал поверх формы кошелька, которая открыта из списка в меню
  assert.equal(Engine.topOverlay({ icons: true, dialog: true, menu: true }), 'icons');
  // экран суммы поверх карточки кошелька поверх аналитики
  assert.equal(Engine.topOverlay({ amount: true, card: true, summary: true }), 'amount');
  // лист «куда перевести» поверх карточки
  assert.equal(Engine.topOverlay({ transfer: true, card: true }), 'transfer');
  // карточка кошелька открыта из аналитики
  assert.equal(Engine.topOverlay({ card: true, summary: true }), 'card');
  // режим правки — самый нижний: пока сверху хоть что-то, назад закрывает его
  assert.equal(Engine.topOverlay({ menu: true, edit: true }), 'menu');
  assert.equal(Engine.topOverlay({ edit: true }), 'edit');
});

// ---------- закрывающие свайпы ----------
test('swipeCloses: меню закрывается сдвигом влево от 60 px', () => {
  assert.equal(Engine.SWIPE_SIDE, 60);
  assert.equal(Engine.swipeCloses(-60, 0, 'left'), true);
  assert.equal(Engine.swipeCloses(-200, 20, 'left'), true);
  assert.equal(Engine.swipeCloses(-59, 0, 'left'), false);
  assert.equal(Engine.swipeCloses(120, 0, 'left'), false, 'вправо меню не закрывается');
  // вертикальная прокрутка меню не должна его захлопывать
  assert.equal(Engine.swipeCloses(-70, 200, 'left'), false);
});

test('swipeCloses: листы закрываются сдвигом вниз от 80 px', () => {
  assert.equal(Engine.SWIPE_DOWN, 80);
  assert.equal(Engine.swipeCloses(0, 80, 'down'), true);
  assert.equal(Engine.swipeCloses(20, 150, 'down'), true);
  assert.equal(Engine.swipeCloses(0, 79, 'down'), false);
  assert.equal(Engine.swipeCloses(0, -150, 'down'), false, 'вверх лист не закрывается');
  assert.equal(Engine.swipeCloses(200, 90, 'down'), false, 'вбок — это не закрытие');
});

test('swipeCloses: неизвестное направление ничего не закрывает', () => {
  assert.equal(Engine.swipeCloses(-500, 0, 'up'), false);
  assert.equal(Engine.swipeCloses(-500, 0), false);
});
