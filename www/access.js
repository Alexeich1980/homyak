/* access.js — флаги сборки: полный доступ, демо, стор, оплата.
   На тест-сборке полный доступ включён и данные засеваются демо. На релизе сборка
   вшивает window.HOMYAK_FULL_ACCESS=false и HOMYAK_DEMO=false (build-lib.js makeShip):
   чистый пресет + free-гейт. Значение FULL потом придёт от проверки покупки
   (RuStore Pay SDK, этап оплаты).
     STORE - сторовая сборка (window.HOMYAK_STORE=true): обновления только через
             RuStore, без скачивания APK и без подмены веб-сборки (см. update.js).
     PAY   - оплата подключена (window.HOMYAK_PAY=true). Пока SDK нет - всегда false:
             paywall прячет «Купить», UI.buyFullAccess показывает заглушку. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Access = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : {};
  // полный доступ: всё открыто, если явно не выключено (window.HOMYAK_FULL_ACCESS === false)
  var FULL = (W.HOMYAK_FULL_ACCESS !== false);
  // демо-режим первого запуска: включён, если явно не выключен
  var DEMO = (W.HOMYAK_DEMO !== false);
  // сторовая сборка: только если явно включена сборкой
  var STORE = (W.HOMYAK_STORE === true);
  // оплата подключена: только если явно включена сборкой (сейчас нигде не включается)
  var PAY = (W.HOMYAK_PAY === true);
  // reel-сборка для промо-скринкастов: полный доступ, без гейта, вместо обычного demo
  // грузятся reel-персоны и появляется скрытый переключатель (long-press по шапке).
  // Только если явно включена сборкой (build-apk.js --reel вшивает HOMYAK_REEL=true).
  var REEL = (W.HOMYAK_REEL === true);
  // релиз/стор: сборка явно выключила полный доступ. В такой сборке параметры адреса
  // (?demo, ?reel - QA-удобство браузера) ничего не включают: ui.js их игнорирует.
  var RELEASE = (W.HOMYAK_FULL_ACCESS === false);
  return { FULL: FULL, DEMO: DEMO, STORE: STORE, PAY: PAY, REEL: REEL, RELEASE: RELEASE };
});
