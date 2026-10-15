package ru.dorokhin.budgetphone;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Ревью 12.10 №9: BridgeActivity.load() внутри super.onCreate сам зовёт onNewIntent(getIntent()) -
    // это повтор интента запуска, а не новый тап. Напоминание из него берёт только onCreate, с
    // заслонами (свежий запуск, не «Недавние»). До конца super.onCreate - false.
    private boolean started = false;

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
        // Окно «Отправить» с файлом: выгрузка операций в Excel (1.0.4).
        registerPlugin(ShareFilePlugin.class);
        registerPlugin(RuStorePayPlugin.class);
        // Окно оценки RuStore (Review SDK) и шторка «недавних» для «Кода на вход» (1.0.3).
        registerPlugin(RuStoreReviewPlugin.class);
        registerPlugin(AppPrivacyPlugin.class);
        // Проверка обновления через RuStore App Update SDK (1.0.3, как в «Карте года»): зовёт
        // только стор-сборка, свой манифест на CDN она больше не читает.
        registerPlugin(RuStoreUpdatePlugin.class);
        // Напоминания о платежах по долгам: локальные уведомления (1.0.4).
        registerPlugin(ReminderPlugin.class);
        super.onCreate(savedInstanceState);
        started = true;

        // Своя типографика: системный «размер шрифта» Android иначе растягивает подписи
        // плиток, и в поле расходов вместо четырёх рядов остаётся три с пустой полосой
        // внизу. Экран у приложения свёрстан под собственный масштаб, поэтому текст
        // держим на 100 %. WebView существует только после super.onCreate - его создаёт
        // мост, поэтому строка стоит ниже, а не рядом с registerPlugin.
        getBridge().getWebView().getSettings().setTextZoom(100);

        // RuStore Pay: возврат из банковского приложения (СБП/SberPay) приходит deeplink'ом
        // ru.dorokhin.homyak.rustore://… - SDK должен его обработать, чтобы довести оплату.
        if (savedInstanceState == null) RuStorePayPlugin.proceedIntent(getApplicationContext(), getIntent());
        // тап по напоминанию о долге при холодном старте - открыть платёж (debts.js забирает takeTap).
        // Только свежий запуск (ревью 12.10 №9): восстановление после гибели процесса
        // (savedInstanceState) и запуск из «Недавних» (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) приносят
        // тот же старый интент с id долга - второе окно платежа по давно обработанному тапу.
        // Интент в любом случае помечаем обработанным: extra напоминания из него убираем.
        if (freshLaunch(savedInstanceState, getIntent())) ReminderPlugin.takeIntent(getIntent());
        setIntent(ReminderPlugin.dropIntent(getIntent()));
    }

    static boolean freshLaunch(Bundle saved, Intent i) {
        return saved == null && i != null && (i.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        RuStorePayPlugin.proceedIntent(getApplicationContext(), intent);
        if (!started) return;   // повтор интента запуска из super.onCreate - его разобрал onCreate
        // приложение было открыто или в фоне: тап сразу отдаём в WebView событием (ревью 12.10 №8) -
        // при открытом приложении visibilitychange не приходит, ждать его нельзя
        if (ReminderPlugin.takeIntent(intent)) {
            setIntent(ReminderPlugin.dropIntent(intent));
            try { getBridge().triggerJSEvent(ReminderPlugin.TAP_EVENT, "document"); } catch (Throwable ignored) {}
        }
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
