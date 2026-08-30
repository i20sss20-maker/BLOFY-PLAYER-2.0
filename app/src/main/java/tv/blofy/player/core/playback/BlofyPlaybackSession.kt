package tv.blofy.player.core.playback

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import tv.blofy.player.core.diagnostics.PlaybackDiagnostics
import tv.blofy.player.core.diagnostics.PlaybackMetric
import tv.blofy.player.core.network.TransportFactory
import tv.blofy.player.core.provider.ProviderProfile

@OptIn(markerClass = [UnstableApi::class])
class BlofyPlaybackSession(
    context: Context,
    private val profile: ProviderProfile,
    private val contentKind: String = "unknown",
    private val onTerminalError: ((String) -> Unit)? = null
) {
    private var metric: PlaybackMetric? = null
    private var firstFrameRecorded = false
    private var automaticRetries = 0
    private val retryHandler = Handler(context.mainLooper)
    private val appContext = context.applicationContext

    private val renderersFactory = DefaultRenderersFactory(appContext)
        .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)

    val player: ExoPlayer = ExoPlayer.Builder(appContext)
        .setRenderersFactory(renderersFactory)
        .setMediaSourceFactory(DefaultMediaSourceFactory(TransportFactory.create(appContext, profile)))
        .build()
        .apply {
            setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                true
            )
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_BUFFERING) metric?.let { metric = PlaybackDiagnostics.buffering(it) }
                }

                override fun onRenderedFirstFrame() {
                    if (!firstFrameRecorded) {
                        metric?.let { metric = PlaybackDiagnostics.firstFrame(it) }
                        firstFrameRecorded = true
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    metric?.let { metric = PlaybackDiagnostics.error(it, error.errorCodeName, error.message) }
                    if (automaticRetries < MAX_AUTOMATIC_RETRIES) {
                        automaticRetries++
                        retryHandler.post { retrySameUrl() }
                    } else {
                        val failedUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                        if (failedUrl.isNotBlank()) {
                            retryHandler.post {
                                if (onTerminalError != null) onTerminalError.invoke(failedUrl)
                                else if (profile.allowVlcFallback) ExternalPlayerLauncher.launchPreferred(appContext, failedUrl)
                            }
                        }
                    }
                }
            })
        }

    fun play(url: String, resumeMs: Long = 0L) {
        automaticRetries = 0
        firstFrameRecorded = false
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        val item = MediaItem.Builder().setUri(url).build()
        player.setMediaItem(item)
        player.prepare()
        if (resumeMs > 0L) player.seekTo(resumeMs)
        player.playWhenReady = true
    }

    fun retrySameUrl() {
        val item = player.currentMediaItem ?: return
        val position = player.currentPosition.coerceAtLeast(0L)
        player.stop()
        player.setMediaItem(item)
        player.prepare()
        if (position > 0L) player.seekTo(position)
        player.playWhenReady = true
    }

    fun isStarted(): Boolean = player.playbackState == Player.STATE_READY && player.playWhenReady

    fun release() {
        retryHandler.removeCallbacksAndMessages(null)
        player.release()
    }

    private companion object {
        const val MAX_AUTOMATIC_RETRIES = 1
    }
}
