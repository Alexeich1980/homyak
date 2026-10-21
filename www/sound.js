/* sound.js — короткие звуки на четыре события: записал расход, записал доход, сделал
   перевод, вышел за план. Файлы лежат в www/sounds/ и НЕ обязаны существовать: пока их
   не положили, приложение просто молчит.

   Правила, из-за которых файл написан именно так:
     - никаких «а вдруг есть»: имя звука проверяется по белому списку, всё остальное
       игнорируется молча (так в play() нельзя случайно передать имя файла);
     - грузим лениво, на первом обращении: холодный старт приложения не должен
       тащить четыре файла, которых, может, и нет;
     - mp3, если его нет - ogg, если нет и его - имя помечается «файла нет» и больше
       не дёргается;
     - play() НИКОГДА не бросает и ничего не возвращает наружу, кроме true/false:
       звук - украшение, из-за него не должна падать запись расхода;
     - выключатель «Звук» в меню (S.ui.sound) спрашиваем на каждом вызове, а не при
       загрузке: настройку меняют, не перезапуская приложение.

   В node (тесты) window/Audio нет: файл экспортирует NAMES и isName, а play()
   честно отвечает false. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // белый список: ровно эти четыре события, других звуков в приложении нет
  var NAMES = ['expense', 'income', 'transfer', 'over'];   // только денежные операции
  var EXT = ['mp3', 'ogg'];
  var DIR = 'sounds/';
  var VOL = 0.7;

  var cache = {};        // имя → Audio | null (null = файла нет, больше не пробуем)

  function isName(n) { return NAMES.indexOf(n) >= 0; }

  function enabled() {
    try {
      var S = (typeof window !== 'undefined' && window.UI) ? window.UI.S : null;
      return !(S && S.ui && S.ui.sound === false);
    } catch (e) { return false; }
  }

  // Audio с запасным форматом: на ошибке mp3 переключаемся на ogg, на второй ошибке
  // ставим метку «файла нет». Никаких HEAD-запросов - ответ даёт сам элемент.
  function make(name) {
    var a = new Audio(DIR + name + '.' + EXT[0]);
    var step = 0;
    a.preload = 'auto';
    a.volume = VOL;
    a.addEventListener('error', function () {
      step++;
      if (step < EXT.length) {
        try { a.src = DIR + name + '.' + EXT[step]; a.load(); } catch (e) { cache[name] = null; }
        return;
      }
      cache[name] = null;
    });
    try { a.load(); } catch (e) {}
    return a;
  }

  function play(name) {
    try {
      if (!isName(name)) return false;
      if (!enabled()) return false;
      if (typeof Audio !== 'function') return false;      // node и старые движки
      if (cache[name] === null) return false;             // уже знаем: файла нет
      var a = cache[name] || (cache[name] = make(name));
      try { a.currentTime = 0; } catch (e) {}
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
      return true;
    } catch (e) { return false; }
  }

  // для self-test: забыть, что уже загружено (иначе проверка «файла нет» липнет)
  function reset() { cache = {}; }

  return { NAMES: NAMES, EXT: EXT, DIR: DIR, isName: isName, play: play, reset: reset };
});
