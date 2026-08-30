# BLOFY PLAYER 2.0 — Alpha QA Matrix

This is the execution checklist for the first real-device/server Alpha. A build is not promoted if a release gate fails.

## Test targets

Run against at least three providers with different behavior:

- Provider A: previously fast/working server.
- Provider B: mixed Live/VOD behavior.
- Provider C: historically difficult server (slow/failing Live or VOD).

Run on at least:

- Android TV / receiver using D-pad remote.
- Android phone.
- One lower-spec Android box if available.

Test both standard debug APK and FFmpeg APK when the native extension artifact is available.

## Startup / local-first

- First playlist sync completes and enters Home without hanging at 95%.
- Close app completely, reopen, press Connect: local Room catalog opens without full network sync.
- Manual refresh is the only normal action that replaces the catalog.
- Favorites, locks and resume state survive refresh.
- Switching saved provider changes catalog cleanly without mixing data.

Release gate: warm Connect should feel immediate from local storage and must not wait for the provider API.

## Live TV

For SD, HD, FHD and 4K/HEVC samples when available:

- First/saved channel starts in TV mini preview.
- Fast D-pad navigation does not create a stream request for every key repeat; debounce remains stable.
- OK opens fullscreen.
- CH+/CH- switches within the current group.
- Numeric channel entry selects the intended channel.
- Back returns to Browser and restores category/channel focus.
- Audio, subtitle and quality menus reflect actual tracks.
- Favorite toggle persists.
- Now/Next EPG appears when supplied.
- Catch-up opens only when the provider advertises archive support.
- Network loss shows a controlled error/recovery path; no permanent UI freeze.

Measure TTFF (time to first rendered frame) for 10 channel starts/provider:

- Median target: <= 3 s on a healthy provider.
- Investigate any healthy-provider start > 8 s.
- A terminal failure must occur in bounded time; never spin forever.

## Movies

- Details open before playback; no autoplay on details.
- Metadata shown when supplied: plot/year/genre/duration/rating/backdrop.
- Start from beginning works.
- Resume appears only with meaningful stored progress.
- Seeking works and progress saves on exit.
- Completed titles do not remain as misleading resume entries.
- Media3 same-URL retry occurs once only.
- External fallback can launch after terminal Media3 failure when enabled.

Measure TTFF for at least 5 movies/provider including one large/high-bitrate title.

## Series

- Seasons and episodes sort ascending.
- Episode opens with correct URL/extension/direct source rules.
- Resume works per episode.
- Previous/Next episode controls select correct episode.
- Natural completion marks episode complete and Auto Next selects the next episode.
- Returning from player restores season/episode focus.
- 4K/HEVC episode tested when available.

## Audio compatibility

Standard APK:

- AAC/MP3/common device-supported codecs play normally.
- Unsupported audio produces a controlled failure/fallback rather than UI lock.

FFmpeg APK:

- Settings must show `FFmpeg: مدمج`.
- Test AC3.
- Test EAC3.
- Test DTS (`dca`).
- Test TrueHD when provider/device sample exists.
- Confirm video remains synchronized with decoded audio.

Release gate for FFmpeg build: native extension must be reported as bundled and at least AC3 + EAC3 samples must play on a real device.

## M3U/M3U8

- Direct live URLs remain direct; do not rebuild as Xtream URLs.
- Group titles become categories.
- Movie-like entries route to Movie flow.
- SxxExx entries become Series/Episodes and sort correctly.
- tvg-id is retained for EPG association.
- Broken entries do not block parsing of the remaining playlist.

## Remote / focus

On TV remote, repeatedly enter/exit every major screen:

- Home restores previous action.
- Browser category/stream focus is retained.
- Settings restores previous button.
- Provider Manager restores provider row/action after re-render.
- Details/Episodes remain navigable using only D-pad/OK/Back.
- No focus moves to invisible/non-actionable controls.
- Rapid Up/Down does not freeze or crash.

Run a 5-minute stress scroll in large Live/Movie/Series lists.

## Activation

With real backend configured:

- Unknown device receives trial according to backend policy.
- Correct deviceId + activationCode is required.
- Trial is allowed before expiry.
- Active is allowed before expiry/lifetime.
- Expired is denied.
- Blocked is denied immediately.
- Unknown state is denied.
- Backend outage allows only a still-valid cached entitlement.
- Backend outage never resurrects an expired/blocked cached entitlement.

## Network / resilience

Test:

- Wi-Fi disconnect during Live.
- Wi-Fi reconnect.
- Provider HTTP 404/5xx.
- DNS failure.
- Very slow response.
- Redirect behavior on provider with redirects enabled and disabled.
- App background/foreground during playback.
- Device sleep/wake where applicable.

No scenario may leave BLOFY permanently unresponsive.

## Diagnostics capture

For every failed sample record:

- Provider identifier (not credentials).
- Content kind.
- Stream/channel title.
- TTFF.
- Buffering count.
- Media3 error code/name.
- Whether retry happened.
- Whether external fallback launched.
- Device model / Android version.
- FFmpeg bundled: yes/no.

Never store playlist passwords or full credential-bearing URLs in shared diagnostics.

## Alpha release gate

Alpha is ready for broader testing only when:

- Android CI is green.
- Activation CI is green.
- No reproducible UI freeze/crash in the matrix.
- Provider A Live/Movie/Series all work.
- At least two of three providers complete core Live/Movie/Series flows, with provider-specific failures documented rather than hidden by a global workaround.
- Local-first warm Connect is verified.
- TV remote stress test passes.
- Activation states are verified against the deployed backend.
- FFmpeg remains optional; if the FFmpeg Alpha is distributed, its native audio gate above must pass.
