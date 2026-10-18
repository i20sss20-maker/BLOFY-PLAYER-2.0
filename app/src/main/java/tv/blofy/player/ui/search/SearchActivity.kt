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
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.GridLayout
import android.view.View
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
    private var kindFilter = "all"
    private val filterButtons = linkedMapOf<String, Button>()
    private val compact by lazy { resources.configuration.screenWidthDp < 600 }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(if (compact) 16 else 34), dp(if (compact) 20 else 28), dp(if (compact) 16 else 34), dp(if (compact) 22 else 30))
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF170C25.toInt(), 0xFF07050B.toInt(), 0xFF10091A.toInt())
            )
        }
        root.addView(TextView(this).apply {
            text = "✦  اكتشف عالم BLOFY"
            BlofyTvDesign.applyTitle(this)
            if (compact) textSize = 27f
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(6))
        })
        root.addView(TextView(this).apply {
            text = "الأفلام  •  المسلسلات  •  القنوات"
            setTextColor(BlofyTvDesign.PurpleSoft)
            textSize = 13f
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(15))
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
                searchJob = lifecycleScope.launch {
                    runSearch(text?.toString().orEmpty(), moveFocus = true)
                }
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
        root.addView(filterRow(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)))
        root.addView(resultInfo, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        input.requestFocus()
    }

    private fun filterRow(): HorizontalScrollView {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        listOf("all" to "الكل", "movie" to "الأفلام", "series" to "المسلسلات", "live" to "البث المباشر").forEach { (kind, title) ->
            val button = Button(this).apply {
                text = title
                isAllCaps = false
                textSize = 13f
                setTextColor(BlofyTvDesign.TextPrimary)
                minWidth = 0
                minHeight = 0
                setPadding(dp(13), 0, dp(13), 0)
                setOnClickListener {
                    if (kindFilter != kind) {
                        kindFilter = kind
                        updateFilterStyles()
                        searchJob?.cancel()
                        searchJob = lifecycleScope.launch {
                            runSearch(input.text?.toString().orEmpty(), moveFocus = false)
                        }
                    }
                }
            }
            filterButtons[kind] = button
            row.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(43)).apply {
                marginEnd = dp(8)
            })
        }
        updateFilterStyles()
        return HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(row)
        }
    }

    private fun updateFilterStyles() {
        filterButtons.forEach { (kind, button) ->
            val selected = kind == kindFilter
            button.background = if (selected) BlofyTvDesign.primaryButton(dp(14).toFloat()) else BlofyTvDesign.glassPanel(dp(14).toFloat())
            button.contentDescription = button.text.toString() + if (selected) "، محدد" else ""
        }
    }

    private suspend fun runSearch(query: String, moveFocus: Boolean) {
        val normalized = query.trim()
        if (normalized.isEmpty()) {
            results.removeAllViews()
            resultInfo.text = "ابدأ بالكتابة للبحث في القنوات والأفلام والمسلسلات"
            return
        }
        val dao = BlofyDatabase.get(applicationContext).dao()
        val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
        if (provider == null) {
            showMessage("أضف قائمة تشغيل أولاً")
            return
        }
        // Apply category filtering in Room first: a large live-TV catalog must not
        // crowd all movie/series matches out of the first 300 unfiltered rows.
        val selectedKind = kindFilter
        val items = withContext(Dispatchers.IO) {
            if (selectedKind == "all") dao.searchStreams(provider.id, normalized, 300)
            else dao.searchCatalog(provider.id, selectedKind, normalized, 300)
        }
        if (input.text?.toString()?.trim() != normalized || selectedKind != kindFilter) return
        val matchingItems = if (kindFilter == "all") items else items.filter { it.kind == kindFilter }
        results.removeAllViews()
        if (matchingItems.isEmpty()) {
            resultInfo.text = "لا توجد نتائج لـ «$normalized» في هذا القسم"
            showMessage("جرّب قسمًا آخر أو جزءًا من الاسم")
            return
        }
            val visibleItems = matchingItems.take(100)
            val liveCount = matchingItems.count { it.kind == "live" }
            val movieCount = matchingItems.count { it.kind == "movie" }
            val seriesCount = matchingItems.count { it.kind == "series" }
            resultInfo.text = buildString {
                append(if (matchingItems.size > visibleItems.size) "عرض أول ${visibleItems.size} من ${matchingItems.size}" else "${matchingItems.size}")
                append(" نتيجة")
                if (liveCount > 0) append("  •  $liveCount قناة")
                if (movieCount > 0) append("  •  $movieCount فيلم")
                if (seriesCount > 0) append("  •  $seriesCount مسلسل")
            }
            if (compact) {
                val catalogItems = visibleItems.filter { it.kind == "movie" || it.kind == "series" }
                val channels = visibleItems.filter { it.kind == "live" }
                if (catalogItems.isNotEmpty()) {
                    addResultHeading("سينما ومسلسلات")
                    val posterWidth = ((resources.configuration.screenWidthDp - 60) / 3).coerceIn(80, 145)
                    val grid = GridLayout(this@SearchActivity).apply {
                        columnCount = 3
                        alignmentMode = GridLayout.ALIGN_BOUNDS
                        layoutDirection = View.LAYOUT_DIRECTION_RTL
                        useDefaultMargins = false
                    }
                    catalogItems.forEach { stream ->
                        val cell = LinearLayout(this@SearchActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            background = BlofyTvDesign.posterCard(dp(13).toFloat())
                            clipToOutline = true
                            isFocusable = true
                            isClickable = true
                            contentDescription = stream.name
                            setOnClickListener { guardedOpen(provider.id, provider.liveFormat, stream) }
                            setOnFocusChangeListener { view, focused ->
                                view.background = BlofyTvDesign.posterCard(dp(13).toFloat(), focused)
                            }
                        }
                        cell.addView(ImageView(this@SearchActivity).apply {
                            scaleType = ImageView.ScaleType.CENTER_CROP
                            setBackgroundColor(BlofyTvDesign.Surface)
                            ArtworkLoader.load(this, stream.icon)
                        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(posterWidth * 3 / 2)))
                        cell.addView(TextView(this@SearchActivity).apply {
                            text = (if (stream.locked) "🔒 " else "") + stream.name
                            textSize = 12f
                            typeface = BlofyTvDesign.BodyTypeface
                            setTextColor(BlofyTvDesign.TextPrimary)
                            gravity = Gravity.CENTER
                            maxLines = 2
                            ellipsize = android.text.TextUtils.TruncateAt.END
                            setPadding(dp(4), dp(4), dp(4), dp(4))
                        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))
                        grid.addView(cell, GridLayout.LayoutParams().apply {
                            width = dp(posterWidth)
                            height = dp(posterWidth * 3 / 2 + 42)
                            setMargins(dp(2), dp(5), dp(2), dp(5))
                        })
                    }
                    results.addView(grid)
                }
                if (channels.isNotEmpty()) {
                    addResultHeading("البث المباشر")
                    channels.forEach { stream -> addResultRow(provider.id, provider.liveFormat, stream) }
                }
            } else {
                visibleItems.forEach { stream -> addResultRow(provider.id, provider.liveFormat, stream) }
            }
        if (moveFocus) {
            val first = results.getChildAt(0)
            val target = if (first is TextView) results.getChildAt(1) else first
            (if (target is GridLayout) target.getChildAt(0) else target)?.requestFocus()
        }
    }

    private fun addResultHeading(title: String) {
        results.addView(TextView(this).apply {
            text = title
            textSize = 20f
            typeface = BlofyTvDesign.HeadingTypeface
            gravity = Gravity.RIGHT
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(0, dp(15), 0, dp(9))
        })
    }

    private fun addResultRow(providerId: String, liveFormat: String, stream: StreamEntity) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(6), dp(10), dp(6))
            isFocusable = true
            isClickable = true
            contentDescription = stream.name
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
            }
            setOnClickListener { guardedOpen(providerId, liveFormat, stream) }
        }
        row.addView(ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
            ArtworkLoader.load(this, stream.icon)
        }, LinearLayout.LayoutParams(dp(62), dp(62)).apply { marginStart = dp(12) })
        val textBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        }
        textBox.addView(TextView(this).apply {
            text = (if (stream.locked) "🔒  " else "") + stream.name
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            textSize = 16f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
        })
        textBox.addView(TextView(this).apply {
            text = when (stream.kind) {
                "live" -> "● مباشر"
                "movie" -> "فيلم"
                "series" -> "مسلسل"
                else -> kindLabel(stream.kind)
            }
            textSize = 12f
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
        })
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(62), 1f))
        results.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(78)).apply {
            topMargin = dp(7)
        })
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
