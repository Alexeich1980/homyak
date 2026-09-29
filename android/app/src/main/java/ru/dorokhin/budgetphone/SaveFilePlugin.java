package ru.dorokhin.budgetphone;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * SaveFile — «Сохранить как» руками Android.
 *
 * Зачем свой плагин. Бэкап раньше уходил через Filesystem+Share: файл ложился в кэш
 * приложения, а дальше открывалась «Поделиться». Хозяин видел список мессенджеров
 * вместо папки, файл оставался во временной памяти, и «куда я его сохранил» было
 * непонятно. Здесь открывается системное окно сохранения (ACTION_CREATE_DOCUMENT):
 * хозяин сам выбирает папку и имя, файл ложится туда, куда он сказал.
 *
 * Новых разрешений не нужно: SAF выдаёт право записи на ОДИН выбранный документ.
 *
 * JS-сторона: NativePlugins.SaveFile.save({name, mime, base64})
 *   → {ok:true, uri:'content://…'}          — сохранил
 *   → {ok:false, cancelled:true}            — хозяин закрыл окно, это не ошибка
 *   → reject(код NO_DATA|NO_PICKER|NO_STREAM) — телефон не дал записать
 *
 * Наружу уходит КОД, а не текст исключения Java: английские «Failed to open output
 * stream» и «EACCES (Permission denied)» хозяину читать незачем, слова подбирает
 * sync.js по коду.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    /** Имя документа для SAF: разделители пути и служебные знаки часть прошивок ломают. */
    static String safeName(String raw, String dflt) {
        if (raw == null) return dflt;
        StringBuilder b = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c < 32 || c == 127 || "/\\:*?\"<>|".indexOf(c) >= 0) b.append(' ');
            else b.append(c);
        }
        String s = b.toString().replaceAll("\\s+", " ").trim();
        s = s.replaceAll("^[.\\s]+", "");
        if (s.length() > 80) {
            int dot = s.lastIndexOf('.');
            String ext = (dot > 0 && s.length() - dot <= 10) ? s.substring(dot) : "";
            s = s.substring(0, 80 - ext.length()).trim() + ext;
        }
        return s.isEmpty() ? dflt : s;
    }

    @PluginMethod
    public void save(PluginCall call) {
        String name = safeName(call.getString("name", "backup.bin"), "backup.bin");
        String mime = call.getString("mime", "application/octet-stream");
        if (call.getString("base64") == null) {
            call.reject("нечего сохранять", "NO_DATA");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
            // startActivityForResult сам придержит call до ответа окна
            startActivityForResult(call, intent, "saved");
        } catch (Exception e) {
            // Системного окна «Сохранить как» нет вовсе (SAF отключён, урезанная
            // прошивка): без этой ветки обещание в JS не разрешалось НИКОГДА и
            // «Бэкап в файл» молча висел без ошибки и без отмены.
            call.reject("нет системного окна сохранения", "NO_PICKER");
        }
    }

    @ActivityCallback
    private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;

        JSObject ret = new JSObject();
        Intent data = result.getData();
        Uri uri = (data == null) ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            // отмена — обычный исход, а не сбой: наверху по нему просто молчат
            ret.put("ok", false);
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        try {
            byte[] bytes = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
            // «wt» — перезаписать целиком: без него поверх старого файла остаётся хвост
            OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (out == null) throw new Exception("телефон не открыл файл на запись");
            try {
                out.write(bytes);
                out.flush();
            } finally {
                out.close();
            }
            ret.put("ok", true);
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            // текст исключения наружу не отдаём - только код, слова подберёт JS
            call.reject("телефон не дал записать файл", "NO_STREAM");
        }
    }
}
