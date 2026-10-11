/* backup.js — бэкап данных в файл и восстановление из файла. Полная замена состояния
   из бэкапа; других каналов обмена данными у «Хомяка» нет. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
function pad2(n) { return (n < 10 ? '0' : '') + n; }

// ---------- бэкап ----------
function fileName() {
  var d = new Date();
  return Engine.safeFileName(
    'Хомяк-бэкап-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.json',
    'Хомяк-бэкап.json');
}
// Дата последней удачной копии - для напоминания «сохрани копию» (nudges.js). Отдельный
// ключ рядом с данными, не в S: S уезжает в сам файл бэкапа.
var STAMP_KEY = UI.KEY + '.backup';
function markBackup() {
  try {
    var s = JSON.parse(localStorage.getItem(STAMP_KEY) || 'null');
    if (!s || typeof s !== 'object') s = {};
    s.lastAt = Date.now();
    localStorage.setItem(STAMP_KEY, JSON.stringify(s));
  } catch (e) {}
  if (window.Nudges && window.Nudges.hideRemind) window.Nudges.hideRemind();
}
// системное окно «Сохранить как» / выбор файла уводит приложение в фон - это не уход
// хозяина, «Защита входа» после возврата не запирает (lock.js). ms - вызов с ответом
// (AppLock.AWAY_CALL): отметка живёт, пока он идёт; release() - вызов кончился.
function away(ms) {
  var r = (window.AppLock && window.AppLock.away) ? window.AppLock.away(ms) : null;
  return typeof r === 'function' ? r : function () {};
}

function native() { return (window.isNativeApp && window.isNativeApp()) ? (window.NativePlugins || null) : null; }

var BACKUP_WHY = {
  NO_PICKER: 'На телефоне нет системного окна «Сохранить как». Сохраните копию другим способом.',
  NO_DATA: 'Нечего сохранять: данные не собрались. Попробуйте ещё раз.',
  NO_STREAM: 'Телефон не дал записать файл в эту папку. Выберите другую папку - например, «Загрузки».',
  TIMEOUT: 'Телефон долго не отвечал на сохранение файла. Попробуйте ещё раз.',
  NO_PLUGIN: 'Приложение не дотянулось до файлов телефона. Переустановите приложение.'
};
var BACKUP_DEFAULT = 'Не удалось сохранить файл. Попробуйте ещё раз или выберите другую папку.';

function backupWhy(e) {
  var code = (e && typeof e.code === 'string') ? e.code : '';
  if (code && BACKUP_WHY[code]) return BACKUP_WHY[code];
  var msg = (e && e.message) ? String(e.message) : String(e || '');
  if (BACKUP_WHY[msg]) return BACKUP_WHY[msg];
  if (/^телефон не открыл файл на запись$/.test(msg)) return BACKUP_WHY.NO_STREAM;
  if (/^нечего сохранять$/.test(msg)) return BACKUP_WHY.NO_DATA;
  return BACKUP_DEFAULT;
}
function backupFailed(why) {
  UI.dlgAlert(typeof why === 'string' && BACKUP_WHY[why] ? BACKUP_WHY[why] : backupWhy(why), 'Копия данных');
  return null;
}

// btoa не умеет кириллицу и роняется на длинных строках: сначала UTF-8 байты, потом кусками
function toBase64(str) {
  var bytes;
  if (typeof TextEncoder === 'function') bytes = new TextEncoder().encode(str);
  else {
    var esc = unescape(encodeURIComponent(str));
    bytes = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) bytes[i] = esc.charCodeAt(i);
  }
  var out = '', CH = 0x8000;
  for (var j = 0; j < bytes.length; j += CH) out += String.fromCharCode.apply(null, bytes.subarray(j, j + CH));
  return btoa(out);
}

// На телефоне — системное окно «Сохранить как» (SAF). В браузере — обычная ссылка.
// Таймаута на окне выбора папки НЕТ (1.0.3, как в «Пенсии» 1.0.5): оно интерактивное,
// человек может выбирать папку сколько угодно, а таймеры JS при этом идут - прежние 30 с
// давали ложное «долго не отвечал», хотя файл потом всё равно сохранялся.
// opts.timeout - только для проверок (self-test/node-тест).
//
// Данные не прочитались (ui.js loadProblem): на экране сид, а не данные хозяина. Пока запись
// запрещена (UI.isReadOnly), обычная копия сохранила бы пустые данные под обычным именем и
// заглушила бы напоминание на месяц - вместо неё окно «Данные не прочитались» с кнопкой
// «Сохранить повреждённые данные в файл». Запись разрешена (копия порченого в карантине),
// но из файла ещё не восстанавливали - файл сохраняем (в нём уже новые записи), а копией
// для напоминания не засчитываем (ревью 1.0.3).
var NO_COPY_NOW = 'Обычную копию сейчас сохранить нельзя: в ней оказались бы пустые данные.';
function backup(opts) {
  if (UI.isReadOnly && UI.isReadOnly()) {
    if (UI.showProblem) UI.showProblem(NO_COPY_NOW);
    else UI.dlgAlert(NO_COPY_NOW, 'Копия данных');
    return Promise.resolve(null);
  }
  var mark = !(UI.seedAfterBroken && UI.seedAfterBroken());
  return saveFile(Engine.exportJSON(UI.S), fileName(), 'application/json', mark, opts);
}

// Повреждённые данные (окно «Данные не прочитались» в ui.js) - тем же окном «Сохранить
// как», как есть, чтобы хозяин мог отдать файл автору на разбор. Это не копия данных:
// дату копии не пишем, напоминание о копии не гасим.
function rawFileName() {
  var d = new Date();
  return Engine.safeFileName(
    'Хомяк-повреждённые-данные-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.txt',
    'Хомяк-повреждённые-данные.txt');
}
function saveRaw(raw, opts) {
  if (raw == null || raw === '') { UI.dlgAlert('Повреждённых данных на телефоне уже нет - сохранять нечего.', 'Сохранение'); return Promise.resolve(null); }
  return saveFile(String(raw), rawFileName(), 'text/plain', false, opts);
}

// mark - засчитать файл копией данных (для напоминания «сохрани копию»)
function saveFile(data, name, mime, mark, opts) {
  var N = native();
  if (window.isNativeApp && window.isNativeApp()) {
    if (!N || !N.SaveFile) return Promise.resolve(backupFailed('NO_PLUGIN'));
    var timer = null;
    var limit = (opts && opts.timeout) || 0;
    var clock = limit
      ? new Promise(function (_, reject) { timer = setTimeout(function () { reject({ code: 'TIMEOUT' }); }, limit); })
      : new Promise(function () {});
    var release = away(window.AppLock && window.AppLock.AWAY_CALL);
    var call = Promise.resolve().then(function () {
      return N.SaveFile.save({ name: name, mime: mime, base64: toBase64(data) });
    });
    return Promise.race([call, clock])
      .then(function (r) { clearTimeout(timer); release(); return r; }, function (e) { clearTimeout(timer); release(); throw e; })
      .then(function (r) {
        if (r && r.cancelled) return null;
        if (!r || r.ok !== true) throw { code: 'NO_STREAM' };
        if (mark) markBackup();
        UI.toast('Файл сохранён: ' + name); UI.haptic('light');
        return name;
      }, function (e) { return backupFailed(e); });
  }
  var url = URL.createObjectURL(new Blob([data], { type: mime }));
  var a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  if (mark) markBackup();
  UI.toast('Файл сохранён: ' + name);
  return Promise.resolve(name);
}

// ---------- восстановление ----------
function restoreText(text) {
  var st;
  // метку демо из файла держит только тест-сборка: в релизе бэкап с тестовой сборки -
  // это настоящие данные, плашки «Очистить демо» (стирает всё) у них быть не должно
  try { st = Engine.importJSON(text, { keepDemo: !!(window.Access && window.Access.DEMO) }); }
  catch (e) {
    UI.dlgAlert(e && e.message === 'schema'
      ? 'Файл повреждён - в нём нет целых данных. Возьмите другую копию.'
      : 'Это не файл копии данных «Хомяка».', 'Восстановление');
    return false;
  }
  UI.dlgConfirm({
    title: 'Восстановить из файла?',
    text: 'Заменить все данные приложения данными из файла?',
    danger: true, okLabel: 'Заменить',
    onOk: function () {
      UI.S = st;
      // восстановление из файла - осознанная замена всех данных: снимаем запрет записи,
      // если данные не прочитались на запуске (ui.js load)
      if (UI.allowWrite) UI.allowWrite();
      UI.save(); UI.renderInstant(); UI.haptic('medium');
      UI.toast('Восстановлено');
    }
  });
  return true;
}

// ---------- связки меню ----------
// 1.0.3: кнопки «Сохранить копию в файл» и «Восстановить из файла» живут в подменю «Копия
// данных» (ui.js openCopy) и зовут backup() и pickRestore() отсюда.
function pickRestore() {
  var f = $('fileRestore');
  f.value = '';
  away();
  f.click();
}
$('fileRestore').addEventListener('change', function () {
  var file = this.files && this.files[0];
  if (!file) return;
  var fr = new FileReader();
  fr.onload = function () { restoreText(String(fr.result)); };
  fr.onerror = function () { UI.dlgAlert('Файл не прочитался.', 'Восстановление'); };
  fr.readAsText(file);
});

window.Backup = { STAMP_KEY: STAMP_KEY, markBackup: markBackup, backup: backup, pickRestore: pickRestore, saveRaw: saveRaw, restoreText: restoreText, fileName: fileName, toBase64: toBase64 };

})();
