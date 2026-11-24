# BLOFY STREAM isolated VIDAA web preview: viewer-specific live sessions

Approved scope: `blofy-stream-native-web-parity` preview site only, never Android/customer production.

Changes: The live HLS worker (deployed first) accepts optional 128-bit `sid-<32 hex>` playback namespaces for manifest, relative TS segments and stop requests. A new live playback opening obtains a fresh SID, and preview-to-fullscreen waits for its exact old-SID stop acknowledgement before starting an independent session. Existing sid-less authenticated links remain valid. An authorized viewer's stop cannot terminate another viewer using the same subscription. This is isolation, not an increase in server capacity.

Verification: CI `QA BLOFY STREAM Web Native Parity` run 45236246071 for commit f120e4c3b56ec925e4b15b14b2b352a1c7406aed succeeded: 20/20 unit tests and 26/26 browser checks, plus synthetic UHD fixture and audio tests. The live worker's backward compatible SID path had already deployed successfully. This marker triggers the restricted web-service release watch path.

Limitations: Worker MAX_JOBS=2, and some authorized source providers restrict per-account concurrent streams. This pilot is not a capacity benchmark and no physical Toshiba/VIDAA 20-minute end-to-end test has been verified. Do not publish to all customers until concurrent viewer + source licensing/capacity and TV playback tests pass.
