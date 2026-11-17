# BLOFY STREAM 55.8.32 — Android 9 audio-output evidence QA

Base: the **exact already-signed owner 55.8.32 source SHA** `c7cb9c3a1e2db7576033f1559418d9d7eee5384f` (not the repository's stale main).
Scope: isolated `streamCodeDemo` / `tv.blofy.player.v2.stream.qa` only; no auto-updater, signing, customer migration, server content changes, or Play publication.

## Change

1. Within the existing **Audio > Diagnose audio** and **Stream information** UI, show current Media3 **audio decoder initialized**, **audio output position started advancing**, **codec error** or **AudioSink warning** (plus capped underruns) for the current live playback. All state exists only in memory. It resets at each authorized channel change or session recreation. No URL, credentials, subscriber ID, media title, decoder name or error body is recorded. This is observational, not a reason to restart playback.
2. Offer **Try AAC track** only if Media3 identifies a different **supported, not already selected AAC** track within the **same current player**. User must explicitly press it. It changes only Media3's track selection override, retaining the current URI and video surface. The action rejects stale channel-dialog presses and releases Arabic sidecar output. It does not fetch the provider again, transcode, force an unsupported codec, replace Xtream paths or persist a global audio preference.
3. Every message explicitly says that even Media3 output advancing **does not prove sound is audible on Android TV**. An AudioSink callback can be transient and must not initiate automatic retries.

## Device acceptance

Install only the isolated QA APK on an Android 9 box alongside the stable signed app, without uninstalling the stable app. Confirm existing content is licensed for testing.

- For one channel where Windows has sound and Android lacks sound, note the Audio > Diagnose audio summary **without sharing credentials**: track count and type, output evidence, AudioSink/codec warnings.
- If a supported AAC alternative appears, press **Try AAC track** and confirm sound by listening. On a channel with no AAC alternative this option must not appear. Both paths must preserve the live video and user-selected original channel URI.
- Switch to another channel: previous AudioSink warnings and output evidence must not carry over.
- Verify non-Live movie/series playback and non-STREAM BLOFY PLAYER variants are unchanged; their player wiring is not modified.
- Never interpret an FFmpeg lab's ability to decode a synthetic sample as proof that Android 9 can decode this source's audio. If no alternate supported audio exists, use the separately approved TS-sample diagnostic to determine next steps.

## Automated checks and rollout boundary

Targeted Robolectric tests cover Android 9 track support, actual selected-vs-available tracks, duplicate AAC avoidance, missing audio, evidence reset, bounded underruns, and non-audibility claims. Dedicated pull-request workflow compiles **streamCodeDemo**, runs audio tests and uploads **QA-only unsigned** APK artifact. A full device listening test is still required; passing CI does not authorize signing or publication.

Rollback: discard the QA branch; production 55.8.32 signed APK and update feeds remain pinned to the old SHA. No signing keys or API secrets are added.
