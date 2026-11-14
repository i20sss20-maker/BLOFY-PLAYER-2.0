# BLOFY Android / Android TV — Local owner media QA bench

## Scope and release safety

The private media test screen in `PrivateMediaQaActivity` is visible only for debug-build installations (including isolated `codeDemo`). It is an internal QA tool, **not** a subscriber library, not an Android TV production rollout and not a remote media client.

The Activity is `android:exported="false"` and fails closed when `BuildConfig.DEBUG` is false. The normal release and `codeOnly` builds do not show a navigation link. No Hub URL, operator token, provider credential, stream URL or playlist is embedded. Media is opened only from `content://` URIs chosen by the owner via Android system picker.

## Owner testing procedure

1. Open the authenticated BLOFY Content Hub, in **جاهزية الحلقات واختبار الصورة والصوت** select the correct platform `android` (phone) or `android_tv` (TV), a season and episode page, then choose **تجهيز ملف اختبار الجهاز**.
2. Put the downloaded JSON on your test device, along with a **separately licensed local video sample** you have permission to test. The JSON contains no playable video. On some Android TV devices you may need a compatible document/file-picker application to access local files.
3. In a **debug-only** BLOFY app, go to **الإعدادات → مختبر الفيديو الخاص**. Import the JSON with Android's document picker. It must match the detected device type, v1 schema and non-publication flags, and be at most 128 KiB (50 episodes per page).
4. Pick an eligible registered episode from the worksheet, then select a **local** video. Media3 is used to render the file directly. Press Play manually and test image, audible sound, D-pad on Android TV, seeking/resume and subtitles. The app displays player-ready, first-frame, audio-track and subtitle-track observations. An audio track's mere presence does **not** prove audible sound.
5. Mark manual observations you actually confirmed. Save the local `blofy.local-device-qa-observation` JSON report via Android's Create Document picker. The report does not contain the local file URI, source URL, tokens or account details; it contains explicit `hubMediaIdentityVerified:false`, `hubBackendUpdated:false` and `contentReleaseApproved:false`.
6. Continue separate authenticated **browser** preview of the *same authorized storage-backed media* before claiming the backend episode itself passed A/V. This local test alone cannot establish correspondence between the imported QA episode and the selected local sample.
7. Only after separate real-device and rights review, plan staged integration with separate revocable, short-lived media grants. This QA screen never allows a subscriber to retrieve Hub content.

## Validation

PR Android CI builds and unit-tests debug and `codeDemo`, and exposes the unsigned-for-production debug-key-signed `app-codeDemo.apk` as a short-lived GitHub Actions artifact. Never publish this QA APK as a general update or replace the download-site customer build. Verify D-pad focus, a file-picker working on Android 9 TV boxes, image, audio and fallback cases on the physical device.

**Current limits:** No Windows application changes, no customer video URL binding, no private Hub media in the app, no media rehosting, no automatic proof upload, and no production release. Results are operator-observed device-local evidence only.
