# Actual signed v2000073 source → owner-only v2000076 candidate

The base commit is `f09ad837654ea4eb14e464f3ec15c2f60d9b6411`, the target of the GitHub signed Android TV 2000073 owner-test release (24 Oct 2026). This replaces the incorrect `a9a1101` baseline which had changed the original bright purple UI into a muted dark palette.

The signed release candidate retains all original v73 UI code, translations, logo, original purple theme and background, Xtream importer and streaming engines, playlists, activation screens and user data storage. The only UI code changes are the D-pad navigation fixes ported cleanly onto the original v73 LoginActivity. Additional changes: Android TV 320×180 banner and 512×512 icon; navigation focus fixes; stable device identity/recovery migration logic; next Play-safe versionCode 2000076.

For test-only debug builds: use the offline localhost endpoint for unit/instrumentation tests ONLY, and the actual Railway api.blofyplayer.com and updates.blofyplayer.com hostnames when assembling the user's installable QA APK. The production-signed APK/AAB workflow does not publish to the website, GitHub Releases or Play Console. An actual Play Console 73 installation and physical Android TV 9 still must be checked before replacing any app.

Do not switch the branding to the muted charcoal theme and do not adopt the separate code-only edition or the experimental main/75 design.