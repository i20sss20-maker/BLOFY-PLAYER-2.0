# BLOFY STREAM CORE 2.0 — production release gate

This work is **not a live broadcast rollout**. Do not merge/publish it as a 100-viewer
or failover achievement solely because CI passes. Customer playback and provider
accounts stay on their existing paths until independently approved.

## Implemented
- Bounded synthetic `/smoke/` MediaMTX HLS health history, three-failure alert,
  rate-limited two-reader check. `BLOFY_RESTREAM_AUTO_HEALTH=1` opts in.
- Read-only, admin-protected MediaMTX metrics from the fixed **private**
  `blofy-restream-engine.railway.internal:9998` listener.
  `BLOFY_RESTREAM_METRICS_READ=1` opts in.
- Operator monitor in `/sources-admin`: HLS sessions, readers, counters, derived
  Mbps, Xtream real media start/failure/P95, read-only recovery advice.
- A single-process, rights-scoped **in-memory prototype** of publisher leases.
  This prototype is NOT connected to subscriber streams. Tests use mocked streams.
- Fail-closed failover eligibility policy. No automatic provider switch.

## Before enabling metrics
1. Verify Railway private network only; never create a public domain/TCP proxy
   for the metrics port or publish credentials in logs.
2. On a non-production clone, enable MediaMTX metrics and bind port 9998 to the
   container's private interface. Default loopback-only binding cannot be reached
   by the separate activation container.
3. From the activation container, verify `GET /metrics` success, sample path
   anonymity, valid session/reader/byte counters, and non-overlap across metrics.
4. Confirm no public access to 9998 and no unexpected service restart.
5. Only then enable the activation service read-only feature flag. Verify its
   admin cookies and role restrictions. Avoid broad external probes.

## Before shared-source rollout
1. Contractually confirm restream permission, device limits, and source profiles.
   No automatic retry/failover after 401/403/429/456 or restream denial.
2. Implement a cross-replica coordinator with durable locks and fencing tokens.
   The current in-memory coordinator must not be enabled with multiple pods.
3. Ensure source-key scope includes source, channel, credential version, output
   profile and permission scope. Never share across unrelated accounts.
4. Support publisher heartbeats, bounded retries, cancellation, graceful drain,
   correct byte accounting and per-client auth at the actual HLS segment URL.
5. Use *authorized* test sources and test devices; ramp 1 -> 10 -> 25 -> 50 ->
   100 actual viewers in a separate environment. Record start-up P50/P95,
   rebuffer ratio, disconnections, upstream connections, bandwidth, CPU, memory,
   and provider-denial counts. Abort on errors, unexpected source concurrency,
   or abnormal 5xx. Test one viewer leaving and an upstream restart.
6. Verify recovery and rollback. Conduct a small production canary, then expand.

## What the operator panel counts
- MediaMTX `hls_sessions` counts **protocol sessions**, not unique people.
- Gateway media start/failures are **events** for this instance, not unique
  subscribers and not proof of completed viewing.
- Mbps is computed from two successive samples, not a capacity guarantee.
- Synthetic checks verify test video transport, not any customer channel.

## Rollback and ownership
No production configuration or subscriber URL changes belong to this PR.
Keep production service deployment ID and source commit accessible before any
future deployment. Roll back to that exact commit if a canary regresses. Never
restart the persistent Postgres service to test the media pipeline.
