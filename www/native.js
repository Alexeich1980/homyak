/* native.js — мост к родным возможностям телефона.
   Грузится сразу после capacitor.js (@capacitor/core 6.2.2, файл capacitor.js —
   копия node_modules/@capacitor/core/dist/capacitor.js, обновлять вместе с зависимостью).

   Сам по себе Capacitor не знает про плагины: без явной регистрации Capacitor.Plugins.*
   пустые, и любой вызов уходит в никуда. Поэтому регистрируем нужные плагины руками
   и кладём их в window.NativePlugins.

   В обычном браузере (QA на компе) window.Capacitor есть, но моста нет:
   Capacitor.isNativePlatform() === false, а вызовы плагинов падают обещанием
   «not implemented». Поэтому каждый, кто ими пользуется, проверяет
   Capacitor.isNativePlatform() и держит запасной путь для браузера. */
(function () {
  'use strict';

  var C = window.Capacitor;
  if (!C || typeof C.registerPlugin !== 'function') return;   // capacitor.js не загрузился

  try {
    window.NativePlugins = {
      Haptics: C.registerPlugin('Haptics'),
      Filesystem: C.registerPlugin('Filesystem'),
      // SaveFile — свой плагин оболочки (android/.../SaveFilePlugin.java): открывает
      // системное окно «Сохранить как» и пишет байты туда, куда указал хозяин.
      // Им уходит бэкап: «Поделиться» вместо выбора папки хозяина путала.
      SaveFile: C.registerPlugin('SaveFile'),
      // WebView — родной плагин Capacitor: им бесшовное обновление переставляет
      // приложение на распакованную папку (update.js), им же boot.js откатывает назад.
      WebView: C.registerPlugin('WebView'),
      // App (@capacitor/app 6.0.3) нужен ровно ради одного: versionName из APK.
      App: C.registerPlugin('App'),
      // RuStorePay — свой плагин оболочки (android/.../RuStorePayPlugin.java): разовая
      // покупка «Полного доступа» через RuStore Pay SDK и восстановление покупки.
      // На девайсе с боевым console_app_id — реальная оплата; с заглушкой отвечает
      // «не сконфигурировано»; в браузере/деве pay.js уходит на MockPayment.
      RuStorePay: C.registerPlugin('RuStorePay')
    };
  } catch (e) {
    window.NativePlugins = null;
  }

  // телефон (APK) или обычный браузер — один вопрос, один ответ на всё приложение
  window.isNativeApp = function () {
    try { return !!(C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; }
  };

  // Версия ОБОЛОЧКИ (APK) — это не то же самое, что версия веб-сборки в version.js:
  // бесшовное обновление подменяет www целиком, и APP_VERSION уезжает вперёд, а APK
  // остаётся прежним. Номер оболочки спрашиваем у Android, а не у подменяемого файла.
  //
  // ВАЖНО: пока Android не ответил, SHELL_VERSION = null, а НЕ версия веб-сборки.
  // Раньше сюда синхронно ложился APP_VERSION, и после любого бесшовного обновления
  // заслон minShell сверялся с завышенным номером: телефон принимал сборку, которую
  // его оболочка не тянет, а обновление самой оболочки прятал. Честное «не знаю»
  // update.js обрабатывает сам (ждёт до трёх секунд, потом уводит на канал APK).
  window.SHELL_IS_BROWSER = !window.isNativeApp();
  window.SHELL_VERSION = null;
  window.SHELL_READY = Promise.resolve(null);

  if (window.SHELL_IS_BROWSER) {
    // В браузере (QA на компе) оболочки нет вовсе: номер веб-сборки — единственный,
    // какой есть, и он же верный. Помечено флагом SHELL_IS_BROWSER.
    window.SHELL_VERSION = String(window.APP_VERSION || '0');
  } else if (window.NativePlugins && window.NativePlugins.App) {
    try {
      window.SHELL_READY = window.NativePlugins.App.getInfo().then(function (info) {
        var v = info && info.version ? String(info.version) : '';
        if (!v) return null;
        window.SHELL_VERSION = v;
        // меню и «О приложении» рисуют номер: если оболочка отстала — пусть будет видно
        try { if (window.UI && window.UI.renderMenu) window.UI.renderMenu(); } catch (e) {}
        return v;
      }, function () { return null; });
    } catch (e) { window.SHELL_READY = Promise.resolve(null); }
  }
})();
