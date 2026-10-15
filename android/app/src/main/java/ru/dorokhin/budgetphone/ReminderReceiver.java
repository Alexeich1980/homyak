package ru.dorokhin.budgetphone;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Будильник напоминаний (1.0.4, см. ReminderPlugin): показывает наступившие уведомления и ставит
 * следующий будильник. Тот же приёмник ловит перезагрузку телефона, обновление приложения и
 * смену времени/часового пояса - и просто переставляет будильник по сохранённому плану.
 *
 * Уведомление без сумм; на экране блокировки - только «Напоминание о платеже по долгу», у кредитки - «Напоминание
 * о погашении кредитной карты» (kind "credit"; публичная
 * версия, VISIBILITY_PRIVATE), название долга видно на разблокированном телефоне.
 * Тап открывает приложение (если включена «Защита входа» - сначала замок, его ставит lock.js).
 */
public class ReminderReceiver extends BroadcastReceiver {

    static final String ACTION_FIRE = "ru.dorokhin.homyak.REMINDER_FIRE";
    static final String PREFS = "homyak_reminders";
    static final String KEY_EVENTS = "events";
    static final String KEY_TEST = "test";
    static final String CHANNEL = "debt_reminders";
    // Будильник опоздал (телефон был выключен) - показываем, если с даты прошло не больше
    // 20 часов: «Сегодня платёж» к вечеру ещё уместно, вчерашнее - уже нет.
    static final long LATE_MAX = 20L * 3600 * 1000;
    // Неточный будильник может сработать чуть раньше - событие в пределах минуты считаем наступившим.
    static final long EARLY = 60L * 1000;
    // что видно на экране блокировки вместо названия долга
    static final String PUBLIC_TITLE = "Напоминание о платеже по долгу";
    // у кредитки своя общая строка (без названия карты); вид - поле kind события плана
    static final String PUBLIC_TITLE_CARD = "Напоминание о платеже по кредитной карте";

    // kind из плана (engine.js reminderPlan, debts.js testCardReminder): "credit" - кредитка
    static String publicTitle(String kind) {
        return "credit".equals(kind) ? PUBLIC_TITLE_CARD : PUBLIC_TITLE;
    }
    // план, сохранённый до этой правки, без kind: вид по заголовку (там «кредитной карты»)
    static String kindOf(JSONObject e) {
        String k = e.optString("kind", "");
        if (k.isEmpty() && e.optString("title", "").contains("кредитной карты")) return "credit";
        return k;
    }
    // тап по уведомлению открывает платёж по ЭТОМУ долгу (debts.js openFromReminder):
    // id долга и дата срока едут extra'ми в интенте запуска, MainActivity отдаёт их плагину
    static final String EXTRA_DEBT = "ru.dorokhin.homyak.REMINDER_DEBT";
    static final String EXTRA_DUE = "ru.dorokhin.homyak.REMINDER_DUE";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent != null ? intent.getAction() : null;
        if (ACTION_FIRE.equals(a)) fireDue(ctx);
        scheduleNext(ctx);
    }

    static JSONArray loadEvents(Context ctx, String key) {
        try {
            String s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "[]");
            return new JSONArray(s == null ? "[]" : s);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static void saveEvents(Context ctx, String key, JSONArray list) {
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        ed.putString(key, list.toString());
        ed.commit();
    }

    // показать наступившие, убрать их (и слишком старые) из плана
    static void fireDue(Context ctx) {
        long now = System.currentTimeMillis();
        for (String key : new String[] { KEY_EVENTS, KEY_TEST }) {
            JSONArray list = loadEvents(ctx, key), rest = new JSONArray();
            for (int i = 0; i < list.length(); i++) {
                JSONObject e = list.optJSONObject(i);
                if (e == null) continue;
                long at = e.optLong("at", 0);
                if (at > now + EARLY) { rest.put(e); continue; }
                if (now - at <= LATE_MAX) {
                    // id события плана: «<id долга>|<дата срока>|b/d»; у проверки - поле debt
                    String id = e.optString("id", "r"), debt = e.optString("debt", ""), due = "";
                    String[] p = id.split("\\|");
                    if (debt.isEmpty() && p.length >= 2 && !"test".equals(p[0])) { debt = p[0]; due = p[1]; }
                    notify(ctx, id, e.optString("title", ""), e.optString("text", ""), debt, due, kindOf(e));
                }
            }
            saveEvents(ctx, key, rest);
        }
    }

    static PendingIntent firePending(Context ctx) {
        Intent i = new Intent(ctx, ReminderReceiver.class);
        i.setAction(ACTION_FIRE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(ctx, 7301, i, flags);
    }

    // один будильник на ближайшее событие плана (или проверки); плана нет - будильник снят
    static void scheduleNext(Context ctx) {
        long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
        for (String key : new String[] { KEY_EVENTS, KEY_TEST }) {
            JSONArray list = loadEvents(ctx, key);
            for (int i = 0; i < list.length(); i++) {
                JSONObject e = list.optJSONObject(i);
                if (e == null) continue;
                long at = e.optLong("at", 0);
                if (at > 0 && at < next) next = at;
            }
        }
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = firePending(ctx);
        if (next == Long.MAX_VALUE) { am.cancel(pi); return; }
        // наступившее, но ещё не показанное (телефон спал) - через несколько секунд
        long when = Math.max(next, now + 3000);
        try {
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            else am.set(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (Exception ignored) {}
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Платежи по долгам", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Напоминания за день до платежа и в день платежа");
        nm.createNotificationChannel(ch);
    }

    static void notify(Context ctx, String id, String title, String text, String debt, String due, String kind) {
        if (title == null || title.isEmpty()) return;
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return;
        ensureChannel(ctx);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (debt != null && !debt.isEmpty()) { open.putExtra(EXTRA_DEBT, debt); open.putExtra(EXTRA_DUE, due == null ? "" : due); }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        // свой requestCode на долг: интенты двух долгов не затирают друг другу extra
        int code = (debt != null && !debt.isEmpty()) ? ("debt:" + debt).hashCode() : id.hashCode();
        PendingIntent content = PendingIntent.getActivity(ctx, code, open, flags);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            // На заблокированном экране - только общая строка без названия долга (публичная
            // версия), полное «Завтра платёж по долгу «Ипотека»» - после разблокировки.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_reminder)
                .setContentTitle(publicTitle(kind))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(content)
                .build())
            .setAutoCancel(true)
            .setContentIntent(content);
        try { nm.notify(id.hashCode(), b.build()); } catch (SecurityException ignored) {}
    }
}
