from pathlib import Path

def edit(path, old, new):
    file = Path(path)
    text = file.read_text()
    assert text.count(old) == 1, (path, old[:80], text.count(old))
    file.write_text(text.replace(old, new, 1))

edit('app/src/main/java/tv/blofy/player/core/identity/PortalPlaylistClient.kt',
     '            if (type != "xtream") continue',
     '''            if (type != "xtream") {
                if (type != "m3u" || id.isBlank()) deferred++
                continue
            }''')
edit('app/src/main/java/tv/blofy/player/core/identity/BlofySubscriberClient.kt',
     '                    val row = items.getJSONObject(index)',
     '                    val row = items.optJSONObject(index) ?: continue')
edit('app/src/main/java/tv/blofy/player/core/identity/BlofySubscriberClient.kt',
     '                    check(token in batch) { "استجابة BLOFY غير مكتملة" }',
     '                    if (token !in batch) continue')
edit('app/src/test/java/tv/blofy/player/core/identity/PortalRefreshRecoveryTest.kt',
     '    @Test fun feedbackNeverDisplaysRawSecretsOrRequestUrls() {',
     '''    @Test fun missingProviderTypeCannotLookLikeAConfirmedDeletion() {
        val saved = local("keep"); rows[saved.id] = saved
        PortalSyncBook.bind(app, "keep", "keep")
        enqueue(JSONObject())
        val result = pull()
        assertEquals(1, result.deferredCount)
        assertEquals(listOf("keep"), result.providers.map { it.id })
        assertEquals(saved, rows["keep"])
    }
    @Test fun feedbackNeverDisplaysRawSecretsOrRequestUrls() {''')
edit('app/build.gradle.kts', 'versionCode = 2000052', 'versionCode = 2000053')
edit('app/build.gradle.kts', 'versionName = "2.0.0-rc07.41"', 'versionName = "2.0.0-rc07.42"')
