# BLOFY VIDAA web preview – private playback incident timeline

Scope: isolated Railway experimental site `blofy-stream-native-web-parity` only. Do not update production Android customers, production activation/restream, subscription codes or the worker's controlled fan-out setting.

Adds a local bounded 12-event recent history of live TV playback behavior: start/playing, rebuffering, decoder freeze, unexpected pause, source 502/503/504, encoder-capacity 429, old-segment 410 live-edge resync, decoder error and automatic reconnect. The history is displayed under More -> تقرير اتصال القناة with UTC times and Arabic labels; it excludes stream URLs, tokens, channel IDs, viewer SID, credentials and raw network error data. An active channel switch resets history to that channel. No remote telemetry upload or user tracking introduced.

Verification: GitHub Actions QA BLOFY STREAM Web Native Parity run 45269634863 on f5745e56480d372f1a69a078d68fe0975d582e1f finished SUCCESS (29/29 lifecycle unit tests, 1/1 synthetic extended-audio test, 27/27 browser UI tests, synthetic 4K transport verification). Another duplicate CI run was still underway. This approval marker triggers only the preview web deployment watch rule. Pilot worker has deployed successfully with guarded source-sharing DISABLED by default.

Remaining release gates: physical 20-minute authorized-source Toshiba/VIDAA video/audio verification and concurrent device/source-capacity evaluation. PR #804 remains draft; no general customer rollout is approved.
