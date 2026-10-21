/* debts-shell.test.js - оболочка напоминаний о долгах (1.0.4): свой плагин Reminders
   (ReminderPlugin/ReminderReceiver), разрешения манифеста и их описание в политике и в
   «Данных для Консоли», тексты экрана долгов (на «вы», дефис, без нативных окон),
   кнопка проверки напоминания - не в стор-сборке. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = 'android/app/src/main/java/ru/dorokhin/budgetphone/';

test('оболочка: плагин Reminders зарегистрирован до super.onCreate, приёмник закрыт и переживает перезагрузку', () => {
  const main = rd(J + 'MainActivity.java');
  const reg = main.indexOf('registerPlugin(ReminderPlugin.class)');
  assert.ok(reg > 0 && reg < main.indexOf('super.onCreate(savedInstanceState)'), 'плагин регистрируется после super.onCreate');
  const m = rd('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');   // комментарии не в счёт
  const rc = /<receiver\s+android:name="\.ReminderReceiver"\s+android:exported="false">([\s\S]*?)<\/receiver>/.exec(m);
  assert.ok(rc, 'нет закрытого приёмника ReminderReceiver');
  ['BOOT_COMPLETED', 'MY_PACKAGE_REPLACED', 'TIME_SET', 'TIMEZONE_CHANGED'].forEach((a) =>
    assert.ok(rc[1].indexOf('android.intent.action.' + a) > 0, 'приёмник не ловит ' + a));
  assert.ok(m.indexOf('SCHEDULE_EXACT_ALARM') < 0 && m.indexOf('USE_EXACT_ALARM') < 0, 'точные будильники не нужны');
  const plug = rd(J + 'ReminderPlugin.java'), recv = rd(J + 'ReminderReceiver.java');
  assert.match(plug, /@CapacitorPlugin\(\s*name = "Reminders"/);
  assert.match(plug, /android\.permission\.POST_NOTIFICATIONS/);
  ['schedule', 'checkPermission', 'requestPermission', 'openSettings', 'test'].forEach((f) =>
    assert.match(plug, new RegExp('@PluginMethod\\s+public void ' + f + '\\(')));
  // неточный будильник, переживающий режим сна; без setExact*
  assert.match(recv, /setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/);
  assert.ok(!/setExact/.test(recv), 'точный будильник');
  assert.match(recv, /FLAG_IMMUTABLE/);
  assert.match(recv, /getLaunchIntentForPackage/);   // тап открывает приложение (замок - lock.js)
  assert.ok(fs.existsSync(path.join(ROOT, 'android/app/src/main/res/drawable/ic_stat_reminder.xml')), 'нет значка уведомления');
  assert.match(rd('www/native.js'), /Reminders: C\.registerPlugin\('Reminders'\)/);
});

test('разрешения напоминаний описаны в политике и в «Данных для Консоли»', () => {
  const pr = rd('legal/privacy.html');
  assert.match(pr, /POST_NOTIFICATIONS/);
  assert.match(pr, /RECEIVE_BOOT_COMPLETED - если включены\s+напоминания/);
  assert.match(pr, /Редакция от 15\.10\.2026/);
  assert.match(pr, /кредитным картам/);   // 15.10: напоминания и по кредитке
  assert.match(pr, /без сумм/);
  const home = os.homedir();
  const cands = [path.join(home, 'OneDrive', 'Рабочий стол'), path.join(home, 'Desktop'), path.join(home, 'Рабочий стол')]
    .map((d) => path.join(d, 'Хомяк-RuStore-публикация', 'Данные для Консоли.txt')).filter((p) => fs.existsSync(p));
  if (!cands.length) return;   // файл живёт только на ПК Алексея
  const c = fs.readFileSync(cands[0], 'utf8');
  assert.match(c, /POST_NOTIFICATIONS \(с версии 1\.0\.4\)/);
  assert.match(c, /RECEIVE_BOOT_COMPLETED - с версии 1\.0\.4/);
});

test('тексты долгов: на «вы», дефис вместо тире, без нативных окон, проверка - только тест-сборка', () => {
  const src = rd('www/debts.js');
  assert.ok(src.indexOf('—') < 0, 'длинное тире в debts.js');
  assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(src.replace(/dlg(Alert|Confirm|Prompt)/g, '')), 'нативное окно');
  // строки для человека: без «ты»-форм (кириллица - границы слова руками, \b в JS только ASCII)
  const strs = (src.match(/'[^'\n]*[А-Яа-яЁё][^'\n]*'/g) || []).join(' ');
  assert.ok(!/(^|[^А-Яа-яЁё])(ты|тебе|тебя|твой|твои|твоего|нажми|выбери|запиши|заведи)(?![А-Яа-яЁё])/i.test(strs), 'обращение на «ты»');
  assert.match(src, /function testBuild\(\) \{ return !\(window\.Access && window\.Access\.RELEASE\); \}/);
  assert.match(src, /testBuild\(\) && rmOn \? '<button[^']*id="dbTest"/);
  // текст баннера просрочки - из концепции
  assert.ok(src.indexOf('нет платежа за') > 0 && src.indexOf('Если уже заплатили - запишите платёж. ') > 0 &&
    src.indexOf('Если пропустили - банк начислит пени и проценты за просрочку: проверьте остаток долга в приложении банка и поправьте его кнопкой «Поправить остаток».') > 0);
  // совет при нагрузке выше 30% - из концепции
  assert.match(rd('www/summary.js'), /высокий риск просрочек\. Направьте свободные деньги на досрочное погашение с сокращением ежемесячного платежа/);
});

test('уведомление: на экране блокировки - без названия долга (VISIBILITY_PRIVATE + публичная версия); FileProvider - только cache/export', () => {
  const recv = rd(J + 'ReminderReceiver.java');
  assert.ok(recv.indexOf('VISIBILITY_PUBLIC') < 0, 'полное уведомление видно на экране блокировки');
  assert.match(recv, /\.setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(recv, /\.setPublicVersion\(new NotificationCompat\.Builder\(ctx, CHANNEL\)[\s\S]{0,200}\.setContentTitle\(publicTitle\(kind\)\)/);
  assert.match(recv, /PUBLIC_TITLE = "Напоминание о платеже по долгу";/);
  // публичная версия не берёт ни заголовок, ни текст события (там название долга)
  const at = recv.indexOf('.setPublicVersion(');
  const pub = recv.slice(at, recv.indexOf('.build())', at));
  assert.ok(!/\b(title|text)\b/.test(pub), 'в публичной версии - данные события: ' + pub);
  const fp = rd('android/app/src/main/res/xml/file_paths.xml').replace(/<!--[\s\S]*?-->/g, '');
  const paths = fp.match(/<[a-z-]+-path\b[^>]*>/g) || [];
  assert.deepStrictEqual(paths, ['<cache-path name="export" path="export/" />'], 'FileProvider отдаёт больше, чем cache/export: ' + paths.join(' '));
  assert.match(rd(J + 'ShareFilePlugin.java'), /new File\(getContext\(\)\.getCacheDir\(\), "export"\)/);
});

test('подпись напоминания в карточке долга - текст владельца (12.10, «платежа» вместо «списания» 14.10)', () => {
  const src = rd('www/debts.js');
  assert.ok(src.indexOf("(owe ? 'Накануне и в день платежа. В\\u00a010:00' : 'Накануне и в день возврата. В\\u00a010:00')") > 0);
  assert.ok(src.indexOf('в день списания') < 0, '«в день списания» осталось');
  assert.ok(src.indexOf('за день и в сам день, в 10:00') < 0, 'старая подпись осталась');
});

test('подсказка под ставкой - текст владельца (14.10): сколько из платежа ушло на проценты', () => {
  const src = rd('www/debts.js');
  assert.ok(src.indexOf('Укажите ставку - «Хомяк» покажет, сколько из платежа ушло на проценты, а сколько в счёт долга. Проценты считаются раз в месяц, в первом платеже. Не знаете ставку - оставьте пустым') > 0);
  assert.ok(src.indexOf('сам отделит проценты') < 0, 'подсказка 12.10 осталась');
  assert.ok(src.indexOf('Со ставкой первый платёж месяца сначала гасит проценты') < 0, 'старая подсказка осталась');
});

test('тап по напоминанию: id долга extra-ом в интенте (свой requestCode на долг, IMMUTABLE), холодный старт и открытое приложение', () => {
  const recv = rd(J + 'ReminderReceiver.java'), plug = rd(J + 'ReminderPlugin.java'), main = rd(J + 'MainActivity.java');
  assert.match(recv, /open\.putExtra\(EXTRA_DEBT, debt\)/);
  assert.match(recv, /int code = \(debt != null && !debt\.isEmpty\(\)\) \? \("debt:" \+ debt\)\.hashCode\(\) : id\.hashCode\(\);/);
  assert.match(recv, /PendingIntent\.getActivity\(ctx, code, open, flags\)/);
  assert.match(recv, /FLAG_IMMUTABLE/);
  assert.match(plug, /@PluginMethod\s+public void takeTap\(/);
  assert.match(main, /super\.onCreate\(savedInstanceState\);[\s\S]*ReminderPlugin\.takeIntent\(getIntent\(\)\);/);
  assert.match(main, /onNewIntent\(Intent intent\)[\s\S]{0,600}ReminderPlugin\.takeIntent\(intent\)/);
  const src = rd('www/debts.js');
  assert.match(src, /return testCall\(p, \{ delaySec: 5, debt: d\.id, kind: 'debt',/);
  assert.match(src, /setTimeout\(function \(\) \{ try \{ checkTap\(\); \} catch \(e\) \{\} \}, 800\);/);
  assert.match(src, /setTimeout\(function \(\) \{ try \{ checkTap\(\); \} catch \(e\) \{\} \}, 300\);/);
});

// Ревью 12.10 №8, №9 (без телефона - заслон по исходнику оболочки):
// №9: BridgeActivity.load() внутри super.onCreate сам зовёт onNewIntent(getIntent()) - повтор
//     интента запуска. Напоминание из него берёт только onCreate и только при свежем запуске:
//     не восстановление (savedInstanceState) и не «Недавние» (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
//     интент после разбора помечен обработанным (extra убраны, setIntent).
// №8: тап при открытом приложении - onNewIntent сразу шлёт событие в WebView, JS ловит его на document.
test('оболочка: тап по напоминанию - событие сразу в WebView; повтор интента и «Недавние» второго окна не открывают', () => {
  const main = rd(J + 'MainActivity.java'), plug = rd(J + 'ReminderPlugin.java'), js = rd('www/debts.js');
  // почему нужен флаг started: Capacitor сам повторяет интент запуска через onNewIntent
  const ba = path.join(ROOT, 'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java');
  if (fs.existsSync(ba)) assert.match(fs.readFileSync(ba, 'utf8'), /this\.onNewIntent\(getIntent\(\)\);/, 'Capacitor больше не повторяет интент - пересмотреть заслон');
  // №9
  assert.match(main, /static boolean freshLaunch\(Bundle saved, Intent i\) \{\s*return saved == null && i != null && \(i\.getFlags\(\) & Intent\.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY\) == 0;/,
    'свежий запуск: без savedInstanceState и не из «Недавних»');
  assert.match(main, /if \(freshLaunch\(savedInstanceState, getIntent\(\)\)\) ReminderPlugin\.takeIntent\(getIntent\(\)\);\s*setIntent\(ReminderPlugin\.dropIntent\(getIntent\(\)\)\);/,
    'onCreate: тап только при свежем запуске, интент помечен обработанным');
  assert.strictEqual((main.match(/ReminderPlugin\.takeIntent\(/g) || []).length, 2, 'лишний вызов takeIntent без заслона');
  assert.ok(main.indexOf('started = true;') > main.indexOf('super.onCreate(savedInstanceState);'), 'started ставится до конца super.onCreate');
  const oni = main.slice(main.indexOf('protected void onNewIntent'));
  const guard = oni.indexOf('if (!started) return;');
  assert.ok(guard > 0 && guard < oni.indexOf('ReminderPlugin.takeIntent(intent)'), 'onNewIntent разбирает повтор интента запуска из super.onCreate');
  assert.match(plug, /static Intent dropIntent\(Intent i\) \{[\s\S]*?removeExtra\(ReminderReceiver\.EXTRA_DEBT\);[\s\S]*?removeExtra\(ReminderReceiver\.EXTRA_DUE\);/);
  // №8
  assert.match(oni, /if \(ReminderPlugin\.takeIntent\(intent\)\) \{\s*setIntent\(ReminderPlugin\.dropIntent\(intent\)\);\s*try \{ getBridge\(\)\.triggerJSEvent\(ReminderPlugin\.TAP_EVENT, "document"\); \}/,
    'onNewIntent не шлёт событие в WebView');
  assert.match(plug, /static final String TAP_EVENT = "homyakReminderTap";/);
  assert.match(plug, /synchronized \(TAP_LOCK\) \{\s*if \(tapDebt != null\)/, 'takeTap забирает тап атомарно (событие и возврат в приложение)');
  assert.match(js, /document\.addEventListener\('homyakReminderTap', function \(\) \{ try \{ checkTap\(\); \} catch \(e\) \{\} \}\);/, 'JS не слушает событие оболочки');
});
