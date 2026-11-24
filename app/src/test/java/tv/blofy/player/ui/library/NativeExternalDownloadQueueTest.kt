package tv.blofy.player.ui.library

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.core.identity.NativeExternalMediaTransport

class NativeExternalDownloadQueueTest {
    private val id = "external-12345678-1234-1234-1234-123456789abc"
    private val other = "external-22345678-1234-1234-1234-123456789abc"

    @Test fun acceptsOnlyCanonicalProgressiveMovieAndEpisodeRoutes() {
        val movie = NativeExternalMediaTransport.route(id,"movie","12","mkv")
        val episode = NativeExternalMediaTransport.route(id,"series","15","mp4")
        assertTrue(NativeExternalDownloadQueue.validRoute(id,"movie",movie,"mkv"))
        assertTrue(NativeExternalDownloadQueue.validRoute(id,"episode",episode,"mp4"))
        assertFalse(NativeExternalDownloadQueue.validRoute(other,"movie",movie,"mkv"))
        assertFalse(NativeExternalDownloadQueue.validRoute(id,"episode",movie,"mkv"))
        assertFalse(NativeExternalDownloadQueue.validRoute(id,"live",movie,"mkv"))
        assertFalse(NativeExternalDownloadQueue.validRoute(id,"movie",movie,"mp4"))
        assertFalse(NativeExternalDownloadQueue.validRoute(id,"movie",movie+"?secret=x","mkv"))
        assertFalse(NativeExternalDownloadQueue.validRoute(id,"movie",
            movie.replace("external-xtream.invalid","provider.example.com"),"mkv"))
        assertFalse(NativeExternalDownloadQueue.validRoute(id,"movie",
            movie.replace(".mkv",".ts"),"ts"))
    }
}
