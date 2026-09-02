package tv.blofy.player.ui.search

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout
    private lateinit var status: TextView
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(42), dp(30), dp(42), dp(30))
            setBackgroundColor(Color.rgb(7, 5, 13))
            layoutDirection = LinearLayout.LAYOUT_DIRECTION_RTL
        }
        root.addView(TextView(this).apply {
            text = "البحث"
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "نتائج فورية من أول حرف في القنوات والأفلام والمسلسلات"
            textSize = 14f
            setTextColor(Color.rgb(191, 171, 216))
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, dp(16))
        })

        input = EditText(this).apply {
            hint = "اكتب حرفًا واحدًا أو أكثر..."
            textSize = 19f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(137, 127, 151))
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            isFocusable = true
            setPadding(dp(22), 0, dp(22), 0)
            background = searchBox(false)
            setOnFocusChangeListener { view, focused -> view.background = searchBox(focused) }
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
                    if (query.isBlank()) {
                        results.removeAllViews()
                        status.text = ""
                        return
                    }
                    searchJob = lifecycleScope.launch {
                        delay(60L)
                        runSearch(query, moveFocus = false)
                    }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)))

        status = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.rgb(195, 135, 255))
            gravity = Gravity.RIGHT
            setPadding(0, dp(10), 0, dp(8))
        }
        root.addView(status)

        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(results) }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        input.requestFocus()
    }

    private fun runSearch(query: String, moveFocus: Boolean) {
        val normalized = query.trim()
        if (normalized.isEmpty()) {
            results.removeAllViews()
            status.text = ""
            return
        }
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) {
                showMessage("أضف قائمة تشغيل أولاً")
                return@launch
            }
            val items = withContext(Dispatchers.IO) { ContentRepository(dao).search(provider.id, normalized) }
            if (input.text?.toString()?.trim() != normalized) return@launch
            results.removeAllViews()
            status.text = "${items.size} نتيجة"
            if (items.isEmpty()) {
                showMessage("لا توجد نتائج")
                return@launch
            }
            items.take(200).forEach { stream ->
                val row = TextView(this@SearchActivity).apply {
                    text = "${kindLabel(stream.kind)}   •   ${stream.name}"
                    textSize = 17f
                    setTextColor(Color.WHITE)
                    setPadding(dp(22), dp(15), dp(22), dp(15))
                    gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                    isFocusable = true
                    isClickable = true
                    background = rowBackground(false)
                    setOnFocusChangeListener { view, focused ->
                        view.background = rowBackground(focused)
                        view.animate().scaleX(if (focused) 1.012f else 1f).scaleY(if (focused) 1.012f else 1f).setDuration(80).start()
                    }
                    setOnClickListener { openStream(provider.id, provider.liveFormat, stream) }
                }
                results.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)).apply { topMargin = dp(5) })
            }
            if (moveFocus) results.getChildAt(0)?.requestFocus()
        }
    }

    private fun openStream(providerId: String, liveFormat: String, stream: StreamEntity) {
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
                startActivity(Intent(this@SearchActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                    putExtra(PlayerActivity.EXTRA_KIND, "live")
                    putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
                    putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
                    putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun kindLabel(kind: String) = when (kind) {
        "live" -> "بث مباشر"
        "movie" -> "فيلم"
        "series" -> "مسلسل"
        else -> kind
    }

    private fun searchBox(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        setColor(if (focused) 0xFF241631.toInt() else 0xEB14101D.toInt())
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFD8A6FF.toInt() else 0x66543C69)
    }

    private fun rowBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(if (focused) 0xFF5E2792.toInt() else 0xE5191422.toInt())
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFE3BCFF.toInt() else 0x554C385E)
    }

    private fun showMessage(text: String) {
        results.removeAllViews()
        status.text = ""
        results.addView(TextView(this).apply {
            this.text = text
            textSize = 18f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.RIGHT
            setPadding(0, dp(24), 0, 0)
        })
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        searchJob?.cancel()
        super.onDestroy()
    }
}
