/* purchase.js — покупка и восстановление «Полного доступа».
   Оркестрирует пейволл (edit.js) ↔ адаптер оплаты (pay.js) ↔ доступ (window.Pay).
   Сам платёж/владение — в pay.js; здесь только флоу и диалоги в гамме приложения
   (свой UI.openDlg/dlgAlert, НЕ нативный alert).

   Полный доступ = лицензионный ключ (license.js) ИЛИ RuStore-покупка (pay.js) ИЛИ
   Access.FULL (флаг тест/reel-сборки). Точки входа:
     window.UI.buyFullAccess(ret)     — запустить покупку
     window.UI.restorePurchase(ret)   — восстановить ранее купленное (сменил телефон и т.п.)
     window.UI.hasFullAccess()        — единый источник правды о доступе

   Идентификатор товара и console_app_id — в www/pay-config.js (одно место, плейсхолдеры). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.UI) return;

  function payOn() {
    try { return !!(window.Access && window.Access.PAY); } catch (e) { return false; }
  }
  function Pay() { return window.Pay || null; }
  var buying = false;

  // Проверка владения полным доступом. Три двери к Pro, любая открывает.
  window.UI.hasFullAccess = function () {
    try { if (window.Access && window.Access.FULL) return true; } catch (e) {}                 // тест/reel/флаг
    try { if (window.License && window.License.isActiveSync()) return true; } catch (e) {}      // офлайн-лицензия
    try { if (window.Pay && window.Pay.isPurchasedSync()) return true; } catch (e) {}           // RuStore-покупка
    return false;
  };

  // Общий финал успешной покупки/восстановления: поднять доступ, перерисовать, сказать «Готово».
  function grantAndCelebrate(text) {
    try { if (window.Pay) window.Pay.markPurchased(); } catch (e) {}
    try { UI.render(); } catch (e) {}          // лимиты сняты сразу (фон под окном)
    try { UI.haptic('medium'); } catch (e) {}
    // dlgAlert открывается в том же #dlg: заменяет пейволл и сбрасывает его onClose (ret не сработает).
    UI.dlgAlert(text, 'Готово');
  }

  function notConfiguredDlg(onClose) {
    UI.openDlg({
      title: 'Полный доступ',
      body: '<p>Оплата подключится в ближайшем обновлении. Всё бесплатное работает без ограничений по времени.</p>',
      buttons: [{ label: 'Понятно', cls: 'primary' }],
      onClose: onClose
    });
  }

  // Платёж не прошёл. «Деньги не списаны» не обещаем: при сбое связи после оплаты это было
  // бы неправдой - вместо этого честный путь «Восстановить покупку».
  function failDlg(onClose) {
    UI.openDlg({
      title: 'Не получилось',
      body: '<p>Платёж не прошёл. Попробуй ещё раз чуть позже. Если деньги всё же списались, ' +
            'нажми «Восстановить покупку» в этом же окне.</p>',
      buttons: [{ label: 'Понятно', cls: 'primary' }],
      onClose: onClose
    });
  }

  // Запуск покупки. ret — колбэк возврата (куда вернуть после закрытия окна).
  window.UI.buyFullAccess = function (ret) {
    var onClose = (typeof ret === 'function') ? ret : undefined;
    var pay = Pay();
    if (!payOn() || !pay) { notConfiguredDlg(onClose); return; }

    var adapter;
    try { adapter = pay.currentAdapter(); } catch (e) { adapter = null; }
    if (!adapter) { notConfiguredDlg(onClose); return; }

    // двойной тап по «Купить» не должен открыть вторую шторку оплаты
    if (buying) return;
    buying = true;
    Promise.resolve(adapter.purchase()).then(function (r) {
      buying = false;
      r = r || {};
      if (window.Pay.purchaseGrantsPro(r)) {
        grantAndCelebrate('Полный доступ открыт. Спасибо, что поддержал разработку!');
        return;
      }
      if (r.cancelled) { if (onClose) onClose(); return; }        // отмена — молча вернуть, откуда пришёл
      if (r.unavailable) { notConfiguredDlg(onClose); return; }   // на девайсе ещё не вписан боевой id
      failDlg(onClose);
    }).catch(function () {
      buying = false;
      failDlg(onClose);   // мост/SDK упал - не молчим, но и Pro не выдаём
    });
  };

  // Восстановление покупки: getPurchases по тому же аккаунту RuStore. Для «купил, сменил
  // телефон, вошёл в тот же RuStore». Ключ-логику и данные не трогает.
  window.UI.restorePurchase = function (ret) {
    var onClose = (typeof ret === 'function') ? ret : undefined;
    var pay = Pay();
    if (!payOn() || !pay) { notConfiguredDlg(onClose); return; }

    var adapter;
    try { adapter = pay.currentAdapter(); } catch (e) { adapter = null; }
    if (!adapter) { notConfiguredDlg(onClose); return; }

    Promise.resolve(adapter.restore()).then(function (r) {
      if (r && r.unavailable) { notConfiguredDlg(onClose); return; }   // id не вписан - нечего проверять
      if (window.Pay.restoreGrantsPro(r)) {
        grantAndCelebrate('Покупка восстановлена. Полный доступ снова открыт.');
        return;
      }
      UI.openDlg({
        title: 'Покупка не найдена',
        body: '<p>В этом аккаунте RuStore покупка «Полного доступа» не числится. ' +
              'Проверь, что вошёл в тот же аккаунт, которым покупал. Есть лицензионный ключ - активируй его в этом окне.</p>',
        buttons: [{ label: 'Понятно', cls: 'primary' }],
        onClose: onClose
      });
    }).catch(function () {
      UI.openDlg({
        title: 'Не получилось',
        body: '<p>Не удалось проверить покупки. Проверь связь и попробуй ещё раз.</p>',
        buttons: [{ label: 'Понятно', cls: 'primary' }],
        onClose: onClose
      });
    });
  };
})();
