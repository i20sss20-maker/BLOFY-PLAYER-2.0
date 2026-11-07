# BLOFY Smart Connection — Official Deployment

## Problem identified
An Xtream provider responds to the customer's separate IPTV player but BLOFY's Railway origin periodically records `xtream_transport_connection_reset`. This does not prove source blocking, account expiry, or a Railway outage. Two different Xtream sources should never be conflated.

## Implemented
- Authorized admin per-source `POST /api/v1/admin/xtream/servers/:id/smart-connection` runs **one read-only account API GET** on the **saved source** from the BLOFY production Railway service. The probe is limited to 8 seconds, does not retry, and is throttled to one per source per 30 seconds.
- Reports a fixed, credential-free Arabic diagnosis for DNS, TCP refusals/resets, timeout, TLS issues, 401/403/404/429/456 and invalid account responses.
- The report explicitly distinguishes API accessibility from playable media, and marks static outbound IP status as **not checked**. No sample video is fetched or republished.
- Works in both `/sources-admin#xtream` (button in each source card) and native `/api/v1/admin/xtream/controls` (form works without JavaScript). Native results are stored only in process memory for up to 10 minutes; they are not saved to subscribers or provider credentials.
- The native controls page also translates known historic raw provider errors into fixed Arabic text.
- All runtime source/account tables, catalog records, media routes, and customer subscriptions stay unchanged.

## Operational test sequence (approved sources only)
1. Open the direct controls page; choose **تشخيص الاتصال الذكي** under the troubled source, not the other source.
2. Compare the returned category with the same account playing in another app; different networks may have different access conditions.
3. If the provider confirms an IP-based allowlist is necessary, choose a supported Railway Pro Static Outbound IP for the activation portal and provide that IP to the provider **for approval**. Do not enable IPv6 egress or proxy rotation as a workaround.
4. After allowlist approval, retest account API, sample live, movie, episode, Range seeking, then monitor connection resets and limits.
5. Only after verified end-to-end playback and re-stream rights, consider routing customer playback through MediaMTX. Its current network listener alone is not a playback test.

## Static outbound IP limitations
Railway documents the feature for Pro customers. No connected Railway action currently available in this conversation can enable or inspect the static IP directly, so **it was not enabled or billed**. A static IP does not itself guarantee source access. Provider consent and real transport tests are necessary.

## Rollback
The previous working production code is pinned at `5cc6547fb933b61ed475c2d8454ceb41b0e42a56`. Re-deploy it to restore the former Xtream control interface without modifying Postgres.

## Test coverage
`services/activation/test/xtream-smart-connection.test.mjs` checks stable error classifications, report sanitation, source-only bounded GET and access protection, both UIs, and clear separation of connectivity from media.


## Verified production results, November 7 2026 (Asia/Riyadh)
- Connected portal deployment after diagnosis: `f4e606380dd8dde231cede4e7c37267a2b99a33f`, successful production redeploy. Services: activation portal, restream engine, update distribution, Postgres — all online.
- Real read-only source account checks from the **same** Railway portal: source ID prefix `d2bb0397` returned `xtream_api_reachable`; source ID prefix `59a2fbf5` returned `xtream_transport_connection_reset`. This proves the Railway egress environment can contact at least one provider, but does not establish the reset cause at the other provider.
- Real media sample from the responsive source (initial bytes only): live HTTP 200, movie HTTP 206, episode HTTP 206. **Picture/audio playback and playback stability were not verified.** No source or customer media URLs were changed.
- Real private MediaMTX transport check reached the HLS listener: base path returned HTTP 404; unconfigured test path returned redirect HTTP 302. Engine is network reachable but a working source HLS playlist was **not** established. CPU/network metrics also showed no active streamed traffic. Do not route customers to it on listener health alone.
- Enabled Railway tracing and auto instrumentation on activation portal; left the other services untouched.
- To avoid repeated upstream traffic, the one-shot source and media diagnostic environment switches were both set to `0` following tests. Temporary Railway functions were deleted. No static egress IP was provisioned.
- New regression coverage for `xtream-boot-diagnostics.mjs`, and the one-shot media sampling path is environment gated. Six targeted tests passed for safe reads, bounded source selection and no secret logging.
- At the observation time, 322 portal HTTP requests within an hour had zero HTTP 5xx. This **does not** describe upstream Xtream error rate.

## Outstanding release gates
1. Verify the failing provider supports server-to-server restreaming and request an allowlist for the official Railway egress IP. Railway Pro static outbound IP requires a Railway account-side networking action not exposed by the connected app actions. Do not change plans or enable paid services without the user's explicit account action.
2. Repeat the upstream read-only probe on the second source after allowlisting. Stop on 401/403/456 (do not rotate proxies or circumvent provider access controls).
3. Test continuous A/V in a real BLOFY PLAYER client for live, movie and episode, including seeking and long-running streaming.
4. Test an actual licensed HLS feed through MediaMTX in an isolated environment; only enable gradual customer routing after stability, rights and rollback checks.
