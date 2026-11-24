# Experimental web preview release approval — 2026-11-23

Scope: BLOFY-VIDAA-PREVIEW `blofy-stream-native-web-parity` only. No Android customer rollout or shared production stream infrastructure change.

Includes: presented-video-frame watchdog (with fallback for TVs lacking frame callbacks), cleanup on channel switch, latest on-screen video-frame telemetry and diagnostic reporting, bounded 429 worker-capacity backoff with cancellation and recovery reset.

QA: GitHub Actions QA BLOFY STREAM Web Native Parity run 45229624935 finished SUCCESS for commit 0e0d12820ac0991568fe9bc2c4155aadf30bf6ac. Synthetic browser and media tests are not real Toshiba/VIDAA verification. Gate remains open for permitted-source 20-minute device test and independent source quality proof.

This marker intentionally triggers the preview web service watch pattern. The media worker is unchanged by this release.
