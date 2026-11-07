# BLOFY RESTREAM LAB — verified deployment
Date: 2026-11-07
Environment: Railway project BLOFY-RESTREAM-PILOT / test, isolated from production.

## Running components
- `blofy-restream-mediamtx-lab`: official `bluenviron/mediamtx:1.21.3-ffmpeg` image.
- `blofy-restream-lab-health`: Bun HTTP function checks live HLS playlist and an MPEG-TS segment.
- The input is ONLY a locally generated, synthetic FFmpeg test pattern with H.264 video and AAC audio. No IPTV source accounts, no production database, and no customer data are connected.
- RTMP/WebRTC/SRT/MoQ and external RTSP are disabled. Local RTSP publisher 127.0.0.1:8554; public HLS :8888.
- No changes deployed to `blofyplayer.com`.

## Test endpoints (public demo, no user credentials)
- HLS player: https://blofy-restream-mediamtx-lab-test.up.railway.app/demo/
- HLS manifest: https://blofy-restream-mediamtx-lab-test.up.railway.app/demo/index.m3u8
- Probe: https://blofy-restream-lab-health-test.up.railway.app/health

## Verified from Railway runtime logs
- MediaMTX logs: `[path demo] stream is available and online, 2 tracks (H264, MPEG-4 Audio)`.
- Probe log: `BLOFY LAB end-to-end {"ok":true,"mode":"synthetic-only","masterStatus":200,"segmentStatus":200,"bytesVerified":95880,"mpegTs":true,"stage":"complete","elapsedMs":38}`.
- Those logs prove an actual HLS manifest and an MPEG-TS segment were fetched within the Railway private network at time of test.
- External viewer/browser reachability is NOT yet verified. User should test link in browser/VLC.
- This is **not** a claim that original IPTV source, series playback, account entitlement, or full production restream chain works.

## Production promotion gates
1. Confirm player URL works externally and the demo plays video/audio.
2. Design signed token auth, channel ownership and authorized upstream path mapping (no publicly writable publisher).
3. Add per-source circuit breaker, source API vs media diagnostics, per-channel reader limits and metrics.
4. Add isolated series episode resolver tests against provider-authorized samples.
5. Run regression for unchanged current live/movie behavior and validate production compatibility.
6. Explicitly approve a feature-flagged release; preserve existing IDs and DB, no auto migration.

## Status
A working **synthetic** live restream lab is deployed. Main BLOFY STREAM is intentionally unchanged.
