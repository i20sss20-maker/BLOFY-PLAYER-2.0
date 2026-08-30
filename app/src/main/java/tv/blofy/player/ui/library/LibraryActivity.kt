package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
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
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class LibraryActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FAVORITES
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(50, 38, 50, 38)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = if (mode == MODE_CONTINUE) "متابعة المشاهدة" else "المفضلة"
            textSize = 29f
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
            list.removeAllViews()
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
        val row = TextView(this).apply {
            text = "${kindLabel(stream.kind)}   •   ${stream.name}"
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(24, 17, 24, 17)
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
                view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(100).start()
            }
            setOnClickListener { open(providerId, liveFormat, stream, resumeMs) }
        }
        list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 66).apply { topMargin = 7 })
    }

    private fun open(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        when (stream.kind) {
            "movie" -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId)
                putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            "series" -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId)
                putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            "live" -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
                val profile = ProviderProfile(
                    providerKey = provider.id,
                    liveFormat = if (liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS
                )
                startActivity(Intent(this@LibraryActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                    putExtra(PlayerActivity.EXTRA_KIND, "live")
                    putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun kindLabel(kind: String) = when (kind) {
        "live" -> "LIVE"
        "movie" -> "MOVIE"
        "series" -> "SERIES"
        else -> kind.uppercase()
    }

    private fun rowBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 16f
        setColor(if (focused) Color.rgb(65, 31, 110) else Color.rgb(18, 17, 28))
        if (focused) setStroke(2, Color.rgb(185, 130, 255))
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
