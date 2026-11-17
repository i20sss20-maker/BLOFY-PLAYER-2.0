# BLOFY STREAM 55.8.32 — Android 9 audio-output evidence QA

Base: the **exact already-signed owner 55.8.32 source SHA** `c7cb9c3a1e2db7576033f1559418d9d7eee5384f` (not the repository's stale main).
Scope: isolated `streamCodeDemo` / `tv.blofy.player.v2.stream.qa` only; no auto-updater, signing, customer migration, server content changes, or Play publication.

## Change

1. Within the existing **Audio > Diagnose audio** and **Stream information** UI, show current Media3 **audio decoder initialized**, **audio output position started advancing**, **codec error** or **AudioSink warning** (plus capped underruns) for the current live playback. All state exists only in memory. It resets at each authorized channel change or session recreation. No URL, credentials, subscriber ID, media title, decoder name or error body is recorded. This is observational, not a reason to restart playback.
2. When moving from channel A to B inside the **same STREAM Live player**, clear only channel A's manual audio track override and re-enable Media3-supported audio auto-selection. Retain preferred audio language, subtitle selection and video quality settings. Also reset decoder/audio-sink evidence when the viewer switches between embedded audio tracks, so old observations are not presented as proof for the next track. Never trigger an automatic new provider connection just to change audio.
3. Offer **Try AAC track** only if Media3 identifies a different **supported, not already selected AAC** track within the **same current player**. User must explicitly press it. It changes only Media3's track selection override, retaining the current URI and video surface. The action rejects stale channel-dialog presses and releases Arabic sidecar output. It does not fetch the provider again, transcode, force an unsupported codec, replace Xtream paths or persist a global audio preference.
4. Every message explicitly says that even Media3 output advancing **does not prove sound is audible on Android TV**. An AudioSink callback can be transient and must not initiate automatic retries.

## Owner-only copyable audio report

In STREAM Live playback, open **More > Stream information** and press
**نسخ تقرير الصوت / Copy audio report**. This is a one-click, user-initiated
clipboard copy; no telemetry upload or new source request is made. It includes
only Android SDK, Media3 playback state, bounded track counts, allowlisted audio
MIME, decoder/sink event booleans, capped underruns and the explicit
`audible_sound=not_verified` caveat. It NEVER includes provider host, playlist,
session key, code, device identity, channel title, raw exception or media URL.
The device clipboard is managed by Android: after copying and sharing the
report with support, the owner can clear the clipboard.

Copy the report for one **working** channel and one **silent** channel using
the exact same Android TV box. This comparison lets us distinguish an
unsupported track, a selected track without decoder/output progress, a
decoder exception, an audio-sink warning, or a TV-level output issue. It still
cannot establish whether sound was audible without listening.

## Device acceptance

Install only the isolated QA APK on an Android 9 box alongside the stable signed app, without uninstalling the stable app. Confirm existing content is licensed for testing.

- For one channel where Windows has sound and Android lacks sound, note the Audio > Diagnose audio summary **without sharing credentials**, then press **Copy audio report** in Stream information. Share only the sanitized report, and compare to a working channel on the same device.
- If a supported AAC alternative appears, press **Try AAC track** and confirm sound by listening. On a channel with no AAC alternative this option must not appear. Both paths must preserve the live video and user-selected original channel URI.
- Switch from a manually selected AAC/AC3 channel to another channel: the old track override must not follow the new channel, while the preferred language, subtitles and video quality remain intact.
- Switch audio tracks within the same channel: output progress and AudioSink error evidence must reset so the next track starts with a clean diagnosis.
- Verify non-Live movie/series playback and non-STREAM BLOFY PLAYER variants are unchanged; their player wiring is not modified.
- Never interpret an FFmpeg lab's ability to decode a synthetic sample as proof that Android 9 can decode this source's audio. If no alternate supported audio exists, use the separately approved TS-sample diagnostic to determine next steps.

## Automated checks and rollout boundary

Targeted Robolectric tests cover Android 9 track support, actual selected-vs-available tracks, per-channel audio override isolation while preserving subtitles/video/language, duplicate AAC avoidance, missing audio, evidence reset, bounded underruns, and non-audibility claims. Dedicated pull-request workflow compiles **streamCodeDemo**, runs audio tests and uploads **QA-only unsigned** APK artifact. A full device listening test is still required; passing CI does not authorize signing or publication.

Rollback: discard the QA branch; production 55.8.32 signed APK and update feeds remain pinned to the old SHA. No signing keys or API secrets are added.
