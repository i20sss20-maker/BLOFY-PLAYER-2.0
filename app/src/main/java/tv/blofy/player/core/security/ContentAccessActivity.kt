package tv.blofy.player.core.security

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import tv.blofy.player.core.profile.ProfileStore

/** Non-exported content destinations must authorize before loading details or creating a player. */
abstract class ContentAccessActivity : AppCompatActivity() {
    protected val contentAccess by lazy { ContentAccessGate(this) }
    protected var contentReady = false
        private set
    private var accessScope: Triple<String, Boolean, String?>? = null

    private fun currentScope() = ProfileStore.active(this).let {
        Triple(it.id, it.kids, ParentalGate.credentialVersion(this))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        var synchronous = true
        contentAccess.requireAccess(
            providerId = intent.getStringExtra("provider_id").orEmpty(),
            contentKey = savedInstanceState?.getString("content_key") ?: intent.getStringExtra("content_key").orEmpty(),
            seriesId = intent.getStringExtra("series_id").orEmpty(),
            transferToken = intent.getStringExtra(ContentAccessGate.EXTRA_TRANSFER),
            onDenied = { onContentAccessDenied() }
        ) {
            if (isFinishing || isDestroyed) return@requireAccess
            // An async PIN/query result must not start playback after the owner has left the screen.
            if (!synchronous && !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) { onContentAccessDenied(); return@requireAccess }
            contentReady = true
            accessScope = currentScope()
            onContentReady(savedInstanceState)
        }
        synchronous = false
        intent.removeExtra(ContentAccessGate.EXTRA_TRANSFER)
    }

    protected abstract fun onContentReady(savedInstanceState: Bundle?)
    protected open fun onContentAccessDenied() { finish() }

    override fun onStart() {
        super.onStart()
        // Returning from profile/PIN settings must not revive a previously authorized player.
        if (contentReady && accessScope != currentScope()) {
            contentAccess.cancel()
            window.decorView.visibility = android.view.View.INVISIBLE
            onContentAccessDenied()
        }
    }

    override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
        contentAccess.forwardTo(intent)
        super.startActivityForResult(intent, requestCode, options)
    }
}
