package tv.blofy.player.ui.search

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.EditText
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

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 36, 48, 36)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "بحث BLOFY"
            textSize = 28f
            setTextColor(Color.WHITE)
        })
        input = EditText(this).apply {
            hint = "اكتب اسم قناة أو فيلم أو مسلسل"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setOnEditorActionListener { _, _, _ ->
                runSearch(text?.toString().orEmpty())
                true
            }
        }
        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(results, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        input.requestFocus()
    }

    private fun runSearch(query: String) {
        lifecycleScope.launch {
            val db = BlofyDatabase.get(applicationContext)
            val dao = db.dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) {
                showMessage("أضف قائمة تشغيل أولاً")
                return@launch
            }
            val items = withContext(Dispatchers.IO) { ContentRepository(dao).search(provider.id, query) }
            results.removeAllViews()
            if (items.isEmpty()) {
                showMessage("لا توجد نتائج")
                return@launch
            }
            items.take(100).forEach { stream ->
                results.addView(TextView(this@SearchActivity).apply {
                    text = stream.name
                    textSize = 19f
                    setTextColor(Color.WHITE)
                    setPadding(22, 18, 22, 18)
                    gravity = Gravity.CENTER_VERTICAL
                    isFocusable = true
                    setOnClickListener { openStream(provider.id, provider.liveFormat, stream) }
                })
            }
            results.getChildAt(0)?.requestFocus()
        }
    }

    private fun openStream(providerId: String, liveFormat: String, stream: StreamEntity) {
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
            val resume = withContext(Dispatchers.IO) { dao.watchState(stream.key)?.positionMs ?: 0L }
            startActivity(Intent(this@SearchActivity, PlayerActivity::class.java).apply {
                putExtra(PlayerActivity.EXTRA_URL, url)
                putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(PlayerActivity.EXTRA_KIND, stream.kind)
                putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
            })
        }
    }

    private fun showMessage(text: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply {
            this.text = text
            textSize = 18f
            setTextColor(Color.LTGRAY)
            setPadding(0, 24, 0, 0)
        })
    }
}
