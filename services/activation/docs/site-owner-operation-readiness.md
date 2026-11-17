# BLOFY site readiness and real operator acceptance

This is NOT an announcement that the site is 100% complete. It is a concrete
owner-only acceptance matrix built into the original signed dashboard:
`https://blofyplayer.com/admin/control-center/health`.

## What is measured

- Four fixed HTTP service targets: the site, update distribution, STREAM API,
  isolated FFmpeg decoder lab. A status code 200 paired with an explicit
  `ok:false`, `healthy:false` or `status:unhealthy` is **not** marked healthy.
- Eight real protected BLOFY STREAM operator **GET** endpoints:
  `overview`, `sources`, `content-hub/status`, `accounts`,
  `codes`, `distributors`, `auto-health`, and `security`.
- The backend uses the website's existing server-to-server operator proxy
  token; the browser never receives it. The target is a hardcoded Railway
  origin, redirects are not followed, no arbitrary URLs are allowed.
- Calls are cached by the site status snapshot, time-limited to 4.5 seconds,
  bounded to 128 KiB of JSON and limited to eight GET requests. Responses
  expose only a fixed ID, fixed Arabic label, safe status identifier,
  HTTP code and latency. **No** customer credentials, media names, provider
  URLs or underlying JSON are exposed.
- It does **not** issue a subscription, initiate media playback, open a
  licensed source, copy content, change a reseller account or claim an
  Android/Windows audio result.

## Live site issue inventory at implementation

These were observed in the last 500 Railway HTTP log entries inspected,
without copying customer IPs or media URLs:
- Site routes `/api/v1/stream/media/audio/anis-*` returned multiple HTTP 415
  responses. Existing relay deliberately rejects data not identified as
  authentic audio. Do not change it into forwarding arbitrary HTML/playlist
  data or silently auto-retry without inspecting a permitted sample.
- Two STREAM site-QA episode seek-preview endpoints returned 503. This is
  **not** proof that all VOD playback is broken; inspect the associated
  Content Hub storage evidence before repairing. No automatic re-copy.
- Anonymous operator action requests return expected 401, reseller wrong-origin
  login attempts return expected 403. Do not treat these as a backend outage.
- The site monitor's existing rolled-out UI and server HTTP health checks do
  not by themselves prove live audio, video, subscriptions or billing.

## Manual site launch gates

A human authorized owner must still verify from an actual logged-in browser:
1. Admin sign-in, session persistence, logout, CSRF rejection, mobile/desktop
   navigation and post-session-expiry recovery.
2. Sources: catalog pagination/search, one licensed source's probe/sync
   status, correct rights gates. No unapproved provider pulls.
3. Subscriber code issuance, display/copy, renewal, expiry and reclaim in
   a designated TEST account. Do not create production test entitlements
   merely to mark check green.
4. Reseller login under independent cookie, scoped listing and test-account
   renewal, confirmation of quota/credit protections.
5. Library: movie, season and episode indexing; queue status, bytes and
   verification after transfer, resume/pause and private owner preview.
   Source permissions and storage budget must be confirmed beforehand.
6. Public site downloads, updates, support, privacy, mobile accessibility,
   actual payment sandbox/live provider callbacks under provider guidelines.
7. Correct handling of known audio 415 and private preview 503 for
   owner-authorized content, without hiding failed states.

The matrix makes failed/unknown modules visible but cannot override these gates.
Rollback: pin `blofy-activation-portal` to the previously verified commit
`c724b8cb6e99a005d71349aff56c233384183963`. The original STREAM service
and customer-facing media routes are not modified by this change.
