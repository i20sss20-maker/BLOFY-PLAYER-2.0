# BLOFY STREAM Web — Picture-missing vs frozen-frame diagnostics
Approved 2026-11-24 (Asia/Riyadh), PR #871 squash commit `e55d80168c49fcb8c2055be0a8ff8be476f7fde9`.

## Change
- Before recovery after 16 seconds without visual progress, distinguish zero video dimensions (`picture_missing`) from a decoded image that froze (`picture_freeze`).
- Preserve the existing bounded recovery, existing event timeline (12 entries, local only), user pause/hidden-tab safety, account isolation, and worker capacity.
- The event is a *player-observed symptom*, not proof of whether the network, origin, or decoder caused it. No new network requests or server telemetry.

## QA
PR #871: official Web 1.0 browser/release workflow, freeze guard, first playable segment, first-picture, dual-engine, transcoder slot handoff, backpressure, encoder capacity all SUCCESS. Android CI failure pertains to separate Android build verification, not this Web-only diff.
No real subscriber 20-minute Toshiba/VIDAA acceptance has been performed.

## Authorized deployment
Only Railway BLOFY-VIDAA-PREVIEW / production service `blofy-stream-web`: project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`, service `f109c5f9-b81d-460d-81e5-175cc9b3df18`.
Never restart the separate Web media worker `63d4951c-4cda-4879-97cb-01c6700e02c7` or change Android, activation, Xtream source credentials, payment, media codecs, or FFmpeg max jobs.
Immediate rollback: successful Web deployment from PR #870 on pinned commit `954a7596b0bb666792c53356513f540c8f07aa5d`.
