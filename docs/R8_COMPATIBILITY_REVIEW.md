# Isolated R8 compatibility review

Baseline: Android rc07.42, 63ce6db157a761eb94cdcf3953f9bce298af8ae5. Website main is separate.

This branch adds opt-in name obfuscation plus an actual Release build/runtime validation job. It does not contain the earlier history-scanner change. It does not publish releases, change source visibility, select an update, use customer/provider accounts, modify subscription data or access production signing secrets.

Default release behavior is unchanged until -PBLOFY_SECURITY_R8=true is explicitly used. Shrinking and optimization remain off. Existing unannotated serialized field names, Android entry points, library code and playback classes remain conservatively kept. Broad keep rules are intentional staging constraints, not recommended final coverage or encryption.

The CI job generates a disposable test key, uses an unreachable .invalid activation origin, reuses the digest-pinned previous FFmpeg AAR and builds both ordinary and R8 Release APKs. It requires meaningful class renaming, identical native library bytes between these two builds, successful JVM tests, release lint, apksigner/zipalign and six instrumentation cases on the actual non-debuggable target. Tests cover activation JSON, legacy release cache JSON, generated Room loading, FFmpeg native initialization, update verification/file sharing boundaries and Login activity startup.

Only aggregate evidence is uploaded. Test-signed APKs and mappings are not distributed. Production-key upgrade, real provider playback, TV remote navigation, signed production release with securely retained mapping, source/download separation, persistent login budgets, session revocation and full-history audit remain independent acceptance gates. Do not infer completion from merely starting this workflow.
