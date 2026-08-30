# BLOFY PLAYER 2.0 — Alpha Candidate

## Candidate identity

- Branch: `core-v1`
- Commit: `045005325d45c21e60a6a1c55d92044f2d73e80e`
- Android CI: `#239` — success
- Activation CI: `#54` — success
- FFmpeg Native CI: `#46` — success

## Artifacts

### Standard debug APK
- Artifact: `BLOFY-PLAYER-2.0-debug`
- Artifact id: `9733414869`
- Archive size: `10858034` bytes
- SHA-256 digest: `2a1321d0746b89e5d48ee125795c95a4f650a7d346a458169f877a2a25c0a619`

### FFmpeg debug APK
- Artifact: `BLOFY-PLAYER-2.0-ffmpeg-debug`
- Artifact id: `9733458386`
- Archive size: `14220474` bytes
- SHA-256 digest: `7079ebb750046685b86ed3818c3a6f21e6d8e749e7bc23f80ab45bdf722f970c`

### Media3 FFmpeg AAR
- Artifact: `media3-ffmpeg-1.6.1-aar`
- Artifact id: `9733458576`
- Archive size: `3283948` bytes
- SHA-256 digest: `2c00e20236d6f7bd9c098bc7c42b73060f2d655505259903df5a0b17957d9c7a`

## Candidate rules

This SHA is the first pinned Alpha QA candidate. Do not compare server behavior across different APK SHAs without explicitly recording the change.

Use the standard APK first for baseline transport/playback tests. Use the FFmpeg APK for AC3/EAC3/DTS/TrueHD-class compatibility tests and confirm Settings reports the extension as bundled.

Run `docs/ALPHA_QA_MATRIX.md` against the exact candidate SHA. Record provider-specific failures rather than adding global headers or route ladders.

## Promotion gate

Do not promote this candidate beyond Alpha until:

1. Warm local-first Connect is verified on a real device.
2. Provider A/B/C core Live/Movie/Series flows are recorded.
3. TV remote stress/focus test passes.
4. AC3 + EAC3 are verified on target hardware using the FFmpeg APK.
5. Production Activation backend is deployed and trial/active/expired/blocked behavior is verified end-to-end.
6. No P0/P1 issue from the QA matrix remains unresolved.
