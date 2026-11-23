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

### Physical synthetic source shutdown / HLS continuity

A third CI stage runs **three readers for 28 seconds** and stops the local FFmpeg HLS publisher for five seconds, then starts it again. Unlike the 503 blackout, this actually halts media generation. The test now checks that a *completed* segment is advertised in the HLS playlist after restart, and that the playlist contains the required `#EXT-X-DISCONTINUITY` marker when timestamps reset. It rejects a merely-created but incomplete .ts file as recovery proof. The report includes both source-publication readiness and observed audio/video frame recovery.

The 503 stage also confirms there were HTTP media requests actually rejected during its outage; a fake outage that blocked no clients fails. Both synthetic scenarios permit the *expected* temporary interruption and report its duration instead of falsely claiming zero downtime.

### Client-device GO/NO-GO gate (not populated yet)

`qa_release_gate.py` is a **fail-closed policy checker** for future anonymized, independently verified BLOFY client-decoder telemetry. It does not create or ingest customer telemetry itself, and no production client was changed by this PR.

A supplied local JSON report must have:
- `schemaVersion: 1`, `scope: "client_decoder"`;
- `requiredCohorts`, e.g. `["android_tv|stc_wifi","web_vidaa|stc_wifi","windows|broadband"]`;
- `sessions`, each containing `cohort`, `durationSeconds`, `firstDecodedFrameMs`, `decodedVideoFrames`, `decodedAudioFrames`, `videoGapsOver3s`, `audioGapsOver3s`, `testOutageInjected`, and (only if a controlled test occurred) `outageRecoveryMs`.

Each cohort requires at least **three sessions lasting >= 300 seconds**, decoded video and expected audio, no >3-second audio/video gaps, startup p95 <= 6000 ms, and at least one controlled test outage recovered in <= 10000 ms (p95). Missing cohorts, incomplete metrics, silent audio, HTTP-only reports and short sessions all yield **NO-GO**. The 3-session minimum is a QA canary threshold, *not* statistical proof of large-scale commercial reliability; raise it for the actual rollout.

Example (data supplied privately by an operator, never raw device IDs or source secrets):

```sh
python3 ops/stream-endurance/qa_release_gate.py /private/sanitized-client-report.json --report /tmp/go-no-go.json
```

The checker validates the input format and thresholds **but cannot attest who collected or signed the input**. Production still requires verified on-device observability and a human-reviewed rollout decision. Do not use the synthetic CI reports as `client_decoder` evidence.
