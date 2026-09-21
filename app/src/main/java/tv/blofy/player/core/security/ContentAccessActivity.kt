package tv.blofy.player.core.security

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle

/** Non-exported content destinations must authorize before loading details or creating a player. */
abstract class ContentAccessActivity : AppCompatActivity() {
    protected val contentAccess by lazy { ContentAccessGate(this) }
    protected var contentReady = false
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        var synchronous = true
        contentAccess.requireAccess(
            providerId = intent.getStringExtra("provider_id").orEmpty(),
            contentKey = savedInstanceState?.getString("content_key") ?: intent.getStringExtra("content_key").orEmpty(),
            seriesId = intent.getStringExtra("series_id").orEmpty(),
            transferToken = intent.getStringExtra(ContentAccessGate.EXTRA_TRANSFER),
            onDenied = { finish() }
        ) {
            if (isFinishing || isDestroyed) return@requireAccess
            // An async PIN/query result must not start playback after the owner has left the screen.
            if (!synchronous && !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) { finish(); return@requireAccess }
            contentReady = true
            onContentReady(savedInstanceState)
        }
        synchronous = false
        intent.removeExtra(ContentAccessGate.EXTRA_TRANSFER)
    }

    protected abstract fun onContentReady(savedInstanceState: Bundle?)

    override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
        contentAccess.forwardTo(intent)
        super.startActivityForResult(intent, requestCode, options)
    }
}
