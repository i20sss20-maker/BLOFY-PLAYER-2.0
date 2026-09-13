# rc07.43 signed R8 candidate

The owner requested continuation after PR #59 passed 546 JVM and six actual-R8
runtime cases. That opt-in preparation is integrated into `rc07-runtime-recovery`.
This candidate enables the same name-obfuscation rules in the existing signed
release workflow, with version `2.0.0-rc07.43` / `2000054`. Shrinking and
optimization stay disabled. Application runtime source, player engines, native
configuration, theme, website and customer update selection are unchanged.

The production environment, allowed release branch and pinned signing certificate
remain mandatory. Publication still creates an optional GitHub prerelease, not a
Google Play release or a change to the website's primary update. Publication and
artifact upload require all of the existing gates plus the checks below.

## Upgrade evidence

The isolated API 35 x86_64 emulator installs the hash-pinned released rc07.42 APK.
Before its first launch, verified IPv4 and IPv6 OUTPUT rules block network access
for its UID. A framework-only fixture seeds an encrypted provider using the
existing Android Keystore alias and storage format, a favorite/locked item, and
resume state. The real old Login creates its normal device identity and PIN.

The unchanged production-signed rc07.43 APK is then installed with `adb install
-r`. The runner requires the same UID and first-install timestamp; no uninstall
or app-data clear is used. The new obfuscated application's own DeviceIdentity and
Room DAO APIs must recover the old identity, PIN, decrypted provider, favorite,
lock and resume position. Both named instrumentation cases must pass with no
skips; Login must launch without an app crash. The test carrier is signed in CI
and retained only in temporary storage; it is never published.

This establishes only an offline emulator upgrade. It does not establish real
provider playback, physical receiver behavior or a complete security audit.

## Private maintenance material

An AAB may contain its R8 mapping in `BUNDLE-METADATA`, so neither the plaintext
AAB nor `mapping.txt` is uploaded to public release assets. The exact signed AAB,
mapping and source identity are archived and encrypted with AES-256-GCM, with its
random key wrapped to the existing production certificate using RSA-OAEP-SHA256.
The envelope authenticates source identity and certificate metadata. CI verifies
an exact decryption round trip using the existing signing key through a local
pipe; that private key is never part of an output file or archive.

The public `.maintenance.vault.json` is useful only with the owner's original
signing private key. Keep the existing signing recovery kit safe. To recover on a
trusted local machine with Node.js and OpenSSL, set `BLOFY_VAULT_STORE_PASSWORD`
locally without logging it, then run:

```bash
openssl pkcs12 -in /private/path/blofy-release.p12 -nocerts -nodes \
  -passin env:BLOFY_VAULT_STORE_PASSWORD | \
  node tools/release_vault.mjs open \
    BLOFY-PLAYER-2.0-rc07.43-maintenance.vault.json maintenance-private.tar.gz
```

The command refuses to overwrite an existing output. The recovered archive
contains `app-release.aab`, `mapping.txt`, and `source.json`. Keep these private;
use the AAB for the owner's Play Console upload and the mapping for crash
symbolication. The directly installable APK remains outside the encrypted archive.

The publication allowlist rejects any unexpected file, plaintext AAB, mapping or
test carrier. Public aggregate reports record the signed upgrade, number of
renamed classes and four native hashes, which must match released rc07.42 bytes.
All plaintext maintenance inputs and signing intermediates are removed from CI
after the job, including failure paths.

Local validation before CI: seven generated-key encryption/tampering tests and
22 evidence/provenance tests pass. Actual signed-build and emulator results must
be recorded from their completed run, not inferred from these local tests.

## CI lineage and separate website status

PR #60 passed [Android CI 34738677639](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/34738677639),
including compilation of both upgrade fixtures, and
[FFmpeg CI 34738677637](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/34738677637).
The initial signed candidate source is `0f92505009011c7807ffe1f84be5b13c0c829ae9`.

[Initial signed run 34738929126](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/34738929126)
passed signing, lint, both named upgrade cases, exact four-ABI native parity,
811/1391 mapped app class renames and maintenance-encryption round-trip. It failed
the subsequent standalone-process check and published no release or artifact.
The runner now separates instrumentation teardown with a cold `am start -S -W`,
requires Login to be resumed and the same process to survive another five seconds,
and captures crash/exit/activity diagnostics on failure. The cause of the initial
missing process is not established from its insufficient diagnostics; no passing
standalone-start result is inferred from the two passing instrumentation cases.

The Android branch has four inherited subscriber-UI contract failures in
[Activation CI 34738677658](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/34738677658)
(131 of 135 unit tests pass). Commit `bf47cf1` restored the v1 UI injection while
retaining v4 selector/save/renewal tests. All activation service bytes remain
identical to rc07.42 source `63ce6db`; those tests are not disabled or relaxed.
This Android branch must not be deployed as the website. The separately deployed
website source `c68daaf` passed
[Activation CI 34735215650](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/runs/34735215650)
and its subscriber/admin session suites.

Remaining protection work: source visibility and download separation, persistent
server login limits, individual session revocation, MFA, old deployment exposure
and the previously deferred history audit. None is claimed solved by this release.

References: [Android App Bundle metadata](https://developer.android.com/guide/app-bundle/app-bundle-format),
[Node.js cryptography](https://nodejs.org/api/crypto.html).
