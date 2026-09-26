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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
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
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout
    private lateinit var resultInfo: TextView
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val compact = resources.configuration.screenWidthDp < 600
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(if (compact) 16 else 34), dp(if (compact) 20 else 28), dp(if (compact) 16 else 34), dp(if (compact) 22 else 30))
            background = AppCompatResources.getDrawable(this@SearchActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "بحث BLOFY"
            BlofyTvDesign.applyTitle(this)
            if (compact) textSize = 27f
            setPadding(0, 0, 0, dp(10))
        })
        input = EditText(this).apply {
            hint = "اكتب اسم قناة أو فيلم أو مسلسل"
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextDim)
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            isFocusable = true
            background = BlofyTvDesign.inputField(dp(18).toFloat(), false)
            setPadding(dp(18), 0, dp(18), 0)
            setOnFocusChangeListener { view, focused -> view.background = BlofyTvDesign.inputField(dp(18).toFloat(), focused) }
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
                        resultInfo.text = "ابدأ بالكتابة للبحث في القنوات والأفلام والمسلسلات"
                        return
                    }
                    searchJob = lifecycleScope.launch {
                        delay(180L)
                        runSearch(query, moveFocus = false)
                    }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        resultInfo = TextView(this).apply {
            text = "ابدأ بالكتابة للبحث في القنوات والأفلام والمسلسلات"
            textSize = 13.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(10), 0, dp(8))
        }
        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(2), 0, dp(24))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = android.view.View.OVER_SCROLL_NEVER
            addView(results)
        }
        root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (compact) 56 else 62)))
        root.addView(resultInfo, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        input.requestFocus()
    }

    private fun runSearch(query: String, moveFocus: Boolean) {
        val normalized = query.trim()
        if (normalized.isEmpty()) {
            results.removeAllViews()
            resultInfo.text = "ابدأ بالكتابة للبحث في القنوات والأفلام والمسلسلات"
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
            if (items.isEmpty()) {
                resultInfo.text = "لا توجد نتائج لـ «$normalized»"
                showMessage("جرّب كتابة اسم مختلف أو جزء من الاسم")
                return@launch
            }
            val visibleItems = items.take(100)
            val liveCount = items.count { it.kind == "live" }
            val movieCount = items.count { it.kind == "movie" }
            val seriesCount = items.count { it.kind == "series" }
            resultInfo.text = buildString {
                append(if (items.size > visibleItems.size) "عرض أول ${visibleItems.size} من ${items.size}" else "${items.size}")
                append(" نتيجة")
                if (liveCount > 0) append("  •  $liveCount قناة")
                if (movieCount > 0) append("  •  $movieCount فيلم")
                if (seriesCount > 0) append("  •  $seriesCount مسلسل")
            }
            visibleItems.forEach { stream ->
                val row = LinearLayout(this@SearchActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(if (compact) 10 else 12), dp(if (compact) 6 else 8), dp(if (compact) 10 else 12), dp(if (compact) 6 else 8))
                    isFocusable = true
                    isFocusableInTouchMode = true
                    isClickable = true
                    background = rowBackground(false)
                    setOnFocusChangeListener { view, focused ->
                        view.background = rowBackground(focused)
                        view.animate().cancel()
                        view.animate()
                            .scaleX(if (focused) 1.018f else 1f)
                            .scaleY(if (focused) 1.018f else 1f)
                            .translationZ(if (focused) 8f else 0f)
                            .setDuration(90)
                            .start()
                    }
                    setOnClickListener { guardedOpen(provider.id, provider.liveFormat, stream) }
                }
                val artwork = ImageView(this@SearchActivity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    setBackgroundColor(BlofyTvDesign.Surface)
                    contentDescription = stream.name
                }
                ArtworkLoader.load(artwork, stream.icon)
                row.addView(artwork, LinearLayout.LayoutParams(dp(if (compact) 48 else 54), dp(if (compact) 58 else 66)).apply { marginStart = dp(if (compact) 10 else 14) })

                val textBox = LinearLayout(this@SearchActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                }
                textBox.addView(TextView(this@SearchActivity).apply {
                    text = (if (stream.locked) "🔒  " else "") + stream.name
                    textSize = if (compact) 15.5f else 17.5f
                    setTextColor(BlofyTvDesign.TextPrimary)
                    gravity = Gravity.RIGHT
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
                textBox.addView(TextView(this@SearchActivity).apply {
                    text = when (stream.kind) {
                        "live" -> "بث مباشر"
                        "movie" -> "فيلم"
                        "series" -> "مسلسل"
                        else -> kindLabel(stream.kind)
                    }
                    textSize = 12.5f
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(4), 0, 0)
                })
                row.addView(textBox, LinearLayout.LayoutParams(0, dp(if (compact) 58 else 66), 1f))
                results.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (compact) 72 else 82)).apply { topMargin = dp(if (compact) 5 else 7) })
            }
            if (moveFocus) results.getChildAt(0)?.requestFocus()
        }
    }

    private fun guardedOpen(providerId: String, liveFormat: String, stream: StreamEntity) {
        if (stream.locked) {
            ParentalGate.requirePin(this) { openStream(providerId, liveFormat, stream) }
        } else {
            openStream(providerId, liveFormat, stream)
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
        "live" -> "LIVE"
        "movie" -> "MOVIE"
        "series" -> "SERIES"
        else -> kind.uppercase()
    }

    private fun rowBackground(focused: Boolean) = BlofyTvDesign.surface(dp(16).toFloat(), focused)

    private fun showMessage(text: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply {
            this.text = text
            textSize = 18f
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(24), 0, 0)
        })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        searchJob?.cancel()
        super.onDestroy()
    }
}
