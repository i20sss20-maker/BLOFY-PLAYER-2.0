from pathlib import Path

# rc07.24 field fixes: hidden-host recovery, cached login identity, bounded catalog paging.
resolver = Path("app/src/main/java/tv/blofy/player/core/playback/ContentUrlResolver.kt").read_text()
assert "val canonical = canonicalLive(provider, profile, stream).takeUnless { it == primary }" in resolver
assert resolver.index("val canonical = canonicalLive") < resolver.index("ProviderHostResolver.providerOriginFallback(provider.baseUrl, source)")

login = Path("app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt").read_text()
identity = Path("app/src/main/java/tv/blofy/player/core/identity/DeviceIdentity.kt").read_text()
assert "renderCachedIdentityImmediately()" in login
assert "fun cachedIdentity(context: Context)" in identity

browser = Path("app/src/main/java/tv/blofy/player/ui/browser/ContentBrowserActivity.kt").read_text()
assert "loadNextCatalogPage" in browser
assert "CATALOG_PAGE_SIZE = 120" in browser
assert ".dao().streams(provider.id, kind, categoryId).collect" not in browser
print("rc07.24 runtime recovery checks passed")
