package tv.blofy.player.core.playback

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import tv.blofy.player.core.network.TransportFactory
import tv.blofy.player.core.provider.ProviderProfile

class BlofyPlaybackSession(
    context: Context,
    private val profile: ProviderProfile
) {
    val player: ExoPlayer = ExoPlayer.Builder(context.applicationContext)
        .setMediaSourceFactory(
            DefaultMediaSourceFactory(
                TransportFactory.create(context.applicationContext, profile)
            )
        )
        .build()
        .apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                true
            )
        }

    fun play(url: String, resumeMs: Long = 0L) {
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

    fun release() = player.release()
}
