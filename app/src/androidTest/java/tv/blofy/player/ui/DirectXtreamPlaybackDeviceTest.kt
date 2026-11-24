package tv.blofy.player.ui

import android.graphics.SurfaceTexture
import android.view.Surface
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.core.identity.NativeExternalCatalogSession
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.core.identity.UnifiedStreamCodeClient
import tv.blofy.player.core.network.TransportFactory
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.playback.createPlaybackPlayerWithTransport
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class DirectXtreamPlaybackDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test fun websiteCodeLoadsCatalogAndNativePlayerRendersAllMediaTypes() = runBlocking {
        assertEquals("tv.blofy.player.v2.stream.qa",context.packageName)
        assertFalse(StreamCodeSession.isClaimed(context))
        try {
            val (profile,urls) = withTimeout(180_000L) {
                val redeemed = UnifiedStreamCodeClient.redeem("00000000","0".repeat(64),syntheticLab = true)
                assertTrue(redeemed is UnifiedStreamCodeClient.Result.External)
                val prepared = NativeExternalCatalogSession.prepare(context,redeemed as UnifiedStreamCodeClient.Result.External)
                NativeExternalCatalogSession.activatePrepared(context,prepared)
                assertEquals(prepared.providerId,NativeExternalCatalogSession.activeId(context))
                val dao = BlofyDatabase.get(context).dao()
                val provider = checkNotNull(dao.provider(prepared.providerId))
                val profile = ProviderProfile(providerKey = provider.id)
                val live = checkNotNull(dao.streamByIdentity(provider.id,"live","101"))
                val movie = checkNotNull(dao.streamByIdentity(provider.id,"movie","201"))
                checkNotNull(dao.streamByIdentity(provider.id,"series","301"))
                PlaylistManager.forProvider(context,provider,dao).syncSeriesEpisodes(provider,"301")
                val episode = dao.episodeSnapshot(provider.id,"301").single()
                val route = ContentUrlResolver.liveRoute(provider,profile,live)
                profile to listOf(
                    route.primaryUrl,
                    checkNotNull(route.fallbackUrl),
                    ContentUrlResolver.movie(provider,movie),
                    ContentUrlResolver.episode(provider,episode)
                )
            }
            for (url in urls) assertRendered(profile,url)
        } finally {
            NativeExternalCatalogSession.signOut(context)
        }
    }

    private fun assertRendered(profile: ProviderProfile,url: String) {
        val rendered = CountDownLatch(1)
        val failure = AtomicReference<String?>(null)
        lateinit var player: ExoPlayer
        lateinit var texture: SurfaceTexture
        lateinit var surface: Surface
        instrumentation.runOnMainSync {
            texture = SurfaceTexture(false)
            texture.setDefaultBufferSize(320,180)
            surface = Surface(texture)
            player = createPlaybackPlayerWithTransport(context,TransportFactory.create(context,profile))
            player.setVideoSurface(surface)
            player.volume = 0f
            player.addListener(object : Player.Listener {
                override fun onRenderedFirstFrame() { rendered.countDown() }
                override fun onPlayerError(error: PlaybackException) {
                    failure.set(error.errorCodeName)
                    rendered.countDown()
                }
            })
            val item = MediaItem.Builder().setUri(url)
            if (url.endsWith(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8)
            player.setMediaItem(item.build())
            player.prepare()
            player.playWhenReady = true
        }
        try {
            assertTrue("No decoded frame within 60 seconds: "+url.substringAfterLast('/'),
                rendered.await(60,TimeUnit.SECONDS))
            assertNull("Native playback error",failure.get())
        } finally {
            instrumentation.runOnMainSync {
                player.release()
                surface.release()
                texture.release()
            }
        }
    }
}
