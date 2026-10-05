/* release-1.0.test.js — заслоны боевого релиза 1.0.0 в RuStore.
   1) console_app_id: одна команда вшивает id в ОБА места (pay-config.js + strings.xml),
      заглушка детектится (КАНДИДАТ), рассинхрон ловится; самопроверка APK.
   2) Адверсариальное ревью стор-сборки: mock-оплата не выбирается на телефоне, ре-проверка
      владения не отбирает Pro ложно и снимает при возврате, стор не подменяет код
      (update.apply, boot.js, MainActivity), reel/demo не просачиваются через адрес,
      deeplink RuStore Pay настроен, клиент SDK берётся getInstance (провайдер уже создал).
   3) Пейволл: без ссылок/контактов, строки RuStore, дефис вместо «—».
   4) Планшет: колонка по центру, листы не во всю ширину.
   5) Версия: инварианты versionCode от package.json (без ручных пинов), minSdk 23. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { zipSync, strToU8 } = require('fflate');
const L = require('../build-lib.js');
const Pay = require('../www/pay.js');
const Boot = require('../www/boot.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAYCFG = 'www/pay-config.js';
const STRINGS = 'android/app/src/main/res/values/strings.xml';
const PH = L.APP_ID_PLACEHOLDER;

// ---------- 1. console_app_id ----------

test('app-id: формат - только цифры; заглушка, пусто, буквы, адрес - отказ', () => {
  assert.equal(L.validAppId('2063760325'), true);
  assert.equal(L.validAppId('123456'), true);
  [PH, '', ' ', null, undefined, 'abc123', '12', '2063760325 ', 'https://console.rustore.ru/apps/2063760325',
    '1'.repeat(21), '-123456', '12 34 56'].forEach((v) => {
    assert.equal(L.validAppId(v), false, 'принят невалидный id: ' + JSON.stringify(v));
  });
});

test('app-id: аргумент --app-id=, --app-id <id>, env HOMYAK_APP_ID; без него - null', () => {
  assert.equal(L.parseAppIdArg(['--store', '--app-id=2063760325'], {}), '2063760325');
  assert.equal(L.parseAppIdArg(['--store', '--app-id', '777'], {}), '777');
  assert.equal(L.parseAppIdArg(['--store'], { HOMYAK_APP_ID: '555' }), '555');
  assert.equal(L.parseAppIdArg(['--store'], {}), null);
  assert.equal(L.parseAppIdArg(['--app-id='], {}), '', 'пустой id должен дойти до валидации, а не пропасть');
});

test('app-id: заглушка в любом месте = КАНДИДАТ, рассинхрон ловится', () => {
  const js = (v) => "  return {\n    PRODUCT_ID: 'full_access',\n    CONSOLE_APP_ID: " + v + ",\n";
  const xml = (v) => '<string name="rustore_console_app_id">' + v + '</string>';
  let st = L.appIdState(js('PLACEHOLDER'), xml(PH));
  assert.deepEqual([st.synced, st.placeholder, st.id], [true, true, null]);
  st = L.appIdState(js("'2063760325'"), xml('2063760325'));
  assert.deepEqual([st.synced, st.placeholder, st.id], [true, false, '2063760325']);
  st = L.appIdState(js("'2063760325'"), xml(PH));
  assert.equal(st.synced, false, 'JS с id, XML с заглушкой - это рассинхрон');
  assert.equal(st.placeholder, true);
  st = L.appIdState(js("'111'"), xml('222'));
  assert.deepEqual([st.synced, st.id], [false, null]);
});

test('app-id: stampAppIdFiles вписывает ОДИН id в оба файла; кривой id не трогает ни один', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-appid-'));
  const pc = path.join(dir, 'pay-config.js'), sx = path.join(dir, 'strings.xml');
  // стартуем с заглушки, как было до Консоли
  fs.writeFileSync(pc, rd(PAYCFG).replace(/CONSOLE_APP_ID:\s*(PLACEHOLDER|'[^']*')/, 'CONSOLE_APP_ID: PLACEHOLDER'));
  fs.writeFileSync(sx, rd(STRINGS).replace(/(<string name="rustore_console_app_id">)[^<]*(<\/string>)/, '$1' + PH + '$2'));
  assert.equal(L.readAppIdFiles(pc, sx).placeholder, true);

  const before = [fs.readFileSync(pc, 'utf8'), fs.readFileSync(sx, 'utf8')];
  assert.throws(() => L.stampAppIdFiles(pc, sx, 'abc'), /только из цифр/);
  assert.throws(() => L.stampAppIdFiles(pc, sx, ''), /только из цифр/);
  assert.deepEqual([fs.readFileSync(pc, 'utf8'), fs.readFileSync(sx, 'utf8')], before, 'невалидный id изменил файлы');

  const st = L.stampAppIdFiles(pc, sx, '2063760325');
  assert.deepEqual([st.js, st.xml, st.synced, st.placeholder], ['2063760325', '2063760325', true, false]);
  // JS-модуль после вписывания реально отдаёт этот id и считается сконфигурированным
  const cfg = require(pc);
  assert.equal(cfg.CONSOLE_APP_ID, '2063760325');
  assert.equal(cfg.isConfigured(), true);
  // повторная подстановка другим id - идемпотентно заменяет, не дописывает
  L.stampAppIdFiles(pc, sx, '123456');
  assert.equal(L.readAppIdFiles(pc, sx).id, '123456');
  assert.equal((fs.readFileSync(sx, 'utf8').match(/rustore_console_app_id/g) || []).length, 1);
});

test('app-id: в репозитории pay-config.js и strings.xml согласованы, id = PRODUCT full_access в Консоли', () => {
  const st = L.readAppIdFiles(path.join(ROOT, PAYCFG), path.join(ROOT, STRINGS));
  assert.equal(st.synced, true, 'pay-config.js ' + st.js + ' ≠ strings.xml ' + st.xml);
  if (!st.placeholder) assert.ok(L.validAppId(st.id));
  assert.equal(require('../www/pay-config.js').PRODUCT_ID, 'full_access', 'id товара в Консоли - full_access');
});

test('имена стор-выхода: кандидат с суффиксом «-кандидат», финал - в папку публикации', () => {
  const c = L.storeOutNames('1.0.0', true), f = L.storeOutNames('1.0.0', false);
  assert.ok(/-кандидат\.apk$/.test(c.out) && /-кандидат\.apk$/.test(c.desktop));
  assert.equal(c.desktop, 'Хомяк-1.0.0-RuStore-кандидат.apk');
  assert.ok(!/кандидат/.test(f.out) && !/кандидат/.test(f.desktop));
  assert.equal(f.desktop, path.join('Хомяк-RuStore-публикация', 'Хомяк-1.0.0.apk'));
});

test('build-apk.js: кандидат определяется по заглушке, печатает предупреждение, id вшивается до сборки', () => {
  const s = rd('build-apk.js');
  assert.ok(s.indexOf("КАНДИДАТ: оплата НЕ сконфигурирована, не отправлять на модерацию") >= 0);
  assert.ok(/const CANDIDATE = MODE\.store && !REEL && APP_ID\.placeholder;/.test(s));
  assert.ok(/if \(!APP_ID\.synced\)[\s\S]{0,80}die\(/.test(s), 'рассинхрон id не валит сборку');
  // подстановка id - раньше makeShip (иначе в APK уедет старый pay-config.js)
  assert.ok(s.indexOf('L.stampAppIdFiles(') < s.indexOf('L.makeShip('), 'id вписывается после копии www');
  assert.ok(s.indexOf('L.verifyApk(') > 0, 'нет самопроверки собранного APK');
});

test('reel несовместим с --release/--store (reel перекрыл бы релизные флаги)', () => {
  assert.throws(() => L.checkModeConflict({ release: true, store: true }, true), /reel/);
  assert.throws(() => L.checkModeConflict({ release: true, store: false }, true), /reel/);
  assert.doesNotThrow(() => L.checkModeConflict({ release: false, store: false }, true));
  assert.doesNotThrow(() => L.checkModeConflict({ release: true, store: true }, false));
});

// синтетический APK: ровно те записи, что читает verifyApk
function fakeApk(o) {
  o = o || {};
  const id = o.id || '2063760325';
  const flags = o.flags != null ? o.flags
    : '<script>window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;window.HOMYAK_PAY=true;window.HOMYAK_STORE=true;</script>';
  const bag = {
    'assets/public/pay-config.js': strToU8("x = { CONSOLE_APP_ID: '" + (o.jsId || id) + "' }"),
    'assets/public/index.html': strToU8(flags + '<script src="version.js"></script>'),
    'resources.arsc': new Uint8Array(Buffer.concat([Buffer.from([2, 0, 12, 0]), Buffer.from(o.arscId || id, 'utf8'), Buffer.from([0])]))
  };
  if (o.selftest) bag['assets/public/selftest.js'] = strToU8('x');
  if (o.so) bag['lib/arm64-v8a/libx.so'] = new Uint8Array([1]);
  return Buffer.from(zipSync(bag));
}

test('verifyApk: согласованный стор-APK проходит, считает .so', () => {
  const r = L.verifyApk(fakeApk(), { appId: '2063760325', store: true });
  assert.equal(r.jsId, '2063760325');
  assert.equal(r.arscEnc, 'utf8');
  assert.equal(r.so, 0);
  assert.equal(L.verifyApk(fakeApk({ so: true }), { appId: '2063760325', store: true }).so, 1);
});

test('verifyApk КРАСНЕЕТ: id разъехался, reel-флаг, нет STORE, selftest, чужой id', () => {
  assert.throws(() => L.verifyApk(fakeApk({ arscId: '999999' }), { appId: '2063760325', store: true }), /resources\.arsc/);
  assert.throws(() => L.verifyApk(fakeApk({ jsId: '111111', arscId: '111111' }), { appId: '2063760325', store: true }), /pay-config/);
  assert.throws(() => L.verifyApk(fakeApk({ flags: '<script>window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;window.HOMYAK_REEL=true;window.HOMYAK_STORE=true;</script>' }),
    { appId: '2063760325', store: true }), /reel/);
  assert.throws(() => L.verifyApk(fakeApk({ flags: '<script>window.HOMYAK_FULL_ACCESS=false;window.HOMYAK_DEMO=false;</script>' }),
    { appId: '2063760325', store: true }), /HOMYAK_STORE/);
  assert.throws(() => L.verifyApk(fakeApk({ flags: '' }), { appId: '2063760325', store: false }), /релизных флагов/);
  assert.throws(() => L.verifyApk(fakeApk({ selftest: true }), { appId: '2063760325', store: true }), /selftest/);
});

test('OTA_MTIME - настоящая дата в пределах zip (1980-2099), а не Invalid Date', () => {
  assert.ok(L.OTA_MTIME instanceof Date);
  assert.ok(!isNaN(L.OTA_MTIME.getTime()), 'OTA_MTIME = Invalid Date');
  const y = L.OTA_MTIME.getUTCFullYear();
  assert.ok(y >= 1980 && y <= 2099);
});

// ---------- 2. ревью стор-сборки: оплата ----------

test('оплата: на телефоне без плагина - НЕ mock (иначе Pro бесплатно), покупка не выдаёт доступ', async () => {
  const a = Pay.selectPaymentAdapter({ isNativeApp: () => true, NativePlugins: {} });
  assert.notEqual(a.kind, 'mock');
  const r = await a.purchase();
  assert.equal(Pay.purchaseGrantsPro(r), false);
  assert.equal(r.unavailable, true);
  assert.equal(Pay.restoreGrantsPro(await a.restore()), false);
  assert.equal(Pay.selectPaymentAdapter({ isNativeApp: () => true, NativePlugins: null }).kind, 'unavailable');
  // mock остаётся только браузеру/деву
  assert.equal(Pay.selectPaymentAdapter({ isNativeApp: () => false }).kind, 'mock');
});

test('ре-проверка владения: возврат снимает, офлайн/заглушка/неавторизованный пустой список - НЕ отбирают', () => {
  const f = Pay.ownershipAfterCheck;
  // купивший
  assert.equal(f(true, { owned: true }), true);
  assert.equal(f(false, { owned: true }), true, 'покупка с другого телефона после входа в RuStore');
  assert.equal(f(true, { unavailable: true }), true, 'заглушка id отобрала Pro');
  assert.equal(f(true, null), true);
  assert.equal(f(true, { owned: false, authorized: false }), true, 'не вошёл в RuStore - ложно отобрали Pro');
  // возврат/сторно
  assert.equal(f(true, { owned: false, revoked: true }), false, 'возврат не снял доступ');
  assert.equal(f(true, { owned: false, authorized: true }), false, 'авторизованный без покупки остался Pro');
  // не купивший не получает Pro ни при каком ответе без owned
  [{ unavailable: true }, { owned: false }, { owned: false, authorized: true }, null].forEach((st) => {
    assert.equal(f(false, st), false, 'Pro без покупки: ' + JSON.stringify(st));
  });
});

test('RuStore-адаптер: status нормализует ответ; restore при заглушке - unavailable, не «найдено»', async () => {
  const mk = (res) => Pay.createRuStorePayment({
    async purchase() { return {}; }, async getPurchases() { return res; }, async getProducts() { return {}; }
  });
  assert.deepEqual(await mk({ owned: true, authorized: true }).status(),
    { owned: true, revoked: false, authorized: true, unavailable: false });
  assert.deepEqual(await mk({ owned: 'yes' }).status(),
    { owned: false, revoked: false, authorized: false, unavailable: false }, 'строка вместо true открыла Pro');
  const r = await mk({ owned: false, unavailable: true }).restore();
  assert.equal(r.unavailable, true);
  assert.equal(Pay.restoreGrantsPro(r), false);
  assert.deepEqual(await mk({ owned: true }).restore(), { ok: true, purchased: true });
});

test('покупка: отмена/ошибка/сбой моста не выдают Pro; «деньги не списаны» не обещаем; двойной тап', () => {
  const s = rd('www/purchase.js');
  assert.equal(s.indexOf('деньги не списаны'), -1);
  assert.ok(/if \(window\.Pay\.purchaseGrantsPro\(r\)\)/.test(s), 'Pro не через purchaseGrantsPro');
  // markPurchased зовётся только из grantAndCelebrate, а он - только после *GrantsPro
  const marks = s.match(/markPurchased\(/g) || [];
  assert.equal(marks.length, 1);
  const calls = s.match(/grantAndCelebrate\('/g) || [];
  assert.equal(calls.length, 2);
  assert.ok(/\.catch\(function \(\) \{\s*buying = false;\s*failDlg\(onClose\);/.test(s), 'сбой моста молча закрывает окно');
  assert.ok(/if \(buying\) return;/.test(s), 'двойной тап откроет вторую шторку');
  assert.ok(/if \(r && r\.unavailable\) \{ notConfiguredDlg/.test(s), 'restore при заглушке говорит «не найдена»');
});

test('нативный плагин: клиент SDK - getInstance (провайдер уже создал), unavailable при заглушке, refund', () => {
  const j = rd('android/app/src/main/java/ru/dorokhin/budgetphone/RuStorePayPlugin.java');
  const cf = j.slice(j.indexOf('static RuStorePayClient clientFor('));
  const gi = cf.indexOf('RuStorePayClient.Companion.getInstance()');
  const pr = cf.indexOf('new RuStorePayClientProvider()');
  assert.ok(gi > 0 && pr > gi, 'provide() раньше getInstance(): RuStorePayClientAlreadyExist на каждом вызове');
  assert.ok(/ret\.put\("unavailable", true\);\s*\/\/ оплата не сконфигурирована/.test(j), 'getPurchases при заглушке не помечает unavailable');
  assert.ok(/ProductPurchaseStatus\.REFUNDED \|\| st == ProductPurchaseStatus\.REVERSED/.test(j));
  assert.ok(/getUserAuthorizationStatus\(\)/.test(j));
  // владеем только PAID/CONFIRMED
  assert.ok(/st == ProductPurchaseStatus\.PAID \|\| st == ProductPurchaseStatus\.CONFIRMED/.test(j));
});

test('deeplink RuStore Pay: схема одна в meta-data, intent-filter и плагине; MainActivity отдаёт интент SDK', () => {
  const m = rd('android/app/src/main/AndroidManifest.xml');
  const j = rd('android/app/src/main/java/ru/dorokhin/budgetphone/RuStorePayPlugin.java');
  const a = rd('android/app/src/main/java/ru/dorokhin/budgetphone/MainActivity.java');
  const scheme = (j.match(/PAY_SCHEME = "([^"]+)"/) || [])[1];
  assert.ok(scheme && /^[a-z][a-z0-9+.-]*$/.test(scheme), 'схема не ASCII/RFC-3986: ' + scheme);
  assert.ok(new RegExp('android:name="sdk_pay_scheme_value"\\s+android:value="' + scheme.replace(/\./g, '\\.') + '"').test(m), 'meta-data sdk_pay_scheme_value');
  assert.ok(m.indexOf('<data android:scheme="' + scheme + '" />') > 0, 'intent-filter со схемой');
  assert.ok(/android:name="console_app_id_value"\s+android:value="@string\/rustore_console_app_id"/.test(m));
  assert.ok(/onNewIntent\(Intent intent\)[\s\S]{0,120}RuStorePayPlugin\.proceedIntent/.test(a));
  assert.ok(/savedInstanceState == null\) RuStorePayPlugin\.proceedIntent/.test(a));
});

// ---------- 2. ревью стор-сборки: самоподмена кода ----------

test('стор: update.apply не скачивает и не переставляет WebView (заслон в самой точке подмены)', async () => {
  const calls = [];
  const prevW = global.window, prevF = global.fetch;
  global.window = {
    Access: { STORE: true },
    isNativeApp: () => true,
    NativePlugins: {
      Filesystem: new Proxy({}, { get: (t, k) => () => { calls.push('fs.' + String(k)); return Promise.resolve({}); } }),
      WebView: new Proxy({}, { get: (t, k) => () => { calls.push('wv.' + String(k)); return Promise.resolve({}); } })
    }
  };
  global.fetch = () => { calls.push('fetch'); return Promise.reject(new Error('net')); };
  try {
    delete require.cache[require.resolve('../www/update.js')];
    const Update = require('../www/update.js');
    const r = await Update.apply({ version: '9.9.9', url: 'https://dorokhin-finance.ru/homyak-store/www-9.9.9.zip', sha256: 'a'.repeat(64), size: 10 });
    assert.equal(r, false);
    assert.deepEqual(calls, [], 'стор полез качать/подменять: ' + calls.join(','));
  } finally {
    global.window = prevW; global.fetch = prevF;
    delete require.cache[require.resolve('../www/update.js')];
  }
});

test('стор: окна OTA/APK подменяются окном «Открыть в RuStore»', () => {
  const s = rd('www/update.js');
  assert.ok(/function dlgOta\(d\) \{\s*if \(isStore\(\)\) \{ dlgStore\(d\); return; \}/.test(s));
  assert.ok(/function dlgApk\(d\) \{\s*if \(isStore\(\)\) \{ dlgStore\(d\); return; \}/.test(s));
});

test('стор: boot.js никогда не откатывается на скачанные OTA-папки, метку снимает', () => {
  const get = (bag) => (k) => (k in bag ? bag[k] : null);
  const pending = { [Boot.K_TRY]: JSON.stringify({ version: '1.0.0', boots: 1 }) };
  assert.equal(Boot.decide(get(pending), '1.0.0').action, 'revert', 'без стора - прежнее поведение');
  assert.equal(Boot.decide(get(pending), '1.0.0', true).action, 'clear');
  assert.equal(Boot.decide(get({}), '1.0.0', true).action, 'none');
  assert.ok(/window\.HOMYAK_STORE === true/.test(rd('www/boot.js')));
});

test('стор-оболочка: gradle-флаг homyak_store → MainActivity забывает путь к OTA-папке до старта моста', () => {
  const g = rd('android/app/build.gradle');
  assert.ok(/resValue "bool", "homyak_store", \(project\.findProperty\('homyakStore'\) == 'true'\)/.test(g));
  const b = rd('build-apk.js');
  assert.ok(/'-PhomyakStore=' \+ \(MODE\.store && !REEL \? 'true' : 'false'\)/.test(b));
  const a = rd('android/app/src/main/java/ru/dorokhin/budgetphone/MainActivity.java');
  const clear = a.indexOf('remove(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH)');
  assert.ok(clear > 0 && clear < a.indexOf('super.onCreate(savedInstanceState)'), 'путь чистится после старта моста - поздно');
});

test('релиз/стор: параметры адреса (?demo, ?reel) ничего не включают', () => {
  const prevW = global.window;
  global.window = { HOMYAK_FULL_ACCESS: false, HOMYAK_DEMO: false, HOMYAK_PAY: true, HOMYAK_STORE: true };
  try {
    delete require.cache[require.resolve('../www/access.js')];
    const A = require('../www/access.js');
    assert.deepEqual([A.FULL, A.DEMO, A.STORE, A.PAY, A.REEL, A.RELEASE], [false, false, true, true, false, true]);
  } finally { global.window = prevW; delete require.cache[require.resolve('../www/access.js')]; }
  const u = rd('www/ui.js');
  assert.ok(/var Q = \(typeof Access !== 'undefined' && Access\.RELEASE\) \? '' : location\.search;/.test(u));
  // reel-переключатель ставится только при REEL
  assert.ok(/if \(REEL\) \(function \(\) \{\s*var top = \$\('top'\)/.test(u));
});

test('приватный ключ лицензий не в бандле и не в git', (t) => {
  // в свежем клоне приватного ключа нет (он gitignored) - проверять нечего, но и падать незачем
  if (!fs.existsSync(path.join(ROOT, 'tools/license-key.json'))) { t.skip('нет tools/license-key.json'); return; }
  const k = JSON.parse(rd('tools/license-key.json'));
  const d = k.privateJwk && k.privateJwk.d;
  assert.ok(d && d.length > 20);
  L.listFiles(path.join(ROOT, 'www')).forEach((f) => {
    const buf = fs.readFileSync(path.join(ROOT, 'www', f));
    assert.equal(buf.indexOf(d), -1, 'приватная часть ключа в www/' + f);
  });
  assert.equal(require('../www/license.js').PUB_KEY_B64, k.publicRawB64, 'в приложении не тот публичный ключ');
  const ign = execFileSync('git', ['check-ignore', 'tools/license-key.json', 'keys/homyak.jks', 'keys/homyak.properties'],
    { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.equal(ign.length, 3, 'не всё секретное в .gitignore: ' + ign.join(','));
});

// ---------- 3. пейволл ----------

test('пейволл: строки RuStore, НЕТ ссылок/адресов/контактов, дефис вместо «—»', () => {
  const s = rd('www/edit.js');
  const pw = s.slice(s.indexOf('function paywall'), s.indexOf('function bindRestore'));
  assert.ok(pw.indexOf('Уже есть ключ? Активируйте его') >= 0);
  assert.ok(pw.indexOf('Лицензионный ключ приобретается отдельно, вне приложения.') >= 0);
  assert.ok(pw.indexOf("'Купить в RuStore - ' + FULL_PRICE") >= 0);
  assert.ok(pw.indexOf('Восстановить покупку') >= 0);
  [/href/i, /https?:/i, /www\./i, /\.ru\b/i, /@/, /t\.me/i, /telegram/i, /whatsapp/i, /vk\.com/i, /\+7/, /8[\s-]?\(?9\d\d/,
    /openExternal/, /mailto/i, /tel:/i, /сайт/i, /напиши/i, /свяж/i, /(?<![а-яё])бот(?![а-яё])/i].forEach((re) => {
    assert.equal(re.test(pw), false, 'в пейволле ссылка/контакт: ' + re);
  });
  assert.equal(pw.indexOf('—'), -1, 'длинное тире в пейволле');
});

test('в пользовательских строках www нет длинного тире « — » (дефис «-»)', () => {
  const bad = [];
  L.listFiles(path.join(ROOT, 'www')).filter((f) => /\.js$/.test(f) && f.indexOf('vendor/') < 0 && f !== 'selftest.js')
    .forEach((f) => {
      rd('www/' + f).split('\n').forEach((line, i) => {
        const code = line.replace(/^\s*(\/\/|\/?\*).*$/, '').replace(/\/\/ .*$/, '');
        (code.match(/'(?:[^'\\]|\\.)*'/g) || []).forEach((lit) => { if (/\S\s—\s\S/.test(lit)) bad.push(f + ':' + (i + 1) + ' ' + lit); });
      });
    });
  assert.deepEqual(bad, []);
});

// ---------- 4. планшет ----------

test('планшет: #app - колонка 480-560px по центру; листы/окна не во всю ширину; FAB у колонки', () => {
  const css = rd('www/style.css');
  const colw = +(css.match(/--colw:\s*(\d+)px/) || [])[1];
  const sheetw = +(css.match(/--sheetw:\s*(\d+)px/) || [])[1];
  assert.ok(colw >= 480 && colw <= 560, '--colw ' + colw);
  assert.ok(sheetw >= 480 && sheetw <= 600, '--sheetw ' + sheetw);
  assert.ok(/#app \{ width: 100%; max-width: var\(--colw\); margin-inline: auto; \}/.test(css));
  assert.ok(/#dlg, #icSheet, #trSheet, #card \{ max-width: var\(--sheetw\); margin-inline: auto; \}/.test(css));
  assert.ok(/#summary, #amount \{ padding-left: var\(--side\); padding-right: var\(--side\); \}/.test(css));
  assert.ok(/\.fab \{ right: max\([^}]*var\(--side\)/.test(css));
});

// ---------- 5. версия ----------

// Версия не пинится руками (раньше тут стояли '1.0.1'/20003 и их надо было править на каждый
// релиз). Вместо пинов - инварианты: всё берётся из package.json и сверяется между собой.
// Мутация (проверено вручную): versionCode 20002 в android/app/build.gradle - красный.
test('версия: формула versionCode (история 1.0.0/1.0.1 и ряд 0.1.x), minSdk 23, targetSdk 34', () => {
  assert.equal(L.versionCodeOf('1.0.0', true), 20001);
  assert.equal(L.versionCodeOf('1.0.0', false), 20000);
  assert.equal(L.versionCodeOf('1.0.1', true), 20003);
  assert.equal(L.versionCodeOf('1.0.1', false), 20002);
  assert.equal(L.versionCodeOf('0.1.6', true), 213);
  assert.equal(L.versionCodeOf('0.1.7', false), 214);
  const v = rd('android/variables.gradle');
  assert.ok(/minSdkVersion = 23/.test(v));
  assert.ok(/targetSdkVersion = 34/.test(v));
});

test('версия package.json: стор-код = тест-код + 1, нечётный, больше альфы 1.0.0 (20001 занят в RuStore)', () => {
  const ver = require('../package.json').version;
  assert.match(ver, /^\d+\.\d+\.\d+$/);
  const store = L.versionCodeOf(ver, true), testCode = L.versionCodeOf(ver, false);
  assert.equal(store, testCode + 1);
  assert.equal(store % 2, 1, 'стор-код ' + store + ' чётный');
  assert.ok(store > 20001, 'стор-код ' + store + ' не больше альфы 1.0.0 = 20001: RuStore его не примет');
});

// Коммитится build.gradle со СТОР-кодом: после тест-сборки там тест-код, и этот тест
// должен покраснеть - это напоминание вернуть стор-сборку перед коммитом.
test('версия: build.gradle, www/version.js, www/files.json = package.json (gradle - стор-код)', () => {
  const ver = require('../package.json').version;
  const g = rd('android/app/build.gradle');
  const code = +(g.match(/^\s*versionCode\s+(\d+)\s*$/m) || [])[1];
  const name = (g.match(/^\s*versionName\s+"([^"]+)"\s*$/m) || [])[1];
  assert.equal(code, L.versionCodeOf(ver, true), 'versionCode в build.gradle не стор-код версии ' + ver +
    (code === L.versionCodeOf(ver, false) ? ' (там тест-код: после тест-сборки пересобери --store)' : ''));
  assert.equal(name, ver, 'versionName в build.gradle');
  assert.equal((rd('www/version.js').match(/window\.APP_VERSION = '([^']+)'/) || [])[1], ver, 'www/version.js');
  assert.equal(JSON.parse(rd('www/files.json')).version, ver, 'www/files.json');
});

test('XML Android: в комментариях нет «--» (aapt2 валит mergeResources)', () => {
  const files = ['android/app/src/main/AndroidManifest.xml', 'android/app/src/main/res/values/strings.xml'];
  files.forEach((f) => {
    (rd(f).match(/<!--([\s\S]*?)-->/g) || []).forEach((c) => {
      assert.equal(c.slice(4, -3).indexOf('--'), -1, f + ': «--» в комментарии: ' + c.slice(0, 80));
    });
  });
});

test('gradle: один RuStore-репозиторий - nexus-external.rustore.ru; vkpartner (отключён 01.10.2026) убран', () => {
  const g = rd('android/build.gradle').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const repos = g.match(/maven\s*\{\s*url\s*'[^']+'\s*\}/g) || [];
  const rustore = repos.filter((r) => /rustore|vkpartner/.test(r));
  assert.deepEqual(rustore, ["maven { url 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed' }"]);
  assert.equal(g.indexOf('vkpartner'), -1);
  const app = rd('android/app/build.gradle');
  assert.ok(app.indexOf("platform('ru.rustore.sdk:bom:2026.08.01')") > 0, 'BOM Pay SDK сменился');
});

test('пейволл: цена крупно (не приглушённый span), кнопки столбиком - «Купить в RuStore - 990 ₽» не рвётся', () => {
  const s = rd('www/edit.js'), css = rd('www/style.css');
  assert.ok(s.indexOf('<b id="pwPrice">') > 0, 'цена в <span> - её глушит правило .pw-price span');
  assert.ok(/\$\('dlgBtns'\); if \(bb\) bb\.classList\.add\('pw-btns'\)/.test(s));
  assert.ok(/\.dlg-btns\.pw-btns \{ flex-direction: column-reverse; \}/.test(css));
  assert.ok(/\.dlg-btns\.pw-btns \.btn \{ flex: 0 0 auto; width: 100%; \}/.test(css));
});
