import java.net.URI
import java.util.Base64
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release-Signierung aus android/key.properties (nicht im Git, siehe android/key.properties.example).
// Fehlt die Datei, wird mit dem Debug-Schlüssel signiert, damit `flutter run --release` weiter geht.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProperties.getProperty("storeFile") != null

// App Links: Host aus dem dart-define API_BASE_URL (tool/build.sh setzt es aus firebase.env). Flutter reicht die
// Defines base64-kodiert als Gradle-Property "dart-defines" durch. Ohne Adresse bleibt ein Platzhalter-Host.
val dartDefines: Map<String, String> = (project.findProperty("dart-defines") as String?)
    ?.split(",")
    ?.mapNotNull { encoded ->
        val kv = String(Base64.getDecoder().decode(encoded)).split("=", limit = 2)
        if (kv.size == 2) kv[0] to kv[1] else null
    }
    ?.toMap() ?: emptyMap()
val appLinkHost: String = dartDefines["API_BASE_URL"]?.let { url -> try { URI(url).host } catch (_: Exception) { null } } ?: "example.invalid"

android {
    namespace = "ch.familienalbum.familienalbum"
    // flutter_secure_storage 11 verlangt API 37 (Flutter selbst gibt 36 vor)
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "ch.familienalbum.familienalbum"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appLinkHost"] = appLinkHost
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
