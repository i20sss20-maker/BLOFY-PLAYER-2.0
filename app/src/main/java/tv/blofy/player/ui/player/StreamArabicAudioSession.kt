package tv.blofy.player.ui.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import tv.blofy.player.core.network.TransportFactory
import tv.blofy.player.core.provider.ProviderProfile

/**
 * Optional second AUDIO-ONLY player for BLOFY-supplied live Arabic audio.
 *
 * The original video session is never replaced. The companion is opened with
 * the same protected STREAM transport and is allowed to mute original audio
 * only after the companion has started. On error, channel change or teardown,
 * the main audio is restored. No stream URLs or activation tokens are logged.
 *
 * The initial live edges must be aligned by the BLOFY server. A non-DVR live
 * source cannot seek into the future: "advance" reduces an existing delay.
 * When the sidecar is not seekable it briefly accelerates buffered audio.
 */
@OptIn(markerClass = [UnstableApi::class])
internal class StreamArabicAudioSession(
    context: Context,
    private val video: ExoPlayer,
    private val profile: ProviderProfile,
    private val onFailure: (FailureReason) -> Unit,
    private val onStarted: () -> Unit = {}
) {
    enum class FailureReason { UNSUPPORTED_FORMAT, SOURCE_UNAVAILABLE, ACCESS_DENIED, BUSY, TIMEOUT, ENDED, NETWORK }

    private fun classify(error: PlaybackException): FailureReason {
        var cause: Throwable? = error.cause
        repeat(8) {
            if (cause is HttpDataSource.InvalidResponseCodeException) {
                return when ((cause as HttpDataSource.InvalidResponseCodeException).responseCode) {
                    415 -> FailureReason.UNSUPPORTED_FORMAT
                    401, 403 -> FailureReason.ACCESS_DENIED
                    429 -> FailureReason.BUSY
                    500, 502, 503, 504 -> FailureReason.SOURCE_UNAVAILABLE
                    else -> FailureReason.NETWORK
                }
            }
            cause = cause?.cause
        }
        return FailureReason.NETWORK
    }

    private val appContext = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val stallHandler = Handler(Looper.getMainLooper())
    private var audio: ExoPlayer? = null
    private var track: StreamArabicAudioCatalog.Track? = null
    private var originalVolume = 1f
    private var delay = 0
    private var started = false
    private var waiting = false
    private var holdPending = false
    private var catchUpPendingMs = 0L
    private var pendingHoldMs = 0L
    private var generation = 0
    private var playbackAnnounced = false
    private var invalidAudioRetries = 0
    private var effectiveDelayMs = 0.0
    private var syncRate = 1f
    private var syncRateSinceMs = 0L
    private val startupHandler = Handler(Looper.getMainLooper())

    val isActive: Boolean get() = audio != null && track != null
    /** A track can be selected while its media is still buffering. */
    val isAudible: Boolean get() = audio?.isPlaying == true
    val currentLabel: String? get() = track?.label
    val currentTrackId: String? get() = track?.id
    val delaySeconds: Int get() = delay

    fun start(item: StreamArabicAudioCatalog.Track) {
        stop()
        if (!StreamArabicAudioCatalog.playableUrl(item.playbackUrl)) return
        originalVolume = video.volume
        track = item
        delay = ArabicSidecarTimingPolicy.clamp(item.initialDelaySeconds)
        effectiveDelayMs = delay * 1000.0
        syncRate = 1f
        val version = ++generation
        playbackAnnounced = false
        invalidAudioRetries = 0
        // No STREAM authentication bearer ever leaves blofyplayer.com.
        // Personal in-app playlist URLs use a separate credential-free
        // transport. The main Xtream/video session remains unchanged.
        val upstream = if (StreamArabicAudioCatalog.trustedAudioUrl(item.playbackUrl)) {
            TransportFactory.create(appContext, profile)
        } else {
            DefaultDataSource.Factory(
                appContext,
                DefaultHttpDataSource.Factory()
                    .setUserAgent("BLOFY STREAM Audio/1.0")
                    .setAllowCrossProtocolRedirects(false)
                    .setConnectTimeoutMs(8_000)
                    .setReadTimeoutMs(15_000)
            )
        }
        val companion = ExoPlayer.Builder(appContext)
            .setRenderersFactory(DefaultRenderersFactory(appContext).setEnableDecoderFallback(true))
            .setMediaSourceFactory(DefaultMediaSourceFactory(upstream))
            .build()
        audio = companion
        companion.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .build(),
            false // The existing fullscreen video session owns audio focus.
        )
        companion.trackSelectionParameters = companion.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .build()
        companion.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (version != generation) return
                when (playbackState) {
                    Player.STATE_READY -> {
                        stallHandler.removeCallbacksAndMessages(null)
                        onPrimaryPlaybackChanged()
                    }
                    Player.STATE_BUFFERING -> scheduleOriginalAudioOnStall(version)
                    Player.STATE_ENDED -> failAndRestore(FailureReason.ENDED)
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (version != generation) return
                // Do not rapidly toggle back to the foreign track during a
                // deliberate audio offset hold; leave the video muted.
                if (isPlaying) {
                    stallHandler.removeCallbacksAndMessages(null)
                    video.volume = 0f
                    startupHandler.removeCallbacksAndMessages(null)
                    if (!playbackAnnounced) {
                        playbackAnnounced = true
                        onStarted()
                    }
                } else if (!started) {
                    video.volume = originalVolume
                } else {
                    scheduleOriginalAudioOnStall(version)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (version != generation) return
                val reason = classify(error)
                // The protected upstream can transiently return HTML or
                // another non-audio body (HTTP 415 from our own relay).
                // Retry only ONCE without spinning or changing the video.
                // Persistent 415 is a source problem and must be surfaced.
                if (reason == FailureReason.UNSUPPORTED_FORMAT &&
                    StreamAudioRetryPolicy.shouldRetryInvalidAudio(invalidAudioRetries)) {
                    invalidAudioRetries++
                    video.volume = originalVolume
                    started = false
                    waiting = false
                    holdPending = false
                    handler.removeCallbacksAndMessages(null)
                    stallHandler.removeCallbacksAndMessages(null)
                    companion.playWhenReady = false
                    companion.stop()
                    handler.postDelayed({
                        if (version == generation && audio === companion) {
                            companion.prepare()
                            onPrimaryPlaybackChanged()
                        }
                    }, StreamAudioRetryPolicy.RETRY_DELAY_MS)
                } else {
                    failAndRestore(reason)
                }
            }
        })
        companion.setMediaItem(
            MediaItem.Builder().setUri(item.playbackUrl).apply {
                if (item.format == "hls") setMimeType(MimeTypes.APPLICATION_M3U8)
            }.build()
        )
        companion.prepare()
        companion.playWhenReady = false
        // No infinite spinner: a selected station that never becomes audible
        // must fail cleanly, leaving the original channel's audio intact.
        startupHandler.postDelayed({
            if (version == generation && !companion.isPlaying)
                failAndRestore(FailureReason.TIMEOUT)
        }, 18_000L + delay * 1_000L)
        onPrimaryPlaybackChanged()
    }

    private fun scheduleOriginalAudioOnStall(version: Int) {
        stallHandler.removeCallbacksAndMessages(null)
        stallHandler.postDelayed({
            val companion = audio
            // Avoid leaving a customer with silence when the commentary
            // buffers or the remote radio is unavailable, but do not unmute
            // during a deliberate +1 second synchronization hold.
            if (version == generation && started &&
                video.playWhenReady && companion != null && !companion.isPlaying
            ) video.volume = originalVolume
        }, 2_500L)
        // A previously audible sidecar must not remain selected forever if
        // its decoder is starved. Do not tear down while the main video is paused.
        stallHandler.postDelayed({
            val companion = audio
            if (version == generation && started && playbackAnnounced &&
                video.playWhenReady && video.playbackState == Player.STATE_READY &&
                companion != null && companion.playbackState == Player.STATE_BUFFERING &&
                !companion.isPlaying) failAndRestore(FailureReason.TIMEOUT)
        }, 18_000L)
    }

    fun onPrimaryPlaybackChanged() {
        val companion = audio ?: return
        val videoPlaying = video.playWhenReady && video.playbackState == Player.STATE_READY
        if (!videoPlaying) {
            companion.playWhenReady = false
            if (waiting) {
                waiting = false
                handler.removeCallbacksAndMessages(null)
            }
            if (syncRate != 1f) {
                settleSyncClock()
                syncRate = 1f
                companion.playbackParameters = PlaybackParameters(1f)
                handler.removeCallbacksAndMessages(null)
            }
            return
        }
        if (companion.playbackState != Player.STATE_READY) return
        if (!started) {
            if (waiting) return
            waiting = true
            val version = generation
            handler.postDelayed({
                if (version != generation) return@postDelayed
                waiting = false
                if (video.playWhenReady && video.playbackState == Player.STATE_READY) {
                    started = true
                    companion.playWhenReady = true
                }
            }, delay * 1_000L)
        } else {
            companion.playWhenReady = true
            if (syncRate == 1f &&
                kotlin.math.abs(delay * 1000.0 - effectiveDelayMs) > 150.0) {
                scheduleLiveSync(companion)
            }
        }
    }

    /** Estimate accumulated live offset while time-stretching the audio. */
    private fun settleSyncClock() {
        if (syncRate == 1f) return
        val now = SystemClock.elapsedRealtime()
        val elapsed = (now - syncRateSinceMs).coerceAtLeast(0L)
        effectiveDelayMs = ArabicSidecarTimingPolicy.estimatedOffsetMs(
            effectiveDelayMs, elapsed, syncRate
        )
        syncRateSinceMs = now
    }

    private fun scheduleLiveSync(companion: ExoPlayer) {
        settleSyncClock()
        val targetMs = delay * 1000.0
        val gapMs = targetMs - effectiveDelayMs
        handler.removeCallbacksAndMessages(null)
        val version = generation
        if (kotlin.math.abs(gapMs) < 150.0) {
            effectiveDelayMs = targetMs
            syncRate = 1f
            companion.playbackParameters = PlaybackParameters(1f)
            return
        }
        // DVR/seekable tracks can rewind audio immediately.
        val desiredPosition = companion.currentPosition - gapMs.toLong()
        if (companion.isCurrentMediaItemSeekable && desiredPosition >= 0L) {
            syncRate = 1f
            companion.playbackParameters = PlaybackParameters(1f)
            companion.seekTo(desiredPosition)
            effectiveDelayMs = targetMs
            return
        }
        // Non-seekable live radio cannot seek backward. The former
        // playWhenReady=false hold could resume at the live edge and erase
        // the requested delay. Slow it temporarily instead, retaining
        // continuous commentary while accumulating buffered lag.
        val rate = if (gapMs > 0.0) ArabicSidecarTimingPolicy.SLOW_DOWN_RATE
            else ArabicSidecarTimingPolicy.FAST_FORWARD_RATE
        syncRate = rate
        syncRateSinceMs = SystemClock.elapsedRealtime()
        companion.playbackParameters = PlaybackParameters(rate)
        val durationMs = ArabicSidecarTimingPolicy.wallTimeToSyncMs(gapMs, rate)
        handler.postDelayed({
            if (version != generation || audio !== companion) return@postDelayed
            settleSyncClock()
            effectiveDelayMs = targetMs
            syncRate = 1f
            companion.playbackParameters = PlaybackParameters(1f)
        }, durationMs)
    }

    /** + delays the voice; - advances it. Never seek a live-only feed into the future. */
    fun adjustDelay(deltaSeconds: Int): Boolean {
        val companion = audio ?: return false
        val next = ArabicSidecarTimingPolicy.adjust(delay, deltaSeconds)
        if (next == delay) return false
        delay = next
        if (!started) {
            effectiveDelayMs = delay * 1000.0
            if (waiting) {
                handler.removeCallbacksAndMessages(null)
                waiting = false
                onPrimaryPlaybackChanged()
            }
            return true
        }
        if (video.playWhenReady && video.playbackState == Player.STATE_READY) {
            scheduleLiveSync(companion)
        } else {
            settleSyncClock()
            syncRate = 1f
            companion.playbackParameters = PlaybackParameters(1f)
            handler.removeCallbacksAndMessages(null)
        }
        return true
    }

    fun resetDelay() {
        adjustDelay(-delay)
    }

    private fun failAndRestore(reason: FailureReason) {
        stop()
        onFailure(reason)
    }

    fun stop() {
        generation++
        handler.removeCallbacksAndMessages(null)
        stallHandler.removeCallbacksAndMessages(null)
        startupHandler.removeCallbacksAndMessages(null)
        audio?.let {
            it.playWhenReady = false
            it.release()
        }
        if (track != null) video.volume = originalVolume
        audio = null
        track = null
        started = false
        playbackAnnounced = false
        invalidAudioRetries = 0
        waiting = false
        holdPending = false
        pendingHoldMs = 0L
        catchUpPendingMs = 0L
        effectiveDelayMs = 0.0
        syncRate = 1f
        syncRateSinceMs = 0L
        delay = 0
    }
}
