package ru.dorokhin.budgetphone;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;

import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;
import ru.rustore.sdk.core.util.RuStoreUtils;
import ru.rustore.sdk.pay.RuStorePayClient;
import ru.rustore.sdk.pay.RuStorePayClientProvider;
import ru.rustore.sdk.pay.callback.PurchaseEventListener;
import ru.rustore.sdk.pay.model.AcknowledgementState;
import ru.rustore.sdk.pay.model.ConsoleApplicationId;
import ru.rustore.sdk.pay.model.InvoiceId;
import ru.rustore.sdk.pay.model.PreferredPurchaseType;
import ru.rustore.sdk.pay.model.Product;
import ru.rustore.sdk.pay.model.ProductId;
import ru.rustore.sdk.pay.model.ProductPurchase;
import ru.rustore.sdk.pay.model.ProductPurchaseParams;
import ru.rustore.sdk.pay.model.ProductPurchaseResult;
import ru.rustore.sdk.pay.model.ProductPurchaseStatus;
import ru.rustore.sdk.pay.model.Purchase;
import ru.rustore.sdk.pay.model.PurchaseAvailabilityResult;
import ru.rustore.sdk.pay.model.PurchaseId;
import ru.rustore.sdk.pay.model.RuStorePaymentException;
import ru.rustore.sdk.pay.model.SdkTheme;
import ru.rustore.sdk.pay.model.UserAuthorizationStatus;

/**
 * RuStorePay - мост к RuStore Pay SDK 11.1.0 для РАЗОВОЙ покупки «Полного доступа» «Хомяка» (NON_CONSUMABLE).
 *
 * Хомяк 1.0.6 (ревью кода max 24.10.2026): механика перенесена из «Понятной пенсии» 1.0.7 (эталон -
 * Проекты/Пенсия/android/.../RuStorePayPlugin.java) вместе с исправлениями повторного и третьего адв. ревью
 * (paying/lastEvent, запись «оплата начата»). Отличия: схема deeplink - payScheme(пакет), тема шторки DARK,
 * тег лога HMPay, свои SharedPreferences hm_pay_started, код InvalidActivePurchase.
 *
 * Реальный API Pay SDK 11.1.0 (BOM ru.rustore.sdk:bom:2026.08.01), сверено javap по pay-11.1.0 (Gradle-кэш D:/Android/.gradle, transforms-3/.../pay-11.1.0/jars/classes.jar):
 *   client  = new RuStorePayClientProvider().provide(context, ConsoleApplicationId, Map)
 *   PurchaseInteractor:
 *     purchase(ProductPurchaseParams, PreferredPurchaseType, SdkTheme, PurchaseEventListener) → Task<ProductPurchaseResult>
 *     getPurchase(PurchaseId) → Task<Purchase>          (покупка в любом статусе)
 *     getPurchases(ProductType, PurchaseStatus, AcknowledgementState) → Task<List<Purchase>>
 *     getPurchaseAvailability() → Task<PurchaseAvailabilityResult>  (Available | Unavailable(cause))
 *     updateAcknowledgementState(PurchaseId, AcknowledgementState, DeveloperPayload) → Task<AcknowledgementState>
 *   PurchaseEventListener: onPurchaseCreated / onPaymentStarted / onPaymentCompleted / onPaymentFailed /
 *     onPurchaseCancelled (PurchaseId, InvoiceId) - id могут быть null.
 *   Ошибки шторки: RuStorePaymentException.ProductPurchaseCancelled (getPurchaseId) / ProductPurchaseException (getPurchaseId,
 *     getCause) / RuStorePaymentNetworkException (getCode).
 *   Шторка - отдельная активность ru.rustore.sdk.pay.internal.presentation.ui.PayActivity (launchMode singleTask, манифест AAR).
 *
 * ConsoleApplicationId - из strings.xml (rustore_console_app_id). При заглушке/пустом id клиент не создаётся (client()==null):
 * покупка отвечает {status:'unavailable'}, getPurchases - {owned:false, unavailable:true}, precheck - {available:false,
 * code:'NotConfigured'}.
 *
 * СЕССИЯ ПОКУПКИ (ревью кода max 23.10.2026). Раньше JS сам угадывал, «зависла» ли шторка (таймер, resume), и терял поздний
 * успех / отпускал живую шторку. Теперь итог знает плагин:
 *   - purchase сохраняет PluginCall (bridge.saveCall) и purchaseId из PurchaseEventListener (onPurchaseCreated…).
 *   - Итог отдаётся РОВНО ОДИН РАЗ (settle): ok | pending | cancelled | error(+code).
 *   - Неуспех шторки при известном purchaseId перепроверяется getPurchase(id): PAID/CONFIRMED - ok, PROCESSING/EXECUTING -
 *     pending (закрыл шторку, а банк ещё проводит оплату - не «отмена»).
 *   - Возврат в приложение (handleOnResume), когда шторка уже не на экране (наша активность пробыла на переднем плане
 *     RESUME_GRACE_MS и не ушла на паузу снова - значит, PayActivity закрыта или убита), а Task молчит: getPurchase(id) →
 *     ok / pending / cancelled. Вернулся по deeplink банка - SDK снова показывает шторку (proceedIntent), активность уходит
 *     на паузу, проверка отменяется (resumeSeq).
 *   - Поздний успех Task после итога не теряется: событие 'purchaseLate' {status:'ok', purchaseId}.
 *   - Третье адв. ревью 1.0.7 (R1/R2): знание «оплата начата» переживает смерть процесса - запись {purchaseId, время} в
 *     SharedPreferences (STARTED_PREFS) на onPaymentStarted/onPaymentCompleted. getPurchases отдаёт такой счёт как pending
 *     (pendingAgeMs - от записи), пока SDK не дал финальный статус (тогда запись стирается) и не старше STARTED_TTL_MS.
 *     Иначе после перезапуска (или «Проверим позже») «Купить» открывал второй счёт, пока банк проводит первый.
 *   - Диагностика: android.util.Log с тегом HMPay - только имена событий шторки и статусы покупок (purchaseId можно;
 *     сумм, карт, телефонов, appUserId нет).
 *   - Повторное адв. ревью 1.0.7 (ВАЖНО-1): счёт INVOICE_CREATED при НАЧАТОЙ оплате (lastEvent started/completed) - pending,
 *     а не отмена: иначе «Попробовать снова» открывал второй счёт, пока банк проводит первый. Итог несёт paying.
 *
 * JS-контракт (www/pay.js):
 *   purchase({productId}) → {status:'ok', ok:true, purchaseId} | {status:'pending', pending:true, purchaseId}
 *     | {status:'cancelled', cancelled:true, purchaseId?} | {status:'error', error, code?, purchaseId?}
 *     | {status:'unavailable', unavailable:true} | {status:'busy'}
 *   checkPurchase({purchaseId}) → {status:'ok'|'pending'|'open'|'cancelled'|'error', purchaseId} | reject CHECK_FAILED
 *   getPurchases({productId, auth?}) → {owned, revoked, pending, pendingId?, pendingAgeMs?, purchaseId?, ackPending?, authorized?}
 *     | {owned:false, unavailable:true} | reject. auth:false - без getUserAuthorizationStatus (снимку владения не нужен).
 *   precheck({productId}) → {installed?, authorized?, available?, code?}
 *   acknowledge({purchaseId}) → {ok}
 *   getProducts({productId}) → {ok:true, priceLabel, priceMinor?, currency?} | {ok:false, ...}
 * Коды ошибок: код сервера RuStore (RuStorePaymentNetworkException.getCode(): «4000020» - уже приобретён, «4000021» -
 * незавершённая покупка продукта, «4000025» - нет подходящего способа) или имя исключения core: RuStoreNotInstalled / RuStoreOutdated / UserUnauthorized / UserBanned /
 * ApplicationBanned / InvalidActivePurchase; CheckFailed - после возврата в приложение не удалось спросить статус своей покупки.
 */
@CapacitorPlugin(name = "RuStorePay")
public class RuStorePayPlugin extends Plugin {

    private RuStorePayClient payClient;

    /** Схема deeplink возврата из банковских приложений (СБП/SberPay). ДОЛЖНА совпадать с
     *  meta-data sdk_pay_scheme_value и intent-filter MainActivity в AndroidManifest.xml. */
    // <applicationId>.rustore: ru.dorokhin.homyak.rustore в сторе, ...homyak.test.rustore в тест-сборке
    // (build.gradle payScheme - то же правило, манифест и SDK видят одну схему)
    static String payScheme(android.content.Context c) { return c.getPackageName() + ".rustore"; }

    /** Сколько наша активность должна пробыть на переднем плане после возврата, чтобы считать шторку закрытой. */
    static final long RESUME_GRACE_MS = 2000;

    /** Сессия одной покупки: вызов JS, свой purchaseId, последнее событие шторки, итог отдан ли. */
    static final class Session {
        final PluginCall call;
        volatile String purchaseId;
        volatile String lastEvent = "none";
        boolean resolved;
        boolean paused;
        int resumeSeq;
        Session(PluginCall call) { this.call = call; }
    }

    /** Повторное адв. ревью 1.0.7 (ВАЖНО-1): оплата НАЧАТА (событие шторки onPaymentStarted/onPaymentCompleted - человек ушёл
     *  в банк). Тогда счёт в INVOICE_CREATED («open») - не отмена: банк ещё проводит деньги, второй счёт открывать нельзя. */
    static boolean paying(Session s) {
        String e = s.lastEvent;
        return "started".equals(e) || "completed".equals(e);
    }

    static final String LOG = "HMPay";
    /** Запись «оплата начата» (переживает смерть процесса). Срок жизни - предел, а не угадывание итога: SDK может держать
     *  счёт INVOICE_CREATED долго, а человек, который не заплатил, не должен застрять навсегда. Совпадает с JS PENDING_FRESH_MS. */
    static final String STARTED_PREFS = "hm_pay_started";
    static final long STARTED_TTL_MS = 30L * 60L * 1000L;

    static void saveStarted(Context ctx, String purchaseId) {
        if (ctx == null || purchaseId == null) return;
        try {
            ctx.getSharedPreferences(STARTED_PREFS, Context.MODE_PRIVATE).edit()
                .putString("id", purchaseId).putLong("at", System.currentTimeMillis()).commit();   // commit: до возможного убийства процесса
            Log.i(LOG, "started saved id=" + purchaseId);
        } catch (Throwable ignored) {}
    }
    /** Стереть запись (только если она про эту покупку; id == null - любую). */
    static void clearStarted(Context ctx, String purchaseId) {
        if (ctx == null) return;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(STARTED_PREFS, Context.MODE_PRIVATE);
            String id = sp.getString("id", null);
            if (id == null || (purchaseId != null && !purchaseId.equals(id))) return;
            sp.edit().clear().commit();
            Log.i(LOG, "started cleared id=" + id);
        } catch (Throwable ignored) {}
    }
    /** Свежая запись {id, возраст мс} или null (просроченную стирает). */
    static String[] startedRecord(Context ctx) {
        if (ctx == null) return null;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(STARTED_PREFS, Context.MODE_PRIVATE);
            String id = sp.getString("id", null);
            if (id == null) return null;
            long age = Math.max(0L, System.currentTimeMillis() - sp.getLong("at", 0L));
            if (age >= STARTED_TTL_MS) { sp.edit().clear().commit(); Log.i(LOG, "started expired id=" + id); return null; }
            return new String[] { id, String.valueOf(age) };
        } catch (Throwable t) { return null; }
    }
    /** Финальный статус своей покупки от SDK - запись «оплата начата» больше не нужна. */
    private void noteFinal(String purchaseId, String st) {
        if ("ok".equals(st) || "cancelled".equals(st) || "error".equals(st)) clearStarted(getContext(), purchaseId);
    }

    private final Object lock = new Object();
    private Session session;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Клиент Pay SDK. null → id не задан (заглушка) → покупка недоступна.
     *  SDK сам инициализируется ContentProvider'ом по meta-data console_app_id_value (+ sdk_pay_scheme_value). Повторный
     *  provide() бросает RuStorePayClientAlreadyExist - поэтому сначала getInstance(), и только если провайдер его не
     *  создал - инициализируем сами (со схемой deeplink). */
    private RuStorePayClient client() {
        if (payClient != null) return payClient;
        payClient = clientFor(getContext());
        return payClient;
    }

    static RuStorePayClient clientFor(Context ctx) {
        String appId = consoleAppId(ctx);
        if (appId == null) return null;
        try {
            return RuStorePayClient.Companion.getInstance();
        } catch (Throwable notCreated) {
            try {
                HashMap<String, Object> cfg = new HashMap<String, Object>();
                cfg.put("scheme", payScheme(ctx));
                return new RuStorePayClientProvider()
                    .provide(ctx.getApplicationContext(), new ConsoleApplicationId(appId), cfg);
            } catch (Throwable alreadyExist) {
                try { return RuStorePayClient.Companion.getInstance(); } catch (Throwable t) { return null; }
            }
        }
    }

    /** Возврат из банковского приложения (deeplink payScheme) - отдать интент SDK, чтобы он
     *  довёл оплату. Зовётся из MainActivity.onCreate/onNewIntent. При заглушке id - ничего. */
    static void proceedIntent(Context ctx, Intent intent) {
        if (intent == null) return;
        try {
            RuStorePayClient c = clientFor(ctx);
            if (c != null) c.getIntentInteractor().proceedIntent(intent, SdkTheme.DARK);
        } catch (Throwable ignored) {}
    }

    /** Значение rustore_console_app_id из strings.xml или null, если это маркер-заглушка/пусто. */
    private static String consoleAppId(Context ctx) {
        try {
            int id = ctx.getResources().getIdentifier("rustore_console_app_id", "string", ctx.getPackageName());
            if (id == 0) return null;
            String v = ctx.getString(id);
            if (v == null) return null;
            v = v.trim();
            if (v.isEmpty() || v.startsWith("РАЗМЕСТИТЬ")) return null;   // заглушка из strings.xml
            return v;
        } catch (Throwable t) {
            return null;
        }
    }

    private static void resolveUnavailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("status", "unavailable");
        ret.put("unavailable", true);   // «оплата не сконфигурирована», а не «платёж не прошёл»
        call.resolve(ret);
    }

    // ---------------- итоги сессии ----------------

    static JSObject outcome(String status, String purchaseId) {
        JSObject r = new JSObject();
        r.put("status", status);
        r.put("ok", "ok".equals(status));
        if ("cancelled".equals(status)) r.put("cancelled", true);
        if ("pending".equals(status)) r.put("pending", true);
        if ("error".equals(status)) r.put("error", "Платёж не прошёл");
        if (purchaseId != null) r.put("purchaseId", purchaseId);
        return r;
    }

    /** Отдать итог сессии РОВНО ОДИН РАЗ. Уже отдан, а пришёл успех (Task шторки ответил после resume) - событие purchaseLate. */
    private void settle(Session s, JSObject r) {
        boolean late;
        synchronized (lock) {
            late = s.resolved;
            s.resolved = true;
        }
        if (late) {
            Log.i(LOG, "late " + r.getString("status") + " id=" + s.purchaseId);
            if ("ok".equals(r.getString("status"))) { clearStarted(getContext(), s.purchaseId); notifyListeners("purchaseLate", r); }
            return;
        }
        if (r.getString("purchaseId") == null && s.purchaseId != null) r.put("purchaseId", s.purchaseId);
        r.put("paying", paying(s));
        Log.i(LOG, "settle " + r.getString("status") + " id=" + s.purchaseId + " event=" + s.lastEvent);
        if ("ok".equals(r.getString("status"))) clearStarted(getContext(), s.purchaseId);   // JS: опрос своей покупки при «open» ждёт дальше, только если оплата начата
        try { s.call.resolve(r); } finally { try { getBridge().releaseCall(s.call); } catch (Throwable ignored) {} }
    }

    @PluginMethod
    public void purchase(final PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || productId.isEmpty()) {
            call.reject("не задан productId", "NO_PRODUCT");
            return;
        }
        RuStorePayClient c = client();
        if (c == null) { resolveUnavailable(call); return; }
        final Session s;
        synchronized (lock) {
            if (session != null && !session.resolved) {
                // JS держит один замок; сюда попадаем, только если JS перезапустился при живой шторке
                JSObject busy = new JSObject(); busy.put("ok", false); busy.put("status", "busy");
                call.resolve(busy);
                return;
            }
            s = new Session(call);
            session = s;
        }
        try { getBridge().saveCall(call); } catch (Throwable ignored) {}

        ProductPurchaseParams params = new ProductPurchaseParams(
            new ProductId(productId),
            /* quantity */ null,
            /* orderId */ null,
            /* developerPayload */ null,
            /* appUserId */ null,
            /* appUserEmail */ null
        );
        try {
            c.getPurchaseInteractor()
                .purchase(params, PreferredPurchaseType.ONE_STEP, SdkTheme.DARK, new SessionEvents(s, getContext()))
                .addOnSuccessListener(new OnSuccessListener<ProductPurchaseResult>() {
                    @Override
                    public void onSuccess(ProductPurchaseResult result) {
                        String id = extractPurchaseId(result);
                        if (id != null) s.purchaseId = id;
                        settle(s, outcome("ok", s.purchaseId));
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(Throwable t) { onSheetFailure(s, t); }
                });
        } catch (Throwable t) {
            onSheetFailure(s, t);
        }
    }

    /** Неуспех шторки: отмена или ошибка с кодом. Свой purchaseId известен - перепроверяем статус покупки: закрыл шторку
     *  после оплаты в банке - это не отмена. */
    private void onSheetFailure(final Session s, Throwable t) {
        if (s.purchaseId == null) s.purchaseId = purchaseIdOf(t);
        Log.i(LOG, "sheet failure " + t.getClass().getSimpleName() + " id=" + s.purchaseId + " event=" + s.lastEvent);
        final JSObject base;
        if (isCancellation(t)) base = outcome("cancelled", s.purchaseId);
        else {
            base = outcome("error", s.purchaseId);
            String code = errorCode(t);
            if (code != null) base.put("code", code);
        }
        if (s.resolved) return;   // итог уже отдан (resume) - поздний неуспех ничего не меняет
        if (s.purchaseId == null) { settle(s, base); return; }
        fetchStatus(s.purchaseId, new StatusCallback() {
            @Override public void done(String st) {
                if ("ok".equals(st) || "pending".equals(st)) settle(s, outcome(st, s.purchaseId));
                else if ("open".equals(st) && paying(s)) settle(s, outcome("pending", s.purchaseId));   // закрыл шторку, банк ещё проводит
                else settle(s, base);
            }
            @Override public void failed() { settle(s, base); }
        });
    }

    @Override
    protected void handleOnPause() {
        synchronized (lock) {
            Session s = session;
            if (s != null && !s.resolved) { s.paused = true; s.resumeSeq++; }
        }
    }

    @Override
    protected void handleOnResume() {
        final Session s;
        final int seq;
        synchronized (lock) {
            s = session;
            if (s == null || s.resolved || !s.paused) return;
            seq = ++s.resumeSeq;
        }
        main.postDelayed(new Runnable() {
            @Override public void run() {
                synchronized (lock) { if (s.resolved || seq != s.resumeSeq) return; }
                checkAfterReturn(s);
            }
        }, RESUME_GRACE_MS);
    }

    /** Шторки нет на экране, а Task молчит (убита при возврате по иконке): итог по статусу своей покупки. */
    private void checkAfterReturn(final Session s) {
        final String id = s.purchaseId;
        if (id == null) { settle(s, outcome("cancelled", null)); return; }   // покупка не создана - оплаты не было
        fetchStatus(id, new StatusCallback() {
            @Override public void done(String st) {
                if ("ok".equals(st) || "pending".equals(st)) settle(s, outcome(st, id));
                else if ("error".equals(st)) { JSObject r = outcome("error", id); r.put("code", "REJECTED"); settle(s, r); }
                else if ("open".equals(st) && paying(s)) settle(s, outcome("pending", id));   // ушёл в банк, оплата ещё не дошла
                else settle(s, outcome("cancelled", id));   // open без начатой оплаты (шторку закрыли) / cancelled
            }
            @Override public void failed() {
                JSObject r = outcome("error", id); r.put("code", "CheckFailed"); settle(s, r);
            }
        });
    }

    interface StatusCallback { void done(String status); void failed(); }

    /** Статус своей покупки: ok | pending | open | cancelled | error. */
    private void fetchStatus(final String purchaseId, final StatusCallback cb) {
        RuStorePayClient c = client();
        if (c == null) { cb.failed(); return; }
        try {
            c.getPurchaseInteractor().getPurchase(new PurchaseId(purchaseId))
                .addOnSuccessListener(new OnSuccessListener<Purchase>() {
                    @Override public void onSuccess(Purchase p) {
                        String st = statusOf(p);
                        Log.i(LOG, "getPurchase id=" + purchaseId + " status=" + rawStatus(p) + " -> " + st);
                        noteFinal(purchaseId, st);
                        cb.done(st);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable t) { Log.i(LOG, "getPurchase id=" + purchaseId + " failed " + t.getClass().getSimpleName()); cb.failed(); }
                });
        } catch (Throwable t) { cb.failed(); }
    }

    /** Имя статуса SDK для лога (без данных пользователя). */
    static String rawStatus(Purchase p) {
        try { return (p instanceof ProductPurchase) ? String.valueOf(((ProductPurchase) p).getStatus()) : "not-product"; }
        catch (Throwable t) { return "?"; }
    }

    /** Статус покупки для JS по enum ProductPurchaseStatus 11.1.0 (INVOICE_CREATED, CANCELLED, PROCESSING, REJECTED,
     *  CONFIRMED, REFUNDED, REFUNDING, EXECUTING, EXPIRED, PAID, REVERSED). */
    static String statusOf(Purchase p) {
        if (!(p instanceof ProductPurchase)) return "error";
        ProductPurchaseStatus st = ((ProductPurchase) p).getStatus();
        if (st == ProductPurchaseStatus.PAID || st == ProductPurchaseStatus.CONFIRMED) return "ok";
        for (ProductPurchaseStatus ps : PENDING_STATUSES) if (st == ps) return "pending";
        if (st == ProductPurchaseStatus.INVOICE_CREATED) return "open";
        if (st == ProductPurchaseStatus.REJECTED) return "error";
        return "cancelled";   // CANCELLED / EXPIRED / REFUNDED / REFUNDING / REVERSED - доступа нет
    }

    /** Опрос «оплата обрабатывается»: статус СВОЕЙ покупки по id (без входа в RuStore и без списка покупок). */
    @PluginMethod
    public void checkPurchase(final PluginCall call) {
        final String id = call.getString("purchaseId");
        if (id == null || id.isEmpty()) { call.reject("не задан purchaseId", "NO_PURCHASE"); return; }
        fetchStatus(id, new StatusCallback() {
            @Override public void done(String st) {
                JSObject r = new JSObject(); r.put("status", st); r.put("purchaseId", id); call.resolve(r);
            }
            @Override public void failed() { call.reject("не удалось проверить покупку", "CHECK_FAILED"); }
        });
    }

    @PluginMethod
    public void getPurchases(final PluginCall call) {
        final String productId = call.getString("productId");
        final boolean withAuth = call.getBoolean("auth", Boolean.TRUE);
        final RuStorePayClient c = client();
        if (c == null) {
            JSObject ret = new JSObject();
            ret.put("owned", false);
            ret.put("unavailable", true);   // оплата не сконфигурирована: JS НЕ снимает кэш владения
            call.resolve(ret);
            return;
        }
        c.getPurchaseInteractor()
            .getPurchases(/* productType */ null, /* purchaseStatus */ null, /* acknowledgementState */ null)
            .addOnSuccessListener(new OnSuccessListener<List<Purchase>>() {
                @Override
                public void onSuccess(List<Purchase> purchases) {
                    final JSObject ret = new JSObject();
                    ret.put("owned", ownsProduct(purchases, productId));
                    ret.put("revoked", revokedProduct(purchases, productId));
                    // оплата запущена, итога ещё нет: id и возраст (JS не ждёт покупку старше 30 минут)
                    logPurchases(purchases, productId);
                    ProductPurchase pend = pendingPurchase(purchases, productId);
                    ret.put("pending", pend != null);
                    if (pend != null) {
                        try { if (pend.getPurchaseId() != null) ret.put("pendingId", pend.getPurchaseId().getValue()); } catch (Throwable ignored) {}
                        try { Date t = pend.getPurchaseTime(); if (t != null) ret.put("pendingAgeMs", Math.max(0L, System.currentTimeMillis() - t.getTime())); } catch (Throwable ignored) {}
                    } else {
                        // третье адв. ревью (R1/R2): оплата этого счёта была начата (запись пережила процесс), финального
                        // статуса ещё нет - ждём его, второй счёт не открываем. Финальный статус в списке - запись стираем.
                        String[] rec = startedRecord(getContext());
                        if (rec != null) {
                            String st = statusIn(purchases, rec[0]);
                            if (st != null && !"open".equals(st) && !"pending".equals(st)) clearStarted(getContext(), rec[0]);
                            else {
                                ret.put("pending", true); ret.put("pendingId", rec[0]); ret.put("pendingStarted", true);
                                try { ret.put("pendingAgeMs", Long.parseLong(rec[1])); } catch (Throwable ignored) {}
                            }
                        }
                    }
                    // 1.0.7: оплаченная, но не отмеченная выдачей покупка - JS отметит её (acknowledge)
                    String ack = ackPendingId(purchases, productId);
                    if (ack != null) { ret.put("purchaseId", ack); ret.put("ackPending", true); }
                    if (!withAuth) { call.resolve(ret); return; }
                    // Пустой список у НЕавторизованного в RuStore - не доказательство возврата:
                    // JS снимет доступ только при revoked или у авторизованного пользователя.
                    try {
                        c.getUserInteractor().getUserAuthorizationStatus()
                            .addOnSuccessListener(new OnSuccessListener<UserAuthorizationStatus>() {
                                @Override
                                public void onSuccess(UserAuthorizationStatus st) {
                                    ret.put("authorized", st == UserAuthorizationStatus.AUTHORIZED);
                                    call.resolve(ret);
                                }
                            })
                            .addOnFailureListener(new OnFailureListener() {
                                @Override
                                public void onFailure(Throwable t) {
                                    ret.put("authorized", false);
                                    call.resolve(ret);
                                }
                            });
                    } catch (Throwable t) {
                        ret.put("authorized", false);
                        call.resolve(ret);
                    }
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Throwable t) {
                    call.reject("не удалось получить список покупок", "GET_PURCHASES_FAILED");
                }
            });
    }

    /** Перед шторкой: вошёл ли человек в RuStore, установлен ли RuStore и доступна ли оплата. Сбой проверки - поля не
     *  ставим. Unavailable отдаём с причиной (code); окончательная ли она, решает JS (pay.js finalKind): сетевая причина
     *  или её отсутствие - НЕ «оплата недоступна» (ревью кода max 23.10, находка 6). */
    @PluginMethod
    public void precheck(final PluginCall call) {
        final RuStorePayClient c = client();
        if (c == null) { JSObject r = new JSObject(); r.put("available", false); r.put("code", "NotConfigured"); call.resolve(r); return; }
        final JSObject ret = new JSObject();
        try { ret.put("installed", RuStoreUtils.INSTANCE.isRuStoreInstalled(getContext())); } catch (Throwable ignored) {}
        try {
            c.getUserInteractor().getUserAuthorizationStatus()
                .addOnSuccessListener(new OnSuccessListener<UserAuthorizationStatus>() {
                    @Override public void onSuccess(UserAuthorizationStatus st) {
                        ret.put("authorized", st == UserAuthorizationStatus.AUTHORIZED);
                        availability(c, call, ret);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable t) { availability(c, call, ret); }
                });
        } catch (Throwable t) { availability(c, call, ret); }
    }

    private static void availability(RuStorePayClient c, final PluginCall call, final JSObject ret) {
        try {
            c.getPurchaseInteractor().getPurchaseAvailability()
                .addOnSuccessListener(new OnSuccessListener<PurchaseAvailabilityResult>() {
                    @Override public void onSuccess(PurchaseAvailabilityResult r) {
                        if (r instanceof PurchaseAvailabilityResult.Unavailable) {
                            ret.put("available", false);
                            String code = errorCode(((PurchaseAvailabilityResult.Unavailable) r).getCause());
                            if (code != null) ret.put("code", code);
                        } else if (r instanceof PurchaseAvailabilityResult.Available) {
                            ret.put("available", true);
                        }
                        call.resolve(ret);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable t) { call.resolve(ret); }
                });
        } catch (Throwable t) { call.resolve(ret); }
    }

    /** 1.0.7: после выдачи доступа - отметка ACKNOWLEDGED, иначе в Консоли покупка висит «ожидает выдачи товара». */
    @PluginMethod
    public void acknowledge(final PluginCall call) {
        String id = call.getString("purchaseId");
        RuStorePayClient c = client();
        if (id == null || id.isEmpty() || c == null) { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); return; }
        try {
            c.getPurchaseInteractor()
                .updateAcknowledgementState(new PurchaseId(id), AcknowledgementState.ACKNOWLEDGED, null)
                .addOnSuccessListener(new OnSuccessListener<AcknowledgementState>() {
                    @Override public void onSuccess(AcknowledgementState st) {
                        JSObject r = new JSObject(); r.put("ok", st == AcknowledgementState.ACKNOWLEDGED); call.resolve(r);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable t) { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); }
                });
        } catch (Throwable t) { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); }
    }

    /** 1.0.7: код ошибки для JS. Первым - код сервера RuStore (RuStorePaymentNetworkException.getCode(), например
     *  «4000020»), иначе имя исключения core-SDK. Ищем по всей цепочке причин (не больше 20 звеньев). Ничего - null. */
    static String errorCode(Throwable t) {
        int guard = 0;
        for (Throwable c = t; c != null && guard < 20; c = c.getCause(), guard++) {
            if (c instanceof RuStorePaymentException.RuStorePaymentNetworkException) {
                String code = ((RuStorePaymentException.RuStorePaymentNetworkException) c).getCode();
                if (code != null && !code.trim().isEmpty()) return code.trim();
            }
        }
        guard = 0;
        for (Throwable c = t; c != null && guard < 20; c = c.getCause(), guard++) {
            String n = c.getClass().getSimpleName();
            if ("RuStoreNotInstalledException".equals(n)) return "RuStoreNotInstalled";
            if ("RuStoreOutdatedException".equals(n)) return "RuStoreOutdated";
            if ("RuStoreUserUnauthorizedException".equals(n)) return "UserUnauthorized";
            if ("RuStoreUserBannedException".equals(n)) return "UserBanned";
            if ("RuStoreApplicationBannedException".equals(n)) return "ApplicationBanned";
            // Хомяк 1.0.6 (ревью P5): «запущен процесс оплаты неизвестного типа продукта» (документация Pay SDK 11.1.0,
            // «Обработка ошибок») - прошлая оплата ещё не закрыта; JS ведёт к ожиданию/восстановлению, не к новому счёту
            if (c instanceof RuStorePaymentException.RuStorePayInvalidActivePurchase) return "InvalidActivePurchase";
        }
        return null;
    }

    /** purchaseId из исключения шторки (ProductPurchaseCancelled / ProductPurchaseException), если событие его не дало. */
    static String purchaseIdOf(Throwable t) {
        int guard = 0;
        for (Throwable c = t; c != null && guard < 20; c = c.getCause(), guard++) {
            try {
                PurchaseId id = null;
                if (c instanceof RuStorePaymentException.ProductPurchaseCancelled) id = ((RuStorePaymentException.ProductPurchaseCancelled) c).getPurchaseId();
                else if (c instanceof RuStorePaymentException.ProductPurchaseException) id = ((RuStorePaymentException.ProductPurchaseException) c).getPurchaseId();
                if (id != null) return id.getValue();
            } catch (Throwable ignored) {}
        }
        return null;
    }

    /** id оплаченной покупки нужного товара, ещё не отмеченной ACKNOWLEDGED, или null. */
    private static String ackPendingId(List<Purchase> purchases, String productId) {
        if (purchases == null) return null;
        for (Purchase p : purchases) {
            if (!(p instanceof ProductPurchase)) continue;
            ProductPurchase pp = (ProductPurchase) p;
            ProductId id = pp.getProductId();
            if (productId != null && (id == null || !productId.equals(id.getValue()))) continue;
            ProductPurchaseStatus st = pp.getStatus();
            if (st != ProductPurchaseStatus.PAID && st != ProductPurchaseStatus.CONFIRMED) continue;
            if (pp.getAcknowledgementState() == AcknowledgementState.ACKNOWLEDGED) continue;
            try { if (pp.getPurchaseId() != null) return pp.getPurchaseId().getValue(); } catch (Throwable ignored) {}
        }
        return null;
    }

    /** Цена товара из магазина (Product.getAmountLabel), НЕ хардкод. Заглушка/ошибка → JS падает на свою строку. */
    @PluginMethod
    public void getProducts(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null || productId.isEmpty()) {
            call.reject("не задан productId", "NO_PRODUCT");
            return;
        }
        RuStorePayClient c = client();
        if (c == null) { resolveUnavailable(call); return; }

        c.getProductInteractor()
            .getProducts(Collections.singletonList(new ProductId(productId)))
            .addOnSuccessListener(new OnSuccessListener<List<Product>>() {
                @Override
                public void onSuccess(List<Product> products) {
                    JSObject ret = new JSObject();
                    String label = priceLabel(products, productId);
                    if (label != null) {
                        ret.put("ok", true); ret.put("priceLabel", label);
                        // адв. ревью 12.10 (М-1): цена числом - Product.price в копейках + код валюты; JS берёт её первой
                        Product p = findProduct(products, productId);
                        try { if (p != null && p.getPrice() != null) ret.put("priceMinor", p.getPrice().getValue()); } catch (Throwable ignored) {}
                        try { if (p != null && p.getCurrency() != null) ret.put("currency", p.getCurrency().getValue()); } catch (Throwable ignored) {}
                    }
                    else { ret.put("ok", false); ret.put("unavailable", true); }
                    call.resolve(ret);
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Throwable t) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    ret.put("error", "не удалось получить цену");
                    call.resolve(ret);
                }
            });
    }

    /** Нужный товар из ответа магазина или null. */
    private static Product findProduct(List<Product> products, String productId) {
        if (products == null) return null;
        for (Product p : products) {
            ProductId id = p.getProductId();
            if (productId == null || (id != null && productId.equals(id.getValue()))) return p;
        }
        return null;
    }

    /** Готовая к показу строка цены нужного товара (например «590 ₽») или null. */
    private static String priceLabel(List<Product> products, String productId) {
        if (products == null) return null;
        for (Product p : products) {
            ProductId id = p.getProductId();
            boolean idMatch = productId == null || (id != null && productId.equals(id.getValue()));
            if (!idMatch) continue;
            try {
                if (p.getAmountLabel() != null) {
                    String v = p.getAmountLabel().getValue();
                    if (v != null && !v.trim().isEmpty()) return v.trim();
                }
            } catch (Throwable ignored) {}
        }
        return null;
    }

    /** Владеет ли пользователь непотребляемым товаром: ProductPurchase с нужным id в PAID/CONFIRMED. */
    private static boolean ownsProduct(List<Purchase> purchases, String productId) {
        if (purchases == null) return false;
        for (Purchase p : purchases) {
            if (!(p instanceof ProductPurchase)) continue;
            ProductPurchase pp = (ProductPurchase) p;
            ProductId id = pp.getProductId();
            boolean idMatch = productId == null || (id != null && productId.equals(id.getValue()));
            if (!idMatch) continue;
            ProductPurchaseStatus st = pp.getStatus();
            if (st == ProductPurchaseStatus.PAID || st == ProductPurchaseStatus.CONFIRMED) return true;
        }
        return false;
    }

    /** Адв. ревью 1.0.7: промежуточные статусы покупки - оплата запущена, итога ещё нет (enum ProductPurchaseStatus, SDK 11.1.0).
     *  INVOICE_CREATED («счёт создан, ожидает оплаты») - НЕ pending: висит после закрытой без оплаты шторки до EXPIRED. */
    static final ProductPurchaseStatus[] PENDING_STATUSES = {
        ProductPurchaseStatus.PROCESSING, ProductPurchaseStatus.EXECUTING
    };

    /** Статус покупки с этим id из списка (ok|pending|open|cancelled|error) или null - её нет в списке. */
    private static String statusIn(List<Purchase> purchases, String purchaseId) {
        if (purchases == null || purchaseId == null) return null;
        for (Purchase p : purchases) {
            try { if (p.getPurchaseId() != null && purchaseId.equals(p.getPurchaseId().getValue())) return statusOf(p); } catch (Throwable ignored) {}
        }
        return null;
    }

    /** Лог статусов покупок товара (id и имя статуса - без сумм и данных пользователя). */
    private static void logPurchases(List<Purchase> purchases, String productId) {
        try {
            StringBuilder b = new StringBuilder("getPurchases");
            if (purchases != null) for (Purchase p : purchases) {
                if (!(p instanceof ProductPurchase)) continue;
                ProductPurchase pp = (ProductPurchase) p;
                ProductId id = pp.getProductId();
                if (productId != null && (id == null || !productId.equals(id.getValue()))) continue;
                b.append(' ').append(pp.getPurchaseId() != null ? pp.getPurchaseId().getValue() : "?").append('=').append(pp.getStatus());
            }
            Log.i(LOG, b.toString());
        } catch (Throwable ignored) {}
    }

    /** Самая свежая покупка нужного товара в промежуточном статусе (PENDING_STATUSES) или null. */
    private static ProductPurchase pendingPurchase(List<Purchase> purchases, String productId) {
        if (purchases == null) return null;
        ProductPurchase best = null;
        for (Purchase p : purchases) {
            if (!(p instanceof ProductPurchase)) continue;
            ProductPurchase pp = (ProductPurchase) p;
            ProductId id = pp.getProductId();
            boolean idMatch = productId == null || (id != null && productId.equals(id.getValue()));
            if (!idMatch) continue;
            ProductPurchaseStatus st = pp.getStatus();
            boolean pend = false;
            for (ProductPurchaseStatus ps : PENDING_STATUSES) if (st == ps) pend = true;
            if (!pend) continue;
            if (best == null || newer(pp, best)) best = pp;
        }
        return best;
    }

    private static boolean newer(ProductPurchase a, ProductPurchase b) {
        try {
            Date ta = a.getPurchaseTime(), tb = b.getPurchaseTime();
            return ta != null && (tb == null || ta.after(tb));
        } catch (Throwable t) { return false; }
    }

    /** Покупка нужного товара возвращена/сторнирована (REFUNDED/REVERSED) - доступ снимается. */
    private static boolean revokedProduct(List<Purchase> purchases, String productId) {
        if (purchases == null) return false;
        for (Purchase p : purchases) {
            if (!(p instanceof ProductPurchase)) continue;
            ProductPurchase pp = (ProductPurchase) p;
            ProductId id = pp.getProductId();
            boolean idMatch = productId == null || (id != null && productId.equals(id.getValue()));
            if (!idMatch) continue;
            ProductPurchaseStatus st = pp.getStatus();
            if (st == ProductPurchaseStatus.REFUNDED || st == ProductPurchaseStatus.REVERSED) return true;
        }
        return false;
    }

    private static String extractPurchaseId(ProductPurchaseResult result) {
        try {
            if (result != null && result.getPurchaseId() != null) return result.getPurchaseId().getValue();
        } catch (Throwable ignored) {}
        return null;
    }

    /** Отмена оплаты пользователем: класс SDK ProductPurchaseCancelled, запасной путь - имя класса (…Cancel…).
     *  Цепочка причин - не больше 20 звеньев (защита от цикла getCause). */
    static boolean isCancellation(Throwable t) {
        int guard = 0;
        for (Throwable c = t; c != null && guard < 20; c = c.getCause(), guard++) {
            if (c instanceof RuStorePaymentException.ProductPurchaseCancelled) return true;
            String n = c.getClass().getSimpleName();
            if (n != null && n.toLowerCase().contains("cancel")) return true;
        }
        return false;
    }

    /** События шторки этой сессии: purchaseId появляется на onPurchaseCreated (до оплаты) - по нему потом спрашиваем статус. */
    private static final class SessionEvents implements PurchaseEventListener {
        private final Session s;
        private final Context ctx;
        SessionEvents(Session s, Context ctx) { this.s = s; this.ctx = ctx; }
        private void seen(PurchaseId id, String ev) {
            try { if (id != null && id.getValue() != null) s.purchaseId = id.getValue(); } catch (Throwable ignored) {}
            s.lastEvent = ev;
            Log.i(LOG, "event " + ev + " id=" + s.purchaseId);
            // R1: «оплата начата» - на диск (процесс могут убить, пока человек в банке); банк отказал / отмена - стереть
            if ("started".equals(ev) || "completed".equals(ev)) saveStarted(ctx, s.purchaseId);
            else if ("failed".equals(ev) || "cancelled".equals(ev)) clearStarted(ctx, s.purchaseId);
        }
        @Override public void onPurchaseCreated(PurchaseId purchaseId, InvoiceId invoiceId) { seen(purchaseId, "created"); }
        @Override public void onPaymentStarted(PurchaseId purchaseId, InvoiceId invoiceId) { seen(purchaseId, "started"); }
        @Override public void onPaymentCompleted(PurchaseId purchaseId, InvoiceId invoiceId) { seen(purchaseId, "completed"); }
        @Override public void onPaymentFailed(PurchaseId purchaseId, InvoiceId invoiceId) { seen(purchaseId, "failed"); }
        @Override public void onPurchaseCancelled(PurchaseId purchaseId, InvoiceId invoiceId) { seen(purchaseId, "cancelled"); }
    }
}
