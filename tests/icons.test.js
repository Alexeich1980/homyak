const test = require('node:test');
const assert = require('node:assert/strict');
const Icons = require('../www/icons.js');

test('svg отдаёт валидный svg для каждого имени', () => {
  Icons.NAMES.forEach(n => {
    const s = Icons.svg(n, 28);
    assert.match(s, /^<svg [^>]*viewBox="0 0 24 24"/);
    assert.match(s, /stroke="currentColor"/);
    assert.match(s, /<\/svg>$/);
  });
  assert.equal(Icons.svg('nope'), Icons.svg('other'));
});

test('guess по названию категории', () => {
  assert.equal(Icons.guess('Магазины'), 'cart');
  assert.equal(Icons.guess('Транспорт'), 'bus');
  assert.equal(Icons.guess('Здоровье'), 'health');
  assert.equal(Icons.guess('ЖКХ СПБ'), 'wrench');
  assert.equal(Icons.guess('Аренда СПБ'), 'building');
  assert.equal(Icons.guess('Ваня'), 'baby');
  assert.equal(Icons.guess('Консультации'), 'consult');
  assert.equal(Icons.guess('Что-то странное'), 'other');
});

test('guessKind: у каждого вида своя запасная иконка, пустых не бывает', () => {
  assert.equal(Icons.guessKind('Абракадабра', 'wallet'), 'wallet');
  assert.equal(Icons.guessKind('Абракадабра', 'inc'), 'coin');
  assert.equal(Icons.guessKind('Абракадабра', 'exp'), 'other');
  // ни одно имя не даёт пустую иконку: svg всегда со «дном» из PATHS
  ['', null, undefined, '   ', '¤%№'].forEach(n => {
    ['wallet', 'inc', 'exp'].forEach(k => {
      const g = Icons.guessKind(n, k);
      assert.ok(g && Icons.NAMES.indexOf(g) >= 0, `${k}/${JSON.stringify(n)} → ${g}`);
    });
  });
});

test('guessKind: настоящие источники дохода из «Бюджета года»', () => {
  assert.equal(Icons.guessKind('Комса ICN', 'inc'), 'percent');
  assert.equal(Icons.guessKind('Комиссия партнёра', 'inc'), 'percent');
  assert.equal(Icons.guessKind('Аренда, Кайе-т…', 'inc'), 'homekey');
  assert.equal(Icons.guessKind('Курсы (1,3 …)', 'inc'), 'education');
  assert.equal(Icons.guessKind('Обучение', 'inc'), 'education');
  assert.equal(Icons.guessKind('Подписка LF', 'inc'), 'play');
  assert.equal(Icons.guessKind('Фриланс', 'inc'), 'code');
  assert.equal(Icons.guessKind('Вайбкодинг', 'inc'), 'code');
  assert.equal(Icons.guessKind('Прочее', 'inc'), 'other');
  assert.equal(Icons.guessKind('Прочие поступления', 'inc'), 'other');
});

test('guessKind: Т-Банк во всех написаниях — карта', () => {
  ['Т-Банк', 'Тбанк', 'т-банк', 'T-Bank', 'tbank', 'Т-Банк Black'].forEach(n => {
    assert.equal(Icons.guessKind(n, 'wallet'), 'card', n);
  });
});

test('набор кошельков: чистый монохромный, 17 глифов, без категорийных иконок', () => {
  const want = ['card', 'card2', 'salcard', 'cash', 'coins', 'wallet', 'piggy', 'bank',
    'safe', 'deposit', 'credit', 'bonus', 'crypto', 'dollar', 'mobile', 'qr', 'envelope'];
  assert.deepEqual(Icons.SETS.wallet, want, 'набор кошельков разошёлся с ожидаемым');
  assert.equal(Icons.SETS.wallet.length, 17);
  // новые глифы нарисованы
  ['qr', 'deposit', 'salcard'].forEach(k => {
    assert.ok(Icons.SETS.wallet.indexOf(k) >= 0, `нет ${k} в наборе`);
  });
  // явно категорийные иконки (еда, такси, магазины и т.п.) в наборе кошельков не мелькают
  ['cart', 'food', 'coffee', 'taxi', 'bus', 'car', 'shirt', 'health', 'gift', 'other']
    .forEach(k => assert.ok(Icons.SETS.wallet.indexOf(k) < 0, `категорийная иконка ${k} в наборе кошельков`));
  // каждый ключ кошелька рисуется монохромным линейным svg (currentColor, без заливки-фишки)
  Icons.SETS.wallet.forEach(k => {
    const s = Icons.svg(k, 22);
    assert.match(s, /stroke="currentColor"/, `${k}: не монохромный`);
    assert.doesNotMatch(s, /ico-chip/, `${k}: цветная фишка вместо глифа`);
    assert.ok(!/fill="(?!none)/.test(s.replace(/fill="currentColor"/g, '')), `${k}: подозрительная заливка`);
  });
});

test('walletKey: сохранённый ключ приводится к набору кошельков', () => {
  // ключ из набора остаётся
  ['card', 'qr', 'deposit', 'salcard', 'wallet'].forEach(k => assert.equal(Icons.walletKey(k), k));
  // категорийный/чужой/пустой ключ падает на wallet, не на пустоту и не на картинку
  ['cart', 'food', 'star', 'nope', '', null, undefined].forEach(k => {
    assert.equal(Icons.walletKey(k), 'wallet', `walletKey(${JSON.stringify(k)})`);
  });
});

test('guess по настоящим названиям кошельков', () => {
  const g = n => Icons.guessKind(n, 'wallet');
  assert.equal(g('ЕКП'), 'card');
  assert.equal(g('Т-Банк'), 'card');
  assert.equal(g('Сбербанк'), 'card');
  assert.equal(g('Альфа-Банк'), 'card');
  assert.equal(g('Халва'), 'credit');
  assert.equal(g('Кредитка'), 'credit');
  assert.equal(g('Наличные'), 'cash');
  assert.equal(g('Бонусный счёт'), 'bonus');
  assert.equal(g('Накопительный'), 'safe');
  assert.equal(g('Запас'), 'safe');
  assert.equal(g('Крипта'), 'crypto');
  assert.equal(g('Вклад'), 'deposit');
  assert.equal(g('Депозит в банке'), 'deposit');
  assert.equal(g('Зарплатная карта'), 'salcard');
  assert.equal(g('Зарплатный проект'), 'salcard');
  assert.equal(g('СБП'), 'qr');
  assert.equal(g('QR-кошелёк'), 'qr');
});

/* Цветные иллюстрации доходов и расходов (www/icons-color/*.png).
   Разрешение имени - чистая функция, её и проверяем без браузера; заодно сверяем
   список с настоящей папкой, чтобы «файл есть, а в списке нет» не всплыло на телефоне. */
const fs = require('node:fs');
const path = require('node:path');
const COLOR_DIR = path.join(__dirname, '..', 'www', 'icons-color');

test('imgFile: у дохода свой вариант там, где он нарисован', () => {
  assert.equal(Icons.imgFile('gift', 'inc'), 'gift-inc');
  assert.equal(Icons.imgFile('percent', 'inc'), 'percent-inc');
  assert.equal(Icons.imgFile('other', 'inc'), 'other-inc');
  // тот же ключ у расхода - обычный файл
  assert.equal(Icons.imgFile('gift', 'exp'), 'gift');
  assert.equal(Icons.imgFile('percent', 'exp'), 'percent');
  assert.equal(Icons.imgFile('other', 'exp'), 'other');
  // где своего варианта нет, доход берёт общий файл
  assert.equal(Icons.imgFile('education', 'inc'), 'education');
  assert.equal(Icons.imgFile('crypto', 'inc'), 'crypto');
  assert.equal(Icons.imgFile('play', 'inc'), 'play');
});

test('imgFile: у ключей без картинки - null (падаем на глиф)', () => {
  ['star', 'pie', 'globe', 'music', 'skull', 'subscription', 'nope', '', null, undefined]
    .forEach(n => {
      assert.equal(Icons.imgFile(n, 'exp'), null, String(n));
      assert.equal(Icons.imgFile(n, 'inc'), null, String(n));
      assert.equal(Icons.hasImg(n, 'exp'), false, String(n));
    });
});

test('img: картинка для своих ключей, цветная фишка для чужих', () => {
  assert.equal(Icons.img('cart', 'exp', 32),
    '<img class="ico-img" src="icons-color/cart.png" width="32" height="32" alt="" draggable="false">');
  assert.match(Icons.img('gift', 'inc', 20), /src="icons-color\/gift-inc\.png"/);
  assert.match(Icons.img('gift', 'exp', 20), /src="icons-color\/gift\.png"/);
  // нет картинки - цветная фишка (диск + глиф), а НЕ голый линейный svg
  assert.equal(Icons.img('star', 'inc', 20), Icons.chip('star', 'inc', 20));
  assert.equal(Icons.img('nope', 'exp', 20), Icons.chip('nope', 'exp', 20));
  assert.match(Icons.img('star', 'inc', 20), /class="ico-chip"/);
  // размер по умолчанию как у svg
  assert.match(Icons.img('cart', 'exp'), /width="28" height="28"/);
});

test('hueFor: стабильный индекс тона 0..5', () => {
  ['', 'a', 'Комса ICN', 'Родин (1,3 млн)', 'Рента Финам', 'star', null, undefined]
    .forEach(k => {
      const h = Icons.hueFor(k);
      assert.ok(Number.isInteger(h) && h >= 0 && h < 6, `hueFor(${JSON.stringify(k)})=${h} вне палитры`);
      assert.equal(Icons.hueFor(k), Icons.hueFor(k), 'нестабильна');
    });
  // разные ключи дают распределение по палитре (не всё в один тон)
  const seen = new Set(['Комса ICN', 'Родин (1,3 млн)', 'Рента Финам', 'Аренда, Кайе-т', 'Курсы (1,3 …)', 'Подписка LF']
    .map(n => Icons.hueFor(n)));
  assert.ok(seen.size >= 2, 'все имена свалились в один тон');
});

test('chip: всегда цветная фишка — диск + тонированный глиф, не голая линия', () => {
  const c = Icons.chip('star', 'inc', 26, 'Родин (1,3 млн)');
  assert.match(c, /^<svg class="ico-chip"/);
  assert.match(c, /<circle[^>]*fill="rgba\(/);          // цветной диск
  assert.match(c, /stroke="#[0-9A-Fa-f]{6}"/);          // тонированный глиф
  assert.match(c, /width="26" height="26"/);
  // неизвестный ключ падает на глиф «other», но всё равно цветной фишкой
  assert.match(Icons.chip('nope', 'exp', 20), /class="ico-chip"/);
  // тон определяется hueKey, а не именем иконки: одинаковый глиф, разные ключи —
  // цвета совпадают ровно тогда, когда совпадает hueFor
  const a = Icons.chip('star', 'inc', 26, 'Комса ICN');
  const b = Icons.chip('star', 'inc', 26, 'Рента Финам');
  assert.equal(a === b, Icons.hueFor('Комса ICN') === Icons.hueFor('Рента Финам'));
});

test('у каждого ключа расходов и доходов есть файл картинки', () => {
  Icons.SETS.exp.concat(Icons.SETS.inc).forEach(n => {
    ['exp', 'inc'].forEach(k => {
      const f = Icons.imgFile(n, k);
      assert.ok(f, `нет картинки для ${k}/${n}`);
      assert.ok(fs.existsSync(path.join(COLOR_DIR, f + '.png')), `нет файла ${f}.png`);
    });
  });
  // запасные иконки тоже нарисованы: пустой плитки не бывает
  assert.ok(Icons.hasImg(Icons.fallback('exp'), 'exp'));
  assert.ok(Icons.hasImg(Icons.fallback('inc'), 'inc'));
});

test('список картинок совпадает с папкой icons-color', () => {
  const disk = fs.readdirSync(COLOR_DIR).filter(f => f.endsWith('.png'))
    .map(f => f.slice(0, -4)).sort();
  assert.deepEqual(Object.keys(Icons.IMG).sort(), disk, 'список в icons.js разошёлся с папкой');
});
