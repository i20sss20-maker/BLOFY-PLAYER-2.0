# BLOFY STREAM Web — approved live first playable segment gate (worker-only)
Date: 2026-11-24 Asia/Riyadh. Merged reviewed PR #868, SHA `e9018c20c79209a2b8257208ed4d1c1a233fbddc`.

## Deployment scope
Only isolated Railway media worker `blofy-stream-web-media` (`63d4951c-4cda-4879-97cb-01c6700e02c7`), project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
The public Web site has no source changes from this PR; do **not** repin/restart it unnecessarily. No Android, billing, credentials, core activation, account data or upstream source configuration changes.

## Correctness and startup
- Never claim live HLS manifest success until one referenced, finished TS segment actually exists. Empty `#EXTM3U`, `.ts.tmp` and comments are not playable media. Permit a newer present segment even if older sliding entries have expired.
- Apply **one 27.5s budget** per live index GET for upstream headers/codec probe/first finished HLS TS. Do not chain two 25-second waits or leave an HTTP 200 origin which sends zero TS packets hanging in H.264 prefix detection.
- If no first video segment or no index appears, close hung source and return bounded 503 + Retry-After=2; enforce per-bearer/channel origin backoff instead of repeatedly starting FFmpeg. Preserve `MAX_JOBS=2` and source/quality fidelity.
- A cancelled single viewer request never destroys another viewer's shared source. Do not clear origin failure budget merely for manifest polls: only a successful TS segment response proves the worker supplied media.
- FFmpeg process-exit slot reservation, per-SID authorization and validated source URLs remain unchanged.

## Evidence
- New first playable live segment regression **10/10** (empty/no index, finished/aborted upstream, bounded request and prefix probe, sliding playlist, shared viewer, only-real-TS cooldown); existing worker media lifecycle **30/30**.
- PR browser/Web official release **34 Chrome UI / 3 authenticated smoke**, audio-pitch synthetic 11min, source-capacity, dual-engine, first picture and VOD slot handoff workflows all SUCCESS. Android CI failure is unrelated and Android unchanged.
- **Not a claim of actual playback stability on all customer STC/WiFi/Toshiba/VIDAA sources.** Real subscribed-source extended playback/production CPU stress remain needed.

## Rollback
Previously active media worker deployment `42f99dd0-a511-437c-86a8-71ae1cbbc108` pinned `82f8a60483cdb1c6d4a1933ecae22a510b17dcc0`, status SUCCESS before this upgrade. Prefer rollback to that known-good image/commit if new version regresses.
