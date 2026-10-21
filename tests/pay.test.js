/* pay.test.js — логика оплаты «Полного доступа» без девайса: выбор адаптера, маппинг
   статусов покупки/восстановления → Pro, mock-флоу, локальный кэш владения. Нативную
   часть (RuStorePayPlugin.java) проверяем на устройстве; здесь — вся JS-логика. */
const test = require('node:test');
const assert = require('node:assert');
const Pay = require('../www/pay.js');
const PayConfig = require('../www/pay-config.js');

test('pay-config: PRODUCT_ID задан; isConfigured отличает боевой id от заглушки', () => {
  assert.strictEqual(typeof PayConfig.PRODUCT_ID, 'string');
  assert.ok(PayConfig.PRODUCT_ID.length > 0);
  const ph = { CONSOLE_APP_ID: PayConfig.PLACEHOLDER, isConfigured: PayConfig.isConfigured };
  assert.strictEqual(ph.isConfigured(), false, 'заглушка считается сконфигурированной');
  const cfg = { CONSOLE_APP_ID: '1234567890', isConfigured: PayConfig.isConfigured };
  assert.strictEqual(cfg.isConfigured(), true, 'боевой id → сконфигурировано');
});

// ---------- маппинг статусов покупки → Pro ----------

test('isOwnedStatus: PAID/CONFIRMED владеют, остальное — нет', () => {
  assert.deepStrictEqual(Pay.OWNED_STATUSES, ['PAID', 'CONFIRMED']);
  assert.strictEqual(Pay.isOwnedStatus('PAID'), true);
  assert.strictEqual(Pay.isOwnedStatus('CONFIRMED'), true);
  ['CONSUMED', 'CANCELLED', 'EXPIRED', 'PAUSED', 'INVOICE_CREATED', '', null, undefined].forEach((s) => {
    assert.strictEqual(Pay.isOwnedStatus(s), false, 'не владеет: ' + s);
  });
});

test('purchaseGrantsPro: только явный ok=true открывает Pro', () => {
  assert.strictEqual(Pay.purchaseGrantsPro({ ok: true, purchaseId: 'x' }), true);
  assert.strictEqual(Pay.purchaseGrantsPro({ ok: false, cancelled: true }), false);
  assert.strictEqual(Pay.purchaseGrantsPro({ ok: false, unavailable: true }), false);
  assert.strictEqual(Pay.purchaseGrantsPro({ ok: false, error: 'x' }), false);
  assert.strictEqual(Pay.purchaseGrantsPro(null), false);
  assert.strictEqual(Pay.purchaseGrantsPro({}), false);
});

test('restoreGrantsPro: открывает Pro только при подтверждённом владении', () => {
  assert.strictEqual(Pay.restoreGrantsPro({ ok: true, purchased: true }), true);
  assert.strictEqual(Pay.restoreGrantsPro({ ok: true, purchased: false }), false);
  assert.strictEqual(Pay.restoreGrantsPro({ ok: false, purchased: true }), false);
  assert.strictEqual(Pay.restoreGrantsPro(null), false);
});

// ---------- selectPaymentAdapter: выбор реализации по окружению ----------

test('selectPaymentAdapter: браузер/дев (нет натива) → mock', () => {
  assert.strictEqual(Pay.selectPaymentAdapter({}).kind, 'mock');
  assert.strictEqual(Pay.selectPaymentAdapter({ isNativeApp: () => false }).kind, 'mock');
  // нативное, но плагина нет → НЕ mock (mock «покупает» бесплатно), а «оплата недоступна»
  assert.strictEqual(Pay.selectPaymentAdapter({ isNativeApp: () => true, NativePlugins: {} }).kind, 'unavailable');
});

test('selectPaymentAdapter: натив + плагин RuStorePay → rustore, зовёт плагин с productId', async () => {
  const calls = [];
  const fakePlugin = {
    async purchase(opts) { calls.push(['purchase', opts]); return { ok: true, purchaseId: 'rs-1' }; },
    async getPurchases(opts) { calls.push(['getPurchases', opts]); return { owned: true }; },
    async getProducts(opts) { calls.push(['getProducts', opts]); return { ok: true, priceLabel: '990 ₽' }; },
  };
  const a = Pay.selectPaymentAdapter({ isNativeApp: () => true, NativePlugins: { RuStorePay: fakePlugin } });
  assert.strictEqual(a.kind, 'rustore');

  const r = await a.purchase();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.purchaseId, 'rs-1');
  assert.deepStrictEqual(calls[0], ['purchase', { productId: Pay.PRODUCT_ID }]);

  assert.strictEqual(await a.isPurchased(), true);
  assert.deepStrictEqual(await a.restore(), { ok: true, purchased: true });
  assert.strictEqual(await a.getPriceLabel(), '990 ₽');
});

test('createRuStorePayment: отмена / недоступность / ошибка проброшены наружу', async () => {
  const mk = (res) => Pay.createRuStorePayment(
    { async purchase() { return res; }, async getPurchases() { return { owned: false }; }, async getProducts() { return { ok: false }; } },
    Pay.PRODUCT_ID);

  let r = await mk({ ok: false, cancelled: true }).purchase();
  assert.strictEqual(r.ok, false); assert.strictEqual(r.cancelled, true);

  r = await mk({ ok: false, unavailable: true }).purchase();
  assert.strictEqual(r.unavailable, true);

  r = await mk({ ok: false, error: 'Платёж не прошёл' }).purchase();
  assert.strictEqual(r.error, 'Платёж не прошёл');

  // цены нет / ошибка getProducts → null (UI покажет свою строку)
  assert.strictEqual(await mk({}).getPriceLabel(), null);
});

// ---------- mock-флоу ----------

test('mock: не куплено → покупка → куплено; restore отражает владение', async () => {
  const p = Pay.createMockPayment();
  assert.strictEqual(p.kind, 'mock');
  assert.strictEqual(await p.isPurchased(), false);
  assert.deepStrictEqual(await p.restore(), { ok: true, purchased: false });
  const r = await p.purchase();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(await p.isPurchased(), true);
  assert.deepStrictEqual(await p.restore(), { ok: true, purchased: true });
});

test('mock({owned:true}): уже куплено (симуляция восстановления на новом телефоне)', async () => {
  const p = Pay.createMockPayment({ owned: true });
  assert.strictEqual(await p.isPurchased(), true);
  assert.strictEqual((await p.restore()).purchased, true);
});

// ---------- локальный кэш владения (флаг в «localStorage») ----------

function fakeLS() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m };
}

test('флаг владения: пишется обфусцированным и читается обратно, стирается', () => {
  const st = fakeLS();
  assert.strictEqual(Pay.readFlag(st), false);
  Pay.writeFlag(true, st);
  const stored = st._m['homyak.pf'];
  assert.ok(stored && stored !== '1', 'флаг не должен лежать голым текстом');
  assert.strictEqual(Pay.readFlag(st), true);
  assert.strictEqual(Pay.deobf(Pay.obf('1')), '1', 'obf/deobf обратимы');
  Pay.writeFlag(false, st);
  assert.strictEqual(Pay.readFlag(st), false);
});
