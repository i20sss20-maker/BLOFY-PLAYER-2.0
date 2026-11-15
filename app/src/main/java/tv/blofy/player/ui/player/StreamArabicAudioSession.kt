package tv.blofy.player.ui.player

import android.content.Context
import android.os.Handler
import android.os.Looper
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
    private val onFailure: () -> Unit
) {
    private val appContext = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
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

    val isActive: Boolean get() = audio != null && track != null
    val currentLabel: String? get() = track?.label
    val delaySeconds: Int get() = delay

    fun start(item: StreamArabicAudioCatalog.Track) {
        stop()
        if (!StreamArabicAudioCatalog.trustedAudioUrl(item.playbackUrl)) return
        originalVolume = video.volume
        track = item
        delay = ArabicSidecarTimingPolicy.clamp(item.initialDelaySeconds)
        val version = ++generation
        val companion = ExoPlayer.Builder(appContext)
            .setRenderersFactory(DefaultRenderersFactory(appContext).setEnableDecoderFallback(true))
            .setMediaSourceFactory(DefaultMediaSourceFactory(TransportFactory.create(appContext, profile)))
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
                if (playbackState == Player.STATE_READY) onPrimaryPlaybackChanged()
                if (playbackState == Player.STATE_ENDED) failAndRestore()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (version != generation) return
                // Do not rapidly toggle back to the foreign track during a
                // deliberate audio offset hold; leave the video muted.
                if (isPlaying) video.volume = 0f
                else if (!started) video.volume = originalVolume
            }

            override fun onPlayerError(error: PlaybackException) {
                if (version == generation) failAndRestore()
            }
        })
        companion.setMediaItem(
            MediaItem.Builder().setUri(item.playbackUrl).apply {
                if (item.format == "hls") setMimeType(MimeTypes.APPLICATION_M3U8)
            }.build()
        )
        companion.prepare()
        companion.playWhenReady = false
        onPrimaryPlaybackChanged()
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
        } else if (!holdPending) {
            companion.playWhenReady = true
        }
    }

    /** deltaSeconds > 0 delays Arabic more; < 0 advances within current delay. */
    fun adjustDelay(deltaSeconds: Int): Boolean {
        val companion = audio ?: return false
        val next = ArabicSidecarTimingPolicy.adjust(delay, deltaSeconds)
        if (next == delay) return false
        val previous = delay
        delay = next
        if (!started) {
            if (waiting) {
                handler.removeCallbacksAndMessages(null)
                waiting = false
                onPrimaryPlaybackChanged()
            }
            return true
        }
        val change = next - previous
        if (change > 0) {
            // Holding audio creates a reproducible added delay, regardless of
            // whether this live endpoint has a seekable DVR window.
            catchUpPendingMs = 0L
            pendingHoldMs += change * 1_000L
            companion.playbackParameters = PlaybackParameters(1f)
            companion.playWhenReady = false
            holdPending = true
            val version = generation
            handler.removeCallbacksAndMessages(null)
            handler.postDelayed({
                if (version != generation) return@postDelayed
                pendingHoldMs = 0L
                holdPending = false
                onPrimaryPlaybackChanged()
            }, pendingHoldMs)
        } else {
            // First finish an intentional delay hold when appropriate.
            val advanceMs = -change * 1_000L
            if (holdPending) {
                pendingHoldMs = (pendingHoldMs - advanceMs).coerceAtLeast(0L)
                handler.removeCallbacksAndMessages(null)
                val version = generation
                handler.postDelayed({
                    if (version != generation) return@postDelayed
                    pendingHoldMs = 0L
                    holdPending = false
                    onPrimaryPlaybackChanged()
                }, pendingHoldMs)
            } else if (companion.isCurrentMediaItemSeekable) {
                companion.seekTo(companion.currentPosition + advanceMs)
            } else {
                // Do not seek to an impossible future timestamp on live TS.
                // A bounded speed-up drains already-buffered delayed audio.
                catchUpPendingMs = (catchUpPendingMs + advanceMs)
                    .coerceAtMost(30_000L)
                companion.playbackParameters =
                    PlaybackParameters(ArabicSidecarTimingPolicy.FAST_FORWARD_RATE)
                val version = generation
                handler.removeCallbacksAndMessages(null)
                handler.postDelayed({
                    if (version != generation) return@postDelayed
                    catchUpPendingMs = 0L
                    companion.playbackParameters = PlaybackParameters(1f)
                }, ArabicSidecarTimingPolicy.catchUpWallTimeMs(
                    (catchUpPendingMs / 1000).toInt()
                ))
            }
        }
        return true
    }

    fun resetDelay() {
        adjustDelay(-delay)
    }

    private fun failAndRestore() {
        stop()
        onFailure()
    }

    fun stop() {
        generation++
        handler.removeCallbacksAndMessages(null)
        audio?.let {
            it.playWhenReady = false
            it.release()
        }
        if (track != null) video.volume = originalVolume
        audio = null
        track = null
        started = false
        waiting = false
        holdPending = false
        pendingHoldMs = 0L
        catchUpPendingMs = 0L
        delay = 0
    }
}
