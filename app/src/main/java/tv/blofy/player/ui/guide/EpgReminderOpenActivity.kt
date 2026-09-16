package tv.blofy.player.ui.guide

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.local.BlofyDatabase

/**
 * Resolves an EPG reminder back to the server it was created from before opening the guide.
 * If that server was deleted, the guide still opens safely without applying stale stream/category IDs.
 */
class EpgReminderOpenActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
            val targetAvailable = if (providerId.isBlank()) {
                true
            } else {
                withContext(Dispatchers.IO) {
                    runCatching {
                        val dao = BlofyDatabase.get(applicationContext).dao()
                        if (dao.provider(providerId) == null) return@runCatching false
                        dao.activateExistingProvider(providerId)
                        true
                    }.getOrDefault(false)
                }
            }

            startActivity(Intent(this@EpgReminderOpenActivity, LiveGuideActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                if (targetAvailable) {
                    intent.getStringExtra(EXTRA_STREAM_ID)?.takeIf(String::isNotBlank)?.let {
                        putExtra(LiveGuideActivity.EXTRA_STREAM_ID, it)
                    }
                    intent.getStringExtra(EXTRA_CATEGORY_ID)?.takeIf(String::isNotBlank)?.let {
                        putExtra(LiveGuideActivity.EXTRA_CATEGORY_ID, it)
                    }
                }
            })
            finish()
        }
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_STREAM_ID = "stream_id"
        const val EXTRA_CATEGORY_ID = "category_id"
    }
}
