/* pay-config.js — ЕДИНОЕ место для боевых идентификаторов RuStore Pay.
   Подставить из RuStore Консоли (rustore.ru/console) перед боевым релизом.

   PRODUCT_ID     — id товара «Полный доступ». Тип товара в Консоли: НЕПОТРЕБЛЯЕМЫЙ
                    (NON_CONSUMABLE) — разовая покупка навсегда, без подписки.
   CONSOLE_APP_ID — id приложения из RuStore Консоли (цифры из адреса
                    https://console.rustore.ru/apps/<ID>/versions). То же значение ОБЯЗАНО стоять в
                    android/app/src/main/res/values/strings.xml (rustore_console_app_id): нативный
                    SDK читает id оттуда. Руками не правь - одна команда вписывает id в оба места:
                      node build-apk.js --store --app-id=<ID>
                    Рассинхрон двух мест валит сборку; APK после сборки сверяется (build-lib verifyApk).

   С заглушкой (PLACEHOLDER): стор-сборка = КАНДИДАТ, нативная покупка отвечает
   «оплата не сконфигурирована» и НЕ выдаёт Pro бесплатно; в браузере/деве - MockPayment.

   UMD: в браузере — window.PayConfig; в node (тесты) — module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PayConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PLACEHOLDER = 'РАЗМЕСТИТЬ_APP_ID_ИЗ_RUSTORE_CONSOLE';
  return {
    PRODUCT_ID: 'full_access',
    CONSOLE_APP_ID: '2063760325',
    PLACEHOLDER: PLACEHOLDER,
    // боевой ли id вписан (не плейсхолдер/не пусто) — заглушкой пользуется только диагностика,
    // выбор mock/real делает окружение (нативный плагин сам знает про strings.xml).
    isConfigured: function () {
      var v = this.CONSOLE_APP_ID;
      return !!v && v.trim() !== '' && v.indexOf('РАЗМЕСТИТЬ') !== 0;
    }
  };
});
