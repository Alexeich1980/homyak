/* import-ui.js - экраны загрузки операций из таблицы (1.0.4, только «Полный доступ»).
   «Копия данных» → «Таблица Excel» → «Загрузить из таблицы» → выбор файла (тем же способом, что
   «Восстановить из файла») → [сопоставление колонок, если формат не узнан] →
   [категории и кошельки, которых нет в приложении] → предпросмотр → запись.
   Разбор и запись - чистый import.js (window.Import); здесь только окна в гамме приложения
   (UI.openDlg), без нативных alert/confirm. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var TITLE = 'Загрузка из таблицы';
var SNAP_KEY = UI.KEY + '.preimport';   // копия данных перед последней загрузкой

var WHY = {
  dup: 'уже есть в «Хомяке»',
  fix: 'корректировка баланса - это не операция',
  debt: 'операции с долгами не загружаются',
  amount: 'пустая или нечитаемая сумма',
  date: 'не распознана дата',
  future: 'дата в будущем',
  currency: 'другая валюта - учёта валют в «Хомяке» нет',
  transfer: 'перевод без второго кошелька',
  big: 'сумма больше миллиарда',
  type: 'не распознан тип операции'
};
var WHY_ORDER = ['dup', 'fix', 'debt', 'currency', 'amount', 'date', 'future', 'transfer', 'type', 'big'];
var FAIL = {
  big: 'Файл больше 10 МБ - такой загрузить нельзя. Выгрузите из приложения период покороче.',
  rows: 'В файле больше 50 000 строк - такой загрузить нельзя. Выгрузите период покороче.',
  xls: 'Старый формат Excel (.xls) не читается. Откройте файл в Excel или Google Таблицах и сохраните как .xlsx или CSV.',
  xlsx: 'Файл не похож на таблицу Excel или повреждён. Подойдёт CSV или .xlsx.',
  unzip: 'Таблица внутри файла слишком большая (больше 60 МБ после распаковки) - такой загрузить нельзя. Выгрузите период покороче или сохраните как CSV.',
  empty: 'В файле нет строк с данными.',
  read: 'Файл не прочитался. Попробуйте ещё раз или выберите другой файл.'
};
var MORE_ROLES = ['expense', 'income', 'type', 'to', 'currency'];
var ROLE_UI = [
  ['date', 'Дата *'], ['amount', 'Сумма (минус - расход)'], ['cat', 'Категория'], ['wallet', 'Кошелёк'], ['note', 'Комментарий'],
  ['expense', 'Расход'], ['income', 'Доход'], ['type', 'Тип операции'], ['to', 'Кошелёк назначения (для переводов)'], ['currency', 'Валюта']
];

var cur = null;   // текущая загрузка: {name, info, rows, header, map, tpl, ex, nm, choices, pl}
// Р16 ревью 15.10: окно загрузки закрыли («Отмена», фон, назад) - загрузка забыта (cur = null,
// таблица файла не висит в памяти). Кнопки «Дальше»/«Загрузить» ставят goOn: следующий шаг
// откроет своё окно.
var goOn = false;
function onStepClose() { if (goOn) { goOn = false; return; } cur = null; }

function esc(s) { return UI.esc(s); }
function fmt(n) { return Engine.fmt(n); }
function plural(n, a, b, c) { return Engine.plural(n, a, b, c); }
function ops(n) { return fmt(n) + '\u00a0' + plural(n, 'операция', 'операции', 'операций'); }
function ruDate(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : ''; }
function full() { return !UI.hasFullAccess || !!UI.hasFullAccess(); }
function away(ms) {
  var r = (window.AppLock && window.AppLock.away) ? window.AppLock.away(ms) : null;
  return typeof r === 'function' ? r : function () {};
}

// ---------- вход ----------
var NO_IMPORT_NOW = 'Загрузить таблицу сейчас нельзя: данные приложения не прочитались.';
function pick() {
  if (!full()) { if (UI.paywall) UI.paywall(UI.openCopy); return; }
  if (UI.isReadOnly && UI.isReadOnly()) {
    if (UI.showProblem) UI.showProblem(NO_IMPORT_NOW); else UI.dlgAlert(NO_IMPORT_NOW, TITLE);
    return;
  }
  UI.closeDlg(); UI.closeMenu();
  var f = $('fileImport');
  f.value = '';
  away();
  f.click();
}
$('fileImport').addEventListener('change', function () {
  var file = this.files && this.files[0];
  if (!file) return;
  if (file.size > Import.MAX_BYTES) { UI.dlgAlert(FAIL.big, TITLE); return; }
  var fr = new FileReader();
  fr.onload = function () { fromBytes(new Uint8Array(fr.result), file.name); };
  fr.onerror = function () { UI.dlgAlert(FAIL.read, TITLE); };
  fr.readAsArrayBuffer(file);
});

// Байты файла → первый экран. Возвращает Promise (для self-test).
function fromBytes(bytes, name) {
  cur = null;
  var zip = bytes && bytes[0] === 0x50 && bytes[1] === 0x4B;
  var lib = zip ? (window.Backup && Backup.loadFflate ? Backup.loadFflate() : Promise.reject({ code: 'NO_LIB' })) : Promise.resolve(null);
  return lib.then(function (ff) {
    var t0 = Date.now(), info;
    try { info = Import.readFile(bytes, ff); }
    catch (e) { UI.dlgAlert(FAIL[e && e.message] || FAIL.read, TITLE); return null; }
    var header = Import.findHeader(info.rows);
    var tpl = Import.detectTemplate(info.rows[header]);
    cur = { name: String(name || ''), info: info, rows: info.rows, header: header, tpl: tpl,
      map: tpl ? tpl.map : Import.guessMapping(info.rows[header]), t0: t0 };
    if (tpl) return afterMap();
    showMap();
    return cur;
  }, function () { UI.dlgAlert(FAIL.xlsx, TITLE); return null; });
}

// ---------- экран сопоставления колонок ----------
function cellShort(v) {
  var s = v == null ? '' : String(v);
  return s.length > 22 ? s.slice(0, 21) + '…' : s;
}
function showMap(err) {
  var rows = cur.rows, h = cur.header, head = rows[h] || [];
  var w = 0;
  rows.slice(h, h + 4).forEach(function (r) { if (r.length > w) w = r.length; });
  var colName = function (i) { var t = head[i] == null ? '' : String(head[i]).trim(); return t ? t : 'Колонка ' + (i + 1); };
  var tbl = '<div class="imp-prev"><table><thead><tr>';
  for (var i = 0; i < w; i++) tbl += '<th>' + esc(cellShort(colName(i))) + '</th>';
  tbl += '</tr></thead><tbody>';
  rows.slice(h + 1, h + 4).forEach(function (r) {
    tbl += '<tr>';
    for (var j = 0; j < w; j++) tbl += '<td>' + esc(cellShort(r[j])) + '</td>';
    tbl += '</tr>';
  });
  tbl += '</tbody></table></div>';
  // список колонок - своё окно (picker.js), не системный список
  var colItems = [{ value: '-1', label: 'нет такой колонки' }];
  for (var k = 0; k < w; k++) colItems.push({ value: String(k), label: cellShort(colName(k)) });
  // Проход упрощения: на виду пять главных ролей, остальные (пара «Расход/Доход», тип,
  // перевод, валюта) - за кнопкой «Ещё колонки», если автоугадывание их не нашло.
  var more = MORE_ROLES.some(function (r) { return cur.map[r] != null; });
  var fields = ROLE_UI.map(function (p) {
    var sel = cur.map[p[0]];
    if (Array.isArray(sel)) sel = sel[0];
    var extra = MORE_ROLES.indexOf(p[0]) >= 0;
    return '<div class="imp-f' + (extra ? ' imp-more' : '') + '"' + (extra && !more ? ' hidden' : '') + '><span class="lbl">' + esc(p[1]) + '</span>' +
      Picker.listField({ attrs: 'data-role="' + p[0] + '"', items: colItems, value: sel == null ? '-1' : String(sel), title: p[1] }) + '</div>';
  }).join('') + (more ? '' : '<button type="button" class="btn ghost" id="impMore">Ещё колонки: расход и доход отдельно, тип, перевод, валюта</button>');
  UI.openDlg({ stickyBtns: true,
    title: 'Какая колонка что значит',
    body: '<div class="set-p">' + esc('Этот формат таблицы «Хомяк» не знает. ' +
      (Object.keys(cur.map).length ? 'Мы подобрали колонки по заголовкам - проверьте. ' : 'Укажите, в какой колонке что лежит. ') +
      'Нужны дата и сумма: одна колонка со знаком или две - «Расход» и «Доход».') + '</div>' +
      tbl + '<div class="imp-map">' + fields + '</div>' +
      '<div class="imp-err" id="impErr"' + (err ? '' : ' hidden') + '>' + esc(err || '') + '</div>',
    onOpen: function () {
      var b = $('impMore');
      if (b) b.addEventListener('click', function () {
        Array.prototype.forEach.call($('dlgBody').querySelectorAll('.imp-more'), function (x) { x.hidden = false; });
        b.parentNode.removeChild(b);
      });
    },
    buttons: [
      { label: 'Отмена', cls: 'nav' },
      { label: 'Дальше', cls: 'primary', onClick: function () {
        var map = {};
        Array.prototype.forEach.call($('dlgBody').querySelectorAll('.pk-f[data-role]'), function (s) {
          var v = +s.value;
          if (v >= 0) map[s.getAttribute('data-role')] = v;
        });
        var why = mapProblem(map);
        if (why) { var e = $('impErr'); e.textContent = why; e.hidden = false; return false; }
        cur.map = map;
        goOn = true;
        setTimeout(afterMap, 0);
      } }
    ],
    onClose: onStepClose
  });
}
function mapProblem(map) {
  if (map.date == null) return 'Выберите колонку с датой.';
  if (map.amount == null && map.expense == null && map.income == null) return 'Выберите колонку с суммой или колонки «Расход» и «Доход».';
  if (map.amount != null && (map.amount === map.expense || map.amount === map.income)) return 'Одна колонка выбрана и как «Сумма», и как «Расход» или «Доход». Оставьте что-то одно.';
  var ex = Import.extract(cur.rows, cur.header, map);
  if (!ex.records.length) return 'По этим колонкам не получилось прочитать ни одной операции. Проверьте дату и сумму.';
  cur.ex = ex; cur.exMap = map;   // afterMap не разбирает файл второй раз (Р16/Р20 ревью 15.10)
  return '';
}

// ---------- после сопоставления ----------
function afterMap() {
  if (!cur) return null;
  if (!cur.ex || cur.exMap !== cur.map) cur.ex = Import.extract(cur.rows, cur.header, cur.map, cur.tpl ? cur.tpl.opts : null);
  cur.nm = Import.names(UI.S, cur.ex.records);
  cur.choices = Import.defaultChoices(cur.nm);
  var unknown = cur.nm.cats.filter(function (c) { return !c.match; }).length + cur.nm.wallets.filter(function (w) { return !w.match; }).length;
  if (unknown) showNames(); else showPreview();
  return cur;
}

// ---------- экран «новые категории и кошельки» ----------
function namesRow(kind, it) {
  var list = kind === 'wallet' ? UI.S.wallets.filter(function (w) { return !w.hidden; }).sort(function (a, b) { return a.order - b.order; })
    : Engine.listCategories(UI.S, kind);
  var sel = kind === 'wallet' ? cur.choices.wallet[it.key] : cur.choices.cat[it.key];
  var items = [{ value: 'new', label: kind === 'wallet' ? 'Создать новый' : 'Создать новую' }];
  list.forEach(function (x) { items.push({ value: x.id, label: x.name }); });
  if (!items.some(function (x) { return x.value === sel; })) sel = 'new';
  var name = it.empty ? 'Кошелёк не указан' : it.name;
  return '<div class="imp-row"><div class="imp-n"><span class="imp-nm">' + esc(name) + '</span><span class="imp-c">' + ops(it.count) + '</span></div>' +
    Picker.listField({ attrs: 'data-k="' + (kind === 'wallet' ? 'w' : 'c') + '" data-key="' + esc(it.key) + '"', items: items, value: sel,
      title: kind === 'wallet' ? 'Куда отнести кошелёк' : 'Куда отнести категорию' }) + '</div>';
}
function showNames(err) {
  var groups = [['exp', 'Категории расходов'], ['inc', 'Категории доходов']].map(function (g) {
    var items = cur.nm.cats.filter(function (c) { return c.kind === g[0] && !c.match; });
    return items.length ? '<div class="imp-h">' + esc(g[1]) + '</div>' + items.map(function (c) { return namesRow(g[0], c); }).join('') : '';
  }).join('');
  var wl = cur.nm.wallets.filter(function (w) { return !w.match; });
  if (wl.length) groups += '<div class="imp-h">Кошельки</div>' + wl.map(function (w) { return namesRow('wallet', w); }).join('');
  UI.openDlg({ stickyBtns: true,
    title: 'Новые категории и кошельки',
    body: '<div class="set-p">' + esc('Таких названий в «Хомяке» ещё нет. По умолчанию они появятся как новые - или выберите, куда их отнести.') + '</div>' +
      groups + '<div class="imp-err" id="impErr"' + (err ? '' : ' hidden') + '>' + esc(err || '') + '</div>',
    buttons: [
      { label: 'Отмена', cls: 'nav' },
      { label: 'Дальше', cls: 'primary', onClick: function () {
        Array.prototype.forEach.call($('dlgBody').querySelectorAll('.pk-f[data-key]'), function (s) {
          var bag = s.getAttribute('data-k') === 'w' ? cur.choices.wallet : cur.choices.cat;
          bag[s.getAttribute('data-key')] = s.value;
        });
        var pl = makePlan();
        if (pl.over) { var e = $('impErr'); e.textContent = overText(pl.over); e.hidden = false; return false; }
        goOn = true;
        setTimeout(function () { showPreview(pl); }, 0);   // план уже посчитан - второй раз не считаем
      } }
    ],
    onClose: onStepClose
  });
}
function overText(o) {
  var p = [];
  if (o.wallets) p.push('кошельков на ' + fmt(o.wallets) + ' больше, чем помещается (до ' + Engine.HARD.wallets + ')');
  if (o.exp) p.push('категорий расходов на ' + fmt(o.exp) + ' больше, чем помещается (до ' + Engine.HARD.expCats + ')');
  if (o.inc) p.push('категорий доходов на ' + fmt(o.inc) + ' больше, чем помещается (до ' + Engine.HARD.incCats + ')');
  return 'Не помещается: ' + p.join('; ') + '. Отнесите часть названий к уже существующим.';
}
function makePlan() {
  cur.pl = Import.plan(UI.S, cur.ex, cur.nm, cur.choices, { Engine: Engine });
  return cur.pl;
}

// ---------- предпросмотр ----------
function showPreview(ready) {
  if (!cur) return;
  var pl = ready || makePlan();
  if (pl.over) { showNames(overText(pl.over)); return; }
  var s = pl.stats, n = pl.add.length, html = '';
  // названия чужих приложений на экране не показываем (решение 13.10): title - «выгрузка ...»
  var src = cur.tpl ? 'Формат распознан: ' + cur.tpl.title + '.' : 'Колонки выбраны вами.';
  html += '<div class="imp-src">' + esc((cur.name ? '«' + cur.name + '». ' : '') + src) + '</div>';
  if (n) {
    html += '<div class="imp-big">Добавится ' + esc(ops(n)) + '</div><div class="imp-sum">';
    var money = function (v) { return esc(fmt(v)) + '\u00a0₽'; };
    if (s.exp) html += '<div class="imp-line"><span>Расходы: ' + esc(fmt(s.exp)) + '</span><b class="neg">' + money(s.expSum) + '</b></div>';
    if (s.inc) html += '<div class="imp-line"><span>Доходы: ' + esc(fmt(s.inc)) + '</span><b class="pos">' + money(s.incSum) + '</b></div>';
    if (s.transfer) html += '<div class="imp-line"><span>Переводы: ' + esc(fmt(s.transfer)) + '</span><b>' + money(s.trSum) + '</b></div>';
    html += '<div class="imp-line"><span>Период</span><b>' + esc(s.from === s.to ? ruDate(s.from) : 'с ' + ruDate(s.from) + ' по ' + ruDate(s.to)) + '</b></div>';
    var nc = pl.newCats.exp.length + pl.newCats.inc.length, nw = pl.newWallets.length;
    if (nc || nw) {
      var parts = [];
      if (nc) parts.push(fmt(nc) + '\u00a0' + plural(nc, 'категория', 'категории', 'категорий'));
      if (nw) parts.push(fmt(nw) + '\u00a0' + plural(nw, 'кошелёк', 'кошелька', 'кошельков'));
      html += '<div class="imp-line"><span>Появятся</span><b>' + esc(parts.join(', ')) + '</b></div>';
    }
    html += '</div>';
    if (s.frozen) {
      html += '<div class="set-p imp-note">' + esc(ops(s.frozen) + ' - с датой раньше, чем вы задали баланс кошелька (' +
        s.frozenWallets.map(function (x) { return '«' + x + '»'; }).join(', ') +
        '). В истории и аналитике они будут, а баланс не изменят: он уже учтён.') + '</div>';
    }
    if (nw) html += '<div class="set-p imp-note">' + esc('Баланс новых кошельков сложится из операций файла. Если он не совпадёт с настоящим, поправьте его в карточке кошелька: «Изменить баланс».') + '</div>';
  } else {
    html += '<div class="imp-big">Добавлять нечего</div>';
  }
  var skip = pl.skipped.length;
  if (skip) {
    html += '<div class="imp-h">Пропущено ' + esc(fmt(skip) + '\u00a0' + plural(skip, 'строка', 'строки', 'строк')) + '</div><div class="imp-sum">';
    WHY_ORDER.forEach(function (k) {
      if (pl.why[k]) html += '<div class="imp-line"><span>' + esc(WHY[k]) + '</span><b>' + esc(fmt(pl.why[k])) + '</b></div>';
    });
    html += '</div>';
    if (pl.why.dup) html += '<div class="set-p imp-note">' + esc('Повторная загрузка того же файла ничего не задвоит: такие строки пропускаются.') + '</div>';
  }
  UI.openDlg({ stickyBtns: true,
    title: 'Проверьте перед загрузкой',
    body: '<div class="imp-pv" id="impPreview">' + html + '</div>',
    buttons: n ? [
      { label: 'Отмена', cls: 'nav' },
      { label: 'Загрузить', cls: 'primary', onClick: function () { goOn = true; setTimeout(commit, 0); } }
    ] : [{ label: 'Понятно', cls: 'primary' }],
    onClose: onStepClose
  });
}

// ---------- запись ----------
// Перед записью - копия всех данных во внутреннее хранилище (ключ UI.KEY + '.preimport'):
// путь назад, если запись оборвётся на середине. Живёт только на время записи (Р16 ревью
// 15.10: раньше оставалась навсегда и занимала второй объём данных) - после удачной записи и
// при ошибке убирается. Запись не легла (нет места) - UI.save() сам убирает копию и пробует
// ещё раз; снова нет - возвращаем всё как было.
function dropSnap() { try { localStorage.removeItem(SNAP_KEY); } catch (e) {} }
function commit() {
  var c = cur;
  cur = null;
  if (!c || !c.pl) return null;
  var before = JSON.stringify(UI.S), batch;
  try { localStorage.removeItem(SNAP_KEY); localStorage.setItem(SNAP_KEY, before); } catch (e) {}
  try { batch = Import.apply(UI.S, c.pl, { name: c.name }, Engine); }
  catch (e) {
    UI.S = Engine.migrate(JSON.parse(before));
    dropSnap();
    UI.dlgAlert(e && e.message === 'over' ? overText(c.pl.over) : 'Не удалось записать операции. Данные не изменились.', TITLE);
    return null;
  }
  if (!UI.save()) {
    UI.S = Engine.migrate(JSON.parse(before));
    dropSnap();
    UI.save(); UI.renderInstant();
    UI.dlgAlert('В памяти телефона не хватило места для этих операций. Данные остались как были.', TITLE);
    return null;
  }
  dropSnap();
  UI.renderInstant(); UI.haptic('medium');
  UI.toast('Загружено: ' + ops(batch.count), { action: 'Отменить', onAction: askUndo, ms: 8000 });
  return batch;
}

// ---------- отмена последней загрузки ----------
function last() { return Import.lastBatch(UI.S); }
function askUndo() {
  var b = last();
  if (!b) { UI.dlgAlert('Отменять нечего: операций последней загрузки уже нет.', TITLE); return; }
  UI.dlgConfirm({
    title: 'Отменить последнюю загрузку?',
    text: 'Уберём ' + ops(b.count) + (b.name ? ' из «' + b.name + '»' : '') + ' и созданные при этом пустые категории и кошельки. Остальные ваши операции не тронем.',
    danger: true, okLabel: 'Убрать',
    onOk: function () { doUndo(b.id); }
  });
}
function doUndo(id) {
  var r = Import.undo(UI.S, id, Engine);
  if (!r) return null;
  UI.save(); UI.renderInstant(); UI.haptic('medium');
  UI.toast('Загрузка отменена: убрано ' + ops(r.tx));
  return r;
}

window.ImportUI = { pick: pick, fromBytes: fromBytes, commit: commit, askUndo: askUndo, doUndo: doUndo, last: last,
  state: function () { return cur; }, SNAP_KEY: SNAP_KEY, WHY: WHY };
})();
