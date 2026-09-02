import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

val activationBaseUrl = providers.gradleProperty("BLOFY_ACTIVATION_BASE_URL").orElse("").get()
val activationBaseUrlEscaped = activationBaseUrl.replace("\\", "\\\\").replace("\"", "\\\"")
val buildSha = providers.gradleProperty("BLOFY_BUILD_SHA")
    .orElse(providers.environmentVariable("GITHUB_SHA"))
    .orElse("local").get().trim().ifBlank { "local" }
val buildShaEscaped = buildSha.replace("\\", "\\\\").replace("\"", "\\\"")
val ffmpegAarPath = providers.gradleProperty("BLOFY_FFMPEG_AAR").orElse("").get().trim()
val ffmpegAar = ffmpegAarPath.takeIf { it.isNotBlank() }?.let { file(it) }
if (ffmpegAar != null) check(ffmpegAar.exists() && ffmpegAar.isFile) { "BLOFY_FFMPEG_AAR points to a missing file: ${ffmpegAar.absolutePath}" }

fun releaseSetting(name: String) = providers.environmentVariable(name).orElse(providers.gradleProperty(name))
val releaseKeystorePath = releaseSetting("BLOFY_RELEASE_KEYSTORE_PATH")
val releaseStorePassword = releaseSetting("BLOFY_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = releaseSetting("BLOFY_RELEASE_KEY_ALIAS")
val releaseKeyPassword = releaseSetting("BLOFY_RELEASE_KEY_PASSWORD")

android {
    namespace = "tv.blofy.player"
    compileSdk = 36
    defaultConfig {
        applicationId = "tv.blofy.player.v2"
        minSdk = 23
        targetSdk = 36
        versionCode = 2000007
        versionName = "2.0.0-rc06"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "ACTIVATION_BASE_URL", "\"$activationBaseUrlEscaped\"")
        buildConfigField("String", "BUILD_SHA", "\"$buildShaEscaped\"")
        buildConfigField("boolean", "FFMPEG_EXTENSION_BUNDLED", (ffmpegAar != null).toString())
    }
    signingConfigs {
        create("release") {
            storeFile = releaseKeystorePath.orNull?.takeIf { it.isNotBlank() }?.let { rootProject.file(it) }
            storePassword = releaseStorePassword.orNull
            keyAlias = releaseKeyAlias.orNull
            keyPassword = releaseKeyPassword.orNull
            storeType = "PKCS12"
            enableV1Signing = true
            enableV2Signing = true
        }
    }
    buildTypes {
        getByName("release") {
            isDebuggable = false
            isJniDebuggable = false
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { viewBinding = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*") }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.media3:media3-exoplayer:1.6.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.6.1")
    implementation("androidx.media3:media3-ui:1.6.1")
    implementation("androidx.media3:media3-datasource-cronet:1.6.1")
    implementation("androidx.media3:media3-database:1.6.1")
    implementation("com.google.android.gms:play-services-cronet:18.1.0")
    if (ffmpegAar != null) implementation(files(ffmpegAar))
    implementation("androidx.room:room-runtime:2.7.0")
    implementation("androidx.room:room-ktx:2.7.0")
    ksp("androidx.room:room-compiler:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit-ktx:1.2.1")
}

val validateReleaseConfiguration = tasks.register("validateReleaseConfiguration") {
    group = "verification"
    description = "Fails closed when production endpoint or release signing inputs are missing."
    doLast {
        val signingInputs = linkedMapOf(
            "BLOFY_RELEASE_KEYSTORE_PATH" to releaseKeystorePath.orNull,
            "BLOFY_RELEASE_STORE_PASSWORD" to releaseStorePassword.orNull,
            "BLOFY_RELEASE_KEY_ALIAS" to releaseKeyAlias.orNull,
            "BLOFY_RELEASE_KEY_PASSWORD" to releaseKeyPassword.orNull,
        )
        val missingInputs = signingInputs.filterValues { it.isNullOrBlank() }.keys
        check(missingInputs.isEmpty()) { "Release signing is not configured. Missing: ${missingInputs.joinToString()}" }
        val keystoreFile = rootProject.file(checkNotNull(releaseKeystorePath.orNull))
        check(keystoreFile.isFile && keystoreFile.canRead()) { "BLOFY_RELEASE_KEYSTORE_PATH is not a readable file: ${keystoreFile.absolutePath}" }
        val endpointUri = runCatching { URI(activationBaseUrl.trim()) }.getOrNull()
        check(endpointUri != null && endpointUri.scheme.equals("https", true) && !endpointUri.host.isNullOrBlank() && endpointUri.userInfo == null && endpointUri.query == null && endpointUri.fragment == null) {
            "Release builds require BLOFY_ACTIVATION_BASE_URL to be a valid HTTPS base URL."
        }
    }
}

tasks.configureEach {
    val releaseTaskName = name.lowercase()
    val packagesRelease = listOf("assemble", "bundle", "package", "install", "publish").any { releaseTaskName.startsWith(it) }
    if (name == "validateSigningRelease" || ("release" in releaseTaskName && packagesRelease)) dependsOn(validateReleaseConfiguration)
}