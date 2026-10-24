/* pay-review-106.test.js - находки ревью кода max покупки «Хомяка» 1.0.6 (24.10.2026) и пять находок повторного
   адв. ревью механики «Понятной пенсии» 1.0.7 (Пенсия/docs/repro-107/adv2-repro.test.js, A-E), перенесённой в Хомяк
   сразу с исправлениями. Каждый тест был красным на коде до переделки (прогон с PAY_WWW_ROOT на копии старого www/).
   Песочница - tests/pay-world.js (настоящие pay.js + purchase.js, плагин - мок по контракту tests/pay-mock.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, payPlugin, settle, tick, until, rd } = require('./pay-world.js');

const JAVA = 'android/app/src/main/java/ru/dorokhin/budgetphone/RuStorePayPlugin.java';
const WHY = 'В бесплатной версии - один регулярный платёж.';
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
async function buyFromPaywall(w, why) { await settle(); w.UI.paywall(w.ret, why); w.click('Купить в RuStore'); await settle(); }

// ---------- P1: сбой/таймаут проверки владения ≠ «не куплено» ----------

test('P1: отмена шторки после оплаты, getPurchases отвечает «куплено» позже таймаута - доступ всё равно открыт', async () => {
  let answer;
  const pl = payPlugin({ sheet: { status: 'cancelled' },
    getPurchases: (n, def) => (n === 3 ? new Promise((r) => { answer = r; }) : def()) });
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  await until(() => w.title() === 'Оплата не прошла');
  assert.equal(w.title(), 'Оплата не прошла', 'магазин не уложился в таймаут - окно неуспеха');
  answer({ owned: true, authorized: true, purchaseId: 'paid-1', ackPending: true });   // магазин ответил поздно
  await until(() => w.full() && w.title() === 'Готово');
  assert.equal(w.full(), true, 'поздний ответ «куплено» потерян: заплатил - доступа нет');
  assert.equal(w.title(), 'Готово', 'поздний owned без окна «Готово»');
  assert.deepEqual(pl.acks, ['paid-1']);
});

test('P1: магазин не ответил ДО шторки - окно «Не удалось проверить покупку», второй счёт не открываем', async () => {
  const pl = payPlugin({ getPurchases: (n, def) => (n === 2 ? Promise.reject(new Error('net')) : def()) });
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  assert.equal(pl.calls.purchase, 0, 'шторка (новый счёт) открыта, хотя магазин не сказал, куплено ли');
  assert.equal(w.title(), 'Не удалось проверить покупку');
  assert.deepEqual(w.labels(), ['Позже', 'Попробовать снова']);
});

// ---------- P2: PROCESSING / EXECUTING ----------

test('P2: шторку закрыли, а покупка PROCESSING (банк проводит) - «Оплата обрабатывается», не «не прошла»; CONFIRMED → «Готово»', async () => {
  const pl = payPlugin({ sheet: (s) => { s.pay('PROCESSING'); s.end({ status: 'cancelled' }); } });
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  assert.equal(w.title(), 'Оплата обрабатывается');
  assert.ok(w.titles().indexOf('Оплата не прошла') < 0, 'оплата в обработке названа «не прошла»');
  pl.setStatus('p1', 'CONFIRMED');
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово');
  assert.equal(pl.calls.purchase, 1, 'второй счёт');
});

test('P2: плагин видит PROCESSING/EXECUTING (getPurchases pending, getPurchase → pending); INVOICE_CREATED - не pending', () => {
  const j = rd(JAVA);
  assert.match(j, /PENDING_STATUSES = \{\s*ProductPurchaseStatus\.PROCESSING, ProductPurchaseStatus\.EXECUTING\s*\}/);
  assert.match(j, /ret\.put\("pending", pend != null\)/);
  assert.match(j, /for \(ProductPurchaseStatus ps : PENDING_STATUSES\) if \(st == ps\) return "pending";/);
  assert.match(j, /if \(st == ProductPurchaseStatus\.INVOICE_CREATED\) return "open";/);
});

test('P2: при «Купить» уже есть свежая оплата в обработке - шторку молча не открываем (спрашиваем); старше 30 минут - не ждём', async () => {
  const pl = payPlugin(); pl.addPurchase('PROCESSING', 60 * 1000);
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  assert.equal(pl.calls.purchase, 0, 'вторая оплата поверх идущей без вопроса');
  assert.equal(w.title(), 'Предыдущая оплата ещё проверяется');
  const pl2 = payPlugin({ sheet: { status: 'ok' } }); pl2.addPurchase('PROCESSING', 31 * 60 * 1000);
  const w2 = world({ plugin: pl2 });
  await buyFromPaywall(w2);
  assert.equal(pl2.calls.purchase, 1, 'застрявшая больше 30 минут оплата навсегда заперла «Купить»');
});

// ---------- P3: перепроверка не одна ----------

test('P3: ожидание итога - опрос своей покупки несколько раз (сбой связи - не вывод), поздний CONFIRMED открывает доступ', async () => {
  let net = false;
  const pl = payPlugin({ checkFail: () => !net, sheet: (s) => { s.pay('PROCESSING'); s.end({ status: 'cancelled' }); } });
  const w = world({ plugin: pl, timings: { waitMs: 2000 } });
  await buyFromPaywall(w);
  await until(() => pl.calls.checkPurchase >= 2);
  const n = pl.calls.checkPurchase;
  assert.ok(n >= 2, 'опрос после первого сбоя остановился: ' + n);
  net = true; pl.setStatus('p1', 'CONFIRMED');
  await until(() => w.title() === 'Готово');
  assert.equal(w.full(), true, 'подтверждение после сбоев проверки не замечено');
  assert.equal(w.title(), 'Готово');
});

test('P3: возврат по иконке, проверка плагина не удалась (CheckFailed), оплата начата - ждём и замечаем оплату', async () => {
  let net = true;
  const pl = payPlugin({ checkFail: () => !net });
  const w = world({ plugin: pl, timings: { waitMs: 2000 } });
  await buyFromPaywall(w);
  pl.session.started();
  net = false; pl.appResume(); await settle();
  assert.equal(w.title(), 'Оплата обрабатывается');
  await tick(50); net = true;
  const c0 = pl.calls.checkPurchase;
  await until(() => pl.calls.checkPurchase >= c0 + 2); await settle();
  assert.equal(w.title(), 'Оплата обрабатывается', 'начатая оплата (счёт ещё open) принята за отмену');
  pl.setStatus('p1', 'PAID');
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово');
});

test('P3: CheckFailed при начатой оплате, а список покупок её ещё не видит - ждём, а не «не прошла»', async () => {
  let net = true;
  const pl = payPlugin({ checkFail: () => !net });
  const w = world({ plugin: pl, timings: { waitMs: 2000 } });
  await buyFromPaywall(w);
  pl.o.getPurchases = () => ({ owned: false, authorized: true, pending: false });   // старый плагин без записи «оплата начата»
  pl.session.started();
  net = false; pl.appResume(); await settle();
  assert.equal(w.title(), 'Оплата обрабатывается', 'начатая оплата после сбоя проверки названа «не прошла»');
  net = true; pl.setStatus('p1', 'PAID');
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово');
});

// ---------- P4: перепроверка при возврате в приложение ----------

test('P4: доступа нет, вернулись в приложение - владение перепроверено, покупка найдена → «Готово»', async () => {
  const w = world();
  await settle();
  assert.equal(w.full(), false);
  w.pl.addPurchase('PAID');            // оплата прошла вне сессии (другой телефон, поздний банк)
  const gp = w.pl.calls.getPurchases;
  w.resume(); await settle();
  assert.ok(w.pl.calls.getPurchases > gp, 'на возврат в приложение владение не перепроверено');
  assert.equal(w.full(), true);
  assert.equal(w.title(), 'Готово');
});

test('P4: доступ уже есть - на возврат магазин не дёргаем; сессия идёт - JS ничего не угадывает', async () => {
  const pl = payPlugin(); pl.addPurchase('PAID');
  const w = world({ plugin: pl });
  await settle();
  const gp = pl.calls.getPurchases;
  w.resume(); await settle();
  assert.equal(pl.calls.getPurchases, gp);
  const w2 = world();
  await buyFromPaywall(w2);
  const gp2 = w2.pl.calls.getPurchases;
  w2.resume(); await settle();
  assert.equal(w2.pl.calls.getPurchases, gp2, 'resume при открытой шторке перепроверил и «отпустил» её');
  assert.equal(w2.UI.purchaseBusy(), true);
});

test('P4: при запуске - свежая оплата в обработке: «Оплата обрабатывается» без шторки, итог → «Готово»', async () => {
  const pl = payPlugin(); const id = pl.addPurchase('EXECUTING', 1000);
  const w = world({ plugin: pl });
  await settle();
  assert.equal(w.title(), 'Оплата обрабатывается');
  pl.setStatus(id, 'PAID');
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово');
  assert.equal(pl.calls.purchase, 0);
});

// ---------- P5: 4000021 / RuStorePayInvalidActivePurchase ----------

test('P5: 4000021 «незавершённая покупка» и InvalidActivePurchase - своё окно с «Восстановить покупку», не «не прошла»', async () => {
  for (const code of ['4000021', 'InvalidActivePurchase']) {
    const w = world({ mock: { sheet: { status: 'error', code } } });
    await buyFromPaywall(w);
    assert.equal(w.title(), 'Прошлая оплата не завершена', code);
    assert.deepEqual(w.labels(), ['Позже', 'Восстановить покупку'], code);
  }
  const j = rd(JAVA);
  assert.match(j, /RuStorePaymentException\.RuStorePayInvalidActivePurchase\) return "InvalidActivePurchase"/);
});

test('P5: 4000021, а в магазине оплата в обработке - ждём её, второй счёт не открываем', async () => {
  const pl = payPlugin({ sheet: { status: 'error', code: '4000021' } });
  const w = world({ plugin: pl });
  await settle();
  w.UI.paywall(w.ret);
  const old = pl.addPurchase('INVOICE_CREATED');   // прошлый счёт: после ответа шторки банк уже проводит его
  pl.o.getPurchases = (n, def) => { if (pl.calls.purchase) pl.setStatus(old, 'PROCESSING'); return def(); };
  w.click('Купить в RuStore'); await settle();
  assert.equal(w.title(), 'Оплата обрабатывается');
});

// ---------- P6: 4000020 + пустой список ----------

test('P6: 4000020, а getPurchases пуст - «Восстановить» ведёт к честному выходу (аккаунт, поддержка RuStore), не в тупик', async () => {
  const pl = payPlugin({ sheet: { status: 'error', code: '4000020' }, precheck: { authorized: false, available: true } });
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  assert.equal(w.title(), 'Покупка уже есть');
  w.click('Восстановить покупку'); await settle();
  assert.notEqual(w.title(), 'Покупка не найдена', 'тупик: RuStore сказал «уже куплено», а восстановление «не найдена»');
  assert.equal(w.title(), 'RuStore не показал покупку');
  assert.ok(/поддержку RuStore/.test(w.text()) && /раздел «Помощь»/.test(w.text()), w.text());
  assert.ok(/тот же аккаунт/.test(w.text()));
  assert.deepEqual(w.labels(), ['Позже', 'Восстановить покупку'], 'нет второй попытки восстановления');
  pl.addPurchase('PAID');               // вошёл в нужный аккаунт
  w.click('Восстановить покупку'); await settle();
  assert.equal(w.title(), 'Готово');
});

// ---------- P7: закрыли пейволл во время проверок ----------

test('P7: «Купить», пейволл закрыли «Позже» до ответа RuStore - шторка не открывается поверх карточки', async () => {
  const pl = payPlugin({ precheck: () => later(80, { authorized: true, installed: true, available: true }), sheet: { status: 'ok' } });
  const w = world({ plugin: pl });
  await settle();
  w.UI.paywall(w.ret);
  w.click('Купить в RuStore');
  await tick(5);
  w.click('Позже');                     // вернулись в карточку категории
  assert.equal(w.title(), 'Карточка');
  await until(() => !w.UI.purchaseBusy()); await settle();
  assert.equal(pl.calls.purchase, 0, 'шторка всплыла после закрытого пейволла');
  assert.equal(w.title(), 'Карточка', 'окно покупки затёрло карточку');
  assert.equal(w.UI.purchaseBusy(), false);
});

// ---------- P8: итог не затирает чужое окно, «Готово» возвращает в карточку ----------

test('P8: карточка → регулярный платёж → пейволл → «Купить» → «Готово» → закрыли - снова карточка (ret)', async () => {
  const w = world({ mock: { sheet: { status: 'ok' } } });
  await settle();
  w.card();
  w.UI.paywall(w.ret, WHY);               // regular.js gate: UI.paywall(back, WHY_FREE)
  w.click('Купить в RuStore'); await settle();
  assert.equal(w.title(), 'Готово');
  w.click('Понятно');
  assert.equal(w.calls.ret, 1, '«Готово» без возврата - карточка потеряна');
  assert.equal(w.title(), 'Карточка');
});

test('P8: поздний успех, пока открыта карточка, - «Готово» ждёт её закрытия, а не затирает', async () => {
  const w = world();
  await buyFromPaywall(w);
  w.pl.appResume(); await settle();        // шторка закрыта без оплаты → «Оплата не прошла»
  w.click('Позже');                        // → карточка
  assert.equal(w.title(), 'Карточка');
  w.pl.session.end({ status: 'ok' }); await settle();   // purchaseLate
  assert.equal(w.full(), true);
  assert.equal(w.title(), 'Карточка', 'итог покупки затёр чужое окно');
  w.click('Закрыть'); await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово', 'после закрытия карточки «Готово» не показано');
});

test('P8: «Оплата обрабатывается», пока открыто чужое окно, - ждёт его закрытия', async () => {
  const pl = payPlugin(); pl.addPurchase('PROCESSING', 1000);
  const w = world({ plugin: pl, timings: { waitMs: 5000 } });
  w.card();                                 // при запуске открыто чужое окно
  await settle();
  assert.equal(w.title(), 'Карточка');
  w.click('Закрыть'); await until(() => w.title() === 'Оплата обрабатывается');
  assert.equal(w.title(), 'Оплата обрабатывается');
});

// ---------- P9: «Восстановить покупку» в окне «Покупка уже есть» ----------

test('P9: «Восстановить покупку» - один запрос на двойное нажатие, таймаут, «Позже» во время проверки возвращает (ret)', async () => {
  const pl = payPlugin({ sheet: { status: 'error', code: '4000020' } });
  const w = world({ plugin: pl, timings: { restoreMs: 200 } });
  await buyFromPaywall(w);
  assert.equal(w.title(), 'Покупка уже есть');
  pl.o.getPurchases = () => new Promise(() => {});   // магазин молчит
  const gp = pl.calls.getPurchases;
  w.click('Восстановить покупку');
  w.click('Восстановить покупку');
  await settle();
  assert.equal(pl.calls.getPurchases, gp + 1, 'двойное нажатие - два восстановления');
  assert.equal(w.title(), 'Покупка уже есть', 'окно закрылось до итога');
  w.click('Позже');
  assert.equal(w.calls.ret, 1, '«Позже» при зависшем восстановлении не вернул в карточку');
  await until(() => !w.UI.purchaseBusy());
  assert.equal(w.UI.purchaseBusy(), false, 'зависшее восстановление держит замок');
  assert.equal(w.title(), 'Карточка', 'итог восстановления затёр карточку');
  w.click('Закрыть'); await until(() => w.title() === 'Не получилось');
  assert.equal(w.title(), 'Не получилось');
});

// ---------- P10: «Попробовать снова» не теряет why ----------

test('P10: «Попробовать снова» возвращает пейволл с той же строкой причины', async () => {
  const w = world({ mock: { sheet: { status: 'cancelled' } } });
  await buyFromPaywall(w, WHY);
  assert.equal(w.title(), 'Оплата не прошла');
  w.click('Попробовать снова'); await settle();
  const pws = w.opened.filter((d) => d.kind === 'paywall');
  assert.equal(pws.length, 2);
  assert.equal(pws[1].why, WHY, 'строка причины потеряна');
  assert.equal(w.pl.calls.purchase, 2);
});

// ---------- пять находок повторного адв. ревью Пенсии 1.0.7 (A-E), перенесены уже исправленными ----------

test('адв2 A: purchaseLate во время снимка после неуспеха - итог «Готово», без «Оплата не прошла» поверх доступа', async () => {
  const pl = payPlugin({ getPurchases: (n, def) => { const r = def(); return n >= 3 ? later(80, r) : r; } });
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  pl.appResume(); await tick(5);           // счёт открыт, оплата не начата → cancelled → снимок (медленный)
  pl.session.end({ status: 'ok' }); await until(() => w.title() === 'Готово'); await tick(100); await settle();
  assert.equal(w.full(), true);
  assert.equal(w.title(), 'Готово');
  const t = w.titles(); assert.ok(t.lastIndexOf('Оплата не прошла') < t.lastIndexOf('Готово'), 'после «Готово» - «Оплата не прошла»: ' + t.join(' / '));
});

test('адв2 B: оплата начата, счёт ещё INVOICE_CREATED после возврата - «обрабатывается», не отмена; второго счёта нет', async () => {
  const pl = payPlugin();
  const w = world({ plugin: pl, timings: { waitMs: 3000 } });
  await buyFromPaywall(w);
  pl.session.started();
  pl.appResume(); await settle();
  assert.equal(w.title(), 'Оплата обрабатывается');
  assert.ok(w.labels().indexOf('Попробовать снова') < 0);
  pl.setStatus('p1', 'CONFIRMED');
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово');
  assert.equal(pl.calls.purchase, 1, 'второй счёт при незакрытом первом');
});

test('адв2 B: плагин - «оплата начата» (onPaymentStarted/Completed) делает счёт open ожиданием, а не отменой; запись переживает процесс', () => {
  const j = rd(JAVA);
  assert.match(j, /return "started"\.equals\(e\) \|\| "completed"\.equals\(e\);/);
  assert.ok((j.match(/"open"\.equals\(st\) && paying\(s\)/g) || []).length >= 2, 'open после начатой оплаты - не pending');
  assert.match(j, /if \("started"\.equals\(ev\) \|\| "completed"\.equals\(ev\)\) saveStarted\(ctx, s\.purchaseId\);/);
});

test('адв2 C: плагин ответил busy - «Оплата ещё не завершена» с «Восстановить покупку», не «Оплата не прошла»', async () => {
  const pl = payPlugin(); pl.purchase = async () => { pl.calls.purchase++; return { ok: false, status: 'busy' }; };
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  assert.equal(w.title(), 'Оплата ещё не завершена');
  assert.deepEqual(w.labels(), ['Позже', 'Восстановить покупку']);
});

test('адв2 D: CheckFailed, оплата не начиналась, счёт open - сразу «Оплата не прошла», без 3 минут «обрабатывается»', async () => {
  let net = true;
  const pl = payPlugin({ checkFail: () => !net });
  const w = world({ plugin: pl, timings: { waitMs: 3000 } });
  await buyFromPaywall(w);
  net = false; pl.appResume(); await settle(); net = true;
  await until(() => w.title() === 'Оплата не прошла', 2000);
  assert.equal(w.title(), 'Оплата не прошла');
  assert.equal(w.UI.purchaseBusy(), false);
});

test('адв2 E: 4000020, снимок видит owned без ackPending - acknowledge не уходит на неудавшийся счёт', async () => {
  const pl = payPlugin({ getPurchases: (n) => (n <= 2 ? { owned: false, authorized: false } : { owned: true, authorized: true }),
    sheet: { status: 'error', code: '4000020' } });
  const w = world({ plugin: pl });
  await buyFromPaywall(w);
  assert.equal(w.title(), 'Готово');
  assert.deepEqual(pl.acks, [], 'acknowledge ушёл на неоплаченную покупку');
});

// ---------- решение владельца 24.10 (песочница): «Подождать» / «Оплатить снова», как «Карта года» 1.1.1 ----------
const PREV_T = 'Предыдущая оплата ещё проверяется';
const PREV_X = 'Если вы уже заплатили в банке, не платите второй раз - подождите, полный доступ откроется сам. Если не платили - можно оплатить снова.';

test('24.10: «Купить» при прошлой оплате «в обработке» - выбор «Подождать» / «Оплатить снова»; «Подождать» - фоновый опрос и «Готово»', async () => {
  const pl = payPlugin(); const id = pl.addPurchase('PROCESSING', 1000);
  const w = world({ plugin: pl });
  await settle(); w.close();                 // при запуске открылось «Оплата обрабатывается» (ожидание прошлой) - закрыли
  await until(() => !w.UI.purchaseBusy(), 6000);
  w.UI.paywall(); w.click('Купить в RuStore'); await settle();
  assert.equal(pl.calls.purchase, 0, 'шторка без вопроса, пока банк проводит прошлую оплату');
  assert.equal(w.title(), PREV_T);
  assert.equal(w.text(), PREV_X);
  assert.deepEqual(w.labels(), ['Подождать', 'Оплатить снова']);
  assert.equal(w.UI.purchaseBusy(), false, 'окно выбора держит замок');
  w.click('Подождать');
  assert.equal(w.cur, null);
  pl.setStatus(id, 'PAID');
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово', 'прошлая оплата подтвердилась, а доступ не открылся');
  assert.equal(w.full(), true);
  assert.equal(pl.calls.purchase, 0);
});

test('24.10: «Оплатить снова» открывает шторку, опрос прошлой оплаты идёт дальше - подтвердилась прошлая → доступ и «Готово»', async () => {
  const pl = payPlugin(); const id = pl.addPurchase('PROCESSING', 1000);
  const w = world({ plugin: pl, timings: { waitMs: 300 } });
  await until(() => !w.UI.purchaseBusy(), 6000); await settle(); w.close();   // ожидание при запуске кончилось («Проверим позже»)
  w.UI.paywall(w.ret, WHY); w.click('Купить в RuStore'); await settle();
  assert.equal(w.title(), PREV_T);
  w.UI.purchaseTimings({ waitMs: 5000 });
  w.click('Оплатить снова'); await settle();
  assert.equal(pl.calls.purchase, 1, '«Оплатить снова» не открыл шторку');
  assert.equal(w.opened.filter((d) => d.kind === 'paywall').pop().why, WHY, '«Оплатить снова» потерял строку причины');
  const c0 = pl.calls.checkPurchase;
  await until(() => pl.calls.checkPurchase >= c0 + 2);
  assert.ok(pl.calls.checkPurchase >= c0 + 2, 'опрос прошлой оплаты остановился после «Оплатить снова»');
  pl.setStatus(id, 'CONFIRMED');            // прошлая оплата прошла, пока открыта новая шторка
  await until(() => w.full());
  assert.equal(w.full(), true, 'подтверждение прошлой оплаты потеряно');
  pl.session.end({ status: 'cancelled' });  // новую шторку закрыли без оплаты
  await until(() => w.title() === 'Готово');
  assert.equal(w.title(), 'Готово', 'доступ открыт прошлой оплатой, а на экране «Оплата не прошла»');
  assert.equal(pl.calls.purchase, 1);
});

test('24.10: «Купить» во время ожидания прошлой оплаты (при запуске) - тот же выбор; «Оплатить снова» - шторка, опрос прошлой в фоне', async () => {
  const pl = payPlugin(); const id = pl.addPurchase('EXECUTING', 1000);
  const w = world({ plugin: pl });
  await settle();
  assert.equal(w.title(), 'Оплата обрабатывается');
  assert.equal(w.UI.purchaseBusy(), true);
  w.UI.paywall(); w.click('Купить в RuStore'); await settle();
  assert.equal(w.title(), PREV_T, 'во время ожидания «Купить» снова молча показал «Оплата обрабатывается»');
  assert.deepEqual(w.labels(), ['Подождать', 'Оплатить снова']);
  w.click('Оплатить снова'); await settle();
  assert.equal(pl.calls.purchase, 1, '«Оплатить снова» во время ожидания не открыл шторку');
  const c0 = pl.calls.checkPurchase;
  await until(() => pl.calls.checkPurchase >= c0 + 2);
  assert.ok(pl.calls.checkPurchase >= c0 + 2, 'опрос прошлой оплаты не перешёл в фон');
  pl.setStatus(id, 'PAID');
  await until(() => w.full());
  assert.equal(w.full(), true, 'подтверждение прошлой оплаты потеряно');
});
