package tv.blofy.player.ui.settings

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.os.Bundle
import android.util.TypedValue
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import tv.blofy.player.R
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.ui.player.PlayerActivity
import java.util.WeakHashMap

/**
 * Applies presentation/interaction preferences around the existing player session.
 * It deliberately does not replace the playback engine, URL resolver or fallback routing.
 */
@OptIn(markerClass = [UnstableApi::class])
class RuntimeSettingsLifecycle : Application.ActivityLifecycleCallbacks {
    private val listeners = WeakHashMap<PlayerActivity, Player.Listener>()

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is PlayerActivity) apply(activity)
    }

    override fun onActivityResumed(activity: Activity) {
        if (activity is PlayerActivity) apply(activity)
    }

    private fun apply(activity: PlayerActivity) {
        val playerView = field<PlayerView>(activity, "playerView")
        if (playerView != null) {
            playerView.resizeMode = RuntimeSettings.aspectResizeMode(activity)
            playerView.subtitleView?.setFixedTextSize(
                TypedValue.COMPLEX_UNIT_SP,
                RuntimeSettings.subtitleSizeSp(activity)
            )
        }

        val session = field<BlofyPlaybackSession>(activity, "session") ?: return
        val player = session.player
        val builder = player.trackSelectionParameters.buildUpon()
        when (RuntimeSettings.subtitleLanguage(activity)) {
            RuntimeSettings.SubtitleLanguage.OFF -> builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            RuntimeSettings.SubtitleLanguage.AUTO -> builder
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setPreferredTextLanguage(null)
            RuntimeSettings.SubtitleLanguage.ARABIC_FIRST -> builder
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setPreferredTextLanguage("ar")
        }
        builder.setMaxAudioChannelCount(
            if (RuntimeSettings.preferStereoTrack(activity)) 2 else Int.MAX_VALUE
        )
        player.trackSelectionParameters = builder.build()

        if (activity.intent.getStringExtra(PlayerActivity.EXTRA_KIND) != KIND_EPISODE) return
        val mode = RuntimeSettings.autoNext(activity)
        listeners.remove(activity)?.let(player::removeListener)
        if (mode == RuntimeSettings.AutoNext.ON) {
            setBooleanField(activity, "autoNextTriggered", false)
            return
        }

        // PlayerActivity's existing ended callback remains the ON implementation. Holding this
        // flag true suppresses it for ASK/OFF without touching session/player routing.
        setBooleanField(activity, "autoNextTriggered", true)
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (activity.isFinishing) return
                if (playbackState != Player.STATE_ENDED) {
                    // Manual previous/next plays inside the same Activity and resets the private
                    // guard. Reassert the user's ASK/OFF choice for the newly started episode.
                    setBooleanField(activity, "autoNextTriggered", true)
                    return
                }
                if (mode != RuntimeSettings.AutoNext.ASK) return
                AlertDialog.Builder(activity)
                    .setTitle(activity.getString(R.string.next_episode_title))
                    .setMessage(activity.getString(R.string.next_episode_message))
                    .setPositiveButton(activity.getString(R.string.next_episode_play)) { _, _ ->
                        invokeAdjacentEpisode(activity)
                    }
                    .setNegativeButton(activity.getString(R.string.next_episode_not_now), null)
                    .show()
            }
        }
        listeners[activity] = listener
        player.addListener(listener)
    }

    private fun invokeAdjacentEpisode(activity: PlayerActivity) {
        runCatching {
            val method = PlayerActivity::class.java.getDeclaredMethod(
                "playAdjacentEpisode",
                Int::class.javaPrimitiveType,
                Boolean::class.javaPrimitiveType
            )
            method.isAccessible = true
            method.invoke(activity, 1, true)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> field(activity: PlayerActivity, name: String): T? = runCatching {
        PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity) as? T
    }.getOrNull()

    private fun setBooleanField(activity: PlayerActivity, name: String, value: Boolean) {
        runCatching {
            PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.setBoolean(activity, value)
        }
    }

    override fun onActivityDestroyed(activity: Activity) {
        if (activity !is PlayerActivity) return
        val listener = listeners.remove(activity) ?: return
        field<BlofyPlaybackSession>(activity, "session")?.player?.removeListener(listener)
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    companion object { private const val KIND_EPISODE = "episode" }
}
