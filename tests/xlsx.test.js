/* xlsx.test.js - выгрузка операций в Excel (1.0.4, www/xlsx.js).
   Файл открывается как zip, каждый XML правильно составлен, каждая операция есть ровно
   один раз, суммы и даты верные, по таблице сходятся балансы кошельков, а итоги по месяцам
   совпадают со сводкой приложения (Engine.summary). Краевые случаи: пусто, перевод,
   корректировка баланса, кириллица и & < > " в текстах, копейки. */
const test = require('node:test'); const assert = require('node:assert');
const { unzipSync, strFromU8 } = require('fflate');
const fflate = require('fflate');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');
const Xlsx = require('../www/xlsx.js');

// ---------- разбор файла обратно (независимо от сборщика) ----------
const PARTS = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml'];

// Правильность XML: теги закрываются в обратном порядке, сущности только известные,
// в тексте нет голых < и управляющих символов.
function wellFormed(xml, name) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name + ': нет заголовка XML');
  const body = xml.replace(/^<\?xml[^?]*\?>/, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  let m, pos = 0;
  while ((m = re.exec(body))) {
    assert.strictEqual(m.index, pos, name + ': разрыв разбора у ' + body.slice(pos, pos + 40));
    pos = re.lastIndex;
    if (m[6]) assert.fail(name + ': голый < у ' + body.slice(m.index, m.index + 40));
    const txt = m[5] !== undefined ? m[5] : (m[3] || '');
    const amp = txt.replace(/&(amp|lt|gt|quot|apos);/g, '');
    assert.ok(amp.indexOf('&') < 0, name + ': голый & в «' + txt.slice(0, 60) + '»');
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(txt), name + ': управляющий символ');
    if (m[5] !== undefined) { assert.ok(stack.length, name + ': текст вне корня'); continue; }
    if (m[1]) assert.strictEqual(stack.pop(), m[2], name + ': не тот закрывающий тег ' + m[2]);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.strictEqual(pos, body.length, name + ': хвост не разобрался');
  assert.strictEqual(stack.length, 0, name + ': не закрыты ' + stack.join(','));
}
function unesc(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
// Лист → массив строк {A: {v, s, t}, ...}
function readSheet(xml) {
  const out = [];
  const rowRe = /<row r="(\d+)">([\s\S]*?)<\/row>/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const row = {};
    const cRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cRe.exec(r[2]))) {
      assert.strictEqual(c[2], r[1], 'ячейка не в своей строке');
      const attrs = c[3], inner = c[4] || '';
      const s = +((/ s="(\d+)"/.exec(attrs) || [])[1] || 0);
      if (/t="inlineStr"/.test(attrs)) row[c[1]] = { t: 's', v: unesc((/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner) || [])[1] || ''), s };
      else if (/<v>/.test(inner)) row[c[1]] = { t: 'n', v: Number(/<v>([^<]*)<\/v>/.exec(inner)[1]), s };
      else row[c[1]] = { t: 'e', v: '', s };
    }
    out.push({ r: +r[1], cells: row });
  }
  return out;
}
function open(S) {
  const bytes = Xlsx.build(S, Engine, fflate);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 500, 'файл пустой');
  assert.strictEqual(bytes[0], 0x50); assert.strictEqual(bytes[1], 0x4b);   // PK - zip
  const z = unzipSync(bytes);
  const files = {};
  PARTS.forEach((p) => { assert.ok(z[p], 'в архиве нет ' + p); files[p] = strFromU8(z[p]); wellFormed(files[p], p); });
  return files;
}
const S1 = Xlsx.HEAD_OPS, S2 = Xlsx.HEAD_MONTHS;
const txt = (row, k) => (row.cells[k] ? row.cells[k].v : '');
// Дата Excel → «ГГГГ-ММ-ДД» (независимый пересчёт, не Xlsx.excelDate)
function fromSerial(n) { return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); }

function sheets(S) {
  const f = open(S);
  const ops = readSheet(f['xl/worksheets/sheet1.xml']);
  const cats = readSheet(f['xl/worksheets/sheet2.xml']);
  const months = readSheet(f['xl/worksheets/sheet4.xml']);
  assert.deepStrictEqual(Object.keys(ops[0].cells).map((k) => ops[0].cells[k].v), S1, 'шапка листа 1');
  assert.deepStrictEqual(Object.keys(months[0].cells).map((k) => months[0].cells[k].v), S2, 'шапка листа 2');
  const wallets = checkWallets(S, f, ops.slice(1));   // лист «Кошельки» сверяется на любых данных
  return { f, ops: ops.slice(1), months: months.slice(1), cats, wallets };
}
function names(S) { const m = {}; S.wallets.forEach((w) => { m[w.id] = w.name; }); return m; }

// Каждая операция приложения - ровно одна строка с верными датой, типом, суммой, категорией, кошельками
function checkOps(S, ops) {
  const wn = names(S);
  const TYPE = { exp: 'Расход', inc: 'Доход', transfer: 'Перевод' };
  const used = new Set();
  const live = S.tx.filter((t) => t.amount > 0);
  live.forEach((t) => {
    // 1.0.4: платёж по долгу - свой тип, кошелёк и долг по направлению денег, сумма - весь платёж
    // (с 13.10 проценты - его часть, не расход); разбивка - в «Комментарии»
    if (t.kind === 'debt') {
      const d = Engine.findDebt(S, t.debtId), owed = d && d.type === 'owed', take = t.op === 'take';
      const type = owed ? (take ? 'Возврат долга' : 'Дано в долг') : (take ? 'Взято в долг' : 'Платёж по долгу');
      const from = take ? d.name : wn[t.walletId], to = take ? wn[t.walletId] : d.name;
      const h = ops.findIndex((o, i) => !used.has(i) && fromSerial(txt(o, 'A')) === t.date && txt(o, 'B') === type &&
        Math.abs(txt(o, 'C') - t.amount) < 1e-9 && txt(o, 'D') === '' && txt(o, 'E') === from && txt(o, 'F') === to);
      assert.ok(h >= 0, 'операции с долгом нет в таблице: ' + JSON.stringify(t));
      used.add(h);
      const note = String(txt(ops[h], 'G') || '');
      if (t.int > 0) {
        const m = /^в счёт долга ([\d ]+(?:,\d\d)?) ₽, проценты ([\d ]+(?:,\d\d)?) ₽$/.exec(note);
        assert.ok(m, 'нет разбивки платежа в комментарии: ' + note);
        const num = (x) => Number(x.replace(/ /g, '').replace(',', '.'));
        assert.strictEqual(num(m[2]), t.int, 'проценты в комментарии');
        assert.ok(Math.abs(num(m[1]) + num(m[2]) - t.amount) < 0.005, 'тело + проценты = сумма платежа');
      } else assert.strictEqual(note, '', 'у платежа без процентов комментария нет');
      return;
    }
    const cat = t.kind === 'transfer' ? '' : (Engine.findCategory(S, t.catId) || { cat: { name: '' } }).cat.name;
    const hit = ops.findIndex((o, i) => !used.has(i) &&
      fromSerial(txt(o, 'A')) === t.date && txt(o, 'B') === TYPE[t.kind] &&
      Math.abs(txt(o, 'C') - t.amount) < 1e-9 && txt(o, 'D') === cat &&
      txt(o, 'E') === (wn[t.walletId] || '') && txt(o, 'F') === (t.kind === 'transfer' ? wn[t.toWalletId] || '' : ''));
    assert.ok(hit >= 0, 'операции нет в таблице: ' + JSON.stringify(t));
    used.add(hit);
  });
  const extra = ops.filter((o, i) => !used.has(i));
  extra.forEach((o) => assert.strictEqual(txt(o, 'B'), 'Корректировка', 'лишняя строка: ' + JSON.stringify(o.cells)));
  // даты - настоящие даты Excel в формате ДД.ММ.ГГГГ (стиль 2), старые сверху
  ops.forEach((o, i) => {
    assert.strictEqual(o.cells.A.t, 'n'); assert.strictEqual(o.cells.A.s, 2);
    assert.strictEqual(o.cells.C.t, 'n');
    if (i) assert.ok(txt(ops[i - 1], 'A') <= txt(o, 'A'), 'сортировка по дате нарушена в строке ' + o.r);
  });
  return extra;
}
// По таблице сходятся балансы всех кошельков
function checkBalances(S, ops) {
  const by = {};
  S.wallets.forEach((w) => { by[w.name] = 0; });
  ops.forEach((o) => {
    const a = txt(o, 'C'), w = txt(o, 'E'), to = txt(o, 'F');
    switch (txt(o, 'B')) {
      case 'Доход': by[w] += a; break;
      case 'Расход': by[w] -= a; break;
      case 'Перевод': by[w] -= a; by[to] += a; break;
      case 'Корректировка': by[w] += a; break;
      case 'Платёж по долгу': case 'Дано в долг': by[w] -= a; break;      // кошелёк → долг
      case 'Взято в долг': case 'Возврат долга': by[to] += a; break;      // долг → кошелёк
      default: assert.fail('неизвестный тип ' + txt(o, 'B'));
    }
  });
  S.wallets.forEach((w) => {
    assert.strictEqual(Math.round(by[w.name] * 100) / 100, Engine.walletBalance(S, w.id), 'баланс кошелька «' + w.name + '» не сошёлся');
  });
}
// Итоги по месяцам = Engine.summary (сводка округляет до рубля - сравниваем округлённое),
// и они же = суммы строк листа 1 за месяц
function checkMonths(S, ops, months) {
  const yms = [...new Set(S.tx.filter((t) => t.amount > 0).map((t) => t.date.slice(0, 7)))].sort();
  assert.deepStrictEqual(months.map((m) => fromSerial(txt(m, 'A')).slice(0, 7)), yms, 'набор месяцев');
  months.forEach((m) => {
    const ym = fromSerial(txt(m, 'A')).slice(0, 7);
    assert.strictEqual(m.cells.A.s, 5, 'месяц не в формате «месяц год»');
    const sm = Engine.summary(S, ym);
    assert.strictEqual(Math.round(txt(m, 'B')), sm.earned, ym + ': доходы ≠ сводке');
    assert.strictEqual(Math.round(txt(m, 'C')), sm.spent, ym + ': расходы ≠ сводке');
    let inc = 0, exp = 0;
    ops.forEach((o) => {
      if (fromSerial(txt(o, 'A')).slice(0, 7) !== ym) return;
      if (txt(o, 'B') === 'Доход') inc += txt(o, 'C');
      if (txt(o, 'B') === 'Расход') exp += txt(o, 'C');
    });
    assert.strictEqual(txt(m, 'B'), Math.round(inc * 100) / 100, ym + ': доходы ≠ строкам листа 1');
    assert.strictEqual(txt(m, 'C'), Math.round(exp * 100) / 100, ym + ': расходы ≠ строкам листа 1');
    assert.strictEqual(txt(m, 'D'), Math.round((inc - exp) * 100) / 100, ym + ': разница');
  });
}

// Лист «По категориям» - сверка с листом «Операции», «Итогами по месяцам» и Engine.summary.
// Возвращает разобранный лист { yms, exp:[{name, v:{ym:сумма}, total}], inc, expSum, incSum, diff }.
const MON = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const r2 = (x) => Math.round(x * 100) / 100;
function colName(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function checkCats(S, f, ops, months) {
  const xml = f['xl/worksheets/sheet2.xml'];
  assert.match(xml, /<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/>/, 'не закреплены шапка и первая колонка');
  assert.ok(!/<f>/.test(xml), 'на листе формулы');
  const rows = readSheet(xml);
  // шапка: Статья | Лимит <последний месяц> | месяцы листа «Итоги» по порядку | Итого, жирная
  const yms = months.map((m) => fromSerial(txt(m, 'A')).slice(0, 7));
  const title = (ym) => MON[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);
  const lastYM = yms[yms.length - 1];
  const head = ['Статья', 'Лимит' + (lastYM ? ' ' + title(lastYM) : '')].concat(yms.map(title), ['Итого']);
  assert.strictEqual(rows[0].r, 1);
  assert.deepStrictEqual(head.map((h, i) => txt(rows[0], colName(i))), head, 'шапка листа «По категориям»');
  head.forEach((h, i) => assert.ok([1, 9].includes(rows[0].cells[colName(i)].s), 'шапка не жирная'));
  const nM = yms.length, TOT = colName(nM + 2);
  // ширина колонок задана на каждую колонку
  for (let i = 0; i < nM + 3; i++) assert.match(xml, new RegExp('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="\\d+(\\.\\d+)?" customWidth="1"/>'));
  // все числа - числа, стиль копеек по сумме; нулей нет (ноль = пустая ячейка), кроме явного лимита 0
  rows.slice(1).forEach((row) => Object.keys(row.cells).forEach((k) => {
    if (k === 'A') { assert.strictEqual(row.cells.A.t, 's'); return; }
    const c = row.cells[k];
    assert.strictEqual(c.t, 'n', 'не число в ' + k + row.r);
    if (k !== 'B') assert.notStrictEqual(c.v, 0, 'ноль в ' + k + row.r);
    const kop = Math.round(Math.abs(c.v) * 100) % 100 !== 0;
    assert.ok(kop ? [4, 8, 11, 13].includes(c.s) : [3, 7, 10, 12].includes(c.s), 'формат суммы ' + k + row.r);
  }));
  const val = (row, i) => txt(row, colName(i + 2)) || 0;
  const LEGEND = { 'красный - больше лимита': 14, 'жёлтый - близко к лимиту (от 80% до 100%)': 12 + 3 };
  // разбор блоков
  const out = { yms, exp: [], inc: [], expSum: null, incSum: null, diff: null, legend: [] };
  let cur = null;
  rows.slice(1).forEach((row) => {
    const a = txt(row, 'A');
    const v = {}; yms.forEach((ym, i) => { v[ym] = val(row, i); });
    const line = { name: a, v, total: txt(row, TOT) || 0, bold: row.cells.A.s === 6, row };
    if (a in LEGEND) {
      assert.ok(out.diff, 'легенда не внизу');
      assert.strictEqual(row.cells.A.s, LEGEND[a], 'легенда без цвета: ' + a);
      out.legend.push(row); return;
    }
    if (a === 'РАСХОДЫ') { cur = 'exp'; assert.ok(line.bold); assert.strictEqual(Object.keys(row.cells).length, 1); return; }
    if (a === 'ДОХОДЫ') { cur = 'inc'; assert.ok(line.bold); assert.strictEqual(Object.keys(row.cells).length, 1); return; }
    if (a === 'Всего расходов') { assert.strictEqual(cur, 'exp'); out.expSum = line; cur = null; }
    else if (a === 'Всего доходов') { assert.strictEqual(cur, 'inc'); out.incSum = line; cur = null; }
    else if (a === 'Разница') { assert.strictEqual(cur, null); out.diff = line; }
    else { assert.ok(cur, 'строка вне блока: ' + a); assert.ok(!line.bold, 'статья жирная: ' + a); out[cur].push(line); return; }
    assert.ok(line.bold, a + ' не жирная');
    Object.keys(row.cells).forEach((k) => { if (k !== 'A') assert.ok([7, 8].includes(row.cells[k].s), a + ': число не жирное'); });
  });
  // порядок: РАСХОДЫ выше ДОХОДЫ, Разница последней строкой
  if (out.expSum && out.incSum) assert.ok(out.expSum.row.r < out.incSum.row.r);
  if (out.expSum || out.incSum) assert.strictEqual(out.diff.row.r, rows[rows.length - 1 - out.legend.length].r, 'Разница не последняя');
  else assert.strictEqual(rows.length, 1, 'без доходов и расходов на листе одна шапка');
  // лимит и подсветка: независимо от xlsx.js - прямо из S.limits; правило приложения:
  // факт > лимита (в копейках) или лимит 0 при факте - красный, факт ≥ 80% лимита - жёлтый
  const limOf = (id, ym) => { const m = S.limits[ym]; return m && typeof m[id] === 'number' ? m[id] : null; };
  const catIdOf = (kind, name) => {
    const c = S.categories[kind].find((x) => x.name + (x.archived ? ' (архив)' : '') === name);
    return c ? c.id : null;
  };
  let anyLim = false;
  out.exp.forEach((l) => {
    const id = catIdOf('exp', l.name);
    const lim = id && lastYM ? limOf(id, lastYM) : null;
    assert.strictEqual(l.row.cells.B ? l.row.cells.B.v : null, lim, '«' + l.name + '»: лимит последнего месяца');
    if (lim !== null) anyLim = true;
    l.lvl = {};
    yms.forEach((ym, i) => {
      const lm = id ? limOf(id, ym) : null, fact = l.v[ym];
      let want = 'none';
      if (lm !== null && fact > 0) {
        if (lm <= 0 || Math.round(fact * 100) > Math.round(lm * 100)) want = 'over';
        else if (fact / lm >= 0.8) want = 'warn';
      }
      if (want !== 'none') anyLim = true;
      const cell = l.row.cells[colName(i + 2)];
      const got = !cell ? 'none' : [10, 11].includes(cell.s) ? 'over' : [12, 13].includes(cell.s) ? 'warn' : 'none';
      assert.strictEqual(got, want, '«' + l.name + '» ' + ym + ': подсветка (факт ' + fact + ', лимит ' + lm + ')');
      l.lvl[ym] = got;
    });
    const t = l.row.cells[TOT];
    assert.ok(!t || [3, 4].includes(t.s), 'Итого статьи подсвечено');
  });
  // у доходов и итоговых строк ни лимита, ни подсветки
  out.inc.concat([out.expSum, out.incSum, out.diff].filter(Boolean)).forEach((l) => {
    assert.ok(!l.row.cells.B, '«' + l.name + '»: лимит у дохода/итога');
    Object.keys(l.row.cells).forEach((k) => assert.ok(![10, 11, 12, 13].includes(l.row.cells[k].s), '«' + l.name + '»: подсветка у дохода/итога'));
  });
  assert.strictEqual(out.legend.length, anyLim ? 2 : 0, 'легенда: есть лимиты - две строки, нет - ни одной');
  // ожидаемый набор статей: у каждой хоть одна операция доход/расход за период
  ['exp', 'inc'].forEach((kind) => {
    const want = {};
    S.tx.filter((t) => t.kind === kind && t.amount > 0).forEach((t) => {
      const fc = Engine.findCategory(S, t.catId);
      const name = fc ? fc.cat.name + (fc.cat.archived ? ' (архив)' : '') : 'Без категории';
      want[name] = 1;
    });
    const list = out[kind];
    assert.deepStrictEqual(list.map((l) => l.name).sort(), Object.keys(want).sort(), kind + ': набор статей');
    assert.strictEqual(!!out[kind + 'Sum'], list.length > 0, kind + ': блок без статей / статьи без блока');
    // сортировка по итогу за период вниз
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].total >= list[i].total, kind + ': сортировка нарушена у «' + list[i].name + '»');
    // сумма статьи за месяц = сумма её строк листа «Операции»; Итого = сумма месяцев
    const type = kind === 'exp' ? 'Расход' : 'Доход';
    list.forEach((l) => {
      const plain = l.name.replace(/ \(архив\)$/, '').replace(/^Без категории$/, '');
      yms.forEach((ym) => {
        let s = 0;
        ops.forEach((o) => { if (txt(o, 'B') === type && txt(o, 'D') === plain && fromSerial(txt(o, 'A')).slice(0, 7) === ym) s += txt(o, 'C'); });
        assert.strictEqual(l.v[ym], r2(s), kind + ' «' + l.name + '» ' + ym + ' ≠ строкам «Операций»');
      });
      assert.strictEqual(l.total, r2(yms.reduce((a, ym) => a + l.v[ym], 0)), '«' + l.name + '»: Итого ≠ сумме месяцев');
      assert.ok(l.total > 0, 'статья без операций: ' + l.name);
    });
  });
  // «Всего…» = сумма статей = «Итоги по месяцам» = Engine.summary (до рубля); «Разница» = лист «Итоги»
  yms.forEach((ym, i) => {
    const m = months[i], sm = Engine.summary(S, ym);
    const e = out.expSum ? out.expSum.v[ym] : 0, n = out.incSum ? out.incSum.v[ym] : 0;
    assert.strictEqual(e, r2(out.exp.reduce((a, l) => a + l.v[ym], 0)), ym + ': Всего расходов ≠ сумме статей');
    assert.strictEqual(n, r2(out.inc.reduce((a, l) => a + l.v[ym], 0)), ym + ': Всего доходов ≠ сумме статей');
    assert.strictEqual(e, txt(m, 'C') || 0, ym + ': Всего расходов ≠ «Итогам по месяцам»');
    assert.strictEqual(n, txt(m, 'B') || 0, ym + ': Всего доходов ≠ «Итогам по месяцам»');
    assert.strictEqual(Math.round(e), sm.spent, ym + ': Всего расходов ≠ сводке');
    assert.strictEqual(Math.round(n), sm.earned, ym + ': Всего доходов ≠ сводке');
    if (out.diff) assert.strictEqual(out.diff.v[ym], txt(m, 'D') || 0, ym + ': Разница ≠ «Итогам по месяцам»');
  });
  if (out.diff) {
    const tot = (x) => (x ? x.total : 0);
    assert.strictEqual(out.diff.total, r2(tot(out.incSum) - tot(out.expSum)), 'Разница за период');
  }
  return out;
}

// Лист «Кошельки»: остаток на конец месяца = сумма строк листа «Операции» по кошельку
// (с корректировкой) до конца месяца; последний месяц = баланс в приложении; «Всего» -
// только видимые, = «В кошельках» (Engine.walletsTotal / summary.balance).
function ymAdd(ym) { let y = +ym.slice(0, 4), m = +ym.slice(5) + 1; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); }
function checkWallets(S, f, ops) {
  const xml = f['xl/worksheets/sheet3.xml'];
  assert.match(xml, /<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/>/, 'Кошельки: не закреплены шапка и колонка');
  const rows = readSheet(xml);
  const d = new Date(), nowYM = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const opYM = (o) => fromSerial(txt(o, 'A')).slice(0, 7);
  let lo = nowYM, hi = nowYM;
  ops.forEach((o) => { const k = opYM(o); if (k < lo) lo = k; if (k > hi) hi = k; });
  (S.debts || []).forEach((dd) => { const k = dd.createdDate.slice(0, 7); if (k < lo) lo = k; });
  const yms = []; for (let k = lo; k <= hi; k = ymAdd(k)) yms.push(k);
  const head = ['Кошелёк'].concat(yms.map((ym) => MON[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4) + (ym === nowYM ? ' (сегодня)' : '')));
  assert.deepStrictEqual(head.map((h, i) => txt(rows[0], colName(i))), head, 'шапка листа «Кошельки»');
  // движение по кошельку (по имени) из листа «Операции»
  const delta = (name, ym) => {
    let s = 0, any = false;
    ops.forEach((o) => {
      if (opYM(o) !== ym) return;
      const a = txt(o, 'C'), t = txt(o, 'B');
      const toDebt = t === 'Платёж по долгу' || t === 'Дано в долг', fromDebt = t === 'Взято в долг' || t === 'Возврат долга';
      if (fromDebt) { if (txt(o, 'F') === name) { any = true; s += a; } return; }
      if (txt(o, 'E') === name) { any = true; s += (t === 'Расход' || t === 'Перевод' || toDebt) ? -a : a; }
      if (t === 'Перевод' && txt(o, 'F') === name) { any = true; s += a; }
    });
    return { s, any };
  };
  const sorted = S.wallets.slice().sort((a, b) => a.order - b.order);
  const moved = (w) => ops.some((o) => txt(o, 'E') === w.name || txt(o, 'F') === w.name);
  const vis = sorted.filter((w) => !w.hidden), hid = sorted.filter((w) => w.hidden && moved(w));
  const body = rows.slice(1);
  const debtsSorted = (S.debts || []).slice().sort((a, b) => (!!a.archived !== !!b.archived) ? (a.archived ? 1 : -1) : a.order - b.order);
  const dName = (dd) => dd.name + (dd.type === 'owed' ? ' (мне должны' : ' (я должен') + (dd.archived ? ', погашен)' : ')');
  // 1.0.4: кредитка помечена «(кредитная карта)» после названия
  const cr = (w) => w.name + (w.credit === true ? ' (кредитная карта)' : '');
  const want = vis.map(cr).concat(['Всего'], hid.length ? ['Скрытые кошельки (во «Всего» не входят)'] : [], hid.map((w) => cr(w) + ' (скрыт)'),
    debtsSorted.length ? ['Долги (во «Всего» не входят)'].concat(debtsSorted.map(dName), ['Чистый капитал']) : []);
  assert.deepStrictEqual(body.map((r) => txt(r, 'A')), want, 'строки листа «Кошельки»');
  const out = { yms, nowYM, byName: {}, total: null };
  function checkRow(w, row) {
    let bal = 0, started = false;
    const v = {};
    yms.forEach((ym, i) => {
      const dl = delta(w.name, ym);
      if (dl.any) started = true;
      bal += dl.s;
      const c = row.cells[colName(i + 1)];
      if (!started) { assert.ok(!c, w.name + ' ' + ym + ': до первого движения должно быть пусто'); v[ym] = null; return; }
      assert.ok(c && c.t === 'n', w.name + ' ' + ym + ': нет числа');
      assert.strictEqual(c.v, r2(bal), w.name + ' ' + ym + ': остаток ≠ строкам «Операций»');
      assert.ok([3, 4].includes(c.s), w.name + ': стиль суммы');
      v[ym] = c.v;
    });
    const last = v[yms[yms.length - 1]];
    assert.strictEqual(last == null ? 0 : last, Engine.walletBalance(S, w.id), w.name + ': остаток на сегодня ≠ балансу в приложении');
    out.byName[w.name] = v;
  }
  vis.forEach((w, i) => checkRow(w, body[i]));
  hid.forEach((w, i) => checkRow(w, body[vis.length + 2 + i]));
  const tot = body[vis.length];
  assert.strictEqual(tot.cells.A.s, 6, '«Всего» не жирная');
  out.total = {};
  yms.forEach((ym, i) => {
    const c = tot.cells[colName(i + 1)];
    assert.ok(c && [7, 8].includes(c.s), 'Всего ' + ym + ': нет жирного числа');
    assert.strictEqual(c.v, r2(vis.reduce((a, w) => a + (out.byName[w.name][ym] || 0), 0)), 'Всего ' + ym + ' ≠ сумме видимых кошельков');
    out.total[ym] = c.v;
  });
  assert.strictEqual(out.total[nowYM], Engine.walletsTotal(S), '«Всего» на сегодня ≠ «В кошельках»');
  assert.strictEqual(Math.round(out.total[nowYM]), Engine.summary(S, nowYM).balance, '«Всего» ≠ сводке на главном');
  // 1.0.4: долги - остаток на конец месяца = Engine.debtBalanceAt, на сегодня = остатку в
  // приложении; «Чистый капитал» = Всего + мне должны - я должен = Engine.netCapital
  out.debts = {};
  if (debtsSorted.length) {
    const base = vis.length + 1 + (hid.length ? 1 + hid.length : 0) + 1;
    debtsSorted.forEach((dd, k) => {
      const row = body[base + k], v = {};
      yms.forEach((ym, i) => {
        const c = row.cells[colName(i + 1)], want = Engine.debtBalanceAt(S, dd.id, Engine.monthEnd(ym));
        if (want === null) { assert.ok(!c, dName(dd) + ' ' + ym + ': до заведения долга должно быть пусто'); v[ym] = null; return; }
        assert.ok(c && c.t === 'n', dName(dd) + ' ' + ym + ': нет числа');
        assert.strictEqual(c.v, want, dName(dd) + ' ' + ym);
        v[ym] = c.v;
      });
      assert.strictEqual(v[nowYM], Engine.debtBalance(S, dd.id), dName(dd) + ': остаток на сегодня ≠ приложению');
      out.debts[dName(dd)] = v;
    });
    const net = body[base + debtsSorted.length];
    assert.strictEqual(txt(net, 'A'), 'Чистый капитал');
    yms.forEach((ym, i) => {
      const c = net.cells[colName(i + 1)];
      assert.ok(c && [7, 8].includes(c.s), 'Чистый капитал ' + ym + ': нет жирного числа');
      assert.strictEqual(c.v, Engine.netCapital(S, ym).net, 'Чистый капитал ' + ym + ' ≠ Engine.netCapital');
    });
  }
  return out;
}

function fresh() {
  const S = Engine.defaultState();
  const card = Engine.addWallet(S, { name: 'Карта', base: 0 });
  const cash = Engine.addWallet(S, { name: 'Наличные', base: 0 });
  card.baseTs = 0; cash.baseTs = 0;
  const food = Engine.addCategory(S, 'exp', { name: 'Еда' });
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  return { S, card, cash, food, sal };
}

test('xlsx: имя файла и даты Excel', () => {
  assert.strictEqual(Xlsx.fileName(new Date(2026, 9, 5)), 'Хомяк-операции-2026-10-05.xlsx');
  assert.strictEqual(Xlsx.excelDate('1900-03-01'), 61);
  assert.strictEqual(Xlsx.excelDate('2024-01-01'), 45292);
  assert.strictEqual(fromSerial(Xlsx.excelDate('2026-09-07')), '2026-09-07');
});

test('xlsx: демо-данные - все операции, балансы, итоги = сводке', () => {
  const S = Engine.migrate(Seed.demoState(Engine, '2026-09-07'));
  assert.ok(S.tx.length >= 15 && S.tx.some((t) => t.kind === "transfer"));
  const { f, ops, months } = sheets(S);
  checkOps(S, ops);
  checkBalances(S, ops);
  checkMonths(S, ops, months);
  assert.ok(months.length >= 2);
  // шапка жирная (стиль 1), закреплена, автофильтр, ширины колонок
  const sh = f['xl/worksheets/sheet1.xml'];
  assert.match(sh, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sh, /<autoFilter ref="A1:G\d+"\/>/);
  assert.match(sh, /<col min="7" max="7" width="\d+" customWidth="1"\/>/);
  assert.match(f['xl/styles.xml'], /<font><b\/>/);
  assert.match(f['xl/styles.xml'], /formatCode="dd\\.mm\\.yyyy"/);
  // порядок листов: Операции, По категориям, Итоги по месяцам; каждый - на свой файл
  const wb = f['xl/workbook.xml'];
  assert.deepStrictEqual([...wb.matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="(rId\d)"\/>/g)].map((m) => m[1] + ':' + m[2]),
    ['Операции:rId1', 'По категориям:rId2', 'Кошельки:rId3', 'Итоги по месяцам:rId4']);
  const rels = f['xl/_rels/workbook.xml.rels'];
  ['1', '2', '3', '4'].forEach((n) => assert.match(rels, new RegExp('Id="rId' + n + '"[^>]*Target="worksheets/sheet' + n + '\\.xml"')));
  assert.match(f['[Content_Types].xml'], /sheet3\.xml/); assert.match(f['[Content_Types].xml'], /sheet4\.xml/);
  // фильтр «Итогов по месяцам» привязан к четвёртому листу (индекс 3)
  assert.match(wb, /localSheetId="3" hidden="1">'Итоги по месяцам'!/);
  const c = checkCats(S, f, ops, months);
  assert.ok(c.exp.length >= 5 && c.inc.length >= 2, 'в демо есть и расходы, и доходы');
});

test('xlsx: пустые данные - файл открывается, строк нет', () => {
  const S = Engine.migrate(Seed.presetState(Engine));
  assert.strictEqual(S.tx.length, 0);
  const { ops, months } = sheets(S);
  // кошельки пресета с нулём - корректировок нет
  checkBalances(S, ops);
  assert.strictEqual(months.length, 0);
  assert.ok(ops.every((o) => txt(o, 'B') === 'Корректировка'));
});

test('xlsx: перевод - одна строка, не доход и не расход', () => {
  const { S, card, cash, food, sal } = fresh();
  Engine.addTx(S, { kind: 'inc', amount: 50000, date: '2026-08-01', walletId: card.id, catId: sal.id });
  Engine.addTx(S, { kind: 'transfer', amount: 7000, date: '2026-08-02', walletId: card.id, toWalletId: cash.id });
  Engine.addTx(S, { kind: 'exp', amount: 1500, date: '2026-08-03', walletId: cash.id, catId: food.id });
  const { ops, months } = sheets(S);
  assert.strictEqual(ops.length, 3, 'лишние строки');
  const tr = ops.find((o) => txt(o, 'B') === 'Перевод');
  assert.strictEqual(txt(tr, 'E'), 'Карта'); assert.strictEqual(txt(tr, 'F'), 'Наличные'); assert.strictEqual(txt(tr, 'D'), '');
  checkOps(S, ops); checkBalances(S, ops); checkMonths(S, ops, months);
  assert.deepStrictEqual([txt(months[0], 'B'), txt(months[0], 'C'), txt(months[0], 'D')], [50000, 1500, 48500]);
});

// Р1 ревью 15.10: корректировки - остаток на начало одной строкой + каждая правка баланса своей
// строкой своей датой (раньше всё одной строкой датой правки - прошлые месяцы листа «Кошельки»
// уезжали на сумму сегодняшней правки)
test('xlsx: корректировка баланса - строка «Корректировка», балансы сходятся, в итоги не входит', () => {
  const { S, card, cash, food, sal } = fresh();
  card.base = 10000;   // стартовый остаток
  const a = Engine.addTx(S, { kind: 'exp', amount: 300, date: '2026-07-10', walletId: card.id, catId: food.id });
  const b = Engine.addTx(S, { kind: 'inc', amount: 2000, date: '2026-07-11', walletId: card.id, catId: sal.id });
  a.ts = 1000; b.ts = 2000;
  Engine.setWalletBase(S, card.id, 12345.67);   // «Изменить баланс»: обе операции заморожены
  const c = Engine.addTx(S, { kind: 'exp', amount: 45.5, date: '2026-08-01', walletId: card.id, catId: food.id });
  c.ts = card.baseTs + 1;
  Engine.addTx(S, { kind: 'transfer', amount: 100, date: '2026-08-02', walletId: card.id, toWalletId: cash.id }).ts = card.baseTs + 2;
  assert.strictEqual(Engine.walletBalance(S, card.id), 12345.67 - 45.5 - 100);
  const { ops, months } = sheets(S);
  const extra = checkOps(S, ops);
  assert.strictEqual(extra.length, 2, 'остаток на начало + правка баланса');
  assert.deepStrictEqual(extra.map((o) => [txt(o, 'E'), txt(o, 'C'), txt(o, 'G')]), [
    ['Карта', 10000, Xlsx.FIX_NOTE],
    ['Карта', Math.round((12345.67 - (10000 + 2000 - 300)) * 100) / 100, Xlsx.FIX_NOTE_ADJ]]);
  assert.strictEqual(fromSerial(txt(extra[1], 'A')), Engine.today(), 'правка - своей датой');
  checkBalances(S, ops);
  checkMonths(S, ops, months);
  checkCats(S, sheets(S).f, ops, months);
  const jul = months.find((m) => fromSerial(txt(m, 'A')) === '2026-07-01');
  assert.deepStrictEqual([txt(jul, 'B'), txt(jul, 'C')], [2000, 300], 'корректировка попала в доходы/расходы');
  // отрицательная корректировка (баланс ниже суммы операций)
  Engine.setWalletBase(S, cash.id, 0);
  cash.baseTs = card.baseTs + 10;   // перевод в «Наличные» случился раньше правки - заморожен
  const r = sheets(S);
  checkBalances(S, r.ops);
  assert.ok(r.ops.some((o) => txt(o, 'B') === 'Корректировка' && txt(o, 'E') === 'Наличные' && txt(o, 'C') === -100));
});

test('xlsx: кириллица и & < > " в названиях и комментариях, копейки', () => {
  const { S, card, cash, sal } = fresh();
  card.name = 'Карта «Мир» & <Сбер>';
  const odd = Engine.addCategory(S, 'exp', { name: 'Кафе "Ёлки" & <бар>' });
  const t = Engine.addTx(S, { kind: 'exp', amount: 1234.56, date: '2026-09-30', walletId: card.id, catId: odd.id });
  t.tags = ['#кафе&бар', '#<ужин>', '#"друзья"', '#\u0001мусор'];
  Engine.addTx(S, { kind: 'inc', amount: 0.01, date: '2026-09-01', walletId: cash.id, catId: sal.id });
  Engine.addTx(S, { kind: 'exp', amount: 999999999, date: '2026-09-02', walletId: card.id, catId: odd.id });
  const { f, ops, months } = sheets(S);
  checkOps(S, ops); checkBalances(S, ops); checkMonths(S, ops, months); checkCats(S, f, ops, months);
  const row = ops.find((o) => txt(o, 'C') === 1234.56);
  assert.strictEqual(txt(row, 'D'), 'Кафе "Ёлки" & <бар>');
  assert.strictEqual(txt(row, 'E'), 'Карта «Мир» & <Сбер>');
  assert.strictEqual(txt(row, 'G'), '#кафе&бар #<ужин> #"друзья" #мусор', 'управляющий символ не вычищен');
  assert.strictEqual(row.cells.C.s, 4, 'копейки - формат с двумя знаками');
  assert.strictEqual(ops.find((o) => txt(o, 'C') === 999999999).cells.C.s, 3, 'целое - формат без копеек');
  assert.strictEqual(ops.find((o) => txt(o, 'C') === 0.01).cells.C.s, 4);
  assert.ok(f['xl/worksheets/sheet1.xml'].indexOf('&amp;') > 0);
  // сентябрь: доходы 0,01, расходы 1 000 001 233,56
  assert.deepStrictEqual([txt(months[0], 'B'), txt(months[0], 'C')], [0.01, 1000001233.56]);
  assert.strictEqual(months[0].cells.B.s, 4); assert.strictEqual(months[0].cells.C.s, 4);
});

test('xlsx: копейки в сумме месяца не теряются (0,1 + 0,2)', () => {
  const { S, card, food } = fresh();
  Engine.addTx(S, { kind: 'exp', amount: 0.1, date: '2026-05-05', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'exp', amount: 0.2, date: '2026-05-06', walletId: card.id, catId: food.id });
  const { f, ops, months } = sheets(S);
  assert.strictEqual(txt(months[0], 'C'), 0.3);
  assert.strictEqual(checkCats(S, f, ops, months).expSum.v['2026-05'], 0.3);
  assert.strictEqual(txt(months[0], 'D'), -0.3);
  checkBalances(S, ops);
});

test('xlsx: скрытый кошелёк и архивная категория - тоже в таблице', () => {
  const { S, card, cash, food } = fresh();
  Engine.addTx(S, { kind: 'exp', amount: 700, date: '2026-04-04', walletId: cash.id, catId: food.id });
  cash.hidden = true;
  Engine.archiveCategory(S, food.id);
  Engine.addTx(S, { kind: 'exp', amount: 100, date: '2026-04-03', walletId: card.id, catId: food.id });
  const { f, ops, months } = sheets(S);
  checkOps(S, ops); checkBalances(S, ops); checkMonths(S, ops, months);
  assert.deepStrictEqual(checkCats(S, f, ops, months).exp.map((l) => l.name), ['Еда (архив)']);
  assert.ok(ops.every((o) => txt(o, 'D') === 'Еда'));
  assert.strictEqual(fromSerial(txt(ops[0], 'A')), '2026-04-03', 'старые сверху');
});

// ---------- лист «По категориям» ----------
test('xlsx: по категориям - блоки, сортировка, месяц без операций в статье, перевод и корректировка не входят', () => {
  const { S, card, cash, food, sal } = fresh();
  const cafe = Engine.addCategory(S, 'exp', { name: 'Кафе' });
  const rent = Engine.addCategory(S, 'exp', { name: 'Аренда' });
  Engine.addCategory(S, 'exp', { name: 'Пустая' });   // без операций - не показывается
  const side = Engine.addCategory(S, 'inc', { name: 'Подработка' });
  card.base = 5000;   // стартовый остаток - строка «Корректировка», в статьи не идёт
  Engine.addTx(S, { kind: 'exp', amount: 1000, date: '2026-07-05', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'exp', amount: 250.5, date: '2026-07-06', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'exp', amount: 30000, date: '2026-08-01', walletId: card.id, catId: rent.id });   // июля у «Аренды» нет
  Engine.addTx(S, { kind: 'exp', amount: 800, date: '2026-09-10', walletId: cash.id, catId: cafe.id });
  Engine.addTx(S, { kind: 'inc', amount: 90000, date: '2026-07-01', walletId: card.id, catId: sal.id });
  Engine.addTx(S, { kind: 'inc', amount: 90000, date: '2026-08-01', walletId: card.id, catId: sal.id });
  Engine.addTx(S, { kind: 'inc', amount: 5000.25, date: '2026-09-15', walletId: cash.id, catId: side.id });
  Engine.addTx(S, { kind: 'transfer', amount: 7777, date: '2026-09-01', walletId: card.id, toWalletId: cash.id });
  Engine.addTx(S, { kind: 'transfer', amount: 100, date: '2026-10-01', walletId: card.id, toWalletId: cash.id });   // месяц только с переводом
  const { f, ops, months } = sheets(S);
  checkOps(S, ops); checkBalances(S, ops); checkMonths(S, ops, months);
  assert.ok(ops.some((o) => txt(o, 'B') === 'Корректировка'), 'нет корректировки - тест не про неё');
  const c = checkCats(S, f, ops, months);
  assert.deepStrictEqual(c.yms, ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepStrictEqual(c.exp.map((l) => l.name), ['Аренда', 'Еда', 'Кафе'], 'расходы по итогу вниз');
  assert.deepStrictEqual(c.inc.map((l) => l.name), ['Зарплата', 'Подработка']);
  assert.ok(!c.exp[0].row.cells.C, 'месяц без операций в статье - пустая ячейка');
  assert.strictEqual(c.exp[1].total, 1250.5);
  assert.strictEqual(c.exp[1].row.cells.C.s, 4, 'копейки - формат с двумя знаками');
  assert.deepStrictEqual(c.yms.map((ym) => c.expSum.v[ym]), [1250.5, 30000, 800, 0]);
  assert.deepStrictEqual(c.yms.map((ym) => c.incSum.v[ym]), [90000, 90000, 5000.25, 0]);
  assert.deepStrictEqual(c.yms.map((ym) => c.diff.v[ym]), [88749.5, 60000, 4200.25, 0]);
  assert.strictEqual(c.diff.total, 152949.75);
  assert.ok(!/Пустая/.test(f['xl/worksheets/sheet2.xml']));
  // колонка октября (только перевод) ниже шапки целиком пустая
  readSheet(f['xl/worksheets/sheet2.xml']).slice(1).forEach((row) => assert.ok(!row.cells.F, 'в октябре что-то есть: строка ' + row.r));
  // одинаковый итог - порядок по названию, устойчиво
  const S2 = fresh();
  const b = Engine.addCategory(S2.S, 'exp', { name: 'Бэ' }), a = Engine.addCategory(S2.S, 'exp', { name: 'А' });
  Engine.addTx(S2.S, { kind: 'exp', amount: 10, date: '2026-01-01', walletId: S2.card.id, catId: b.id });
  Engine.addTx(S2.S, { kind: 'exp', amount: 10, date: '2026-01-02', walletId: S2.card.id, catId: a.id });
  const r = sheets(S2.S);
  assert.deepStrictEqual(checkCats(S2.S, r.f, r.ops, r.months).exp.map((l) => l.name), ['А', 'Бэ']);
});

test('xlsx: по категориям - архивная статья с операциями с пометкой «(архив)», статья без операций не видна', () => {
  const { S, card, food, sal } = fresh();
  const old = Engine.addCategory(S, 'exp', { name: 'Спортзал' });
  const oldInc = Engine.addCategory(S, 'inc', { name: 'Кэшбэк' });
  const gone = Engine.addCategory(S, 'exp', { name: 'Старьё' });
  Engine.addTx(S, { kind: 'exp', amount: 3000, date: '2026-06-01', walletId: card.id, catId: old.id });
  Engine.addTx(S, { kind: 'inc', amount: 150, date: '2026-06-02', walletId: card.id, catId: oldInc.id });
  Engine.addTx(S, { kind: 'exp', amount: 100, date: '2026-06-03', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'inc', amount: 1000, date: '2026-06-04', walletId: card.id, catId: sal.id });
  Engine.archiveCategory(S, old.id); Engine.archiveCategory(S, oldInc.id); Engine.archiveCategory(S, gone.id);
  const { f, ops, months } = sheets(S);
  const c = checkCats(S, f, ops, months);
  assert.deepStrictEqual(c.exp.map((l) => l.name), ['Спортзал (архив)', 'Еда']);
  assert.deepStrictEqual(c.inc.map((l) => l.name), ['Зарплата', 'Кэшбэк (архив)']);
  assert.ok(!/Старьё/.test(f['xl/worksheets/sheet2.xml']), 'архивная статья без операций попала в лист');
});

test('xlsx: по категориям - только расходы, только доходы, только переводы, пусто', () => {
  const onlyExp = fresh();
  Engine.addTx(onlyExp.S, { kind: 'exp', amount: 500, date: '2026-03-03', walletId: onlyExp.card.id, catId: onlyExp.food.id });
  let r = sheets(onlyExp.S);
  let c = checkCats(onlyExp.S, r.f, r.ops, r.months);
  assert.strictEqual(c.inc.length, 0); assert.strictEqual(c.incSum, null);
  assert.ok(!/ДОХОДЫ/.test(r.f['xl/worksheets/sheet2.xml']), 'пустой блок доходов');
  assert.strictEqual(c.diff.v['2026-03'], -500);

  const onlyInc = fresh();
  Engine.addTx(onlyInc.S, { kind: 'inc', amount: 700, date: '2026-03-03', walletId: onlyInc.card.id, catId: onlyInc.sal.id });
  r = sheets(onlyInc.S);
  c = checkCats(onlyInc.S, r.f, r.ops, r.months);
  assert.strictEqual(c.exp.length, 0); assert.strictEqual(c.expSum, null);
  assert.ok(!/РАСХОДЫ/.test(r.f['xl/worksheets/sheet2.xml']), 'пустой блок расходов');
  assert.strictEqual(c.diff.v['2026-03'], 700);

  const empty = Engine.migrate(Seed.presetState(Engine));
  r = sheets(empty);
  c = checkCats(empty, r.f, r.ops, r.months);
  assert.deepStrictEqual(c.yms, []);
  assert.strictEqual(readSheet(r.f['xl/worksheets/sheet2.xml']).length, 1, 'на пустых данных лишь шапка');

  const tr = fresh();
  Engine.addTx(tr.S, { kind: 'transfer', amount: 300, date: '2026-02-02', walletId: tr.card.id, toWalletId: tr.cash.id });
  r = sheets(tr.S);
  c = checkCats(tr.S, r.f, r.ops, r.months);
  assert.strictEqual(c.exp.length + c.inc.length, 0, 'перевод попал в статьи');
  assert.strictEqual(readSheet(r.f['xl/worksheets/sheet2.xml']).length, 1);
});

test('xlsx: по категориям - больше 26 колонок (буквы AA, AB…)', () => {
  assert.deepStrictEqual([0, 25, 26, 27, 51, 52, 701, 702].map(Xlsx.col), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  const { S, card, food, sal } = fresh();
  for (let i = 0; i < 30; i++) {
    const y = 2024 + Math.floor(i / 12), m = String(i % 12 + 1).padStart(2, '0');
    Engine.addTx(S, { kind: 'exp', amount: 100 + i, date: y + '-' + m + '-10', walletId: card.id, catId: food.id });
    if (i % 2) Engine.addTx(S, { kind: 'inc', amount: 1000, date: y + '-' + m + '-11', walletId: card.id, catId: sal.id });
  }
  const { f, ops, months } = sheets(S);
  const c = checkCats(S, f, ops, months);
  assert.strictEqual(c.yms.length, 30);
  assert.match(f['xl/worksheets/sheet2.xml'], /<dimension ref="A1:AG\d+"\/>/);
});

// ---------- лимиты на листе «По категориям» ----------
test('xlsx: лимиты - красный больше лимита, жёлтый близко, ровно 100% жёлтый, без лимита без цвета', () => {
  const { S, card, food, sal } = fresh();
  const cafe = Engine.addCategory(S, 'exp', { name: 'Кафе' });
  const car = Engine.addCategory(S, 'exp', { name: 'Машина' });
  const gift = Engine.addCategory(S, 'exp', { name: 'Подарки' });
  const zero = Engine.addCategory(S, 'exp', { name: 'Табак' });
  // август: Еда 10 000.01 при лимите 10 000 - красный (копейка сверх); Кафе ровно 5 000 из 5 000 - жёлтый;
  // Машина 3 999 из 5 000 (79,98%) - без цвета; Подарки без лимита; Табак при лимите 0 - красный
  Engine.setLimit(S, '2026-08', food.id, 10000); Engine.setLimit(S, '2026-08', cafe.id, 5000);
  Engine.setLimit(S, '2026-08', car.id, 5000); Engine.setLimit(S, '2026-08', zero.id, 0);
  Engine.setLimit(S, '2026-08', sal.id, 1);   // план дохода - на расходы не влияет, у дохода цвета нет
  Engine.addTx(S, { kind: 'exp', amount: 10000.01, date: '2026-08-02', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'exp', amount: 5000, date: '2026-08-03', walletId: card.id, catId: cafe.id });
  Engine.addTx(S, { kind: 'exp', amount: 3999, date: '2026-08-04', walletId: card.id, catId: car.id });
  Engine.addTx(S, { kind: 'exp', amount: 700, date: '2026-08-05', walletId: card.id, catId: gift.id });
  Engine.addTx(S, { kind: 'exp', amount: 50, date: '2026-08-06', walletId: card.id, catId: zero.id });
  Engine.addTx(S, { kind: 'inc', amount: 100000, date: '2026-08-01', walletId: card.id, catId: sal.id });
  // сентябрь: лимиты свои; Машина 4 000 из 5 000 (ровно 80%) - жёлтый; Еда 100 из 10 000 - без цвета
  Engine.setLimit(S, '2026-09', food.id, 10000); Engine.setLimit(S, '2026-09', car.id, 5000);
  Engine.addTx(S, { kind: 'exp', amount: 100, date: '2026-09-02', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'exp', amount: 4000, date: '2026-09-03', walletId: card.id, catId: car.id });
  Engine.addTx(S, { kind: 'exp', amount: 900, date: '2026-09-04', walletId: card.id, catId: cafe.id });   // в сентябре у Кафе лимита нет
  const { f, ops, months } = sheets(S);
  const c = checkCats(S, f, ops, months);
  const by = {}; c.exp.forEach((l) => { by[l.name] = l; });
  assert.deepStrictEqual([by['Еда'].lvl['2026-08'], by['Кафе'].lvl['2026-08'], by['Машина'].lvl['2026-08'], by['Подарки'].lvl['2026-08'], by['Табак'].lvl['2026-08']],
    ['over', 'warn', 'none', 'none', 'over']);
  assert.deepStrictEqual([by['Еда'].lvl['2026-09'], by['Машина'].lvl['2026-09'], by['Кафе'].lvl['2026-09']], ['none', 'warn', 'none']);
  // уровни - те же, что у кружков приложения (Engine.fill)
  c.exp.forEach((l) => c.yms.forEach((ym) => {
    const id = S.categories.exp.find((x) => x.name === l.name).id;
    const lv = Engine.fill(l.v[ym], Engine.catLimit(S, id, ym)).level;
    assert.strictEqual(l.lvl[ym], lv === 'over' || lv === 'warn' ? lv : 'none', l.name + ' ' + ym + ' ≠ Engine.fill');
  }));
  // колонка «Лимит» - лимит последнего месяца (сентябрь): у Кафе и Табака на сентябрь лимита нет
  assert.strictEqual(txt(rows0(f), 'B'), 'Лимит Сен 2026');
  assert.strictEqual(by['Еда'].row.cells.B.v, 10000);
  assert.ok(!by['Кафе'].row.cells.B && !by['Табак'].row.cells.B && !by['Подарки'].row.cells.B);
  // легенда внизу, цвета в styles.xml - светлые красный и жёлтый
  assert.deepStrictEqual(c.legend.map((r) => txt(r, 'A')), ['красный - больше лимита', 'жёлтый - близко к лимиту (от 80% до 100%)']);
  assert.match(f['xl/styles.xml'], /<fgColor rgb="FFFFC7CE"\/>/);
  assert.match(f['xl/styles.xml'], /<fgColor rgb="FFFFEB9C"\/>/);
  assert.ok(!/conditionalFormatting/.test(f['xl/worksheets/sheet2.xml']), 'подсветка должна быть стилем, не условным форматированием');
});
function rows0(f) { return readSheet(f['xl/worksheets/sheet2.xml'])[0]; }

test('xlsx: лимиты - нет ни одного лимита: нет легенды и колонка «Лимит» пустая', () => {
  const { S, card, food } = fresh();
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-08-02', walletId: card.id, catId: food.id });
  const { f, ops, months } = sheets(S);
  const c = checkCats(S, f, ops, months);
  assert.strictEqual(c.legend.length, 0);
  assert.ok(!c.exp[0].row.cells.B);
});

// ---------- лист «Кошельки» ----------
test('xlsx: кошельки - остатки по месяцам, перевод, месяц без операций, скрытый кошелёк, корректировка', () => {
  const { S, card, cash, food, sal } = fresh();
  const save = Engine.addWallet(S, { name: 'Копилка', base: 0 }); save.baseTs = 0;
  const old = Engine.addWallet(S, { name: 'Старая карта', base: 0 }); old.baseTs = 0;
  Engine.addWallet(S, { name: 'Пустой скрытый', base: 0 }).hidden = true;
  Engine.addTx(S, { kind: 'inc', amount: 80000, date: '2026-06-05', walletId: card.id, catId: sal.id });
  Engine.addTx(S, { kind: 'exp', amount: 1200.5, date: '2026-06-10', walletId: card.id, catId: food.id });
  Engine.addTx(S, { kind: 'transfer', amount: 20000, date: '2026-06-20', walletId: card.id, toWalletId: save.id });
  // июль - ни одной операции: остаток тянется с июня
  Engine.addTx(S, { kind: 'transfer', amount: 3000, date: '2026-08-01', walletId: card.id, toWalletId: cash.id });
  Engine.addTx(S, { kind: 'exp', amount: 500, date: '2026-08-02', walletId: cash.id, catId: food.id });
  Engine.addTx(S, { kind: 'inc', amount: 1000, date: '2026-06-01', walletId: old.id, catId: sal.id });
  old.hidden = true;   // скрытый с движениями - ниже «Всего», в «Всего» не входит
  const { wallets: w } = sheets(S);
  assert.deepStrictEqual(w.yms.slice(0, 4), ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepStrictEqual(['2026-06', '2026-07', '2026-08'].map((ym) => w.byName['Карта'][ym]), [58799.5, 58799.5, 55799.5]);
  assert.deepStrictEqual(['2026-06', '2026-07', '2026-08'].map((ym) => w.byName['Наличные'][ym]), [null, null, 2500]);
  assert.deepStrictEqual(['2026-06', '2026-07', '2026-08'].map((ym) => w.byName['Копилка'][ym]), [20000, 20000, 20000]);
  assert.strictEqual(w.byName['Старая карта']['2026-06'], 1000);
  assert.deepStrictEqual(['2026-06', '2026-07', '2026-08'].map((ym) => w.total[ym]), [78799.5, 78799.5, 78299.5], 'Всего без скрытого кошелька');
  assert.ok(!('Пустой скрытый' in w.byName));

  // правка баланса: корректировка встаёт датой правки (сегодня) - остаток сегодня = новому балансу
  Engine.setWalletBase(S, card.id, 60000);
  const r = sheets(S);
  assert.strictEqual(r.wallets.byName['Карта'][r.wallets.nowYM], 60000);
  assert.strictEqual(r.wallets.byName['Карта']['2026-08'], 55799.5, 'прошлые месяцы правка не трогает');
  assert.strictEqual(r.wallets.total[r.wallets.nowYM], Engine.walletsTotal(S));
});

test('xlsx: кошельки - пустые данные и стартовый остаток', () => {
  const S = Engine.migrate(Seed.presetState(Engine));
  const { wallets: w } = sheets(S);
  assert.deepStrictEqual(w.yms, [w.nowYM], 'без операций - один текущий месяц');
  const { S: S2, card } = fresh();
  card.base = 15000; card.baseTs = new Date(2026, 4, 20).getTime();   // остаток с 20 мая
  const { wallets: w2 } = sheets(S2);
  assert.strictEqual(w2.yms[0], '2026-05');
  assert.strictEqual(w2.byName['Карта']['2026-05'], 15000);
  assert.strictEqual(w2.total[w2.nowYM], 15000);
  // кошелёк заведён сегодня с остатком 5 000, траты внесены задним числом (июль): точка
  // отсчёта стоит перед ними - корректировка датой самой ранней операции, остаток не в минусе
  const { S: S3, card: c3, food } = fresh();
  c3.base = 5000; c3.baseTs = Date.now() - 1000;
  Engine.addTx(S3, { kind: 'exp', amount: 3000, date: '2026-07-15', walletId: c3.id, catId: food.id });
  const r3 = sheets(S3);
  const fix = r3.ops.find((o) => txt(o, 'B') === 'Корректировка');
  // остаток на начало - первым днём таблицы (Р1 ревью 15.10: приложение считает его с начала)
  assert.strictEqual(fromSerial(txt(fix, 'A')), '2026-07-01', 'корректировка не встала в начало таблицы');
  assert.strictEqual(txt(fix, 'C'), 5000);
  assert.strictEqual(r3.wallets.byName['Карта']['2026-07'], 2000, 'остаток июля');
});

// 1.0.4: долги - платёж целиком «Платёж по долгу» (с 13.10 проценты - его часть, не расход),
// взятие/одолжил/вернули, балансы кошельков сходятся, итоги по месяцам = сводке, блок
// «Долги» и «Чистый капитал» на листе «Кошельки»
test('xlsx: долги - платежи в «Операциях» целиком, проценты в комментарии, блок долгов и чистый капитал', () => {
  const { S, card, cash, sal } = fresh();
  card.base = 300000;
  Engine.addTx(S, { kind: 'inc', amount: 120000, date: '2026-07-05', walletId: card.id, catId: sal.id });
  const d = Engine.addDebt(S, { type: 'owe', name: 'Ипотека', amount: 1000000, pay: 30000, day: 15, rate: 12, date: '2026-07-01', now: 0 });
  const o = Engine.addDebt(S, { type: 'owed', name: 'Саша & Ко', amount: 5000, date: '2026-08-01', now: 0 });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 30000, date: '2026-07-15' });
  Engine.payDebt(S, { debtId: d.id, walletId: card.id, amount: 10000, date: '2026-07-20' });   // досрочка
  Engine.takeDebt(S, { debtId: d.id, walletId: cash.id, amount: 2500.5, date: '2026-08-02' });
  Engine.payDebt(S, { debtId: o.id, walletId: cash.id, amount: 1000, date: '2026-08-03' });
  Engine.takeDebt(S, { debtId: o.id, walletId: card.id, amount: 6000, date: '2026-08-10' });
  Engine.archiveDebt(S, o.id);
  const { f, ops, months, wallets } = sheets(S);
  checkOps(S, ops); checkBalances(S, ops); checkMonths(S, ops, months);
  checkCats(S, f, ops, months);
  const types = ops.map((x) => txt(x, 'B'));
  assert.strictEqual(types.filter((t) => t === 'Платёж по долгу').length, 2);
  assert.ok(types.includes('Взято в долг') && types.includes('Дано в долг') && types.includes('Возврат долга'));
  const pay = ops.find((x) => txt(x, 'B') === 'Платёж по долгу');
  assert.deepStrictEqual([txt(pay, 'C'), txt(pay, 'E'), txt(pay, 'F'), txt(pay, 'G')],
    [30000, 'Карта', 'Ипотека', 'в счёт долга 20 000 ₽, проценты 10 000 ₽']);
  assert.ok(!ops.some((x) => txt(x, 'D') === 'Проценты по долгам'), 'расхода «Проценты по долгам» нет');
  assert.ok(f['xl/worksheets/sheet2.xml'].indexOf('Проценты по долгам') < 0, 'и статьи такой нет');
  const jul = months.find((m) => fromSerial(txt(m, 'A')) === '2026-07-01');
  assert.deepStrictEqual([txt(jul, 'B'), txt(jul, 'C') || 0], [120000, 0], 'платёж по долгу (и проценты) в расходы не входит');
  assert.ok(wallets.debts['Ипотека (я должен)'], 'нет строки долга');
  assert.ok(wallets.debts['Саша & Ко (мне должны, погашен)'], 'нет строки погашенного долга');
  assert.strictEqual(wallets.debts['Ипотека (я должен)']['2026-07'], 970000);
});

// 1.0.4 кредитная карта (отметка у кошелька): на листе «Кошельки» помечена «(кредитная
// карта)», её минус - внутри «Всего» (как «В кошельках» на главном), отдельно не вычитается
test('xlsx: кредитка помечена на листе «Кошельки», минус внутри «Всего»', () => {
  const { S, card, cash, food } = fresh();
  card.base = 50000;
  const cc = Engine.addWallet(S, { name: 'Кредитка', base: 0 });
  cc.baseTs = 0;
  Engine.setWalletCredit(S, cc.id, { credit: true, payDay: 5, remind: true }, '2026-06-01');
  Engine.addTx(S, { kind: 'exp', amount: 12000, date: '2026-07-03', walletId: cc.id, catId: food.id });
  Engine.addTx(S, { kind: 'transfer', amount: 5000, date: '2026-07-04', walletId: card.id, toWalletId: cc.id });
  const { f, wallets } = sheets(S);
  assert.ok(f['xl/worksheets/sheet3.xml'].indexOf('Кредитка (кредитная карта)') > 0, 'нет пометки');
  assert.strictEqual(wallets.byName['Кредитка']['2026-07'], -7000);
  assert.strictEqual(wallets.total[wallets.nowYM], Engine.walletsTotal(S), '«Всего» = «В кошельках»');
  assert.ok(f['xl/worksheets/sheet3.xml'].indexOf('Карта (кредитная карта)') < 0 && cash, 'обычный кошелёк без пометки');
});
