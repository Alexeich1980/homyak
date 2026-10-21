/* glow.js - 1.0.5: подсветка экрана (решение Алексея 17.10, вид - «Хомяк-подсветка-вид.png»).
   Мягкое свечение от краёв к центру поверх всего (кроме приветствия и замка), ~0,6 с:
     красное - КАЖДАЯ новая трата в текущем месяце, после которой категория за лимитом
              (решение Алексея 17.10: раньше было один раз на переходе, следующие траты
              сверх лимита не выделялись); правка старой операции - только если правка
              увела категорию за лимит (смена даты/заметки в уже перерасходной не мигает);
     зелёное - запись дохода.
   Идёт вместе со звуком и вибрацией из того же места (ui.js soundTx), уровни категории -
   те же Engine.fill(), что красят кольцо и выбирают звук «over».
   Выключатель - S.ui.glow («Звук и подсказки» → «Подсветка экрана»), по умолчанию вкл.
   prefers-reduced-motion: reduce - не показываем (и CSS прячет оверлей).
   Один элемент #glow + CSS-анимация; повторный запуск во время анимации перезапускает её.
   В node (тесты) DOM нет: экспортируются pick/allowed, fire() честно отвечает false. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Glow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Какую подсветку дать операции. kind - вид операции, before/after - уровень категории
  // (Engine.fill().level) до и после записи, cur - месяц операции текущий, edit - правка
  // существующей операции (доход при правке не подсвечиваем: это не новая запись).
  // 'over' | 'inc' | null.
  function pick(kind, before, after, cur, edit) {
    if (kind === 'inc') return edit ? null : 'inc';
    if (kind === 'exp' && cur && after === 'over') {
      if (!edit) return 'over';
      // К14 ревью 1.0.5: уровень «до» не передан (undefined) - перехода не видно, красной нет
      if (before !== undefined && before !== 'over') return 'over';
    }
    return null;
  }

  // Можно ли показывать: выключатель (по умолчанию вкл) и системное «меньше движения».
  function allowed(ui, reduce) {
    if (reduce) return false;
    return !(ui && ui.glow === false);
  }

  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  var timer = null;
  // Запустить подсветку. Повторный вызов во время анимации - перезапуск, без наложения.
  function fire(type) {
    try {
      if (typeof document === 'undefined') return false;
      if (type !== 'over' && type !== 'inc') return false;
      var S = window.UI ? window.UI.S : null;
      if (!allowed(S && S.ui, reduced())) return false;
      var el = document.getElementById('glow');
      if (!el) return false;
      el.classList.remove('on');
      el.setAttribute('data-glow', type);
      void el.offsetWidth;            // перезапуск CSS-анимации
      el.classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(function () { el.classList.remove('on'); }, 700);
      return true;
    } catch (e) { return false; }
  }

  return { pick: pick, allowed: allowed, fire: fire };
});
