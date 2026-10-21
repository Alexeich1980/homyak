/* no-issued-keys.test.js — заслон публичного репозитория: в нём не должно быть ни одного
   настоящего лицензионного ключа. Ключ правильного формата с подписью, которую принимает
   вшитый публичный ключ, открывал бы полный доступ любому, кто прочитал код.
   gitleaks такой ключ не узнаёт (формат свой), поэтому проверяем подписью. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { webcrypto: wc } = require('node:crypto');
const License = require('../www/license.js');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'build']);

function files(dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (SKIP_DIRS.has(e.name)) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, acc);
    else if (fs.statSync(p).size < 5 * 1024 * 1024) acc.push(p);
  });
  return acc;
}

test('в репозитории нет ключей, которые принимает вшитый публичный ключ', async () => {
  const re = /HOMYAK-PRO\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi;
  const found = [];
  for (const f of files(ROOT, [])) {
    const text = fs.readFileSync(f, 'latin1');
    for (const m of text.match(re) || []) {
      const r = await License.verifyLicense(m, { subtle: wc.subtle });
      if (r.valid) found.push(path.relative(ROOT, f));
    }
  }
  assert.deepEqual(found, [], 'настоящий лицензионный ключ в файлах: ' + found.join(', '));
});
