# BLOFY STREAM — decoded-media endurance canary

**QA only / no production deploy.** This Python 3.11+ / FFmpeg probe creates bounded concurrent sessions from **operator-approved test feeds**, decoding frames and audio. It does not record/retransmit content, alter customers, or claim that HTTP 200 proves watchability.

### Use

Set `BLOFY_QOE_SOURCES` to a **secret** JSON array of authorized test URLs in the runner's environment, then:

```sh
python3 ops/stream-endurance/endurance_probe.py --duration 600 --clients 2 --require-audio --report /tmp/qoe.json
```

Limit: 8 concurrent sessions **total**; 5–3600 seconds; 0–5 bounded probe restarts. Do **not** put Xtream credentials or credentialed media URLs in CI yaml, terminal commands, issue comments, screenshots or reports. Without approved test feeds, only the offline synthetic self-test is permitted.

### Release gate (proposed, not yet achieved)

1. One source, 2 concurrent QA viewers for 10 minutes.
2. Approved source, 5 viewers for 30 minutes.
3. With source authorization and adequate capacity, 10 viewers for 2 hours using isolated runners subject to per-runner max of 8.
4. Authorized maximum, 24 hours; test on STC home Wi-Fi and cellular, Android TV/Android 9, Windows, web/VIDAA separately.

Measure video first-decoded-frame p50/p95, >3-second video/audio frame gaps, premature EOS and probe-driven reconnect time. Suggested starting gate: p95 < 6 s, zero sustained gaps in clean test, test-source interruption recovery < 10 s. Diagnose audio audibility on target devices, not only frame decode.

**Limitations:** This command proves frames on its own FFmpeg runner, not hardware/device playback. `recoveryMs` measures a probe restart, not the BLOFY player reconnect algorithm. Controlled outage injection must use **a test-owned stream only**, never a real provider or customer source. For rollout pin existing production config and previous deployment, gate 1% -> 5% -> 20% -> 100%, with automatic rollback on sustained errors.

The script excludes media URLs, IP addresses, account credentials and FFmpeg stderr from its report.

### Automated isolated live-HLS tests

The CI workflow now also runs `local_hls_canary.py` using a locally generated 320×180 H.264/AAC HLS stream on `127.0.0.1`. Its stages are:

- Clean synthetic HLS: two concurrent FFmpeg decoders for 13 seconds; checks both tracks and no >3s decoded-frame gaps.
- Transport interruption: four concurrent decoders for 26 seconds; deliberately returns HTTP 503 for local media requests during a six-second interruption, confirms audio/video frames after delivery resumes, and reports recovery duration and >3s gaps.

All sources/clients are synthetic and remain on the test runner; **no Railway or customer playback is changed**. Startup times in this local test begin from a primed HLS playlist, so they do not establish genuine cold-start TTFF on a device. A 503 transport interruption is not identical to killing a remote upstream encoder, and an FFmpeg process restart is not proof of BLOFY in-app recovery. Reports are sanitized and uploaded as CI artifacts for seven days.

The transport-blackout test **allows the expected frame gaps during the injected outage** and requires successful frames after recovery. Production acceptance must separately bound the duration/frequency of gaps and test full source interruption on approved feeds and on real client hardware.
