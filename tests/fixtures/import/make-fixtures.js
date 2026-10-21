#!/usr/bin/env node
/* make-fixtures.js - собирает двоичные образцы для tests/import.test.js (синтетика, не
   настоящие данные). Текстовые образцы (coinkeeper.csv, zenmoney.csv, generic-bank.tsv)
   лежат рядом как есть.
     homyak.xlsx         - выгрузка «Хомяка» (www/xlsx.js) с синтетического состояния
     own-cp1251.csv      - своя таблица: Windows-1251, «;», кавычки и перенос строки в ячейке,
                           заголовки, которые «Хомяк» не узнаёт (нужен экран сопоставления)
   node tests/fixtures/import/make-fixtures.js */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const fflate = require('fflate');
const Engine = require('../../../www/engine.js');
const Xlsx = require('../../../www/xlsx.js');
const Import = require('../../../www/import.js');

const DIR = __dirname;

function homyakState() {
  const S = Engine.defaultState();
  const food = Engine.addCategory(S, 'exp', { name: 'Продукты' });
  const cafe = Engine.addCategory(S, 'exp', { name: 'Кафе' });
  const sal = Engine.addCategory(S, 'inc', { name: 'Зарплата' });
  const card = Engine.addWallet(S, { name: 'Карта', base: 10000 });
  const cash = Engine.addWallet(S, { name: 'Наличные', base: 0 });
  card.baseTs = 0; cash.baseTs = 0;
  const add = (o, ts) => { const t = Engine.addTx(S, o); t.ts = ts; return t; };
  add({ kind: 'inc', amount: 90000, date: '2026-08-05', catId: sal.id, walletId: card.id }, 1);
  add({ kind: 'exp', amount: 1234.5, date: '2026-08-06', catId: food.id, walletId: card.id }, 2);
  add({ kind: 'exp', amount: 450, date: '2026-08-06', catId: cafe.id, walletId: cash.id }, 3);
  add({ kind: 'transfer', amount: 3000, date: '2026-08-07', walletId: card.id, toWalletId: cash.id }, 4);
  add({ kind: 'exp', amount: 2100, date: '2026-09-01', catId: food.id, walletId: card.id }, 5);
  return S;
}

// UTF-16 → Windows-1251 (обратная таблица из import.js)
function toCp1251(s) {
  const rev = {};
  for (let b = 0x80; b < 0x100; b++) rev[Import.cp1251(Uint8Array.of(b)).charCodeAt(0)] = b;
  const out = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(c < 0x80 ? c : (rev[c] != null ? rev[c] : 0x3F));
  }
  return Buffer.from(out);
}

const OWN = [
  'Когда;Сколько;На что;Откуда;Пометка',
  '01.09.2026;-1 500,00;Продукты;Карта;"обычная ""закупка"""',
  '02.09.2026;-320;Кафе;Наличные;"обед,',
  'с коллегами"',
  '03.09.2026;+45 000;Зарплата;Карта;',
  '04.09.2026;-99,90 руб.;Подписки;Карта;музыка'
].join('\r\n') + '\r\n';

if (require.main === module) {
  fs.writeFileSync(path.join(DIR, 'homyak.xlsx'), Buffer.from(Xlsx.build(homyakState(), Engine, fflate)));
  fs.writeFileSync(path.join(DIR, 'own-cp1251.csv'), toCp1251(OWN));
  console.log('ok: homyak.xlsx, own-cp1251.csv');
}
module.exports = { homyakState, toCp1251, OWN };
