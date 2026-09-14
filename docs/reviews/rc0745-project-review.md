# rc07.45 project review

Scope: login/registration, device and portal playlist synchronization, provider details,
settings, image loading, Android build/lint, manifest and source-reference cleanup.
The production activation service and Downloader page are reviewed separately on main;
the runtime branch's older activation service must not replace production.

## Findings and changes

- Login's successful activation path imported and uploaded portal playlists whenever
  the selected local catalog was empty. Enter now prepares the selected local playlist.
  Website imports remain an explicit refresh action. Previously requested offline
  deletions retain a separate retry path that cannot list or upload playlists.
- Provider manager rendered labels by decrypting every credential. It now reads stored
  labels and decrypts only when an action needs the selected provider. Database load
  failures in registration/editing are handled; editing cannot save before initial load.
  QR encoding failures show the unavailable state. Raw provider exception messages no
  longer appear in the registration UI.
- Provider ratings and artwork were cached but not rebound to open detail views.
  In-place updates now include rating, poster, backdrop, logo and title. Five-point
  ratings are normalized to ten. Rich actor records survive duplicate plain names;
  nested provider images/credits and provider-relative image URLs are supported.
  Partial responses retain existing metadata. Actor focus is restored after rebinding.
- Recycled artwork views kept coordinator threads waiting for obsolete downloads.
  Cancellation now interrupts the view's wait without canceling another view's shared
  download. Prefetch filesystem checks run in the background. A blocked-response
  regression tests that a new visible image can finish before obsolete responses.
- Settings use at most two columns, larger titles and distinct value areas, retaining
  existing preference keys and focus navigation.
- Removed four source files after confirming no source, manifest, build or test
  references: UsageSignals, ThemeManager, ThemeProfile and BackgroundCatalogEngine.
  Legacy persisted workers remain for upgrade compatibility. Playback components were
  excluded from removal.

## Verification and limits

PR #64 runs Android unit tests, lint, debug/instrumentation builds, native verification
and isolated Arabic phone/TV interface tests. The interface fixture checks fresh ratings
and records screenshots, settings gfxinfo and memory evidence. Emulator frame timings
are diagnostic, not a physical-receiver performance guarantee.

Production portal E2E tests in PR #65 use two synthetic devices and ensure the second
cannot list, replace or delete the first device's playlist. No customer playlists or
credentials were read during this review.

No crash stack from the reported physical receiver was available. The unhandled load
paths are hardened, but the user's intermittent crash has not been reproduced and
cannot be declared conclusively resolved. Actual provider metadata completeness and
Downloader device behavior still depend on the user's server and receiver.

Release gates retain the original signing certificate, encrypted maintenance archive,
offline in-place upgrade checks, and byte-identical FFmpeg libraries for all four ABIs.
Media3, FFmpeg configuration, stream URL construction, playback fallback and existing
purple/white identity remain unchanged.
