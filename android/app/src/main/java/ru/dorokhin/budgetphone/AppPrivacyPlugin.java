package ru.dorokhin.budgetphone;

import android.app.Activity;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AppPrivacy - прячет снимок экрана в списке недавних приложений, пока включён «Код на вход».
 * Не FLAG_SECURE: тот запретил бы и скриншоты, и запись экрана, а замок у «Хомяка» - только от
 * посторонних глаз. Activity.setRecentsScreenshotEnabled(false) (Android 13+, API 33) убирает
 * ровно миниатюру в «недавних». На Android 12 и ниже метода нет - там остаётся JS-шторка
 * (lock.js закрывает экран при уходе в фон), ответ {supported:false}.
 *
 * JS (www/lock.js): NativePlugins.AppPrivacy.setRecentsHidden({hidden:true|false})
 *   -> {ok:true, supported:true|false}
 */
@CapacitorPlugin(name = "AppPrivacy")
public class AppPrivacyPlugin extends Plugin {

    @PluginMethod
    public void setRecentsHidden(final PluginCall call) {
        final boolean hidden = Boolean.TRUE.equals(call.getBoolean("hidden", false));
        final Activity a = getActivity();
        final JSObject ret = new JSObject();
        ret.put("ok", true);
        if (a == null || Build.VERSION.SDK_INT < 33) {
            ret.put("supported", false);
            call.resolve(ret);
            return;
        }
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    a.setRecentsScreenshotEnabled(!hidden);
                    ret.put("supported", true);
                } catch (Throwable t) {
                    ret.put("supported", false);
                }
                call.resolve(ret);
            }
        });
    }
}
