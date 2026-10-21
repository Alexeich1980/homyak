package ru.dorokhin.budgetphone;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Reminders - напоминания о платежах по долгам (1.0.4): локальные уведомления Android.
 *
 * Почему свой плагин, а не @capacitor/local-notifications: тому нужна ещё одна зависимость
 * и синхронизация версий, а дата «31-е → последний день месяца» у него не задаётся (месяц без
 * 31-го он просто пропускает). Здесь даты считает приложение (Engine.reminderPlan, 12 месяцев
 * вперёд, проверено тестами в Node), а оболочка только хранит список и ставит ОДИН будильник
 * AlarmManager на ближайшее событие (setAndAllowWhileIdle: без точных будильников и без
 * разрешения SCHEDULE_EXACT_ALARM - плюс-минус несколько минут к 10:00 не важны).
 * Сработал - ReminderReceiver показывает уведомление и ставит следующий. Список лежит в
 * SharedPreferences, поэтому после перезагрузки телефона (BOOT_COMPLETED), обновления
 * приложения и смены времени будильник ставится заново без запуска приложения.
 *
 * JS (www/debts.js):
 *   schedule({events:[{id, at, title, text, kind}]}) → {ok, count}   - заменить весь план
 *   checkPermission()   → {granted}                              - можно ли показывать уведомления
 *   requestPermission() → {granted}                              - окно Android 13+ (POST_NOTIFICATIONS)
 *   openSettings()      → {ok}                                   - настройки уведомлений «Хомяка»
 *   test({delaySec, title, text, debt, kind}) → {ok}                 - только тест-сборка: проверка пути
 *   takeTap()           → {debtId, due} | {}                     - тап по уведомлению (забрать и забыть)
 */
@CapacitorPlugin(
    name = "Reminders",
    permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) }
)
public class ReminderPlugin extends Plugin {

    // Тап по уведомлению: MainActivity (onCreate - холодный старт, onNewIntent - приложение уже
    // открыто или в фоне) кладёт сюда id долга, JS забирает takeTap при запуске и при возврате.
    // Событие для WebView при тапе, когда приложение уже открыто (MainActivity.onNewIntent →
    // bridge.triggerJSEvent): debts.js ловит его на document и сразу забирает takeTap.
    static final String TAP_EVENT = "homyakReminderTap";
    private static final Object TAP_LOCK = new Object();
    private static String tapDebt = null, tapDue = null;
    /** Забрать тап из интента; true - в интенте был id долга/карты. */
    static boolean takeIntent(Intent i) {
        if (i == null) return false;
        String d = i.getStringExtra(ReminderReceiver.EXTRA_DEBT);
        if (d == null || d.isEmpty()) return false;
        synchronized (TAP_LOCK) {
            tapDebt = d;
            tapDue = i.getStringExtra(ReminderReceiver.EXTRA_DUE);
        }
        dropIntent(i);   // поворот экрана не откроет платёж второй раз
        return true;
    }
    /** Пометить интент обработанным: extra напоминания убрать (тот же объект - для setIntent). */
    static Intent dropIntent(Intent i) {
        if (i == null) return null;
        i.removeExtra(ReminderReceiver.EXTRA_DEBT);
        i.removeExtra(ReminderReceiver.EXTRA_DUE);
        return i;
    }

    @PluginMethod
    public void takeTap(PluginCall call) {
        JSObject r = new JSObject();
        synchronized (TAP_LOCK) {
            if (tapDebt != null) { r.put("debtId", tapDebt); r.put("due", tapDue == null ? "" : tapDue); }
            tapDebt = null; tapDue = null;
        }
        call.resolve(r);
    }

    private boolean enabled() {
        try { return NotificationManagerCompat.from(getContext()).areNotificationsEnabled(); }
        catch (Throwable t) { return false; }
    }

    private void answer(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", enabled());
        call.resolve(r);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray events = call.getArray("events");
        JSONArray clean = new JSONArray();
        int n = 0;
        try {
            if (events != null) {
                for (int i = 0; i < events.length() && n < 2000; i++) {
                    JSONObject e = events.optJSONObject(i);
                    if (e == null) continue;
                    long at = e.optLong("at", 0);
                    String title = e.optString("title", "");
                    if (at <= 0 || title.isEmpty()) continue;
                    JSONObject x = new JSONObject();
                    x.put("id", e.optString("id", "r" + i));
                    x.put("at", at);
                    x.put("title", title);
                    x.put("text", e.optString("text", ""));
                    x.put("kind", e.optString("kind", ""));
                    clean.put(x);
                    n++;
                }
            }
        } catch (Exception ex) {
            call.reject("план не прочитался", "BAD_PLAN");
            return;
        }
        ReminderReceiver.saveEvents(getContext(), ReminderReceiver.KEY_EVENTS, clean);
        ReminderReceiver.scheduleNext(getContext());
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("count", n);
        call.resolve(r);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) { answer(call); }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        // до Android 13 разрешения на уведомления нет - они включены, если хозяин не выключил в настройках
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            answer(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "permAnswered");
    }

    @PermissionCallback
    private void permAnswered(PluginCall call) { answer(call); }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= 26) {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject r = new JSObject();
            r.put("ok", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("настройки не открылись", "NO_SETTINGS");
        }
    }

    @PluginMethod
    public void test(PluginCall call) {
        int delay = Math.max(1, Math.min(600, call.getInt("delaySec", 5)));
        try {
            JSONObject x = new JSONObject();
            x.put("id", "test|" + System.currentTimeMillis());
            x.put("at", System.currentTimeMillis() + delay * 1000L);
            x.put("title", call.getString("title", "Проверка напоминания"));
            x.put("text", call.getString("text", ""));
            x.put("debt", call.getString("debt", ""));
            x.put("kind", call.getString("kind", ""));
            JSONArray t = new JSONArray();
            t.put(x);
            ReminderReceiver.saveEvents(getContext(), ReminderReceiver.KEY_TEST, t);
            ReminderReceiver.scheduleNext(getContext());
        } catch (Exception e) {
            call.reject("проверка не поставилась", "NO_TEST");
            return;
        }
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
    }
}
