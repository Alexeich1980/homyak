/* purchase-106.test.js - покупка «Полного доступа» 1.0.6 (разбор брошенных оплат: docs/broshennye-oplaty-2026-10.md;
   память android-app-build-checklist «Покупка через RuStore Pay», п.1-14). С ревью кода max 24.10.2026 - механика
   «Понятной пенсии» 1.0.7: сессия покупки в плагине, одна машина состояний в JS (находки ревью - tests/pay-review-106.test.js).
   Живой флоу: настоящие pay-config.js + pay.js + purchase.js в vm (tests/pay-world.js), плагин - мок по контракту
   (tests/pay-mock.js), окно - модель единственного #dlg.
   Проверяем:
     1. формат цены «990.00 руб.» → «990 ₽» (и копейки, если не нули);
     2. окно неуспеха: «Оплата не прошла», СБП, VPN, «Попробовать снова» / «Позже», без ложного «Восстановить покупку»;
     3. неуспех шторки → снимок владения, куплено → «Готово»;
     4. коды RuStore из плагина: 4000020 → восстановление, 4000025 / устаревший / нет RuStore / вход → свои тексты;
     5. до шторки: бан и «не подключено» - шторку не открываем; сеть, «не вошёл», устаревший RuStore - открываем;
     6. шторка не вернулась (возврат по иконке) - итог даёт плагин на resume; двойной тап - одна шторка;
     7. после успеха - acknowledge(purchaseId);
     8. исходники: плагин пробрасывает code, есть precheck/acknowledge/checkPurchase; тексты на «вы», без «—». */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, settle, tick, rd } = require('./pay-world.js');
const Pay = require('../www/pay.js');
const NB = '\u00a0';

// ---------- 1. формат цены ----------

test('1: цена из магазина - «990 ₽», копейки только если не нули, разряды и ₽ - неразрывные', () => {
  const f = Pay.formatPrice;
  assert.equal(f('990.00 руб.'), '990' + NB + '₽');
  assert.equal(f('990,00 руб.'), '990' + NB + '₽');
  assert.equal(f('990 руб.'), '990' + NB + '₽');
  assert.equal(f('990.00 RUB'), '990' + NB + '₽');
  assert.equal(f('990' + NB + '₽'), '990' + NB + '₽', 'уже готовая строка испорчена');
  assert.equal(f('1 290.50 руб.'), '1' + NB + '290,50' + NB + '₽');
  assert.equal(f('1' + NB + '290,50 руб.'), '1' + NB + '290,50' + NB + '₽');
  assert.equal(f('1290.5 руб.'), '1' + NB + '290,50' + NB + '₽');
  assert.equal(f('12345.00 руб.'), '12' + NB + '345' + NB + '₽');
  assert.equal(f('$9.99'), '$9.99', 'незнакомый формат надо оставить как есть');
  assert.equal(f(''), null);
  assert.equal(f(null), null);
  assert.ok(f('990.00 руб.').indexOf(' ') < 0, 'обычный пробел в цене - строка порвётся');
});

test('1: Pay.getPriceLabel отдаёт уже отформатированную цену (её же ставит пейволл)', async () => {
  const plugin = { async getProducts() { return { ok: true, priceLabel: '990.00 руб.' }; }, async getPurchases() { return {}; }, async purchase() { return {}; } };
  const a = Pay.createRuStorePayment(plugin);
  const was = Pay.currentAdapter;
  Pay.currentAdapter = () => a;
  try { assert.equal(await Pay.getPriceLabel(), '990' + NB + '₽'); } finally { Pay.currentAdapter = was; }
});

// ---------- 2-3. отмена ----------

test('2: отмена шторки (и не куплено) - своё окно «Оплата не прошла»: СБП, VPN, «Попробовать снова»/«Позже»', async () => {
  const w = world({ mock: { sheet: { status: 'cancelled' } } });
  await settle(); const gp0 = w.pl.calls.getPurchases;
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  assert.ok(w.pl.calls.getPurchases > gp0 + 1, 'после отмены владение не перепроверено (снимок)');
  assert.equal(w.title(), 'Оплата не прошла', 'после отмены нет окна неуспеха');
  assert.ok(/СБП/.test(w.text()), 'нет совета про СБП');
  assert.ok(/VPN/.test(w.text()), 'нет строки про VPN');
  assert.ok(w.text().indexOf('Восстановить покупку') < 0, 'ложный совет «Восстановить покупку» в окне неуспеха');
  assert.deepEqual(w.labels(), ['Позже', 'Попробовать снова']);
  assert.equal(w.calls.ret, 0, 'окно само выбросило в список');
  assert.equal(w.UI.purchaseBusy(), false, 'после итога «идёт покупка» не снят');
  w.click('Позже');
  assert.equal(w.calls.ret, 1, '«Позже» не вернул туда, откуда пришли');
});

test('2: «Попробовать снова» возвращает пейволл и сразу снова открывает шторку', async () => {
  const w = world({ mock: { sheet: { status: 'error' } } });
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  assert.equal(w.title(), 'Оплата не прошла', 'ошибка платежа без окна неуспеха');
  w.click('Попробовать снова');
  await settle();
  assert.equal(w.calls.paywall, 2, 'пейволл не вернулся');
  assert.equal(w.pl.calls.purchase, 2, 'шторка не открылась снова');
  assert.equal(w.calls.ret, 0);
});

test('3: отмена, а RuStore видит покупку (оплатил в банке, закрыл шторку) - «Готово», доступ, acknowledge', async () => {
  const w = world({ mock: { sheet: (s) => { s.pay('PAID'); s.end({ status: 'cancelled' }); } } });
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  assert.equal(w.title(), 'Готово', 'купившему после отмены показали неуспех');
  assert.equal(w.full(), true, 'доступ не открыт');
  assert.deepEqual(w.pl.acks, ['p1'], 'выдача товара не отмечена');
});

// ---------- 4. коды RuStore ----------

test('4: 4000020 «уже приобретён» (магазин не подтвердил) - окно с «Восстановить покупку»', async () => {
  const w = world({ mock: { sheet: { status: 'error', code: '4000020' } } });
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  assert.equal(w.title(), 'Покупка уже есть');
  assert.deepEqual(w.labels(), ['Позже', 'Восстановить покупку']);
  const gp = w.pl.calls.getPurchases;
  w.click('Восстановить покупку');
  await settle();
  assert.ok(w.pl.calls.getPurchases > gp, '«Восстановить покупку» не ведёт в восстановление');
});

test('4: 4000020 и магазин подтверждает - сразу «Покупка восстановлена»', async () => {
  const w = world({ mock: { sheet: { status: 'error', code: '4000020' } } });
  await settle();
  w.UI.paywall(w.ret);
  w.pl.o.owned = () => (w.pl.calls.purchase ? { owned: true, authorized: true, purchaseId: 'old-1', ackPending: true } : { owned: false, authorized: true });
  w.click('Купить в RuStore');
  await settle();
  assert.equal(w.title(), 'Готово');
  assert.ok(/восстановлена/.test(w.text()), w.text());
  assert.deepEqual(w.pl.acks, ['old-1']);
});

test('4: 4000025 / устаревший / нет RuStore / вход - свои тексты, не общее «Попробуйте через СБП - этот способ уже выбран»', async () => {
  const cases = [
    ['4000025', 'Оплата не прошла', /способа оплаты/],
    ['RuStoreOutdated', 'Обновите RuStore', /Обновите RuStore и/],
    ['RuStoreNotInstalled', 'Нужен RuStore', /Установите/],
    ['UserUnauthorized', 'Оплата не прошла', /войти/]
  ];
  for (const [code, title, re] of cases) {
    const w = world({ mock: { sheet: { status: 'error', code } } });
    await settle();
    w.UI.paywall(w.ret);
    w.click('Купить в RuStore');
    await settle();
    assert.equal(w.title(), title, code + ': заголовок');
    assert.ok(re.test(w.text()), code + ': текст «' + w.text() + '»');
    assert.ok(w.text().indexOf('уже выбран в окне оплаты') < 0, code + ': общий текст вместо своего');
  }
});

test('4: адаптер пробрасывает code из плагина; без кода - null; коды → виды окон', async () => {
  const mk = (r) => Pay.createRuStorePayment({ async purchase() { return r; }, async getPurchases() { return {}; }, async getProducts() { return {}; } });
  assert.equal((await mk({ status: 'error', code: '4000025' }).purchase()).code, '4000025');
  assert.equal((await mk({ ok: false, error: 'x', code: 4000020 }).purchase()).code, '4000020');
  assert.equal((await mk({ ok: false, error: 'x' }).purchase()).code, null);
  assert.equal(Pay.kindOfCode('4000020'), 'already');
  assert.equal(Pay.kindOfCode('4000025'), 'nomethod');
  assert.equal(Pay.kindOfCode('RuStoreOutdated'), 'outdated');
  assert.equal(Pay.kindOfCode('RuStoreNotInstalled'), 'notinstalled');
  assert.equal(Pay.kindOfCode('9999999'), 'failed');
  assert.equal(Pay.kindOfCode(null), 'failed');
  assert.equal(Pay.kindOfCode('toString'), 'failed', 'имя из Object.prototype принято за код');
});

// ---------- 5. до шторки ----------

test('5 (Н6): бан пользователя/приложения и «не подключено» - шторку не открываем, своё окно', async () => {
  for (const [code, title] of [['UserBanned', 'Оплата недоступна'], ['ApplicationBanned', 'Оплата недоступна'], ['NotConfigured', 'Полный доступ']]) {
    const w = world({ mock: { precheck: { authorized: true, available: false, code } } });
    await settle();
    w.UI.paywall(w.ret);
    w.click('Купить в RuStore');
    await settle();
    assert.equal(w.pl.calls.purchase, 0, code + ': шторка открыта');
    assert.equal(w.title(), title, code);
  }
});

test('5: сеть / «не вошёл» / RuStore устарел или не установлен / чужой код - шторка открывается (правило Пенсии 1.0.7)', async () => {
  for (const code of [undefined, null, '9999999', 'UserUnauthorized', '4000025', 'RuStoreOutdated', 'RuStoreNotInstalled']) {
    const w = world({ mock: { precheck: { authorized: true, available: false, code }, sheet: { status: 'ok' } } });
    await settle();
    w.UI.paywall(w.ret);
    w.click('Купить в RuStore');
    await settle();
    assert.equal(w.pl.calls.purchase, 1, 'причина «' + code + '»: шторка не открылась');
    assert.equal(w.title(), 'Готово', code + ': оплата не прошла до конца');
  }
});

test('5 (Н6): пейволл до оплаты - «может попросить войти», не «попросил»; сеть - без строки «недоступна»', async () => {
  const w = world();
  const H = 'RuStore может попросить войти. Без входа проще через СБП.';
  assert.equal(w.UI.payHint({ authorized: false, available: true }), H);
  assert.equal(w.UI.payHint({ authorized: false, available: false, code: 'UserUnauthorized' }), H);
  assert.equal(w.UI.payHint({ authorized: null, available: false, code: 'UserUnauthorized' }), H);
  assert.equal(w.UI.payHint({ authorized: false, installed: false, available: true }), null, 'без RuStore строка «войти» ни к чему');
  assert.equal(w.UI.payHint({ authorized: true, available: false, code: null }), null, 'сбой сети назван «оплата недоступна»');
  assert.equal(w.UI.payHint({ authorized: true, available: false, code: 'UserBanned' }), w.UI.payTexts.FAIL.banned.text);
  assert.equal(w.UI.payHint({ authorized: true, available: true }), null);
  assert.equal(w.UI.payHint(null), null);
  assert.equal(w.UI.payTexts.FAIL.unauthorized.text, 'RuStore попросил войти в аккаунт. Войдите в RuStore или оплатите через СБП.');
});

test('5: адаптер precheck - нет метода в старой оболочке → null; заглушка id → NotConfigured; нет поля → null', async () => {
  const base = { async purchase() { return {}; }, async getPurchases() { return {}; }, async getProducts() { return {}; } };
  assert.equal(await Pay.createRuStorePayment(base).precheck(), null);
  const mk = (r) => Pay.createRuStorePayment(Object.assign({ async precheck() { return r; } }, base));
  assert.deepEqual(await mk({ ok: false, unavailable: true }).precheck(), { authorized: null, installed: null, available: false, code: 'NotConfigured' });
  assert.deepEqual(await mk({ authorized: false }).precheck(), { authorized: false, installed: null, available: null, code: null });
  assert.deepEqual(await mk({ authorized: true, installed: true, available: true }).precheck(), { authorized: true, installed: true, available: true, code: null });
  assert.equal(Pay.finalKind({ available: false, code: 'UserBanned' }), 'banned');
  assert.equal(Pay.finalKind({ available: false, code: 'NotConfigured' }), 'notconfigured');
  assert.equal(Pay.finalKind({ available: false, code: 'RuStoreOutdated' }), null);
  assert.equal(Pay.finalKind({ available: false }), null);
});

// ---------- 6. шторка не вернулась ----------

test('6: шторка открыта - двойной тап не открывает вторую; таймера «зависания» нет - замок держит только сессия', async () => {
  const w = world();
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  assert.equal(w.UI.purchaseBusy(), true);
  w.click('Купить в RuStore');
  w.UI.buyFullAccess(w.ret);
  await tick(500); await settle();
  assert.equal(w.pl.calls.purchase, 1, 'двойной тап открыл вторую шторку');
  assert.equal(w.UI.purchaseBusy(), true, 'живую шторку «отпустили» по таймеру');
  w.pl.session.end({ status: 'cancelled' });
  await settle();
  assert.equal(w.UI.purchaseBusy(), false, 'итог шторки не снял замок');
  assert.equal(w.title(), 'Оплата не прошла');
});

test('6: оплатил в банке, вернулся по иконке (шторка убита) - итог плагина на resume → «Готово»', async () => {
  const w = world();
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  w.pl.session.pay('PAID');
  w.pl.appResume();
  await settle();
  assert.equal(w.title(), 'Готово', 'оплатившему после возврата по иконке ничего не сказали');
  assert.equal(w.full(), true);
  assert.deepEqual(w.pl.acks, ['p1']);
  assert.equal(w.UI.purchaseBusy(), false);
});

test('6: поздний успех шторки после итога (purchaseLate) открывает доступ', async () => {
  const w = world();
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  w.pl.appResume();                 // шторку закрыли без оплаты: плагин отдаёт cancelled
  await settle();
  assert.equal(w.title(), 'Оплата не прошла');
  w.pl.session.end({ status: 'ok' });   // Task шторки всё же ответил успехом - событие purchaseLate
  await settle();
  assert.equal(w.full(), true, 'поздний успех шторки потерян');
  assert.equal(w.title(), 'Готово');
});

// ---------- 7. acknowledge ----------

test('7: успех покупки - acknowledge(purchaseId); restore с неотмеченной покупкой - тоже', async () => {
  const w = world({ mock: { sheet: { status: 'ok' } } });
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await settle();
  assert.equal(w.title(), 'Готово');
  assert.deepEqual(w.pl.acks, ['p1'], 'после успеха выдача не отмечена');
  const w2 = world();
  await settle();
  w2.pl.addPurchase('PAID');
  w2.UI.restorePurchase(w2.ret);
  await settle();
  assert.equal(w2.title(), 'Готово');
  assert.deepEqual(w2.pl.acks, ['p1'], 'восстановленная покупка не отмечена');
});

test('7: старт приложения (refresh) отмечает оплаченную, но не отмеченную покупку', async () => {
  const pl = require('./pay-mock.js').payPlugin();
  pl.addPurchase('PAID');
  const w = world({ plugin: pl });
  await settle();
  assert.deepEqual(w.pl.acks, ['p1'], 'refresh не отметил ACKNOWLEDGED');
  const a = Pay.createRuStorePayment({ async purchase() { return {}; }, async getPurchases() { return { owned: true, purchaseId: 'x' }; }, async getProducts() { return {}; } });
  assert.equal((await a.status()).ackId, null);
});

// ---------- 8. исходники ----------

test('8: плагин - сессия покупки, code из RuStorePaymentNetworkException, precheck, acknowledge, checkPurchase, ackPending', () => {
  const j = rd('android/app/src/main/java/ru/dorokhin/budgetphone/RuStorePayPlugin.java');
  assert.match(j, /String code = errorCode\(t\);\s*if \(code != null\) base\.put\("code", code\);/);
  assert.match(j, /RuStorePaymentException\.RuStorePaymentNetworkException\) c\)\.getCode\(\)/);
  assert.match(j, /"RuStoreOutdatedException"\.equals\(n\)\) return "RuStoreOutdated"/);
  assert.match(j, /"RuStoreNotInstalledException"\.equals\(n\)\) return "RuStoreNotInstalled"/);
  assert.match(j, /@PluginMethod\s+public void precheck\(/);
  assert.match(j, /getPurchaseAvailability\(\)/);
  assert.match(j, /@PluginMethod\s+public void acknowledge\(/);
  assert.match(j, /@PluginMethod\s+public void checkPurchase\(/);
  assert.match(j, /updateAcknowledgementState\(new PurchaseId\(id\), AcknowledgementState\.ACKNOWLEDGED, null\)/);
  assert.match(j, /ret\.put\("ackPending", true\)/);
  assert.match(j, /getBridge\(\)\.saveCall\(call\)/, 'сессия покупки не держит PluginCall');
  assert.match(j, /protected void handleOnResume\(\)/, 'нет проверки на возврат в приложение');
  assert.match(j, /notifyListeners\("purchaseLate", r\)/, 'поздний успех не отдаётся событием');
});

test('8: пейволл - строка про СБП («оставьте», не «выберите»), строка проверки до шторки, «Купить» передаёт why', () => {
  const s = rd('www/edit.js');
  const pw = s.slice(s.indexOf('function paywall'), s.indexOf('function bindRestore'));
  assert.ok(pw.indexOf("'<div class=\"pw-sbp\" id=\"pwSbp\">' + PAY_SBP") > 0, 'нет строки про СБП в пейволле');
  assert.ok(pw.indexOf('id="pwPayHint"') > 0);
  assert.ok(/if \(pay\) fillPayHint\(\);/.test(pw), 'проверка до шторки не зовётся при открытии пейволла');
  assert.ok(pw.indexOf('window.UI.buyFullAccess(ret, why)') > 0, '«Купить» теряет строку причины');
  const sbp = (s.match(/var PAY_SBP = '([^']+)'/) || [])[1];
  assert.ok(sbp && /оставьте СБП/.test(sbp) && !/выберите/i.test(sbp), 'подсказка про СБП: ' + sbp);
});

test('8: тексты покупки - на «вы», без длинного тире, без литерального NBSP, без системных окон', () => {
  ['www/purchase.js', 'www/pay.js', 'www/edit.js'].forEach((f) => {
    const s = rd(f);
    const strs = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').match(/'[^'\n]*[а-яё][^'\n]*'/gi) || [];
    strs.forEach((t) => assert.ok(t.indexOf('—') < 0, f + ': длинное тире в строке ' + t));
    assert.ok(!/[\u00a0\u202f\u2009]/.test(s), f + ': литеральный неразрывный пробел (только \\u00a0)');
    assert.ok(!/(^|[^.\w])(alert|confirm|prompt)\(/m.test(s), f + ': системное окно');
  });
  const p = rd('www/purchase.js');
  assert.ok(p.indexOf('в этом же окне') < 0, 'ложный совет «в этом же окне» вернулся');
  assert.ok(p.indexOf('деньги не списаны') < 0, 'обещание «деньги не списаны»');
  assert.ok(!/(?:^|[^а-яё])(Вы|Вам|Вас|Ваш)(?![а-яё])/.test(p), 'в текстах «Вы» с заглавной');
  assert.ok(!/(?:^|[^а-яё])(ты|тебе|твой)(?![а-яё])/i.test(p), 'в текстах «ты»');
});
