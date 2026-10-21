/* 1.0.5: девять новых цветных иконок (лист Nano Banana Pro 17.10.2026).
   Шесть расходов, три дохода; у каждой - файл, подпись, глиф-запаска и авто-подбор
   по названию категории, не перехватывающий прежние правила. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Icons = require('../www/icons.js');

const ROOT = path.join(__dirname, '..');
const EXP = { subs: 'Подписки', wine: 'Алкоголь', cigarette: 'Сигареты', commission: 'Комиссии',
  sofa: 'Мебель', tv: 'Бытовая техника' };
const INC = { pension: 'Пенсия', benefit: 'Пособия', cashback: 'Кешбэк' };

test('1.0.5 иконки: в наборах, с подписью, файлом 128×128 и глифом', () => {
  const all = Object.assign({}, EXP, INC);
  Object.keys(EXP).forEach(k => assert.ok(Icons.SETS.exp.indexOf(k) >= 0, 'нет в расходах: ' + k));
  Object.keys(INC).forEach(k => assert.ok(Icons.SETS.inc.indexOf(k) >= 0, 'нет в доходах: ' + k));
  Object.keys(all).forEach(k => {
    assert.equal(Icons.LABELS[k], all[k], 'подпись ' + k);
    assert.ok(Icons.NAMES.indexOf(k) >= 0, 'нет в сетке выбора: ' + k);
    assert.notEqual(Icons.svg(k), Icons.svg('other'), 'глиф-запаска не нарисован: ' + k);
    const f = path.join(ROOT, 'www', 'icons-color', k + '.png');
    const b = fs.readFileSync(f);
    assert.equal(b.readUInt32BE(16), 128, k + ': ширина');
    assert.equal(b.readUInt32BE(20), 128, k + ': высота');
    assert.equal(b[25], 6, k + ': не RGBA (нет прозрачного фона)');
    assert.equal(Icons.imgFile(k, 'exp'), k);
  });
  // подписи не задваиваются: «Подписки» ровно у одной иконки, «Техника» осталась ноутбуку
  const labs = Object.values(Icons.LABELS);
  assert.equal(labs.filter(l => l === 'Подписки').length, 1, 'две иконки «Подписки»');
  assert.equal(Icons.LABELS.laptop, 'Техника');
  // старый доходный ключ «subscription» (регулярный доход) картинкой не подменился
  assert.equal(Icons.imgFile('subscription', 'inc'), null);
});

test('1.0.5 иконки: авто-подбор по названию', () => {
  const e = n => Icons.guessKind(n, 'exp'), i = n => Icons.guessKind(n, 'inc');
  [['Подписки', 'subs'], ['Стриминг', 'subs'], ['Интернет-сервисы', 'wifi'], ['Подписка на кино', 'subs'],
   ['Алкоголь', 'wine'], ['Вино', 'wine'], ['Пиво', 'wine'], ['Бар', 'wine'],
   ['Сигареты', 'cigarette'], ['Табак', 'cigarette'], ['Вейп', 'cigarette'],
   ['Комиссии', 'commission'], ['Комиссия банка', 'commission'], ['Банковское обслуживание', 'commission'],
   ['Мебель', 'sofa'], ['Новый диван', 'sofa'],
   ['Бытовая техника', 'tv'], ['Телевизор', 'tv'], ['Холодильник', 'tv']
  ].forEach(([n, k]) => assert.equal(e(n), k, n));
  [['Пенсия', 'pension'], ['Пособие на ребёнка', 'benefit'], ['Соцвыплаты', 'benefit'], ['Страховая выплата', 'coin'],   // ревью 1.0.5 К3: щита нет в наборе доходов - запасная монета ['Выплата долга', 'percent'], ['Льготы', 'benefit'],
   ['Кешбэк', 'cashback'], ['Кэшбэк', 'cashback'], ['Cashback', 'cashback']
  ].forEach(([n, k]) => assert.equal(i(n), k, n));
  // для старого API (категория без вида) доходные тоже находятся
  assert.equal(Icons.guess('Пенсия'), 'pension');
  assert.equal(Icons.guess('Кешбэк'), 'cashback');
  // прежние правила не перехвачены
  // похожие слова не уезжают в новые иконки
  ['Бытовая химия', 'Барбершоп', 'Барабан', 'Винтаж'].forEach(n =>
    assert.ok(['tv', 'wine', 'cigarette', 'subs', 'commission'].indexOf(e(n)) < 0, n + ' -> ' + e(n)));
  [['Техника', 'laptop'], ['Кафе', 'coffee'], ['Кафе и бар', 'coffee'], ['Кредит', 'percent'],
   ['Ипотека', 'percent'], ['Ремонт', 'tools'], ['Дом', 'home'],
   ['Развлечения', 'play'], ['Игры', 'dice'], ['Автосервис', 'car']
  ].forEach(([n, k]) => assert.equal(e(n), k, n));
  [['Комиссия партнёра', 'percent'], ['Подписка Pro', 'play'], ['Выплата процентов', 'chart'],
   ['Зарплата', 'salary'], ['Дивиденды', 'chart']
  ].forEach(([n, k]) => assert.equal(i(n), k, n));
});

// store/ (исходный лист иконок и опись происхождения) - внутренняя папка, в публичный репозиторий не входит
test('1.0.5 иконки: происхождение записано, исходный лист и нарезка рядом', { skip: !fs.existsSync(path.join(ROOT, 'store')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const src = fs.readFileSync(path.join(ROOT, 'store', 'ICONS-SOURCE.txt'), 'utf8');
  assert.match(src, /00042b0/);
  assert.match(src, /17\.10\.2026/);
  Object.keys(Object.assign({}, EXP, INC)).forEach(k => assert.ok(src.indexOf(k + '.png') >= 0, 'нет в описи происхождения: ' + k));
  assert.ok(fs.existsSync(path.join(ROOT, 'store', 'icons-sheets', '2026-10-17.png')));
  assert.ok(fs.existsSync(path.join(ROOT, 'store', 'icons-sheets', 'cut.py')));
});
