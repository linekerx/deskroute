import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Версия берётся из package.json, чтобы десктоп и Android совпадали
val pkg = JsonSlurper().parse(rootDir.resolve("../package.json")) as Map<*, *>
val appVersion = pkg["version"] as String
val versionParts = appVersion.split(".").map { it.toInt() }

android {
    namespace = "app.deskroute.client"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.deskroute.client"
        minSdk = 24
        targetSdk = 33
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
        versionName = appVersion
    }

    signingConfigs {
        create("release") {
            // Ключ можно заменить своим через переменные окружения (секреты GitHub Actions)
            val envStore = System.getenv("DR_KEYSTORE")
            storeFile = if (envStore != null) file(envStore) else rootProject.file("keystore/deskroute.jks")
            storePassword = System.getenv("DR_KEYSTORE_PASSWORD") ?: "deskroute"
            keyAlias = System.getenv("DR_KEY_ALIAS") ?: "deskroute"
            keyPassword = System.getenv("DR_KEY_PASSWORD") ?: "deskroute"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(files("libs/libv2ray.aar"))
}
