# Official BLOFY STREAM Web 1.0 — safe encoder capacity observability
Release date: 2026-11-24 (Asia/Riyadh). PR #861 merged as `f753b2f4bf2c25a9254f98a818007e7906787e13`.

### Isolated deployment targets and safety
- Only Railway project `eeff35dc-1754-4f1e-92d7-e28473401453`, production environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Private media worker `blofy-stream-web-media` `63d4951c-4cda-4879-97cb-01c6700e02c7` **first**, then public `blofy-stream-web` `f109c5f9-b81d-460d-81e5-175cc9b3df18` only after worker health.
- Production `MAX_JOBS` stays **2**; no increases or changes to customer data, Android, payment, credentials, streaming codecs, Xtream fetch routes or source-sharing flags.

### Changes
- 60-second rolling **anonymous** encoder admission denial count. Differentiate live, legacy VOD, full VOD and compatibility active slots; exclude alias, stopped and released sessions. Aggregates contain no bearer, code, source URL, channel ID, viewer ID or host.
- Health remains 200 even when full; do not restart the worker or disconnect existing subscribers on saturation. Only authenticated public site health APIs expose clamped numeric aggregates, which appear in Settings diagnostics. Old official Web Settings footer no longer says "under development".
- CI-only synthetic full video/audio encoder benchmark from **production profile settings** (live H.264/AAC 720p 1s GOP; VOD H.264/AAC 1080p 4s GOP). Isolated Github Ubuntu runner tested 30 media-seconds at 1, 2 and 3 simultaneous encoders. No source or subscriber requests.
- Measurements from GitHub runner, *not production*: 1 job 2.19 s / ~95 MiB; 2 jobs 6.52 s / ~471 MiB; 3 jobs 7.85 s / ~570 MiB sampled FFmpeg RSS. These are not production predictions or safe limits. The live provider and decoding on Toshiba/VIDAA require real-world proof.
- Dedicated capacity observability QA 4/4, 30/30 media lifecycle, FFmpeg synthetic 1/2/3 benchmark, site 34 Chrome browser and 3 official smoke tests, plus audio clock regression all passed. Android CI is unrelated and was not changed.

### Production rollback
Before this marker previous known good release was `e1ad56f0665e88f8f6a5381af74d6a2afd817fa5`: media worker Railway deploy `a3e537b5-d3f4-404e-af56-d61e56c1497a`; Web `7c4af187-a602-4c54-8810-42309c844a53`. Keep previous image/commit as emergency restore target.
