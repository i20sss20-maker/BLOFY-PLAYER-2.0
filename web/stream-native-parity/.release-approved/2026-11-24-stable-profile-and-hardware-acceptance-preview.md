# BLOFY STREAM Web — guarded preview rollout: 20-minute device QA + stable profile on renewal

Scope: ONLY isolated Railway project BLOFY-VIDAA-PREVIEW, service `blofy-stream-native-web-parity`. Does not modify Android release, production activation portal, customer subscriptions, upstream streaming services or separate worker deployment. Commit includes PR #840 (20-minute diagnostic) and #842 (stable account-bound local profiles).

## Changes approved for preview evaluation

- Local in-player **"بدء اختبار 20 دقيقة"** while a real film/channel is decoded; monotonic clock, 2-second read-only samples; fails early playback stop, user pause/hidden tab, lost image frames, player reconnect, extended buffering, media errors or browser standby. Stores only an anonymized result in that browser's subscribed profile. Browser that does not expose video frame counters can only return INCONCLUSIVE, never a fake green pass. Audio pitch, AV sync and licensing still require human verification on actual source/device.
- Fix local favorites and continue-watching data disappearing when code renewal changed the bound token MAC for the same server-side account UUID. The verified token's account UUID feeds a **server-HMAC opaque 24-character partition**, and the session returns a legacy opaque partition for best-effort local migration of existing browser profile keys only. No raw token/account UUID sent to JavaScript, no cloud sync, and no extra media requests. Existing keys stay as rollback backups.
- Retain code-only activation, private HttpOnly Secure cookie, two-job VOD pilot, all existing media flags disabled by default. No changes to live TS continuity pilot allowlists.

## Checks and limitations
- Targeted regression actions green: exact 20-minute simulation, false-positive audio-only clock, frozen picture, restart/buffer/hidden/quit, privacy-safe report; stable profile HMAC/legacy isolation and renewal tests; backup portability tests; source/continuity tests.
- Full real-browser end-to-end QA was still running while this marker was created. **Do not state that all Chrome/TV tests passed yet.**
- Customer-ready release is NOT authorized. Two-transcode-worker capacity and media rights/source reliability must be verified under permitted multi-user test load. 20+ min actual subscribed streaming, proper actual resolution, native VIDAA decoding, commentary pitch/sync and TV remote test on physical Toshiba are still required.
- Preexisting Android CI on the web-feature PR remains failing; changes are web-preview-scoped and this does not authorize Android build/publishing.
- Keep rollback to previous Railway web deployment if a real browser cannot activate or render the app.

This marker is an **explicit preview-only approval**, not a 100%-ready declaration.
