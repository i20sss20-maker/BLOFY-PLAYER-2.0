package tv.blofy.player.core.playback

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import tv.blofy.player.core.diagnostics.PlaybackDiagnostics
import tv.blofy.player.core.diagnostics.PlaybackDiagnosticsUploader
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
    private var alternateLiveFormatAttempted = false
    private val fallbackState = PlaybackFallbackState()
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
                        metric?.let {
                            val updated = PlaybackDiagnostics.firstFrame(it)
                            metric = updated
                            PlaybackDiagnosticsUploader.enqueue(appContext, updated)
                        }
                        firstFrameRecorded = true
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    metric?.let {
                        val updated = PlaybackDiagnostics.error(it, error.errorCodeName, error.message)
                        metric = updated
                        PlaybackDiagnosticsUploader.enqueue(appContext, updated)
                    }
                    if (automaticRetries < MAX_AUTOMATIC_RETRIES) {
                        automaticRetries++
                        retryHandler.post { retrySameUrl() }
                    } else {
                        val failedUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                        if (failedUrl.isNotBlank()) {
                            retryHandler.post {
                                val alternateUrl = if (!alternateLiveFormatAttempted && contentKind.isLiveContent()) {
                                    ContentUrlResolver.alternateLiveFormat(failedUrl, profile)
                                } else {
                                    null
                                }
                                if (alternateUrl != null) {
                                    alternateLiveFormatAttempted = true
                                    playInternalFallback(alternateUrl)
                                } else {
                                    val configuredFallback = fallbackState.nextConfiguredUrl()
                                    if (configuredFallback != null) {
                                        fallbackState.markConfiguredUrlAttempted(configuredFallback)
                                        playInternalFallback(configuredFallback)
                                    } else {
                                        // Stay in BLOFY. The external-player button remains available
                                        // as an explicit user action, but failures never launch Android's
                                        // app chooser automatically.
                                        onTerminalError?.invoke(failedUrl)
                                    }
                                }
                            }
                        }
                    }
                }
            })
        }

    fun play(url: String, resumeMs: Long = 0L, fallbackUrl: String? = null) {
        // A channel switch supersedes any queued retry/fallback from the old URL.
        retryHandler.removeCallbacksAndMessages(null)
        automaticRetries = 0
        alternateLiveFormatAttempted = false
        fallbackState.begin(url, fallbackUrl)
        firstFrameRecorded = false
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        val item = mediaItem(url)
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
        if (!contentKind.isLiveContent() && position > 0L) player.seekTo(position)
        player.playWhenReady = true
    }

    private fun playInternalFallback(url: String) {
        // The primary endpoint already received its normal retry. Give each
        // selected internal fallback one attempt, without retry loops.
        fallbackState.markUrlAttempted(url)
        automaticRetries = MAX_AUTOMATIC_RETRIES
        firstFrameRecorded = false
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        player.stop()
        player.setMediaItem(mediaItem(url))
        player.prepare()
        player.playWhenReady = true
    }

    private fun mediaItem(url: String): MediaItem = MediaItem.Builder()
        .setUri(url)
        .apply {
            if (PlaybackMediaTypePolicy.shouldHintHls(contentKind, profile.liveFormat, url)) {
                setMimeType(MimeTypes.APPLICATION_M3U8)
            }
        }
        .build()

    fun isStarted(): Boolean = player.playbackState == Player.STATE_READY && player.playWhenReady

    fun release() {
        retryHandler.removeCallbacksAndMessages(null)
        player.release()
    }

    private companion object {
        const val MAX_AUTOMATIC_RETRIES = 1
    }

    private fun String.isLiveContent(): Boolean = this == "live" || this == "live_preview"
}
