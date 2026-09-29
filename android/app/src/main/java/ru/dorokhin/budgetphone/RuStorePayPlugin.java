package ru.dorokhin.budgetphone;

import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;

import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;
import ru.rustore.sdk.pay.RuStorePayClient;
import ru.rustore.sdk.pay.RuStorePayClientProvider;
import ru.rustore.sdk.pay.callback.PurchaseEventListener;
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
import ru.rustore.sdk.pay.model.PurchaseId;
import ru.rustore.sdk.pay.model.SdkTheme;
import ru.rustore.sdk.pay.model.UserAuthorizationStatus;

/**
 * RuStorePay — мост к RuStore Pay SDK для РАЗОВОЙ покупки «Полного доступа» (NON_CONSUMABLE).
 * Эталон и происхождение кода — Проекты/Сейф/mobile/.../RuStorePayPlugin.java: там этот же
 * API уже собран и javap-проверен по AAR. Здесь дополнительно есть getProducts (цена из магазина).
 *
 * Реальный API Pay SDK 11.1.0 (BOM ru.rustore.sdk:bom:2026.08.01):
 *   client  = new RuStorePayClientProvider().provide(context, ConsoleApplicationId, Map)
 *   purchase(ProductPurchaseParams, PreferredPurchaseType, SdkTheme, PurchaseEventListener)
 *             → ru.rustore.sdk.core.tasks.Task<ProductPurchaseResult>
 *   getPurchases(ProductType, PurchaseStatus, AcknowledgementState)  (null,null,null = все)
 *             → Task<List<Purchase>>
 *   getProducts(List<ProductId>) → Task<List<Product>>   (цена: Product.getAmountLabel())
 *   Task: addOnSuccessListener(OnSuccessListener<T>) / addOnFailureListener(OnFailureListener)
 *
 * ConsoleApplicationId берём из strings.xml (rustore_console_app_id). ПОКА там маркер-заглушка:
 * при заглушке/пустом id нативный клиент НЕ инициализируется (client()==null) — покупка отвечает
 * {ok:false, unavailable:true} (не «ошибка платежа», а «оплата ещё не сконфигурирована»), а
 * getPurchases — {owned:false, unavailable:true} (JS кэш владения при этом не трогает). Так релиз/стор-APK с плейсхолдером собирается и не даёт
 * бесплатный Pro, а живую оплату Алексей проверяет на девайсе, вписав реальный id в strings.xml
 * (держать в синхроне с www/pay-config.js). В браузере/деве JS-адаптер и так уходит на MockPayment.
 *
 * JS-контракт (см. www/pay.js → createRuStorePayment):
 *   NativePlugins.RuStorePay.purchase({productId})
 *     → {ok:true, purchaseId:'…'} | {ok:false, cancelled:true} | {ok:false, unavailable:true} | {ok:false, error:'…'}
 *   NativePlugins.RuStorePay.getPurchases({productId})
 *     → {owned, revoked, authorized} | {owned:false, unavailable:true} (заглушка id) | reject (сеть/SDK)
 *   NativePlugins.RuStorePay.getProducts({productId})  → {ok:true, priceLabel:'…'} | {ok:false, unavailable:true}
 */
@CapacitorPlugin(name = "RuStorePay")
public class RuStorePayPlugin extends Plugin {

    private RuStorePayClient payClient;

    /** Схема deeplink возврата из банковских приложений (СБП/SberPay). ДОЛЖНА совпадать с
     *  meta-data sdk_pay_scheme_value и intent-filter MainActivity в AndroidManifest.xml. */
    static final String PAY_SCHEME = "ru.dorokhin.homyak.rustore";

    /** Клиент Pay SDK. null → id не задан (заглушка) → покупка недоступна.
     *  ВАЖНО: SDK сам инициализируется ContentProvider'ом на старте приложения по meta-data
     *  console_app_id_value (+ sdk_pay_scheme_value). Повторный provide() бросает
     *  RuStorePayClientAlreadyExist - поэтому сначала берём готовый экземпляр getInstance(),
     *  и только если провайдер его не создал - инициализируем сами (со схемой deeplink). */
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
                cfg.put("scheme", PAY_SCHEME);
                return new RuStorePayClientProvider()
                    .provide(ctx.getApplicationContext(), new ConsoleApplicationId(appId), cfg);
            } catch (Throwable alreadyExist) {
                try { return RuStorePayClient.Companion.getInstance(); } catch (Throwable t) { return null; }
            }
        }
    }

    /** Возврат из банковского приложения (deeplink PAY_SCHEME) - отдать интент SDK, чтобы он
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
        ret.put("unavailable", true);   // «оплата не сконфигурирована», а не «платёж не прошёл»
        call.resolve(ret);
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

        ProductPurchaseParams params = new ProductPurchaseParams(
            new ProductId(productId),
            /* quantity */ null,
            /* orderId */ null,
            /* developerPayload */ null,
            /* appUserId */ null,
            /* appUserEmail */ null
        );
        c.getPurchaseInteractor()
            .purchase(params, PreferredPurchaseType.ONE_STEP, SdkTheme.DARK, new NoopPurchaseEvents())
            .addOnSuccessListener(new OnSuccessListener<ProductPurchaseResult>() {
                @Override
                public void onSuccess(ProductPurchaseResult result) {
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("purchaseId", extractPurchaseId(result));
                    call.resolve(ret);
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Throwable t) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    if (isCancellation(t)) ret.put("cancelled", true);
                    else ret.put("error", "Платёж не прошёл");
                    call.resolve(ret);
                }
            });
    }

    @PluginMethod
    public void getPurchases(final PluginCall call) {
        final String productId = call.getString("productId");
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
                    if (label != null) { ret.put("ok", true); ret.put("priceLabel", label); }
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

    /** Готовая к показу строка цены нужного товара (например «990 ₽») или null. */
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

    /** Отмена оплаты пользователем — распознаём по имени класса исключения (…Cancelled…). */
    private static boolean isCancellation(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            String n = c.getClass().getSimpleName();
            if (n != null && n.toLowerCase().contains("cancel")) return true;
        }
        return false;
    }

    /** Обязательный слушатель событий шторки; итог покупки берём из Task, здесь ничего не делаем. */
    private static final class NoopPurchaseEvents implements PurchaseEventListener {
        @Override public void onPurchaseCreated(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPaymentStarted(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPaymentCompleted(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPaymentFailed(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPurchaseCancelled(PurchaseId purchaseId, InvoiceId invoiceId) {}
    }
}
