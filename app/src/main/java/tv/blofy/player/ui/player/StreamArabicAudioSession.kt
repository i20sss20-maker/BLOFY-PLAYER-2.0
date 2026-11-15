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
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
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
    private val onFailure: () -> Unit,
    private val onStarted: () -> Unit = {}
) {
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
        val version = ++generation
        playbackAnnounced = false
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
                    Player.STATE_ENDED -> failAndRestore()
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
                } else if (!holdPending) {
                    scheduleOriginalAudioOnStall(version)
                }
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
        // No infinite spinner: a selected station that never becomes audible
        // must fail cleanly, leaving the original channel's audio intact.
        startupHandler.postDelayed({
            if (version == generation && !companion.isPlaying) failAndRestore()
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
            if (version == generation && started && !holdPending &&
                video.playWhenReady && companion != null && !companion.isPlaying
            ) video.volume = originalVolume
        }, 2_500L)
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
        waiting = false
        holdPending = false
        pendingHoldMs = 0L
        catchUpPendingMs = 0L
        delay = 0
    }
}
