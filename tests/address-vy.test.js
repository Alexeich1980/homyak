/* address-vy.test.js - заслон: приложение обращается к человеку на «вы» (решение владельца 05.10.2026).

   Зачем: «Хомяк» платный, и обращение на «ты» к купившим его людям - неуважение. До 1.0.3
   почти все тексты были на «ты» («Сохрани копию», «Введи код», «твои данные»); их перевели,
   а этот тест не даёт «ты» вернуться с новой строкой.

   Что сканируем - только то, что видит пользователь:
     - www/*.js: строковые литералы ('', "", `` без ${...}); комментарии и регулярные выражения
       выбрасываем токенизатором, поэтому «ты» в комментарии для разработчика не мешает;
     - www/*.html: текст между тегами и видимые атрибуты (title, aria-label, placeholder, alt,
       value, content у meta description); <script> внутри HTML разбираем как JS;
     - CHANGELOG.md, раздел «## 1.0.3» (уходит в «Что нового» RuStore).
   Не сканируем: www/selftest.js (самопроверка для разработчика, ?selftest), www/vendor/,
   www/capacitor.js, www/icons.html и www/preview.html (служебные страницы, в приложении не открываются).

   Что считаем «ты»: местоимения ты/тебя/тебе/тобой/твой... ; глагол 2-го лица ед.ч. на -ешь/-ёшь/-ишь
   (хочешь, можешь, увидишь); частые повелительные без «-те» (сохрани, введи, нажми ... ); «забыл(а)».
   Границы слова - через lookbehind/lookahead по кириллице (\b в JS только ASCII). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const SKIP = new Set(['selftest.js', 'capacitor.js', 'icons.html', 'preview.html']);

// ---------- извлечение видимых строк ----------

// Токенизатор JS: отдаёт строковые литералы с номером строки. Комментарии и regex-литералы пропускает.
function jsStrings(src) {
  const out = [];
  let i = 0, line = 1, lastSig = '';   // lastSig - последний значимый символ кода (для отличия / regex от деления)
  const stack = [];                    // вложенность шаблонов: глубина фигурных скобок внутри ${...}
  const n = src.length;
  const isIdent = (c) => /[A-Za-z0-9_$Ѐ-ӿ]/.test(c);
  function readTemplate() {            // i указывает после открывающей ` (или после } закрытия ${...})
    let buf = '', start = line;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { buf += src[i + 1] || ''; i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { i++; out.push({ text: buf, line: start }); lastSig = '`'; return; }
      if (c === '$' && src[i + 1] === '{') { out.push({ text: buf, line: start }); i += 2; stack.push(0); lastSig = '{'; return; }
      buf += c; i++;
    }
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end; continue;
    }
    if (c === '"' || c === "'") {
      let buf = '', start = line; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { const d = src[i + 1]; buf += d === 'n' ? '\n' : (d === 'u' ? String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)) : d); i += d === 'u' ? 6 : 2; continue; }
        if (src[i] === '\n') break;
        buf += src[i]; i++;
      }
      i++; out.push({ text: buf, line: start }); lastSig = '"'; continue;
    }
    if (c === '`') { i++; readTemplate(); continue; }
    if (c === '/') {
      // regex, если перед ним не значение (идентификатор, число, ), ], строка)
      const prevWord = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, i - 20), i));
      const kw = prevWord && /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(prevWord[1]);
      const valueBefore = !kw && (isIdent(lastSig) || lastSig === ')' || lastSig === ']' || lastSig === '"' || lastSig === '`');
      if (!valueBefore) {
        i++; let inClass = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '\n') break;
          if (d === '[') inClass = true; else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { i++; break; }
          i++;
        }
        while (i < n && /[a-z]/.test(src[i])) i++;
        lastSig = ')'; continue;
      }
    }
    if (stack.length) {
      if (c === '{') stack[stack.length - 1]++;
      else if (c === '}') {
        if (stack[stack.length - 1] === 0) { stack.pop(); i++; readTemplate(); continue; }
        stack[stack.length - 1]--;
      }
    }
    lastSig = c; i++;
  }
  return out;
}

const VISIBLE_ATTR = /\b(?:title|aria-label|placeholder|alt|value|content|data-tip)\s*=\s*("([^"]*)"|'([^']*)')/g;

function htmlStrings(src) {
  const out = [];
  const lineAt = (pos) => src.slice(0, pos).split('\n').length;
  // скрипты - как JS
  src.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, body, pos) => {
    const base = lineAt(pos) - 1;
    for (const s of jsStrings(body)) out.push({ text: s.text, line: s.line + base });
    return m;
  });
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const clean = src
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  // атрибуты
  clean.replace(/<[a-zA-Z][^>]*>/g, (tag, pos) => {
    let m; VISIBLE_ATTR.lastIndex = 0;
    while ((m = VISIBLE_ATTR.exec(tag))) out.push({ text: m[2] != null ? m[2] : m[3], line: lineAt(pos) });
    return tag;
  });
  // текст между тегами
  clean.replace(/>([^<]+)</g, (m, text, pos) => { if (text.trim()) out.push({ text: text, line: lineAt(pos) }); return m; });
  return out;
}

function changelogSection(src, ver) {
  const start = src.indexOf('## ' + ver + '\n');
  if (start < 0) return null;
  const next = src.indexOf('\n## ', start + 3);
  const body = src.slice(start, next < 0 ? undefined : next);
  const base = src.slice(0, start).split('\n').length - 1;
  return body.split('\n').map((t, k) => ({ text: t, line: base + k + 1 }));
}

// ---------- признаки обращения на «ты» ----------

const L = 'а-яёА-ЯЁ';
const W = (body) => new RegExp('(?<![' + L + '])(?:' + body + ')(?![' + L + '])', 'gi');

const PRONOUN = W('ты|тебя|тебе|тобой|тобою|тво(?:й|я|ё|е|и|ю|его|ей|ему|им|ими|их|ём|ем)');
// 2-е лицо ед.ч. настоящего/будущего: хочешь, можешь, найдёшь, увидишь
const VERB2 = new RegExp('(?<![' + L + '])[' + L + ']{1,}(?:ешь|ёшь|ишь)(?:ся)?(?![' + L + '])', 'gi');
// частые повелительные ед.ч. (форма на «вы» оканчивается на -те и сюда не попадает)
const IMPERATIVES = [
  'сохрани', 'введи', 'нажми', 'жми', 'выбери', 'открой', 'закрой', 'проверь', 'добавь', 'укажи',
  'попробуй', 'восстанови', 'запиши', 'смахни', 'потяни', 'тяни', 'держи', 'удерживай', 'перетащи', 'тащи',
  'коснись', 'тапни', 'поставь', 'включи', 'выключи', 'задай', 'придумай', 'повтори', 'удали', 'обнови',
  'установи', 'переустанови', 'разреши', 'зайди', 'перейди', 'вернись', 'верни', 'подожди', 'не\\s+забудь',
  'загляни', 'посмотри', 'смотри', 'скачай', 'напиши', 'отметь', 'сдвинь', 'перенеси', 'переведи', 'начни',
  'создай', 'оставь', 'используй', 'пролистай', 'листай', 'отпусти', 'знай', 'помни', 'отмени', 'измени',
  'выведи', 'положи', 'назови', 'подтверди', 'приложи', 'разблокируй', 'заблокируй', 'вводи', 'купи',
  'оплати', 'обратись', 'свяжись', 'дай', 'возьми', 'расскажи', 'покажи', 'найди', 'пиши', 'жди',
  'проведи', 'перетяни', 'отправь', 'поделись', 'сделай', 'настрой', 'дождись', 'запусти', 'перезапусти',
  'зажми', 'тапай', 'листни', 'переключи', 'нажимай', 'выбирай', 'следи', 'войди', 'активируй', 'перетаскивай',
  'вставь', 'впиши', 'заведи', 'храни', 'оцени', 'узнай', 'контролируй', 'управляй', 'экономь', 'считай', 'трать', 'закрывай', 'смени', 'подключи', 'прочитай',
  // прошедшее время, мужской/женский род - так в 1.0.2 обращались к человеку («Спасибо, что поддержал»)
  'забыл', 'забыла', 'поддержал', 'поддержала', 'вошёл', 'вошла', 'покупал', 'покупала', 'вставил', 'вставила',
  'потратил', 'потратила', 'записал', 'записала', 'закрывал', 'закрывала', 'выбрал', 'выбрала'
];
const IMPER = W(IMPERATIVES.join('|'));

// Белый список: точные фразы, где совпадение - не обращение к человеку. Каждая с причиной.
const ALLOW = [
  // (пока пусто: при добавлении - фраза и почему это не «ты»)
];

function findTy(text) {
  const hits = [];
  for (const re of [PRONOUN, VERB2, IMPER]) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) hits.push(m[0]);
  }
  return hits;
}

function scanAll() {
  const found = [];
  for (const f of fs.readdirSync(WWW)) {
    if (SKIP.has(f) || !/\.(js|html)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(WWW, f), 'utf8');
    const strs = f.endsWith('.js') ? jsStrings(src) : htmlStrings(src);
    for (const s of strs) {
      if (!/[а-яё]/i.test(s.text)) continue;
      if (ALLOW.some((a) => s.text.indexOf(a.phrase) >= 0 && findTy(s.text.split(a.phrase).join(' ')).length === 0)) continue;
      const hits = findTy(s.text);
      if (hits.length) found.push(f + ':' + s.line + '  [' + hits.join(', ') + ']  ' + s.text.trim().slice(0, 140));
    }
  }
  const cl = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), '1.0.3') || [];
  for (const s of cl) {
    const hits = findTy(s.text);
    if (hits.length) found.push('CHANGELOG.md:' + s.line + '  [' + hits.join(', ') + ']  ' + s.text.trim().slice(0, 140));
  }
  return found;
}

module.exports = { jsStrings, htmlStrings, findTy, scanAll };

// node tests/address-vy.test.js --scan - только список находок, без тестов
if (process.argv.includes('--scan')) { console.log(scanAll().join('\n')); return; }

// ---------- тесты ----------

test('токенизатор: строки берёт, комментарии и regex - нет', () => {
  const s = jsStrings("// введи код\nvar a = 'Введите код'; /* сохрани */ var r = /сохрани/; var t = `Хомяк ${x ? 'ты' : 'вы'} есть`; var d = a / 2 / 3;");
  const texts = s.map((x) => x.text);
  assert.ok(texts.includes('Введите код'));
  assert.ok(texts.includes('ты') && texts.includes('вы'), 'строки внутри ${...} не извлеклись');
  assert.ok(texts.includes('Хомяк ') && texts.includes(' есть'));
  assert.ok(!texts.some((t) => /введи код|сохрани/.test(t)), 'комментарий или regex принят за строку');
});

test('признаки «ты» ловятся, «вы» - нет', () => {
  for (const t of ['Сохрани копию данных', 'Введи код', 'твои данные', 'Забыл код', 'если ты не закрывал', 'Хочешь вернуть?', 'Не забудь сохранить'])
    assert.ok(findTy(t).length, 'не пойман «ты»: ' + t);
  for (const t of ['Сохраните копию данных', 'Сохранить копию', 'Введите код', 'ваши данные', 'Забыли код?', 'Хотите вернуть?', 'тысяча', 'Тыква', 'Мышь', 'Настройки', 'Не забудьте сохранить'])
    assert.equal(findTy(t).length, 0, 'ложное срабатывание: ' + t);
});

test('CHANGELOG: раздел 1.0.3 найден (иначе тест молча ничего не проверяет)', () => {
  const cl = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), '1.0.3');
  assert.ok(cl && cl.length > 3);
});

test('видимые тексты www/ и CHANGELOG 1.0.3 - на «вы»', () => {
  const found = scanAll();
  assert.deepEqual(found, [], 'обращение на «ты» (переведите на «вы»):\n' + found.join('\n'));
});
