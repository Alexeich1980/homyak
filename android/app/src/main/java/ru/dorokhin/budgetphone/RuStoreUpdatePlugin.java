package ru.dorokhin.budgetphone;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import ru.rustore.sdk.appupdate.manager.RuStoreAppUpdateManager;
import ru.rustore.sdk.appupdate.manager.factory.RuStoreAppUpdateManagerFactory;
import ru.rustore.sdk.appupdate.model.AppUpdateInfo;
import ru.rustore.sdk.appupdate.model.AppUpdateOptions;
import ru.rustore.sdk.appupdate.model.AppUpdateType;
import ru.rustore.sdk.appupdate.model.UpdateAvailability;
import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;

/**
 * RuStoreUpdate - мост к RuStore App Update SDK (ru.rustore.sdk:appupdate из BOM 2026.08.01,
 * javap-проверен по AAR 10.5.1). Перенесён 1:1 из «Карты года» (1.0.3 «Хомяка», 05.10.2026).
 * Стор-сборка «Хомяка» обновляется ТОЛЬКО через RuStore: свой манифест на CDN она больше
 * не читает (CORS/корень домена ломали проверку - «Нет связи» при живом интернете). SDK
 * спрашивает у установленного на телефоне приложения RuStore, есть ли в магазине версия новее.
 *
 * Вызывается ТОЛЬКО сторовой сборкой (www/update.js смотрит Access.STORE). Тест-сборка
 * плагин не трогает (у неё тот же applicationId - RuStore предложил бы поставить магазинную
 * версию поверх тестовой).
 *
 * JS-контракт (www/update.js):
 *   RuStoreUpdate.checkUpdate()
 *     → {ok:true, available:boolean, versionCode:number, currentVersionCode:number}
 *     | {ok:false, reason:'no-rustore'|'sdk', error:'…'}      (никогда не reject)
 *   RuStoreUpdate.startUpdate()  → {ok:true, via:'sdk'|'store'|'web', cancelled?:true} | {ok:false, reason:'flow', code?}
 *     запускает окно обновления RuStore (IMMEDIATE). Окно не открылось (ACTIVITY_NOT_FOUND = 2,
 *     ошибка SDK, неизвестный код) - {ok:false}, и JS (update.js startUpdate) открывает карточку
 *     приложения в RuStore. Отмена пользователем (RESULT_CANCELED = 0) - {ok:true, cancelled:true},
 *     без действий. Нет RuStore или обновления нет - карточка в RuStore, иначе страница в браузере.
 *   RuStoreUpdate.openStore()    → {ok:true, via:'store'|'web'} | {ok:false}
 */
@CapacitorPlugin(name = "RuStoreUpdate")
public class RuStoreUpdatePlugin extends Plugin {

    static final String RUSTORE_PKG = "ru.vk.store";
    static final String STORE_DEEPLINK = "rustore://apps.rustore.ru/app/";
    static final String STORE_WEB = "https://www.rustore.ru/catalog/app/";

    private RuStoreAppUpdateManager manager;

    private RuStoreAppUpdateManager manager() {
        if (manager == null) manager = RuStoreAppUpdateManagerFactory.INSTANCE.create(getContext().getApplicationContext());
        return manager;
    }

    private boolean ruStoreInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(RUSTORE_PKG, 0);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private long currentVersionCode() {
        try {
            Context c = getContext();
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Throwable t) {
            return 0;
        }
    }

    private static JSObject fail(String reason, Throwable e) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("reason", reason);
        if (e != null) {
            r.put("error", e.getClass().getSimpleName());
            // только для диагностики (CDP/логи); на экран не выводится - там честная строка из update.js
            String m = e.getMessage();
            if (m != null) r.put("message", m.length() > 200 ? m.substring(0, 200) : m);
        }
        return r;
    }

    @PluginMethod
    public void checkUpdate(final PluginCall call) {
        if (!ruStoreInstalled()) { call.resolve(fail("no-rustore", null)); return; }
        try {
            manager().getAppUpdateInfo()
                .addOnSuccessListener(new OnSuccessListener<AppUpdateInfo>() {
                    @Override public void onSuccess(AppUpdateInfo info) {
                        JSObject r = new JSObject();
                        r.put("ok", true);
                        r.put("available", info.getUpdateAvailability() == UpdateAvailability.UPDATE_AVAILABLE);
                        r.put("versionCode", info.getAvailableVersionCode());
                        r.put("currentVersionCode", currentVersionCode());
                        call.resolve(r);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable e) { call.resolve(fail("sdk", e)); }
                });
        } catch (Throwable e) {
            call.resolve(fail("sdk", e));
        }
    }

    @PluginMethod
    public void startUpdate(final PluginCall call) {
        if (!ruStoreInstalled()) { call.resolve(openStoreResult()); return; }
        try {
            manager().getAppUpdateInfo()
                .addOnSuccessListener(new OnSuccessListener<AppUpdateInfo>() {
                    @Override public void onSuccess(AppUpdateInfo info) {
                        if (info.getUpdateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
                            call.resolve(openStoreResult());
                            return;
                        }
                        try {
                            AppUpdateOptions opts = new AppUpdateOptions.Builder().appUpdateType(AppUpdateType.IMMEDIATE).build();
                            manager().startUpdateFlow(info, opts)
                                .addOnSuccessListener(new OnSuccessListener<Integer>() {
                                    @Override public void onSuccess(Integer code) { call.resolve(flowResult(code)); }
                                })
                                .addOnFailureListener(new OnFailureListener() {
                                    // SDK 10.5.1 отдаёт ACTIVITY_NOT_FOUND ошибкой (RuStoreInstallException(2))
                                    @Override public void onFailure(Throwable e) { call.resolve(flowFailed(null)); }
                                });
                        } catch (Throwable e) {
                            call.resolve(flowFailed(null));
                        }
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable e) { call.resolve(openStoreResult()); }
                });
        } catch (Throwable e) {
            call.resolve(openStoreResult());
        }
    }

    // Коды окна обновления (javap ru.rustore.sdk.activitylauncher.ActivityLauncherResult, SDK 10.5.1):
    // ActivityResultOk = -1 (Activity.RESULT_OK), ActivityResultCanceled = 0, ActivityNotFound = 2.
    static final int FLOW_OK = -1;
    static final int FLOW_CANCELED = 0;
    static final int FLOW_ACTIVITY_NOT_FOUND = 2;

    /** code-review 27.09: только OK и отмена - ok:true; ACTIVITY_NOT_FOUND и прочее - ok:false (JS откроет карточку). */
    static JSObject flowResult(Integer code) {
        int c = code == null ? FLOW_ACTIVITY_NOT_FOUND : code;
        if (c == FLOW_OK) {
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("via", "sdk");
            r.put("code", c);
            return r;
        }
        if (c == FLOW_CANCELED) {
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("via", "sdk");
            r.put("cancelled", true);
            r.put("code", c);
            return r;
        }
        return flowFailed(c);
    }

    static JSObject flowFailed(Integer code) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("reason", "flow");
        if (code != null) r.put("code", code);
        return r;
    }

    @PluginMethod
    public void openStore(PluginCall call) {
        call.resolve(openStoreResult());
    }

    /** Карточка приложения в RuStore (deeplink), без RuStore - страница в браузере. */
    private JSObject openStoreResult() {
        JSObject r = new JSObject();
        String pkg = getContext().getPackageName();
        if (tryOpen(STORE_DEEPLINK + pkg)) { r.put("ok", true); r.put("via", "store"); return r; }
        if (tryOpen(STORE_WEB + pkg)) { r.put("ok", true); r.put("via", "web"); return r; }
        r.put("ok", false);
        return r;
    }

    private boolean tryOpen(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Throwable t) {
            return false;
        }
    }
}
