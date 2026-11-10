package tv.blofy.player.core.playback

import android.content.Context
import android.os.Handler
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import android.util.Log
import tv.blofy.player.BuildConfig
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
    private var lastObservedLivePositionMs = Long.MIN_VALUE
    private var liveStallStartedAtMs = 0L
    private var lastLiveStallRecoveryAtMs = 0L
    private var liveStallRecoveries = 0
    private val fallbackState = PlaybackFallbackState()
    private val retryHandler = Handler(context.mainLooper)
    private val appContext = context.applicationContext

    private val liveStallWatchdog = object : Runnable {
        override fun run() {
            if (!contentKind.isLiveContent()) return
            checkLiveStall()
            retryHandler.postDelayed(this, LIVE_STALL_WATCHDOG_INTERVAL_MS)
        }
    }

    private val renderersFactory = DefaultRenderersFactory(appContext)
        // On some Android 9 TV boxes the first advertised hardware codec
        // cannot initialize for high-bitrate 4K/HD AC3/EAC3 tracks. Try a
        // second suitable decoder already installed on the device.
        // Does NOT claim FFmpeg exists or decode an unsupported codec.
        .setEnableDecoderFallback(true)
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
                override fun onTracksChanged(tracks: Tracks) {
                    if (!contentKind.isLiveContent()) return
                    val audioGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                    if (audioGroups.isNotEmpty() &&
                        audioGroups.none { group ->
                            (0 until group.length).any { group.isTrackSupported(it) }
                        }
                    ) {
                        // Codec MIME is public metadata; never log a source URL,
                        // channel name, subscriber token, or provider secret.
                        val codecKinds = audioGroups.flatMap { group ->
                            (0 until group.length).mapNotNull { index ->
                                group.getTrackFormat(index).sampleMimeType
                            }
                        }.distinct().take(6).map { mime ->
                            when (mime) {
                                MimeTypes.AUDIO_AC3 -> "ac3"
                                MimeTypes.AUDIO_E_AC3 -> "eac3"
                                MimeTypes.AUDIO_DTS -> "dts"
                                MimeTypes.AUDIO_DTS_HD -> "dts_hd"
                                MimeTypes.AUDIO_AAC -> "aac"
                                else -> "other_audio"
                            }
                        }
                        Log.w("BLOFY_AUDIO_CODEC", "live_no_supported_audio_decoder codecs=" +
                            codecKinds.joinToString(",") +
                            " ffmpegBundled=" + BuildConfig.FFMPEG_EXTENSION_BUNDLED)
                    }
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_BUFFERING) metric?.let { metric = PlaybackDiagnostics.buffering(it) }
                    if (playbackState == Player.STATE_READY) resetLiveStallTimer(keepPosition = true)
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
                    resetLiveStallTimer(keepPosition = true)
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
                                        // Stay in BLOFY. Failures never launch another player automatically.
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
        // A channel switch supersedes any queued retry/fallback/watchdog work from the old URL.
        retryHandler.removeCallbacksAndMessages(null)
        automaticRetries = 0
        alternateLiveFormatAttempted = false
        liveStallRecoveries = 0
        lastLiveStallRecoveryAtMs = 0L
        resetLiveStallTimer(keepPosition = false)
        fallbackState.begin(url, fallbackUrl)
        firstFrameRecorded = false
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        val item = mediaItem(url)
        player.setMediaItem(item)
        player.prepare()
        if (resumeMs > 0L) player.seekTo(resumeMs)
        player.playWhenReady = true
        if (contentKind.isLiveContent()) retryHandler.postDelayed(liveStallWatchdog, LIVE_STALL_WATCHDOG_INTERVAL_MS)
    }

    fun retrySameUrl() {
        val item = player.currentMediaItem ?: return
        val position = player.currentPosition.coerceAtLeast(0L)
        resetLiveStallTimer(keepPosition = false)
        player.stop()
        player.setMediaItem(item)
        player.prepare()
        if (!contentKind.isLiveContent() && position > 0L) player.seekTo(position)
        player.playWhenReady = true
    }

    private fun checkLiveStall() {
        if (!contentKind.isLiveContent() || player.currentMediaItem == null || !player.playWhenReady) {
            resetLiveStallTimer(keepPosition = false)
            return
        }
        if (player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
            resetLiveStallTimer(keepPosition = false)
            return
        }

        val now = SystemClock.elapsedRealtime()
        val position = player.currentPosition.coerceAtLeast(0L)

        // Live TS/HLS providers do not all expose a monotonic currentPosition.
        // READY means the player has usable media; never recycle a healthy
        // fullscreen session just because its reported position is flat.
        if (player.playbackState != Player.STATE_BUFFERING) {
            resetLiveStallTimer(keepPosition = true)
            lastObservedLivePositionMs = position
            return
        }

        if (lastObservedLivePositionMs == Long.MIN_VALUE) {
            lastObservedLivePositionMs = position
            liveStallStartedAtMs = now
            return
        }
        if (liveStallStartedAtMs == 0L) liveStallStartedAtMs = now

        val stalledForMs = now - liveStallStartedAtMs
        val recoveryCooldownPassed = now - lastLiveStallRecoveryAtMs >= LIVE_STALL_RECOVERY_COOLDOWN_MS
        if (stalledForMs >= LIVE_STALL_RECOVERY_THRESHOLD_MS &&
            recoveryCooldownPassed &&
            liveStallRecoveries < MAX_LIVE_STALL_RECOVERIES_PER_ITEM
        ) {
            liveStallRecoveries++
            lastLiveStallRecoveryAtMs = now
            retrySameUrl()
        }
    }

    private fun resetLiveStallTimer(keepPosition: Boolean) {
        liveStallStartedAtMs = 0L
        if (!keepPosition) lastObservedLivePositionMs = Long.MIN_VALUE
    }

    private fun playInternalFallback(url: String) {
        // Existing error fallback behavior stays unchanged. The stall watchdog never selects this path.
        fallbackState.markUrlAttempted(url)
        automaticRetries = MAX_AUTOMATIC_RETRIES
        firstFrameRecorded = false
        resetLiveStallTimer(keepPosition = false)
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
        const val LIVE_STALL_WATCHDOG_INTERVAL_MS = 4_000L
        const val LIVE_STALL_RECOVERY_THRESHOLD_MS = 12_000L
        const val LIVE_STALL_RECOVERY_COOLDOWN_MS = 60_000L
        const val MAX_LIVE_STALL_RECOVERIES_PER_ITEM = 3
    }

    private fun String.isLiveContent(): Boolean = this == "live" || this == "live_preview"
}
