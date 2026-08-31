# FFmpeg distribution compliance

This document is an engineering compliance record, not legal advice.

## Locked inputs

- FFmpeg: `n6.0`
- FFmpeg commit: `ea3d24bbe3c58b171e55fe2151fc7ffaca3ab3d2`
- AndroidX Media3: `1.6.1`
- Media3 commit: `839c4a90f2ab36e48be73e1b5e907f3283dce72e`
- Android NDK: `28.0.13004108`
- Gradle: `8.11.1`
- Native API level: `21`
- Decoders: `ac3 eac3 dca truehd aac mp3 opus vorbis flac`

The build must stop if either tag resolves to a different commit.

## License configuration

The official Media3 1.6.1 FFmpeg script builds static FFmpeg archives and links
them into `libffmpegJNI.so`. It uses `--disable-everything`, enables only the
decoder list above, and does not enable GPL, nonfree, external, or
version-3-only components.

Every native build verifies the final FFmpeg `config.h` contains:

```text
#define CONFIG_GPL 0
#define CONFIG_NONFREE 0
#define CONFIG_VERSION3 0
```

A build that does not satisfy all three checks must not produce a release
artifact.

## Materials shipped with each release

Every FFmpeg-enabled APK/AAB is distributed with a matching archive named:

```text
BLOFY-PLAYER-2.0-<release-label>-ffmpeg-compliance.zip
```

It contains:

- the exact FFmpeg source archive;
- the exact AndroidX Media3 source used for the JNI bridge and relinking;
- FFmpeg `LICENSE.md` and `COPYING.LGPLv2.1`;
- the AndroidX Media Apache 2.0 license;
- `ffmpeg-changes.diff`;
- non-empty `androidx-media-changes.diff` (the NDK r28 pin and prominent
  BLOFY modification notice used for the JNI build);
- the exact build and relink recipe;
- SHA-256 hashes.

The compliance archive must remain at the same download location for as long
as the matching binary is offered. A 30-day CI artifact alone is not a durable
public distribution location.

The APK and AAB also contain the notices under
`assets/open_source/`, and Settings displays an FFmpeg LGPL notice whenever
the native extension is bundled.

## Relinking

The compliance archive includes both source trees because FFmpeg static
archives are linked into the Media3 JNI shared library. A recipient can rebuild
the Media3 decoder AAR against a modified, interface-compatible FFmpeg source
tree, replace `libffmpegJNI.so` in the matching APK, then zipalign and sign the
modified APK with their own key for their own use.

Any BLOFY EULA or distribution terms must preserve the LGPL exception for
modification and reverse engineering used to debug those modifications.

## Release gate

Before distributing an RC:

1. Verify the signed APK/AAB contains the license assets.
2. Verify the compliance archive contains all files and passes its SHA-256 list.
3. Verify `androidx-media-changes.diff` is non-empty and applies to the pinned
   pristine Media3 source archive.
4. Verify `CONFIG_GPL=0`, `CONFIG_NONFREE=0`, and `CONFIG_VERSION3=0`.
5. Publish the compliance archive beside the APK/AAB.
6. Put the FFmpeg attribution and source link on every download page.
7. Review codec patent/licensing obligations separately for each distribution
   jurisdiction. LGPL compliance does not settle patent rights.

Reference: <https://ffmpeg.org/legal.html>
