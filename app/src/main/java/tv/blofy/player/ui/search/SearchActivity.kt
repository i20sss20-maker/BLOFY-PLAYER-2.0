package tv.blofy.player.ui.search

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(50, 38, 50, 38)
            background = AppCompatResources.getDrawable(this@SearchActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "بحث BLOFY"
            textSize = 29f
            setTextColor(TEXT_PRIMARY)
        })
        input = EditText(this).apply {
            hint = "اكتب اسم قناة أو فيلم أو مسلسل"
            setTextColor(TEXT_PRIMARY)
            setHintTextColor(TEXT_MUTED)
            setBackgroundColor(Color.WHITE)
            setPadding(22, 8, 22, 8)
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            isFocusable = true
            setOnEditorActionListener { _, _, _ ->
                searchJob?.cancel()
                runSearch(text?.toString().orEmpty(), moveFocus = true)
                true
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    searchJob?.cancel()
                    val query = s?.toString().orEmpty()
                    if (query.isBlank()) { results.removeAllViews(); return }
                    searchJob = lifecycleScope.launch { delay(180L); runSearch(query, moveFocus = false) }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 66))
        root.addView(results, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 14 })
        setContentView(root)
        input.requestFocus()
    }

    private fun runSearch(query: String, moveFocus: Boolean) {
        val normalized = query.trim()
        if (normalized.isEmpty()) { results.removeAllViews(); return }
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) { showMessage("أضف قائمة تشغيل أولاً"); return@launch }
            val items = withContext(Dispatchers.IO) { ContentRepository(dao).search(provider.id, normalized) }
            if (input.text?.toString()?.trim() != normalized) return@launch
            results.removeAllViews()
            if (items.isEmpty()) { showMessage("لا توجد نتائج"); return@launch }
            items.take(100).forEach { stream ->
                val row = TextView(this@SearchActivity).apply {
                    text = "${if (stream.locked) "🔒 " else ""}${kindLabel(stream.kind)}   •   ${stream.name}"
                    textSize = 18f
                    setTextColor(TEXT_PRIMARY)
                    setPadding(24, 17, 24, 17)
                    gravity = Gravity.CENTER_VERTICAL
                    isFocusable = true
                    isClickable = true
                    background = rowBackground(false)
                    setOnFocusChangeListener { view, focused ->
                        setTextColor(if (focused) Color.WHITE else TEXT_PRIMARY)
                        view.background = rowBackground(focused)
                        view.animate().scaleX(if (focused) 1.012f else 1f).scaleY(if (focused) 1.012f else 1f).translationZ(if (focused) 8f else 1f).setDuration(80).start()
                    }
                    setOnClickListener { guardedOpen(provider.id, provider.liveFormat, stream) }
                }
                results.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 66).apply { topMargin = 7 })
            }
            if (moveFocus) results.getChildAt(0)?.requestFocus()
        }
    }

    private fun guardedOpen(providerId: String, liveFormat: String, stream: StreamEntity) {
        if (stream.locked) ParentalGate.requirePin(this) { openStream(providerId, liveFormat, stream) } else openStream(providerId, liveFormat, stream)
    }

    private fun openStream(providerId: String, liveFormat: String, stream: StreamEntity) {
        when (stream.kind) {
            "movie" -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply { putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key) })
            "series" -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply { putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key) })
            "live" -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
                val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this@SearchActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, "live")
                    putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport); putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
                    putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects); putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
                    putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun kindLabel(kind: String) = when (kind) { "live" -> "LIVE"; "movie" -> "MOVIE"; "series" -> "SERIES"; else -> kind.uppercase() }

    private fun rowBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 16f
        setColor(if (focused) PURPLE else Color.WHITE)
        setStroke(if (focused) 2 else 1, if (focused) 0xFFB991E9.toInt() else 0xFFE1DCE8.toInt())
    }

    private fun showMessage(text: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply { this.text = text; textSize = 18f; setTextColor(TEXT_SECONDARY); setPadding(0, 24, 0, 0) })
    }

    override fun onDestroy() { searchJob?.cancel(); super.onDestroy() }

    companion object {
        private val TEXT_PRIMARY = Color.rgb(28, 24, 34)
        private val TEXT_SECONDARY = Color.rgb(78, 72, 86)
        private val TEXT_MUTED = Color.rgb(128, 120, 139)
        private val PURPLE = Color.rgb(105, 49, 190)
    }
}
