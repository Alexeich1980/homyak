/* backup.js — бэкап данных в файл и восстановление из файла. Полная замена состояния
   из бэкапа; других каналов обмена данными у «Хомяка» нет. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
function pad2(n) { return (n < 10 ? '0' : '') + n; }
var T_SAVE = 30000;   // системное окно «Сохранить как» иногда долго не отвечает

// ---------- бэкап ----------
function fileName() {
  var d = new Date();
  return Engine.safeFileName(
    'Хомяк-бэкап-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.json',
    'Хомяк-бэкап.json');
}
function native() { return (window.isNativeApp && window.isNativeApp()) ? (window.NativePlugins || null) : null; }

var BACKUP_WHY = {
  NO_PICKER: 'На телефоне нет системного окна «Сохранить как». Сохрани копию другим способом.',
  NO_DATA: 'Нечего сохранять: данные не собрались. Попробуй ещё раз.',
  NO_STREAM: 'Телефон не дал записать файл в эту папку. Выбери другую папку - например, «Загрузки».',
  TIMEOUT: 'Телефон долго не отвечал на сохранение файла. Попробуй ещё раз.',
  NO_PLUGIN: 'Приложение не дотянулось до файлов телефона. Переустанови приложение.'
};
var BACKUP_DEFAULT = 'Не удалось сохранить файл. Попробуй ещё раз или в другую папку.';

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
  UI.dlgAlert(typeof why === 'string' && BACKUP_WHY[why] ? BACKUP_WHY[why] : backupWhy(why), 'Бэкап');
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
function backup() {
  var data = Engine.exportJSON(UI.S), name = fileName();
  var N = native();
  if (window.isNativeApp && window.isNativeApp()) {
    if (!N || !N.SaveFile) return Promise.resolve(backupFailed('NO_PLUGIN'));
    var timer = null;
    var clock = new Promise(function (_, reject) { timer = setTimeout(function () { reject({ code: 'TIMEOUT' }); }, T_SAVE); });
    var call = Promise.resolve().then(function () {
      return N.SaveFile.save({ name: name, mime: 'application/json', base64: toBase64(data) });
    });
    return Promise.race([call, clock])
      .then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; })
      .then(function (r) {
        if (r && r.cancelled) return null;
        if (!r || r.ok !== true) throw { code: 'NO_STREAM' };
        UI.toast('Файл сохранён: ' + name); UI.haptic('light');
        return name;
      }, function (e) { return backupFailed(e); });
  }
  var url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  var a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  UI.toast('Файл сохранён: ' + name);
  return Promise.resolve(name);
}

// ---------- восстановление ----------
function restoreText(text) {
  var st;
  try { st = Engine.importJSON(text); }
  catch (e) {
    UI.dlgAlert(e && e.message === 'schema'
      ? 'Файл повреждён - в нём нет целых данных. Возьми другой бэкап.'
      : 'Это не файл бэкапа «Хомяка».', 'Восстановление');
    return false;
  }
  UI.dlgConfirm({
    title: 'Восстановить из файла?',
    text: 'Заменить все данные приложения данными из файла?',
    danger: true, okLabel: 'Заменить',
    onOk: function () {
      UI.S = st;
      UI.save(); UI.renderInstant(); UI.haptic('medium');
      UI.toast('Восстановлено');
    }
  });
  return true;
}

// ---------- связки меню ----------
$('mBackup').addEventListener('click', function () { UI.closeMenu(); backup(); });
$('mRestore').addEventListener('click', function () {
  UI.closeMenu();
  var f = $('fileRestore');
  f.value = '';
  f.click();
});
$('fileRestore').addEventListener('change', function () {
  var file = this.files && this.files[0];
  if (!file) return;
  var fr = new FileReader();
  fr.onload = function () { restoreText(String(fr.result)); };
  fr.onerror = function () { UI.dlgAlert('Файл не прочитался.', 'Восстановление'); };
  fr.readAsText(file);
});

window.Backup = { backup: backup, restoreText: restoreText, fileName: fileName, toBase64: toBase64 };

})();
