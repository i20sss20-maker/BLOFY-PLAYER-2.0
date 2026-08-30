package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.player.PlayerActivity

class LibraryActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FAVORITES
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 36, 48, 36)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = if (mode == MODE_CONTINUE) "متابعة المشاهدة" else "المفضلة"
            textSize = 28f
            setTextColor(Color.WHITE)
        })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        setContentView(root)
        load(mode)
    }

    private fun load(mode: String) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) {
                showMessage("أضف قائمة تشغيل أولاً")
                return@launch
            }
            if (mode == MODE_CONTINUE) {
                val states = withContext(Dispatchers.IO) { dao.continueWatching(provider.id).first() }
                val pairs = withContext(Dispatchers.IO) {
                    states.mapNotNull { state -> dao.stream(state.contentKey)?.let { it to state.positionMs } }
                }
                if (pairs.isEmpty()) showMessage("لا يوجد محتوى للاستئناف")
                pairs.forEach { (stream, resume) -> addRow(provider.id, provider.liveFormat, stream, resume) }
            } else {
                val favorites = withContext(Dispatchers.IO) { ContentRepository(dao).favorites(provider.id).first() }
                if (favorites.isEmpty()) showMessage("لا توجد عناصر في المفضلة")
                favorites.forEach { stream -> addRow(provider.id, provider.liveFormat, stream, 0L) }
            }
            list.getChildAt(0)?.requestFocus()
        }
    }

    private fun addRow(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        list.addView(TextView(this).apply {
            text = stream.name
            textSize = 19f
            setTextColor(Color.WHITE)
            setPadding(22, 18, 22, 18)
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            setOnClickListener { open(providerId, liveFormat, stream, resumeMs) }
        })
    }

    private fun open(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
            val profile = ProviderProfile(
                providerKey = provider.id,
                liveFormat = if (liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS
            )
            val url = when (stream.kind) {
                "live" -> ContentUrlResolver.live(provider, profile, stream)
                "movie" -> ContentUrlResolver.movie(provider, stream)
                else -> return@launch
            }
            startActivity(Intent(this@LibraryActivity, PlayerActivity::class.java).apply {
                putExtra(PlayerActivity.EXTRA_URL, url)
                putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(PlayerActivity.EXTRA_KIND, stream.kind)
                putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
            })
        }
    }

    private fun showMessage(text: String) {
        list.addView(TextView(this).apply {
            this.text = text
            textSize = 18f
            setTextColor(Color.LTGRAY)
            setPadding(0, 24, 0, 0)
        })
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_FAVORITES = "favorites"
        const val MODE_CONTINUE = "continue"
    }
}
