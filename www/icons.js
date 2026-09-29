/* icons.js — иконки тремя наборами (кошельки / расходы / доходы) + авто-подбор
   по названию. Без DOM.
   Доходы и расходы рисуются цветными иллюстрациями (www/icons-color/<имя>.png,
   128×128, прозрачный фон) — их отдаёт img(). Кошельки и служебные глифы остаются
   линейными svg() — их отдаёт svg().
   Публичное API: NAMES (объединение, для сетки выбора), SETS, LABELS, IMG,
   svg(name,size), img(name,kind,size), imgFile(name,kind), hasImg(name,kind),
   list(kind), guess(name), guessKind(name,kind). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Icons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Каждая иконка — набор <path>/<circle>/<rect> без обёртки <svg>. Всё в кадре 24×24,
  // линия 1.8, заливка только у точек-зрачков.
  var PATHS = {
    // ---------- кошельки ----------
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
    card2: '<rect x="2.5" y="4.5" width="15" height="10.5" rx="2"/><path d="M2.5 8.5h15"/><path d="M6.5 15v2.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 8v.01M18 16v.01"/>',
    coins: '<ellipse cx="12" cy="6.8" rx="7" ry="2.8"/><path d="M5 6.8v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4"/><path d="M5 10.8v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4"/><rect x="14" y="11" width="7" height="5" rx="1"/><circle cx="17" cy="13.5" r="0.6" fill="currentColor" stroke="none"/>',
    piggy: '<path d="M4.5 12a6 6 0 0 1 6-6h3.5a5 5 0 0 1 4.4 2.6l1.6.4v3l-1.8.6a5 5 0 0 1-1.7 2.6V18h-2.5v-1H10V18H7.5v-2.2A5.5 5.5 0 0 1 4.5 12z"/><circle cx="15" cy="10.2" r="0.6" fill="currentColor" stroke="none"/><path d="M8 8.5 6.5 6M4.5 12H2.5"/>',
    bank: '<path d="M3 10 12 4l9 6"/><path d="M4 10h16v2H4z"/><path d="M5 12v7M9.5 12v7M14.5 12v7M19 12v7"/><path d="M3 21h18"/>',
    safe: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="10.3" cy="12" r="3.2"/><path d="m10.3 12 2.3-2.3"/><path d="M16.6 10.2h2.2M16.6 13.8h2.2"/>',
    credit: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 9.5h19"/><path d="M13.4 11.6 10.4 15h2.7l-1.1 2.6"/>',
    bonus: '<circle cx="12" cy="12" r="9"/><path d="m12 7 1.6 3.4 3.6.4-2.7 2.5.8 3.6-3.3-1.9-3.3 1.9.8-3.6L6.8 10.8l3.6-.4z"/>',
    crypto: '<circle cx="12" cy="12" r="9"/><path d="M9.3 6.6v10.8"/><path d="M9.3 7.6h4a2.2 2.2 0 0 1 0 4.4h-4"/><path d="M9.3 12h4.4a2.2 2.2 0 0 1 0 4.4H9.3"/><path d="M11.6 5v1.6M14 5v1.6M11.6 17.4V19M14 17.4V19"/>',
    dollar: '<path d="M12 3.2v17.6"/><path d="M16.6 7.4c-.9-1.2-2.6-1.9-4.6-1.9-2.5 0-4.4 1.3-4.4 3.3 0 4.4 9 2.6 9 6.8 0 2-2 3.4-4.6 3.4-2.2 0-3.9-.8-4.8-2"/>',
    mobile: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 5.4h3"/><path d="M10 18.4h4"/>',
    envelope: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3.2 6.6 8.8 6 8.8-6"/>',
    // QR / СБП: три «глаза» по углам + пара модулей в четвёртом
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.3"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.3"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.3"/><path d="M14 14v3.4M14 20.5h3.4M20.5 14v6.5M17.4 17.4h3.1"/>',
    // Вклад под процент: монета со знаком процента внутри
    deposit: '<circle cx="12" cy="12" r="9"/><circle cx="9.4" cy="9.4" r="1.5"/><circle cx="14.6" cy="14.6" r="1.5"/><path d="m8.6 15.4 6.8-6.8"/>',
    // Зарплатная карта: карта со стрелкой вверх (доход приходит на неё)
    salcard: '<rect x="2.5" y="6" width="19" height="13" rx="2.2"/><path d="M2.5 10h19"/><path d="M12 17.6v-4.4M10.2 15l1.8-1.8 1.8 1.8"/>',

    // ---------- расходы ----------
    cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.8h8.2a2 2 0 0 0 2-1.6L21 8H6"/>',
    food: '<path d="M6 3v6a2 2 0 0 0 2 2h.6v10"/><path d="M10.6 3v6a2 2 0 0 1-2 2"/><path d="M8.3 3v5.4"/><path d="M17.6 3c-1.7 1.4-2.6 3.3-2.6 5.4 0 1.9.9 3 2.6 3.4V21"/>',
    coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z"/><path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 5c0-.9.7-1 .7-2M11 5c0-.9.7-1 .7-2"/>',
    bus: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 12h18"/><circle cx="7.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/>',
    taxi: '<path d="M4 16v-4.2l1.7-3.9a2 2 0 0 1 1.8-1.2h9a2 2 0 0 1 1.8 1.2L20 11.8V16"/><path d="M4 16h16v2.4a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1V17H7.6v1.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 12h16"/><path d="M9.6 6.7V4.6h4.8v2.1"/>',
    fuel: '<path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M4 21h10"/><path d="M14 9h2.3l2.7 3v6a1.5 1.5 0 0 1-3 0v-1.5a1 1 0 0 0-1-1H14"/><path d="M7 6v4h5V6"/>',
    car: '<path d="M4 16V11.5l1.8-4.2A2 2 0 0 1 7.6 6h8.8a2 2 0 0 1 1.8 1.3L20 11.5V16"/><path d="M4 16h16v2.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V17H7.5v1.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 12h16"/><circle cx="7.5" cy="14.2" r="0.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14.2" r="0.6" fill="currentColor" stroke="none"/>',
    parking: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M9.8 17V7.4h3.4a2.9 2.9 0 0 1 0 5.8H9.8"/>',
    bag: '<path d="M6 8h12l1 12.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 20.5L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    shirt: '<path d="M8 4 4 7l2.5 3L8 9v11h8V9l1.5 1L20 7l-4-3-2 2h-4z"/>',
    beauty: '<circle cx="6.6" cy="17.8" r="2.6"/><circle cx="17.4" cy="17.8" r="2.6"/><path d="M8.5 16 19 3.8"/><path d="M15.5 16 5 3.8"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="12" cy="12" r="1"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10.3 8.4 16 12l-5.7 3.6z"/>',
    // самолёт сверху: фюзеляж, стреловидные крылья, хвостовое оперение. Прежний контур
    // читался как вешалка - крылья были узкими, а хвост почти сливался с корпусом.
    plane: '<path d="M12 2c1.1 0 1.8 1.1 1.8 2.6v5.1L22 14.6v2.2l-8.2-2.6v4.1l2.6 2.3V22L12 20.6 7.6 22v-1.4l2.6-2.3v-4.1L2 16.8v-2.2l8.2-4.9V4.6C10.2 3.1 10.9 2 12 2z"/>',
    home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><path d="M10 20v-5h4v5"/>',
    building: '<rect x="4" y="3" width="10" height="18"/><path d="M14 8h6v13"/><path d="M7 7h1M7 11h1M7 15h1M11 7h1M11 11h1M11 15h1"/><path d="M17 12h1M17 16h1"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5l-6 6 2 2 6-6a4 4 0 0 0 5-5.4l-2.6 2.6-2-2z"/>',
    tools: '<path d="M14.6 9.4 6.5 17.5a2 2 0 0 0 2.8 2.8l8.1-8.1"/><path d="M11.3 6.1 12.8 4.6a3 3 0 0 1 4.2 0l2.4 2.4a3 3 0 0 1 0 4.2l-1.5 1.5z"/>',
    laptop: '<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M2 19h20"/>',
    wifi: '<path d="M4 9.6a12 12 0 0 1 16 0"/><path d="M7 13.1a8 8 0 0 1 10 0"/><path d="M10 16.5a3.6 3.6 0 0 1 4 0"/><circle cx="12" cy="19.6" r="1" fill="currentColor" stroke="none"/>',
    phone: '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z"/>',
    health: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    pharmacy: '<rect x="2.5" y="7" width="19" height="13" rx="2.5"/><path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7"/><path d="M12 11v5M9.5 13.5h5"/>',
    sport: '<path d="M7 12h10"/><rect x="2" y="9" width="3" height="6" rx="1"/><rect x="5" y="10" width="2" height="4" rx="0.6"/><rect x="19" y="9" width="3" height="6" rx="1"/><rect x="17" y="10" width="2" height="4" rx="0.6"/>',
    baby: '<rect x="8" y="10" width="8" height="10" rx="2"/><path d="M9.5 10V8a2.5 2.5 0 0 1 5 0v2"/><path d="M9 8h6"/><path d="M8 15h8"/>',
    pet: '<ellipse cx="12" cy="16.5" rx="4.3" ry="3.3"/><circle cx="6.5" cy="10" r="1.8"/><circle cx="10.5" cy="7" r="1.8"/><circle cx="14.5" cy="7" r="1.8"/><circle cx="18" cy="10" r="1.8"/>',
    education: '<path d="M2 8 12 4l10 4-10 4z"/><path d="M6 11v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5"/><path d="M21 9v6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 21.5v-16z"/><path d="M4 19a2.5 2.5 0 0 1 2.5-2.5H20"/>',
    gift: '<rect x="3" y="9" width="18" height="4"/><rect x="5" y="13" width="14" height="8"/><path d="M12 9v12"/><path d="M12 9C9 9 8 7.5 8 6.3 8 5 9 4 10.2 4 11.7 4 12 6.5 12 9z"/><path d="M12 9c3 0 4-1.5 4-2.7C16 5 15 4 13.8 4 12.3 4 12 6.5 12 9z"/>',
    heart: '<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.3a4.7 4.7 0 0 1 8.5 2.9C20.5 15 12 20.5 12 20.5z"/>',
    flower: '<circle cx="12" cy="12" r="2.3"/><circle cx="12" cy="6" r="2.7"/><circle cx="12" cy="18" r="2.7"/><circle cx="6" cy="12" r="2.7"/><circle cx="18" cy="12" r="2.7"/>',
    briefcase: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/><path d="M10.5 13h3v2h-3z"/>',
    percent: '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M18 6 6 18"/>',
    tax: '<path d="M6 3h7l5 5v12.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V3.5a.5.5 0 0 1 .5-.5z"/><path d="M13 3v5h5"/><circle cx="9.9" cy="13.4" r="1.1"/><circle cx="14.1" cy="17.2" r="1.1"/><path d="m14.8 12.7-5.6 5.2"/>',
    shield: '<path d="M12 3.2 20 6v6c0 4.5-3.3 7.6-8 8.8C7.3 19.6 4 16.5 4 12V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
    fine: '<circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.4"/><circle cx="12" cy="16.3" r="1" fill="currentColor" stroke="none"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 2.6 4.3 5.8 4.3 9s-1.5 6.4-4.3 9c-2.8-2.6-4.3-5.8-4.3-9s1.5-6.4 4.3-9z"/>',
    music: '<path d="M9 18V5.5L20 3v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>',
    skull: '<path d="M6 12a6 6 0 0 1 12 0c0 2-.9 3-1.5 4.3V19a1 1 0 0 1-1 1h-1v-2h-1v2h-2v-2h-1v2H9.5a1 1 0 0 1-1-1v-2.7C7.9 15 6 14 6 12z"/><circle cx="9.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
    other: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',

    // ---------- доходы ----------
    salary: '<rect x="2" y="6.5" width="20" height="11" rx="2"/><circle cx="9" cy="12" r="2.6"/><path d="M17.2 15.6V9"/><path d="m15.3 10.9 1.9-1.9 1.9 1.9"/>',
    consult: '<path d="M20.5 12.2c0 3.9-3.8 7.1-8.5 7.1-1 0-1.9-.1-2.8-.4L4.2 20.4l1.6-3.6a6.8 6.8 0 0 1-2.3-4.6C3.5 8.2 7.3 5 12 5s8.5 3.2 8.5 7.2z"/><circle cx="8.7" cy="12.2" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12.2" r="0.9" fill="currentColor" stroke="none"/><circle cx="15.3" cy="12.2" r="0.9" fill="currentColor" stroke="none"/>',
    homekey: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><circle cx="12" cy="13.6" r="1.8"/><path d="M12 15.4V19"/><path d="M12 17.6h1.7"/>',
    bizup: '<rect x="2.5" y="8" width="19" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m7.8 16.4 2.9-3 2.2 2 3.3-3.8"/><path d="M16.2 11.6h1.6v1.7"/>',
    chart: '<path d="M3.5 3.5v17h17"/><path d="m7 15.4 3.6-4.1 3 2.4 4.6-5.7"/><path d="M18.2 8h-2.7M18.2 8v2.7"/>',
    pricetag: '<path d="M11.2 3H20a1 1 0 0 1 1 1v8.8a1 1 0 0 1-.3.7l-7.2 7.2a1 1 0 0 1-1.4 0l-8.8-8.8a1 1 0 0 1 0-1.4l7.2-7.2a1 1 0 0 1 .7-.3z"/><circle cx="16.6" cy="7.4" r="1.5"/>',
    code: '<path d="M8.4 8.4 4 12l4.4 3.6"/><path d="M15.6 8.4 20 12l-4.4 3.6"/><path d="m13.4 5.4-2.8 13.2"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M9.3 15c.6.6 1.4 1 2.5 1 1.9 0 3.2-1 3.2-2.6 0-3.3-5.6-2.4-5.6-5.6C9.4 6.2 10.8 5.2 12.6 5.2c1.1 0 1.9.4 2.5 1"/><path d="M12 4v1.2M12 18.8V20"/>',
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3a9 9 0 0 1 9 9"/>',
    star: '<path d="m12 3.5 2.5 5.6 6 .6-4.6 4 1.3 6-5.2-3.2-5.2 3.2 1.3-6-4.6-4 6-.6z"/>',
    subscription: '<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M4.5 15a8 8 0 0 0 14 3l1.5-2"/><path d="M19.5 9a8 8 0 0 0-14-3L4 8"/>'
  };

  // Русские подписи — для галереи и подсказок.
  var LABELS = {
    card: 'Карта', card2: 'Вторая карта', cash: 'Наличные', coins: 'Монеты', wallet: 'Кошелёк',
    piggy: 'Копилка', bank: 'Банк', safe: 'Накопительный', credit: 'Кредитка', bonus: 'Бонусный счёт',
    crypto: 'Крипта', dollar: 'Валюта', mobile: 'Телефон', envelope: 'Конверт',
    qr: 'QR / СБП', deposit: 'Вклад', salcard: 'Зарплатная карта',

    cart: 'Магазины', food: 'Еда вне дома', coffee: 'Кафе', bus: 'Транспорт', taxi: 'Такси',
    fuel: 'Бензин', car: 'Авто', parking: 'Парковка', bag: 'Шопинг', shirt: 'Одежда',
    beauty: 'Красота', dice: 'Развлечения', play: 'Подписки', plane: 'Путешествия', home: 'Дом',
    building: 'Аренда', wrench: 'ЖКХ', tools: 'Ремонт', laptop: 'Техника', wifi: 'Связь, интернет',
    phone: 'Звонки', health: 'Здоровье', pharmacy: 'Аптека', sport: 'Спорт', baby: 'Дети',
    pet: 'Питомцы', education: 'Образование', book: 'Книги', gift: 'Подарки', heart: 'Отношения',
    flower: 'Благотворительность', briefcase: 'Бизнес', percent: 'Кредиты', tax: 'Налоги',
    shield: 'Страховка', fine: 'Штрафы', globe: 'Мир', music: 'Музыка', skull: 'Вредное',
    other: 'Прочее',

    salary: 'Зарплата', consult: 'Консультации', homekey: 'Рента', bizup: 'Бизнес-доход',
    chart: 'Проценты, дивиденды', pricetag: 'Продажа', code: 'Вайбкодинг', coin: 'Гонорар',
    pie: 'Доля', star: 'Бонусы', subscription: 'Регулярный доход'
  };

  var SETS = {
    // Только кошельково-осмысленные монохромные глифы (рисуются svg() в цвет кошелька).
    wallet: ['card', 'card2', 'salcard', 'cash', 'coins', 'wallet', 'piggy', 'bank',
             'safe', 'deposit', 'credit', 'bonus', 'crypto', 'dollar', 'mobile',
             'qr', 'envelope'],
    exp: ['cart', 'food', 'coffee', 'bus', 'taxi', 'fuel', 'car', 'parking', 'bag', 'shirt',
          'beauty', 'dice', 'play', 'plane', 'home', 'building', 'wrench', 'tools', 'laptop',
          'wifi', 'phone', 'health', 'pharmacy', 'sport', 'baby', 'pet', 'education', 'book',
          'gift', 'heart', 'flower', 'briefcase', 'percent', 'tax', 'shield', 'fine', 'other'],
    inc: ['salary', 'consult', 'homekey', 'bizup', 'chart', 'pricetag', 'crypto', 'code',
          'percent', 'coin', 'education', 'play', 'gift', 'other']
  };

  // объединение наборов + старые имена (в сохранённых данных могли остаться) — сетка выбора берёт его
  var NAMES = (function () {
    var out = [], seen = {};
    function add(list) {
      for (var i = 0; i < list.length; i++) {
        if (!seen[list[i]] && PATHS[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
      }
    }
    add(SETS.wallet); add(SETS.exp); add(SETS.inc);
    add(Object.keys(PATHS));
    return out;
  })();

  function svg(name, size) {
    size = size || 28;
    var body = PATHS[name] || PATHS.other;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  // ---------- цветные иллюстрации доходов и расходов ----------
  // Список ФАЙЛОВ папки icons-color (без .png). Держим руками, а не чтением диска:
  // icons.js работает и в браузере, и в node-тестах. Три имени с хвостом «-inc» —
  // свой вариант для дохода там, где смысл у дохода другой (подарок пришёл, а не ушёл;
  // проценты капают, а не списываются).
  var IMG_DIR = 'icons-color/';
  var IMG_LIST = [
    'baby', 'bag', 'beauty', 'bizup', 'book', 'briefcase', 'building', 'bus', 'car',
    'cart', 'chart', 'code', 'coffee', 'coin', 'consult', 'crypto', 'dice', 'education',
    'fine', 'flower', 'food', 'fuel', 'gift', 'gift-inc', 'health', 'heart', 'home',
    'homekey', 'laptop', 'other', 'other-inc', 'parking', 'percent', 'percent-inc',
    'pet', 'pharmacy', 'phone', 'plane', 'play', 'pricetag', 'salary', 'shield',
    'shirt', 'sport', 'tax', 'taxi', 'tools', 'wifi', 'wrench'
  ];
  var IMG = (function () { var m = {}; IMG_LIST.forEach(function (n) { m[n] = 1; }); return m; })();

  // Какой файл рисовать под это имя. Для дохода сначала пробуем «<имя>-inc».
  // null = картинки нет (старые/чужие ключи вроде «star») — рисуем линейный глиф.
  function imgFile(name, kind) {
    var n = String(name || '');
    if (kind === 'inc' && IMG[n + '-inc']) return n + '-inc';
    return IMG[n] ? n : null;
  }
  function hasImg(name, kind) { return !!imgFile(name, kind); }

  // ---------- цветная «фишка» для категорий без иллюстрации ----------
  // Раньше категория без файла в icons-color рисовалась голым линейным глифом и на
  // экране читалась как «иконки нет / серая линия». Теперь любая такая категория
  // рисуется цветным кружком: глиф внутри диска, тон стабильно выводится из ключа
  // (id/имя категории) той же палитрой, что и всё приложение (--hue-0..5). Кошельки
  // это не трогает — у них свой линейный svg().
  //
  // Цвета зашиты числами (не CSS-переменными): фишка работает одинаково в тёмной и
  // светлой теме, в любом контейнере (кольцо, строка аналитики, выбор иконок) и в
  // node-тестах. Диск — тот же тон с прозрачностью (ложится на любой фон), глиф —
  // насыщенный тон, читается на диске.
  var CHIP = [
    { g: '#2FB89A', d: 'rgba(62,210,176,.20)' },       // teal   (--hue-0)
    { g: '#E76A58', d: 'rgba(242,123,106,.20)' },       // coral  (--hue-1)
    { g: '#9B78E8', d: 'rgba(177,140,242,.20)' },       // purple (--hue-2)
    { g: '#4B9FE6', d: 'rgba(95,178,240,.20)' },        // blue   (--hue-3)
    { g: '#D19A2E', d: 'rgba(242,200,91,.24)' },        // yellow (--hue-4)
    { g: '#E17BB0', d: 'rgba(242,139,192,.20)' }        // pink   (--hue-5)
  ];

  // Стабильный индекс тона 0..5 из строки-ключа. Чистая функция, детерминированная.
  function hueFor(key) {
    var s = String(key == null ? '' : key), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % CHIP.length;
  }

  // Разметка цветной фишки: диск + линейный глиф, оба в тоне hueFor(hueKey||name).
  function chip(name, kind, size, hueKey) {
    size = size || 28;
    var body = PATHS[name] || PATHS.other;
    var c = CHIP[hueFor(hueKey != null ? hueKey : name)];
    return '<svg class="ico-chip" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="' + c.g + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:' + c.g + '">' +
      '<circle cx="12" cy="12" r="12" fill="' + c.d + '" stroke="none"/>' + body + '</svg>';
  }

  // Готовая разметка иконки категории: картинка, а если её нет — цветная фишка
  // (диск + глиф), но не голый серый глиф. hueKey (id/имя категории) даёт тон;
  // без него тон берётся из имени иконки. Кошельки рисуются через svg(), не сюда.
  function img(name, kind, size, hueKey) {
    var f = imgFile(name, kind);
    if (!f) return chip(name, kind, size, hueKey);
    size = size || 28;
    return '<img class="ico-img" src="' + IMG_DIR + f + '.png" width="' + size +
      '" height="' + size + '" alt="" draggable="false">';
  }

  // list() — весь набор (как раньше NAMES), list('wallet'|'exp'|'inc') — один набор
  function list(kind) {
    var s = SETS[kind];
    return (s ? s : NAMES).slice();
  }

  // Порядок важен: первое совпадение побеждает.
  var WALLET_TABLE = [
    [/зарплат/i, 'salcard'],
    [/налич|кэш|cash/i, 'cash'],
    [/монет|мелоч/i, 'coins'],
    [/копилк|подушк/i, 'piggy'],
    [/бонус|кэшб|cashback|мил[ья]/i, 'bonus'],
    [/халв|рассроч|кредитк|кредитн/i, 'credit'],
    [/вклад|депозит/i, 'deposit'],
    [/накопит|сейф|запас/i, 'safe'],
    [/крипт|биткоин|bitcoin|btc|usdt|эфир/i, 'crypto'],
    [/доллар|валют|евро|\$/i, 'dollar'],
    [/сбп|\bqr\b|куар/i, 'qr'],
    [/конверт|заначк/i, 'envelope'],
    [/ю\s?money|юмани|qiwi|киви|мобильн|телефон/i, 'mobile'],
    [/вторая|доп\.?\s*карт/i, 'card2'],
    [/сбер|т-?банк|тбанк|t-?bank|альфа|втб|райф|озон|ozon|яндекс|екп|газпром|почта|мтс|псб|открыт|совком|уралсиб|карт|visa|mastercard|мир\b/i, 'card'],
    [/банк|счёт|счет|брокер|инвест/i, 'bank'],
    [/кошел|wallet/i, 'wallet']
  ];

  var EXP_TABLE = [
    [/магазин|продукт|супермаркет|пятёр|пятер|лент[ае]?\b/i, 'cart'],
    [/кафе|ресторан|кофе|бар\b/i, 'coffee'],
    [/еда\s*вне|обед|фастфуд|доставк.*ед|общепит|ед[аы]\b/i, 'food'],
    [/такси|яндекс.?go|uber/i, 'taxi'],
    [/парков|стоянк/i, 'parking'],
    [/транспорт|метро|автобус|проезд/i, 'bus'],
    [/бензин|топлив|заправ/i, 'fuel'],
    [/кредит|рассроч|ипотек|займ|долг|процент|комис/i, 'percent'],
    [/авто|машин|каршер/i, 'car'],
    [/шопинг|покупк/i, 'bag'],
    [/одежд|обув/i, 'shirt'],
    [/красот|парикмах|маникюр|космет|салон/i, 'beauty'],
    [/развлеч|кино|игр[аы]/i, 'dice'],
    [/подпис|сервис[ыс]?\b|streaming/i, 'play'],
    [/путеш|отпуск|отель|туризм/i, 'plane'],
    [/аренд|съём|съем|квартплат/i, 'building'],
    [/жкх|коммун|электр|вода|газ\b/i, 'wrench'],
    [/ремонт|стройк|мастер/i, 'tools'],
    [/техник|гаджет|ноут|компьют|электрон/i, 'laptop'],
    [/связь|интернет|мобильн|тариф/i, 'wifi'],
    [/аптек|лекарств|таблет/i, 'pharmacy'],
    [/здоров|врач|мед|стомат|анализ/i, 'health'],
    [/спорт|фитнес|зал\b|бассейн/i, 'sport'],
    [/ваня|дет[иеяй]|ребён|ребен|школ|сад(ик)?\b|нянь/i, 'baby'],
    [/питом|кот|кош|соба|зоо/i, 'pet'],
    [/обуч|курс|образован|учёб|учеб|универ/i, 'education'],
    [/книг|литерат/i, 'book'],
    [/подар|презент/i, 'gift'],
    [/отношен|свидан|цвет[ыи]\b/i, 'heart'],
    [/благотв|пожертв|десятин|помощ/i, 'flower'],
    [/бизнес|работ[аы]|офис/i, 'briefcase'],
    [/налог|ндфл|нпд|усн/i, 'tax'],
    [/страхов|осаго|каско|полис/i, 'shield'],
    [/штраф|пени|неустой/i, 'fine'],
    [/дом|жиль[ёе]/i, 'home'],
    [/звонк|телефон/i, 'phone'],
    [/непредвид|прочее|другое|разное/i, 'other']
  ];

  // Реальные названия из «Бюджета года» («Комса ICN», «Аренда, Кайе-т…», «Курсы (1,3 …)»,
  // «Подписка LF») раньше не ловились ни одной строкой и молча уезжали в «Прочее» —
  // на экране это выглядело как «иконки у доходов пустые».
  var INC_TABLE = [
    [/зарплат|оклад|^\s*зп\s*$|аванс/i, 'salary'],
    [/консульт|сопровожд|коуч|наставн|разбор/i, 'consult'],
    [/комса|комис|агентск|партн/i, 'percent'],
    [/дивиденд|купон|облигац|вклад|депозит|процент/i, 'chart'],
    [/рент|аренд|сдач[аи]|наём|наем/i, 'homekey'],
    [/курс|обуч|образован|тренинг|вебинар|интенсив|школ/i, 'education'],
    [/подписк|абонемент|членск/i, 'play'],
    [/крипт|биткоин|btc|usdt/i, 'crypto'],
    [/вайбкод|код|разработ|фриланс|it\b/i, 'code'],
    [/продаж|продал|реализац|выручк/i, 'pricetag'],
    [/бизнес|компан|дело\b|проект/i, 'bizup'],
    [/гонорар|honorar|выступл|лекц/i, 'coin'],
    [/подар|наслед|возврат/i, 'gift'],
    [/проч|друго|разное|иное/i, 'other']
  ];

  function match(table, s) {
    for (var i = 0; i < table.length; i++) if (table[i][0].test(s)) return table[i][1];
    return null;
  }

  // Запасная иконка своя на каждый вид: пустой плитки не бывает никогда. У доходов
  // «три точки» читались как «иконки нет» — там запасная это монета.
  var FALLBACK = { wallet: 'wallet', inc: 'coin', exp: 'other', cat: 'other' };
  function fallback(kind) { return FALLBACK[kind] || 'other'; }

  // подбор внутри одного набора: kind = 'wallet' | 'exp' | 'inc'
  function guessKind(name, kind) {
    var s = String(name || '');
    if (kind === 'wallet') return match(WALLET_TABLE, s) || FALLBACK.wallet;
    if (kind === 'inc') return match(INC_TABLE, s) || match(EXP_TABLE, s) || FALLBACK.inc;
    return match(EXP_TABLE, s) || match(INC_TABLE, s) || FALLBACK.exp;
  }

  // старое API: категории (расходы важнее — их больше), с добором из доходов
  function guess(categoryName) {
    return guessKind(categoryName, 'cat');
  }

  // Нормализация сохранённого ключа иконки кошелька к текущему набору: если ключ
  // выпал из набора (старый/просочившийся из категорий) — падаем на 'wallet', чтобы
  // плитка не рисовала категорийный или пустой глиф. Кошельки всегда монохромны.
  var WALLET_SET = {};
  SETS.wallet.forEach(function (k) { WALLET_SET[k] = 1; });
  function walletKey(key) {
    return (key && WALLET_SET[key] && PATHS[key]) ? key : 'wallet';
  }

  return {
    NAMES: NAMES, SETS: SETS, LABELS: LABELS, IMG: IMG, IMG_DIR: IMG_DIR,
    svg: svg, img: img, chip: chip, hueFor: hueFor, imgFile: imgFile, hasImg: hasImg,
    list: list, guess: guess, guessKind: guessKind, fallback: fallback, walletKey: walletKey
  };
});
