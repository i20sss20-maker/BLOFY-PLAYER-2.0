# Xiaomi Android TV standalone edition

Target test device: Xiaomi MiTV-AESP0, Android TV 9 (API 28).

The Xiaomi edition is opt-in and uses application ID `tv.blofy.player.xiaomi`, separate from the existing `tv.blofy.player.v2`. The main/default build is unchanged.

Build with a configured Android SDK and signing credentials:

```sh
./gradlew :app:assembleRelease -PBLOFY_XIAOMI_EDITION=true
```

Use the existing `BLOFY_RELEASE_*` signing inputs described in `app/build.gradle.kts`. Do not commit credentials. The resulting APK must be signed before distribution. Verify the package name with `apkanalyzer manifest application-id`, signatures with `apksigner verify --verbose`, and APK integrity with SHA-256. Install on a clean MiTV-AESP0 Android 9 device and test launch, remote navigation, login and playback before publishing.

Note: This branch currently derives from the repository's `2.0.0-rc06` source, not a verified v74 source snapshot. Do not label the APK as v74 without confirming the source version. A different application ID means users must log in separately; data is not migrated automatically.
