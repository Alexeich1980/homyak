/* xlsx.js - выгрузка операций в Excel (1.0.4, только «Полный доступ»). Без DOM.
   Собирает настоящий .xlsx (Office Open XML): пять XML-файлов в zip через fflate, который
   уже есть в приложении (www/vendor/fflate.min.js). Новых библиотек нет.

   Лист 1 «Операции»: Дата | Тип | Сумма | Категория | Кошелёк | Кошелёк назначения | Комментарий.
   Лист 2 «По категориям»: строки - статьи, колонки - Лимит (последнего месяца), месяцы
     (старые слева) и «Итого». Факт расхода подсвечен по лимиту месяца (Engine.fill):
     светло-красный - больше лимита, светло-жёлтый - близко (80-100%), внизу легенда.
     Блок «РАСХОДЫ» (статьи по итогу за период вниз, строка «Всего расходов»), блок «ДОХОДЫ»
     (так же, «Всего доходов»), в конце «Разница» по месяцам. Только значения, без формул;
     ноль - пустая ячейка. Архивная статья с операциями - с пометкой «(архив)», статья без
     единой операции за период не показывается. Переводы и корректировки сюда не входят.
   Лист 3 «Кошельки»: остаток каждого кошелька на конец месяца (текущий - на сегодня),
     строка «Всего» = «В кошельках» на главном (без скрытых), скрытые с движениями ниже.
   Лист 4 «Итоги по месяцам»: Месяц | Доходы | Расходы | Разница.

   1.0.4, долги: платёж по долгу - строка «Платёж по долгу» на листе «Операции» на весь платёж
   (Кошелёк → долг в колонке «Кошелёк назначения»), взятие - «Взято в долг» (долг → кошелёк),
   у «мне должны» - «Дано в долг» и «Возврат долга». Проценты - часть платежа, не расход
   (решение 13.10): разбивка «в счёт долга X ₽, проценты Y ₽» - в «Комментарии». Платёж в
   итоги по месяцам и статьи не входит (как перевод), но
   остаток кошелька двигает - балансы по таблице по-прежнему равны приложению. На листе
   «Кошельки» под кошельками - блок «Долги» (остаток на конец месяца) и «Чистый капитал».

   Корректировка баланса («Изменить баланс» у кошелька) в приложении не операция, а новая
   точка отсчёта кошелька (base/baseTs). Чтобы по таблице сходились балансы, строкой типа
   «Корректировка» (сумма со знаком) идёт каждая датированная правка баланса (w.adj) - своей
   датой, и остаток на начало - датой первой записи кошелька: баланс - операции - правки.
   Итог по кошельку в таблице на любой день = остатку кошелька в приложении на этот день
   (проверяют tests/xlsx.test.js, wallets-b2.test.js). Доходом и расходом корректировка
   не считается, в итоги по месяцам не входит - как и переводы.

   Чистые функции: rows(S, Engine) - данные таблицы, build(S, Engine, fflate) - байты файла.
   Тестируется в Node (tests/xlsx.test.js), в приложении - window.Xlsx. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPE = { exp: 'Расход', inc: 'Доход', transfer: 'Перевод', fix: 'Корректировка',
    debtPay: 'Платёж по долгу', debtTake: 'Взято в долг', lend: 'Дано в долг', back: 'Возврат долга' };
  var FIX_NOTE = 'Остаток на начало и ручные изменения баланса';
  var FIX_NOTE_ADJ = 'Изменение баланса вручную';
  var FIX_NOTE_DEL = 'Удалённый перевод или платёж по долгу';
  var END_OF_DAY = 9007199254740991;   // корректировка дня - после его операций
  var HEAD_OPS = ['Дата', 'Тип', 'Сумма', 'Категория', 'Кошелёк', 'Кошелёк назначения', 'Комментарий'];
  var HEAD_MONTHS = ['Месяц', 'Доходы', 'Расходы', 'Разница'];
  var WIDTH_OPS = [12, 15, 14, 24, 20, 20, 34];
  var WIDTH_MONTHS = [18, 15, 15, 15];
  var MON = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  var CAT = { head: 'Статья', total: 'Итого', exp: 'РАСХОДЫ', inc: 'ДОХОДЫ',
    expSum: 'Всего расходов', incSum: 'Всего доходов', diff: 'Разница',
    archived: ' (архив)', none: 'Без категории', limit: 'Лимит',
    legendOver: 'красный - больше лимита', legendWarn: 'жёлтый - близко к лимиту (от 80% до 100%)',
    wallet: 'Кошелёк', wTotal: 'Всего', hidden: ' (скрыт)', today: ' (сегодня)', credit: ' (кредитная карта)',
    hiddenHead: 'Скрытые кошельки (во «Всего» не входят)',
    debtsHead: 'Долги (во «Всего» не входят)', owe: ' (я должен)', owed: ' (мне должны)',
    archived2: ', погашен', net: 'Чистый капитал' };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function cents(x) { return Math.round(x * 100) / 100; }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function localDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Дата Excel: число дней от 30.12.1899 (так Excel переживает свою ошибку с 1900 годом).
  // Строка «ГГГГ-ММ-ДД» без времени - считаем в UTC, часовой пояс сутки не сдвинет.
  function excelDate(ymd) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7), d = +ymd.slice(8, 10);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  // «2026-10» → «Окт 2026»: текстом, а не датой - одинаково читается в любом Excel и на телефоне
  function monthTitle(ym) { return MON[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }

  function fileName(now) {
    var d = now ? new Date(now) : new Date();
    return 'Хомяк-операции-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.xlsx';
  }

  // платёж со ставкой: весь платёж в «Сумме», разбивка - в «Комментарии» (как в карточке долга)
  function interestNote(t) {
    var i = t.op !== 'take' && typeof t.int === 'number' && t.int > 0 ? t.int : 0;
    if (!i) return '';
    return 'в счёт долга ' + rub(t.amount - i) + ' ₽, проценты ' + rub(i) + ' ₽';
  }
  // 12 345,6 → «12 345,60»: как суммы в приложении (копейки только когда есть)
  function rub(v) {
    var n = Math.round(Math.abs(v) * 100), i = Math.floor(n / 100), k = n % 100;
    return (v < 0 ? '-' : '') + String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (k ? ',' + (k < 10 ? '0' : '') + k : '');
  }

  // ---------- данные таблицы ----------
  function rows(S, E) {
    var wName = {}, ops = [], months = {}, flow = {}, byCat = { exp: {}, inc: {} };
    (S.wallets || []).forEach(function (w) { wName[w.id] = w.name; flow[w.id] = 0; });
    function catName(id) { var f = id ? E.findCategory(S, id) : null; return f ? f.cat.name : ''; }
    (S.tx || []).forEach(function (t) {
      if (!(t.amount > 0)) return;   // пустышки (amount 0 после чистки битых данных) деньги не двигают
      if (t.kind === 'debt') {
        // тело платежа/взятия: деньги кошелька двигает, в доходы/расходы и статьи не входит
        var d = E.findDebt ? E.findDebt(S, t.debtId) : null, dn = d ? d.name : 'Долг', owed = !!d && d.type === 'owed';
        var take = t.op === 'take', wn = wName[t.walletId] || '';
        ops.push({ date: t.date, ts: typeof t.ts === 'number' ? t.ts : 0, id: String(t.id),
          type: owed ? (take ? TYPE.back : TYPE.lend) : (take ? TYPE.debtTake : TYPE.debtPay), amount: t.amount,
          cat: '', wallet: take ? dn : wn, to: take ? wn : dn, note: interestNote(t),
          wid: t.walletId, wid2: null, dsign: take ? 1 : -1 });
        if (t.walletId in flow) flow[t.walletId] += take ? t.amount : -t.amount;
        var dk = String(t.date).slice(0, 7);   // месяц в «Итогах» есть, как у перевода (0 / 0)
        if (!months[dk]) months[dk] = { ym: dk, inc: 0, exp: 0 };
        return;
      }
      var tr = t.kind === 'transfer';
      ops.push({ date: t.date, ts: typeof t.ts === 'number' ? t.ts : 0, id: String(t.id),
        type: TYPE[t.kind] || TYPE.exp, amount: t.amount,
        cat: tr ? '' : catName(t.catId),
        wallet: wName[t.walletId] || '', to: tr ? (wName[t.toWalletId] || '') : '',
        note: [t.tags && t.tags.length ? t.tags.join(' ') : '', typeof t.note === 'string' ? t.note : ''].filter(Boolean).join(' '),
        wid: t.walletId, wid2: tr ? t.toWalletId : null });
      if (t.kind === 'exp' && t.walletId in flow) flow[t.walletId] -= t.amount;
      else if (t.kind === 'inc' && t.walletId in flow) flow[t.walletId] += t.amount;
      else if (tr) {
        if (t.walletId in flow) flow[t.walletId] -= t.amount;
        if (t.toWalletId in flow) flow[t.toWalletId] += t.amount;
      }
      var k = String(t.date).slice(0, 7);
      if (!months[k]) months[k] = { ym: k, inc: 0, exp: 0 };
      if (t.kind === 'inc') months[k].inc += t.amount;
      else if (t.kind === 'exp') months[k].exp += t.amount;
      // разрез по статьям: только доходы и расходы (переводы и корректировки - нет)
      if (t.kind === 'inc' || t.kind === 'exp') {
        var key = t.catId ? String(t.catId) : '', g = byCat[t.kind][key];
        if (!g) {
          var f = t.catId ? E.findCategory(S, t.catId) : null;
          g = byCat[t.kind][key] = { id: key,
            name: f ? (f.cat.name + (f.cat.archived ? CAT.archived : '')) : CAT.none, m: {}, total: 0 };
        }
        g.m[k] = (g.m[k] || 0) + t.amount;
        g.total += t.amount;
      }
    });
    // Корректировки (Р1 ревью 15.10): каждая правка баланса без операции (w.adj - «Изменить
    // баланс», удалённый перевод или платёж по долгу) - своей строкой своей датой, в конце дня;
    // остальное (остаток на начало и правки версий до 1.0.4, у которых даты нет) - одной строкой
    // «на начало». Приложение считает остаток на прошлый день от сегодняшнего назад
    // (Engine.walletBalanceAt): остаток на начало в нём есть с самого начала, поэтому и строка
    // встаёт первым днём таблицы (или днём заведения кошелька, если тот раньше). Так сумма строк
    // кошелька на любой день = Engine.walletBalanceAt: баланс сегодня и лист «Кошельки» сходятся.
    var starts = [];
    (S.wallets || []).forEach(function (w) {
      var sumAdj = 0;
      (Array.isArray(w.adj) ? w.adj : []).forEach(function (a) {
        if (!isDate(a.date) || typeof a.delta !== 'number') return;
        sumAdj += a.delta;
        ops.push({ date: a.date, ts: END_OF_DAY, id: '~' + w.id + '~' + a.date + (a.del ? '~d' : ''),
          type: TYPE.fix, amount: cents(a.delta), cat: '', wallet: w.name, to: '', note: a.del ? FIX_NOTE_DEL : FIX_NOTE_ADJ, wid: w.id, wid2: null });
      });
      var fix = cents(E.walletBalance(S, w.id) - flow[w.id] - sumAdj);
      if (fix) starts.push({ w: w, fix: fix });
    });
    var first = localDate(Date.now()).slice(0, 7) + '-01';
    ops.forEach(function (o) { if (isDate(o.date) && o.date < first) first = o.date.slice(0, 7) + '-01'; });
    (S.debts || []).forEach(function (d) { if (isDate(d.createdDate) && d.createdDate < first) first = d.createdDate.slice(0, 7) + '-01'; });
    starts.forEach(function (x) {
      var made = x.w.baseTs > 0 ? localDate(x.w.baseTs) : first;
      ops.push({ date: made < first ? made : first, ts: -1, id: '~' + x.w.id,
        type: TYPE.fix, amount: x.fix, cat: '', wallet: x.w.name, to: '', note: FIX_NOTE, wid: x.w.id, wid2: null });
    });
    ops.forEach(function (o) { if (!isDate(o.date)) o.date = localDate(Date.now()); });
    ops.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    var ml = Object.keys(months).sort().map(function (k) {
      var m = months[k];
      return { ym: k, inc: cents(m.inc), exp: cents(m.exp), diff: cents(m.inc - m.exp) };
    });
    var lastYM = ml.length ? ml[ml.length - 1].ym : null;
    function catList(kind) {
      return Object.keys(byCat[kind]).map(function (key) {
        var g = byCat[kind][key], m = {}, level = {};
        Object.keys(g.m).forEach(function (ym) { m[ym] = cents(g.m[ym]); });
        var c = { id: g.id, name: g.name, m: m, total: cents(g.total) };
        if (kind === 'exp') {
          // лимит месяца - тот же, что приложение показывает в кружке (Engine.catLimit),
          // уровень - тот же Engine.fill: warn «близко» (от 80% до ровно 100%), over - больше лимита
          ml.forEach(function (x) {
            var lim = g.id ? E.catLimit(S, g.id, x.ym) : null;
            var lv = E.fill(m[x.ym] || 0, lim).level;
            if (lv === 'warn' || lv === 'over') level[x.ym] = lv;
          });
          c.level = level;
          c.limit = (g.id && lastYM) ? E.catLimit(S, g.id, lastYM) : null;
        }
        return c;
      }).sort(function (a, b) {
        if (a.total !== b.total) return b.total - a.total;
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
    }
    return { ops: ops, months: ml, cats: { exp: catList('exp'), inc: catList('inc') }, wallets: walletMonths(S, ops, E) };
  }

  // Остатки кошельков на конец каждого месяца (текущий месяц - на сегодня) - Engine.walletBalancesAt,
  // то же правило, что капитал в приложении; строки листа «Операции» с «Корректировками» дают
  // по кошельку ту же сумму на любой день. Месяцы подряд, без дыр: остаток
  // есть и у месяца без операций. «Всего» - только видимые кошельки, как «В кошельках»
  // на главном экране (Engine.walletsTotal); скрытые с движениями - отдельно ниже.
  function walletMonths(S, ops, E) {
    var nowYM = localDate(Date.now()).slice(0, 7), lo = nowYM, hi = nowYM, from = {};
    ops.forEach(function (o) {
      var k = o.date.slice(0, 7);
      if (k < lo) lo = k;
      if (k > hi) hi = k;
      [o.wid, o.wid2].forEach(function (id) { if (id != null && (!from[id] || k < from[id])) from[id] = k; });
    });
    // долги тоже растягивают период: месяц, в котором долг завели, должен быть в таблице
    (S.debts || []).forEach(function (d) {
      var k = String(d.createdDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(k) && k < lo) lo = k;
    });
    var yms = [];
    for (var k = lo; k <= hi; k = E.addMonths(k, 1)) yms.push(k);
    // остаток на конец месяца - тем же правилом, что капитал в приложении (Engine.walletBalancesAt
    // = walletBalanceAt, Р1 ревью 15.10); пусто - месяцы до первой строки кошелька
    var at = E.walletBalancesAt(S, yms.map(function (ym) { return E.monthEnd(ym); }));
    var list = (S.wallets || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).map(function (w) {
      var m = {};
      yms.forEach(function (ym, i) { m[ym] = from[w.id] && ym >= from[w.id] ? at[i][w.id] : null; });
      // 1.0.4: кредитка помечена в названии; её минус - внутри «Всего», как на главном
      return { id: w.id, name: w.name + (w.credit === true ? CAT.credit : '') + (w.hidden ? CAT.hidden : ''), hidden: !!w.hidden, moved: !!from[w.id], m: m };
    }).filter(function (w) { return !w.hidden || w.moved; });
    var total = {};
    yms.forEach(function (ym) {
      var s = 0;
      list.forEach(function (w) { if (!w.hidden) s += w.m[ym] || 0; });
      total[ym] = cents(s);
    });
    // 1.0.4: долги - остаток на конец месяца (текущий - сейчас) по Engine.debtBalanceAt;
    // пусто - месяцы до того, как долг завели. Чистый капитал = Всего + мне должны - я должен.
    var debts = [], net = {};
    if (E && E.debtBalanceAt && (S.debts || []).length) {
      debts = (S.debts || []).slice().sort(function (a, b) {
        if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
        return (a.order || 0) - (b.order || 0);
      }).map(function (d) {
        var m = {};
        yms.forEach(function (ym) { m[ym] = E.debtBalanceAt(S, d.id, E.monthEnd(ym)); });
        return { id: d.id, type: d.type, m: m,
          name: d.name + (d.type === 'owed' ? CAT.owed : CAT.owe).replace(')', d.archived ? CAT.archived2 + ')' : ')') };
      });
      yms.forEach(function (ym) {
        var s = total[ym];
        debts.forEach(function (d) { if (d.m[ym] != null) s += d.type === 'owed' ? d.m[ym] : -d.m[ym]; });
        net[ym] = cents(s);
      });
    }
    return { yms: yms, nowYM: nowYM, list: list, total: total, debts: debts, net: net };
  }

  // ---------- XML ----------
  // Экранирование + выброс символов, которых XML 1.0 не допускает (управляющие, одинокие
  // половинки суррогатных пар): один такой символ в названии - и Excel не откроет файл.
  function xmlText(s) {
    s = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var n = s.charCodeAt(i + 1);
        if (n >= 0xDC00 && n <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; }
        continue;
      }
      if (c >= 0xDC00 && c <= 0xDFFF) continue;
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xFFFE || c === 0xFFFF) continue;
      var ch = s.charAt(i);
      out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch;
    }
    return out;
  }
  // номер колонки → буквы Excel: 0 → A, 25 → Z, 26 → AA (месяцев на листе статей бывает много)
  function col(i) {
    var s = ''; i++;
    while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - 1 - r) / 26; }
    return s;
  }
  // стили (styles.xml cellXfs): 0 обычный, 1 шапка, 2 дата, 3 сумма целая, 4 сумма с копейками, 5 месяц,
  // 6 жирный текст, 7 жирная целая сумма, 8 жирная сумма с копейками, 9 шапка по правому краю,
  // 10/11 сумма на светло-красном (больше лимита) целая/с копейками, 12/13 - на светло-жёлтом
  // (близко к лимиту), 14/15 текст на красном/жёлтом (легенда)
  var ST = { head: 1, date: 2, int: 3, kop: 4, month: 5, bold: 6, bInt: 7, bKop: 8, headR: 9,
    overInt: 10, overKop: 11, warnInt: 12, warnKop: 13, overTxt: 14, warnTxt: 15 };
  var MONEY_ST = { plain: [ST.int, ST.kop], bold: [ST.bInt, ST.bKop], over: [ST.overInt, ST.overKop], warn: [ST.warnInt, ST.warnKop] };
  function strCell(ref, v, s) {
    if (v === '' || v == null) return s ? '<c r="' + ref + '" s="' + s + '"/>' : '';
    return '<c r="' + ref + '" t="inlineStr"' + (s ? ' s="' + s + '"' : '') + '><is><t xml:space="preserve">' + xmlText(v) + '</t></is></c>';
  }
  function numCell(ref, v, s) { return '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>'; }
  // копейки показываем, только когда они есть - как в приложении (Engine.fmt)
  // look: true / 'bold' - жирная, 'over' / 'warn' - подсветка лимита, иначе обычная
  function moneyCell(ref, v, look) {
    var k = Math.round(Math.abs(v) * 100) % 100 ? 1 : 0;
    var set = MONEY_ST[look === true ? 'bold' : look] || MONEY_ST.plain;
    return numCell(ref, cents(v), set[k]);
  }
  // ширина суммы в знаках по формату «# ##0[,00]»
  function moneyWidth(v) {
    var a = Math.abs(cents(v)), n = String(Math.floor(a)).length;
    return n + Math.floor((n - 1) / 3) + (Math.round(a * 100) % 100 ? 3 : 0) + (v < 0 ? 1 : 0);
  }

  function sheetXml(head, widths, body, nRows) {
    var last = col(head.length - 1) + Math.max(nRows + 1, 1);
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:' + last + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>';
    widths.forEach(function (w, i) { x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; });
    x += '</cols><sheetData><row r="1">';
    head.forEach(function (h, i) { x += strCell(col(i) + '1', h, ST.head); });
    x += '</row>' + body + '</sheetData>' +
      '<autoFilter ref="A1:' + last + '"/>' +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    return x;
  }

  function opsSheet(ops) {
    var body = '';
    ops.forEach(function (o, i) {
      var r = i + 2;
      body += '<row r="' + r + '">' +
        numCell('A' + r, excelDate(o.date), ST.date) +
        strCell('B' + r, o.type) +
        moneyCell('C' + r, o.amount) +
        strCell('D' + r, o.cat) + strCell('E' + r, o.wallet) + strCell('F' + r, o.to) + strCell('G' + r, o.note) +
        '</row>';
    });
    return sheetXml(HEAD_OPS, WIDTH_OPS, body, ops.length);
  }
  function monthsSheet(months) {
    var body = '';
    months.forEach(function (m, i) {
      var r = i + 2;
      body += '<row r="' + r + '">' +
        numCell('A' + r, excelDate(m.ym + '-01'), ST.month) +
        moneyCell('B' + r, m.inc) + moneyCell('C' + r, m.exp) + moneyCell('D' + r, m.diff) +
        '</row>';
    });
    return sheetXml(HEAD_MONTHS, WIDTH_MONTHS, body, months.length);
  }

  // Лист с закреплёнными шапкой и первой колонкой, без автофильтра (на листах с блоками
  // и итоговыми строками фильтр только мешает). head - [{t, s}], colW - ширины, lines - строки.
  function gridXml(head, colW, lines, nRows) {
    var last = col(head.length - 1) + Math.max(nRows, 1);
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:' + last + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>' +
      '<selection pane="topRight" activeCell="B1" sqref="B1"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '<selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>';
    colW.forEach(function (w, j) { x += '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + Math.min(w, 60) + '" customWidth="1"/>'; });
    x += '</cols><sheetData><row r="1">';
    head.forEach(function (h, j) { x += strCell(col(j) + '1', h.t, h.s); });
    x += '</row>' + lines.join('') + '</sheetData>' +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    return x;
  }

  // Лист «По категориям»: Статья | Лимит | месяцы | Итого. Лимит - последнего выгружаемого
  // месяца (только у расходов). Факт расхода за месяц подсвечен по лимиту ЭТОГО месяца:
  // красный - больше лимита, жёлтый - близко (Engine.fill). Ноль - пустая ячейка.
  function catsSheet(d) {
    var yms = d.months.map(function (m) { return m.ym; });
    var M0 = 2, nCols = yms.length + 3, totCol = yms.length + 2;
    var colW = [], lines = [], r = 1, anyLimit = false;
    for (var i = 0; i < nCols; i++) colW.push(i === 0 ? 14 : 10);
    function fit(c, w) { if (w > colW[c]) colW[c] = w; }
    // vals - суммы по месяцам; look - 'bold' или null; cat - статья расходов (лимит, подсветка)
    function line(name, vals, look, total, cat) {
      r++;
      var x = '<row r="' + r + '">' + strCell('A' + r, name, look ? ST.bold : 0);
      fit(0, name.length + 2);
      if (cat && cat.limit != null) { x += moneyCell('B' + r, cat.limit); fit(1, moneyWidth(cat.limit) + 3); }
      vals.forEach(function (v, j) {
        if (!cents(v)) return;
        x += moneyCell(col(M0 + j) + r, v, look || (cat && cat.level[yms[j]]) || null);
        fit(M0 + j, moneyWidth(v) + 3);
      });
      if (cents(total)) { x += moneyCell(col(totCol) + r, total, look); fit(totCol, moneyWidth(total) + 3); }
      lines.push(x + '</row>');
    }
    function block(list, title, sumTitle, kind) {
      if (!list.length) return null;
      r++;
      lines.push('<row r="' + r + '">' + strCell('A' + r, title, ST.bold) + '</row>');
      list.forEach(function (c) {
        if (kind === 'exp' && (c.limit != null || Object.keys(c.level).length)) anyLimit = true;
        line(c.name, yms.map(function (ym) { return c.m[ym] || 0; }), null, c.total, kind === 'exp' ? c : null);
      });
      var s = yms.map(function (ym) { var x = 0; list.forEach(function (c) { x += c.m[ym] || 0; }); return cents(x); });
      var t = 0;
      list.forEach(function (c) { t += c.total; });
      line(sumTitle, s, 'bold', cents(t));
      return { m: s, total: cents(t) };
    }
    var zero = { m: yms.map(function () { return 0; }), total: 0 };
    var exp = block(d.cats.exp, CAT.exp, CAT.expSum, 'exp');
    if (exp && d.cats.inc.length) r++;   // пустая строка между блоками
    var inc = block(d.cats.inc, CAT.inc, CAT.incSum, 'inc');
    if (exp || inc) {
      r++;
      var e = exp || zero, n = inc || zero;
      line(CAT.diff, yms.map(function (ym, j) { return cents(n.m[j] - e.m[j]); }), 'bold', cents(n.total - e.total));
    }
    if (anyLimit) {   // легенда цветов - только когда есть лимиты
      r++;
      r++; lines.push('<row r="' + r + '">' + strCell('A' + r, CAT.legendOver, ST.overTxt) + '</row>');
      r++; lines.push('<row r="' + r + '">' + strCell('A' + r, CAT.legendWarn, ST.warnTxt) + '</row>');
    }
    var limHead = CAT.limit + (yms.length ? ' ' + monthTitle(yms[yms.length - 1]) : '');
    fit(1, limHead.length + 3);
    yms.forEach(function (ym, j) { fit(M0 + j, monthTitle(ym).length + 3); });
    fit(totCol, CAT.total.length + 3);
    var head = [{ t: CAT.head, s: ST.head }, { t: limHead, s: ST.headR }]
      .concat(yms.map(function (ym) { return { t: monthTitle(ym), s: ST.headR }; }), [{ t: CAT.total, s: ST.headR }]);
    return gridXml(head, colW, lines, r);
  }

  // Лист «Кошельки»: Кошелёк | месяцы - остаток на конец месяца (текущий - на сегодня).
  // Видимые кошельки, «Всего» (= «В кошельках» на главном), ниже скрытые с движениями.
  // Остаток 0 пишется числом: у кошелька это значение, а не «нет данных»; пусто - месяцы
  // до первого движения кошелька.
  function walletsSheet(wd) {
    var yms = wd.yms, nCols = yms.length + 1;
    var colW = [], lines = [], r = 1;
    for (var i = 0; i < nCols; i++) colW.push(i === 0 ? 14 : 10);
    function fit(c, w) { if (w > colW[c]) colW[c] = w; }
    function line(name, m, bold) {
      r++;
      var x = '<row r="' + r + '">' + strCell('A' + r, name, bold ? ST.bold : 0);
      fit(0, name.length + 2);
      yms.forEach(function (ym, j) {
        if (m[ym] == null) return;
        x += moneyCell(col(j + 1) + r, m[ym], bold || null);
        fit(j + 1, moneyWidth(m[ym]) + 3);
      });
      lines.push(x + '</row>');
    }
    var vis = wd.list.filter(function (w) { return !w.hidden; });
    var hid = wd.list.filter(function (w) { return w.hidden; });
    vis.forEach(function (w) { line(w.name, w.m); });
    line(CAT.wTotal, wd.total, true);
    if (hid.length) {
      r++;
      r++; lines.push('<row r="' + r + '">' + strCell('A' + r, CAT.hiddenHead, ST.bold) + '</row>');
      fit(0, CAT.hiddenHead.length);
      hid.forEach(function (w) { line(w.name, w.m); });
    }
    if (wd.debts && wd.debts.length) {
      r++;
      r++; lines.push('<row r="' + r + '">' + strCell('A' + r, CAT.debtsHead, ST.bold) + '</row>');
      fit(0, CAT.debtsHead.length);
      wd.debts.forEach(function (d) { line(d.name, d.m); });
      r++;
      line(CAT.net, wd.net, true);
    }
    function title(ym) { return monthTitle(ym) + (ym === wd.nowYM ? CAT.today : ''); }
    yms.forEach(function (ym, j) { fit(j + 1, title(ym).length + 3); });
    var head = [{ t: CAT.wallet, s: ST.head }].concat(yms.map(function (ym) { return { t: title(ym), s: ST.headR }; }));
    return gridXml(head, colW, lines, r);
  }

  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  var ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  var WB_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  // 164 - дата ДД.ММ.ГГГГ, 165 - месяц словом по-русски; 3 (#,##0) и 4 (#,##0.00) - встроенные
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/><numFmt numFmtId="165" formatCode="[$-419]mmmm\\ yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF2"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="16">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  function workbookXml(nOps, nMonths) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Операции" sheetId="1" r:id="rId1"/><sheet name="По категориям" sheetId="2" r:id="rId2"/>' +
      '<sheet name="Кошельки" sheetId="3" r:id="rId3"/><sheet name="Итоги по месяцам" sheetId="4" r:id="rId4"/></sheets>' +
      '<definedNames>' +
      '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Операции\'!$A$1:$G$' + (nOps + 1) + '</definedName>' +
      '<definedName name="_xlnm._FilterDatabase" localSheetId="3" hidden="1">\'Итоги по месяцам\'!$A$1:$D$' + (nMonths + 1) + '</definedName>' +
      '</definedNames></workbook>';
  }

  // Все части файла как строки - для проверок и для build
  function parts(S, E) {
    var d = rows(S, E);
    return {
      data: d,
      files: {
        '[Content_Types].xml': CONTENT_TYPES,
        '_rels/.rels': ROOT_RELS,
        'xl/workbook.xml': workbookXml(d.ops.length, d.months.length),
        'xl/_rels/workbook.xml.rels': WB_RELS,
        'xl/styles.xml': STYLES,
        'xl/worksheets/sheet1.xml': opsSheet(d.ops),
        'xl/worksheets/sheet2.xml': catsSheet(d),
        'xl/worksheets/sheet3.xml': walletsSheet(d.wallets),
        'xl/worksheets/sheet4.xml': monthsSheet(d.months)
      }
    };
  }

  function utf8(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    var esc = unescape(encodeURIComponent(s)), b = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) b[i] = esc.charCodeAt(i);
    return b;
  }
  // Байты .xlsx. fflate - window.fflate (vendor) или require('fflate') в Node.
  function build(S, E, fflate) {
    var p = parts(S, E), z = {};
    Object.keys(p.files).forEach(function (k) { z[k] = [utf8(p.files[k]), { level: 6 }]; });
    return fflate.zipSync(z);
  }

  return { TYPE: TYPE, FIX_NOTE: FIX_NOTE, FIX_NOTE_ADJ: FIX_NOTE_ADJ, FIX_NOTE_DEL: FIX_NOTE_DEL, HEAD_OPS: HEAD_OPS, HEAD_MONTHS: HEAD_MONTHS, CAT: CAT,
    monthTitle: monthTitle, col: col,
    MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    excelDate: excelDate, fileName: fileName, rows: rows, parts: parts, build: build, xmlText: xmlText };
});
