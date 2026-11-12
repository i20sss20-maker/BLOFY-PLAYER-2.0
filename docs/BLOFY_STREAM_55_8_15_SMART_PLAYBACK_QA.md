# BLOFY STREAM 55.8.15 — Smart Playback 2.0 (isolated candidate)

Date: 2026-11-12. **Candidate, not publicly signed or published.**
Base: latest owner-signed 55.8.14 source plus safe Android 9 audio QA improvements. Candidate versionCode `2000092`; test-only package `tv.blofy.player.v2.stream.qa` installs beside stable `tv.blofy.player.v2.stream`.

## Implemented and regression-tested behavior

1. **Android 9 audio recovery:** If Media3 reports a supported alternative audio track while the selected track is *unsupported*, try the supported track **once for this MediaItem**. No media restart, no second Xtream request, no transcode. Only in STREAM code-only live playback.
2. **Respect viewer intent:** Never override an explicitly chosen audio track, intentionally disabled audio track type, muted player or already selected supported audio track. When changing to a different live channel, clear outdated per-channel audio track-group overrides without clearing the audio-disabled setting.
3. **Provider admission:** On detected HTTP **401, 403, 429, 456**, cancel pending app-level retries and prevent alternate upstream / format retries. These are not transient source-outage cases. HTTP 408 and 5xx remain bounded by the existing recovery budget. Media3's own transport retry settings and provider-side behavior have not been independently proven.
4. **Clear diagnosis:** 456 shows a localized source-connection restriction rather than a generic connectivity error; 429 remains explicitly rate-limited. Diagnostic text never contains source URLs, passwords, codes or device IDs.

## Explicit limitations

- A supported/selected Media3 audio track does **not** prove that HDMI/SPDIF/speakers output audible audio. The application cannot automatically decide to transcode every source without provider authorization and verified decoder/cost impact.
- This QA does not grant new source connections. A 500-viewer synthetic fanout is **not** 500 real subscribers. Production's existing per-source capacity and upstream subscription limits remain unchanged.
- Windows STREAM continuity fixes are tracked separately in PR #575. They are not merged into this Android APK.
- Android TV D-pad, movies/episodes, 20+ minute Windows sessions, signature/upgrade, customer account/device activation, source entitlement and isolated production DB restore still require physical or operational verification.

## Device acceptance checklist

- [ ] On an actual Android 9 TV box, install **only** the parallel QA APK; do not uninstall the signed stable STREAM app.
- [ ] In authorized TS/HLS test channels, verify picture, audible AAC, alternate EAC3/AC3 when supported, track selection and Arabic/English diagnostics.
- [ ] Choose a track manually, then check the app does not override it; switch channels and confirm the next channel can use automatic track choice.
- [ ] Confirm 401/403/429/456 response tests do not trigger repeated client-side connections or bypass a licensed upstream limitation.
- [ ] Play a permitted film and episode with seek, subtitles and sound; verify episode switching and resume.
- [ ] Record redacted observations with `python tools/stream-audio-device-qa.py --out blofy-stream-device-audio-qa.json`; listen to the audio independently.
- [ ] Compare playback/QoE against signed 55.8.14; verify version, package, signing certificate, updater rollback and server health before any public release.

GitHub CI on the isolated candidate must pass `PlaybackRecoveryPolicyTest`, `StreamConnectionDiagnosticsTest`, `StreamAudioRecoveryPolicyTest`, `StreamAudioHealthTest`, app assembly and stream QA package identity. Test failures or real-device regressions block release.

**Production unchanged.** No automatic signed 55.8.15 release, subscriber updates, Railway deploys, provider stress tests or conversion to AAC are authorized by the code changes alone.
