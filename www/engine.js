/* engine.js — чистый движок «Хомяк». Без DOM. Тестируется в Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VER = 1;
  // Верхняя граница суммы одной операции. Больше миллиарда рублей за раз в личном
  // бюджете не бывает, а промах пальцем по клавиатуре («18 девяток») портит баланс
  // навсегда — лечится только правкой базы. Та же граница стоит на стороне ПК.
  var MAX_AMOUNT = 999999999;
  // Палитра кошельков: ключ цвета, сам градиент и цвет чернил живут в CSS (класс wc-<ключ>).
  // Движок знает только список допустимых ключей — чтобы порченое или чужое значение
  // не превратилось в класс, которого нет, и карточка не осталась без фона.
  var WALLET_COLORS = ['yellow', 'red', 'green', 'blue', 'white',
                       'orange', 'purple', 'teal', 'pink', 'graphite'];
  var WALLET_COLOR_DEFAULT = 'yellow';
  function walletColor(v) {
    return (typeof v === 'string' && WALLET_COLORS.indexOf(v) >= 0) ? v : WALLET_COLOR_DEFAULT;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function ym(dateStr) { return String(dateStr).slice(0, 7); }
  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  // ---------- показ чисел ----------
  // Единственный форматтер сумм в приложении: разряды — неразрывным пробелом (он не даёт
  // числу переноситься по строке), минус — типографский, копейки показываем только когда
  // они есть, и тогда две цифры через запятую. Всё, что печатает или принимает суммы,
  // ходит сюда: свой replace на месте — источник разнобоя.
  var NBSP = '\u00a0';
  function group(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  function fmt(n) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    var neg = n < 0, a = Math.abs(n);
    var i = Math.floor(a + 1e-9), k = Math.round((a - i) * 100);
    if (k >= 100) { i += 1; k = 0; }
    var s = group(String(i));
    if (k) s += ',' + (k < 10 ? '0' : '') + k;
    return (neg && (i || k) ? '−' : '') + s;
  }
  // набранное на клавиатуре — как есть, но с разрядами в каждом числе:
  // «12500» → «12 500», «12500+300» → «12 500+300», «1200,5» → «1 200,5»
  function fmtTyped(s) {
    return String(s == null ? '' : s).replace(/\d+(?:,\d*)?/g, function (num) {
      var p = num.split(',');
      return group(p[0]) + (p.length > 1 ? ',' + p[1] : '');
    });
  }
  // Компактная запись для узких мест (шапка, плитка кошелька), когда полное число не
  // влезает даже уменьшенным кеглем: три значащих цифры и слово - «1,23 млн», «11,1 млн»,
  // «123 млн», «1,5 млрд». До миллиона - обычный fmt. Полная сумма остаётся в карточке.
  function fmtCompact(n) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    var a = Math.abs(n);
    if (a < 1e6) return fmt(Math.round(n));
    var unit = a >= 1e9 ? 'млрд' : 'млн', v = a / (a >= 1e9 ? 1e9 : 1e6);
    var dec = v >= 100 ? 0 : (v >= 10 ? 1 : 2);
    var s = v.toFixed(dec).replace(/\.?0+$/, '').replace('.', ',');
    return (n < 0 ? '−' : '') + s + NBSP + unit;
  }
  // обратный ход: то, что показали или набрали руками, снова в число (NaN, если не число).
  // Строго: parseFloat молча съедал мусор («12abc» → 12, «1,000,50» → 1, «5.5.5» → 5.5),
  // а через это поле ходят баланс кошелька и сумма операции. Что не число целиком — NaN.
  function parseNum(v) {
    var s = String(v == null ? '' : v).replace(/\s/g, '').replace(/−/g, '-').replace(/,/g, '.');
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  // Сумма с калькулятором (поле суммы в правке операции): «1 200+300», «150×3», «900÷2».
  // Знаки: + и - (в т.ч. «−»), × * и ÷ /; умножение и деление раньше сложения.
  // Разбираем сами, без eval. Висящий знак в конце отбрасываем (палец не дотыкал
  // число). Всё прочее, деление на ноль и два знака подряд - NaN. Итог - до копеек.
  function calcAmount(v) {
    var s = String(v == null ? '' : v).replace(/\s/g, '').replace(/,/g, '.')
      .replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/[+\-*/]+$/, '');
    if (!s || !/^[\d.+\-*/]+$/.test(s)) return NaN;
    var toks = s.match(/\d+(\.\d*)?|\.\d+|[+\-*/]/g);
    if (!toks || toks.join('') !== s) return NaN;              // «1.2.3» и подобное
    var i = 0, sign = 1;
    if (toks[0] === '+' || toks[0] === '-') { sign = toks[0] === '-' ? -1 : 1; i = 1; }
    function num() {
      var t = toks[i++];
      if (t === undefined || /[+\-*/]/.test(t)) return NaN;
      return parseFloat(t);
    }
    var total = 0, term = sign * num();
    while (i < toks.length) {
      var op = toks[i++], n = num();
      if (op === '*') term *= n;
      else if (op === '/') term = n === 0 ? NaN : term / n;
      else { total += term; term = op === '-' ? -n : n; }
    }
    var r = total + term;
    return isFinite(r) ? Math.round(r * 100) / 100 : NaN;
  }
  // есть ли в строке суммы действие (минус в самом начале - не действие)
  function hasCalcOp(v) { return /.[+\-−*/×÷]/.test(String(v == null ? '' : v).replace(/\s/g, '')); }

  // настоящая ли календарная дата «ГГГГ-ММ-ДД» (2026-13-45 и 2026-02-30 — нет)
  function isDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
    if (m < 1 || m > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // русское склонение по числу: plural(2,'операция','операции','операций') → 'операции'.
  // Чистая функция, нужна подписям вида «2 операции» в карточке.
  function plural(n, one, few, many) {
    var a = Math.abs(Math.round(Number(n) || 0)) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function defaultState() {
    return {
      ver: VER,
      wallets: [],
      // Категории задаются на самом телефоне (автономность «Казны»): два списка статей.
      // { exp:[{id,name,icon,color,order,archived}], inc:[…] }
      categories: { exp: [], inc: [] },
      // Месячные лимиты (планы), заданные вручную: { 'ГГГГ-ММ': { catId: сумма } }.
      // НЕТ ключа = лимит не задан (кружок серый), ключ со значением 0 = явный ноль (красный при факте).
      limits: {},
      limitsCarried: {},          // 'ГГГГ-ММ' → true: месяц уже получил лимиты из прошлого (carryLimits)
      tx: [],
      icons: {},                  // catId → iconName (иконка категории)
      // 1.0.4: партии импорта из таблиц (import.js): {id, at, name, count, cats:[], wallets:[]}.
      // Операция партии несёт метку t.imp = id - по ней «Отменить последний импорт».
      imports: [],
      // 1.0.4: долги (концепция docs/1.0.4-dolgi-koncepciya.md). Отдельный список, а не вид
      // кошелька: «В кошельках», выбор кошелька, лимиты free и выгрузка кошельков долги не
      // видят сами, без фильтра в каждом месте. Поля - normDebts.
      debts: [],
      ui: { incomeCollapsed: false, theme: 'dark', haptics: true, sound: true,
            hints: true, glow: true, hintsDismissed: {}, analyticsView: null,
            order: { inc: [], exp: [] }, month: null }
    };
  }

  // Плоский объект (не массив, не примитив, не null): всё, что проверку не прошло,
  // заменяется на значение по умолчанию, а не дописывается свойством в примитив.
  // Раньше `if (!S.ui.order)` пропускал строку и число, и запись `S.ui.order.inc = []`
  // валила загрузку целиком — один битый байт в хранилище убивал приложение.
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function strOr(v, dflt) { return typeof v === 'string' ? v : dflt; }
  // сумма в границах ±MAX_AMOUNT: враждебный или битый бэкап с «1e300» в балансе иначе
  // делал бы шапку и все расчёты бессмысленными - до правки базы руками
  function clampAmt(v) { return Math.max(-MAX_AMOUNT, Math.min(MAX_AMOUNT, v)); }
  function idsOf(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (x) { return typeof x === 'string' && x; });
  }

  // Приводит состояние к типам, на которые рассчитан весь остальной код.
  // Обязана НИКОГДА не бросать: её результат — единственное, что стоит между
  // порченым localStorage и белым экраном на телефоне.
  function migrate(S) {
    try { return normalize(S); } catch (e) { return defaultState(); }
  }

  function normalize(S) {
    var d = defaultState();
    if (!isObj(S)) return d;
    var out = {
      ver: VER,
      wallets: Array.isArray(S.wallets) ? S.wallets.filter(isObj) : [],
      categories: normCategories(S.categories),
      limits: normLimits(S.limits),
      limitsCarried: normCarried(S.limitsCarried),
      tx: Array.isArray(S.tx) ? S.tx.filter(isObj) : [],
      icons: normIcons(S.icons),
      imports: normImports(S.imports),
      debts: normDebts(S.debts),
      ui: isObj(S.ui) ? S.ui : d.ui
    };

    out.wallets.forEach(function (w, i) {
      w.id = strOr(w.id, 'w' + i);
      w.name = strOr(w.name, 'Кошелёк');
      if (!isNum(w.base)) w.base = 0;
      w.base = clampAmt(w.base);
      if (!isNum(w.baseTs)) w.baseTs = 0;
      if (!isNum(w.order)) w.order = i;
      if (typeof w.hidden !== 'boolean') w.hidden = false;
      if (typeof w.icon !== 'string' || !w.icon) w.icon = 'wallet';
      // кошельки из версий до палитры цвета не знали — все они жёлтые, как и были
      w.color = walletColor(w.color);
      normCredit(w);
      if ('adj' in w) {
        w.adj = Array.isArray(w.adj) ? w.adj.filter(function (a) { return isObj(a) && isDate(a.date) && isNum(a.delta) && Math.abs(a.delta) <= MAX_AMOUNT; }) : [];
        if (!w.adj.length) delete w.adj;
      }
    });

    // Операции без id - вон; повторный id (склеенный из двух бэкапов файл) - оставляем
    // первую: две операции с одним id ломали бы удаление и правку (findTx находит одну).
    var seenId = {};
    out.tx = out.tx.filter(function (t) {
      if (typeof t.id !== 'string' || !t.id || seenId[t.id]) return false;
      seenId[t.id] = 1;
      return true;
    });
    out.tx.forEach(function (t) {
      if (t.kind !== 'exp' && t.kind !== 'inc' && t.kind !== 'transfer' && t.kind !== 'debt') t.kind = 'exp';
      if (!isNum(t.amount) || t.amount <= 0) t.amount = 0;
      if (t.amount > MAX_AMOUNT) t.amount = MAX_AMOUNT;
      if (!isDate(t.date)) t.date = ym(today()) + '-01';
      if (!isNum(t.ts)) t.ts = 0;
      if (typeof t.catId !== 'string') t.catId = null;
      if (typeof t.walletId !== 'string') t.walletId = null;
      if (typeof t.toWalletId !== 'string') t.toWalletId = null;
      t.tags = idsOf(t.tags);
      // 1.0.4 импорт: метка партии и комментарий из таблицы - только строки
      if (typeof t.imp !== 'string' || !t.imp) delete t.imp;
      // Р6 ревью 15.10: сдвиг base от разморозки операции загрузки жил в t.impFz ({walletId:
      // delta}) и перезаписывался второй правкой. Теперь все сдвиги - в журнале партии b.fz;
      // старую метку переносим туда (at = t.ts: сдвиг с момента разморозки) и убираем.
      if (t.imp && isObj(t.impFz)) {
        var ib = null;
        out.imports.forEach(function (q) { if (q.id === t.imp) ib = q; });
        if (ib) Object.keys(t.impFz).forEach(function (k) {
          var dl = t.impFz[k];
          if (isNum(dl) && Math.abs(dl) <= MAX_AMOUNT && Math.abs(dl) >= 0.005) (ib.fz || (ib.fz = [])).push({ w: k, dl: r2(dl), at: t.ts });
        });
      }
      delete t.impFz;
      setNote(t, t.note);   // 1.0.5: заметка - одна строка, trim, не длиннее NOTE_MAX
      // 1.0.4 долги: операция долга - kind 'debt' (op pay - кошелёк → долг, take - долг →
      // кошелёк). Платёж «я должен» - ОДНА запись: amount - весь платёж (столько ушло из
      // кошелька), int - его часть на проценты (долг уменьшает amount - int), intLeft -
      // недоплаченные проценты, перенесённые на следующий платёж (решение 13.10: проценты -
      // часть платежа по долгу, не расход). Старый формат (проценты расходом с int:true и
      // общей grp) сливается ниже - mergeOldInterest.
      if (t.kind === 'debt' && t.op !== 'take') t.op = 'pay';
      if (t.kind !== 'debt') delete t.op;
      if (typeof t.debtId !== 'string' || !t.debtId) delete t.debtId;
      if (t.kind === 'debt' && !t.debtId) t.debtId = '';
      var oldInt = t.kind === 'exp' && t.int === true && !!t.debtId;
      if (oldInt) { /* старая запись процентов - сольётся с телом */ }
      else if (t.kind === 'debt' && t.op === 'pay' && isNum(t.int) && t.int > 0) t.int = r2(Math.min(t.int, t.amount));
      else delete t.int;
      if (!('int' in t) || !isNum(t.intLeft) || t.intLeft <= 0) delete t.intLeft;
      // payoff - закрывающий платёж «Долг погашен» с кошелька (решение 14.10): целиком в тело
      if (t.payoff !== true || t.kind !== 'debt' || t.op !== 'pay') delete t.payoff;
      else { delete t.int; delete t.intLeft; }
      if (typeof t.grp !== 'string' || !t.grp) delete t.grp;
    });
    var mergedInt = mergeOldInterest(out);
    out.debts.forEach(function (dd) {
      if (dd._legacy) legacyDebt(out, dd);
      delete dd._legacy;
      var la = dd.adj[dd.adj.length - 1];
      if (dd.closeAdj && !(la && la.close)) dd.closeAdj = false;
    });
    reopenNonZero(out);   // копия данных с архивным долгом, у которого остаток не ноль

    var ui = out.ui;
    if (typeof ui.incomeCollapsed !== 'boolean') ui.incomeCollapsed = false;
    if (ui.theme !== 'light' && ui.theme !== 'dark') ui.theme = 'dark';
    if (typeof ui.haptics !== 'boolean') ui.haptics = true;
    // звук появился в 0.3.0: у состояний прошлых версий поля нет, и молчащее
    // приложение выглядело бы сломанным - по умолчанию включаем
    if (typeof ui.sound !== 'boolean') ui.sound = true;
    // подсказки-хомяки появились в 0.4.1: общий выключатель (по умолчанию вкл) и набор
    // погашенных свайпом подсказок по их ключу. У прежних состояний полей нет.
    if (typeof ui.hints !== 'boolean') ui.hints = true;
    // 1.0.5: подсветка экрана (перерасход/доход), по умолчанию вкл
    if (typeof ui.glow !== 'boolean') ui.glow = true;
    if (!isObj(ui.hintsDismissed)) ui.hintsDismissed = {};
    // экран «Аналитики» в 0.4.1 открывается выбором из двух карточек; какую открыли
    // последней, помним здесь. null (или чужое значение) = показать выбор.
    if (ui.analyticsView !== 'summary' && ui.analyticsView !== 'feed') ui.analyticsView = null;
    if (!isObj(ui.order)) ui.order = { inc: [], exp: [] };
    ui.order.inc = idsOf(ui.order.inc);
    ui.order.exp = idsOf(ui.order.exp);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ui.month)) ui.month = null;
    // 1.0.4: закрытые баннеры просрочки - «id долга|ГГГГ-ММ» → true (один баннер на долг на месяц)
    if (!isObj(ui.debtWarn)) ui.debtWarn = {};
    Object.keys(ui.debtWarn).forEach(function (k) { if (ui.debtWarn[k] !== true) delete ui.debtWarn[k]; });
    // 1.0.4: мягкое окно «напоминания не придут» (уведомления запрещены) уже показывали
    if (typeof ui.remindDenied !== 'boolean') ui.remindDenied = false;
    out.ui = ui;
    dropInterestCat(out, mergedInt > 0 || out.debts.length > 0);

    return out;
  }

  // Решение 13.10: проценты по долгу - часть платежа, не расход. Сборки 1.0.4 до 13.10 писали
  // платёж двумя записями: проценты - расход {kind:'exp', int:true, intLeft, debtId, grp} в
  // категорию «Проценты по долгам», тело - {kind:'debt', op:'pay', grp}. Сливаем пару в одну
  // запись долга: amount = тело + проценты, int = проценты, intLeft - как был. Пару ищем по
  // grp, иначе по долгу + дате + ts. Проценты без тела (платёж меньше процентов) - запись
  // долга с amount = int. Кошелёк не сдвигается (ушло то же), долг - тоже (уменьшает тело).
  // Идемпотентно: старых записей после слияния нет.
  function mergeOldInterest(out) {
    var used = [], n = 0;
    out.tx.filter(function (t) { return t.kind === 'exp' && t.int === true; }).forEach(function (it) {
      var body = null;
      out.tx.forEach(function (x) {
        if (body || x.kind !== 'debt' || x.op !== 'pay' || x.debtId !== it.debtId || used.indexOf(x) >= 0) return;
        if (it.grp ? x.grp === it.grp : (x.date === it.date && x.ts === it.ts)) body = x;
      });
      if (!body && it.grp) out.tx.forEach(function (x) {
        if (!body && x.kind === 'debt' && x.op === 'pay' && x.debtId === it.debtId && used.indexOf(x) < 0 &&
          !x.grp && x.date === it.date && x.ts === it.ts) body = x;
      });
      var left = isNum(it.intLeft) && it.intLeft > 0 ? r2(it.intLeft) : 0;
      n++;
      if (body) {
        used.push(body);
        body.amount = clampAmt(r2(body.amount + it.amount));
        body.int = r2(Math.min(it.amount, body.amount));
        if (left) body.intLeft = left; else delete body.intLeft;
        out.tx.splice(out.tx.indexOf(it), 1);
      } else {
        used.push(it);
        it.kind = 'debt'; it.op = 'pay'; it.catId = null; it.toWalletId = null;
        it.int = it.amount;
        if (left) it.intLeft = left; else delete it.intLeft;
      }
    });
    out.tx.forEach(function (t) {
      delete t.grp;
      if (t.kind === 'debt' && t.op === 'pay' && !(isNum(t.int) && t.int > 0)) { delete t.int; delete t.intLeft; }
    });
    return n;   // сколько старых записей процентов слито (признак данных сборок 11-13.10)
  }
  // Категорию «Проценты по долгам» приложение больше не заводит. Заведённую раньше убираем, если
  // в ней нет ни одной операции и ни одного лимита (свои траты или лимит человека - оставляем).
  // Один раз (ui.intCatDone): категорию с этим именем, заведённую человеком позже, не трогаем.
  // Восстановление старой копии данных флага не несёт - уборка пройдёт и для неё.
  // Р19 ревью 15.10: категорию заводили только сборки 11-13.10 (у Алексея) - убираем, только если
  // данные от них (dev: есть долги или старые записи процентов). У покупателя 1.0.3 долгов не
  // было, и пустая категория с таким именем - его собственная: остаётся.
  function dropInterestCat(out, dev) {
    var ui = out.ui;
    if (ui.intCatDone === true) return;
    if (!dev) { ui.intCatDone = true; return; }
    var list = out.categories.exp, gone = {};
    list.slice().forEach(function (c) {
      if (c.name !== INTEREST_CAT) return;
      if (out.tx.some(function (t) { return t.catId === c.id; })) return;
      if (Object.keys(out.limits).some(function (m) { return c.id in out.limits[m]; })) return;
      list.splice(list.indexOf(c), 1);
      gone[c.id] = 1;
      delete out.icons[c.id];
    });
    if (Object.keys(gone).length) {
      list.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (c, i) { c.order = i; });
      ui.order.exp = ui.order.exp.filter(function (id) { return !gone[id]; });
    }
    ui.intCatDone = true;
  }

  // Партии импорта (1.0.4): только записи с id; списки созданных категорий/кошельков - строки.
  // Хранится не больше 20 последних: отменить можно только последнюю.
  function normImports(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (b) { return isObj(b) && typeof b.id === 'string' && b.id; }).slice(-20).map(function (b) {
      var o = { id: b.id, at: isNum(b.at) ? b.at : 0, name: strOr(b.name, ''),
        count: isNum(b.count) ? b.count : 0, cats: idsOf(b.cats), wallets: idsOf(b.wallets) };
      var fz = (Array.isArray(b.fz) ? b.fz : []).filter(function (e) {
        return isObj(e) && typeof e.w === 'string' && isNum(e.dl) && Math.abs(e.dl) <= MAX_AMOUNT && isNum(e.at);
      }).slice(-500).map(function (e) { return { w: e.w, dl: e.dl, at: e.at }; });
      if (fz.length) o.fz = fz;   // сдвиги удалённых операций партии (ревью 14.10 №3в)
      return o;
    });
  }

  // Долги (1.0.4). Строгая форма каждого поля, повторный id - вон (как у операций).
  //   type        'owe' - я должен (кредит, ипотека, долг другу), 'owed' - мне должны
  //   base/baseTs остаток при заведении и время заведения (операции с ts раньше baseTs не
  //               считаются - так было у сборки 11.10, где «Поправить остаток» ставил новую точку)
  //   adj         правки остатка («Поправить остаток», пени банка): [{date, delta, ts}] - событие
  //               с датой, прошлые месяцы (капитал, нагрузка, остаток на конец месяца) не меняются
  //   start       «было» - остаток при заведении (для полоски «выплачено N%»)
  //   pay, day    ежемесячный платёж и день платежа 1-31 (только «я должен»)
  //   payHist     история платежа [{ym, pay}]: с какого месяца какой платёж (нагрузка прошлых
  //               месяцев и «срок закрыт» считаются по платежу, действовавшему тогда)
  //   rate        ставка % годовых или null
  //   rateHist    история ставки [{ym, rate}] (только «я должен», ревью 15.10 Р2): с какого
  //               месяца какая ставка (0 - без ставки); проценты прошлых месяцев при пересчёте -
  //               по ставке того месяца, а не по нынешней
  //   due        дата возврата «мне должны» (ГГГГ-ММ-ДД) или null
  //   remind      напомнить о платеже (локальное уведомление Android)
  //   archived, archivedDate  погашен и убран в архив
  //   closeAdj    в архив ушёл кнопкой «Долг погашен» с остатком: последняя запись adj -
  //               обнуление {close:true}; «Отменить» и «Вернуть из архива» снимают именно её
  //   createdDate когда завели (с этого дня долг виден в капитале и нагрузке)
  function normDebts(v) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.filter(isObj).forEach(function (x, i) {
      var id = (typeof x.id === 'string' && x.id) ? x.id : ('d' + i + Math.random().toString(36).slice(2, 6));
      if (seen[id]) return;
      seen[id] = 1;
      var type = x.type === 'owed' ? 'owed' : 'owe';
      var base = isNum(x.base) ? clampAmt(x.base) : 0;
      var day = isNum(x.day) ? Math.floor(x.day) : NaN;
      var rate = isNum(x.rate) && x.rate > 0 && x.rate <= 100 ? x.rate : null;
      out.push({
        id: id, name: strOr(x.name, 'Долг') || 'Долг', type: type,
        base: base, baseTs: isNum(x.baseTs) ? x.baseTs : 0,
        start: isNum(x.start) ? clampAmt(Math.max(0, x.start)) : Math.max(0, base),
        pay: (type === 'owe' && isNum(x.pay) && x.pay > 0) ? Math.min(MAX_AMOUNT, x.pay) : 0,
        day: (type === 'owe' && day >= 1 && day <= 31) ? day : null,
        // «мне должны» - ставка только для наглядности (14.10, вариант А): проценты не начисляются
        rate: rate,
        due: (type === 'owed' && isDate(x.due)) ? x.due : null,
        remind: x.remind === true,
        order: isNum(x.order) ? x.order : i,
        archived: x.archived === true,
        archivedDate: (x.archived === true && isDate(x.archivedDate)) ? x.archivedDate : null,
        closeAdj: x.archived === true && x.closeAdj === true,
        createdDate: isDate(x.createdDate) ? x.createdDate : (isNum(x.baseTs) && x.baseTs > 0 ? localDay(x.baseTs) : today()),
        adj: normAdj(x.adj),
        payHist: normPayHist(x.payHist),
        rateHist: normRateHist(x.rateHist),
        // данные сборки 11.10 (без adj): «Поправить остаток» там переставлял точку отсчёта -
        // переводим в событие с датой после разбора операций (normalize → legacyDebt)
        _legacy: !Array.isArray(x.adj)
      });
      var d = out[out.length - 1];
      if (d.type === 'owe' && d.pay > 0 && !d.payHist.length) d.payHist = [{ ym: ym(d.createdDate), pay: d.pay }];
      if (d.type !== 'owe') d.payHist = [];
      // долги до 15.10 истории ставки не знали: ставка с месяца заведения - нынешняя
      if (d.type === 'owe' && d.rate > 0 && !d.rateHist.length) d.rateHist = [{ ym: ym(d.createdDate), rate: d.rate }];
      if (d.type !== 'owe') d.rateHist = [];
    });
    return out;
  }
  function normAdj(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (a) { return isObj(a) && isDate(a.date) && isNum(a.delta) && a.delta !== 0; })
      .map(function (a) {
        var o = { date: a.date, delta: r2(clampAmt(a.delta)), ts: isNum(a.ts) ? a.ts : 0 };
        if (a.close === true) o.close = true;   // обнуление кнопкой «Долг погашен» (closeDebt)
        return o;
      });
  }
  function normPayHist(v) {
    if (!Array.isArray(v)) return [];
    var seen = {};
    return v.filter(function (e) { return isObj(e) && /^\d{4}-(0[1-9]|1[0-2])$/.test(e.ym) && isNum(e.pay) && e.pay > 0; })
      .map(function (e) { return { ym: e.ym, pay: Math.min(MAX_AMOUNT, e.pay) }; })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : (a.ym > b.ym ? 1 : 0); })
      .filter(function (e) { if (seen[e.ym]) return false; seen[e.ym] = 1; return true; });
  }
  function normRateHist(v) {
    if (!Array.isArray(v)) return [];
    var seen = {};
    return v.filter(function (e) { return isObj(e) && /^\d{4}-(0[1-9]|1[0-2])$/.test(e.ym) && isNum(e.rate) && e.rate >= 0 && e.rate <= 100; })
      .map(function (e) { return { ym: e.ym, rate: e.rate }; })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : (a.ym > b.ym ? 1 : 0); })
      .filter(function (e) { if (seen[e.ym]) return false; seen[e.ym] = 1; return true; });
  }
  // Сборка 11.10: «Поправить остаток» ставил новую точку отсчёта (base/baseTs), и прошлые
  // месяцы показывали уже новый остаток. Переводим без потерь: точка отсчёта - заведение
  // (base = start, все операции живые), разница с прежним остатком - правка-событие в день
  // той точки. Остаток сегодня ровно тот же, история до правки - честная.
  function legacyDebt(S, d) {
    var oldBal = d.base, all = d.start;
    S.tx.forEach(function (t) {
      if (t.kind !== 'debt' || t.debtId !== d.id) return;
      var e = debtSign(d, t.op) * debtPart(t);
      if ((isNum(t.ts) ? t.ts : 0) >= d.baseTs) oldBal += e;
      all += e;
    });
    var delta = r2(oldBal - all);
    var when = d.baseTs > 0 ? localDay(d.baseTs) : d.createdDate;
    if (when < d.createdDate) when = d.createdDate;
    d.base = d.start; d.baseTs = 0;
    d.adj = Math.abs(delta) >= 0.005 ? [{ date: when, delta: delta, ts: 0 }] : [];
  }
  function localDay(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // icons: catId → имя иконки. Только непустые строки: объект или число вместо имени
  // уезжало бы в Icons.img и рисовало битую картинку на плитке.
  function normIcons(ic) {
    var out = {};
    if (!isObj(ic)) return out;
    Object.keys(ic).forEach(function (k) {
      if (typeof ic[k] === 'string' && ic[k]) out[k] = ic[k];
    });
    return out;
  }

  // Категории и лимиты приводим к строгой форме. Никогда не бросают — прошли через migrate.
  function normOneCat(c, i) {
    return {
      id: (c && typeof c.id === 'string' && c.id) ? c.id : ('c' + i + Math.random().toString(36).slice(2, 6)),
      name: strOr(c && c.name, 'Категория'),
      icon: (c && typeof c.icon === 'string' && c.icon) ? c.icon : 'dot',
      color: (c && typeof c.color === 'string' && c.color) ? c.color : 'graphite',
      order: isNum(c && c.order) ? c.order : i,
      archived: !!(c && c.archived)
    };
  }
  function normCatList(v) { return Array.isArray(v) ? v.filter(isObj).map(normOneCat) : []; }
  function normCategories(c) {
    if (!isObj(c)) return { exp: [], inc: [] };
    return { exp: normCatList(c.exp), inc: normCatList(c.inc) };
  }
  function normCarried(c) {
    var out = {};
    if (!isObj(c)) return out;
    Object.keys(c).forEach(function (k) { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(k) && c[k] === true) out[k] = true; });
    return out;
  }
  function normLimits(l) {
    var out = {};
    if (!isObj(l)) return out;
    Object.keys(l).forEach(function (ymk) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ymk) || !isObj(l[ymk])) return;
      var m = {};
      // лимит - число от 0 до MAX_AMOUNT: отрицательный лимит красил бы кружок при
      // любом факте, а «1e300» ломал бы проценты сводки
      Object.keys(l[ymk]).forEach(function (cid) {
        if (isNum(l[ymk][cid])) m[cid] = Math.max(0, Math.min(MAX_AMOUNT, l[ymk][cid]));
      });
      out[ymk] = m;
    });
    return out;
  }

  // ---------- кошельки ----------
  function addWallet(S, o) {
    var w = { id: uid(), name: String(o.name || 'Кошелёк'), icon: o.icon || 'wallet',
      color: walletColor(o.color),
      base: isNum(o.base) ? o.base : 0, baseTs: Date.now(), order: S.wallets.length, hidden: false };
    S.wallets.push(w);
    return w;
  }
  function findWallet(S, id) { for (var i = 0; i < S.wallets.length; i++) if (S.wallets[i].id === id) return S.wallets[i]; return null; }
  function updateWallet(S, id, patch) {
    var w = findWallet(S, id); if (!w) return null;
    Object.keys(patch).forEach(function (k) { w[k] = patch[k]; });
    if ('color' in patch) w.color = walletColor(patch.color);   // чужой ключ = класс, которого нет в CSS
    return w;
  }
  // 1.0.4: отметка «Кредитная карта» (решение 12.10, docs/1.0.4-dolgi-koncepciya.md). Кредитка
  // остаётся кошельком; поля есть только у отмеченного: credit:true, payDay («день платежа по
  // карте» 1-31 или null), remind (напоминание; только при дне платежа). Упрощение 13.10:
  // просрочки у кредитки нет (ни статуса, ни баннера) - прежнее поле creditDate убирается.
  function normCredit(w) {
    delete w.creditDate;
    if (w.credit !== true) { delete w.credit; delete w.payDay; delete w.remind; return; }
    var d = Number(w.payDay);
    w.payDay = (isNum(d) && Math.floor(d) === d && d >= 1 && d <= 31) ? d : null;
    w.remind = w.payDay !== null && w.remind === true;
  }
  // o: {credit, payDay, remind}. Бросает 'day'.
  function setWalletCredit(S, id, o) {
    var w = findWallet(S, id); if (!w) return null;
    o = o || {};
    if (o.credit !== true) { w.credit = false; normCredit(w); return w; }
    var day = o.payDay == null || o.payDay === '' ? null : Number(o.payDay);
    if (day !== null && (!isNum(day) || Math.floor(day) !== day || day < 1 || day > 31)) throw new Error('day');
    w.credit = true;
    w.payDay = day;
    w.remind = day !== null && o.remind === true;
    delete w.creditDate;
    return w;
  }
  // «Изменить баланс» - новая точка отсчёта (base/baseTs) и событие с датой (adj, ревью 12.10 №5):
  // остаток на прошлые дни (walletBalanceAt - капитал на конец прошлых месяцев) правка сегодня не меняет.
  // Правки одного дня складываются в одну запись.
  function setWalletBase(S, id, base, dateStr) {
    var w = findWallet(S, id); if (!w) return null;
    var delta = r2(base - walletBalance(S, id)), date = isDate(dateStr) ? dateStr : today();
    w.base = base; w.baseTs = Date.now();
    pushWalletAdj(w, date, delta);
    return w;
  }
  // Событие «остаток изменился без операции» датой date (walletBalanceAt вычитает его из дней
  // раньше date). Пишут «Изменить баланс» и удаление чужих операций, эффект которых остался в
  // base (перевод удалённого кошелька, платёж удалённого долга - Р21 ревью 15.10; del: true -
  // подпись в Excel). Нулевая правка не пишется; события одного дня и вида складываются.
  // Больше 500 - самое старое сливается со следующим (сдвиг прошлого только между ними).
  function pushWalletAdj(w, date, delta, del) {
    delta = r2(delta);
    if (!(Math.abs(delta) >= 0.005)) return;
    if (!Array.isArray(w.adj)) w.adj = [];
    var same = null;
    w.adj.forEach(function (a) { if (a.date === date && !a.del === !del) same = a; });
    if (same) {
      same.delta = r2(same.delta + delta);
      if (Math.abs(same.delta) < 0.005) w.adj.splice(w.adj.indexOf(same), 1);
    } else w.adj.push(del ? { date: date, delta: delta, del: true } : { date: date, delta: delta });
    while (w.adj.length > 500) {
      w.adj.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
      w.adj[1].delta = r2(w.adj[1].delta + w.adj[0].delta);
      w.adj.shift();
    }
    if (!w.adj.length) delete w.adj;
  }
  // сколько операций держится за кошелёк (расходы, доходы и переводы в обе стороны)
  function walletTxCount(S, id) {
    var n = 0;
    S.tx.forEach(function (t) { if (t.walletId === id || t.toWalletId === id) n++; });
    return n;
  }
  // Удаление кошелька НАСОВСЕМ, вместе с его операциями. Мягкий путь - «скрыть»
  // (hidden), он и предлагается первым; сюда приходят осознанно, через окно
  // с предупреждением. Возвращает {id, name, removed} или null, если такого нет.
  //
  // Переводы держатся за ДВА кошелька: A→B уходит вместе с A, но деньги в B от этого
  // не исчезали. Поэтому перед удалением эффект каждого живого (для B) перевода
  // вшиваем в base кошелька B - ровно так же, как «Изменить баланс» вшивает прошлое.
  // Замороженный для B перевод (ts < B.baseTs) в его base уже сидит - не трогаем.
  // Итог: балансы всех остальных кошельков после удаления ровно те же, что до.
  //
  // 1.0.4: кошелёк с платежами по долгам не удаляется ('debt-ops'): платёж держит и историю
  // долга (сроки, проценты, «выплачено N%»), молча стирать её нельзя. Выход - «Скрыть».
  function walletDebtTxCount(S, id) {
    var n = 0;
    S.tx.forEach(function (t) { if (t.walletId === id && t.debtId && t.kind === 'debt') n++; });
    return n;
  }
  function deleteWallet(S, id) {
    var w = findWallet(S, id);
    if (!w) return null;
    if (walletDebtTxCount(S, id)) throw new Error('debt-ops');
    var removed = 0;
    S.tx = S.tx.filter(function (t) {
      if (t.walletId !== id && t.toWalletId !== id) return true;
      removed++;
      if (t.kind === 'transfer' && isNum(t.amount)) {
        var other = t.walletId === id ? t.toWalletId : t.walletId;
        var ow = other !== id ? findWallet(S, other) : null, e = t.toWalletId === other ? t.amount : -t.amount;
        if (ow && (isNum(t.ts) ? t.ts : 0) >= ow.baseTs) ow.base = Math.round((ow.base + e) * 100) / 100;
        // Р21 ревью 15.10: перевода больше нет, а его деньги остались - событие его датой, чтобы
        // остаток B на дни ДО перевода (капитал прошлых месяцев) не сдвинулся (и у замороженного)
        if (ow) pushWalletAdj(ow, t.date, e, true);
      }
      return false;
    });
    S.wallets.splice(S.wallets.indexOf(w), 1);
    // порядок пересобираем подряд: дыра в order сталкивала бы оставшиеся кошельки
    S.wallets.slice().sort(function (a, b) { return a.order - b.order; })
      .forEach(function (x, i) { x.order = i; });
    return { id: w.id, name: w.name, removed: removed };
  }
  function walletBalance(S, id) {
    var w = findWallet(S, id); if (!w) return 0;
    var b = w.base;
    for (var i = 0; i < S.tx.length; i++) {
      var t = S.tx[i]; if (t.ts < w.baseTs) continue;
      if (t.kind === 'exp' && t.walletId === id) b -= t.amount;
      else if (t.kind === 'inc' && t.walletId === id) b += t.amount;
      else if (t.kind === 'transfer') { if (t.walletId === id) b -= t.amount; if (t.toWalletId === id) b += t.amount; }
      else if (t.kind === 'debt' && t.walletId === id) b += t.op === 'take' ? t.amount : -t.amount;
    }
    return Math.round(b * 100) / 100;
  }

  // ---------- операции ----------
  function parseTags(str) {
    var out = [], seen = {};
    String(str || '').split(/\s+/).forEach(function (w) {
      if (w.charAt(0) !== '#' || w.length < 2) return;
      var t = w.toLowerCase(); if (!seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }
  // Операции задним числом - можно, вперёд - нет: денег, которых ещё не потратили,
  // в факте быть не должно, иначе они уедут в «Бюджет года» и разойдутся с жизнью.
  function futureDate(v) { return typeof v === 'string' && v > today(); }

  // 1.0.5: заметка к операции (просили покупатели). Необязательная, одна строка: пробелы и
  // переносы схлопываются, края обрезаются, не длиннее NOTE_MAX; пустая - поля нет вовсе.
  // Одно правило и для записи (addTx, updateTx, payDebt, takeDebt, editDebtTx), и для загрузки
  // (normalize: копия данных, восстановление, импорт таблиц).
  // ревью 1.0.5: NOTE_MAX - предел ввода в окне (100); хранится до NOTE_KEEP (200) - столько
  // пускала загрузка таблиц 1.0.4, старые комментарии при переходе на 1.0.5 не обрезаются.
  // Обрезка по символам (Array.from), не по UTF-16: эмодзи на границе не рвётся пополам.
  var NOTE_MAX = 100, NOTE_KEEP = 200;
  // К11 ревью 1.0.5: normalize зовёт это на каждую операцию при каждом старте - чистая заметка
  // идёт быстрым путём: схлопываем, только если есть что (таб, перенос, двойной пробел), а
  // по символам считаем, только если UTF-16 длиннее предела (символов не больше, чем единиц).
  var NOTE_DIRTY = /[^\S ]| {2}/;
  function cleanNote(v) {
    if (typeof v !== 'string') return '';
    var s = (NOTE_DIRTY.test(v) ? v.replace(/\s+/g, ' ') : v).trim();
    if (s.length <= NOTE_KEEP) return s;
    var ch = Array.from(s);
    return ch.length > NOTE_KEEP ? ch.slice(0, NOTE_KEEP).join('').trim() : s;
  }
  function setNote(t, v) {
    var c = cleanNote(v);
    if (c) t.note = c; else delete t.note;
    return t;
  }
  // К2 ревью 1.0.5: правка, где поменялась только заметка, не должна идти через updateTx/
  // editDebtTx - те «размораживают» операцию до «Изменить баланс» (свежий ts, сдвиг base, место
  // в ленте) и пересчитывают проценты долга. noteOnlyEdit - в патче формы правки (сумма, дата,
  // кошелёк(и), категория) ничего, кроме заметки, не отличается от операции.
  function noteOnlyEdit(t, patch) {
    if (!t || !patch || typeof patch !== 'object') return false;
    return Object.keys(patch).every(function (k) {
      if (k === 'note') return true;
      if (k === 'amount') return Math.abs(Number(patch.amount) - t.amount) < 0.005;
      return (patch[k] || null) === (t[k] || null);
    });
  }
  // Только заметка: ни ts, ни base, ни проценты не трогаем. null - операции нет.
  function setTxNote(S, id, note) {
    var t = findTx(S, id);
    return t ? setNote(t, note) : null;
  }

  function addTx(S, o) {
    var a = Number(o.amount);
    if (!isNum(a) || a <= 0) throw new Error('amount');
    if (a > MAX_AMOUNT) throw new Error('amount-max');
    if (o.date != null && !isDate(o.date)) throw new Error('date');
    if (futureDate(o.date)) throw new Error('date-future');
    // Метки (#метка) в личном приложении убраны: новые операции их не пишут. Старые
    // данные с полем tags по-прежнему грузятся (normalize их терпит), просто не видны.
    var t = { id: uid(), kind: o.kind, amount: a, date: o.date || today(), ts: Date.now(),
      catId: o.catId || null, walletId: o.walletId || null, toWalletId: o.toWalletId || null };
    setNote(t, o.note);
    S.tx.push(t);
    return t;
  }
  function findTx(S, id) { for (var i = 0; i < S.tx.length; i++) if (S.tx[i].id === id) return S.tx[i]; return null; }
  // Патч проверяем ДО записи: раньше сумма ложилась в операцию и только потом бросала,
  // операция оставалась испорченной, а откатывать было нечему — в бюджете появлялись
  // деньги, которых нет.
  function updateTx(S, id, patch) {
    var t = findTx(S, id); if (!t) return null;
    if (!patch || typeof patch !== 'object') return t;
    if ('amount' in patch) {
      var a = Number(patch.amount);
      if (!isNum(a) || a <= 0) throw new Error('amount');
      if (a > MAX_AMOUNT) throw new Error('amount-max');
    }
    if ('date' in patch) {
      if (!isDate(patch.date)) throw new Error('date');
      if (futureDate(patch.date)) throw new Error('date-future');
    }
    // Замороженная операция (уже вшита в base после «Изменить баланс»): правка суммы
    // или кошелька её не трогала бы в балансе, а удаление возвращало бы уже НОВУЮ сумму
    // (двойной счёт), перенос на другой кошелёк удваивал деньги. Поэтому сперва
    // вынимаем её из base старым эффектом, делаем живой (свежий ts) и только потом
    // применяем патч - дальше её честно считает пересчёт walletBalance.
    if (isFrozen(S, t)) {
      var snap = t.imp ? S.wallets.map(function (w) { return [w.id, w.base]; }) : null;
      refundFrozen(S, t);
      t.ts = Date.now();
      // Операция загрузки (t.imp): на сколько разморозка сдвинула base кошельков - в журнал
      // партии, отмена загрузки вернёт сдвиг (ревью 14.10 №3а: было 10 000, после правки и
      // отмены - 13 000). Каждая правка дописывает свой сдвиг (Р6 ревью 15.10: вторая правка
      // затирала первую - B 4 000 вместо 5 000).
      if (snap) keepImpShift(S, t, snap, t.ts);
    }
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    if ('amount' in patch) t.amount = Number(patch.amount);
    if ('note' in patch) setNote(t, patch.note);
    return t;
  }
  // заморожена ли операция хотя бы для одного из своих кошельков
  function isFrozen(S, t) {
    if (!isNum(t.ts)) return false;
    var w = findWallet(S, t.walletId), w2 = t.kind === 'transfer' ? findWallet(S, t.toWalletId) : null;
    var d = t.kind === 'debt' ? findDebt(S, t.debtId) : null;
    return !!((w && t.ts < w.baseTs) || (w2 && t.ts < w2.baseTs) || (d && t.ts < d.baseTs));
  }
  // Замороженная операция (t.ts < baseTs кошелька) в баланс не входит: walletBalance её
  // пропускает, потому что она уже «вшита» в base — так работает «Изменить баланс»
  // (хозяин зафиксировал текущий остаток, всё прежнее в нём учтено). Но при удалении
  // такой операции обычный пересчёт денег не вернёт: её и не считали. Возвращаем ручь-
  // ём — правим саму base на обратный эффект операции, ровно на тех кошельках, для
  // которых она заморожена. Живую (t.ts >= baseTs) операцию базы не трогаем: там деньги
  // вернёт сам пересчёт walletBalance, а правка base их удвоила бы.
  function adjustFrozen(S, walletId, ts, delta) {
    var w = findWallet(S, walletId);
    if (w && ts < w.baseTs) w.base = Math.round((w.base + delta) * 100) / 100;
  }
  function refundFrozen(S, t) {
    if (!isNum(t.ts) || !isNum(t.amount)) return;
    if (t.kind === 'exp') adjustFrozen(S, t.walletId, t.ts, t.amount);        // трата ушла из base — вернуть
    else if (t.kind === 'inc') adjustFrozen(S, t.walletId, t.ts, -t.amount);  // доход вшит в base — убрать
    else if (t.kind === 'transfer') {
      adjustFrozen(S, t.walletId, t.ts, t.amount);                            // из «откуда» ушло — вернуть
      adjustFrozen(S, t.toWalletId, t.ts, -t.amount);                         // в «куда» пришло — убрать
    } else if (t.kind === 'debt') {
      adjustFrozen(S, t.walletId, t.ts, t.op === 'take' ? -t.amount : t.amount);
      var d = findDebt(S, t.debtId);                                          // и сторона долга
      if (d && t.ts < d.baseTs) d.base = r2(d.base - debtSign(d, t.op) * debtPart(t));
    }
  }
  // Ушёл платёж по долгу - проценты его месяца пересчитываются: переходят на оставшийся первый
  // платёж месяца (ревью 12.10 №4, resplitDebtMonth).
  function deleteTx(S, id) {
    var t = findTx(S, id);
    if (!t) return false;
    // с 13.10 платёж по долгу - одна запись (проценты внутри, поле int): уходит сама операция
    function drop() {
      var x = t;
      var snap = x.imp ? S.wallets.map(function (w) { return [w.id, w.base]; }) : null;
      refundFrozen(S, x);
      if (snap) keepImpShift(S, x, snap, Date.now());
      S.tx.splice(S.tx.indexOf(x), 1);
    }
    // операция долга - тем же путём, что запись (Р3 ревью 15.10): проценты с её месяца по все
    // следующие (ревью 14.10 №2: недоплата удалённого платежа сидела в следующих месяцах), а
    // удалить «взял ещё», после которого остаток стал бы меньше нуля, нельзя - 'over'
    var d = t.kind === 'debt' && t.debtId ? findDebt(S, t.debtId) : null;
    if (d) commitDebt(S, d, ym(t.date), drop, null); else drop();
    return true;
  }
  // Журнал сдвигов партии загрузки b.fz (ревью 14.10 №3в, Р6 ревью 15.10): операция партии,
  // которую правили или удалили «замороженной», сдвинула base кошельков (разморозка вернула её
  // сумму) - запись {w, dl, at} на каждый сдвиг. Отмена загрузки возвращает сдвиги, после
  // которых баланс кошелька не задавали заново (Import.undo: !(w.baseTs > at)).
  function keepImpShift(S, x, snap, at) {
    var b = null;
    (S.imports || []).forEach(function (q) { if (q.id === x.imp) b = q; });
    if (!b) return;
    var fz = Array.isArray(b.fz) ? b.fz : (b.fz = []);
    snap.forEach(function (p) {
      var w = findWallet(S, p[0]); if (!w) return;
      var dl = r2(w.base - p[1]);
      if (Math.abs(dl) >= 0.005) fz.push({ w: p[0], dl: dl, at: at });
    });
    if (fz.length > 500) b.fz = fz.slice(-500);
  }
  function byNewest(a, b) { return (b.date + b.ts) < (a.date + a.ts) ? -1 : 1; }
  // Операции кошелька. С ymStr — только за этот месяц (карточка кошелька и её счётчик
  // «N операций» смотрят на выбранный месяц, а не на всю историю); без него — все.
  function txOfWallet(S, id, ymStr) {
    return S.tx.filter(function (t) {
      if (t.walletId !== id && t.toWalletId !== id) return false;
      return ymStr ? ym(t.date) === ymStr : true;
    }).sort(byNewest);
  }

  // ---------- категории (задаются на телефоне) ----------
  function addCategory(S, kind, o) {
    var list = kind === 'inc' ? S.categories.inc : S.categories.exp;
    var c = { id: 'c' + uid().slice(1), name: String((o && o.name) || 'Категория'),
      icon: (o && o.icon) || 'dot', color: (o && o.color) || 'graphite',
      order: list.length, archived: false };
    list.push(c);
    return c;
  }
  function findCategory(S, id) {
    for (var k = 0; k < 2; k++) {
      var kind = k ? 'inc' : 'exp', arr = S.categories[kind];
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return { cat: arr[i], kind: kind };
    }
    return null;
  }
  function updateCategory(S, id, patch) {
    var f = findCategory(S, id); if (!f) return null;
    Object.keys(patch || {}).forEach(function (kk) { if (kk !== 'id') f.cat[kk] = patch[kk]; });
    return f.cat;
  }
  function archiveCategory(S, id, archived) {
    var f = findCategory(S, id); if (!f) return null;
    f.cat.archived = archived === undefined ? true : !!archived;
    return f.cat;
  }
  function catKind(S, catId) { var f = findCategory(S, catId); return f ? f.kind : null; }

  // Список категорий вида kind в порядке хозяина (S.ui.order[kind]).
  // По умолчанию только активные; includeArchived — все; ymStr — в хвост добавляются
  // архивные категории, по которым в этом месяце есть факт (чтобы разрез месяца не терял деньги).
  function listCategories(S, kind, opt) {
    opt = opt || {};
    var src = kind === 'inc' ? S.categories.inc : S.categories.exp;
    var order = (S.ui.order && S.ui.order[kind]) || [];
    var pool = src.filter(function (c) { return opt.includeArchived ? true : !c.archived; });
    var byId = {}; pool.forEach(function (c) { byId[c.id] = c; });
    var out = [];
    order.forEach(function (id) { if (byId[id]) { out.push(byId[id]); delete byId[id]; } });
    pool.forEach(function (c) { if (byId[c.id]) out.push(c); });
    if (opt.ymStr && !opt.includeArchived) src.forEach(function (c) {
      if (c.archived && out.indexOf(c) < 0 && catFact(S, c.id, opt.ymStr) > 0) out.push(c);
    });
    return out.map(function (c) {
      return { id: c.id, name: c.name, icon: S.icons[c.id] || c.icon, color: c.color, archived: !!c.archived };
    });
  }

  // ---------- лимиты (месячные планы, задаются вручную) ----------
  // Возвращает число или null. null = лимит не задан (кружок серый даже при факте).
  function catLimit(S, catId, ymStr) {
    var m = S.limits[ymStr];
    return (m && isNum(m[catId])) ? m[catId] : null;
  }
  function setLimit(S, ymStr, catId, amount) {
    if (!/^\d{4}-\d{2}$/.test(ymStr)) return;
    if (amount === null || amount === undefined || !isNum(Number(amount))) {
      if (S.limits[ymStr]) {
        delete S.limits[ymStr][catId];
        if (!Object.keys(S.limits[ymStr]).length) delete S.limits[ymStr];
      }
      return;
    }
    if (!S.limits[ymStr]) S.limits[ymStr] = {};
    S.limits[ymStr][catId] = Number(amount);
  }
  // Перенос целей месяц→месяц. Лимиты расхода и планы дохода лежат в одной карте
  // S.limits[ym] (ключ - id категории), поэтому копирование фильтруется по виду:
  //   без kind    - прежнее поведение: весь месяц целиком (заменяя цель в целевом месяце);
  //   kind задан  - только цели категорий этого вида, ПОВЕРХ существующих (не затирая
  //                 цели другого вида). Иначе «Скопировать планы» на вкладке доходов
  //                 снесло бы лимиты расходов текущего месяца. Возвращает число перенесённых.
  function copyLimits(S, fromYM, toYM, kind) {
    var src = S.limits[fromYM]; if (!src) return 0;
    if (!kind) {
      var dst = {}, n = 0;
      Object.keys(src).forEach(function (cid) { dst[cid] = src[cid]; n++; });
      if (n) S.limits[toYM] = dst; else delete S.limits[toYM];
      return n;
    }
    var cnt = 0;
    Object.keys(src).forEach(function (cid) {
      if (catKind(S, cid) !== kind) return;
      if (!S.limits[toYM]) S.limits[toYM] = {};
      S.limits[toYM][cid] = src[cid]; cnt++;
    });
    return cnt;
  }
  // Лимиты сами переезжают в новый месяц (решение Алексея 01.10.2026): 1-го числа хозяин
  // не должен видеть «Лимиты нет», будто настройки пропали. Если у месяца ymStr своих
  // лимитов нет и он ещё ни разу не заполнялся, копируем лимиты и планы доходов из
  // ближайшего прошлого месяца, где они есть (архивные категории не везём). Заполненный
  // месяц помечается в S.limitsCarried - и тот, что заполнили отсюда, и тот, у которого
  // уже были свои лимиты (заданные руками, «Скопировать планы», версия до 1.0.2, бэкап):
  // если хозяин потом сам уберёт все лимиты месяца, они не вернутся назад. Прошлые
  // месяцы не трогаем, зовётся только для текущего.
  // Возвращает число скопированных лимитов (0 - ничего не делали).
  function carryLimits(S, ymStr) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ymStr)) return 0;
    if (S.limits[ymStr] && Object.keys(S.limits[ymStr]).length) {
      S.limitsCarried[ymStr] = true;           // свои лимиты есть - месяц уже заполнен
      return 0;
    }
    if (S.limitsCarried[ymStr]) return 0;
    var from = Object.keys(S.limits).filter(function (k) {
      return k < ymStr && Object.keys(S.limits[k]).length;
    }).sort().pop();
    if (!from) return 0;
    var dst = {}, n = 0;
    Object.keys(S.limits[from]).forEach(function (cid) {
      var f = findCategory(S, cid);
      if (!f || f.cat.archived) return;
      dst[cid] = S.limits[from][cid]; n++;
    });
    if (!n) return 0;
    S.limits[ymStr] = dst;
    S.limitsCarried[ymStr] = true;
    return n;
  }
  // В суммах плана null трактуется как 0 (категория без лимита плана не добавляет).
  function planOr0(S, catId, ymStr) { var v = catLimit(S, catId, ymStr); return isNum(v) ? v : 0; }

  // ---------- факт по категории ----------
  function catFact(S, catId, ymStr) {
    var k = catKind(S, catId), t = 0;   // если вид известен — считаем только его, иначе exp+inc
    for (var i = 0; i < S.tx.length; i++) {
      var x = S.tx[i];
      if (x.catId !== catId || ym(x.date) !== ymStr) continue;
      if (x.kind !== 'exp' && x.kind !== 'inc') continue;
      if (k && x.kind !== k) continue;
      t += x.amount;
    }
    return Math.round(t * 100) / 100;
  }

  // ---------- free-гейт + предохранитель ----------
  // FREE — продающий лимит бесплатной версии. HARD — потолок-предохранитель, действует
  // ДАЖЕ на полном доступе (защита от лавины/случайности и от торможения экрана на сотнях
  // плиток). Живой человек до HARD не доходит — «без ограничений» остаётся честным.
  var FREE = { wallets: 2, expCats: 8, incCats: 1, debts: 1 };
  var HARD = { wallets: 50, expCats: 100, incCats: 50, debts: 50 };
  function walletsActiveCount(S) { return S.wallets.filter(function (w) { return !w.hidden; }).length; }
  function expCatsActiveCount(S) { return S.categories.exp.filter(function (c) { return !c.archived; }).length; }
  function incCatsActiveCount(S) { return S.categories.inc.filter(function (c) { return !c.archived; }).length; }
  function canAddWallet(S, full) {
    if (walletsActiveCount(S) >= HARD.wallets) return false;      // предохранитель
    return !!full || walletsActiveCount(S) < FREE.wallets;
  }
  function canAddExpCat(S, full) {
    if (expCatsActiveCount(S) >= HARD.expCats) return false;      // предохранитель
    return !!full || expCatsActiveCount(S) < FREE.expCats;
  }
  function canAddIncCat(S, full) {
    if (incCatsActiveCount(S) >= HARD.incCats) return false;      // предохранитель
    return !!full || incCatsActiveCount(S) < FREE.incCats;
  }
  // ---------- размер плитки ----------
  // Кольцо не зашито числом: оно тянется за шириной колонки. На узком экране мельче,
  // на широком крупнее, но всегда в границах 54…68 px - ниже 54 глиф перестаёт
  // читаться, выше 68 плитка выглядит раздутой. Чистые функции: их же гоняют тесты.
  var RING_MIN = 54, RING_MAX = 68, RING_K = 0.70, RING_STEP = 2;
  function r3(x) { return Math.round(x * 1000) / 1000; }

  // ширина сетки (без внутренних отступов) и зазор между колонками -> размер кольца
  function ringSize(gridW, gapX) {
    var col = (Number(gridW) - 3 * (Number(gapX) || 0)) / 4;
    if (!isFinite(col) || col <= 0) return RING_MIN;
    return Math.round(Math.max(RING_MIN, Math.min(RING_MAX, col * RING_K)));
  }

  // Вся геометрия кольца выводится из размера, а не из зашитых 54 / 24.75 / 155.51:
  // обводка - двенадцатая доля диаметра, радиус - по её середине, длина окружности
  // нужна для stroke-dashoffset, глиф - половина кольца, отступ ядра равен обводке.
  function ringGeom(size) {
    var s = Math.max(RING_MIN, Math.round(Number(size) || RING_MIN));
    var sw = s / 12;
    var r = (s - sw) / 2;
    return { size: s, sw: r3(sw), r: r3(r), circ: r3(2 * Math.PI * r),
             ico: Math.round(s / 2), inset: r3(sw) };
  }

  // Подбор кольца под нужное число рядов: от «идеального» вниз шагами по 2 px, пол - 54.
  // avail - высота, отданная сетке; label - блок подписей под кольцом; gap - зазор рядов.
  function ringFit(o) {
    o = o || {};
    var rows = o.rows || 4, label = Number(o.label) || 0;
    var gap = Number(o.gap) || 0, avail = Number(o.avail) || 0;
    var pref = ringSize(o.gridW, o.gapX);
    for (var s = pref; s > RING_MIN; s -= RING_STEP) {
      if (rows * (s + label) + (rows - 1) * gap <= avail) return s;
    }
    return RING_MIN;
  }

  // Сколько рядов реально помещается при выбранном кольце (запасной путь для
  // совсем низких экранов, где и на 54 четыре ряда не влезают).
  function ringRows(o) {
    o = o || {};
    var pitch = (Number(o.ring) || RING_MIN) + (Number(o.label) || 0) + (Number(o.gap) || 0);
    if (!(pitch > 0)) return 1;
    var n = Math.floor(((Number(o.avail) || 0) + (Number(o.gap) || 0)) / pitch);
    return Math.max(1, Math.min(o.max || 4, n));
  }

  // Порог перебора - СТРОГО больше плана (решение Алексея 29.09.2026): потратил ровно
  // план - это «впритык», жёлтый, а не перерасход. Сравниваем суммы в копейках, а не
  // долю: 333.33 + 333.33 + 333.34 в плавающей точке дают 1000.0000000000001, и ровный
  // план покраснел бы; а копейка сверх плана - уже честный красный.
  //   0                          - none
  //   0 < r < 0.8                - ok
  //   0.8 <= r и факт <= плана   - warn
  //   факт > плана               - over (сюда же план 0 при живом факте)
  // ratio отдаём СЫРЫМ, без округления. Округляет тот, кто печатает проценты текстом,
  // а не тот, кто рисует заливку.
  function fill(fact, plan) {
    if (plan === null || plan === undefined) return { ratio: 0, level: 'none' }; // лимит не задан — серый
    if (!fact || fact <= 0) return { ratio: 0, level: 'none' };
    if (plan <= 0) return { ratio: 1, level: 'over' };                            // явный 0 при факте — красный
    var raw = fact / plan;
    if (Math.round(fact * 100) > Math.round(plan * 100)) return { ratio: raw, level: 'over' };
    return { ratio: raw, level: raw >= 0.8 ? 'warn' : 'ok' };
  }
  // Заливка кружка ИСТОЧНИКА ДОХОДА по месячному ПЛАНУ. Зеркало fill() для расхода, но
  // семантика позитивная: перевыполнение плана - это хорошо, поэтому НИКОГДА не 'over'
  // (красный). Зелёный только когда цель взята, янтарь - пока идём к ней.
  //   план не задан (null)     - none (кружок нейтральный; на главном прежний вид держит levelOf)
  //   факт 0                    - none (серый: прогресса нет)
  //   0 < доля < 1              - 'warn' (в процессе - до плана не дошли; тот же янтарь, что расход 80-100%)
  //   доля >= 1                 - 'ok' (зелёный: план достигнут/перевыполнен)
  //   план 0 при живом факте    - 'ok' (цель в ноль уже взята - позитив, не красный)
  // ratio отдаём сырым (без округления) - им же рисуется дуга/заливка; уровень по сырому
  // отношению. Чистая функция: её же гоняют тесты в Node.
  function fillInc(fact, plan) {
    if (plan === null || plan === undefined) return { ratio: 0, level: 'none' };
    if (!fact || fact <= 0) return { ratio: 0, level: 'none' };
    if (plan <= 0) return { ratio: 1, level: 'ok' };
    var raw = fact / plan;
    return { ratio: raw, level: raw >= 1 ? 'ok' : 'warn' };
  }
  function txOfCat(S, catId, ymStr) { return S.tx.filter(function (t) { return t.catId === catId && ym(t.date) === ymStr; }).sort(byNewest); }
  // Сколько всего денег в кошельках прямо сейчас: та же выборка, что в шапке
  // («В кошельках») — скрытые кошельки не считаем.
  function walletsTotal(S) {
    var b = 0;
    S.wallets.forEach(function (w) { if (!w.hidden) b += walletBalance(S, w.id); });
    return Math.round(b * 100) / 100;
  }
  // сколько категорий вида kind имеют лимит в этом месяце (только активные)
  function limitedCount(S, ymStr, kind) {
    var n = 0;
    listCategories(S, kind).forEach(function (c) { if (isNum(catLimit(S, c.id, ymStr))) n++; });
    return n;
  }
  // hasLimits - задан ли хоть один лимит расходов; без единого лимита «Осталось» не
  // считается (remaining: null): «−500 из 0» красным пугало бы на чистом старте, где
  // лимитов ещё нет. Явный лимит 0 - это лимит: тогда remaining считается как обычно.
  function summary(S, ymStr) {
    var balance = walletsTotal(S);
    var spent = 0, earned = 0;
    S.tx.forEach(function (t) { if (ym(t.date) !== ymStr) return; if (t.kind === 'exp') spent += t.amount; else if (t.kind === 'inc') earned += t.amount; });
    var planned = 0; listCategories(S, 'exp').forEach(function (c) { planned += planOr0(S, c.id, ymStr); });
    var earnedPlan = 0; listCategories(S, 'inc').forEach(function (c) { earnedPlan += planOr0(S, c.id, ymStr); });
    var hasLimits = limitedCount(S, ymStr, 'exp') > 0;
    var hasIncPlans = limitedCount(S, ymStr, 'inc') > 0;
    return { balance: Math.round(balance), spent: Math.round(spent), earned: Math.round(earned),
      planned: Math.round(planned), earnedPlan: Math.round(earnedPlan),
      hasLimits: hasLimits, hasIncPlans: hasIncPlans,
      remaining: hasLimits ? Math.round(planned - spent) : null };
  }
  // Ход по лимитам для процента в сводке: факт и лимит ТОЛЬКО по категориям, у которых
  // лимит задан. Иначе лимит у одной категории и траты в другой давали «2469 %».
  // limited/total - сколько категорий с лимитом из всех активных (для подписи).
  function limitProgress(S, ymStr, kind) {
    var fact = 0, plan = 0, limited = 0, total = 0;
    listCategories(S, kind).forEach(function (c) {
      total++;
      var lim = catLimit(S, c.id, ymStr);
      if (!isNum(lim)) return;
      limited++;
      plan += lim;
      fact += catFact(S, c.id, ymStr);
    });
    return { fact: Math.round(fact * 100) / 100, plan: Math.round(plan * 100) / 100,
      limited: limited, total: total };
  }
  // разрез месяца по категориям одного вида: факт, план и доля в общем факте.
  // Чистая функция для экрана «Сводка»: сортировка по факту вниз, доля 0 при пустом месяце.
  // hasPlan - задан ли лимит (plan 0 бывает и «нет лимита», и «явный ноль»).
  function monthBreakdown(S, ymStr, kind) {
    var rows = listCategories(S, kind, { ymStr: ymStr }).map(function (c) {
      return { catId: c.id, name: c.name, archived: !!c.archived,
        fact: catFact(S, c.id, ymStr), plan: planOr0(S, c.id, ymStr),
        hasPlan: isNum(catLimit(S, c.id, ymStr)), share: 0 };
    });
    var total = 0;
    rows.forEach(function (r) { total += r.fact; });
    if (total > 0) rows.forEach(function (r) { r.share = Math.round(r.fact / total * 10000) / 10000; });
    rows.sort(function (a, b) { return b.fact - a.fact; });
    return rows;
  }

  // ---------- тепловая карта: траты по дням месяца ----------
  // Сумма РАСХОДА за каждый календарный день месяца: { 'ГГГГ-ММ-ДД': сумма }. Дни без
  // трат в карту не попадают (экран красит их нейтрально). У прошлых месяцев (история с
  // компа) разбивки по дням нет — там карта пустая, экран показывает это словами.
  // Чистая функция, её же гоняют тесты.
  function daySpend(S, ymStr) {
    var out = {};
    S.tx.forEach(function (t) {
      if (t.kind !== 'exp' || ym(t.date) !== ymStr) return;
      out[t.date] = Math.round(((out[t.date] || 0) + t.amount) * 100) / 100;
    });
    return out;
  }

  // ---------- зона внимания: где перерасход ----------
  // Категории расхода, у которых факт перевалил за план (over) или подобрался к нему (warn,
  // ≥80%). Сортировка: сперва перебравшие — по сумме перерасхода вниз, за ними
  // подобравшиеся — по доле вниз. over — сколько сверх плана (для плана 0 это весь факт).
  // Работает и для прошлых месяцев: catFact берёт факт из истории. Чистая функция.
  function attention(S, ymStr) {
    var out = [];
    listCategories(S, 'exp', { ymStr: ymStr }).forEach(function (c) {
      var fact = catFact(S, c.id, ymStr);
      if (fact <= 0) return;
      var lim = catLimit(S, c.id, ymStr);        // null = лимит не задан → не тревога
      var f = fill(fact, lim);
      if (f.level !== 'over' && f.level !== 'warn') return;
      var plan = isNum(lim) ? lim : 0;
      out.push({ catId: c.id, name: c.name, archived: !!c.archived,
        fact: fact, plan: plan, level: f.level, ratio: f.ratio,
        over: Math.round((fact - plan) * 100) / 100 });
    });
    out.sort(function (a, b) {
      if ((a.level === 'over') !== (b.level === 'over')) return a.level === 'over' ? -1 : 1;
      if (a.level === 'over') return b.over - a.over;   // перебравшие — по перерасходу вниз
      return b.ratio - a.ratio;                          // подобравшиеся — по доле вниз
    });
    return out;
  }

  // ---------- динамика по месяцам ----------
  // Итог расхода и итог плана расхода по каждому месяцу года (0..11). Факт прошлых
  // месяцев берётся из истории с компа, месяцев с startYM и дальше — из живых операций.
  // Месяцы без трат отдаются с fact:0 (экран рисует пустой слот). Чистая функция.
  // kind: 'exp' (по умолчанию) или 'inc' - доходы и план дохода (14.10, «Динамика» с вкладками)
  function monthlyTotals(S, year, kind) {
    var k = kind === 'inc' ? 'inc' : 'exp';
    var out = [], live = listCategories(S, k);
    for (var m = 0; m < 12; m++) {
      var ymStr = year + '-' + pad2(m + 1), fact = 0, plan = 0;
      S.tx.forEach(function (t) { if (t.kind === k && ym(t.date) === ymStr) fact += t.amount; });
      live.forEach(function (c) { plan += planOr0(S, c.id, ymStr); });
      out.push({ m: m, fact: Math.round(fact * 100) / 100, plan: Math.round(plan * 100) / 100 });
    }
    return out;
  }

  // ---------- лента операций ----------
  // Подпись дня: «ЧТ, 3 сентября». День недели считаем в UTC — дата хранится строкой
  // «ГГГГ-ММ-ДД» без времени, и местный часовой пояс сдвигал бы её на сутки.
  var WEEKDAYS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function dayLabel(dateStr) {
    if (!isDate(dateStr)) return String(dateStr);
    var y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
    var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return WEEKDAYS[wd] + ', ' + d + ' ' + MONTHS_GEN[m - 1];
  }

  // Лента месяца, сгруппированная по дням: новые дни сверху, внутри дня — новые
  // операции сверху (по ts). change — чистое изменение дня (доход минус расход,
  // перевод ноль), balanceEnd — сколько было в кошельках на КОНЕЦ этого дня:
  // сегодняшний остаток минус всё, что случилось позже. Чистая функция, её же гоняют
  // тесты; экран только печатает то, что она посчитала.
  function feedByDay(S, ymStr) {
    var groups = {}, dates = [];
    S.tx.forEach(function (t) {
      if (ym(t.date) !== ymStr) return;
      if (!groups[t.date]) { groups[t.date] = []; dates.push(t.date); }
      groups[t.date].push(t);
    });
    dates.sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
    // остаток на конец дня - то же правило, что капитал (walletBalancesAt, Р1 ревью 15.10)
    var at = walletBalancesAt(S, dates);
    return dates.map(function (d, i) {
      var rows = groups[d].slice().sort(function (a, b) {
        var ta = isNum(a.ts) ? a.ts : 0, tb = isNum(b.ts) ? b.ts : 0;
        if (tb !== ta) return tb - ta;
        return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);   // одинаковый ts — порядок всё равно один и тот же
      });
      var change = 0;
      rows.forEach(function (t) {
        if (t.kind === 'inc') change += t.amount;
        else if (t.kind === 'exp') change -= t.amount;
      });
      return { date: d, label: dayLabel(d), rows: rows,
        change: Math.round(change * 100) / 100,
        balanceEnd: visibleSum(S, at[i]) };
    });
  }

  // ---------- долги (1.0.4, концепция docs/1.0.4-dolgi-koncepciya.md) ----------
  // Долг живёт как кошелёк: base + baseTs (точка отсчёта, «Поправить остаток»), остаток =
  // base + живые операции. Операция долга - kind 'debt' с кошельком на другом конце:
  //   op 'pay'  - кошелёк → долг: «я должен» - платёж (остаток меньше), «мне должны» - одолжил (больше);
  //   op 'take' - долг → кошелёк: «я должен» - взял ещё (больше), «мне должны» - вернули (меньше).
  // Проценты по ставке - часть платежа (поле int записи долга), НЕ расход (решение 13.10):
  // кошелёк уменьшает весь платёж, долг - только тело (debtPart). Категории для процентов нет;
  // имя старой категории - для уборки при миграции (dropInterestCat).
  var INTEREST_CAT = 'Проценты по долгам';
  var REMIND_HOUR = 10;          // во сколько приходят напоминания (местное время)
  // долговая нагрузка выше 30% - красный баннер; в процентах: сравниваем с показанным числом
  // (30,4 %). Порог один - его же берёт экран «Долги» (summary.js: отметка и текст)
  var LOAD_HIGH_PCT = 30;
  function r2(x) { return Math.round(x * 100) / 100; }
  // на сколько операция долга двигает сам долг: у платежа «я должен» со ставкой - без процентов
  function debtPart(t) {
    return t.kind === 'debt' && t.op === 'pay' && isNum(t.int) && t.int > 0 ? r2(t.amount - t.int) : t.amount;
  }
  function payInt(t) { return t && t.kind === 'debt' && t.op === 'pay' && isNum(t.int) && t.int > 0 ? t.int : 0; }
  function findDebt(S, id) {
    var l = S.debts || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  // как операция op двигает остаток долга d: +1 - растёт, -1 - уменьшается
  function debtSign(d, op) {
    if (d && d.type === 'owed') return op === 'pay' ? 1 : -1;
    return op === 'pay' ? -1 : 1;
  }
  function lastDayOf(ymStr) { return new Date(Date.UTC(+ymStr.slice(0, 4), +ymStr.slice(5, 7), 0)).getUTCDate(); }
  // дата платежа в месяце: 29, 30, 31-е в коротком месяце - последний день (31 → 28/29 февраля)
  function dueDate(ymStr, day) {
    var d = Math.max(1, Math.min(Math.floor(Number(day) || 1), lastDayOf(ymStr)));
    return ymStr + '-' + pad2(d);
  }
  function addMonths(ymStr, k) {
    var y = +ymStr.slice(0, 4), m = +ymStr.slice(5, 7) - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }
  function shiftDay(dateStr, k) {
    var t = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) + k * 86400000;
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function debtsActive(S) {
    return (S.debts || []).filter(function (d) { return !d.archived; })
      .sort(function (a, b) { return a.order - b.order; });
  }
  function debtsActiveCount(S) { return debtsActive(S).length; }
  function canAddDebt(S, full) {
    if (debtsActiveCount(S) >= HARD.debts) return false;           // предохранитель
    return !!full || debtsActiveCount(S) < FREE.debts;
  }
  function hasOweDebts(S) { return debtsActive(S).some(function (d) { return d.type === 'owe'; }); }

  function checkMoney(v, zeroOk) {
    var a = Number(v);
    if (!isNum(a) || a < 0 || (!zeroOk && a === 0)) throw new Error('amount');
    if (a > MAX_AMOUNT) throw new Error('amount-max');
    return r2(a);
  }
  // Правила полей долга - одни на «новый» и «правку». Бросает 'pay' | 'day' | 'rate' | 'date'.
  function debtFields(type, o) {
    var f = { pay: 0, day: null, rate: null, due: null };
    if (type === 'owe') {
      var p = Number(o.pay);
      if (!isNum(p) || p <= 0) throw new Error('pay');
      if (p > MAX_AMOUNT) throw new Error('amount-max');
      f.pay = r2(p);
      var day = Number(o.day);
      if (!isNum(day) || Math.floor(day) !== day || day < 1 || day > 31) throw new Error('day');
      f.day = day;
    } else if (o.due != null && o.due !== '') {
      if (!isDate(o.due)) throw new Error('date');
      f.due = o.due;
    }
    // ставка - у обоих видов; у «мне должны» только показывается (14.10): interestDue и
    // resplitDebtMonth считают проценты лишь для «я должен», возврат целиком идёт в тело
    if (o.rate != null && o.rate !== '') {
      var r = Number(o.rate);
      if (!isNum(r) || r < 0 || r > 100) throw new Error('rate');
      f.rate = r > 0 ? r : null;
    }
    return f;
  }
  // o: {type, name, amount (остаток), pay, day, rate | due, date (когда завели), now}
  function addDebt(S, o) {
    o = o || {};
    if (!S.debts) S.debts = [];
    var type = o.type === 'owed' ? 'owed' : 'owe';
    var amt = checkMoney(o.amount, true);
    var f = debtFields(type, o);
    var name = String(o.name == null ? '' : o.name).trim();
    var created = isDate(o.date) ? o.date : today();
    var d = { id: 'd' + uid().slice(1), name: name || 'Долг', type: type,
      base: amt, baseTs: isNum(o.now) ? o.now : Date.now(), start: amt,
      pay: f.pay, day: f.day, rate: f.rate, due: f.due, remind: false,
      order: S.debts.length, archived: false, archivedDate: null, closeAdj: false,
      createdDate: created, adj: [],
      payHist: type === 'owe' ? [{ ym: ym(created), pay: f.pay }] : [],
      rateHist: type === 'owe' && f.rate > 0 ? [{ ym: ym(created), rate: f.rate }] : [] };
    S.debts.push(d);
    return d;
  }
  // Правка настроек (имя, платёж, день, ставка, дата возврата, напоминание). Остаток - не
  // здесь: setDebtBase. Проверка до записи, как у updateTx. Новый платёж действует с месяца
  // правки (nowYm, по умолчанию текущий): нагрузка и сроки прошлых месяцев - по прежнему.
  function updateDebt(S, id, patch, nowYm) {
    var d = findDebt(S, id);
    if (!d) return null;
    patch = patch || {};
    var merged = { pay: 'pay' in patch ? patch.pay : d.pay, day: 'day' in patch ? patch.day : d.day,
      rate: 'rate' in patch ? patch.rate : d.rate, due: 'due' in patch ? patch.due : d.due };
    var f = debtFields(d.type, merged);
    if ('name' in patch) { var n = String(patch.name == null ? '' : patch.name).trim(); if (n) d.name = n; }
    if (d.type === 'owe' && Math.abs(f.pay - d.pay) >= 0.005) notePay(d, f.pay, payFromYm(S, d, nowYm || ym(today())));
    // Р2 ревью 15.10: новая ставка - с месяца правки (проценты этого месяца уже взяты платежом -
    // со следующего), прошлые месяцы при любом пересчёте остаются по своей ставке
    var rf = d.type === 'owe' && (f.rate || 0) !== (d.rate || 0) ? rateFromYm(S, d, nowYm || ym(today())) : null;
    if (rf) noteRate(d, f.rate || 0, rf);
    d.pay = f.pay; d.day = f.day; d.rate = f.rate; d.due = f.due;
    if ('remind' in patch) d.remind = patch.remind === true;
    if (rf) resplitDebtFrom(S, d.id, rf < ym(d.createdDate) ? ym(d.createdDate) : rf);
    return d;
  }
  // С какого месяца действует новая ставка: с месяца правки, а если в нём уже есть платёж (банк
  // проценты месяца уже взял по прежней ставке) - со следующего. Так смена ставки не меняет уже
  // записанные платежи: ни остаток, ни разбивку.
  function rateFromYm(S, d, m) {
    return S.tx.some(function (t) { return isDebtPayRow(t) && t.debtId === d.id && ym(t.date) === m; }) ? addMonths(m, 1) : m;
  }
  function noteRate(d, rate, m) {
    var h = d.rateHist || (d.rateHist = []);
    if (m < ym(d.createdDate)) m = ym(d.createdDate);
    if (!h.length) h.push({ ym: ym(d.createdDate), rate: d.rate > 0 ? d.rate : 0 });
    for (var i = h.length - 1; i >= 0; i--) if (h[i].ym > m) h.splice(i, 1);
    var last = h[h.length - 1];
    if (last && last.ym === m) last.rate = rate; else h.push({ ym: m, rate: rate });
  }
  // ставка % годовых, действовавшая в месяце ymStr (0 - без ставки)
  function rateAt(d, ymStr) {
    var h = (d && d.rateHist) || [], r = h.length ? h[0].rate : (d && d.rate > 0 ? d.rate : 0);
    for (var i = 0; i < h.length; i++) if (h[i].ym <= ymStr) r = h[i].rate;
    return r > 0 ? r : 0;
  }
  // у «я должен» хоть когда-то была ставка - проценты есть что пересчитывать
  function hasRate(d) {
    return !!d && d.type === 'owe' && (d.rate > 0 || (d.rateHist || []).some(function (e) { return e.rate > 0; }));
  }
  // С какого месяца действует новый платёж (ревью 12.10 №2): не раньше месяца правки и не
  // раньше первого НЕзакрытого срока. Закрытые сроки (в том числе этого месяца и оплаченные
  // заранее) сравниваются с платежом, который действовал, когда их закрыли: правка платежа
  // задним числом их не «открывает». Сроки закрываются по порядку, поэтому первый незакрытый -
  // следующий за последним закрытым.
  function payFromYm(S, d, m) {
    var terms = debtTerms(S, d.id, m), last = -1;
    for (var i = 0; i < terms.length; i++) if (terms[i].paid) last = i;
    if (last < 0) return m;
    var next = last + 1 < terms.length ? terms[last + 1].ym : addMonths(terms[last].ym, 1);
    return next > m ? next : m;
  }
  function notePay(d, pay, m) {
    var h = d.payHist || (d.payHist = []);
    if (m < ym(d.createdDate)) m = ym(d.createdDate);
    for (var i = h.length - 1; i >= 0; i--) if (h[i].ym > m) h.splice(i, 1);
    var last = h[h.length - 1];
    if (last && last.ym === m) last.pay = pay; else h.push({ ym: m, pay: pay });
  }
  // ежемесячный платёж, действовавший в месяце ymStr
  function payAt(d, ymStr) {
    var h = (d && d.payHist) || [], p = h.length ? h[0].pay : (d ? d.pay : 0);
    for (var i = 0; i < h.length; i++) if (h[i].ym <= ymStr) p = h[i].pay;
    return p;
  }
  // «Поправить остаток»: правка-событие с датой (по умолчанию сегодня). С этого дня остаток -
  // ровно amount; остаток на конец прошлых месяцев, капитал и нагрузка прошлого не меняются.
  // Правки одного дня складываются в одну запись.
  function setDebtBase(S, id, amount, now, dateStr) {
    var d = findDebt(S, id);
    if (!d) return null;
    var a = checkMoney(amount, true);
    var date = isDate(dateStr) ? dateStr : today();
    if (date < d.createdDate) date = d.createdDate;
    var delta = r2(a - debtBalance(S, id)), ts = isNum(now) ? now : Date.now();
    if (Math.abs(delta) < 0.005) return d;
    if (!d.adj) d.adj = [];
    var last = d.adj[d.adj.length - 1], e;
    // правки одного дня - одна запись, но не через платёж этого дня: правка до платежа входит в
    // остаток перед ним (его проценты), после - нет (Р2 ревью 15.10); слить их - сдвинуть проценты
    var payAfter = last && S.tx.some(function (t) { return isDebtPayRow(t) && t.debtId === id && t.date === date && (t.ts || 0) > (last.ts || 0); });
    if (last && last.date === date && !last.close && !payAfter) {
      last.delta = r2(last.delta + delta); last.ts = ts;
      if (Math.abs(last.delta) < 0.005) { d.adj.pop(); resplitDebtFrom(S, id, ym(date)); return d; }
      e = last;
    } else d.adj.push(e = { date: date, delta: delta, ts: ts });
    // правка задним числом до платежа месяца меняет остаток перед ним - его проценты (и всех
    // следующих месяцев) пересчитываются; остаток «с этого дня ровно amount» держим: разницу,
    // которую дал пересчёт процентов, добираем той же правкой (сходится за 2-3 шага)
    for (var k = 0; k < 6; k++) {
      resplitDebtFrom(S, id, ym(date));
      var miss = r2(a - debtBalance(S, id));
      if (Math.abs(miss) < 0.005) break;
      e.delta = r2(e.delta + miss);
    }
    return d;
  }
  function adjSum(d, dateStr) {
    var s = 0;
    (d.adj || []).forEach(function (a) { if (!dateStr || a.date <= dateStr) s += a.delta; });
    return s;
  }
  function debtBalance(S, id) {
    var d = findDebt(S, id);
    if (!d) return 0;
    var b = d.base + adjSum(d);
    for (var i = 0; i < S.tx.length; i++) {
      var t = S.tx[i];
      if (t.kind !== 'debt' || t.debtId !== id || t.ts < d.baseTs) continue;
      b += debtSign(d, t.op) * debtPart(t);
    }
    return r2(b);
  }
  // остаток долга на конец дня dateStr (null - долга тогда ещё не было): заведение + операции и
  // правки остатка с датой не позже dateStr
  function debtBalanceAt(S, id, dateStr) {
    var d = findDebt(S, id);
    if (!d || d.createdDate > dateStr) return null;
    var b = d.base + adjSum(d, dateStr);
    S.tx.forEach(function (t) {
      if (t.kind === 'debt' && t.debtId === id && t.ts >= d.baseTs && t.date <= dateStr) b += debtSign(d, t.op) * debtPart(t);
    });
    return r2(b);
  }
  // «Было» и доля выплаченного: было = остаток при заведении + всё, что брали после;
  // выплачено = 1 - осталось/было (поправка остатка вверх, например пени, долю уменьшит).
  function debtProgress(S, id) {
    var d = findDebt(S, id);
    if (!d) return { was: 0, left: 0, share: 0 };
    var grow = 0;
    S.tx.forEach(function (t) {
      if (t.kind === 'debt' && t.debtId === id && debtSign(d, t.op) > 0) grow += debtPart(t);
    });
    var was = r2(d.start + grow), left = debtBalance(S, id);
    var share = was > 0 ? Math.max(0, Math.min(1, 1 - left / was)) : (left <= 0 ? 1 : 0);
    return { was: was, left: left, share: share };
  }

  // платёж «я должен» этого долга, в котором есть проценты
  function isIntPay(t, id) { return t.kind === 'debt' && t.op === 'pay' && t.debtId === id && payInt(t) > 0; }
  // Р5 ревью 15.10: подсказка «из них проценты X ₽» на экране суммы - тем же путём, что запись:
  // payDebt на копии одного долга (сам долг и его строки, остальные операции не нужны: экран
  // суммы зовёт это на каждую цифру, копировать 20 000 операций нельзя). Что показали - то и
  // запишется, с той же датой. Раньше подсказку считало отдельное правило (paySplit) без даты и
  // расходилось с записью задним числом (0 вместо 1 000). over - запись отказала бы ('over').
  function previewPay(S, o) {
    var d = findDebt(S, o && o.debtId), a = r2(Number(o && o.amount) || 0);
    var none = { interest: 0, body: a, left: 0, over: false };
    if (!d || !(a > 0)) return none;
    var C = { debts: [JSON.parse(JSON.stringify(d))], wallets: [], tx: [] };
    S.tx.forEach(function (t) { if (t.debtId === d.id) C.tx.push(Object.assign({}, t)); });
    try {
      var t = payDebt(C, { debtId: d.id, amount: a, date: o.date, payoff: o.payoff === true }).txs[0], i = payInt(t);
      return { interest: i, body: r2(a - i), left: i > 0 && isNum(t.intLeft) ? t.intLeft : 0, over: false };
    } catch (e) {
      none.over = !!e && e.message === 'over';
      return none;
    }
  }
  // запись платежа «я должен» (весь платёж одной записью; проценты - поле int)
  function isDebtPayRow(t) {
    return !!t && !!t.debtId && t.kind === 'debt' && t.op === 'pay';
  }
  // Ревью 12.10 №4/№6: проценты месяца - в ПЕРВОМ платеже месяца. После удаления платежа или
  // переноса его даты разбивку тело/проценты месяца ymStr считаем заново, как если бы платежи
  // месяца записывали по порядку: первый - недоплата прошлых месяцев + остаток до него × ставка
  // / 12, следующие - только недоплата (intLeft). Сумма каждого платежа, его дата и кошелёк те
  // же (кошелёк не сдвигается), меняется только доля процентов - то есть тело долга.
  function resplitDebtMonth(S, id, ymStr) {
    var d = findDebt(S, id);
    if (!hasRate(d)) return;
    // старые записи до точки отсчёта долга (ts < baseTs) уже в его base и в остатке не
    // участвуют - их разбивку не трогаем, в очередь месяца они не встают
    var pays = S.tx.filter(function (t) {
      return t.debtId === id && ym(t.date) === ymStr && isDebtPayRow(t) && !(isNum(t.ts) && t.ts < d.baseTs);
    });
    if (!pays.length) return;
    // одно время записи (одна миллисекунда) - порядок записи в S.tx (сортировка устойчивая), а не
    // случайный хвост id: иначе проценты месяца доставались то одному, то другому платежу
    pays.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var at = isNum(a.ts) ? a.ts : 0, bt = isNum(b.ts) ? b.ts : 0;
      return at - bt;
    });
    var first = pays[0], fts = isNum(first.ts) ? first.ts : 0;
    // остаток перед первым платежом месяца: на конец его дня без платежей этого дня
    var bal = debtBalanceAt(S, id, first.date) || 0;
    S.tx.forEach(function (t) {
      if (isDebtPayRow(t) && t.debtId === id && t.date === first.date && (isNum(t.ts) ? t.ts : 0) >= d.baseTs) bal += debtPart(t);
    });
    // Р2 ревью 15.10: правка остатка того же дня, внесённая ПОСЛЕ платежа, в остаток перед ним
    // не входит (платёж 10 000, остаток 95 000, платёж 1 000 → 94 000, а не 94 040)
    (d.adj || []).forEach(function (a) { if (a.date === first.date && (isNum(a.ts) ? a.ts : 0) > fts) bal -= a.delta; });
    // недоплата процентов прошлых месяцев - последний платёж с процентами до этого месяца
    var best = null, m0 = ymStr + '-01';
    S.tx.forEach(function (t) {
      if (!(isIntPay(t, id) && t.date < m0)) return;
      if (!best || t.date > best.date || (t.date === best.date && (t.ts || 0) >= (best.ts || 0))) best = t;
    });
    // Р2: ставка того месяца (rateHist), не нынешняя
    var rate = rateAt(d, ymStr);
    var due = r2((best && isNum(best.intLeft) ? best.intLeft : 0) + (bal > 0 ? bal * rate / 100 / 12 : 0));
    pays.forEach(function (t) {
      // закрывающий платёж «Долг погашен» (payoff) - всегда целиком в тело: остаток, который он
      // погасил, уже был суммой к полному погашению (решение 14.10). Проценты он не забирает.
      if (t.payoff) { setInt(t, 0, 0); return; }
      var i = r2(Math.min(due, t.amount)), left = r2(due - i);
      setInt(t, i, left);
      due = left;
    });
  }
  // Ревью 14.10 №1-2: платёж записан задним числом, правлен или удалён - проценты пересчитываются
  // с его месяца по все следующие, по порядку месяцев: проценты месяца зависят от остатка перед
  // ним, недоплата - от прошлого месяца. Один путь для записи, правки и удаления; раньше
  // пересчитывался только свой месяц (и только при смене даты), а платёж задним числом брал
  // недоплату прошлого месяца второй раз.
  function resplitDebtFrom(S, id, fromYm) {
    var d = findDebt(S, id);
    if (!hasRate(d)) return;
    var months = {};
    S.tx.forEach(function (t) {
      if (isDebtPayRow(t) && t.debtId === id && ym(t.date) >= fromYm) months[ym(t.date)] = 1;
    });
    Object.keys(months).sort().forEach(function (m) { resplitDebtMonth(S, id, m); });
  }
  function setInt(t, i, left) {
    if (i > 0) t.int = i; else delete t.int;
    if (i > 0 && left > 0) t.intLeft = left; else delete t.intLeft;
  }
  // Р3/Р4 ревью 15.10: ОДИН путь записи долга - запись платежа, «взял ещё», правка, удаление.
  // Снимок строк этого долга (все поля, в том числе разбивка int/intLeft), порядка S.tx и баз
  // (кошельки, долг) → мутация → пересчёт процентов с месяца fromYm → остаток стал меньше нуля
  // (и меньше, чем был: старые данные с минусом не запирают долг) - всё из снимка как было и
  // 'over'. Откат - снимком, а не повторным пересчётом: пересчёт не точное обратное (старая
  // разбивка, смена ставки - 91 000 становились 92 000 после отказа). Раньше проверка шла до
  // пересчёта или не шла вовсе: перенос даты, правка и удаление «взял ещё» давали минус.
  // amount - сумма операции, уменьшающей долг: e.max = сколько ею можно внести (сумма минус
  // перебор; меньшая сумма даёт остаток не меньше - проценты следующих месяцев только растут).
  function commitDebt(S, d, fromYm, mutate, amount) {
    var before = debtBalance(S, d.id), txs = S.tx.slice();
    var rows = txs.filter(function (t) { return t.debtId === d.id; }).map(function (t) { return [t, Object.assign({}, t)]; });
    var wb = S.wallets.map(function (w) { return [w, w.base]; }), db = d.base;
    var res = mutate();
    resplitDebtFrom(S, d.id, fromYm);
    var after = debtBalance(S, d.id);
    if (after < -0.004 && after < before - 0.004) {
      S.tx.length = 0;
      for (var i = 0; i < txs.length; i++) S.tx.push(txs[i]);
      rows.forEach(function (p) {
        Object.keys(p[0]).forEach(function (k) { if (!(k in p[1])) delete p[0][k]; });
        Object.assign(p[0], p[1]);
      });
      wb.forEach(function (p) { p[0].base = p[1]; });
      d.base = db;
      var e = new Error('over');
      if (isNum(amount)) e.max = Math.max(0, r2(amount + after));
      throw e;
    }
    return res;
  }
  // дата последней операции долга (платёж, «взял ещё», возврат) или null
  function debtLastDate(S, id) {
    var m = null;
    S.tx.forEach(function (t) { if (t.kind === 'debt' && t.debtId === id && (!m || t.date > m)) m = t.date; });
    return m;
  }
  function checkTxDate(date) {
    if (date != null && !isDate(date)) throw new Error('date');
    if (futureDate(date)) throw new Error('date-future');
    return date || today();
  }
  // Кошелёк → долг. Одна запись на весь платёж; проценты - её поле int, их считает пересчёт
  // месяца (resplitDebtMonth). Возвращает {interest, body, txs:[t], grp:null}.
  // 'over' - тело больше остатка «я должен» (переплатить долг нельзя), e.max - сколько можно;
  // 'before-created' - дата раньше заведения долга (те платежи уже в остатке).
  // o.payoff - закрывающий платёж «Долг погашен» с кошелька (решение 14.10): весь платёж в
  // тело, процентов не отделяем. Остаток долга - «сколько банк покажет к полному погашению»,
  // проценты по нему уже внутри; отделили бы проценты месяца - долг остался бы не ноль, а
  // кошелёк потерял бы больше, чем человек заплатил. Так долг ровно 0, кошелёк - ровно остаток.
  // Р13 ревью 15.10: закрывающий - только не раньше последней операции долга. Остаток «сейчас»,
  // погашенный задним числом раньше более позднего платежа, уменьшил бы остаток перед тем
  // платежом, его проценты, и долг ушёл бы в минус на ту же сумму ('over'). Раньше - обычный
  // платёж (чип «Весь остаток» на такую дату экран суммы и не показывает).
  function payDebt(S, o) {
    var d = findDebt(S, o && o.debtId);
    if (!d) throw new Error('debt');
    var a = checkMoney(o.amount, false);
    var date = checkTxDate(o.date);
    if (date < d.createdDate) throw new Error('before-created');
    var last = debtLastDate(S, d.id);
    var off = d.type === 'owe' && o.payoff === true && (!last || date >= last);
    var t = { id: uid(), kind: 'debt', op: 'pay', amount: a, date: date, ts: Date.now(), catId: null,
      walletId: o.walletId || null, toWalletId: null, debtId: d.id };
    if (off) t.payoff = true;
    setNote(t, o.note);
    commitDebt(S, d, ym(date), function () { S.tx.push(t); }, d.type === 'owe' ? a : null);
    var pi = payInt(t);
    return { interest: pi, body: r2(a - pi), txs: [t], grp: null };
  }
  // Долг → кошелёк. 'over' - «мне должны» вернули больше, чем должны (e.max - сколько должны).
  // «Взяли ещё» задним числом - остаток следующих месяцев больше, их проценты тоже (commitDebt).
  function takeDebt(S, o) {
    var d = findDebt(S, o && o.debtId);
    if (!d) throw new Error('debt');
    var a = checkMoney(o.amount, false);
    var date = checkTxDate(o.date);
    if (date < d.createdDate) throw new Error('before-created');
    var t = { id: uid(), kind: 'debt', op: 'take', amount: a, date: date, ts: Date.now(), catId: null,
      walletId: o.walletId || null, toWalletId: null, debtId: d.id };
    setNote(t, o.note);
    commitDebt(S, d, ym(date), function () { S.tx.push(t); }, d.type === 'owed' ? a : null);
    return { interest: 0, body: a, txs: [t], grp: null };
  }
  // Правка операции по долгу целиком (окно «Операция»): сумма - весь платёж (тело + проценты),
  // дата и кошелёк. Проценты - пересчётом с более раннего из двух месяцев (commitDebt); итог
  // меньше нуля - 'over' и всё как было (e.max - для платежа «я должен» и возврата «мне должны»),
  // дата раньше заведения долга - 'before-created'.
  function editDebtTx(S, id, patch) {
    var t = findTx(S, id);
    if (!t || !t.debtId) return null;
    patch = patch || {};
    var d = findDebt(S, t.debtId), oldDate = t.date;
    var total = checkMoney(patch.amount, false);
    var date = 'date' in patch ? patch.date : t.date;
    if (!isDate(date)) throw new Error('date');
    if (futureDate(date)) throw new Error('date-future');
    if (d && date < d.createdDate) throw new Error('before-created');
    var take = t.kind === 'debt' && t.op === 'take';
    var wid = 'walletId' in patch ? patch.walletId : t.walletId;
    // Р7 ревью 15.10: правка суммы или даты закрывающего платежа - обычный платёж (иначе проценты
    // месяца терялись: 120 000 → 20 000 давало 100 000 вместо 101 200)
    var moved = Math.abs(total - t.amount) >= 0.005 || date !== oldDate;
    function apply() {
      // проценты прежние, не больше новой суммы (у долга без ставки пересчёта нет - иначе тело
      // ушло бы в минус); со ставкой их тут же пересчитает commitDebt
      var oldInt = payInt(t), newInt = take ? 0 : Math.min(oldInt, total);
      // замороженную запись updateTx сперва вынимает из base старым эффектом (refundFrozen - тело
      // по старому int), потому int меняем только после него
      updateTx(S, t.id, { amount: total, date: date, walletId: wid });
      if (!take) setInt(t, newInt, r2((isNum(t.intLeft) ? t.intLeft : 0) + r2(oldInt - newInt)));
      if (moved) delete t.payoff;
      if ('note' in patch) setNote(t, patch.note);   // 1.0.5: заметка правится вместе с платежом
    }
    if (!d) { apply(); return t; }
    var dec = (d.type === 'owe' && !take) || (d.type === 'owed' && take);
    commitDebt(S, d, ym(date < oldDate ? date : oldDate), apply, dec ? total : null);
    return t;
  }
  // История долга: по строке на операцию (платёж - тело и проценты одной строкой), новые сверху.
  function debtHistory(S, id) {
    var rows = [];
    S.tx.forEach(function (t) {
      if (t.debtId !== id || t.kind !== 'debt') return;
      var i = payInt(t);
      rows.push({ id: t.id, date: t.date, ts: isNum(t.ts) ? t.ts : 0, op: t.op, walletId: t.walletId,
        body: r2(t.amount - i), interest: i, total: t.amount, note: t.note || '' });
    });
    return rows.sort(function (a, b) { return (b.date + b.ts) < (a.date + a.ts) ? -1 : 1; });
  }
  // Погашен → архив. Пока остаток не ноль - нельзя ('not-zero').
  function archiveDebt(S, id, on) {
    var d = findDebt(S, id);
    if (!d) return null;
    if (on === false) { d.archived = false; d.archivedDate = null; d.closeAdj = false; return d; }
    if (Math.abs(debtBalance(S, id)) >= 0.005) throw new Error('not-zero');
    d.archived = true; d.archivedDate = today(); d.remind = false; d.closeAdj = false;
    return d;
  }
  // «Без денег» при ненулевом остатке (решения 13.10, 14.10): остаток обнуляется
  // событием с датой dateStr (как «Поправить остаток» - прошлые месяцы не меняются), долг уходит
  // в архив. История платежей остаётся. Обнуление - отдельная запись {close:true} (не сливается
  // с правками того же дня): в истории долга она видна строкой, а «Отменить» и «Вернуть из
  // архива» снимают ровно её (reopenDebt) - остаток возвращается как был (ревью 13.10 №1).
  function closeDebt(S, id, dateStr, now) {
    var d = findDebt(S, id);
    if (!d || d.archived) return null;
    var left = debtBalance(S, id), date = isDate(dateStr) ? dateStr : today();
    if (date < d.createdDate) date = d.createdDate;
    var mark = Math.abs(left) >= 0.005;
    if (mark) {
      if (!d.adj) d.adj = [];
      d.adj.push({ date: date, delta: r2(-left), ts: isNum(now) ? now : Date.now(), close: true });
    }
    archiveDebt(S, id);
    d.closeAdj = mark;
    return d;
  }
  // Сколько вернут «Отменить» и «Вернуть из архива»: остаток, обнулённый строкой «Без денег»
  // (0 - долг ушёл в архив при нуле, возвращать нечего).
  function closedLeft(S, id) {
    var d = findDebt(S, id);
    if (!d || !d.archived || !d.closeAdj) return 0;
    var la = (d.adj || [])[d.adj.length - 1];
    return la && la.close ? r2(-la.delta) : 0;
  }
  // Вернуть из архива. Ушёл кнопкой «Долг погашен» с остатком - снимаем то обнуление: остаток
  // снова прежний. Возвращает возвращённый остаток (0 - обнуления не было), null - нечего вернуть.
  function reopenDebt(S, id) {
    var d = findDebt(S, id);
    if (!d || !d.archived) return null;
    var back = closedLeft(S, id);
    if (back) d.adj.pop();
    archiveDebt(S, id, false);
    return back;
  }
  // Архивный долг с ненулевым остатком (удалили или поправили его платёж из карточки кошелька
  // или ленты, копия данных) - снова на экране: в архиве только закрытые (ревью 13.10 №2).
  // Возвращает имена вернувшихся.
  function reopenNonZero(S) {
    var out = [];
    (S.debts || []).forEach(function (d) {
      if (d.archived && Math.abs(debtBalance(S, d.id)) >= 0.005) { archiveDebt(S, d.id, false); out.push(d.name); }
    });
    return out;
  }
  // Записи «Долг погашен · остаток X ₽ обнулён» для истории долга: [{date, ts, left}]
  function debtCloseEvents(S, id) {
    var d = findDebt(S, id);
    return ((d && d.adj) || []).filter(function (a) { return a.close; })
      .map(function (a) { return { date: a.date, ts: a.ts, left: r2(-a.delta) }; });
  }
  // Удалить долг насовсем (заведён по ошибке). Его операции уходят, но балансы кошельков
  // остаются как были (эффект живого платежа вшивается в base кошелька, как у deleteWallet):
  // деньги правда уходили (весь платёж, с процентами).
  function deleteDebt(S, id) {
    var d = findDebt(S, id);
    if (!d) return null;
    var removed = 0;
    S.tx = S.tx.filter(function (t) {
      if (t.kind === 'debt' && t.debtId === id) {
        var w = findWallet(S, t.walletId), e = t.op === 'take' ? t.amount : -t.amount;
        if (w && (isNum(t.ts) ? t.ts : 0) >= w.baseTs) w.base = r2(w.base + e);
        // Р21 ревью 15.10: и событие датой платежа - прошлые месяцы кошелька не сдвигаются
        if (w) pushWalletAdj(w, t.date, e, true);
        removed++;
        return false;
      }
      if (t.debtId === id) delete t.debtId;
      return true;
    });
    S.debts.splice(S.debts.indexOf(d), 1);
    debtsActive(S).forEach(function (x, i) { x.order = i; });
    if (S.ui && isObj(S.ui.debtWarn)) Object.keys(S.ui.debtWarn).forEach(function (k) { if (k.indexOf(id + '|') === 0) delete S.ui.debtWarn[k]; });
    return { id: d.id, name: d.name, removed: removed };
  }

  // Был ли в месяце платёж по долгу - для нагрузки: долг, закрытый
  // последним платежом в этом месяце, в месяце ещё был
  function debtPaidIn(S, id, ymStr) {
    return S.tx.some(function (t) {
      return t.debtId === id && ym(t.date) === ymStr && t.kind === 'debt' && t.op === 'pay';
    });
  }

  // ---------- сроки платежей «я должен» (решение 12.10 по ревью) ----------
  // Срок - день платежа каждого месяца. Платежи по порядку гасят САМЫЙ РАННИЙ непогашенный
  // срок. Окно цикла: платёж может закрыть срок, если сделан СТРОГО ПОСЛЕ предыдущего срока
  // (для первого - не раньше дня заведения долга) - оплата заранее в своём цикле (30.09 за
  // срок 01.10, 1-е за срок 28-го того же месяца), или когда угодно позже (опоздание: платёж
  // 05.10 за пропущенный сентябрь закрывает сентябрь, а не октябрь). Срок закрыт, когда
  // платежи на него набрали ежемесячный платёж того месяца (две половинки - тоже); излишек
  // одного платежа (досрочка) следующих сроков не закрывает (решение 12.10).
  // платежи «я должен» (весь платёж, с процентами), по дате, затем по записи
  function debtPayments(S, id) {
    var out = [];
    S.tx.forEach(function (t) {
      if (t.debtId !== id || !isDebtPayRow(t)) return;
      out.push({ id: t.id, date: t.date, ts: isNum(t.ts) ? t.ts : 0, amount: t.amount });
    });
    return out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }
  // Сроки до месяца uptoYm включительно: [{ym, due, pay, soft, paid, paidOn, got}]. Первый -
  // месяц после заведения; срок месяца заведения «мягкий» (soft), если его дата не раньше дня
  // заведения: платёж до неё засчитывается, а пропуск просрочкой не считается - остаток могли
  // вписать уже после платежа этого месяца (решение 11.10).
  function debtTerms(S, id, uptoYm) {
    var d = findDebt(S, id);
    if (!d || d.type !== 'owe' || !(d.pay > 0) || !d.day) return [];
    var pays = debtPayments(S, id);
    var end = uptoYm;
    if (pays.length) { var lp = addMonths(ym(pays[pays.length - 1].date), 1); if (lp > end) end = lp; }
    var cm = ym(d.createdDate), terms = [];
    for (var m = dueDate(cm, d.day) >= d.createdDate ? cm : addMonths(cm, 1); m <= end && terms.length < 1200; m = addMonths(m, 1)) {
      terms.push({ ym: m, due: dueDate(m, d.day), pay: payAt(d, m), soft: m === cm, paid: false, paidOn: null, got: 0 });
    }
    var i = 0;
    pays.forEach(function (p) {
      // мягкий срок закрывает только платёж своего месяца (месяца заведения - в любой его день,
      // в том числе позже дня платежа: 06.10 при дне 5, заведён 01.10 - это октябрь, не ноябрь;
      // ревью 12.10 №2). Платёж следующего месяца идёт в свой срок, даже до его даты: мягкий срок
      // и так не даёт просрочки, а заберёт платёж - просрочит следующий (Р9 ревью 15.10: заведён
      // 03.09, день 5, платёж 03.10 - был «за сентябрь», и 06.10 «просрочка октября»)
      while (i < terms.length && terms[i].soft && ym(p.date) > terms[i].ym) i++;
      if (i >= terms.length) return;
      var T = terms[i];
      if (i === 0 ? p.date < d.createdDate : p.date <= terms[i - 1].due) return;   // раньше цикла срока - не платёж срока
      T.got = r2(T.got + p.amount);
      if (T.got >= T.pay - 0.005) { T.paid = true; T.paidOn = p.date; i++; }
    });
    return terms;
  }
  // Состояние «я должен» на день todayStr:
  //   overdue - есть срок, день которого прошёл, а он не закрыт (красная плитка + баннер);
  //             ym/due - последний такой срок, missed - все пропущенные месяцы по порядку;
  //   paid    - срок этого месяца закрыт (в том числе заранее, в прошлом месяце);
  //   soon    - срок этого месяца не закрыт, его день ещё не прошёл (мягкая подсветка);
  //   none    - напоминать не о чем (мне должны, нет платежа/дня, остаток 0, архив, мягкий
  //             срок месяца заведения прошёл).
  function debtStatus(S, id, todayStr) {
    var d = findDebt(S, id), none = { state: 'none' };
    todayStr = todayStr || today();
    if (!d || d.archived || d.type !== 'owe' || !(d.pay > 0) || !d.day) return none;
    if (!(debtBalance(S, id) > 0)) return none;
    var cur = ym(todayStr), terms = debtTerms(S, id, cur), T = null;
    var missed = terms.filter(function (x) { return !x.soft && !x.paid && x.due < todayStr; });
    if (missed.length) {
      var L = missed[missed.length - 1];
      return { state: 'overdue', ym: L.ym, due: L.due, missed: missed.map(function (x) { return x.ym; }) };
    }
    terms.forEach(function (x) { if (x.ym === cur) T = x; });
    if (!T) return none;
    if (T.paid) return { state: 'paid', ym: cur, due: T.due };
    if (T.due >= todayStr) return { state: 'soon', ym: cur, due: T.due };
    return none;
  }

  // План напоминаний на months месяцев вперёд: [{id, at, title, text}] по времени.
  // За день до даты платежа и в сам день, в REMIND_HOUR по местному времени. Даты считает
  // приложение (31-е в феврале → 28-е), телефон только ставит будильник на ближайшее:
  // так уведомления переживают смену месяца без запуска приложения. Текст без сумм.
  // Срок, уже закрытый платежом (и заранее), не напоминаем.
  function reminderPlan(S, nowTs, months) {
    var now = isNum(nowTs) ? nowTs : Date.now(), out = [];
    var n = isNum(months) ? months : 12;
    var cur = localDay(now).slice(0, 7);
    (S.debts || []).forEach(function (d) {
      if (!d.remind || d.archived || !(debtBalance(S, d.id) > 0)) return;
      var dates = [];
      if (d.type === 'owe') {
        if (!d.day) return;
        var paid = {};
        debtTerms(S, d.id, addMonths(cur, n - 1)).forEach(function (T) { if (T.paid) paid[T.ym] = 1; });
        for (var k = 0; k < n; k++) {
          var m = addMonths(cur, k);
          if (paid[m]) continue;   // срок уже закрыт
          dates.push(dueDate(m, d.day));
        }
      } else if (d.due) dates.push(d.due);
      pushDates(d.id, d.type, d.name, dates);
    });
    // кредитные карты: напоминаем, только пока карта в минусе (гасить нечего - молчим).
    // План пересчитывается после каждой операции, поэтому минус, появившийся покупкой,
    // сразу ставит напоминания, а пополнение до нуля - снимает.
    S.wallets.forEach(function (w) {
      if (w.credit !== true || !w.payDay || !w.remind || w.hidden) return;
      if (!(walletBalance(S, w.id) < 0)) return;
      var dates = [];
      for (var k = 0; k < n; k++) dates.push(dueDate(addMonths(cur, k), w.payDay));
      pushDates(w.id, 'credit', w.name, dates);
    });
    function pushDates(id, type, name, dates) {
      dates.forEach(function (due) {
        [-1, 0].forEach(function (off) {
          var day = shiftDay(due, off);
          var at = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), REMIND_HOUR, 0, 0, 0).getTime();
          if (at <= now) return;
          var when = off ? 'Завтра' : 'Сегодня';
          // kind: экран блокировки показывает общую строку по виду (ReminderReceiver.publicTitle)
          out.push({ id: id + '|' + due + '|' + (off ? 'b' : 'd'), at: at, kind: type === 'credit' ? 'credit' : 'debt',
            title: type === 'owe' ? when + ' платёж по долгу «' + name + '»'
                 : type === 'credit' ? when + ' платёж по кредитной карте «' + name + '»'
                 : when + ' срок возврата долга «' + name + '»',
            text: type === 'owe' ? 'Когда заплатите, запишите платёж в «Хомяке».'
                : type === 'credit' ? 'Пополните карту, чтобы не платить проценты, и запишите перевод в «Хомяке».'
                : 'Когда вернут, отметьте возврат в «Хомяке».' });
        });
      });
    }
    return out.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
  }

  // ---------- чистый капитал и долговая нагрузка (аналитика, 1.0.4) ----------
  function monthEnd(ymStr) { return dueDate(ymStr, 31); }
  // Р1 ревью 15.10: остаток кошелька на конец дня - ОДНО правило для капитала, ленты и Excel:
  // сегодняшний баланс (walletBalance) минус эффект ВСЕХ операций с датой позже дня - и живых,
  // и «замороженных» (ts < baseTs: их эффект уже сидит в base, но случились они позже дня) -
  // и минус правки баланса (w.adj: «Изменить баланс», удалённые переводы/платежи) с датой
  // позже дня. Раньше замороженные пропускались, а walletsTotalAt не знал про adj - капитал
  // прошлых месяцев менялся от сегодняшнего «Изменить баланс».
  // walletBalancesAt(S, dates) - остатки ВСЕХ кошельков на конец каждого дня из dates одним
  // проходом по операциям (капитал за 12 месяцев, лента месяца): [{id: остаток}] в порядке dates.
  function txEffects(t, fn) {   // как операция двигает кошельки (без оглядки на заморозку)
    if (!isNum(t.amount)) return;
    if (t.kind === 'exp') fn(t.walletId, -t.amount);
    else if (t.kind === 'inc') fn(t.walletId, t.amount);
    else if (t.kind === 'transfer') { fn(t.walletId, -t.amount); fn(t.toWalletId, t.amount); }
    else if (t.kind === 'debt') fn(t.walletId, t.op === 'take' ? t.amount : -t.amount);
  }
  function walletBalancesAt(S, dates) {
    var cuts = dates.slice().sort(), n = cuts.length, now = {}, w = {};
    S.wallets.forEach(function (x) { now[x.id] = x.base; w[x.id] = x; });
    // later[k][id] - сумма эффектов с датой между cuts[k-1] и cuts[k] (k = сколько срезов раньше даты)
    var later = [];
    for (var k = 0; k <= n; k++) later.push({});
    function slot(date) {   // число срезов строго раньше date
      var lo = 0, hi = n;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (cuts[mid] < date) lo = mid + 1; else hi = mid; }
      return lo;
    }
    S.tx.forEach(function (t) {
      var k = -1;
      txEffects(t, function (id, e) {
        var x = w[id]; if (!x) return;
        if (!(t.ts < x.baseTs)) now[id] += e;
        if (k < 0) k = slot(t.date);
        if (k) later[k][id] = (later[k][id] || 0) + e;
      });
    });
    S.wallets.forEach(function (x) {
      now[x.id] = r2(now[x.id]);
      (Array.isArray(x.adj) ? x.adj : []).forEach(function (a) {
        var k = slot(a.date);
        if (k) later[k][x.id] = (later[k][x.id] || 0) + a.delta;
      });
    });
    // идём от поздних срезов к ранним: остаток на срез j = сегодня - всё, что позже cuts[j]
    var at = {}, acc = {}, ids = Object.keys(now);
    for (var j = n - 1; j >= 0; j--) {
      var m = {}, L = later[j + 1];
      ids.forEach(function (id) { acc[id] = (acc[id] || 0) + (L[id] || 0); m[id] = r2(now[id] - acc[id]); });
      at[cuts[j]] = m;
    }
    return dates.map(function (d) { return at[d]; });
  }
  function walletBalanceAt(S, id, dateStr) {
    if (!findWallet(S, id)) return 0;
    return walletBalancesAt(S, [dateStr])[0][id];
  }
  // «В кошельках» на конец дня (без скрытых - как шапка «В кошельках») из готовых остатков
  function visibleSum(S, m) {
    var s = 0;
    S.wallets.forEach(function (w) { if (!w.hidden) s += m[w.id]; });
    return r2(s);
  }
  // сумма минусов видимых кредиток (число ≤ 0)
  function creditSum(S, m) {
    var s = 0;
    S.wallets.forEach(function (w) { if (w.credit === true && !w.hidden && m[w.id] < 0) s += m[w.id]; });
    return r2(s);
  }
  function walletsTotalAt(S, dateStr) { return visibleSum(S, walletBalancesAt(S, [dateStr])[0]); }
  // Чистый капитал на конец месяца = в кошельках (без скрытых) + мне должны - я должен
  function capitalOf(S, ymStr, m) {
    var end = monthEnd(ymStr), owed = 0, owe = 0;
    (S.debts || []).forEach(function (d) {
      var b = debtBalanceAt(S, d.id, end);
      if (b === null) return;
      if (d.type === 'owed') owed += b; else owe += b;
    });
    var w = visibleSum(S, m);
    // кредитки: минус уже сидит в «в кошельках» (w) - отдельной строкой его только ПОКАЗЫВАЕМ
    // (credit < 0, own = w без этого минуса); в net второй раз не вычитаем
    var credit = creditSum(S, m);
    return { ym: ymStr, wallets: w, owed: r2(owed), owe: r2(owe), net: r2(w + owed - owe),
      credit: credit, own: r2(w - credit) };
  }
  function netCapital(S, ymStr) { return capitalOf(S, ymStr, walletBalancesAt(S, [monthEnd(ymStr)])[0]); }
  function hasCreditCards(S) { return S.wallets.some(function (w) { return w.credit === true && !w.hidden; }); }
  // Просрочки у кредитки нет (упрощение 13.10): только напоминание о дне платежа, пока карта
  // в минусе, и минус отдельной строкой в «Капитал и обязательства».
  // ряд за n месяцев, кончая endYm (старые сверху)
  // (остатки кошельков на все концы месяцев - одним проходом, Р1/Р20 ревью 15.10)
  function netCapitalSeries(S, endYm, n) {
    var yms = [];
    for (var k = (n || 12) - 1; k >= 0; k--) yms.push(addMonths(endYm, -k));
    var at = walletBalancesAt(S, yms.map(monthEnd));
    return yms.map(function (x, i) { return capitalOf(S, x, at[i]); });
  }
  // Долговая нагрузка месяца = сумма ЕЖЕМЕСЯЧНЫХ платежей «я должен» (действовавших в том
  // месяце, payHist) / доходы месяца. Плановые платежи, а не факт: досрочка нагрузку не
  // раздувает. Долг входит, если его завели до конца месяца, в архив он ушёл не раньше этого
  // месяца и в месяце он ещё был (остаток на конец месяца > 0 или в месяце был платёж -
  // последний, закрывающий). Доходов нет - ratio/pct null («доходов в этом месяце нет»).
  // pct - проценты с одним знаком, ровно то число, что на экране; порог сравнивается с ним.
  function debtLoad(S, ymStr) {
    var end = monthEnd(ymStr), start = ymStr + '-01', pay = 0, list = [], income = 0;
    (S.debts || []).forEach(function (d) {
      if (d.type !== 'owe' || !(d.pay > 0) || d.createdDate > end) return;
      if (d.archived && d.archivedDate && d.archivedDate < start) return;
      var b = debtBalanceAt(S, d.id, end);
      if (!(b > 0) && !debtPaidIn(S, d.id, ymStr)) return;
      var p = payAt(d, ymStr);
      pay += p;
      list.push({ id: d.id, name: d.name, pay: p });
    });
    S.tx.forEach(function (t) { if (t.kind === 'inc' && ym(t.date) === ymStr) income += t.amount; });
    income = r2(income);
    var ratio = income > 0 ? pay / income : null;
    var pct = ratio === null ? null : Math.round(ratio * 1000) / 10;
    return { ym: ymStr, pay: r2(pay), income: income, ratio: ratio, pct: pct,
      high: pct !== null && pct > LOAD_HIGH_PCT, list: list };
  }

  // 1.0.4, вкладка «Долги» (Алексей 13.10): что должен, сколько уже выплатил (тело и проценты
  // отдельно) и когда закроется каждый долг «я должен». Срок - прогноз по текущему остатку,
  // платежу и ставке, как гасит банк: каждый месяц проценты = остаток × ставка / 12, остальное
  // платежа - в тело. Платёж не покрывает проценты - {never:true}. Дольше 50 лет - тоже never.
  function payoffMonths(bal, pay, rate) {
    var b = r2(bal), n = 0;
    if (!(b > 0)) return 0;
    if (!(pay > 0)) return null;
    while (b > 0.004) {
      var i = rate > 0 ? b * rate / 100 / 12 : 0;
      if (pay - i <= 0.004) return null;
      b = r2(b + i - pay);
      if (++n > 600) return null;
    }
    return n;
  }
  // срок этого месяца закрыт: по графику (день платежа) - срок месяца набрал платёж; без дня
  // платежа - в месяце был платёж
  function paidThisMonth(S, d, now) {
    if (d.day && d.pay > 0) return debtTerms(S, d.id, now).some(function (x) { return x.ym === now && x.paid; });
    return debtPaidIn(S, d.id, now);
  }
  function debtStats(S) {
    var now = ym(today()), total = 0, body = 0, interest = 0, list = [];
    var owe = (S.debts || []).filter(function (d) { return d.type === 'owe'; });
    owe.forEach(function (d) {
      S.tx.forEach(function (t) {
        if (t.kind !== 'debt' || t.op !== 'pay' || t.debtId !== d.id) return;
        interest += payInt(t); body += debtPart(t);
      });
      if (d.archived) return;
      var bal = debtBalance(S, d.id);
      if (!(bal > 0)) return;
      total += bal;
      // платёж этого месяца уже внесён - следующий срок в следующем месяце (ревью 14.10 №4); и
      // платёж со ставкой - того месяца, с которого считаем: новый платёж часто действует со
      // следующего (Р8 ревью 15.10: по старому - июнь 2027 вместо февраля)
      var from = paidThisMonth(S, d, now) ? addMonths(now, 1) : now;
      var p = payAt(d, from), n = payoffMonths(bal, p, rateAt(d, from));
      list.push({ id: d.id, name: d.name, left: bal, pay: p, rate: d.rate || 0,
        months: n, until: n === null ? null : addMonths(from, n - 1), never: n === null });
    });
    return { any: owe.length > 0, total: r2(total), body: r2(body), interest: r2(interest), paid: r2(body + interest), list: list };
  }

  function reorder(S, kind, ids) {
    if (kind === 'wallets') { ids.forEach(function (id, i) { var w = findWallet(S, id); if (w) w.order = i; }); }
    else if (kind === 'debts') { ids.forEach(function (id, i) { var d = findDebt(S, id); if (d) d.order = i; }); }
    else S.ui.order[kind] = ids.slice();
  }
  // Перестановка в режиме правки не выходит за своё поле: доход тасуется только среди
  // доходов, кошелёк — среди кошельков, расход — среди расходов (пусть и через страницы).
  // Каждому виду соответствует ровно одно поле, поэтому «своё поле» == «свой вид».
  // Чистая функция — её же проверяет тест; операции-переносы (доход→кошелёк и т.п.)
  // сюда не относятся, у них своя развилка resolveDrop.
  function reorderAllowed(srcKind, tgtKind) { return !!srcKind && srcKind === tgtKind; }

  // Имя файла для системного окна «Сохранить как». Android кладёт EXTRA_TITLE как есть,
  // а разделители пути и служебные знаки в имени документа ломают SAF на части прошивок.
  // Чистим сами: путь, «звёздочки», управляющие символы, лишние пробелы и длину.
  function safeFileName(name, dflt) {
    var s = String(name == null ? '' : name);
    s = s.replace(/[\/\\:*?"<>|]/g, ' ');             // разделители пути и запрещённые знаки
    // управляющие символы (их в имени документа быть не должно) — по коду, а не классом
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      out += (c < 32 || c === 127) ? ' ' : s.charAt(i);
    }
    s = out.replace(/\s+/g, ' ').trim();              // пробелы в один
    s = s.replace(/^[.\s]+/, '');                     // «.», «..» и пробелы в начале имени
    if (s.length > 80) {
      var dot = s.lastIndexOf('.');
      var ext = (dot > 0 && s.length - dot <= 10) ? s.slice(dot) : '';
      s = s.slice(0, 80 - ext.length).trim() + ext;
    }
    return s || String(dflt || 'backup.json');
  }
  function exportJSON(S) { return JSON.stringify({ app: 'homyak', ver: VER, exportedAt: new Date().toISOString(), state: S }); }
  // Бэкап проверяем по форме, а не по одной подписи: обрезанный или подменённый файл
  // раньше проходил как валидный и после «Заменить» обнулял телефон. Теперь разделяем
  // «это не наш файл» (format) и «наш, но битый» (schema) — тексты в диалоге разные.
  function backupShape(st) {
    if (!isObj(st)) return false;
    if (!Array.isArray(st.wallets) || !Array.isArray(st.tx)) return false;
    if ('icons' in st && !isObj(st.icons)) return false;
    if ('ui' in st && !isObj(st.ui)) return false;
    if ('categories' in st && !isObj(st.categories)) return false;
    if ('limits' in st && !isObj(st.limits)) return false;
    if ('debts' in st && !Array.isArray(st.debts)) return false;
    for (var i = 0; i < st.wallets.length; i++) {
      var w = st.wallets[i];
      if (!isObj(w) || typeof w.id !== 'string' || !w.id || !isNum(w.base)) return false;
    }
    for (var j = 0; j < st.tx.length; j++) {
      var t = st.tx[j];
      if (!isObj(t) || typeof t.id !== 'string' || !t.id) return false;
      if (!isNum(t.amount) || !isDate(t.date)) return false;
    }
    return true;
  }
  // opts.keepDemo - оставить метку демо из файла (только тест-сборка). Бэкап, снятый в
  // тест-сборке, несёт ui.demo=true; в релизе по ней в меню встала бы плашка «Очистить
  // демо-данные», и одно нажатие стёрло бы настоящие данные (найдено 01.10.2026).
  function importJSON(str, opts) {
    var o; try { o = JSON.parse(str); } catch (e) { throw new Error('format'); }
    // принимаем и новый тег 'homyak', и легаси 'kazna' (старое рабочее имя): бэкапы,
    // снятые до переименования, обязаны восстанавливаться
    if (!isObj(o) || (o.app !== 'homyak' && o.app !== 'kazna') || !isObj(o.state)) throw new Error('format');
    if (!backupShape(o.state)) throw new Error('schema');
    var S = migrate(o.state);
    if (!(opts && opts.keepDemo) && S.ui) S.ui.demo = false;
    return S;
  }

  // ---------- жесты: чистые ступени, без DOM ----------
  // «Подними и неси». Раньше горизонтальный сдвиг по ленте кошельков всегда означал
  // прокрутку, и кошелёк на кошелёк можно было перенести только дугой сверху. Теперь
  // нажатие делится по времени: до PRESS_PICKUP сдвиг листает ленту (как и было),
  // после — плитка «поднята» и едет за пальцем в любую сторону, а на PRESS_EDIT
  // неподвижного нажатия включается режим правки.
  var PRESS_PICKUP = 150;
  var PRESS_EDIT = 500;

  // held — сколько мс держим, movedAt — на какой мс палец впервые сдвинулся
  // (null = не двигался). Возвращает 'wait' | 'scroll' | 'pickup' | 'edit'.
  function pressPhase(held, movedAt) {
    held = Number(held) || 0;
    var moved = (movedAt === null || movedAt === undefined) ? null : (Number(movedAt) || 0);
    if (moved !== null && moved < PRESS_PICKUP) return 'scroll';
    if (moved === null && held >= PRESS_EDIT) return 'edit';
    if (held >= PRESS_PICKUP) return 'pickup';
    return 'wait';
  }

  // Порядок слоёв поверх главного экрана — сверху вниз, ровно как z-index в style.css.
  // По нему кнопка «назад» Android и Escape закрывают ровно верхний слой, а не всё сразу.
  // onboard - приветствие первого запуска, самый верхний слой: «назад» на нём = «Понятно».
  var OVERLAY_ORDER = ['onboard', 'icons', 'dialog', 'amount', 'transfer', 'card', 'summary', 'menu', 'edit'];
  function topOverlay(flags) {
    if (!flags) return null;
    for (var i = 0; i < OVERLAY_ORDER.length; i++) {
      if (flags[OVERLAY_ORDER[i]]) return OVERLAY_ORDER[i];
    }
    return null;
  }

  // Закрывающий свайп: меню уезжает влево, листы — вниз. Порог разный, и жест
  // засчитывается, только если он честно вдоль своей оси (иначе прокрутка списка
  // закрывала бы лист).
  var SWIPE_SIDE = 60;
  var SWIPE_DOWN = 80;
  // Меню закрывается смахиванием откуда угодно по панели, а не только по шапке, —
  // значит, тот же жест начинается и над плитками, и над прокруткой тела меню.
  // Чтобы вертикальная прокрутка не улетала в закрытие, горизонтали мало «просто
  // больше»: она должна быть в полтора раза длиннее вертикали.
  var SWIPE_RATIO = 1.5;
  function swipeCloses(dx, dy, dir) {
    dx = Number(dx) || 0; dy = Number(dy) || 0;
    if (dir === 'left') return dx <= -SWIPE_SIDE && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO;
    if (dir === 'down') return dy >= SWIPE_DOWN && Math.abs(dy) > Math.abs(dx);
    return false;
  }

  // ---------- страницы лент ----------
  // Кошельки едут страницами по четыре — ровно столько влезает в ряд, и точки под
  // лентой считаются по тому же правилу, что у доходов и расходов. Обе ступени
  // чистые: их гоняют тесты, а лента только подставляет свои числа.
  var PAGE_WALLETS = 4;
  function pageCount(n, per) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    per = Math.max(1, Math.floor(Number(per) || PAGE_WALLETS));
    return Math.max(1, Math.ceil(n / per));
  }
  // Номер видимой страницы и её положение прокрутки. Страница ВСЕГДА во всю ширину
  // окна ленты, даже если кошельков на ней меньше четырёх: недостающие места остаются
  // пустыми, и ход прокрутки получается ровно кратным ширине. Поэтому шаг - это просто
  // ширина окна, а не «весь ход, поделённый на промежутки»: прежняя формула была
  // заплаткой под неполную последнюю страницу, из-за которой шесть кошельков листались
  // на два кошелька, и первые две иконки второй страницы повторяли хвост первой.
  function pageStep(scrollWidth, clientWidth, count) {
    var n = Math.max(1, Math.floor(Number(count) || 1));
    var w = Number(clientWidth) || 0;
    var max = (Number(scrollWidth) || 0) - w;
    return (n < 2 || !(w > 0) || !(max > 0)) ? 0 : w;
  }
  function pageAt(scrollLeft, scrollWidth, clientWidth, count) {
    var step = pageStep(scrollWidth, clientWidth, count);
    if (!(step > 0)) return 0;
    var n = Math.max(1, Math.floor(Number(count) || 1));
    return Math.max(0, Math.min(n - 1, Math.round((Number(scrollLeft) || 0) / step)));
  }
  function pageLeft(i, scrollWidth, clientWidth, count) {
    var n = Math.max(1, Math.floor(Number(count) || 1));
    var k = Math.max(0, Math.min(n - 1, Math.floor(Number(i) || 0)));
    return Math.round(k * pageStep(scrollWidth, clientWidth, count));
  }

  // ---------- перенос операции: что во что можно бросить ----------
  // У переноса плитки есть смысл ровно в трёх случаях, всё прочее — брак:
  //   источник дохода → кошелёк   = доход
  //   кошелёк → категория расхода  = расход
  //   кошелёк → кошелёк            = перевод
  // Категория расхода источником операции не бывает — только целью. Одна чистая
  // ступень: её зовёт и живая подсветка цели во время переноса, и сам бросок на
  // отпускании. Совпадение этих двух проверок — весь смысл вынесения в движок:
  // подсвечивается ровно то, на что бросок правда сработает. Проверка совпадения
  // id (кошелёк сам на себя) остаётся выше — тут только виды.
  // srcKind/tgtKind ∈ 'inc' | 'wallet' | 'exp'.
  function dropAllowed(srcKind, tgtKind) {
    if (srcKind === 'inc' && tgtKind === 'wallet') return true;
    if (srcKind === 'wallet' && tgtKind === 'exp') return true;
    if (srcKind === 'wallet' && tgtKind === 'wallet') return true;
    // 1.0.4 долги: кошелёк → долг (платёж / одолжил), долг → кошелёк (взял / вернули)
    if (srcKind === 'wallet' && tgtKind === 'debt') return true;
    if (srcKind === 'debt' && tgtKind === 'wallet') return true;
    return false;
  }

  // Готов ли лист суммы к записи: у кнопочного пути («+ Расход/Доход/Перевод») нет
  // неявных источника и цели, как у drag, поэтому концы выбирают в самом листе. Пока
  // выбор неполон, кнопка «Подтвердить» гаснет и amSave молчит. Формы op те же, что
  // строит resolveDrop: расход/доход = кошелёк + категория, перевод = два РАЗНЫХ кошелька.
  function amountReady(op) {
    if (!op || !op.kind) return false;
    if (op.kind === 'exp' || op.kind === 'inc') return !!(op.walletId && op.catId);
    if (op.kind === 'transfer') return !!(op.walletId && op.toWalletId && op.walletId !== op.toWalletId);
    if (op.kind === 'debtpay' || op.kind === 'debttake') return !!(op.walletId && op.debtId);
    return false;
  }

  // Показывать ли приветственный онбординг: пока флаг onboarded не выставлен. Чистая,
  // не зависит от типа сборки - ни presetState (релиз), ни demoState (тест) флаг не ставят,
  // поэтому на первом запуске любой сборки онбординг покажется. Гасит его только «Понятно».
  // Битое/пустое состояние трактуем как первый запуск (показать), не как «уже видел».
  function shouldOnboard(S) {
    return !(S && S.ui && S.ui.onboarded);
  }

  // ---------- звук операции ----------
  // Хозяин: «после превышения ЛЮБОЙ дополнительный расход включает обычный звук
  // траты» — нет, наоборот: пока категория за планом, каждый новый расход по ней
  // звучит как перебор. Памяти «первый раз» больше нет: решает текущий уровень,
  // а не история. Функция чистая — её же зовут и запись, и правка операции.
  function txSound(kind, level) {
    if (kind === 'inc') return 'income';
    if (kind === 'transfer') return 'transfer';
    return level === 'over' ? 'over' : 'expense';
  }

  // ---------- защита от тихого затирания (1.0.3, по образцу «Карты года» I1) ----------
  // «Ключа нет» (первый запуск) ≠ «ключ есть, но не читается». raw - строка из хранилища
  // (null - нет), readErr - исключение getItem. kind:
  //   empty      - данных нет, можно засевать пресет;
  //   ok         - разобралось (state - уже мигрированное состояние);
  //   broken     - текст есть, но это не наши данные / обрезан / форма поехала;
  //   unreadable - хранилище не открылось: читать нечего, но и писать нельзя - оригинал
  //                может лежать целым, мы его просто не видим.
  function classifyStored(raw, readErr) {
    if (readErr) return { kind: 'unreadable' };
    if (raw == null || raw === '') return { kind: 'empty' };
    var p;
    try { p = JSON.parse(raw); } catch (e) { return { kind: 'broken' }; }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { kind: 'broken' };
    var st = null;
    try { st = migrate(p); } catch (e) { return { kind: 'broken' }; }
    if (!st || !Array.isArray(st.tx) || !Array.isArray(st.wallets)) return { kind: 'broken' };
    return { kind: 'ok', state: st };
  }
  // Ключ карантина: homyak_v1.broken-2026-10-05T18-30-05 - своя копия на каждый случай порчи,
  // вторая порча не затирает первую.
  function quarantineKey(key, now) {
    var t = (now instanceof Date) ? now : new Date(now == null ? Date.now() : now);
    return key + '.broken-' + t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate()) +
      'T' + pad2(t.getHours()) + '-' + pad2(t.getMinutes()) + '-' + pad2(t.getSeconds());
  }
  // Отложить битый текст в карантин с проверкой чтением. storage - localStorage (или подмена
  // в тестах). Ключ занят (две порчи за секунду) - добавляем номер. {key, copied}: copied=false
  // значит копии нет, и оригинал трогать НЕЛЬЗЯ (в этой сессии не пишем).
  // Не легла копия, а место держит наследный ключ key + '.broken' (версии до 1.0.2 включительно,
  // до 4 МБ старой порчи) - убираем его и пробуем ещё раз: свежая порча важнее (ревью 1.0.3).
  function quarantine(storage, key, raw, now) {
    var base = quarantineKey(key, now), k = base, n = 1;
    try { while (storage.getItem(k) !== null && n < 50) { n++; k = base + '-' + n; } } catch (e) {}
    var copied = put(storage, k, raw);
    if (!copied) {
      var had = false;
      try { had = storage.getItem(key + '.broken') !== null; } catch (e) {}
      if (had) {
        try { storage.removeItem(key + '.broken'); } catch (e) {}
        copied = put(storage, k, raw);
      }
    }
    return { key: k, copied: copied };
  }
  function put(storage, k, raw) {
    try { storage.setItem(k, String(raw)); return storage.getItem(k) === String(raw); } catch (e) { return false; }
  }

  // Уборка карантина (1.0.3): копии старше days дней удаляем, САМУЮ СВЕЖУЮ оставляем
  // всегда, даже если и она старая (вдруг это единственный след порчи). Дата - из имени
  // ключа (quarantineKey), чужие ключи не трогаем. Возвращает удалённые ключи.
  // Наследный ключ без даты key + '.broken' (версии до 1.0.2 включительно) - самая старая
  // копия: уходит, как только есть копия новее; единственной остаётся (ревью 1.0.3).
  function pruneQuarantine(storage, key, now, days) {
    var pre = key + '.broken-', legacy = key + '.broken', list = [], i, k;
    var re = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-\d+)?$/;
    for (i = 0; i < storage.length; i++) {
      k = storage.key(i);
      if (k === legacy) { list.push({ k: k, t: -1, n: '' }); continue; }
      if (typeof k !== 'string' || k.indexOf(pre) !== 0) continue;
      var m = re.exec(k.slice(pre.length));
      if (!m) continue;
      list.push({ k: k, t: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), n: k });
    }
    list.sort(function (x, y) { return x.t - y.t || (x.n < y.n ? -1 : x.n > y.n ? 1 : 0); });
    var edge = Number(now) - (days == null ? 30 : days) * 86400000, removed = [];
    for (i = 0; i < list.length - 1; i++) {
      if (list[i].t >= edge) continue;
      try { storage.removeItem(list[i].k); removed.push(list[i].k); } catch (e) {}
    }
    return removed;
  }

  return {
    VER: VER, MAX_AMOUNT: MAX_AMOUNT, defaultState: defaultState, migrate: migrate, uid: uid,
    PRESS_PICKUP: PRESS_PICKUP, PRESS_EDIT: PRESS_EDIT, pressPhase: pressPhase,
    OVERLAY_ORDER: OVERLAY_ORDER, topOverlay: topOverlay,
    SWIPE_SIDE: SWIPE_SIDE, SWIPE_DOWN: SWIPE_DOWN, SWIPE_RATIO: SWIPE_RATIO, swipeCloses: swipeCloses,
    dropAllowed: dropAllowed, amountReady: amountReady, shouldOnboard: shouldOnboard,
    PAGE_WALLETS: PAGE_WALLETS, pageCount: pageCount, pageStep: pageStep, pageAt: pageAt, pageLeft: pageLeft,
    txSound: txSound,
    WALLET_COLORS: WALLET_COLORS, WALLET_COLOR_DEFAULT: WALLET_COLOR_DEFAULT, walletColor: walletColor,
    today: today, ym: ym, pad2: pad2, isDate: isDate, futureDate: futureDate,
    fmt: fmt, fmtCompact: fmtCompact, fmtTyped: fmtTyped, parseNum: parseNum, calcAmount: calcAmount, hasCalcOp: hasCalcOp, NBSP: NBSP, plural: plural,
    RING_MIN: RING_MIN, RING_MAX: RING_MAX, RING_STEP: RING_STEP,
    ringSize: ringSize, ringGeom: ringGeom, ringFit: ringFit, ringRows: ringRows,
    addWallet: addWallet, findWallet: findWallet, updateWallet: updateWallet, setWalletBase: setWalletBase, walletBalance: walletBalance,
    walletTxCount: walletTxCount, deleteWallet: deleteWallet, walletDebtTxCount: walletDebtTxCount,
    addTx: addTx, findTx: findTx, updateTx: updateTx, deleteTx: deleteTx, parseTags: parseTags, txOfWallet: txOfWallet, byNewest: byNewest,
    addCategory: addCategory, findCategory: findCategory, updateCategory: updateCategory,
    archiveCategory: archiveCategory, listCategories: listCategories,
    reorderCategories: function (S, kind, ids) { return reorder(S, kind, ids); },
    catKind: catKind, catFact: catFact, fill: fill, fillInc: fillInc, txOfCat: txOfCat,
    catLimit: catLimit, setLimit: setLimit, copyLimits: copyLimits, carryLimits: carryLimits, planOr0: planOr0,
    FREE: FREE, walletsActiveCount: walletsActiveCount, expCatsActiveCount: expCatsActiveCount,
    canAddWallet: canAddWallet, canAddExpCat: canAddExpCat, canAddIncCat: canAddIncCat,
    HARD: HARD, incCatsActiveCount: incCatsActiveCount,
    summary: summary, limitProgress: limitProgress, limitedCount: limitedCount,
    isFrozen: isFrozen, monthBreakdown: monthBreakdown, daySpend: daySpend, attention: attention, monthlyTotals: monthlyTotals, reorder: reorder, reorderAllowed: reorderAllowed,
    walletsTotal: walletsTotal, dayLabel: dayLabel, feedByDay: feedByDay,
    safeFileName: safeFileName,
    exportJSON: exportJSON, importJSON: importJSON,
    classifyStored: classifyStored, quarantineKey: quarantineKey, quarantine: quarantine, pruneQuarantine: pruneQuarantine,
    // 1.0.4 долги
    REMIND_HOUR: REMIND_HOUR, LOAD_HIGH_PCT: LOAD_HIGH_PCT,
    // 1.0.5 заметки
    NOTE_MAX: NOTE_MAX, NOTE_KEEP: NOTE_KEEP, cleanNote: cleanNote, noteOnlyEdit: noteOnlyEdit, setTxNote: setTxNote,
    findDebt: findDebt, dueDate: dueDate, addMonths: addMonths,
    debtsActive: debtsActive, debtsActiveCount: debtsActiveCount, canAddDebt: canAddDebt, hasOweDebts: hasOweDebts,
    addDebt: addDebt, updateDebt: updateDebt, setDebtBase: setDebtBase, debtBalance: debtBalance,
    debtBalanceAt: debtBalanceAt, debtProgress: debtProgress, debtPart: debtPart, payInt: payInt, previewPay: previewPay,
    rateAt: rateAt, debtLastDate: debtLastDate, payDebt: payDebt, takeDebt: takeDebt, debtHistory: debtHistory, editDebtTx: editDebtTx,
    payAt: payAt, debtTerms: debtTerms,
    archiveDebt: archiveDebt, closeDebt: closeDebt, closedLeft: closedLeft, reopenDebt: reopenDebt,
    reopenNonZero: reopenNonZero, debtCloseEvents: debtCloseEvents, deleteDebt: deleteDebt, debtStatus: debtStatus,
    reminderPlan: reminderPlan, walletsTotalAt: walletsTotalAt, netCapital: netCapital,
    netCapitalSeries: netCapitalSeries, debtLoad: debtLoad, debtStats: debtStats, payoffMonths: payoffMonths, monthEnd: monthEnd,
    // 1.0.4 кредитные карты
    setWalletCredit: setWalletCredit, walletBalanceAt: walletBalanceAt, walletBalancesAt: walletBalancesAt,
    hasCreditCards: hasCreditCards
  };
});
