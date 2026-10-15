package ru.dorokhin.budgetphone;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * ShareFile - системное окно «Отправить» Android с одним файлом (1.0.4: выгрузка в Excel).
 *
 * Зачем свой плагин, а не @capacitor/share + @capacitor/filesystem: две зависимости и
 * синхронизация версий ради двадцати строк. Здесь байты ложатся во временную папку
 * cache/export (старые файлы оттуда стираются перед записью), FileProvider оболочки
 * (${applicationId}.fileprovider, res/xml/file_paths.xml) выдаёт на файл content://-адрес,
 * право чтения получает только то приложение, которое хозяин выбрал в окне. Новых
 * разрешений и сети не нужно.
 *
 * JS-сторона: NativePlugins.ShareFile.share({name, mime, base64, title})
 *   → {ok:true}                         - окно «Отправить» закрылось (отправил или передумал:
 *                                         Android этого честно не сообщает)
 *   → reject(код NO_DATA|NO_WRITE|NO_SHARE) - файл не записался / окна нет
 *
 * Ответ приходит, когда окно закрылось и приложение вернулось на экран, а не сразу после
 * его открытия: JS снимает отметку AppLock.away() только по ответу, и «Защита входа» не
 * запирает приложение на возврате из Telegram или почты.
 */
@CapacitorPlugin(name = "ShareFile")
public class ShareFilePlugin extends Plugin {

    @PluginMethod
    public void share(PluginCall call) {
        String name = SaveFilePlugin.safeName(call.getString("name", "file.bin"), "file.bin");
        String mime = call.getString("mime", "application/octet-stream");
        String title = call.getString("title", "Отправить файл");
        String b64 = call.getString("base64");
        if (b64 == null || b64.isEmpty()) {
            call.reject("нечего отправлять", "NO_DATA");
            return;
        }
        Uri uri;
        try {
            File dir = new File(getContext().getCacheDir(), "export");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("нет папки");
            // прежние выгрузки во временной папке не копим
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) { try { f.delete(); } catch (Exception ignored) {} }
            File file = new File(dir, name);
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            FileOutputStream out = new FileOutputStream(file);
            try { out.write(bytes); out.flush(); } finally { out.close(); }
            uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (Exception e) {
            call.reject("файл не записался", "NO_WRITE");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, name);
        // ClipData - чтобы право чтения дошло и до приложения, выбранного через окно выбора
        send.setClipData(ClipData.newRawUri(name, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, title);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, chooser, "shared");
        } catch (Exception e) {
            call.reject("нет окна отправки", "NO_SHARE");
        }
    }

    @ActivityCallback
    private void shared(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
