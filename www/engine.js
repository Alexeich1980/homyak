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
  var NBSP = ' ';
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
      ui: { incomeCollapsed: false, theme: 'dark', haptics: true, sound: true,
            hints: true, hintsDismissed: {}, analyticsView: null,
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
      if (t.kind !== 'exp' && t.kind !== 'inc' && t.kind !== 'transfer') t.kind = 'exp';
      if (!isNum(t.amount) || t.amount <= 0) t.amount = 0;
      if (t.amount > MAX_AMOUNT) t.amount = MAX_AMOUNT;
      if (!isDate(t.date)) t.date = ym(today()) + '-01';
      if (!isNum(t.ts)) t.ts = 0;
      if (typeof t.catId !== 'string') t.catId = null;
      if (typeof t.walletId !== 'string') t.walletId = null;
      if (typeof t.toWalletId !== 'string') t.toWalletId = null;
      t.tags = idsOf(t.tags);
    });

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
    if (!isObj(ui.hintsDismissed)) ui.hintsDismissed = {};
    // экран «Аналитики» в 0.4.1 открывается выбором из двух карточек; какую открыли
    // последней, помним здесь. null (или чужое значение) = показать выбор.
    if (ui.analyticsView !== 'summary' && ui.analyticsView !== 'feed') ui.analyticsView = null;
    if (!isObj(ui.order)) ui.order = { inc: [], exp: [] };
    ui.order.inc = idsOf(ui.order.inc);
    ui.order.exp = idsOf(ui.order.exp);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ui.month)) ui.month = null;
    out.ui = ui;

    return out;
  }

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
  function setWalletBase(S, id, base) { var w = findWallet(S, id); if (!w) return null; w.base = base; w.baseTs = Date.now(); return w; }
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
  function deleteWallet(S, id) {
    var w = findWallet(S, id);
    if (!w) return null;
    var removed = 0;
    S.tx = S.tx.filter(function (t) {
      if (t.walletId !== id && t.toWalletId !== id) return true;
      removed++;
      if (t.kind === 'transfer' && isNum(t.amount)) {
        var other = t.walletId === id ? t.toWalletId : t.walletId;
        var ow = other !== id ? findWallet(S, other) : null;
        if (ow && (isNum(t.ts) ? t.ts : 0) >= ow.baseTs) {
          ow.base = Math.round((ow.base + (t.toWalletId === other ? t.amount : -t.amount)) * 100) / 100;
        }
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
      refundFrozen(S, t);
      t.ts = Date.now();
    }
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    if ('amount' in patch) t.amount = Number(patch.amount);
    return t;
  }
  // заморожена ли операция хотя бы для одного из своих кошельков
  function isFrozen(S, t) {
    if (!isNum(t.ts)) return false;
    var w = findWallet(S, t.walletId), w2 = t.kind === 'transfer' ? findWallet(S, t.toWalletId) : null;
    return !!((w && t.ts < w.baseTs) || (w2 && t.ts < w2.baseTs));
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
    }
  }
  function deleteTx(S, id) {
    var t = findTx(S, id);
    if (!t) return false;
    refundFrozen(S, t);
    S.tx.splice(S.tx.indexOf(t), 1);
    return true;
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
  var FREE = { wallets: 2, expCats: 8, incCats: 1 };
  var HARD = { wallets: 50, expCats: 100, incCats: 50 };
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
  function monthlyTotals(S, year) {
    var out = [], live = listCategories(S, 'exp');
    for (var m = 0; m < 12; m++) {
      var ymStr = year + '-' + pad2(m + 1), fact = 0, plan = 0;
      S.tx.forEach(function (t) { if (t.kind === 'exp' && ym(t.date) === ymStr) fact += t.amount; });
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

  // Как одна операция двигает ОБЩИЙ остаток кошельков. Правило то же, что в
  // walletBalance: замороженная операция (ts < baseTs своего кошелька) уже вшита в base
  // и остаток не двигает, скрытый кошелёк в общий счёт не входит. Перевод между двумя
  // видимыми кошельками даёт ноль — деньги не появились и не исчезли.
  function txDelta(S, t) {
    function live(id, ts) { var w = findWallet(S, id); return !!w && !w.hidden && ts >= w.baseTs; }
    if (!isNum(t.amount)) return 0;
    var ts = isNum(t.ts) ? t.ts : 0;
    if (t.kind === 'exp') return live(t.walletId, ts) ? -t.amount : 0;
    if (t.kind === 'inc') return live(t.walletId, ts) ? t.amount : 0;
    if (t.kind === 'transfer') {
      return (live(t.toWalletId, ts) ? t.amount : 0) - (live(t.walletId, ts) ? t.amount : 0);
    }
    return 0;
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
    var total = walletsTotal(S);
    return dates.map(function (d) {
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
      var later = 0;
      S.tx.forEach(function (t) { if (t.date > d) later += txDelta(S, t); });
      return { date: d, label: dayLabel(d), rows: rows,
        change: Math.round(change * 100) / 100,
        balanceEnd: Math.round((total - later) * 100) / 100 };
    });
  }

  function reorder(S, kind, ids) { if (kind === 'wallets') { ids.forEach(function (id, i) { var w = findWallet(S, id); if (w) w.order = i; }); } else S.ui.order[kind] = ids.slice(); }
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
  function importJSON(str) {
    var o; try { o = JSON.parse(str); } catch (e) { throw new Error('format'); }
    // принимаем и новый тег 'homyak', и легаси 'kazna' (старое рабочее имя): бэкапы,
    // снятые до переименования, обязаны восстанавливаться
    if (!isObj(o) || (o.app !== 'homyak' && o.app !== 'kazna') || !isObj(o.state)) throw new Error('format');
    if (!backupShape(o.state)) throw new Error('schema');
    return migrate(o.state);
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
    walletTxCount: walletTxCount, deleteWallet: deleteWallet,
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
    walletsTotal: walletsTotal, txDelta: txDelta, dayLabel: dayLabel, feedByDay: feedByDay,
    safeFileName: safeFileName,
    exportJSON: exportJSON, importJSON: importJSON
  };
});
