# BLOFY Android / Android TV — real private Content Hub playback QA (DEBUG only)

This QA branch adds a **second separate Settings lab** `بث المكتبة الخاصة`.
It is visible in debug builds only; its Activity is non-exported and
`BuildConfig.DEBUG` is checked again on entry. It does not replace the
existing local-video-only bench, any subscriber player, or the released
`codeOnly` application.

## How the owner tests (ONLY after backend PR #609 is deployed to an
## isolated, explicitly authorized QA environment)

1. Transfer and verify one **individually licensed** movie or episode from
   Xtream into private BLOFY S3. Check the exact mirror queue mediaKind,
   gatewayId, and full-file SHA256 proof. Never infer storage rights merely
   from an Xtream username/password.
2. Run the owner-only `POST /api/v1/admin/content-hub/mirror/media-qa/
   {movie|episode}/{gatewayId}` endpoint with
   `x-blofy-owner-action: verify-private-mirror-playback`. Check GET until
   audio/video decoding and four S3 Range seeks pass.
3. From the authenticated owner-admin session, issue a device-specific
   HMAC ticket with
   `POST /api/v1/admin/content-hub/mirror/device-qa/ticket`,
   `x-blofy-owner-action: issue-private-mirror-device-ticket` and JSON:
   `{"mediaKind":"episode","gatewayId":401,"platform":"android_tv",
      "rightsConfirmed":true,"ownerDeviceTest":true}`
   (set `platform:android` for a phone).
4. Open Settings > `بث المكتبة الخاصة` in an isolated **debug** Android
   or TV install. Select movie/episode, paste the returned
   `runId` and 15-minute `ticket`, and confirm authorized personal
   testing. The actual ExoPlayer view reads from private Content Hub
   through the HMAC relay.
5. Test image, audible audio, seek/resume, remote D-pad, back button and
   network interruption **on a physical device**. No debug report implies
   release to subscribers.

## Technical isolation

The Media3 `PrivateHubBoundedDataSource` pins
`https://blofyplayer.com/api/v1/private-device-qa/<kind>/playback/<runId>`;
the app never accepts a custom media URL. It sends the ticket only in
the Authorization header. Since Media3 may otherwise issue open-ended
Ranges that the private backend **deliberately refuses**, this test
DataSource sends explicit, at-most-8MiB GET byte ranges and strict
HEAD/206/Content-Range/Content-Length checks. It retains no media
files, provider credentials, admin tokens or ticket in local preferences.
Debug UI disables field state save and screenshots. Network logging and
customer playlist/catalog updates are not used.

The private backend route and ticket issuance remain disabled by default.
This UI was built to exercise actual S3-backed media on a device, but the
software test/build alone does not prove it has done so. No publicly
signed production APK or Google Play release has been produced from
this QA branch.
