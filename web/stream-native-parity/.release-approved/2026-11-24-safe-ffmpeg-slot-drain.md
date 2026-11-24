# BLOFY STREAM Web media worker — safe FFmpeg slot retirement (official)
Date: 2026-11-24, Riyadh. Approved merged PR #864, code SHA `85a0dcb412506a0084cf3583469025aa045c366f`.

## Scope
**Only** isolated Railway worker `blofy-stream-web-media` (service `63d4951c-4cda-4879-97cb-01c6700e02c7`), project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`. Official Web UI source can remain pinned at `f9b695e42f0d46445346a0ab0228afb3192abeef` because there are **no Web API or UI changes**. Android, production core activation, Xtream source host and customer billing completely untouched.

## Correctness fix
- Never free CPU slot when FFmpeg receives `kill()`: wait for `proc.exited` before decreasing the active slot counter and removing old HLS files, for live as well as VOD.
- Full seekable VOD: do not start a new 24-second transcoding chunk until previous decoder actually exited. Adjacent chunks finish naturally (up to 26 seconds); distant seeks ask old FFmpeg to stop **once**, wait 5 seconds, escalate SIGKILL just once after 2.2 seconds, and return retriable 503 with Retry-After=2 if it still has not exited. No duplicate source connections or pretend-free encoder capacity.
- Old chunk retirement cannot schedule prefetch for a film position the viewer no longer needs. Viewer STOP removes SID authorization immediately and defers directory cleanup until process termination.
- Keep MAX_JOBS=2, audio/video codecs, HLS output, quality and source auth unchanged.

## QA
- PR #864 dedicated FFmpeg slot handoff suite SUCCESS (concurrent same-chunk requests, rapid distant seeks, natural adjacent prefetch, stuck FFmpeg escalation, live/VOD STOP), existing media lifecycle SUCCESS.
- Official Web Chrome/UI, dual-engine, media backpressure, first picture and encoder evidence workflows SUCCESS. Android CI is unrelated and was not changed.
- A real Toshiba/VIDAA 20-minute subscribed stream test and sustained **production** Railway CPU/FFmpeg stress test remain unproven. Do not claim zero interruptions for all subscribers.

## Rollback
Known-good worker before this change: commit `f9b695e42f0d46445346a0ab0228afb3192abeef`, Railway deploy `8d0be8ca-55c6-44b9-8f8b-af4eb1210207`. Preserve as rollback target; do not change or rotate secrets.
