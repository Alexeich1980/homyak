/* import-bomb.test.js - злонамеренные .xlsx (ревью 1.0.4, advrev104/s2.js): разбор XML без
   квадратичного поиска (строки/ячейки/строки текста без закрывающих тегов) и потолок
   распаковки (zip-бомба) - вежливый отказ за доли секунды, а не зависание и не гигабайты. */
const test = require('node:test');
const assert = require('node:assert');
const fflate = require('../www/vendor/fflate.min.js');
const Import = require('../www/import.js');

const WB = '<workbook><sheets><sheet name="Операции" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
function book(sheetXml, extra) {
  const files = { 'xl/workbook.xml': fflate.strToU8(WB), 'xl/_rels/workbook.xml.rels': fflate.strToU8(RELS),
    'xl/worksheets/sheet1.xml': [fflate.strToU8(sheetXml), { level: 9 }] };
  Object.assign(files, extra || {});
  return fflate.zipSync(files);
}
function timed(fn) { const t0 = Date.now(); let r, err = null; try { r = fn(); } catch (e) { err = e; } return { r, err, ms: Date.now() - t0 }; }

test('xlsx: строки без </row> (s2.js regex) - линейно, меньше секунды', () => {
  const n = 20000;
  const x = timed(() => Import.readFile(book('<worksheet><sheetData>' + '<row r="1"><c r="A1"><v>1</v></c>'.repeat(n) + '</sheetData></worksheet>'), fflate));
  assert.ok(x.ms < 1000, 'разбор занял ' + x.ms + ' мс');
  assert.ok(!x.err, x.err && x.err.message);
  assert.strictEqual(x.r.rows.length, n);
});

test('xlsx: ячейки, строки текста и <t> без закрытия - тоже линейно', () => {
  const n = 40000;
  const cells = '<worksheet><sheetData><row r="1">' + '<c r="A1" t="inlineStr"><is><t>x'.repeat(n) + '</row></sheetData></worksheet>';
  const a = timed(() => Import.readFile(book(cells), fflate));
  assert.ok(a.ms < 1000, 'ячейки: ' + a.ms + ' мс');
  const ss = '<sst>' + '<si><t>a'.repeat(n) + '</sst>';
  const b = timed(() => Import.readFile(book('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    { 'xl/sharedStrings.xml': [fflate.strToU8(ss), { level: 9 }] }), fflate));
  assert.ok(b.ms < 1000, 'sharedStrings: ' + b.ms + ' мс');
  assert.ok(!b.err, b.err && b.err.message);
  const st = '<styleSheet>' + '<numFmt numFmtId="1" '.repeat(n) + '>' + '<cellXfs>' + '<xf numFmtId="14" '.repeat(n) + '</styleSheet>';
  const c = timed(() => Import.readFile(book('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
    { 'xl/styles.xml': [fflate.strToU8(st), { level: 9 }] }), fflate));
  assert.ok(c.ms < 1000, 'styles: ' + c.ms + ' мс');
  // номер строки «r=99999999» и столбец «XFD» не раздувают таблицу пустыми ячейками
  const d = timed(() => Import.readFile(book('<worksheet><sheetData><row r="99999999"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'), fflate));
  assert.strictEqual(d.err && d.err.message, 'rows');
  assert.ok(d.ms < 1000);
  const e = Import.readFile(book('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="XFD1"><v>2</v></c></row></sheetData></worksheet>'), fflate);
  assert.deepStrictEqual(e.rows[0], [1]);
});

test('xlsx: zip-бомба - вежливый отказ «unzip» до распаковки; чужие файлы книги не распаковываются', () => {
  const big = new Uint8Array(100 * 1024 * 1024);   // 100 МБ нулей сжимаются в ~100 КБ
  const z = book('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
    { 'xl/worksheets/sheet2.xml': [big, { level: 9 }] });
  assert.ok(z.length < Import.MAX_BYTES, 'файл проходит потолок 10 МБ - бомба настоящая');
  // заявленный размер проверяется ДО распаковки: 100 МБ части книги fflate даже не разжимает
  const seen = [];
  const spy = Object.assign({}, fflate, { unzipSync: (b, o) => fflate.unzipSync(b, { filter: (f) => { const r = o.filter(f); seen.push(f.name + ':' + r); return r; } }) });
  const x = timed(() => Import.readFile(z, spy));
  assert.strictEqual(x.err && x.err.message, 'unzip');
  assert.ok(seen.indexOf('xl/worksheets/sheet2.xml:false') >= 0, 'бомба распакована: ' + seen.join(', '));
  assert.ok(x.ms < 1000, 'отказ занял ' + x.ms + ' мс');
  assert.strictEqual(Import.MAX_UNZIP, 60 * 1024 * 1024);
  // .bin внутри книги (s2.js bomb) - не нужен разбору, даже не распаковывается
  // сборка zip (сжатие 100 МБ) - вне замера: меряем только чтение
  const zb = book('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>', { 'xl/a.bin': [big, { level: 9 }] });
  const y = timed(() => Import.readFile(zb, fflate));
  assert.ok(!y.err && y.r.rows.length === 1 && y.ms < 1000, 'чтение книги с .bin: ' + (y.err && y.err.message) + ' ' + y.ms + ' мс');
  // текст отказа для экрана есть
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'www', 'import-ui.js'), 'utf8'), /unzip: 'Таблица внутри файла слишком большая/);
});
