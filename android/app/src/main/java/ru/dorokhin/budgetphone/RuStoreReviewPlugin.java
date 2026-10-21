package ru.dorokhin.budgetphone;

import android.app.Activity;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import kotlin.Unit;
import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;
import ru.rustore.sdk.review.RuStoreReviewManager;
import ru.rustore.sdk.review.RuStoreReviewManagerFactory;
import ru.rustore.sdk.review.model.ReviewInfo;

/**
 * RuStoreReview - мост к RuStore Review SDK (окно оценки и отзыва внутри приложения).
 * Документация: https://www.rustore.ru/help/sdk/reviews-ratings/kotlin-java/10-5-1
 * Артефакт ru.rustore.sdk:review (10.5.1 в BOM ru.rustore.sdk:bom:2026.08.01), API сверен по AAR (javap):
 *   RuStoreReviewManagerFactory.INSTANCE.create(Context) -> RuStoreReviewManager
 *   requestReviewFlow() -> ru.rustore.sdk.core.tasks.Task<ReviewInfo>   (ReviewInfo живёт ~5 минут)
 *   launchReviewFlow(ReviewInfo) -> Task<kotlin.Unit>                    (успех = окно отработало)
 * SDK не добавляет разрешений (в его манифесте только <queries> к RuStore).
 *
 * Когда звать, решает JS (www/guards.js + www/nudges.js): один раз после удачной записи
 * операции. Здесь - только «запросить и сразу показать», ни одного своего окна.
 * Любой исход возвращается в resolve (не reject), чтобы JS молча записал результат:
 *   {shown:true}
 *   {shown:false, code:'NOT_INSTALLED'|'OUTDATED'|'UNAUTHORIZED'|'REVIEW_EXISTS'|'LIMIT'|
 *                      'BANNED'|'INVALID_INFO'|'ERROR'}
 * Ошибки SDK (ru.rustore.sdk.core.exception.* и ru.rustore.sdk.review.errors.*) различаем
 * по простому имени класса: RuStoreNotInstalledException, RuStoreOutdatedException,
 * RuStoreUserUnauthorizedException, RuStoreUserBannedException, RuStoreApplicationBannedException,
 * RuStoreRequestLimitReached, RuStoreReviewExists, RuStoreInvalidReviewInfo.
 */
@CapacitorPlugin(name = "RuStoreReview")
public class RuStoreReviewPlugin extends Plugin {

    private RuStoreReviewManager manager;

    private RuStoreReviewManager manager() {
        if (manager != null) return manager;
        Activity a = getActivity();
        Context ctx = a != null ? a : getContext();
        manager = RuStoreReviewManagerFactory.INSTANCE.create(ctx);
        return manager;
    }

    @PluginMethod
    public void requestAndLaunch(final PluginCall call) {
        final RuStoreReviewManager m;
        try {
            m = manager();
        } catch (Throwable t) {
            resolveFail(call, t);
            return;
        }
        try {
            m.requestReviewFlow()
                .addOnSuccessListener(new OnSuccessListener<ReviewInfo>() {
                    @Override
                    public void onSuccess(ReviewInfo info) {
                        try {
                            m.launchReviewFlow(info)
                                .addOnSuccessListener(new OnSuccessListener<Unit>() {
                                    @Override
                                    public void onSuccess(Unit unit) {
                                        JSObject ret = new JSObject();
                                        ret.put("shown", true);
                                        call.resolve(ret);
                                    }
                                })
                                .addOnFailureListener(new OnFailureListener() {
                                    @Override
                                    public void onFailure(Throwable t) { resolveFail(call, t); }
                                });
                        } catch (Throwable t) {
                            resolveFail(call, t);
                        }
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(Throwable t) { resolveFail(call, t); }
                });
        } catch (Throwable t) {
            resolveFail(call, t);
        }
    }

    private static void resolveFail(PluginCall call, Throwable t) {
        JSObject ret = new JSObject();
        ret.put("shown", false);
        ret.put("code", codeOf(t));
        call.resolve(ret);
    }

    /** Код ошибки по простому имени класса исключения (по всей цепочке причин). */
    static String codeOf(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            String n = c.getClass().getSimpleName();
            if (n == null) continue;
            if (n.contains("NotInstalled")) return "NOT_INSTALLED";
            if (n.contains("Outdated")) return "OUTDATED";
            if (n.contains("Unauthorized")) return "UNAUTHORIZED";
            if (n.contains("ReviewExists")) return "REVIEW_EXISTS";
            if (n.contains("RequestLimitReached")) return "LIMIT";
            if (n.contains("Banned")) return "BANNED";
            if (n.contains("InvalidReviewInfo")) return "INVALID_INFO";
            if (c.getCause() == c) break;
        }
        return "ERROR";
    }
}
