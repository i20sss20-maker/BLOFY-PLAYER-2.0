# Minified instrumentation runtime correction

Run 34735413353 built and verified an actual non-debuggable R8 target, renamed 811 of 1391 mapped app classes, and passed 546 JVM cases. All four FFmpeg native hashes matched the same-source unminified build. Its Android instrumentation did NOT pass: the test APK's independently shrunken j$ runtime shadowed the target's runtime (missing Objects.requireNonNull and DesugarCollections.synchronizedMap), causing three failures and a process crash.

This correction preserves the entire target APK and every test-code DEX byte. It removes only DEX files consisting exclusively of j$ backport classes from the disposable instrumentation carrier, then aligns and signs that carrier with the same disposable CI identity. Mixed DEX files fail closed rather than removing test code. The app supplies its existing Java backport implementation. The underlying duplicate-classpath problem and single-app runtime approach are described at https://slackhq.github.io/keeper/#core-library-desugaring-l8-support . No new Gradle plugin or production dependency is installed.

The runner validates packages, signatures, unchanged target APK hash and unchanged retained test DEX. It executes the original six assertions via adb on the isolated emulator, requires six distinct named successes and rejects skips, assumptions, failures, wrong classes, duplicates and process crashes. An explicit r8Review argument prevents these Release-only tests from failing ordinary Debug test suites; zero skipped tests remain mandatory in this job.

This is a test-harness correction, not a claim that a failing target has been repaired. Actual follow-up run results determine success. No customer APK, mapping, production key, provider account, application source, player or website is modified or published by it.

## Producer evidence follow-up

Run 34736342054 stopped before instrumentation at the mixed-DEX guard. That guard
used package prefixes to identify L8 outputs. L8 can itself obfuscate backport
classes outside `j$`, as described in Keeper's `configureL8` implementation, so a
DEX containing another namespace does not establish that it contains test code.

The follow-up copies the dedicated `l8DexDesugarLibReleaseAndroidTest` task's
`desugarLibDex` output into private CI scratch via `stageR8TestL8Evidence`. This
task is available only in the opt-in R8 review build and changes no compiler
outputs. The runner removes a test-carrier DEX only when its entire bytes match
an output of that exact L8 producer. It rejects missing, duplicate, unmatched or
different-byte evidence, app/test classes in the producer output, and remaining
unproven `j$` definitions. A merged L8/test DEX still fails closed. The contract
test class must remain, and all retained DEX bytes remain identical after signing.

All six runtime assertions and zero-skip requirements remain intact. Nine new
local regression cases exercise producer matching and rejection boundaries. A
successful local test does not establish Android compatibility; that still
requires the complete emulator workflow on the resulting commit.

Primary implementation reference:
https://github.com/slackhq/keeper/blob/main/keeper-gradle-plugin/src/main/java/com/slack/keeper/KeeperPlugin.kt
