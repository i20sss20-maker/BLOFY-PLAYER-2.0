from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

browser_path = Path("app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt")
text = browser_path.read_text(encoding="utf-8")

text = replace_once(text, "import kotlinx.coroutines.flow.first\n", "", "remove flow.first")
text = replace_once(
    text,
    '    private val phoneMode get() = deviceKind == DeviceClass.Kind.PHONE\n    private val previewEnabled get() = kind == KIND_LIVE && !phoneMode && RuntimeSettings.autoplayLive(this)\n',
    '    private val phoneMode get() = deviceKind == DeviceClass.Kind.PHONE\n    private val screenWidthDp get() = resources.configuration.screenWidthDp.takeIf { it > 0 } ?: resources.configuration.smallestScreenWidthDp\n    private val previewEnabled get() = kind == KIND_LIVE && !phoneMode && screenWidthDp >= 1100 && RuntimeSettings.autoplayLive(this)\n',
    "responsive preview policy",
)
text = replace_once(
    text,
    '            setPadding(if (phoneMode) 18 else 30, if (phoneMode) 16 else 22, if (phoneMode) 18 else 30, if (phoneMode) 16 else 22)\n',
    '            setPadding(dp(if (phoneMode) 10 else 22), dp(if (phoneMode) 10 else 16), dp(if (phoneMode) 10 else 22), dp(if (phoneMode) 10 else 16))\n',
    "root padding",
)
text = replace_once(
    text,
    '            setPadding(8, 0, 0, if (phoneMode) 10 else 14)\n        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phoneMode) 58 else 64))\n',
    '            setPadding(dp(8), 0, 0, dp(if (phoneMode) 8 else 10))\n        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (phoneMode) 54 else 62)))\n',
    "title spacing",
)
text = text.replace('            elevation = 4f\n            setPadding(8, 10, 8, 10)\n', '            elevation = dp(4).toFloat()\n            setPadding(dp(8), dp(10), dp(8), dp(10))\n', 2)
text = replace_once(
    text,
    '            body.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 92).apply { bottomMargin = 10 })\n',
    '            body.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76)).apply { bottomMargin = dp(10) })\n',
    "phone category strip",
)
text = replace_once(
    text,
    '            body.addView(categoryList, LinearLayout.LayoutParams(250, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 20 })\n            if (previewEnabled) {\n                body.addView(streamList, LinearLayout.LayoutParams(420, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 22 })\n',
    '            val railWidth = when { screenWidthDp >= 1600 -> 244; screenWidthDp >= 1100 -> 228; else -> 206 }\n            body.addView(categoryList, LinearLayout.LayoutParams(dp(railWidth), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(16) })\n            if (previewEnabled) {\n                val channelWidth = if (screenWidthDp >= 1600) 410 else 360\n                body.addView(streamList, LinearLayout.LayoutParams(dp(channelWidth), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(18) })\n',
    "wide layout widths",
)
text = replace_once(
    text,
    '            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }\n',
    '            val activeId = dao.activeProviderId() ?: run { finish(); return@launch }\n            provider = dao.provider(activeId) ?: run { finish(); return@launch }\n',
    "active provider fast path",
)
text = replace_once(text, '        setPadding(12, 0, 12, if (phoneMode) 8 else 12)\n', '        setPadding(dp(12), 0, dp(12), dp(if (phoneMode) 8 else 12))\n', "status padding")
text = replace_once(
    text,
    '        addView(catalogRetry, LinearLayout.LayoutParams(if (phoneMode) 170 else 210, if (phoneMode) 58 else 64))\n',
    '        addView(catalogRetry, LinearLayout.LayoutParams(dp(if (phoneMode) 150 else 190), dp(if (phoneMode) 52 else 58)))\n',
    "retry button size",
)
text = replace_once(text, '        setPadding(18, 18, 18, 18)\n', '        setPadding(dp(18), dp(18), dp(18), dp(18))\n', "preview padding")
text = replace_once(text, '        elevation = 5f\n', '        elevation = dp(5).toFloat()\n', "preview elevation")
text = replace_once(text, '            setPadding(4, 0, 4, 10)\n        }\n        addView(previewTitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 48))\n', '            setPadding(dp(4), 0, dp(4), dp(10))\n        }\n        addView(previewTitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))\n', "preview title")
text = replace_once(text, '            setPadding(4, 0, 4, 10)\n        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 34))\n', '            setPadding(dp(4), 0, dp(4), dp(10))\n        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)))\n', "preview live label")
text = replace_once(text, '            setPadding(4, 12, 4, 0)\n        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 40))\n', '            setPadding(dp(4), dp(12), dp(4), 0)\n        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))\n', "preview footer")
text = text.replace('result.first.take(12).map { it.icon }', 'result.first.take(6).map { it.icon }')
text = replace_once(
    text,
    '        private const val LIVE_PAGE_SIZE = 96\n        private const val LIVE_PREFETCH_THRESHOLD = 28\n        private const val CATALOG_PAGE_SIZE = 120\n        private const val CATALOG_PREFETCH_THRESHOLD = 36\n',
    '        // Keep the first render small so lists become interactive quickly; subsequent pages stream in before the user reaches the end.\n        private const val LIVE_PAGE_SIZE = 48\n        private const val LIVE_PREFETCH_THRESHOLD = 16\n        private const val CATALOG_PAGE_SIZE = 64\n        private const val CATALOG_PREFETCH_THRESHOLD = 20\n',
    "page sizes",
)
text = replace_once(
    text,
    '    companion object {\n',
    '    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()\n\n    companion object {\n',
    "dp helper",
)
browser_path.write_text(text, encoding="utf-8")

poster_path = Path("app/src/main/java/tv/blofy/player/ui/catalog/PosterCatalogActivity.kt")
poster = poster_path.read_text(encoding="utf-8")
poster = replace_once(poster, 'ArtworkLoader.prefetch(this@PosterCatalogActivity, result.first.take(8).map { it.icon ?: it.backdrop })', 'ArtworkLoader.prefetch(this@PosterCatalogActivity, result.first.take(6).map { it.icon ?: it.backdrop })', "poster prefetch")
poster = replace_once(
    poster,
    '        private const val PAGE_SIZE = 96\n        private const val PREFETCH_THRESHOLD = 28\n',
    '        private const val PAGE_SIZE = 64\n        private const val PREFETCH_THRESHOLD = 20\n',
    "poster paging",
)
poster_path.write_text(poster, encoding="utf-8")

print("rc07.24 UI/performance patch applied")
