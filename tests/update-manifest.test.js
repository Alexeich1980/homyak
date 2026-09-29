const test = require('node:test');
const assert = require('node:assert/strict');
const Update = require('../www/update.js');

test('cmpVer: сравнение по числам, а не по строке', () => {
  assert.equal(Update.cmpVer('0.3.0', '0.2.0'), 1);
  assert.equal(Update.cmpVer('0.2.0', '0.3.0'), -1);
  assert.equal(Update.cmpVer('0.2.0', '0.2.0'), 0);
  // строковое сравнение соврало бы: «0.10.0» < «0.9.0»
  assert.equal(Update.cmpVer('0.10.0', '0.9.9'), 1);
  assert.equal(Update.cmpVer('1.0.0', '0.99.99'), 1);
  // недостающие части — нули
  assert.equal(Update.cmpVer('0.3', '0.3.0'), 0);
  assert.equal(Update.cmpVer('0.3.1', '0.3'), 1);
  // мусор не должен объявлять «есть обновление»
  assert.equal(Update.cmpVer('', '0.2.0'), -1);
  assert.equal(Update.cmpVer('ерунда', '0.2.0'), -1);
  assert.equal(Update.cmpVer(null, undefined), 0);
});

test('isVer', () => {
  ['0', '0.2', '0.2.0', '10.20.30'].forEach(v => assert.equal(Update.isVer(v), true, v));
  ['', 'v0.2.0', '0.2.0.1', '0.2.x', 'ерунда', null].forEach(v => assert.equal(Update.isVer(v), false, String(v)));
});

const SHA = 'a'.repeat(64);

const WEB = {
  version: '0.3.1',
  url: 'https://dorokhin-finance.ru/homyak/www-0.3.1.zip',
  sha256: SHA,
  size: 520000,
  minShell: '0.3.0'
};

const GOOD = {
  version: '0.3.0',
  apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-0.3.0.apk',
  size: 3120000,
  notes: 'что нового',
  web: WEB
};

test('parseManifest: правильный манифест разбирается с обоими каналами', () => {
  const m = Update.parseManifest(GOOD);
  assert.deepEqual(m, {
    version: '0.3.0',
    apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-0.3.0.apk',
    size: 3120000,
    notes: 'что нового',
    web: {
      version: '0.3.1',
      url: 'https://dorokhin-finance.ru/homyak/www-0.3.1.zip',
      sha256: SHA,
      size: 520000,
      minShell: '0.3.0'
    }
  });
});

test('parseManifest: старый манифест без «web» жив как был', () => {
  const old = { version: '0.3.0', apkUrl: GOOD.apkUrl, size: 100, notes: 'а' };
  const m = Update.parseManifest(old);
  assert.equal(m.version, '0.3.0');
  assert.equal(m.web, null);
});

test('parseManifest: размер и заметки необязательны', () => {
  const m = Update.parseManifest({ version: '0.3.0', apkUrl: GOOD.apkUrl });
  assert.equal(m.size, 0);
  assert.equal(m.notes, '');
  assert.equal(Update.parseManifest({ ...GOOD, size: -5 }).size, 0);
  assert.equal(Update.parseManifest({ ...GOOD, size: 'много' }).size, 0);
  assert.equal(Update.parseManifest({ ...GOOD, notes: 42 }).notes, '');
});

test('parseManifest: мусор отвергается', () => {
  [null, undefined, 'строка', 42, [], {}].forEach(o =>
    assert.equal(Update.parseManifest(o), null, JSON.stringify(o)));
  assert.equal(Update.parseManifest({ ...GOOD, version: 'ерунда' }), null, 'версия');
  assert.equal(Update.parseManifest({ ...GOOD, apkUrl: '' }), null, 'пустой адрес');
});

test('parseManifest: APK только со своего домена и только https', () => {
  const bad = [
    'http://dorokhin-finance.ru/homyak/homyak-0.3.0.apk',      // не https
    'https://dorokhin-finance.ru/homyak/homyak-0.3.0.zip',     // не apk
    'https://evil.example.com/homyak-0.3.0.apk',               // чужой домен
    'https://dorokhin-finance.ru.evil.com/x.apk',              // домен-двойник
    '/homyak/homyak-0.3.0.apk'                                 // без схемы
  ];
  bad.forEach(u => assert.equal(Update.parseManifest({ ...GOOD, apkUrl: u }), null, u));
  // поддомен своего сайта — можно
  assert.ok(Update.parseManifest({ ...GOOD, apkUrl: 'https://cdn.dorokhin-finance.ru/homyak/a.apk' }));
});

// ---------- раздел web ----------

test('parseWeb: правильный раздел разбирается, minShell по умолчанию 0', () => {
  assert.deepEqual(Update.parseWeb(WEB), WEB);
  const noMin = Update.parseWeb({ ...WEB, minShell: undefined });
  assert.equal(noMin.minShell, '0');
  // регистр хеша не важен, наружу отдаём в нижнем
  assert.equal(Update.parseWeb({ ...WEB, sha256: SHA.toUpperCase() }).sha256, SHA);
});

test('parseWeb: плохой раздел выбрасывается целиком, APK-канал живёт дальше', () => {
  const bad = [
    { ...WEB, version: 'ерунда' },
    { ...WEB, url: 'http://dorokhin-finance.ru/homyak/www.zip' },        // не https
    { ...WEB, url: 'https://evil.example.com/www.zip' },                 // чужой домен
    { ...WEB, url: 'https://dorokhin-finance.ru/homyak/www.apk' },       // не zip
    { ...WEB, sha256: 'коротко' },
    { ...WEB, sha256: 'z'.repeat(64) },                                  // не hex
    { ...WEB, sha256: undefined },
    { ...WEB, size: 99 * 1024 * 1024 },                                  // больше потолка
    null, 'строка', 42, []
  ];
  bad.forEach((o, i) => assert.equal(Update.parseWeb(o), null, 'случай ' + i));

  // манифест с испорченным web остаётся годным: apk-поля целы, web = null
  const m = Update.parseManifest({ ...GOOD, web: { ...WEB, sha256: 'нет' } });
  assert.ok(m);
  assert.equal(m.web, null);
  assert.equal(m.apkUrl, GOOD.apkUrl);
});

// ---------- решение «что делать» ----------

test('decide: веб-сборка новее и оболочка подходит → бесшовное обновление', () => {
  const m = Update.parseManifest(GOOD);
  const d = Update.decide(m, '0.3.0', '0.3.0');
  assert.equal(d.kind, 'ota');
  assert.equal(d.version, '0.3.1');
  assert.equal(d.web.url, WEB.url);
  assert.equal(d.notes, 'что нового');
});

test('decide: minShell выше нашей оболочки → APK-канал', () => {
  const m = Update.parseManifest({
    ...GOOD,
    version: '0.4.0',
    apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-0.4.0.apk',
    web: { ...WEB, version: '0.4.1', minShell: '0.4.0' }
  });
  const d = Update.decide(m, '0.3.0', '0.3.0');
  assert.equal(d.kind, 'apk');
  assert.equal(d.version, '0.4.0');
  assert.equal(d.apkUrl, 'https://dorokhin-finance.ru/homyak/homyak-0.4.0.apk');
});

test('decide: оболочка новее, веб — та же → APK-канал', () => {
  const m = Update.parseManifest({
    ...GOOD,
    version: '0.4.0',
    apkUrl: 'https://dorokhin-finance.ru/homyak/homyak-0.4.0.apk',
    web: { ...WEB, version: '0.3.0', minShell: '0.3.0' }
  });
  assert.equal(Update.decide(m, '0.3.0', '0.3.0').kind, 'apk');
});

test('decide: ничего нового → none', () => {
  const m = Update.parseManifest({ ...GOOD, web: { ...WEB, version: '0.3.0' } });
  assert.equal(Update.decide(m, '0.3.0', '0.3.0').kind, 'none');
  // веб-сборка уже стоит, а оболочка отстала от манифеста — это APK
  assert.equal(Update.decide(m, '0.3.0', '0.2.9').kind, 'apk');
});

test('decide: манифест не разобрался → error', () => {
  assert.equal(Update.decide(null, '0.3.0', '0.3.0').kind, 'error');
  assert.equal(Update.decide(Update.parseManifest('мусор'), '0.3.0', '0.3.0').kind, 'error');
});

test('decide: обновлённая веб-сборка поверх старой оболочки (minShell позволяет)', () => {
  // так и выглядит обычная жизнь: APK 0.3.0 стоит месяцами, web едет вперёд
  const m = Update.parseManifest({
    ...GOOD,
    version: '0.3.0',
    web: { ...WEB, version: '0.3.7', minShell: '0.3.0' }
  });
  const d = Update.decide(m, '0.3.4', '0.3.0');
  assert.equal(d.kind, 'ota');
  assert.equal(d.version, '0.3.7');
});

// ---------- сторовая сборка: только номер оболочки, только RuStore ----------

test('decideStore: оболочка на канале новее → store, web-раздел не учитывается', () => {
  // web новее и minShell подходит — не-сторовая сборка пошла бы за OTA, стор — нет
  const m = Update.parseManifest({ ...GOOD, version: '0.3.1', web: { ...WEB, version: '0.3.5' } });
  const d = Update.decideStore(m, '0.3.0');
  assert.equal(d.kind, 'store');
  assert.equal(d.version, '0.3.1');
  assert.equal(d.web, undefined, 'стор не должен отдавать web наружу');
  assert.equal(d.apkUrl, undefined, 'стор не должен отдавать apkUrl наружу');
});

test('decideStore: оболочка та же, а web новее → none (OTA в сторе не бывает)', () => {
  const m = Update.parseManifest({ ...GOOD, web: { ...WEB, version: '0.3.9', minShell: '0.3.0' } });
  assert.equal(Update.decideStore(m, '0.3.0').kind, 'none');
  // для сравнения: обычная сборка тут предложила бы бесшовное
  assert.equal(Update.decide(m, '0.3.0', '0.3.0').kind, 'ota');
});

test('decideStore: оболочка новее канала или равна → none', () => {
  const m = Update.parseManifest(GOOD);
  assert.equal(Update.decideStore(m, '0.3.0').kind, 'none');
  assert.equal(Update.decideStore(m, '0.4.0').kind, 'none');
});

test('decideStore: оболочка неизвестна → none, не выдумываем', () => {
  const m = Update.parseManifest(GOOD);
  assert.equal(Update.decideStore(m, null).kind, 'none');
  assert.equal(Update.decideStore(m, '').kind, 'none');
});

test('decideStore: манифест не разобрался → error', () => {
  assert.equal(Update.decideStore(null, '0.3.0').kind, 'error');
});

test('URL_RUSTORE: страница приложения в RuStore, https', () => {
  assert.match(Update.URL_RUSTORE, /^https:\/\/www\.rustore\.ru\/catalog\/app\/ru\.dorokhin\.homyak$/);
});

// ---------- хеш ----------

test('sameHash: сверка без оглядки на регистр и пробелы, пустое не проходит', () => {
  assert.equal(Update.sameHash(SHA, SHA.toUpperCase()), true);
  assert.equal(Update.sameHash('  ' + SHA + ' ', SHA), true);
  assert.equal(Update.sameHash(SHA, 'b'.repeat(64)), false);
  assert.equal(Update.sameHash('', SHA), false);
  assert.equal(Update.sameHash(SHA, ''), false);
  assert.equal(Update.sameHash(null, null), false);
});

test('hex: байты в строку, как их печатает sha256sum', () => {
  const crypto = require('node:crypto');
  const data = Buffer.from('хомяк', 'utf8');
  const want = crypto.createHash('sha256').update(data).digest('hex');
  const got = Update.hex(crypto.createHash('sha256').update(data).digest());
  assert.equal(got, want);
  assert.equal(Update.hex(new Uint8Array([0, 1, 15, 16, 255])), '00010f10ff');
});

// ---------- безопасность путей из архива ----------

test('safeName: «..», абсолютные пути и схемы отвергаются', () => {
  const bad = [
    '../evil.js', 'a/../../evil.js', '/etc/passwd', 'C:/windows/x.js', 'c:\\x.js',
    '..\\evil.js', 'a\\b.js', 'file:///etc/passwd', 'https://evil.com/x.js',
    './x.js', 'a//b.js', '', null, undefined, 'a/./b.js', 'a/', 'x\u0000.js', 'a/../b'
  ];
  bad.forEach(n => assert.equal(Update.safeName(n), null, JSON.stringify(n)));
});

test('safeName: нормальные имена сборки проходят как есть', () => {
  ['index.html', 'ui.js', 'fonts/manrope-cyrillic-600.woff2', 'vendor/fflate.min.js',
   'hamster.png', 'files.json', '.complete'].forEach(n =>
    assert.equal(Update.safeName(n), n, n));
});

// ---------- распаковка ----------

test('unpack: архив с «..» в имени не распаковывается целиком', () => {
  const fake = { unzipSync: () => ({ 'index.html': new Uint8Array([1]), '../evil.js': new Uint8Array([2]) }) };
  assert.throws(() => Update.unpack(new Uint8Array(), fake), e => e.message === Update.ERR.zip);
});

test('unpack: архив без index.html — не сборка', () => {
  const fake = { unzipSync: () => ({ 'ui.js': new Uint8Array([1]) }) };
  assert.throws(() => Update.unpack(new Uint8Array(), fake), e => e.message === Update.ERR.zip);
});

test('unpack: пустой архив и битый архив — понятная ошибка', () => {
  assert.throws(() => Update.unpack(new Uint8Array(), { unzipSync: () => ({}) }),
    e => e.message === Update.ERR.zip);
  assert.throws(() => Update.unpack(new Uint8Array(), { unzipSync: () => { throw new Error('crc'); } }),
    e => e.message === Update.ERR.zip);
});

test('unpack: папки в архиве пропускаются, файлы остаются', () => {
  const fake = { unzipSync: () => ({
    'fonts/': new Uint8Array(),
    'index.html': new Uint8Array([1, 2]),
    'fonts/a.woff2': new Uint8Array([3])
  }) };
  const out = Update.unpack(new Uint8Array(), fake);
  assert.deepEqual(Object.keys(out).sort(), ['fonts/a.woff2', 'index.html']);
});

// ---------- сеть ----------

test('fetchManifest: сеть, сервер и непонятный ответ различаются', async () => {
  const ok = (body, status = 200) => () =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) });

  const m = await Update.fetchManifest({ fetch: ok(JSON.stringify(GOOD)) });
  assert.equal(m.version, '0.3.0');
  assert.equal(m.web.version, '0.3.1');

  await assert.rejects(
    Update.fetchManifest({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) }),
    e => e.message === Update.ERR.net);

  await assert.rejects(
    Update.fetchManifest({ fetch: ok('', 502) }),
    e => e.message === Update.ERR.server);

  await assert.rejects(
    Update.fetchManifest({ fetch: ok('не json') }),
    e => e.message === Update.ERR.bad);

  await assert.rejects(
    Update.fetchManifest({ fetch: ok(JSON.stringify({ version: '0.3.0', apkUrl: 'https://evil.com/x.apk' })) }),
    e => e.message === Update.ERR.bad);
});

test('fetchManifest: молчащий сервер отваливается по часам', async () => {
  await assert.rejects(
    Update.fetchManifest({ timeout: 60, fetch: () => new Promise(() => {}) }),
    e => e.message === Update.ERR.server);
});

test('fetchBundle: подложенный архив с чужим хешем не проходит', async () => {
  const crypto = require('node:crypto');
  const body = Buffer.from('это не тот архив');
  const buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  const real = crypto.createHash('sha256').update(body).digest('hex');
  const subtle = { digest: (_a, b) => Promise.resolve(crypto.createHash('sha256').update(Buffer.from(b)).digest()) };
  const fetchOk = () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(buf) });

  // хеш сошёлся — байты отдаются наружу
  const bytes = await Update.fetchBundle({ ...WEB, sha256: real }, { fetch: fetchOk, subtle });
  assert.equal(bytes.length, body.length);

  // хеш не сошёлся — честная ошибка и ни байта на диск
  await assert.rejects(
    Update.fetchBundle({ ...WEB, sha256: 'b'.repeat(64) }, { fetch: fetchOk, subtle }),
    e => e.message === Update.ERR.hash);
});

test('fetchBundle: слишком большой файл и мёртвый сервер', async () => {
  const big = new ArrayBuffer(Update.MAX_ZIP + 1);
  await assert.rejects(
    Update.fetchBundle(WEB, { fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(big) }) }),
    e => e.message === Update.ERR.big);

  await assert.rejects(
    Update.fetchBundle(WEB, { fetch: () => Promise.resolve({ ok: false, status: 500 }) }),
    e => e.message === Update.ERR.server);

  await assert.rejects(
    Update.fetchBundle(WEB, { fetch: () => Promise.reject(new TypeError('Failed to fetch')) }),
    e => e.message === Update.ERR.net);
});
