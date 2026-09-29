/* version.js — единственный источник номера версии на стороне приложения.
   Файл ГЕНЕРИРУЕТСЯ сборкой (build-apk.js / build-ota.js берут version из
   package.json и переписывают эту строку; build-apk.js заодно синхронизирует
   versionName/versionCode в android/app/build.gradle). Руками не правь -
   правь package.json. В репозитории лежит собранным, чтобы версия была видна
   и в браузерном превью. */
window.APP_VERSION = '1.0.1';
