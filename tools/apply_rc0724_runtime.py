from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"expected patch anchor missing: {path}")
    p.write_text(text.replace(old, new, 1))


# Hidden/public direct_source failures: canonical Xtream is the first recovery route.
p = Path("app/src/main/java/tv/blofy/player/core/playback/ContentUrlResolver.kt")
text = p.read_text()
text = text.replace(
    """        val origin = ProviderHostResolver.providerOriginFallback(provider.baseUrl, source)\n            ?.takeUnless { it == primary }\n        return origin ?: canonicalLive(provider, profile, stream).takeUnless { it == primary }""",
    """        val canonical = canonicalLive(provider, profile, stream).takeUnless { it == primary }\n        if (canonical != null) return canonical\n        return ProviderHostResolver.providerOriginFallback(provider.baseUrl, source)\n            ?.takeUnless { it == primary }""",
    1,
)
text = text.replace(
    """        val origin = ProviderHostResolver.providerOriginFallback(provider.baseUrl, stream.directSource)\n            ?.takeUnless { it == primary }\n        return origin ?: canonicalMovie(provider, stream).takeUnless { it == primary }""",
    """        val canonical = canonicalMovie(provider, stream).takeUnless { it == primary }\n        if (canonical != null) return canonical\n        return ProviderHostResolver.providerOriginFallback(provider.baseUrl, stream.directSource)\n            ?.takeUnless { it == primary }""",
    1,
)
text = text.replace(
    """        val origin = ProviderHostResolver.providerOriginFallback(provider.baseUrl, episode.directSource)\n            ?.takeUnless { it == primary }\n        return origin ?: canonicalEpisode(provider, episode).takeUnless { it == primary }""",
    """        val canonical = canonicalEpisode(provider, episode).takeUnless { it == primary }\n        if (canonical != null) return canonical\n        return ProviderHostResolver.providerOriginFallback(provider.baseUrl, episode.directSource)\n            ?.takeUnless { it == primary }""",
    1,
)
p.write_text(text)

# Render an already-persisted identity without waiting for Room/database opening.
p = Path("app/src/main/java/tv/blofy/player/core/identity/DeviceIdentity.kt")
text = p.read_text()
anchor = """    @Synchronized\n    fun deviceId(context: Context): String {"""
insert = """    @Synchronized\n    fun cachedIdentity(context: Context): Pair<String, String>? {\n        val preferences = preferences(context)\n        val deviceId = preferences.getString(DEVICE_ID, null)?.takeIf(::validDeviceId) ?: return null\n        val activationCode = preferences.getString(ACTIVE_CODE, null)?.takeIf(::validActivationCode) ?: return null\n        return deviceId to activationCode\n    }\n\n    @Synchronized\n    fun deviceId(context: Context): String {"""
if insert not in text:
    if anchor not in text:
        raise SystemExit("DeviceIdentity anchor missing")
    text = text.replace(anchor, insert, 1)
p.write_text(text)

p = Path("app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt")
text = p.read_text()
if "import tv.blofy.player.core.identity.DeviceIdentity" not in text:
    text = text.replace(
        "import tv.blofy.player.core.identity.ActivationRemoteClient\n",
        "import tv.blofy.player.core.identity.ActivationRemoteClient\nimport tv.blofy.player.core.identity.DeviceIdentity\n",
        1,
    )
replace_once(
    str(p),
    """        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()\n        installWebsiteRefreshButton()\n    }""",
    """        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()\n        installWebsiteRefreshButton()\n        renderCachedIdentityImmediately()\n    }""",
)
text = p.read_text()
anchor = """    private fun requestIdentityRefresh(fromWebsite: Boolean = false) {"""
method = """    private fun renderCachedIdentityImmediately() {\n        val cached = DeviceIdentity.cachedIdentity(applicationContext) ?: return\n        deviceView.text = cached.first\n        codeView.text = cached.second\n        status.text = \"جاري تحميل القوائم المحفوظة...\"\n        val url = ActivationPortalUrl.create(activationEndpoint, cached.first, cached.second) ?: return\n        lastQrIdentity = cached\n        lifecycleScope.launch {\n            val bitmap = withContext(Dispatchers.Default) { createQr(url) }\n            if (lastQrIdentity == cached) qrView.setImageBitmap(bitmap)\n        }\n    }\n\n    private fun requestIdentityRefresh(fromWebsite: Boolean = false) {"""
if method not in text:
    if anchor not in text:
        raise SystemExit("LoginActivity anchor missing")
    text = text.replace(anchor, method, 1)
p.write_text(text)

p = Path("app/src/main/java/tv/blofy/player/ui/login/SplashActivity.kt")
p.write_text(p.read_text().replace("private const val MINIMUM_SPLASH_MS = 320L", "private const val MINIMUM_SPLASH_MS = 60L"))

# Movies/series use the same bounded keyset paging strategy already proven for Live.
p = Path("app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt")
text = p.read_text()
text = text.replace(
    """    private var liveGeneration = 0\n\n    private val kind by lazy""",
    """    private var liveGeneration = 0\n\n    private val catalogItems = ArrayList<StreamEntity>(CATALOG_PAGE_SIZE)\n    private var catalogHasMore = true\n    private var catalogLastRowId = 0L\n    private var catalogLoading = false\n    private var catalogGeneration = 0\n\n    private val kind by lazy""",
    1,
)
text = text.replace(
    """                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {\n                    if (kind != KIND_LIVE || dy <= 0 || liveLoading || !liveHasMore) return\n                    val lm = recyclerView.layoutManager as? LinearLayoutManager ?: return\n                    if (lm.findLastVisibleItemPosition() >= liveItems.size - LIVE_PREFETCH_THRESHOLD) loadNextLivePage()\n                }""",
    """                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {\n                    if (dy <= 0) return\n                    val lm = recyclerView.layoutManager as? LinearLayoutManager ?: return\n                    if (kind == KIND_LIVE) {\n                        if (!liveLoading && liveHasMore && lm.findLastVisibleItemPosition() >= liveItems.size - LIVE_PREFETCH_THRESHOLD) loadNextLivePage()\n                    } else if (!catalogLoading && catalogHasMore && lm.findLastVisibleItemPosition() >= catalogItems.size - CATALOG_PREFETCH_THRESHOLD) {\n                        loadNextCatalogPage()\n                    }\n                }""",
    1,
)
text = text.replace(
    """                if (kind == KIND_LIVE) {\n                    rememberStream(stream)\n                    val index = streamAdapter.indexOfKey(stream.key)\n                    if (index >= liveItems.size - LIVE_PREFETCH_THRESHOLD) loadNextLivePage()\n                }\n                if (previewEnabled && !stream.locked) schedulePreview(stream)""",
    """                val index = streamAdapter.indexOfKey(stream.key)\n                if (kind == KIND_LIVE) {\n                    rememberStream(stream)\n                    if (index >= liveItems.size - LIVE_PREFETCH_THRESHOLD) loadNextLivePage()\n                } else if (index >= catalogItems.size - CATALOG_PREFETCH_THRESHOLD) {\n                    loadNextCatalogPage()\n                }\n                if (previewEnabled && !stream.locked) schedulePreview(stream)""",
    1,
)
text = text.replace(
    """                if (kind != KIND_LIVE) {\n                    if (currentCategoryId == null && streamAdapter.itemCount == 0 && streamsJob?.isActive != true) {\n                        loadStreams(null)\n                    }\n                    requestInitialCatalogFocus()""",
    """                if (kind != KIND_LIVE) {\n                    if (currentCategoryId == null && catalogItems.isEmpty() && !catalogLoading) {\n                        loadStreams(null)\n                    }\n                    requestInitialCatalogFocus()""",
    1,
)
old_load = """    private fun loadStreams(categoryId: String?) {\n        if (!::provider.isInitialized) return\n        if (kind == KIND_LIVE) {\n            loadLiveStreams(categoryId)\n            return\n        }\n        if (currentCategoryId == categoryId && streamsJob?.isActive == true) return\n        currentCategoryId = categoryId\n        streamsJob?.cancel()\n        streamsJob = lifecycleScope.launch {\n            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect { items ->\n                streamAdapter.submit(items)\n                updateCatalogState(items, categoryId)\n            }\n        }\n    }\n"""
new_load = """    private fun loadStreams(categoryId: String?) {\n        if (!::provider.isInitialized) return\n        if (kind == KIND_LIVE) {\n            loadLiveStreams(categoryId)\n            return\n        }\n        if (currentCategoryId == categoryId && catalogItems.isNotEmpty()) return\n        saveCatalogMemorySnapshot()\n        currentCategoryId = categoryId\n        catalogGeneration += 1\n        streamsJob?.cancel()\n        catalogItems.clear()\n        catalogHasMore = true\n        catalogLastRowId = 0L\n        catalogLoading = false\n\n        val cached = CatalogPageMemory.get(catalogMemoryKey())\n        if (cached != null && cached.items.isNotEmpty()) {\n            catalogItems.addAll(cached.items)\n            catalogLastRowId = cached.lastRowId\n            catalogHasMore = cached.total == Int.MAX_VALUE\n            streamAdapter.replace(cached.items)\n            updateCatalogState(cached.items, categoryId)\n            return\n        }\n\n        streamAdapter.replace(emptyList())\n        showCatalogStatus(\"جاري تحميل ${catalogLabel()}...\", retry = false)\n        loadNextCatalogPage(reset = true)\n    }\n\n    private fun loadNextCatalogPage(reset: Boolean = false) {\n        if (!::provider.isInitialized || kind == KIND_LIVE || catalogLoading) return\n        if (!reset && !catalogHasMore) return\n        val generation = catalogGeneration\n        val cursor = if (reset) 0L else catalogLastRowId\n        val categoryId = currentCategoryId\n        catalogLoading = true\n        streamsJob = lifecycleScope.launch {\n            val dao = BlofyDatabase.get(applicationContext).dao()\n            val result = withContext(Dispatchers.IO) {\n                val page = if (categoryId == null) dao.catalogPageAfterAll(provider.id, kind, cursor, CATALOG_PAGE_SIZE)\n                else dao.catalogPageAfterInCategory(provider.id, kind, categoryId, cursor, CATALOG_PAGE_SIZE)\n                val rowId = page.lastOrNull()?.let { dao.streamRowId(it.key) } ?: cursor\n                page to rowId\n            }\n            if (generation != catalogGeneration) return@launch\n            catalogLastRowId = result.second\n            catalogHasMore = result.first.size >= CATALOG_PAGE_SIZE\n            if (reset) {\n                catalogItems.clear()\n                catalogItems.addAll(result.first)\n                streamAdapter.replace(result.first)\n            } else {\n                catalogItems.addAll(result.first)\n                streamAdapter.append(result.first)\n            }\n            catalogLoading = false\n            saveCatalogMemorySnapshot()\n            updateCatalogState(catalogItems, categoryId)\n            if (result.first.isNotEmpty()) ArtworkLoader.prefetch(this@ContentBrowserActivity, result.first.take(12).map { it.icon })\n        }.also { job ->\n            job.invokeOnCompletion { if (generation == catalogGeneration) runOnUiThread { catalogLoading = false } }\n        }\n    }\n\n    private fun saveCatalogMemorySnapshot() {\n        if (kind == KIND_LIVE || !::provider.isInitialized || catalogItems.isEmpty()) return\n        CatalogPageMemory.put(\n            catalogMemoryKey(),\n            catalogItems,\n            if (catalogHasMore) Int.MAX_VALUE else catalogItems.size,\n            catalogLastRowId,\n            null\n        )\n    }\n\n    private fun catalogMemoryKey(): String = \"${provider.id}:$kind:${currentCategoryId ?: ALL_CATEGORY_ID}\"\n"""
if new_load not in text:
    if old_load not in text:
        raise SystemExit("ContentBrowser loadStreams anchor missing")
    text = text.replace(old_load, new_load, 1)
text = text.replace(
    """    override fun onPause() {\n        saveLiveMemorySnapshot()\n        super.onPause()\n    }""",
    """    override fun onPause() {\n        saveLiveMemorySnapshot()\n        saveCatalogMemorySnapshot()\n        super.onPause()\n    }""",
    1,
)
text = text.replace(
    """        catalogRefreshJob?.cancel()\n        liveGeneration += 1\n        stopPreview()""",
    """        catalogRefreshJob?.cancel()\n        liveGeneration += 1\n        catalogGeneration += 1\n        saveCatalogMemorySnapshot()\n        stopPreview()""",
    1,
)
text = text.replace(
    """        private const val LIVE_PAGE_SIZE = 96\n        private const val LIVE_PREFETCH_THRESHOLD = 28""",
    """        private const val LIVE_PAGE_SIZE = 96\n        private const val LIVE_PREFETCH_THRESHOLD = 28\n        private const val CATALOG_PAGE_SIZE = 120\n        private const val CATALOG_PREFETCH_THRESHOLD = 36""",
    1,
)
p.write_text(text)

# Version bump.
p = Path("app/build.gradle.kts")
text = p.read_text().replace("versionCode = 2000031", "versionCode = 2000032").replace('versionName = "2.0.0-rc07.23"', 'versionName = "2.0.0-rc07.24"')
p.write_text(text)

# Signed release expectations and filenames.
p = Path(".github/workflows/rc07-release.yml")
text = p.read_text()
text = text.replace('EXPECTED_VERSION_CODE: "2000031"', 'EXPECTED_VERSION_CODE: "2000032"')
text = text.replace('EXPECTED_VERSION_NAME: 2.0.0-rc07.23', 'EXPECTED_VERSION_NAME: 2.0.0-rc07.24')
text = text.replace("rc07.23", "rc07.24")
text = text.replace("versionCode = 2000031", "versionCode = 2000032")
text = text.replace('versionName = "2.0.0-rc07.23"', 'versionName = "2.0.0-rc07.24"')
p.write_text(text)

Path("tools/check_rc0724_runtime.py").write_text(
    '''from pathlib import Path\n\nresolver = Path("app/src/main/java/tv/blofy/player/core/playback/ContentUrlResolver.kt").read_text()\nassert "val canonical = canonicalLive(provider, profile, stream).takeUnless { it == primary }" in resolver\nassert resolver.index("val canonical = canonicalLive") < resolver.index("ProviderHostResolver.providerOriginFallback(provider.baseUrl, source)")\n\nlogin = Path("app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt").read_text()\nidentity = Path("app/src/main/java/tv/blofy/player/core/identity/DeviceIdentity.kt").read_text()\nassert "renderCachedIdentityImmediately()" in login\nassert "fun cachedIdentity(context: Context)" in identity\n\nbrowser = Path("app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt").read_text()\nassert "loadNextCatalogPage" in browser\nassert "CATALOG_PAGE_SIZE = 120" in browser\nassert ".dao().streams(provider.id, kind, categoryId).collect" not in browser\nprint("rc07.24 runtime recovery checks passed")\n'''
)

print("rc07.24 patches applied")
