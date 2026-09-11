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
import tv.blofy.player.core.diagnostics.PlaybackFailureDetails
import tv.blofy.player.core.network.TransportFactory
import tv.blofy.player.core.provider.ProviderProfile

@OptIn(markerClass = [UnstableApi::class])
class BlofyPlaybackSession(
    context: Context,
    private val profile: ProviderProfile,
    private val contentKind: String = "unknown",
    private val playerFactory: (Context, ProviderProfile) -> ExoPlayer = ::createPlaybackPlayer,
    private val onTerminalError: ((String) -> Unit)? = null
) {
    private var closing = false
    private var metric: PlaybackMetric? = null
    private var firstFrameRecorded = false
    private var playStartedAtMs = 0L
    private var automaticRetries = 0
    private var alternateLiveFormatAttempted = false
    private var lastObservedLivePositionMs = Long.MIN_VALUE
    private var liveStallStartedAtMs = 0L
    private var lastLiveStallRecoveryAtMs = 0L
    private var liveStallRecoveries = 0
    private var seekRecoveryGeneration = 0
    private val fallbackState = PlaybackFallbackState()
    private val retryHandler = Handler(context.mainLooper)
    private val appContext = context.applicationContext

    private val liveStallWatchdog = object : Runnable {
        override fun run() {
            if (closing || !contentKind.isLiveContent()) return
            checkLiveStall()
            retryHandler.postDelayed(this, LIVE_STALL_WATCHDOG_INTERVAL_MS)
        }
    }

    val player: ExoPlayer = playerFactory(appContext, profile)
        .apply {
            setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                true
            )
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (closing) return
                    if (playbackState == Player.STATE_BUFFERING) metric?.let { metric = PlaybackDiagnostics.buffering(it) }
                    if (playbackState == Player.STATE_READY) {
                        resetLiveStallTimer(keepPosition = true)
                        if (!contentKind.isLiveContent()) seekRecoveryGeneration++
                    }
                }

                override fun onPositionDiscontinuity(
                    oldPosition: Player.PositionInfo,
                    newPosition: Player.PositionInfo,
                    reason: Int
                ) {
                    if (closing) return
                    if (reason == Player.DISCONTINUITY_REASON_SEEK && !contentKind.isLiveContent()) {
                        scheduleSeekRecovery(newPosition.positionMs.coerceAtLeast(0L))
                    }
                }

                override fun onRenderedFirstFrame() {
                    if (closing) return
                    automaticRetries = 0
                    if (!firstFrameRecorded) {
                        metric?.let {
                            val updated = PlaybackDiagnostics.firstFrame(it)
                            metric = updated
                            PlaybackDiagnosticsUploader.enqueue(appContext, updated)
                        }
                        val currentUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                        if (currentUrl.isNotBlank() && playStartedAtMs > 0L) {
                            PlaybackIntelligence.recordSuccess(
                                appContext,
                                profile.providerKey,
                                contentKind,
                                currentUrl,
                                (SystemClock.elapsedRealtime() - playStartedAtMs).coerceAtLeast(0L)
                            )
                        }
                        firstFrameRecorded = true
                    }
                    resetLiveStallTimer(keepPosition = true)
                }

                override fun onPlayerError(error: PlaybackException) {
                    metric?.let {
                        val details = PlaybackFailureDetails.describe(error,
                            phase = if (closing) "release" else "playback",
                            videoFormat = videoFormat)
                        val updated = PlaybackDiagnostics.error(it, error.errorCodeName, details)
                        metric = updated
                        PlaybackDiagnosticsUploader.enqueue(appContext, updated)
                    }
                    // Media3 can synchronously report a timeout while detaching a surface or
                    // releasing. It must never restart this session or penalize the provider.
                    if (closing) return
                    val failedUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                    if (failedUrl.isNotBlank()) {
                        PlaybackIntelligence.recordFailure(appContext, profile.providerKey, contentKind, failedUrl)
                    }
                    if (automaticRetries < MAX_AUTOMATIC_RETRIES) {
                        automaticRetries++
                        retryHandler.post { retrySameUrl() }
                    } else if (failedUrl.isNotBlank()) {
                        retryHandler.post {
                            if (closing) return@post
                            // A configured provider-origin fallback exists specifically to escape an
                            // unreachable direct/hidden host. Try that route before changing .ts/.m3u8
                            // on the same failed origin; otherwise a dead hidden hostname costs another
                            // full timeout before the reachable provider is even attempted.
                            val configuredFallback = fallbackState.nextConfiguredUrl()
                            if (configuredFallback != null) {
                                fallbackState.markConfiguredUrlAttempted(configuredFallback)
                                playInternalFallback(configuredFallback)
                                return@post
                            }
                            val alternateUrl = if (!alternateLiveFormatAttempted && contentKind.isLiveContent()) {
                                ContentUrlResolver.alternateLiveFormat(failedUrl, profile)
                            } else {
                                null
                            }
                            if (alternateUrl != null && !fallbackState.wasAttempted(alternateUrl)) {
                                alternateLiveFormatAttempted = true
                                playInternalFallback(alternateUrl)
                            } else {
                                onTerminalError?.invoke(failedUrl)
                            }
                        }
                    }
                }
            })
        }

    fun play(url: String, resumeMs: Long = 0L, fallbackUrl: String? = null, fallbackUrls: List<String> = emptyList()) {
        if (closing) return
        retryHandler.removeCallbacksAndMessages(null)
        seekRecoveryGeneration++
        automaticRetries = 0
        alternateLiveFormatAttempted = false
        liveStallRecoveries = 0
        lastLiveStallRecoveryAtMs = 0L
        resetLiveStallTimer(keepPosition = false)
        val preferredUrl = PlaybackIntelligence.preferredUrl(appContext, profile, contentKind, url)
        fallbackState.begin(preferredUrl, fallbackUrl, listOf(url) + fallbackUrls)
        firstFrameRecorded = false
        playStartedAtMs = SystemClock.elapsedRealtime()
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, preferredUrl)
        val item = mediaItem(preferredUrl)
        player.setMediaItem(item)
        player.prepare()
        if (resumeMs > 0L) player.seekTo(resumeMs)
        player.playWhenReady = true
        if (contentKind.isLiveContent()) retryHandler.postDelayed(liveStallWatchdog, LIVE_STALL_WATCHDOG_INTERVAL_MS)
    }

    fun retrySameUrl() {
        if (closing) return
        val item = player.currentMediaItem ?: return
        val position = player.currentPosition.coerceAtLeast(0L)
        resetLiveStallTimer(keepPosition = false)
        playStartedAtMs = SystemClock.elapsedRealtime()
        player.stop()
        player.setMediaItem(item)
        player.prepare()
        if (!contentKind.isLiveContent() && position > 0L) player.seekTo(position)
        player.playWhenReady = true
    }

    private fun scheduleSeekRecovery(targetMs: Long) {
        val generation = ++seekRecoveryGeneration
        retryHandler.postDelayed({
            if (closing || generation != seekRecoveryGeneration || contentKind.isLiveContent()) return@postDelayed
            if (player.currentMediaItem == null || !player.playWhenReady) return@postDelayed
            if (player.playbackState == Player.STATE_BUFFERING) {
                automaticRetries = 0
                retrySameUrl()
            }
        }, SEEK_STALL_RECOVERY_MS)
    }

    private fun checkLiveStall() {
        if (closing) return
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
        val positionAdvanced = lastObservedLivePositionMs != Long.MIN_VALUE &&
            position - lastObservedLivePositionMs >= LIVE_MIN_POSITION_ADVANCE_MS
        val silentlyStalled = player.playbackState == Player.STATE_BUFFERING ||
            (player.playbackState == Player.STATE_READY && !positionAdvanced)

        if (!silentlyStalled) {
            resetLiveStallTimer(keepPosition = true)
            lastObservedLivePositionMs = position
            return
        }

        if (lastObservedLivePositionMs == Long.MIN_VALUE) {
            lastObservedLivePositionMs = position
            liveStallStartedAtMs = now
            return
        }
        if (positionAdvanced) {
            lastObservedLivePositionMs = position
            liveStallStartedAtMs = 0L
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
            val configuredFallback = fallbackState.nextConfiguredUrl()
            if (configuredFallback != null) {
                // A hidden/public-looking provider alias can hang in buffering without producing
                // onPlayerError. Reuse the already configured provider-origin fallback here rather
                // than retrying the same dead origin and leaving the TV on a black screen.
                fallbackState.markConfiguredUrlAttempted(configuredFallback)
                playInternalFallback(configuredFallback)
            } else {
                retrySameUrl()
            }
        }
    }

    private fun resetLiveStallTimer(keepPosition: Boolean) {
        liveStallStartedAtMs = 0L
        if (!keepPosition) lastObservedLivePositionMs = Long.MIN_VALUE
    }

    private fun playInternalFallback(url: String) {
        if (closing) return
        fallbackState.markUrlAttempted(url)
        automaticRetries = MAX_AUTOMATIC_RETRIES
        // A new route needs its own stall window, not the old host's one-minute cooldown.
        lastLiveStallRecoveryAtMs = 0L
        firstFrameRecorded = false
        playStartedAtMs = SystemClock.elapsedRealtime()
        resetLiveStallTimer(keepPosition = false)
        metric = PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        prepareFallbackItem(player, mediaItem(url), contentKind.isLiveContent())
    }

    private fun mediaItem(url: String): MediaItem = MediaItem.Builder()
        .setUri(url)
        .apply {
            if (PlaybackMediaTypePolicy.shouldHintHls(contentKind, profile.liveFormat, url)) {
                setMimeType(MimeTypes.APPLICATION_M3U8)
            }
        }
        .build()

    fun isStarted(): Boolean = !closing && player.playbackState == Player.STATE_READY && player.playWhenReady

    fun release(detachOutput: () -> Unit = {}) {
        if (closing) return
        closing = true
        seekRecoveryGeneration++
        retryHandler.removeCallbacksAndMessages(null)
        try {
            detachOutput()
        } finally {
            try { player.release() }
            finally { retryHandler.removeCallbacksAndMessages(null) }
        }
    }

    private companion object {
        const val MAX_AUTOMATIC_RETRIES = 1
        const val SEEK_STALL_RECOVERY_MS = 8_000L
        const val LIVE_STALL_WATCHDOG_INTERVAL_MS = 4_000L
        const val LIVE_STALL_RECOVERY_THRESHOLD_MS = 12_000L
        const val LIVE_STALL_RECOVERY_COOLDOWN_MS = 60_000L
        const val LIVE_MIN_POSITION_ADVANCE_MS = 1_000L
        const val MAX_LIVE_STALL_RECOVERIES_PER_ITEM = 3
    }

    private fun String.isLiveContent(): Boolean = this == "live" || this == "live_preview"
}

@OptIn(markerClass = [UnstableApi::class])
private fun createPlaybackPlayer(context: Context, profile: ProviderProfile): ExoPlayer =
    ExoPlayer.Builder(context)
        .setRenderersFactory(DefaultRenderersFactory(context)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER))
        .setMediaSourceFactory(DefaultMediaSourceFactory(TransportFactory.create(context, profile)))
        .build()

@OptIn(markerClass = [UnstableApi::class])
internal fun prepareFallbackItem(player: Player, item: MediaItem, live: Boolean) {
    val resumeMs = if (live) 0L else player.currentPosition.coerceAtLeast(0L)
    player.stop()
    player.setMediaItem(item)
    player.prepare()
    if (resumeMs > 0L) player.seekTo(resumeMs)
    player.playWhenReady = true
}
