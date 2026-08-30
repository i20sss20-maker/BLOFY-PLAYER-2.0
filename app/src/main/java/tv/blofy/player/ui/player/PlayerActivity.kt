package tv.blofy.player.ui.player

import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.remote.RemoteAction
import tv.blofy.player.core.remote.RemoteKeyRouter
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase

@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {
    private lateinit var session: BlofyPlaybackSession
    private lateinit var playerView: PlayerView

    private val contentKey by lazy { intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty() }
    private val providerId by lazy { intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty() }
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        if (url.isBlank()) {
            finish()
            return
        }

        val profile = ProviderProfile(
            providerKey = providerId.ifBlank { "default" },
            liveFormat = if (intent.getStringExtra(EXTRA_LIVE_FORMAT) == "m3u8") LiveFormat.HLS else LiveFormat.TS
        )
        session = BlofyPlaybackSession(this, profile)
        playerView = PlayerView(this).apply {
            useController = true
            controllerAutoShow = false
            controllerHideOnTouch = true
            player = session.player
            isFocusable = true
            isFocusableInTouchMode = true
        }
        setContentView(
            playerView,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        playerView.requestFocus()
        session.play(url, intent.getLongExtra(EXTRA_RESUME_MS, 0L))
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val routed = RemoteKeyRouter.route(event)
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        return when (routed.action) {
            RemoteAction.BACK -> {
                finish(); true
            }
            RemoteAction.PLAY_PAUSE -> {
                if (session.player.isPlaying) session.player.pause() else session.player.play(); true
            }
            RemoteAction.FAST_FORWARD -> {
                session.player.seekTo(session.player.currentPosition + 10_000L); true
            }
            RemoteAction.REWIND -> {
                session.player.seekTo((session.player.currentPosition - 10_000L).coerceAtLeast(0L)); true
            }
            RemoteAction.OK -> {
                if (playerView.isControllerFullyVisible) playerView.hideController() else playerView.showController(); true
            }
            else -> super.dispatchKeyEvent(event)
        }
    }

    override fun onStop() {
        saveResume()
        super.onStop()
    }

    override fun onDestroy() {
        if (::session.isInitialized) session.release()
        super.onDestroy()
    }

    private fun saveResume() {
        if (contentKey.isBlank() || providerId.isBlank() || !::session.isInitialized) return
        val position = session.player.currentPosition.coerceAtLeast(0L)
        val duration = session.player.duration.coerceAtLeast(0L)
        lifecycleScope.launch(Dispatchers.IO) {
            ContentRepository(BlofyDatabase.get(applicationContext).dao())
                .saveResume(contentKey, providerId, kind, position, duration)
        }
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_CONTENT_KEY = "content_key"
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_KIND = "kind"
        const val EXTRA_LIVE_FORMAT = "live_format"
        const val EXTRA_RESUME_MS = "resume_ms"
    }
}
