package ru.dorokhin.budgetphone;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // СТОР-сборка (build-apk.js --store → -PhomyakStore=true → bool/homyak_store): обновления
        // кода только через RuStore. Путь к скачанной когда-то веб-сборке (бесшовное обновление
        // прямой раздачи, CapWebViewSettings/serverBasePath) забываем ДО старта моста - Bridge
        // читает его в super.onCreate. Так стор-оболочка всегда грузит встроенный www, даже если
        // до неё на телефоне стояла прямая сборка с OTA-папкой той же версии.
        if (isStoreBuild()) {
            try {
                getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().remove(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH).commit();
            } catch (Throwable ignored) {}
        }

        // Свои плагины регистрируются ДО super.onCreate: мост собирает список плагинов
        // при создании, и всё, что записано позже, он уже не увидит.
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(RuStorePayPlugin.class);
        super.onCreate(savedInstanceState);

        // Своя типографика: системный «размер шрифта» Android иначе растягивает подписи
        // плиток, и в поле расходов вместо четырёх рядов остаётся три с пустой полосой
        // внизу. Экран у приложения свёрстан под собственный масштаб, поэтому текст
        // держим на 100 %. WebView существует только после super.onCreate - его создаёт
        // мост, поэтому строка стоит ниже, а не рядом с registerPlugin.
        getBridge().getWebView().getSettings().setTextZoom(100);

        // RuStore Pay: возврат из банковского приложения (СБП/SberPay) приходит deeplink'ом
        // ru.dorokhin.homyak.rustore://… - SDK должен его обработать, чтобы довести оплату.
        if (savedInstanceState == null) RuStorePayPlugin.proceedIntent(getApplicationContext(), getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        RuStorePayPlugin.proceedIntent(getApplicationContext(), intent);
    }

    private boolean isStoreBuild() {
        try {
            int id = getResources().getIdentifier("homyak_store", "bool", getPackageName());
            return id != 0 && getResources().getBoolean(id);
        } catch (Throwable t) {
            return false;
        }
    }
}
