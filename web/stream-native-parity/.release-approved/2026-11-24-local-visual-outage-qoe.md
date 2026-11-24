# BLOFY STREAM Web — Verified Picture Outage QoE (Local)
Approved 2026-11-24 Asia/Riyadh. Source PR #872, squash commit `d3f402cc88dbb7d65707fa28d55f822c74272f26`.

## What was fixed
- Local player report now shows sampled visual-outage count, total approximate seconds, longest interval.
- A gap is only counted after an actual prior visual-progress signal. A >=6.5-second outage is counted either when picture recovers or immediately before a bounded engine restart. No duplicate counting across recovery.
- User pause, seeking, hidden tab, never-displayed picture, preview sessions and unobserved browser-sleep timer gaps do not inflate QoE; browser clock discontinuities must NOT reset the 16-second black-screen recovery watchdog.
- No extra media requests, outbound telemetry, channel URLs, customer identifiers, storage writes, worker changes or new FFmpeg jobs. Existing HLS and MPEG-TS fallback remain unchanged.

## Verification
- Official BLOFY STREAM Web 1.0 browser+release CI SUCCESS at `439e443302253a727522faf9ac9ce51867a62ed3`.
- Dedicated local QoE regression, long media lifecycle and screen black-frame test SUCCESS.
- Live first playable segment, freeze guard, dual-engine recovery, first picture, VOD slot handoff, backpressure, and encoder capacity workflows SUCCESS.
- Android CI failed on separate Android candidate verification (not modified by this web-only release).
- No actual 20-minute STC WiFi/TV owner acceptance yet; do not claim interruption-free consumer playback.

## Deployment scope
Authorize only production service `blofy-stream-web` (`f109c5f9-b81d-460d-81e5-175cc9b3df18`) in project `eeff35dc-1754-4f1e-92d7-e28473401453`, environment `a9a26993-0cec-410d-83dc-2f14a2e47045`.
DO NOT redeploy `blofy-stream-web-media` (`63d4951c-4cda-4879-97cb-01c6700e02c7`), Android, activation, billing, source accounts, Xtream, or BLOFY PLAYER.
Immediate rollback target: deployed Web commit `f921c542f5b598801edefc9e53c1a32a292b9ee7`, Railway deployment `a2cef5a6-a980-423a-8380-38238687dc5f`.
