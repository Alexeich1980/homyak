/* Т2: онбординг показывается железно на первом запуске, независимо от типа сборки.
   Условие показа - чистая функция Engine.shouldOnboard(S): true, пока флаг onboarded не
   стоит. Ни presetState (релиз), ни demoState (тест) флаг не ставят -> на свежем старте
   любой сборки онбординг показывается. Ставит флаг только кнопка «Понятно» (obDone). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../www/engine.js');
const Seed = require('../www/seed.js');

const WWW = path.join(__dirname, '..', 'www');
const src = (f) => fs.readFileSync(path.join(WWW, f), 'utf8');

test('shouldOnboard: показываем, пока onboarded не выставлен', () => {
  assert.equal(Engine.shouldOnboard(Engine.defaultState()), true, 'на чистом состоянии не показали');
  const S = Engine.defaultState();
  S.ui.onboarded = true;
  assert.equal(Engine.shouldOnboard(S), false, 'после «Понятно» снова показываем');
  // битое состояние без ui не должно уронить решение
  assert.equal(Engine.shouldOnboard({}), true, 'без ui - показываем (это первый запуск)');
  assert.equal(Engine.shouldOnboard(null), true);
});

test('shouldOnboard: и релизный пресет, и демо стартуют без флага -> онбординг покажется', () => {
  const preset = Seed.presetState(Engine);       // чистая релизная установка
  const demo = Seed.demoState(Engine, Engine.today());  // тест-сборка
  assert.equal(Engine.shouldOnboard(preset), true, 'релиз: онбординг не покажется на первом запуске');
  assert.equal(Engine.shouldOnboard(demo), true, 'тест-сборка: онбординг не покажется');
  // единственный, кто гасит онбординг, - выставленный флаг
  demo.ui.onboarded = true;
  assert.equal(Engine.shouldOnboard(demo), false);
});

test('ui.js: maybeOnboard решает показ через Engine.shouldOnboard, флаг ставит только obDone', () => {
  const u = src('ui.js');
  const mo = u.slice(u.indexOf('function maybeOnboard'), u.indexOf('function maybeOnboard') + 300);
  assert.ok(mo.indexOf('Engine.shouldOnboard') >= 0, 'maybeOnboard не спрашивает Engine.shouldOnboard');
  assert.ok(/obDone'\)\.addEventListener[\s\S]{0,160}onboarded = true/.test(u), 'флаг onboarded ставит не кнопка «Понятно»');
});
