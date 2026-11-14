# BLOFY STREAM — Private Device QA Manifest v1

**Scope:** operator-only test planning for licensed, already registered private episode runs. It is **not** an application catalog or media streaming API, and does not grant rights or subscriber publication.

## Transport & authentication

The owner portal authenticates the browser session and calls:

`GET /api/v1/admin/content-hub/seasons/device-qa/{platform}/{seasonKey}/page/{page}`

with header `x-blofy-owner-action: prepare-private-device-qa`. Supported platforms: `android`, `android_tv`, `windows`. Each season page includes up to 50 registered episodes. No query parameters, arbitrary origins, custom hosts, access tokens, source URLs, S3 keys, or media playback URLs are returned. The Content Hub's upstream endpoint is internal Railway-only and also requires a separate bearer token.

## Format

`schema: blofy.private-device-qa-manifest`, `version: 1`, `readOnly: true`, `privateOnly: true`.

Each registered episode includes `runId`, `episodeNumber`, display `title`, `registeredQueueState`, `storageVerified`, `manualAudioVideoReviewed`, `reviewTimestamp`, `candidateForOwnerDeviceTesting`, `blockers`, platform `checkIds`, and explicit `devicePlaybackVerified: false` and `releaseToSubscribersApproved: false`. All candidate labels are **for manual QA only**. An episode becomes a candidate only after durable storage verification and current human browser A/V review; newer storage verification invalidates a stale A/V review.

Even a full set of green candidates does not establish distribution rights, media compatibility on Android 9/Android TV, subtitle compatibility, or user-visible playback. App integration and customer release remain **off**.

## Workflow for owner QA

1. Open the private Content Hub → **جاهزية الحلقات واختبار الصورة والصوت**.
2. Select Android, Android TV, or Windows; choose a registered episode page; click **تجهيز ملف اختبار الجهاز** for the desired season.
3. The browser downloads a local JSON worksheet. No media is downloaded. Review each blocker and candidate.
4. Open the *existing owner-only* authenticated preview separately, verify image and audio, and test the same approved sample on the device using a secure, authenticated QA build. Do not copy a portal session cookie or Hub bearer token into the app.
5. Record real D-pad/focus behavior on TV, audio codecs/output, subtitles, seeking/resume, error recovery, layout and performance. Compare to the worksheet, then approve any app build independently.
6. Do not expose `/api/v1/admin/...` to subscriber apps and never promote a QA JSON to a customer playlist. Any later app integration needs dedicated short-lived scoped credentials, device revocation, rights checks and separate staged tests.

**Status:** this phase creates a verified data contract and owner export only. Android/Windows application binaries and customer routes are intentionally unchanged.
