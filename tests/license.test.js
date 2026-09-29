/* license.test.js — офлайн-активация Полного доступа лицензионным ключом (ECDSA P-256).
   Заслон: валидный ключ (подписан приватным ключом Алексея) проходит против ВШИТОГО
   публичного ключа → PRO, лимиты сняты; ключ с чужим product ("seyf") НЕ подходит;
   битая подпись/испорченный ключ отвергается; подделка хранилища (флаг true без валидного
   ключа) → на ре-проверке PRO снимается. Данные пользователя при этом не трогаются. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto: wc } = require('node:crypto');
const License = require('../www/license.js');
const Engine = require('../www/engine.js');

const subtle = wc.subtle;

// Настоящий ключ, подписанный приватным ключом автора, в публичный репозиторий не входит:
// он открывал бы полный доступ. Проверки с ним идут, только если передать ключ через
// переменную окружения HOMYAK_TEST_KEY. Остальные проверки берут ключ правильного формата,
// подписанный свежей парой ключей: вшитым публичным ключом он не проходит.
const VALID_KEY = process.env.HOMYAK_TEST_KEY || '';
const NO_KEY = !VALID_KEY && 'настоящий ключ автора не публикуется (HOMYAK_TEST_KEY)';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// подписать произвольный payload заданной парой ключей и собрать ключ в формате «Хомяка»
async function signKey(kp, payloadObj) {
  const bytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes));
  return License.PREFIX + b64u(bytes) + '.' + b64u(sig);
}

// ключ правильного формата от свежей пары: для проверок порчи и обфускации
async function sampleKey() {
  if (VALID_KEY) return VALID_KEY;
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return signKey(kp, { product: 'homyak', id: 'SAMPLE000001', iat: 1 });
}

// простой mock localStorage
function mockLS() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _dump: () => Object.fromEntries(m),
  };
}

// ---------- 1. валидный ключ включает PRO и снимает гейт ----------
test('валидный ключ → PRO против вшитого ключа, и гейт 2/8/1 снят', { skip: NO_KEY }, async () => {
  const r = await License.verifyLicense(VALID_KEY, { subtle });
  assert.equal(r.valid, true, 'реальный тест-ключ обязан пройти проверку вшитым ключом');
  assert.equal(r.payload.product, 'homyak');

  // гейт: без доступа 3-й кошелёк нельзя, с валидным ключом (full=true) — можно
  const S = Engine.defaultState();
  Engine.addWallet(S, { name: 'W1' }); Engine.addWallet(S, { name: 'W2' });
  assert.equal(Engine.canAddWallet(S, false), false, 'free-лимит 2 кошелька должен держать');
  const full = r.valid;                 // так же, как UI.hasFullAccess → full() в edit.js
  assert.equal(Engine.canAddWallet(S, full), true, 'валидный ключ снимает лимит');
  // 9-я расходная и 2-й доход тоже открываются
  for (let i = 0; i < 8; i++) Engine.addCategory(S, 'exp', { name: 'C' + i });
  Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  assert.equal(Engine.canAddExpCat(S, false), false);
  assert.equal(Engine.canAddExpCat(S, full), true);
  assert.equal(Engine.canAddIncCat(S, false), false);
  assert.equal(Engine.canAddIncCat(S, full), true);
});

// ---------- 2. ключ с чужим product НЕ подходит ----------
test('ключ с product="seyf" (даже с валидной для него подписью) → отвергается', async () => {
  // подпишем «сейфовый» payload СВЕЖЕЙ парой и проверим тем же путём verifyToken её же
  // публичным ключом: подпись верна, но продукт чужой → parseLicenseKey отдаёт null → format.
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const foreign = await signKey(kp, { product: 'seyf', id: 'x', iat: 1 });
  assert.equal(License.parseLicenseKey(foreign), null, 'чужой product не должен разбираться');
  const pub = await subtle.importKey('raw', await subtle.exportKey('raw', kp.publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const r = await License.verifyToken(foreign, pub, subtle);
  assert.equal(r.valid, false, 'ключ чужого продукта не даёт доступ');
  assert.equal(r.reason, 'format');

  // и обратно: наш homyak-ключ, подписанный этой чужой парой, не проходит вшитым ключом
  const homyakForeignSigner = await signKey(kp, { product: 'homyak', id: 'x', iat: 1 });
  assert.equal((await License.verifyLicense(homyakForeignSigner, { subtle })).valid, false,
    'homyak-ключ от чужого подписанта вшитым ключом не проходит');
});

// ---------- 3. битая подпись / испорченный ключ отвергается ----------
test('порча подписи и мусор → отказ', async () => {
  const KEY = await sampleKey();
  const bad = KEY.slice(0, -3) + (KEY.slice(-3, -2) === 'A' ? 'B' : 'A') + KEY.slice(-2);
  const r = await License.verifyLicense(bad, { subtle });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'signature');

  // подмена payload старой подписью
  const p = License.parseLicenseKey(KEY);
  const forged = { ...p.payload, id: 'HACKED000001' };
  const key = License.PREFIX + b64u(new TextEncoder().encode(JSON.stringify(forged))) + '.' + p.sigB64;
  assert.equal((await License.verifyLicense(key, { subtle })).valid, false, 'старая подпись не покрывает новый payload');

  // явный мусор и неполный ключ
  for (const junk of ['', 'привет', 'HOMYAK-PRO.onlyonepart', 'HOMYAK-PRO.eyJhIjoxfQ.AAAA']) {
    assert.equal(License.parseLicenseKey(junk), null, 'мусор должен давать null: ' + JSON.stringify(junk));
  }
});

// ---------- 4. подделка хранилища: флаг true без валидного ключа → PRO снимается ----------
test('флаг true без валидного ключа → verifyStored снимает PRO и гасит флаг', async () => {
  const st = mockLS();
  // злоумышленник вручную поднял обфусцированный кэш-флаг, ключа нет
  License.writeFlag(true, st);
  assert.equal(License.readFlag(st), true, 'флаг поднят (имитация подделки)');
  const r = await License.verifyStored({ storage: st, subtle });
  assert.equal(r.active, false, 'без валидного ключа доступ не даётся');
  assert.equal(License.readFlag(st), false, 'флаг сброшен на ре-проверке');

  // флаг true + ИСПОРЧЕННЫЙ ключ в хранилище → тоже снимается
  const st2 = mockLS();
  License.writeFlag(true, st2);
  License.storeKey((await sampleKey()).slice(0, -4) + 'AAAA', st2);   // битая подпись
  const r2 = await License.verifyStored({ storage: st2, subtle });
  assert.equal(r2.active, false, 'испорченный ключ не даёт доступ');
  assert.equal(License.readFlag(st2), false);
});

test('валидный ключ в хранилище → ре-проверка подтверждает PRO', { skip: NO_KEY }, async () => {
  const st3 = mockLS();
  License.storeKey(VALID_KEY, st3);
  const r3 = await License.verifyStored({ storage: st3, subtle });
  assert.equal(r3.active, true, 'валидный ключ в хранилище → PRO');
  assert.equal(License.readFlag(st3), true, 'флаг подтверждён ре-проверкой');
});

// ---------- обфускация: ключ не лежит голым текстом, но восстановим ----------
test('обфускация обратима и не хранит ключ открытым', async () => {
  const KEY = await sampleKey();
  const st = mockLS();
  License.storeKey(KEY, st);
  const stored = st._dump()['homyak.lic'];
  assert.ok(stored && stored.indexOf('HOMYAK-PRO.') === -1, 'ключ не должен лежать открытым текстом');
  assert.equal(License.loadStoredKey(st), KEY, 'ключ восстанавливается из обфускации');
});

// ---------- вшитый публичный ключ импортируется (не битый) ----------
test('вшитый публичный ключ корректно импортируется', async () => {
  const pub = await License.importPublicKey(License.PUB_KEY_B64, subtle);
  assert.ok(pub);
});
