/* import.js - загрузка операций из таблиц других приложений учёта (1.0.4, только «Полный
   доступ»). Без DOM: тестируется в Node (tests/import.test.js), в приложении - window.Import.
   Экраны (выбор файла, сопоставление колонок, предпросмотр) - в import-ui.js.

   Конвейер:
     байты файла → readFile: CSV (кодировка и разделитель определяются сами) или XLSX (fflate)
       → таблица (массив строк) → findHeader: строка заголовков
       → detectTemplate: известный формат («Хомяк», CoinKeeper, Дзен-мани) или null
       → guessMapping: колонки по заголовкам (если шаблон не узнан - экран сопоставления)
       → extract: записи {date, kind, amount, cat, wallet, to, note} + пропущенные с причиной
       → names: какие категории и кошельки из файла уже есть, каких нет
       → plan: что добавится (с учётом выбора «создать / взять существующую»), дубликаты,
         потолки Полного доступа, операции раньше точки отсчёта кошелька
       → apply: запись одним действием, метка партии t.imp; undo - отмена последней партии.

   Точка отсчёта кошелька (Engine: base/baseTs, «Изменить баланс»). В движке операция,
   у которой ts (время внесения) раньше baseTs кошелька, «вшита» в баланс и его не двигает.
   Ручной ввод ставит ts = сейчас, поэтому любая новая операция баланс двигает. При импорте
   истории так нельзя: баланс, заданный хозяином вручную, уже включает прошлые траты, и
   импорт удвоил бы их. Поэтому ts импортированной операции - конец её дня (но не позже
   «сейчас»): операция с датой РАНЬШЕ дня точки отсчёта получает ts < baseTs и баланс не
   двигает (ровно как старая операция до «Изменить баланс»), операция в день точки отсчёта
   и позже - двигает, как ручной ввод. Новые кошельки, созданные импортом, получают
   baseTs = 0: их баланс складывается из импортированной истории с нуля. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Import = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_BYTES = 10 * 1024 * 1024;     // больше 10 МБ - вежливый отказ
  var MAX_ROWS = 50000;                 // больше 50 000 строк - вежливый отказ
  var NONAME_CAT = 'Без категории';
  var NEW_WALLET = 'Из таблицы';

  // ---------- кодировки ----------
  // Windows-1251: 0x80-0xBF - своя таблица, 0xC0-0xFF - А..я подряд. Своя, а не
  // TextDecoder('windows-1251'): тот есть не во всякой сборке WebView/Node.
  var CP1251_HI = [0x402, 0x403, 0x201A, 0x453, 0x201E, 0x2026, 0x2020, 0x2021, 0x20AC, 0x2030, 0x409, 0x2039, 0x40A, 0x40C, 0x40B, 0x40F,
    0x452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0xFFFD, 0x2122, 0x459, 0x203A, 0x45A, 0x45C, 0x45B, 0x45F,
    0xA0, 0x40E, 0x45E, 0x408, 0xA4, 0x490, 0xA6, 0xA7, 0x401, 0xA9, 0x404, 0xAB, 0xAC, 0xAD, 0xAE, 0x407,
    0xB0, 0xB1, 0x406, 0x456, 0x491, 0xB5, 0xB6, 0xB7, 0x451, 0x2116, 0x454, 0xBB, 0x458, 0x405, 0x455, 0x457];
  function cp1251(b, from) {
    var parts = [], chunk = [];
    for (var i = from || 0; i < b.length; i++) {
      var c = b[i];
      chunk.push(c < 0x80 ? c : (c >= 0xC0 ? 0x410 + c - 0xC0 : CP1251_HI[c - 0x80]));
      if (chunk.length >= 8192) { parts.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
    }
    if (chunk.length) parts.push(String.fromCharCode.apply(null, chunk));
    return parts.join('');
  }
  // правильный ли это UTF-8 (строго: лишние байты продолжения, обрезанные и «длинные» формы - нет)
  function validUtf8(b, from) {
    for (var i = from || 0; i < b.length; i++) {
      var c = b[i];
      if (c < 0x80) continue;
      var n = c >= 0xF0 && c <= 0xF4 ? 3 : c >= 0xE0 ? 2 : c >= 0xC2 && c < 0xE0 ? 1 : -1;
      if (n < 0 || c > 0xF4) return false;
      for (var k = 1; k <= n; k++) { if (i + k >= b.length || (b[i + k] & 0xC0) !== 0x80) return false; }
      i += n;
    }
    return true;
  }
  function utf8(b, from) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(from ? b.subarray(from) : b);
    var s = ''; for (var i = from || 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return decodeURIComponent(escape(s));
  }
  // Байты → текст: BOM UTF-8/UTF-16, иначе строгий UTF-8, иначе Windows-1251 (Excel на
  // русской Windows сохраняет CSV именно в ней). Возвращает {text, enc}.
  function decode(b) {
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return { text: utf8(b, 3), enc: 'utf-8' };
    if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), enc: 'utf-16le' };
    if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), enc: 'utf-16be' };
    if (validUtf8(b, 0)) return { text: utf8(b, 0), enc: 'utf-8' };
    return { text: cp1251(b, 0), enc: 'windows-1251' };
  }

  // ---------- CSV ----------
  // RFC 4180: кавычки, "" внутри кавычек, переносы строк и разделители внутри ячеек.
  // limit - сколько строк разобрать (для угадывания разделителя хватит начала файла).
  function parseCSV(text, delim, limit) {
    var rows = [], row = [], cell = '', i = 0, n = text.length, q = false, max = limit || Infinity;
    var D = delim.charCodeAt(0);
    while (i < n) {
      var c = text.charCodeAt(i);
      if (q) {
        if (c === 34) {
          if (text.charCodeAt(i + 1) === 34) { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        var j = text.indexOf('"', i);
        if (j < 0) { cell += text.slice(i); i = n; continue; }
        cell += text.slice(i, j); i = j; continue;
      }
      if (c === 34 && cell === '') { q = true; i++; continue; }
      if (c === D) { row.push(cell); cell = ''; i++; continue; }
      if (c === 13 || c === 10) {
        row.push(cell); cell = ''; rows.push(row); row = [];
        if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
        i++;
        if (rows.length >= max) return rows;
        continue;
      }
      cell += text.charAt(i); i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  // Разделитель: пробуем ; таб , на начале файла и берём тот, при котором больше всего
  // строк одной и той же ширины (больше одной колонки). Не по первой строке: у Дзен-мани
  // над заголовком служебные строки («zm_dump_…») другой ширины.
  function detectDelimiter(text) {
    var head = text.slice(0, 65536), best = ',', score = -1;
    [';', '\t', ','].forEach(function (d) {
      var hist = {}, top = 0, topW = 0;
      parseCSV(head, d, 40).forEach(function (r) {
        if (r.length < 2) return;
        var n = hist[r.length] = (hist[r.length] || 0) + 1;
        if (n > top || (n === top && r.length > topW)) { top = n; topW = r.length; }
      });
      if (!top) return;
      var sc = top * 1000 + Math.min(topW, 999);
      if (sc > score) { score = sc; best = d; }
    });
    return best;
  }

  // ---------- XLSX ----------
  function xmlUnesc(s) {
    return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
      if (e === 'quot') return '"'; if (e === 'apos') return "'";
      var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch (x) { return ''; }
    });
  }
  // Разбор XML книги - линейным проходом, без регулярок вида «<row…>(.*?)</row>»: на файле,
  // где закрывающих тегов нет, такая регулярка от каждого «<row» искала конец до конца
  // документа (квадратичное время - приложение висело минутами, ревью 12.10). Здесь каждый
  // символ просматривается ограниченное число раз: найденные позиции «>», «</тег>» и
  // следующего «<тег» запоминаются и переиспользуются, пока проход их не обгонит.
  // fn(head, body) - head: открывающий тег целиком (без «<» внутри), body: содержимое до
  // «</тег>» (нет закрытия - до следующего такого же тега или конца). fn вернул true - стоп.
  function scanTags(xml, name, fn) {
    var open = '<' + name, close = '</' + name + '>', n = xml.length, pos = 0;
    var gtAt = -2, clAt = -2, nxAt = -2, ltAt = -2;
    while (pos < n) {
      var s = xml.indexOf(open, pos);
      if (s < 0) return;
      var ch = xml.charCodeAt(s + open.length);
      // «<rowBreaks», «<numFmts» - другой тег
      if (!(ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 62 || ch === 47)) { pos = s + open.length; continue; }
      if (gtAt !== -1 && gtAt <= s) gtAt = xml.indexOf('>', s);
      if (gtAt < 0) return;
      if (ltAt !== -1 && ltAt <= s) ltAt = xml.indexOf('<', s + 1);
      if (ltAt >= 0 && ltAt < gtAt) { pos = ltAt; continue; }   // битый тег без «>»
      var g = gtAt, head = xml.slice(s, g + 1);
      if (xml.charCodeAt(g - 1) === 47) { if (fn(head, '')) return; pos = g + 1; continue; }   // <тег/>
      if (clAt !== -1 && clAt <= g) clAt = xml.indexOf(close, g);
      if (nxAt !== -1 && nxAt <= g) nxAt = xml.indexOf(open, g);
      var end = (clAt >= 0 && (nxAt < 0 || clAt <= nxAt)) ? clAt : (nxAt >= 0 ? nxAt : n);
      if (fn(head, xml.slice(g + 1, end))) return;
      pos = end === clAt ? clAt + close.length : end;
    }
  }
  function firstBody(xml, name) {
    var out = null;
    scanTags(xml, name, function (h, b) { out = b; return true; });
    return out;
  }
  function attr(head, name) {
    var i = head.indexOf(' ' + name + '="');
    if (i < 0) { i = head.indexOf('\t' + name + '="'); if (i < 0) i = head.indexOf('\n' + name + '="'); }
    if (i < 0) return null;
    var a = i + name.length + 3, b = head.indexOf('"', a);
    return b < 0 ? null : head.slice(a, b);
  }
  function textOf(xml) {   // все <t>…</t> подряд (строка с форматированием из кусков)
    var out = '';
    scanTags(xml, 't', function (h, b) { out += b; });
    return xmlUnesc(out);
  }
  function colIndex(ref) {
    var m = /^([A-Z]{1,3})/.exec(ref || ''), n = 0;
    if (!m) return -1;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }
  // встроенные форматы Excel с датой и форматы, где есть д/м/г
  var DATE_FMT_IDS = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 30: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 57: 1 };
  function dateStyles(stylesXml) {
    var custom = {}, out = [];
    if (!stylesXml) return out;
    scanTags(stylesXml, 'numFmt', function (head) {
      var id = attr(head, 'numFmtId'), code = attr(head, 'formatCode');
      if (id == null || code == null) return;
      var c = xmlUnesc(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
      custom[id] = /[dyдг]/i.test(c) || (/m/i.test(c) && !/[#0]/.test(c) && !/h|s/i.test(c));
    });
    var xfs = firstBody(stylesXml, 'cellXfs');
    if (xfs == null) return out;
    scanTags(xfs, 'xf', function (head) {
      var id = +(attr(head, 'numFmtId') || 0);
      out.push(!!(DATE_FMT_IDS[id] || custom[id]));
    });
    return out;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // Excel-число дня → «ГГГГ-ММ-ДД» (дробная часть - время дня, для даты не нужна)
  function serialToDate(v) {
    if (!(v >= 20000 && v <= 80000)) return null;   // 1954…2119 - иначе это не дата, а число
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-7) * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  // Потолки распаковки: zip в 10 МБ может развернуться в гигабайты («zip-бомба»). Берём
  // только XML-части книги, заявленный размер каждой проверяем ДО распаковки (fflate filter),
  // сумма - не больше MAX_UNZIP; столбцов и номеров строк - не больше разумного.
  var MAX_UNZIP = 60 * 1024 * 1024;
  var MAX_COLS = 256;
  function unzipBook(bytes, fflate) {
    var total = 0, over = false, files;
    try {
      files = fflate.unzipSync(bytes, { filter: function (f) {
        if (!/^xl\/.*\.(xml|rels)$/i.test(f.name)) return false;
        if (!(f.originalSize >= 0) || f.originalSize > MAX_UNZIP || total + f.originalSize > MAX_UNZIP) { over = true; return false; }
        total += f.originalSize;
        return true;
      } });
    } catch (e) { throw new Error(over ? 'unzip' : 'xlsx'); }
    if (over) throw new Error('unzip');
    // заявленный размер мог соврать: считаем распакованное по факту
    var real = 0;
    Object.keys(files).forEach(function (k) { real += files[k].length; });
    if (real > MAX_UNZIP) throw new Error('unzip');
    return files;
  }
  // Книга → {sheets:[{name, rows}], pick}: лист «Операции», иначе первый. Строки - массивы
  // ячеек: текст, число или дата строкой «ГГГГ-ММ-ДД» (ячейки в формате даты).
  // Бросает 'xlsx' (не книга), 'unzip' (распаковка больше MAX_UNZIP), 'rows' (строк больше MAX_ROWS).
  function readXlsx(bytes, fflate) {
    var files = unzipBook(bytes, fflate);
    // Р17 ревью 15.10: часть программ пишет теги с префиксом пространства имён (<x:row>,
    // <x:c>, <x:v>, <x:si>/<x:t>) - снимаем префикс у имён тегов (атрибуты вроде r:id не трогаем)
    function str(name) {
      var f = files[name], x = f ? fflate.strFromU8(f) : '';
      return /<\/?[A-Za-z_][\w.-]*:[A-Za-z_]/.test(x) ? x.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1') : x;
    }
    var wb = str('xl/workbook.xml');
    if (!wb) throw new Error('xlsx');
    var rels = {};
    scanTags(str('xl/_rels/workbook.xml.rels'), 'Relationship', function (head) {
      var id = attr(head, 'Id'), t = attr(head, 'Target');
      if (id && t) rels[id] = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    });
    var sheets = [];
    scanTags(wb, 'sheet', function (head) {
      var name = xmlUnesc(attr(head, 'name') || ''), rid = attr(head, 'r:id');
      sheets.push({ name: name, path: rels[rid] || ('xl/worksheets/sheet' + (sheets.length + 1) + '.xml') });
    });
    if (!sheets.length) throw new Error('xlsx');
    var pick = 0;
    sheets.forEach(function (s, i) { if (s.name.trim().toLowerCase() === 'операции') pick = i; });
    var shared = [], ss = str('xl/sharedStrings.xml');
    if (ss) scanTags(ss, 'si', function (h, b) { shared.push(textOf(b)); });
    var isDateStyle = dateStyles(str('xl/styles.xml'));
    var xml = str(sheets[pick].path);
    var rows = [];
    scanTags(xml, 'row', function (rhead, rbody) {
      var row = [], next = 0;
      var rn = +(attr(rhead, 'r') || 0);
      if (rn > MAX_ROWS + 2) throw new Error('rows');      // «r="99999999"» - не раздуваем пустыми строками
      while (rn && rows.length < rn - 1) rows.push([]);   // пустые строки, которых нет в XML
      scanTags(rbody, 'c', function (a, inner) {
        var ci = colIndex(attr(a, 'r'));
        if (ci < 0) ci = next;
        next = ci + 1;
        if (ci >= MAX_COLS) return;
        var t = attr(a, 't') || 'n';
        var vb = firstBody(inner, 'v'), v = vb != null ? xmlUnesc(vb) : '';
        var val;
        // t="s" без <v> - пустая ячейка (а не первая общая строка: +'' = 0); t="d" - дата ISO
        if (t === 's') val = v !== '' && shared[+v] != null ? shared[+v] : '';
        else if (t === 'd') val = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str' || t === 'b') val = v;
        else if (t === 'e') val = '';
        else if (v === '') val = '';
        else {
          var num = Number(v), s = +(attr(a, 's') || 0);
          val = isDateStyle[s] && serialToDate(num) ? serialToDate(num) : num;
        }
        while (row.length < ci) row.push('');
        row[ci] = val;
      });
      rows.push(row);
      if (rows.length > MAX_ROWS + 2) throw new Error('rows');
    });
    return { sheets: sheets.map(function (s) { return s.name; }), sheet: sheets[pick].name, rows: rows };
  }

  // ---------- файл целиком ----------
  // Байты → {kind:'csv'|'xlsx', rows, enc?, delim?, sheet?}. Бросает Error с кодом:
  //   big - больше 10 МБ, xls - старый двоичный Excel, xlsx - книга не читается, unzip -
  //   внутри книги больше 60 МБ после распаковки,
  //   empty - в файле нет строк, rows - больше 50 000 строк.
  function readFile(bytes, fflate) {
    if (!bytes || !bytes.length) throw new Error('empty');
    if (bytes.length > MAX_BYTES) throw new Error('big');
    var rows, info;
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
      if (!fflate) throw new Error('xlsx');
      var x = readXlsx(bytes, fflate);
      rows = x.rows; info = { kind: 'xlsx', sheet: x.sheet };
    } else if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
      throw new Error('xls');
    } else {
      var dec = decode(bytes), delim = detectDelimiter(dec.text);
      rows = parseCSV(dec.text, delim);
      info = { kind: 'csv', enc: dec.enc, delim: delim };
    }
    rows = trimRows(rows);
    if (!rows.length) throw new Error('empty');
    if (rows.length > MAX_ROWS + 1) throw new Error('rows');
    info.rows = rows;
    return info;
  }
  function blank(v) { return v == null || (typeof v === 'string' && !v.trim()); }
  function trimRows(rows) {
    var out = rows.filter(function (r) { for (var i = 0; i < r.length; i++) if (!blank(r[i])) return true; return false; });
    return out;
  }

  // ---------- заголовки и роли ----------
  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[*:]+$/, '').trim();
  }
  var ROLES = ['date', 'amount', 'expense', 'income', 'type', 'cat', 'wallet', 'to', 'note', 'currency'];
  // Синонимы заголовков (после norm). Точное совпадение важнее, чем «содержит».
  var SYN = {
    date: ['дата', 'date', 'дата операции', 'дата и время', 'дата/время', 'datetime', 'день', 'дата транзакции',
      'transaction date', 'дата платежа'],
    amount: ['сумма', 'amount', 'sum', 'сумма операции', 'value', 'итого', 'сумма в рублях', 'сумма, руб', 'сумма (руб)'],
    expense: ['расход', 'расходы', 'outcome', 'expense', 'expenses', 'списание', 'потрачено', 'debit', 'дебет'],
    income: ['доход', 'доходы', 'income', 'приход', 'зачисление', 'поступление', 'credit', 'кредит'],
    type: ['тип', 'type', 'вид', 'тип операции', 'вид операции', 'transaction type', 'операция'],
    cat: ['категория', 'category', 'categoryname', 'category name', 'статья', 'статья расходов', 'раздел', 'подкатегория'],
    wallet: ['кошелек', 'счет', 'account', 'wallet', 'из', 'from', 'источник', 'outcomeaccountname', 'карта', 'счет списания',
      'кошелек списания', 'с кошелька', 'со счета'],
    to: ['кошелек назначения', 'куда', 'в', 'to', 'счет назначения', 'на счет', 'на кошелек', 'incomeaccountname',
      'счет зачисления', 'кошелек зачисления', 'получатель'],
    note: ['комментарий', 'примечание', 'заметка', 'описание', 'comment', 'note', 'notes', 'description', 'memo', 'назначение платежа'],
    currency: ['валюта', 'currency', 'outcomecurrencyshorttitle', 'код валюты']
  };
  function roleOf(h) {
    var n = norm(h);
    if (!n) return null;
    for (var i = 0; i < ROLES.length; i++) if (SYN[ROLES[i]].indexOf(n) >= 0) return ROLES[i];
    return null;
  }
  // Автоугадывание: каждой роли - первая колонка с её заголовком; потом - по «содержит»
  // для тех, что не нашлись (длинные заголовки вида «Сумма в валюте счёта»).
  function guessMapping(header) {
    var map = {}, used = {};
    header.forEach(function (h, i) { var r = roleOf(h); if (r && map[r] == null) { map[r] = i; used[i] = 1; } });
    var LOOSE = [['date', /дата|date/], ['amount', /сумм|amount/], ['cat', /категор|categor/],
      ['note', /коммент|примеч|описан|comment|note/], ['currency', /валют|currenc/], ['type', /^тип|type/]];
    LOOSE.forEach(function (p) {
      if (map[p[0]] != null) return;
      for (var i = 0; i < header.length; i++) if (!used[i] && p[1].test(norm(header[i]))) { map[p[0]] = i; used[i] = 1; return; }
    });
    // пара «расход/доход» и единая «сумма» сразу не нужны: есть сумма - пару не берём
    if (map.amount != null) { delete map.expense; delete map.income; }
    return map;
  }
  // Строка заголовков: первая из первых 10 строк, где узнаются хотя бы две роли (у
  // некоторых выгрузок сверху название отчёта). Не нашлась - первая строка.
  function findHeader(rows) {
    for (var i = 0; i < Math.min(10, rows.length); i++) {
      var n = 0;
      rows[i].forEach(function (h) { if (typeof h === 'string' && roleOf(h)) n++; });
      if (n >= 2) return i;
    }
    return 0;
  }

  // ---------- известные форматы ----------
  // Узнаются по набору заголовков (после norm), колонки - по имени, порядок не важен.
  //
  // «Хомяк» - собственная выгрузка (www/xlsx.js HEAD_OPS, лист «Операции»).
  //
  // CoinKeeper (Настройки → Экспорт, CSV через запятую, UTF-8). Заголовки и их порядок -
  // по разбору выгрузки CoinKeeper в открытом коде alkafinance/venice:
  // https://github.com/alkafinance/venice/blob/main/connectors/connector-spreadsheet/formats/format-coinkeeper.ts
  //   Данные,Тип,Из,В,Метки,Сумма,Валюта,Сумма в др.валюте,Др.валюта,Повторение,Заметка
  // («Данные» - так CoinKeeper перевёл «Data», это дата). Разделитель и кодировка - справка
  // CoinKeeper https://ruhelp.coinkeeper.me/76d98e31b8684cd8ba023b945ec80407 . Дата там M/d/yy.
  // Смысл «Из»/«В» зависит от типа: расход - из кошелька в категорию, доход - из источника
  // (категории) в кошелёк, перевод - из кошелька в кошелёк (opts.ck). Подтверждено только
  // слово «Расход»; «Доход»/«Перевод» и английские варианты разбирает parseType по началу слова.
  // В ck2zm (https://github.com/baitun/ck2zm) заголовков нет - он файл не разбирает.
  //
  // Дзен-мани (веб-версия: Настройка аккаунта → Экспорт операций в CSV). Заголовок
  // совпадает в трёх независимых разборщиках выгрузки:
  //   date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,
  //   incomeAccountName,income,incomeCurrencyShortTitle,createdDate,changedDate
  // https://github.com/vleseg/zmsavings/blob/master/tests/data/transactions.csv (над заголовком
  //   служебные строки «zm_dump_…» - findHeader их пропускает),
  // https://github.com/artempas/zenmoney_analytics/blob/main/server/src/import/parseZenmoney.ts
  //   (тип - по тому, какая сторона заполнена: обе - перевод; вложенные категории «Еда / Кофе»),
  // https://github.com/mikedudin/zenmoney-viewer/blob/main/data.example.csv (разделитель «;»).
  // Суммы положительные, копейки через запятую («"19,00"»), дата ГГГГ-ММ-ДД.
  var TEMPLATES = [
    { id: 'homyak', title: 'выгрузка «Хомяка»',
      need: ['дата', 'тип', 'сумма', 'категория', 'кошелек', 'кошелек назначения'],
      cols: { date: 'дата', type: 'тип', amount: 'сумма', cat: 'категория', wallet: 'кошелек', to: 'кошелек назначения', note: 'комментарий' } },
    { id: 'coinkeeper', title: 'выгрузка другого приложения',
      need: ['данные', 'тип', 'из', 'в', 'сумма'],
      cols: { date: 'данные', type: 'тип', wallet: 'из', to: 'в', amount: 'сумма', currency: 'валюта', note: ['заметка', 'метки'] },
      opts: { ck: true } },
    { id: 'zenmoney', title: 'выгрузка другого приложения',
      need: ['date', 'outcomeaccountname', 'outcome', 'incomeaccountname', 'income'],
      cols: { date: 'date', cat: 'categoryname', wallet: 'outcomeaccountname', expense: 'outcome', to: 'incomeaccountname', income: 'income',
        currency: ['outcomecurrencyshorttitle', 'incomecurrencyshorttitle'], note: ['comment', 'payee'] } }
  ];
  function detectTemplate(header) {
    var idx = {};
    header.forEach(function (h, i) { var n = norm(h); if (n && idx[n] == null) idx[n] = i; });
    for (var t = 0; t < TEMPLATES.length; t++) {
      var T = TEMPLATES[t];
      if (!T.need.every(function (n) { return idx[n] != null; })) continue;
      var map = {};
      Object.keys(T.cols).forEach(function (role) {
        var names = [].concat(T.cols[role]), cols = [];
        names.forEach(function (n) { if (idx[n] != null) cols.push(idx[n]); });
        if (cols.length) map[role] = (role === 'currency' || role === 'note') && cols.length > 1 ? cols : cols[0];
      });
      return { id: T.id, title: T.title, map: map, opts: T.opts || {} };
    }
    return null;
  }

  // ---------- значения ----------
  // Сумма: пробелы и неразрывные пробелы в разрядах, запятая или точка в копейках,
  // минус (в т.ч. «−», в конце и скобками), «₽», «руб», «р.». NaN - не сумма.
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : NaN;
    var s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    s = s.replace(/[\s'’]/g, '').replace(/[−–—]/g, '-')
      .replace(/(₽|руб\.?|р\.|rub|rur)/gi, '')
      .replace(/(^|[^а-яёa-z])р$/i, '$1');   // «500р», «1 234,56 р» - «р» в конце, не часть слова (Р17 ревью 15.10); без lookbehind - К1 ревью 1.0.5
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); } else if (/^\+/.test(s)) s = s.slice(1);
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    var c = (s.match(/,/g) || []).length, d = (s.match(/\./g) || []).length;
    if (c && d) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (c > 1 || (c === 1 && /^[1-9]\d{0,2},\d{3}$/.test(s))) s = s.replace(/,/g, '');
    else if (c === 1) s = s.replace(',', '.');
    // один знак и ровно три цифры после него - это разряды («3,000», «1.500»): копеек
    // в деньгах две, третьей цифры не бывает
    else if (d > 1 || (d === 1 && /^[1-9]\d{0,2}\.\d{3}$/.test(s))) s = s.replace(/\./g, '');
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
    var n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    n = Math.round(n * 100) / 100;
    return neg ? -n : n;
  }
  function validYMD(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  var RE_YMD = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s,])/;
  var RE_DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:$|[T\s,])/;
  // Порядок день/месяц в колонке: если где-то первое число > 12 - это день (ДД.ММ),
  // если второе > 12 - американский ММ/ДД. Не понять: через точку - ДД.ММ (русский
  // порядок), через косую черту - ММ/ДД (так пишет английская выгрузка CoinKeeper).
  function dateOrder(values) {
    var dmy = 0, mdy = 0, slash = 0, dot = 0;
    values.forEach(function (v) {
      var s = String(v == null ? '' : v).trim(), m = RE_DMY.exec(s);
      if (!m) return;
      if (s.indexOf('/') >= 0) slash++; else dot++;
      if (+m[1] > 12) dmy++;
      else if (+m[2] > 12) mdy++;
    });
    if (dmy) return 'dmy';
    if (mdy) return 'mdy';
    return slash > dot ? 'mdy' : 'dmy';
  }
  // Дата: ДД.ММ.ГГГГ (и ДД.ММ.ГГ, ДД/ММ/ГГГГ), ГГГГ-ММ-ДД, с временем, Excel-число дня.
  function parseDate(v, order) {
    if (typeof v === 'number') return serialToDate(v);
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var m = RE_YMD.exec(s);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = RE_DMY.exec(s);
    if (m) {
      var y = +m[3];
      if (m[3].length === 2) y += 2000;
      return order === 'mdy' ? validYMD(y, +m[1], +m[2]) : validYMD(y, +m[2], +m[1]);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) return serialToDate(+s);
    return null;
  }
  // Тип операции по слову. '' - нет слова, null - слово есть, но незнакомое.
  function parseType(v) {
    var n = norm(v);
    if (!n) return '';
    // 1.0.4: операции с долгами из выгрузки «Хомяка» (xlsx.js TYPE) - импорт долги не создаёт
    if (/^(платёж по долгу|платеж по долгу|взято в долг|дано в долг|возврат долга)/.test(n)) return 'debt';
    if (/^(out|debit)$/.test(n) || /^(расход|трат|списани|expense|outcome|payment|покупк|оплат)/.test(n)) return 'exp';
    if (/^(in|credit)$/.test(n) || /^(доход|поступлени|зачислени|приход|income|пополнени)/.test(n)) return 'inc';
    if (/^(перевод|transfer|перемещение)/.test(n)) return 'transfer';
    if (/^(корректировка|correction|adjustment|изменение баланса)/.test(n)) return 'fix';
    return null;
  }
  // Рубль: пусто, RUB/RUR, ₽, руб., 643. Остальное - другая валюта.
  function isRub(v) {
    var n = norm(v).replace(/\.$/, '');
    return !n || /^(rub|rur|₽|руб|р|рубль|рубли|российский рубль|643)$/.test(n);
  }
  function cellText(v) { return v == null ? '' : (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : String(v)); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // Таблица + сопоставление → записи. map: роль → номер колонки (currency - номер или
  // массив номеров). Строки до header включительно не данные. opts.today - для проверок.
  // Пропущенные - {line, why}: amount (пустая/нечитаемая сумма), date (нераспознанная дата),
  // future (дата в будущем), currency (другая валюта), fix (корректировка баланса),
  // transfer (перевод без второго кошелька), big (сумма больше миллиарда),
  // type (CoinKeeper: тип не распознан - без него не понять, что значат «Из» и «В»).
  var MAX_AMOUNT = 999999999;
  function extract(rows, header, map, opts) {
    opts = opts || {};
    var now = opts.today || today();
    var data = rows.slice(header + 1);
    var get = function (r, role) { var i = map[role]; return i == null || i < 0 ? '' : r[i]; };
    var order = map.date != null ? dateOrder(data.map(function (r) { return r[map.date]; })) : 'dmy';
    var cur = map.currency == null ? [] : [].concat(map.currency).filter(function (i) { return i != null && i >= 0; });
    var pair = map.amount == null && (map.expense != null || map.income != null);
    var noteCols = map.note == null ? [] : [].concat(map.note).filter(function (i) { return i != null && i >= 0; });
    var out = [], skipped = [];
    data.forEach(function (r, k) {
      var line = header + k + 2;   // номер строки в файле (с единицы, как видит человек)
      function skip(why) { skipped.push({ line: line, why: why }); }
      var type = parseType(get(r, 'type'));
      if (type === 'fix') return skip('fix');
      if (type === 'debt') return skip('debt');
      var date = parseDate(get(r, 'date'), order);
      if (!date) return skip('date');
      for (var c = 0; c < cur.length; c++) if (!isRub(r[cur[c]])) return skip('currency');
      var wallet = cellText(get(r, 'wallet')), to = cellText(get(r, 'to')), cat = cellText(get(r, 'cat'));
      var kind, amount;
      if (opts.ck) {
        // CoinKeeper: «Из»/«В» по типу (см. TEMPLATES)
        var ca = parseAmount(get(r, 'amount'));
        if (!isFinite(ca) || ca === 0) return skip('amount');
        if (type !== 'exp' && type !== 'inc' && type !== 'transfer') return skip('type');
        kind = type; amount = Math.abs(ca);
        if (kind === 'exp') { cat = to; to = ''; }
        else if (kind === 'inc') { cat = wallet; wallet = to; to = ''; }
      } else if (!pair) {
        var a = parseAmount(get(r, 'amount'));
        if (!isFinite(a) || a === 0) return skip('amount');
        amount = Math.abs(a);
        if (type === 'exp' || type === 'inc' || type === 'transfer') kind = type;
        else if (to && wallet && norm(to) !== norm(wallet)) kind = 'transfer';
        else kind = a < 0 ? 'exp' : 'inc';
      } else {
        var e = Math.abs(parseAmount(get(r, 'expense'))), n = Math.abs(parseAmount(get(r, 'income')));
        e = isFinite(e) ? e : 0; n = isFinite(n) ? n : 0;
        if (e > 0 && n > 0 && wallet && to && norm(wallet) !== norm(to)) { kind = 'transfer'; amount = e; }
        else if (type === 'transfer' && (e || n)) { kind = 'transfer'; amount = e || n; }
        else if (e > 0 && !(type === 'inc' && n > 0)) { kind = 'exp'; amount = e; }
        else if (n > 0) { kind = 'inc'; amount = n; if (to) wallet = to; }
        else return skip('amount');
      }
      if (kind === 'transfer' && (!wallet || !to || norm(wallet) === norm(to))) return skip('transfer');
      if (amount > MAX_AMOUNT) return skip('big');
      if (date > now) return skip('future');
      var note = noteCols.map(function (i) { return cellText(r[i]); }).filter(Boolean).join(' - ');
      out.push({ line: line, date: date, kind: kind, amount: Math.round(amount * 100) / 100,
        cat: kind === 'transfer' ? '' : cat,
        wallet: wallet, to: kind === 'transfer' ? to : '',
        note: note });   // предел и чистка - правилом движка при записи (apply → E.cleanNote)
    });
    return { records: out, skipped: skipped };
  }

  // ---------- названия: что уже есть ----------
  function findCatByName(S, kind, name) {
    var n = norm(name), list = S.categories[kind] || [], arch = null;
    for (var i = 0; i < list.length; i++) {
      if (norm(list[i].name) !== n) continue;
      if (!list[i].archived) return list[i].id;
      if (!arch) arch = list[i].id;
    }
    return arch;
  }
  function findWalletByName(S, name) {
    var n = norm(name), hid = null;
    for (var i = 0; i < S.wallets.length; i++) {
      if (norm(S.wallets[i].name) !== n) continue;
      if (!S.wallets[i].hidden) return S.wallets[i].id;
      if (!hid) hid = S.wallets[i].id;
    }
    return hid;
  }
  function firstWallet(S) {
    var w = S.wallets.filter(function (x) { return !x.hidden; }).sort(function (a, b) { return a.order - b.order; })[0];
    return w ? w.id : null;
  }
  function catKey(kind, name) { return kind + '|' + norm(name || NONAME_CAT); }
  // Названия из записей: категории по виду и кошельки, с числом операций и тем, что уже
  // есть в приложении (match). Пустая категория - «Без категории»; пустой кошелёк -
  // «не указан» (по умолчанию первый кошелёк приложения, если он есть).
  // Словари по именам из файла - без прототипа (dict): кошелёк «constructor» или «__proto__»
  // на обычном {} находил бы свойство Object и ломал план (Р17 ревью 15.10).
  function dict() { return Object.create(null); }
  function names(S, records) {
    var cats = dict(), wallets = dict(), catList = [], walList = [];
    records.forEach(function (r) {
      if (r.kind !== 'transfer') {
        var key = catKey(r.kind, r.cat);
        if (!cats[key]) {
          var nm = r.cat || NONAME_CAT;
          cats[key] = { key: key, kind: r.kind, name: nm, count: 0, match: findCatByName(S, r.kind, nm) };
          catList.push(cats[key]);
        }
        cats[key].count++;
      }
      [r.wallet, r.kind === 'transfer' ? r.to : null].forEach(function (w) {
        if (w == null) return;
        var k = norm(w);
        if (!wallets[k]) {
          wallets[k] = { key: k, name: w, count: 0, empty: !w, match: w ? findWalletByName(S, w) : firstWallet(S) };
          walList.push(wallets[k]);
        }
        wallets[k].count++;
      });
    });
    return { cats: catList, wallets: walList };
  }
  // Выбор по умолчанию: есть в приложении - туда, нет - создать новую.
  function defaultChoices(nm) {
    var ch = { cat: dict(), wallet: dict() };
    nm.cats.forEach(function (c) { ch.cat[c.key] = c.match || 'new'; });
    nm.wallets.forEach(function (w) { ch.wallet[w.key] = w.match || 'new'; });
    return ch;
  }

  // ---------- план ----------
  function endOfDay(date) {
    return new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 23, 59, 59, 999).getTime();
  }
  function cents(x) { return Math.round(x * 100); }
  function dupKey(kind, date, amount, catId, walletId, toId) {
    return kind + '|' + date + '|' + cents(amount) + '|' + (catId || '') + '|' + (walletId || '') + '|' + (toId || '');
  }
  // Что именно запишется. choices - из defaultChoices (и экрана выбора), значения:
  // id существующей категории/кошелька или 'new'. opts.now - «сейчас» (для ts), opts.keepDup -
  // не пропускать дубликаты. Возвращает {add, skipped, newCats, newWallets, over, stats}.
  //   add[i] = {date, kind, amount, catRef, walletRef, toRef, note, ts}; ref - id или 'new:<ключ>'
  //   over - null или {wallets, exp, inc}: на сколько вышли за потолки Полного доступа
  function plan(S, ex, nm, choices, opts) {
    opts = opts || {};
    var E = opts.Engine || (typeof Engine !== 'undefined' ? Engine : null);
    var now = opts.now || Date.now();
    var catByKey = dict(), walByKey = dict();
    nm.cats.forEach(function (c) {
      var v = choices.cat[c.key];
      catByKey[c.key] = (v && v !== 'new' && E.findCategory(S, v)) ? v : 'new:' + c.key;
    });
    nm.wallets.forEach(function (w) {
      var v = choices.wallet[w.key];
      walByKey[w.key] = (v && v !== 'new' && E.findWallet(S, v)) ? v : 'new:' + w.key;
    });
    var counts = dict();
    if (!opts.keepDup) S.tx.forEach(function (t) {
      var k = dupKey(t.kind, t.date, t.amount, t.kind === 'transfer' ? null : t.catId, t.walletId, t.kind === 'transfer' ? t.toWalletId : null);
      counts[k] = (counts[k] || 0) + 1;
    });
    var add = [], skipped = ex.skipped.slice(), stats = { exp: 0, inc: 0, transfer: 0, expSum: 0, incSum: 0, trSum: 0, from: null, to: null, frozen: 0, frozenWallets: [] };
    var frozenW = dict(), N = ex.records.length;
    ex.records.forEach(function (r, i) {
      var catRef = r.kind === 'transfer' ? null : catByKey[catKey(r.kind, r.cat)];
      var wRef = walByKey[norm(r.wallet)], tRef = r.kind === 'transfer' ? walByKey[norm(r.to)] : null;
      if (r.kind === 'transfer' && wRef === tRef) { skipped.push({ line: r.line, why: 'transfer' }); return; }
      var k = dupKey(r.kind, r.date, r.amount, catRef, wRef, tRef);
      if (counts[k] > 0) { counts[k]--; skipped.push({ line: r.line, why: 'dup' }); return; }
      // ts: конец дня операции, не позже «сейчас»; минус номер с конца - порядок файла
      // внутри дня сохраняется (лента сортирует день по ts)
      var ts = Math.min(endOfDay(r.date), now) - (N - i);
      var fz = [];
      [wRef, tRef].forEach(function (ref) {
        if (!ref || ref.indexOf('new:') === 0) return;
        var w = E.findWallet(S, ref);
        if (w && ts < w.baseTs) fz.push(w);
      });
      if (fz.length) {
        stats.frozen++;
        fz.forEach(function (w) { if (!frozenW[w.id]) { frozenW[w.id] = 1; stats.frozenWallets.push(w.name); } });
      }
      add.push({ line: r.line, date: r.date, kind: r.kind, amount: r.amount, catRef: catRef, walletRef: wRef, toRef: tRef, note: r.note, ts: ts });
      stats[r.kind]++;
      if (r.kind === 'exp') stats.expSum += r.amount;
      else if (r.kind === 'inc') stats.incSum += r.amount;
      else stats.trSum += r.amount;
      if (!stats.from || r.date < stats.from) stats.from = r.date;
      if (!stats.to || r.date > stats.to) stats.to = r.date;
    });
    stats.expSum = Math.round(stats.expSum * 100) / 100;
    stats.incSum = Math.round(stats.incSum * 100) / 100;
    stats.trSum = Math.round(stats.trSum * 100) / 100;
    // новые, на которые не пришлось ни одной операции (все строки - дубликаты), не создаём
    var usedRef = dict();
    add.forEach(function (a) { usedRef[a.catRef] = 1; usedRef[a.walletRef] = 1; if (a.toRef) usedRef[a.toRef] = 1; });
    var nc = { exp: [], inc: [] }, nw = [];
    nm.cats.forEach(function (c) { var ref = catByKey[c.key]; if (ref.indexOf('new:') === 0 && usedRef[ref]) nc[c.kind].push({ ref: ref, name: c.name }); });
    nm.wallets.forEach(function (w) { var ref = walByKey[w.key]; if (ref.indexOf('new:') === 0 && usedRef[ref]) nw.push({ ref: ref, name: w.empty ? NEW_WALLET : w.name }); });
    var H = E.HARD;
    var over = {
      wallets: Math.max(0, E.walletsActiveCount(S) + nw.length - H.wallets),
      exp: Math.max(0, E.expCatsActiveCount(S) + nc.exp.length - H.expCats),
      inc: Math.max(0, E.incCatsActiveCount(S) + nc.inc.length - H.incCats)
    };
    var why = {};
    skipped.forEach(function (s) { why[s.why] = (why[s.why] || 0) + 1; });
    return { add: add, skipped: skipped, why: why, newCats: nc, newWallets: nw,
      over: (over.wallets || over.exp || over.inc) ? over : null, stats: stats };
  }

  // ---------- запись ----------
  // Одним действием: новые категории и кошельки, затем операции с меткой партии t.imp.
  // Бросает Error('over'), если план выходит за потолки. Возвращает запись партии.
  var WALLET_PALETTE = ['blue', 'green', 'orange', 'purple', 'teal', 'pink', 'red', 'white', 'graphite', 'yellow'];
  var CAT_PALETTE = ['graphite', 'teal', 'blue', 'green', 'orange', 'purple', 'pink', 'red'];
  function apply(S, pl, meta, E) {
    E = E || (typeof Engine !== 'undefined' ? Engine : null);
    if (pl.over) throw new Error('over');
    meta = meta || {};
    var id = 'i' + (meta.now || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6);
    var ref = dict(), batch = { id: id, at: meta.now || Date.now(), name: String(meta.name || ''), count: 0, cats: [], wallets: [] };
    ['exp', 'inc'].forEach(function (kind) {
      pl.newCats[kind].forEach(function (c, i) {
        var cat = E.addCategory(S, kind, { name: c.name, icon: kind === 'inc' ? 'other' : 'dot', color: CAT_PALETTE[i % CAT_PALETTE.length] });
        ref[c.ref] = cat.id; batch.cats.push(cat.id);
      });
    });
    pl.newWallets.forEach(function (w, i) {
      var wal = E.addWallet(S, { name: w.name, icon: 'wallet', color: WALLET_PALETTE[i % WALLET_PALETTE.length], base: 0 });
      wal.baseTs = 0;   // баланс нового кошелька - вся история из файла с нуля
      ref[w.ref] = wal.id; batch.wallets.push(wal.id);
    });
    function r(x) { return x == null ? null : (ref[x] || x); }
    var seq = 0;
    pl.add.forEach(function (a) {
      var t = { id: id + '-' + (seq++).toString(36), kind: a.kind, amount: a.amount, date: a.date, ts: a.ts,
        catId: a.kind === 'transfer' ? null : r(a.catRef), walletId: r(a.walletRef),
        toWalletId: a.kind === 'transfer' ? r(a.toRef) : null, imp: id };
      var nt = E.cleanNote(a.note);   // К8 ревью 1.0.5: одно правило заметки с движком (одна строка, предел NOTE_KEEP)
      if (nt) t.note = nt;
      S.tx.push(t);
    });
    batch.count = pl.add.length;
    if (!Array.isArray(S.imports)) S.imports = [];
    S.imports.push(batch);
    if (S.imports.length > 20) S.imports = S.imports.slice(-20);
    return batch;
  }

  // Последняя партия, от которой в данных ещё что-то осталось (иначе отменять нечего).
  function lastBatch(S) {
    var list = S.imports || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var b = list[i], n = 0;
      S.tx.forEach(function (t) { if (t.imp === b.id) n++; });
      if (n) return { id: b.id, at: b.at, name: b.name, count: n };
      return null;   // отменяется только самая последняя партия
    }
    return null;
  }
  // Отмена партии: убираем ровно её операции (без пересчёта base: импорт base не трогал),
  // затем созданные ею категории и кошельки, если на них не осталось ни одной операции.
  // Ревью 14.10 №3: (а) операция партии, которую правили или удалили, когда она была
  // «замороженной» (до «Изменить баланс»), сдвинула base кошелька - сдвиги лежат в журнале
  // партии b.fz (Engine.keepImpShift, Р6 ревью 15.10: каждая правка своей записью). Сдвиг
  // возвращаем, баланс - как до загрузки; баланс задан после сдвига (w.baseTs > at) - заданный
  // баланс не трогаем. (б) кошелёк партии убираем, только если он пустой: нет
  // операций, баланс не задавали (base 0, нет правок баланса), не кредитка - как и обещает
  // окно «Отменить последнюю загрузку?».
  function undo(S, batchId, E) {
    E = E || (typeof Engine !== 'undefined' ? Engine : null);
    var b = null, list = S.imports || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === batchId) b = list[i];
    if (!b) return null;
    var before = S.tx.length;
    (Array.isArray(b.fz) ? b.fz : []).forEach(function (e) {
      var w = E.findWallet(S, e.w), dl = Number(e.dl);
      if (w && isFinite(dl) && !(w.baseTs > e.at)) w.base = Math.round((w.base - dl) * 100) / 100;
    });
    S.tx = S.tx.filter(function (t) { return t.imp !== batchId; });
    var removedTx = before - S.tx.length, used = {};
    S.tx.forEach(function (t) { if (t.catId) used[t.catId] = 1; if (t.walletId) used[t.walletId] = 1; if (t.toWalletId) used[t.toWalletId] = 1; });
    // 1.0.6 (ревью кода): на категорию или кошелёк уже настроен регулярный платёж - они нужны, не удаляем
    (S.categories.exp || []).forEach(function (c) { if (c.regular) { used[c.id] = 1; if (c.regular.walletId) used[c.regular.walletId] = 1; } });
    var rc = 0, rw = 0;
    b.cats.forEach(function (cid) {
      if (used[cid]) return;
      ['exp', 'inc'].forEach(function (kind) {
        var l = S.categories[kind];
        for (var j = l.length - 1; j >= 0; j--) if (l[j].id === cid) { l.splice(j, 1); rc++; }
        if (S.ui && S.ui.order && Array.isArray(S.ui.order[kind])) S.ui.order[kind] = S.ui.order[kind].filter(function (x) { return x !== cid; });
      });
      delete S.icons[cid];
      Object.keys(S.limits).forEach(function (ym) { if (S.limits[ym] && cid in S.limits[ym]) { delete S.limits[ym][cid]; if (!Object.keys(S.limits[ym]).length) delete S.limits[ym]; } });
    });
    b.wallets.forEach(function (wid) {
      var w = E.findWallet(S, wid);
      if (used[wid] || !w) return;
      if (w.base !== 0 || (Array.isArray(w.adj) && w.adj.length) || w.credit === true) return;
      E.deleteWallet(S, wid); rw++;
    });
    S.imports = list.filter(function (x) { return x.id !== batchId; });
    return { tx: removedTx, cats: rc, wallets: rw };
  }

  return { MAX_BYTES: MAX_BYTES, MAX_ROWS: MAX_ROWS, MAX_UNZIP: MAX_UNZIP, scanTags: scanTags, NONAME_CAT: NONAME_CAT, NEW_WALLET: NEW_WALLET,
    ROLES: ROLES, TEMPLATES: TEMPLATES,
    decode: decode, cp1251: cp1251, parseCSV: parseCSV, detectDelimiter: detectDelimiter, readXlsx: readXlsx, readFile: readFile,
    norm: norm, roleOf: roleOf, guessMapping: guessMapping, findHeader: findHeader, detectTemplate: detectTemplate,
    parseAmount: parseAmount, parseDate: parseDate, dateOrder: dateOrder, parseType: parseType, isRub: isRub,
    serialToDate: serialToDate, extract: extract, names: names, defaultChoices: defaultChoices, plan: plan,
    apply: apply, lastBatch: lastBatch, undo: undo, endOfDay: endOfDay };
});
