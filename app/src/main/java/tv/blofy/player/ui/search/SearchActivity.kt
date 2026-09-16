package tv.blofy.player.ui.search

import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
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
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout
    private lateinit var hint: TextView
    private lateinit var recentStrip: LinearLayout
    private lateinit var recentScroll: HorizontalScrollView
    private lateinit var filterStrip: LinearLayout
    private val filterButtons = linkedMapOf<String, Button>()
    private val searchRunner by lazy { CatalogSearchRunner(lifecycleScope, ::runSearch) }
    private val initialKind by lazy {
        intent.getStringExtra(EXTRA_KIND)?.lowercase()?.takeIf { it in SEARCH_ORDER }
    }
    private var activeKind: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeKind = initialKind
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(44), dp(30), dp(44), dp(32))
            background = AppCompatResources.getDrawable(this@SearchActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY SEARCH"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(CinemaStyle.Muted)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = "ابحث في كل شيء"
            textSize = 26f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, dp(3), 0, dp(4))
        })
        hint = TextView(this).apply {
            text = emptyHint()
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, 0, 0, dp(8))
        }
        root.addView(hint)

        filterStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            clipChildren = false
        }
        listOf(
            FILTER_ALL to "الكل",
            KIND_LIVE to "مباشر",
            KIND_MOVIE to "أفلام",
            KIND_SERIES to "مسلسلات"
        ).forEach { (key, label) ->
            val button = Button(this).apply {
                text = label
                isAllCaps = false
                textSize = 12.5f
                minWidth = 0
                minimumWidth = 0
                setOnClickListener { selectFilter(key) }
            }
            filterButtons[key] = button
            filterStrip.addView(button, LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(7) })
        }
        root.addView(filterStrip, LinearLayout.LayoutParams(-1, dp(48)).apply { bottomMargin = dp(6) })
        refreshFilterStyle()

        recentStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            clipChildren = false
        }
        recentScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            isFillViewport = false
            isFocusable = false
            addView(recentStrip, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(recentScroll, LinearLayout.LayoutParams(-1, dp(50)).apply { bottomMargin = dp(7) })

        input = EditText(this).apply {
            hint = inputHint()
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = searchField(false)
            setPadding(dp(22), dp(8), dp(22), dp(8))
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            isFocusable = true
            setOnFocusChangeListener { _, focused -> background = searchField(focused) }
            setOnEditorActionListener { _, _, _ ->
                val q = text?.toString().orEmpty()
                RecentSearchStore.record(this@SearchActivity, q)
                renderRecentSearches()
                searchRunner.submit(q, true)
                true
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    val q = s?.toString().orEmpty()
                    searchRunner.submit(q, false)
                    if (q.isBlank()) {
                        results.removeAllViews()
                        this@SearchActivity.hint.text = emptyHint()
                        renderRecentSearches()
                        return
                    }
                    recentScroll.visibility = View.GONE
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }

        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
            setPadding(0, 0, dp(4), dp(28))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipChildren = false
            clipToPadding = false
            isFocusable = false
            addView(results, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(input, LinearLayout.LayoutParams(-1, dp(64)))
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(14) })
        setContentView(root)
        renderRecentSearches()
        input.requestFocus()
    }

    private fun selectFilter(key: String) {
        activeKind = key.takeUnless { it == FILTER_ALL }
        refreshFilterStyle()
        if (::input.isInitialized) {
            input.hint = inputHint()
            val query = input.text?.toString().orEmpty()
            hint.text = emptyHint()
            if (query.isNotBlank()) searchRunner.submit(query, false)
        }
    }

    private fun refreshFilterStyle() {
        val selected = activeKind ?: FILTER_ALL
        filterButtons.forEach { (key, button) ->
            CinemaStyle.styleButton(button, key == selected)
        }
    }

    private fun inputHint() = when (activeKind) {
        KIND_LIVE -> "اكتب اسم القناة"
        KIND_SERIES -> "اكتب اسم المسلسل"
        KIND_MOVIE -> "اكتب اسم الفيلم"
        else -> "اكتب اسم المحتوى"
    }

    private fun renderRecentSearches() {
        if (!::recentStrip.isInitialized) return
        recentStrip.removeAllViews()
        if (::input.isInitialized && input.text?.isNotBlank() == true) {
            recentScroll.visibility = View.GONE
            return
        }
        val items = RecentSearchStore.recent(this)
        if (items.isEmpty()) {
            recentScroll.visibility = View.GONE
            return
        }
        recentScroll.visibility = View.VISIBLE
        recentStrip.addView(TextView(this).apply {
            text = "آخر البحث"
            textSize = 12f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(86), dp(42)).apply { marginEnd = dp(6) })
        items.take(6).forEach { query ->
            recentStrip.addView(Button(this).apply {
                text = query
                textSize = 12f
                isAllCaps = false
                maxLines = 1
                minWidth = 0
                minimumWidth = 0
                CinemaStyle.styleButton(this)
                setOnClickListener {
                    input.setText(query)
                    input.setSelection(input.text?.length ?: 0)
                    searchRunner.submit(query, true)
                }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)).apply { marginEnd = dp(7) })
        }
        recentStrip.addView(Button(this).apply {
            text = "مسح"
            textSize = 11.5f
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            CinemaStyle.styleButton(this)
            setOnClickListener {
                RecentSearchStore.clear(this@SearchActivity)
                renderRecentSearches()
            }
        }, LinearLayout.LayoutParams(dp(76), dp(42)))
    }

    private suspend fun runSearch(query: String, moveFocus: Boolean) {
        val q = query.trim()
        if (q.isEmpty()) { results.removeAllViews(); return }
        val dao = BlofyDatabase.get(applicationContext).dao()
        val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
        if (provider == null) { showMessage("أضف قائمة تشغيل أولاً"); return }
        val repository = ContentRepository(dao)
        val selectedKind = activeKind

        val sections = withContext(Dispatchers.IO) {
            val wantedKinds = selectedKind?.let(::listOf) ?: SEARCH_ORDER
            coroutineScope {
                wantedKinds.map { kind ->
                    kind to async { repository.searchKind(provider.id, kind, q, SECTION_LIMIT) }
                }.map { (kind, deferred) -> kind to deferred.await().distinctBy { it.key } }
            }
        }

        if (input.text?.toString()?.trim() != q || activeKind != selectedKind) return
        results.removeAllViews()
        val total = sections.sumOf { it.second.size }
        hint.text = if (selectedKind == null) "$total نتيجة • مباشر، أفلام ومسلسلات" else "$total نتيجة • ${sectionTitle(selectedKind)}"
        if (total == 0) { showMessage("ما لقينا نتائج مطابقة داخل باقتك"); return }

        var firstFocusable: View? = null
        sections.forEach { (kind, items) ->
            val section = resultSection(kind, items, provider.id, provider.liveFormat) { view ->
                if (firstFocusable == null) firstFocusable = view
            }
            results.addView(section, LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            })
        }
        if (moveFocus) firstFocusable?.requestFocus()
    }

    private fun resultSection(
        kind: String,
        items: List<StreamEntity>,
        providerId: String,
        liveFormat: String,
        onFirstFocusable: (View) -> Unit
    ): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = resources.configuration.layoutDirection
        setPadding(dp(14), dp(12), dp(14), dp(10))
        background = BlofyTvDesign.glassSurface(dp(18).toFloat())

        addView(TextView(this@SearchActivity).apply {
            val suffix = if (items.size >= SECTION_LIMIT) "+" else ""
            text = "${sectionTitle(kind)}   •   ${items.size}$suffix"
            textSize = 19f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(4), 0, dp(4), dp(8))
        }, LinearLayout.LayoutParams(-1, dp(42)))

        if (items.isEmpty()) {
            addView(TextView(this@SearchActivity).apply {
                text = "لا توجد نتائج"
                textSize = 13f
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                setPadding(dp(8), dp(6), dp(8), dp(10))
            })
        } else {
            items.forEachIndexed { index, stream ->
                val card = resultCard(stream) { guardedOpen(providerId, liveFormat, stream) }
                if (index == 0) onFirstFocusable(card)
                addView(card, LinearLayout.LayoutParams(-1, dp(84)).apply { bottomMargin = dp(7) })
            }
        }
    }

    private fun resultCard(stream: StreamEntity, open: () -> Unit): LinearLayout {
        val metadata = mutableListOf<String>()
        metadata += kindLabel(stream.kind)
        stream.year?.takeIf { it.isNotBlank() }?.let { metadata += it }
        stream.genre?.takeIf { it.isNotBlank() }?.substringBefore(',')?.let { metadata += it }
        stream.rating?.takeIf { it.isNotBlank() }?.let { metadata += "★ $it" }

        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(16), dp(7))
            isFocusable = true
            isClickable = true
            background = rowBackground(false)
            elevation = dp(1).toFloat()

            val art = ImageView(this@SearchActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF17111F.toInt()) }
            }
            addView(art, LinearLayout.LayoutParams(dp(58), dp(68)).apply { marginStart = dp(14) })
            ArtworkLoader.load(art, stream.icon ?: stream.backdrop)

            val copy = LinearLayout(this@SearchActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START }
            copy.addView(TextView(this@SearchActivity).apply {
                text = (if (stream.locked) "🔒  " else "") + ContentPresentation.of(stream).title
                textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); maxLines = 1; gravity = Gravity.START
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            copy.addView(TextView(this@SearchActivity).apply {
                text = metadata.joinToString("   •   "); textSize = 11.5f; setTextColor(BlofyTvDesign.TextMuted); maxLines = 1; gravity = Gravity.START
            })
            addView(copy, LinearLayout.LayoutParams(0, -1, 1f))

            val badge = TextView(this@SearchActivity).apply {
                text = kindLabel(stream.kind); textSize = 10.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(CinemaStyle.Muted); gravity = Gravity.CENTER
                background = CinemaStyle.surface(this@SearchActivity, radiusDp = 6)
            }
            addView(badge, LinearLayout.LayoutParams(dp(74), dp(34)).apply { marginStart = dp(6) })

            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.01f else 1f).scaleY(if (focused) 1.01f else 1f)
                    .translationZ(if (focused) dp(8).toFloat() else dp(1).toFloat()).setDuration(65).start()
            }
            setOnClickListener { open() }
        }
    }

    private fun guardedOpen(providerId: String, format: String, stream: StreamEntity) {
        RecentSearchStore.record(this, input.text?.toString().orEmpty())
        if (stream.locked) ParentalGate.requirePin(this) { openStream(providerId, format, stream) }
        else openStream(providerId, format, stream)
    }

    private fun openStream(providerId: String, format: String, stream: StreamEntity) {
        when (stream.kind) {
            KIND_MOVIE -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_SERIES -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_LIVE -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
                val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (format.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this@SearchActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, KIND_LIVE); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(stream))); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun emptyHint() = when (activeKind) {
        KIND_LIVE -> "بحث محلي سريع داخل جميع القنوات"
        KIND_SERIES -> "بحث محلي سريع داخل جميع المسلسلات"
        KIND_MOVIE -> "بحث محلي سريع داخل جميع الأفلام"
        else -> "البث المباشر، الأفلام والمسلسلات من بحث واحد"
    }

    private fun sectionTitle(kind: String) = when (kind) {
        KIND_LIVE -> "البث المباشر"
        KIND_SERIES -> "المسلسلات"
        KIND_MOVIE -> "الأفلام"
        else -> kind
    }

    private fun kindLabel(kind: String) = when (kind) { KIND_LIVE -> "LIVE"; KIND_MOVIE -> "MOVIE"; KIND_SERIES -> "SERIES"; else -> kind.uppercase() }

    private fun searchField(focused: Boolean) = CinemaStyle.surface(this, focused)
    private fun rowBackground(focused: Boolean) = CinemaStyle.surface(this, focused)

    private fun showMessage(message: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply { text = message; textSize = 17f; setTextColor(BlofyTvDesign.TextSecondary); gravity = Gravity.CENTER; setPadding(0, dp(30), 0, 0) })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onDestroy() { searchRunner.cancel(); super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_LIVE = "live"
        const val KIND_SERIES = "series"
        const val KIND_MOVIE = "movie"
        private const val FILTER_ALL = "all"
        private val SEARCH_ORDER = listOf(KIND_LIVE, KIND_SERIES, KIND_MOVIE)
        private const val SECTION_LIMIT = 120
    }
}
