# BLOFY STREAM Web 1.0 — Local per-engine health dashboard (approved)

Approved 2026-11-24 Asia/Riyadh. Merged PR #873 squash commit `aa121a440258961265ab01813f7da0bc1a34006c`.

## What changed
- Existing authenticated player's live health panel displays current HLS native/HLS.js/MPEG-TS engine; observed post-picture outage count, estimated total and longest outage seconds, and HLS vs MPEG-TS counts.
- Existing local diagnostic snapshot lists approximate per-engine incident count and duration, with no credential, host URL, stream ID or token.
- On channel switches only visual-outage counters reset, preventing the previous channel's incidents from being misattributed. Existing video recovery behavior, cooldown, media worker slots and subscriptions remain unchanged.
- The health panel shows visual-outage cards only for live streams, not VOD; direct MP4 diagnostics remain correctly labeled.

## Evidence and limits
- Official Web 1.0 Chrome/remote UI/release workflow SUCCESS for PR #873 head `8b9a43f8753351c65ef6d79312bcb4bca730bc8d`.
- Dedicated Node regression for per-engine stats, no duplication and pause/hidden/browser-sleep exclusions SUCCESS, as did first-picture, freeze guard, VOD worker handoff, encoder benchmark, live segment, recovery and backpressure tests.
- Android CI failed on independent Android candidate validation. No Android code/build/deployment is changed in this Web-only release.
- **Do not claim an interruption-free 20-minute subscriber watch on STC/Toshiba/VIDAA**; that field test still needs a real TV.

## Authorized deployment
- Only existing production `blofy-stream-web` Railway service `f109c5f9-b81d-460d-81e5-175cc9b3df18` in project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Do not redeploy or modify the separate media worker `63d4951c-4cda-4879-97cb-01c6700e02c7`, Xtream accounts, Android, activation, payments, or BLOFY PLAYER.
- Immediate rollback to the previous successful Web commit `d07e347a299449990209223a0a7bc8d10532c247`, Railway deployment `eceab421-172a-4ff8-babf-6905d617e242`.
