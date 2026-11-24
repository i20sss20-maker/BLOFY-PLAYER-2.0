# BLOFY STREAM Web 1.0.0 — official production media isolation approval
Date: 2026-11-24

Production Web service: blofy-stream-web (Railway ID f109c5f9-b81d-460d-81e5-175cc9b3df18), public URL https://blofy-stream-web-production.up.railway.app/
Production private media worker: blofy-stream-web-media (Railway ID 63d4951c-4cda-4879-97cb-01c6700e02c7), private DNS blofy-stream-web-media.railway.internal:8080.

- Web code is frozen on official release branch, separate from Android and prior preview.
- First-party MPEGTS JavaScript is installed locally in the Docker image. No external CDN dependency at runtime for HLS or MPEGTS.
- Secret session cookie and worker shared key were rotated independently for this newly established production service. They are stored only in Railway, never in GitHub.
- Live/VOD/HLS proxied only to the dedicated private media worker with an allowlisted worker hostname. Preview worker and its keys remain unchanged for rollback.
- Automated official-release GitHub QA verified 32 Chrome screen/remote scenarios + 3 official auth/PWA/local-engine browser checks + 30 media-lifecycle Node tests + 11-minute synthetic audio clock test.
- Health response is HTTP 503 if the required session key is missing, 200 only when configured.

Limitations: actual authorized source playback >20 minutes on physical Toshiba/VIDAA, voice pitch/sync, and sustained concurrent subscriber/media load are not established by CI, and must not be advertised as 100% validated. Dedicated media service has bounded FFmpeg capacity, not unlimited viewers. Android stays unaffected.
