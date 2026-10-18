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
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import tv.blofy.player.core.diagnostics.PlaybackDiagnostics
import tv.blofy.player.core.diagnostics.PlaybackDiagnosticsUploader
import tv.blofy.player.core.diagnostics.PlaybackMetric
import tv.blofy.player.core.network.TransportFactory
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference

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
    private var useHttpTransport = false
    private var cronetFailedThisSession = false
    private var lastFailureMessage = ""
    private var lastSafeErrorCode = "NONE"
    private var startupReady = false
    private val startupWatchdog = Runnable {
        if (!startupReady && player.playbackState != Player.STATE_ENDED &&
            player.playWhenReady && player.currentMediaItem != null) {
            if (profile.transport == TransportPreference.CRONET_FIRST && !useHttpTransport) {
                useHttpTransport = true
                cronetFailedThisSession = true
                retrySameUrl()
            } else {
                // Silent stalls must also try real, provider-configured fallbacks.
                // Error-based recovery alone does not run when no exception is emitted.
                val failedUrl = player.currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                val alternative = nextFallbackAfter(failedUrl)
                if (alternative != null) {
                    playInternalFallback(alternative)
                } else {
                    lastFailureMessage = "انتهت مهلة بدء التشغيل لكل المصادر المتاحة. تحقق من الاتصال وصلاحية الاشتراك."
                    finishWithError(lastFailureMessage)
                }
            }
        }
    }
    private val httpMediaSourceFactory by lazy {
        DefaultMediaSourceFactory(
            TransportFactory.create(appContext, profile.copy(transport = TransportPreference.HTTP_FIRST))
        )
    }
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
                    if (playbackState == Player.STATE_READY) {
                        startupReady = true
                        retryHandler.removeCallbacks(startupWatchdog)
                        resetLiveStallTimer(keepPosition = true)
                    }
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
                    val failure = PlaybackFailurePolicy.from(error)
                    lastFailureMessage = failure.message
                    lastSafeErrorCode = tv.blofy.player.core.diagnostics.DiagnosticsSanitizer.sanitizeErrorCode(error.errorCodeName) ?: "UNKNOWN"
                    metric?.let {
                        val updated = PlaybackDiagnostics.error(it, error.errorCodeName, error.message)
                        metric = updated
                        PlaybackDiagnosticsUploader.enqueue(appContext, updated)
                    }
                    // An expired session or forbidden stream cannot be repaired by changing
                    // transports or repeatedly hitting a credential-protected endpoint.
                    if (failure.authFailure || currentMediaItem?.localConfiguration?.uri == null) {
                        finishWithError(lastFailureMessage)
                        return
                    }
                    // Cronet can fail on some IPTV/CDN endpoints even when plain HTTP works.
                    // Reuse this Media3 player and retry the *same* item over HttpDataSource.
                    if (profile.transport == TransportPreference.CRONET_FIRST &&
                        !useHttpTransport && failure.tryHttpTransport) {
                        useHttpTransport = true
                        cronetFailedThisSession = true
                        retryHandler.post { retrySameUrl() }
                        return
                    }
                    if (automaticRetries < MAX_AUTOMATIC_RETRIES) {
                        automaticRetries++
                        retryHandler.post { retrySameUrl() }
                    } else {
                        val failedUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                        if (failedUrl.isBlank()) {
                            // Missing media information must still surface a terminal failure.
                            finishWithError(lastFailureMessage)
                        } else {
                            retryHandler.post {
                                val alternative = nextFallbackAfter(failedUrl)
                                if (alternative != null) {
                                    playInternalFallback(alternative)
                                } else {
                                    // Stay in BLOFY. Failures never launch another player automatically.
                                    finishWithError(lastFailureMessage)
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
        startupReady = false
        automaticRetries = 0
        alternateLiveFormatAttempted = false
        liveStallRecoveries = 0
        lastLiveStallRecoveryAtMs = 0L
        resetLiveStallTimer(keepPosition = false)
        fallbackState.begin(url, fallbackUrl)
        useHttpTransport = cronetFailedThisSession || profile.transport == TransportPreference.HTTP_FIRST
        lastFailureMessage = ""
        lastSafeErrorCode = "NONE"
        firstFrameRecorded = false
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        val item = mediaItem(url)
        setMedia(item)
        player.prepare()
        if (resumeMs > 0L && !contentKind.isLiveContent()) player.seekTo(resumeMs)
        player.playWhenReady = true
        armStartupWatchdog()
        if (contentKind.isLiveContent()) retryHandler.postDelayed(liveStallWatchdog, LIVE_STALL_WATCHDOG_INTERVAL_MS)
    }

    fun retrySameUrl() {
        val item = player.currentMediaItem ?: return
        val position = player.currentPosition.coerceAtLeast(0L)
        resetLiveStallTimer(keepPosition = false)
        player.stop()
        setMedia(item)
        player.prepare()
        if (!contentKind.isLiveContent() && position > 0L) player.seekTo(position)
        player.playWhenReady = true
        armStartupWatchdog()
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

    private fun finishWithError(reason: String) {
        retryHandler.removeCallbacks(startupWatchdog)
        retryHandler.removeCallbacks(liveStallWatchdog)
        onTerminalError?.invoke(reason)
        player.stop()
    }

    private fun nextFallbackAfter(failedUrl: String): String? {
        if (failedUrl.isBlank()) return null
        if (!alternateLiveFormatAttempted && contentKind.isLiveContent()) {
            alternateLiveFormatAttempted = true
            ContentUrlResolver.alternateLiveFormat(failedUrl, profile)?.let { return it }
        }
        return fallbackState.nextConfiguredUrl()?.also { fallbackState.markConfiguredUrlAttempted(it) }
    }

    private fun playInternalFallback(url: String) {
        // Existing error fallback behavior stays unchanged. The stall watchdog never selects this path.
        fallbackState.markUrlAttempted(url)
        automaticRetries = MAX_AUTOMATIC_RETRIES
        firstFrameRecorded = false
        resetLiveStallTimer(keepPosition = false)
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        player.stop()
        setMedia(mediaItem(url))
        player.prepare()
        player.playWhenReady = true
        armStartupWatchdog()
    }

    private fun armStartupWatchdog() {
        retryHandler.removeCallbacks(startupWatchdog)
        startupReady = false
        retryHandler.postDelayed(startupWatchdog, STARTUP_TIMEOUT_MS)
    }

    private fun setMedia(item: MediaItem) {
        if (useHttpTransport) player.setMediaSource(httpMediaSourceFactory.createMediaSource(item))
        else player.setMediaItem(item)
    }

    private fun mediaItem(url: String): MediaItem = MediaItem.Builder()
        .setUri(url)
        .apply {
            if (PlaybackMediaTypePolicy.shouldHintDash(url)) {
                setMimeType(MimeTypes.APPLICATION_MPD)
            } else if (PlaybackMediaTypePolicy.shouldHintHls(contentKind, profile.liveFormat, url)) {
                setMimeType(MimeTypes.APPLICATION_M3U8)
            }
        }
        .build()

    fun isStarted(): Boolean = player.playbackState == Player.STATE_READY && player.playWhenReady

    /** Safe fields only: no provider URL, credentials or stream identifier. */
    fun diagnosticCode(): String = lastSafeErrorCode
    fun diagnosticTransport(): String = if (useHttpTransport) "HTTP" else "CRONET"

    fun release() {
        retryHandler.removeCallbacksAndMessages(null)
        player.release()
    }

    private companion object {
        const val MAX_AUTOMATIC_RETRIES = 1
        const val STARTUP_TIMEOUT_MS = 35_000L
        const val LIVE_STALL_WATCHDOG_INTERVAL_MS = 4_000L
        const val LIVE_STALL_RECOVERY_THRESHOLD_MS = 12_000L
        const val LIVE_STALL_RECOVERY_COOLDOWN_MS = 60_000L
        const val MAX_LIVE_STALL_RECOVERIES_PER_ITEM = 3
    }

    private fun String.isLiveContent(): Boolean = this == "live" || this == "live_preview"
}
