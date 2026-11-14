# BLOFY Content Hub — Windows owner-device QA (isolated preview)

This branch is **not** the released Windows app and must **not** be promoted or installed over an existing customer build. No media URLs, operator keys or bearer tokens are embedded in the application.

## Intended proof
The existing BLOFY Windows LibVLC player plays the **same SHA-verified stored episode** through a temporary, randomized HTTP loopback address which forwards byte ranges to the owner-only HTTPS endpoint. Every upstream S3-backed request is limited to an explicit 8 MiB range; the route never calls a provider or plays an unrelated local file. Run ID and 15-minute HMAC ticket bind one verified episode and never enter the customer catalog.

## Required operator prerequisites (not enabled automatically)
1. Backend draft PR #607 must be reviewed and deployed separately only to an owner-approved QA environment / low-risk isolated pilot. Do not turn on customer routes.
2. An independent 32+ character `BLOFY_CONTENT_HUB_DEVICE_QA_SIGNING_KEY` must be kept only as a private Railway **activation** service variable. Set `BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED=1` only for a bounded owner test; default is off.
3. The verified episode run ID must exist in private Content Hub S3/Postgres. The current operator-signed admin session must be active and the episode must have valid distribution rights.
4. From the authenticated `https://blofyplayer.com/admin/content-hub` page (only after opt-in deployment), the operator can issue an owner-only ticket using a same-origin browser request, for example:
   ```js
   const r = await fetch('/api/v1/admin/content-hub/device-qa/ticket', {
     method: 'POST', credentials: 'same-origin',
     headers: {'content-type': 'application/json',
       'x-blofy-owner-action':'issue-private-device-qa'},
     body: JSON.stringify({runId:'REPLACE_WITH_VERIFIED_RUN_ID',
       platform:'windows',rightsConfirmed:true,ownerDeviceTest:true})
   });
   const result = await r.json();
   // Treat result.ticket as a sensitive temporary credential, not a public link.
   ```
   Avoid copying the ticket into issue logs, support chats, browser screenshots, or shell command history. Regenerate it if expired.

## Actual Windows test
1. On a clean Windows 10/11 x64 device, download the **private debug QA artifact** from this branch's GitHub Actions run and unpack it in its own test folder. It is unsigned, not an updater/installer. Do not turn off Defender.
2. In Debug app Settings, click **🔒 اختبار Content Hub الخاص**. Enter the verified episode run ID, then the short-lived ticket (issued as above).
3. The usual app LibVLC overlay should open a loopback URL; the proxy uses authenticated HTTPS to read **Content Hub object ranges**, not a user-chosen local media file.
4. Manually verify visible frame, audible audio, track/subtitle selection, playback and seek at 0%, 25%, 50%, 90%, and network interruption/recovery. Confirm language switching, window resizing and cleanup; keep source/account/network behavior unchanged.
5. Capture **sanitized** yes/no evidence only, never ticket, object name, private hostname or subscriber credential. Test token expiration (401 upstream), wrong ID (404), early seek, aborted/closed player, and no feature in Release build.
6. Stop the separate Debug app after testing. Turn off `BLOFY_CONTENT_HUB_DEVICE_QA_ENABLED`, revoke active capabilities by rotating the signing key when the owner QA window ends.

## Constraints
- This is **one operator-only device test**, not a customer playback API or general Content Hub integration.
- A green CI build cannot assert audio/video on a real machine; that requires the owner's observation.
- There is no actual recorded real-device success yet. The QA artifact should never be published to the download center or replace any signed Windows installation.
- Both server and client branches must remain unmerged until standalone CI and actual-device testing pass.
