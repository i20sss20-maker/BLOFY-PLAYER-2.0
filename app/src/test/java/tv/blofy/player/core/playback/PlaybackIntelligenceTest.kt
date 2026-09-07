package tv.blofy.player.core.playback

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.provider.ProviderProfile

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PlaybackIntelligenceTest {
    private val app get() = RuntimeEnvironment.getApplication()

    private fun learnedProfile(providerKind: ProviderKind, format: String): ProviderProfile {
        val profile = ProviderProfile(providerKey = "${providerKind.name}-$format", providerKind = providerKind)
        PlaybackIntelligence.clear(app, profile.providerKey)
        PlaybackIntelligence.recordSuccess(app, profile.providerKey, "live",
            "https://fixture.example.test/live/user/pass/1.$format", 800L)
        return profile
    }

    @Test fun xtreamLearnedFormatChangesOnlyTheLiveExtension() {
        val profile = learnedProfile(ProviderKind.XTREAM, "m3u8")
        val original = "https://fixture.example.test/panel/live/u%2Fname/p%23%3F%25%20/100.ts" +
            "?token=a%2fb+c&token=%252F#part%2fone"
        val expected = original.replace("/100.ts?", "/100.m3u8?")
        assertEquals(expected, PlaybackIntelligence.preferredUrl(app, profile, "live", original))
        assertEquals(expected, PlaybackIntelligence.preferredUrl(app, profile, "live_preview", original))
    }

    @Test fun unknownProvidersAndNonXtreamResourcesNeverUseLearnedSuffixes() {
        val unknown = learnedProfile(ProviderKind.UNKNOWN, "m3u8")
        val xtream = learnedProfile(ProviderKind.XTREAM, "m3u8")
        val xtreamLike = "https://fixture.example.test/live/user/pass/1.ts?signature=a%2Fb"
        val direct = "https://cdn.example.test/channels/1.ts?signature=a%2Fb"
        assertEquals(xtreamLike, PlaybackIntelligence.preferredUrl(app, unknown, "live", xtreamLike))
        assertEquals(direct, PlaybackIntelligence.preferredUrl(app, xtream, "live", direct))
        assertEquals(xtreamLike, PlaybackIntelligence.preferredUrl(app, xtream, "movie", xtreamLike))
    }
}
