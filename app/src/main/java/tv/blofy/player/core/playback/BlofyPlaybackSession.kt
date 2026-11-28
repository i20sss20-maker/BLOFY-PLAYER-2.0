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
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import tv.blofy.player.core.diagnostics.PlaybackDiagnostics
import tv.blofy.player.core.diagnostics.PlaybackDiagnosticsUploader
import tv.blofy.player.core.diagnostics.PlaybackMetric
import tv.blofy.player.core.diagnostics.PlaybackFailureDetails
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.StreamDeviceCompatibility
import tv.blofy.player.core.identity.StreamCodeSession
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
    private var resumeFallbackUrls: List<String> = emptyList()
    private var metric: PlaybackMetric? = null
    private var firstFrameRecorded = false
    private var playStartedAtMs = 0L
    private var automaticRetries = 0
    // Cap repeated reconnects even if a stream briefly renders a first frame
    // between disconnects. Reset only when switching content or after 60 sec.
    private var repeatedPlayerErrors = 0
    private var playerErrorWindowStartMs = 0L
    private var alternateLiveFormatAttempted = false
    private var ultraHdCompatibilityFallbackAttempted = false
    private var compatibilityTrackParameters: androidx.media3.common.TrackSelectionParameters? = null
    private var lastObservedLivePositionMs = Long.MIN_VALUE
    private var liveStallStartedAtMs = 0L
    private var lastLiveStallRecoveryAtMs = 0L
    private var liveStallRecoveries = 0
    private var noFirstFrameRecoveries = 0
    // HTTP 200 live relays can close cleanly after ~1 minute; this reaches
    // STATE_ENDED without onPlayerError. Track bounded same-channel recovery.
    private var liveQuickEnds = 0
    private var liveEndRecoveryPending = false
    private val codeLiveGateway = BuildConfig.CODE_ONLY_LOGIN &&
        profile.providerKey == StreamCodeSession.providerId && contentKind.isLiveContent()
    private var liveRecoveryGeneration = 0
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
                        metric?.let { metric = PlaybackDiagnostics.ready(it) }
                        resetLiveStallTimer(keepPosition = true)
                        if (!contentKind.isLiveContent()) seekRecoveryGeneration++
                    }
                    // A live TS response that ends cleanly is still LIVE content:
                    // Media3 reports ENDED, not a network error, and would leave
                    // the TV stopped until the viewer manually reopens the channel.
                    if (codeLiveGateway) {
                        if (playbackState == Player.STATE_ENDED) scheduleCodeLiveEndRecovery()
                    } else if (playbackState == Player.STATE_ENDED && contentKind.isLiveContent() &&
                        playWhenReady && currentMediaItem != null && !liveEndRecoveryPending) {
                        val elapsed = (SystemClock.elapsedRealtime() - playStartedAtMs).coerceAtLeast(0L)
                        val plan = LiveCleanEndRecoveryPolicy.next(elapsed, liveQuickEnds)
                        if (plan == null) {
                            val failedUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                            if (failedUrl.isNotBlank()) onTerminalError?.invoke(failedUrl)
                        } else {
                            liveQuickEnds = plan.quickEnds
                            liveEndRecoveryPending = true
                            val generation = liveRecoveryGeneration
                            val item = currentMediaItem
                            retryHandler.postDelayed({
                                if (!closing && generation == liveRecoveryGeneration &&
                                    currentMediaItem == item && playWhenReady) {
                                    liveEndRecoveryPending = false
                                    retrySameUrl()
                                }
                            }, plan.delayMs)
                        }
                    }
                }

                override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                    if (codeLiveGateway && playWhenReady) scheduleCodeLiveEndRecovery()
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
                    // Never attribute a surface-release error to the source.
                    if (closing) return
                    if (codeLiveGateway) {
                        liveRecoveryGeneration++
                        liveEndRecoveryPending = false
                    }
                    metric?.let {
                        val details = PlaybackFailureDetails.describe(error,
                            phase = if (closing) "release" else "playback",
                            videoFormat = videoFormat)
                        val updated = PlaybackDiagnostics.error(it, error.errorCodeName, details)
                        metric = updated
                        PlaybackDiagnosticsUploader.enqueue(appContext, updated)
                    }
                    if (!contentKind.isLiveContent() &&
                        !ultraHdCompatibilityFallbackAttempted &&
                        PlaybackFailureDetails.isUltraHdDecoderFailure(error, videoFormat)
                    ) {
                        ultraHdCompatibilityFallbackAttempted = true
                        compatibilityTrackParameters = player.trackSelectionParameters
                        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                            .setMaxVideoSize(1920, 1080)
                            .build()
                        automaticRetries = MAX_AUTOMATIC_RETRIES
                        retryHandler.post { retrySameUrl() }
                        return
                    }
                    val failedUrl = currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
                    if (failedUrl.isNotBlank()) {
                        PlaybackIntelligence.recordFailure(appContext, profile.providerKey, contentKind, failedUrl)
                    }
                    val now = SystemClock.elapsedRealtime()
                    val (windowStart, failures) = PlaybackRecoveryPolicy.failureWindowCount(
                        now, playerErrorWindowStartMs, repeatedPlayerErrors
                    )
                    playerErrorWindowStartMs = windowStart
                    repeatedPlayerErrors = failures
                    val delay = PlaybackRecoveryPolicy.delayForSameUrlRetry(
                        error.errorCode, PlaybackRecoveryPolicy.httpStatus(error),
                        automaticRetries, repeatedPlayerErrors
                    )
                    if (automaticRetries < MAX_AUTOMATIC_RETRIES && delay != null) {
                        automaticRetries++
                        retryHandler.postDelayed({ if (!closing) retrySameUrl() }, delay)
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

    // Retire a scheduled recovery even when the viewer paused or playback
    // recovered before the timer. An explicit resume can then recover EOF.
    private fun scheduleCodeLiveEndRecovery() {
        if (!codeLiveGateway || closing || !player.playWhenReady ||
            player.playbackState != Player.STATE_ENDED || player.currentMediaItem == null ||
            liveEndRecoveryPending) return
        val elapsed = (SystemClock.elapsedRealtime() - playStartedAtMs).coerceAtLeast(0L)
        val plan = LiveCleanEndRecoveryPolicy.next(elapsed, liveQuickEnds)
        if (plan == null) {
            val failedUrl = player.currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
            if (failedUrl.isNotBlank()) onTerminalError?.invoke(failedUrl)
            return
        }
        liveEndRecoveryPending = true
        val generation = liveRecoveryGeneration
        val item = player.currentMediaItem
        retryHandler.postDelayed({
            if (closing || generation != liveRecoveryGeneration) return@postDelayed
            liveEndRecoveryPending = false
            if (player.currentMediaItem != item || !player.playWhenReady ||
                player.playbackState != Player.STATE_ENDED) return@postDelayed
            liveQuickEnds = plan.quickEnds
            retrySameUrl()
        }, plan.delayMs)
    }

    fun play(url: String, resumeMs: Long = 0L, fallbackUrl: String? = null, fallbackUrls: List<String> = emptyList()) {
        if (closing) return
        retryHandler.removeCallbacksAndMessages(null)
        seekRecoveryGeneration++
        liveRecoveryGeneration++
        liveQuickEnds = 0
        liveEndRecoveryPending = false
        compatibilityTrackParameters?.let {
            player.trackSelectionParameters = it
            compatibilityTrackParameters = null
        }
        automaticRetries = 0
        repeatedPlayerErrors = 0
        playerErrorWindowStartMs = 0L
        alternateLiveFormatAttempted = false
        ultraHdCompatibilityFallbackAttempted = false
        liveStallRecoveries = 0
        noFirstFrameRecoveries = 0
        lastLiveStallRecoveryAtMs = 0L
        resetLiveStallTimer(keepPosition = false)
        val preferredUrl = PlaybackIntelligence.preferredUrl(appContext, profile, contentKind, url)
        resumeFallbackUrls = (listOf(url) + fallbackUrls + listOfNotNull(fallbackUrl)).distinct()
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

    fun retrySameUrl(resumePositionMs: Long? = null) {
        if (closing) return
        val item = player.currentMediaItem ?: return
        // Invalidate any delayed clean-EOF retry when a manual or error-driven
        // retry has already restarted this item.
        liveRecoveryGeneration++
        liveEndRecoveryPending = false
        // A stalled seek may report zero or the old position until buffering recovers.
        val position = (resumePositionMs ?: player.currentPosition).coerceAtLeast(0L)
        seekRecoveryGeneration++
        resetLiveStallTimer(keepPosition = false)
        playStartedAtMs = SystemClock.elapsedRealtime()
        metric?.let { metric = PlaybackDiagnostics.recovered(it) }
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
                retrySameUrl(targetMs)
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

        // READY alone does not prove that a video frame reached the screen.
        // Some Android TV decoders accept TS bytes yet show only a black surface.
        // Never recycle an audio-only channel, a paused session or a healthy
        // stream that has rendered even one frame. Cap recovery per channel.
        val hasVideoTrack = player.currentTracks.groups.any { it.type == C.TRACK_TYPE_VIDEO }
        if (player.playbackState == Player.STATE_READY &&
            !firstFrameRecorded && hasVideoTrack &&
            now - playStartedAtMs >= LIVE_FIRST_FRAME_TIMEOUT_MS &&
            noFirstFrameRecoveries < MAX_NO_FIRST_FRAME_RECOVERIES
        ) {
            noFirstFrameRecoveries++
            val route = fallbackState.nextConfiguredUrl()
            if (route != null) {
                fallbackState.markConfiguredUrlAttempted(route)
                playInternalFallback(route)
            } else {
                // Retry once: this also reattaches the decoder surface.
                retrySameUrl()
            }
            return
        }
        if (player.playbackState == Player.STATE_READY &&
            !firstFrameRecorded && hasVideoTrack &&
            now - playStartedAtMs >= LIVE_FIRST_FRAME_TIMEOUT_MS &&
            noFirstFrameRecoveries == MAX_NO_FIRST_FRAME_RECOVERIES
        ) {
            val failedUrl = player.currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
            if (failedUrl.isNotBlank()) onTerminalError?.invoke(failedUrl)
            // Avoid showing the same error overlay every watchdog tick.
            noFirstFrameRecoveries++
            return
        }

        // Some healthy live TS/HLS streams expose a flat or non-monotonic
        // currentPosition. READY is healthy playback and must never trigger
        // a timed recycle of the fullscreen session.
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
        liveRecoveryGeneration++
        liveEndRecoveryPending = false
        liveQuickEnds = 0
        fallbackState.markUrlAttempted(url)
        automaticRetries = MAX_AUTOMATIC_RETRIES
        // A new route needs its own stall window, not the old host's one-minute cooldown.
        lastLiveStallRecoveryAtMs = 0L
        firstFrameRecorded = false
        playStartedAtMs = SystemClock.elapsedRealtime()
        resetLiveStallTimer(keepPosition = false)
        metric?.let { PlaybackDiagnostics.finish(it) }
        metric = PlaybackDiagnostics.recovered(
            PlaybackDiagnostics.begin(profile.providerKey, contentKind, url)
        )
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

    fun usedUltraHdCompatibilityFallback(): Boolean = ultraHdCompatibilityFallbackAttempted

    /** In-memory state only: stream URLs must never be persisted to diagnostics or saved bundles. */
    fun resumeState(): PlaybackResumeState? {
        if (closing) return null
        val url = player.currentMediaItem?.localConfiguration?.uri?.toString() ?: return null
        return PlaybackResumeState(url,
            if (contentKind.isLiveContent()) 0L else player.currentPosition.coerceAtLeast(0L),
            player.playWhenReady, resumeFallbackUrls, player.trackSelectionParameters)
    }

    fun release(detachOutput: () -> Unit = {}) {
        if (closing) return
        closing = true
        liveRecoveryGeneration++
        liveEndRecoveryPending = false
        metric?.let { current ->
            val completed = PlaybackDiagnostics.finish(current)
            metric = completed
            // An opted-in final snapshot records interruptions that occur
            // after first frame, without continuously uploading while watching.
            if (completed.firstFrameElapsedMs != null &&
                (completed.rebufferCount > 0 || completed.recoveryCount > 0)) {
                PlaybackDiagnosticsUploader.enqueue(appContext, completed)
            }
        }
        seekRecoveryGeneration++
        retryHandler.removeCallbacksAndMessages(null)
        try {
            // release() removes Media3's surface callbacks. Clearing PlayerView afterwards
            // avoids a separate, blocking surface-detach timeout on a stalled decoder.
            player.release()
        } finally {
            try { detachOutput() }
            finally { retryHandler.removeCallbacksAndMessages(null) }
        }
    }

    private companion object {
        const val MAX_AUTOMATIC_RETRIES = 1
        const val SEEK_STALL_RECOVERY_MS = 8_000L
        const val LIVE_STALL_WATCHDOG_INTERVAL_MS = 4_000L
        const val LIVE_FIRST_FRAME_TIMEOUT_MS = 16_000L
        const val MAX_NO_FIRST_FRAME_RECOVERIES = 2
        const val LIVE_STALL_RECOVERY_THRESHOLD_MS = 12_000L
        const val LIVE_STALL_RECOVERY_COOLDOWN_MS = 60_000L
        const val MAX_LIVE_STALL_RECOVERIES_PER_ITEM = 3
    }

    private fun String.isLiveContent(): Boolean = this == "live" || this == "live_preview"
}

@OptIn(markerClass = [UnstableApi::class])
private fun createPlaybackPlayer(context: Context, profile: ProviderProfile): ExoPlayer {
    val builder = ExoPlayer.Builder(context)
        .setRenderersFactory(
            DefaultRenderersFactory(context)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
        )
        .setMediaSourceFactory(DefaultMediaSourceFactory(TransportFactory.create(context, profile)))
    if (BuildConfig.CODE_ONLY_LOGIN) {
        val device = StreamDeviceCompatibility.current(context)
        builder.setLoadControl(DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                device.playerMinBufferMs,
                device.playerMaxBufferMs,
                1_500,
                3_000
            )
            .setTargetBufferBytes(device.playerTargetBufferBytes)
            .build())
    }
    return builder.build()
}

@OptIn(markerClass = [UnstableApi::class])
internal fun prepareFallbackItem(player: Player, item: MediaItem, live: Boolean) {
    val resumeMs = if (live) 0L else player.currentPosition.coerceAtLeast(0L)
    player.stop()
    player.setMediaItem(item)
    player.prepare()
    if (resumeMs > 0L) player.seekTo(resumeMs)
    player.playWhenReady = true
}
