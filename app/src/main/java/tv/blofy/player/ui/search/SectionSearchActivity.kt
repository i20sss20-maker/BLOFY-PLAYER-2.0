package tv.blofy.player.ui.search

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.LiveChannelAdapter
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

/** Search that is intentionally locked to the catalog section that opened it. */
class SectionSearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var list: RecyclerView
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var liveAdapter: LiveChannelAdapter
    private lateinit var provider: ProviderEntity
    private var pendingQuery: String? = null
    private val searchRunner by lazy { CatalogSearchRunner(lifecycleScope, ::runSearch) }
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND)?.lowercase().orEmpty() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (kind !in VALID_KINDS) { finish(); return }

        val device = DeviceClass.detect(this)
        val compact = device == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(if (compact) 14 else 30), dp(if (compact) 14 else 24), dp(if (compact) 14 else 30), dp(if (compact) 14 else 24))
            background = AppCompatResources.getDrawable(this@SectionSearchActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        root.addView(TextView(this).apply {
            text = "BLOFY  •  ${sectionTitle()}"
            textSize = if (compact) 22f else 27f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            includeFontPadding = false
        }, LinearLayout.LayoutParams(-1, dp(if (compact) 48 else 54)))

        status = TextView(this).apply {
            text = startHint()
            textSize = if (compact) 12.5f else 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
        }

        input = EditText(this).apply {
            hint = inputHint()
            textSize = if (compact) 15f else 16f
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = CinemaStyle.surface(this@SectionSearchActivity)
            setPadding(dp(18), dp(6), dp(18), dp(6))
            isSingleLine = true
            setOnFocusChangeListener { view, focused ->
                view.background = CinemaStyle.surface(this@SectionSearchActivity, focused)
            }
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setOnEditorActionListener { _, _, _ ->
                val query = text?.toString().orEmpty()
                if (query.isNotBlank()) {
                    RecentSearchStore.record(this@SectionSearchActivity, query)
                    searchRunner.submit(query, true)
                }
                true
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun afterTextChanged(s: Editable?) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    val query = s?.toString().orEmpty()
                    intent.putExtra(EXTRA_QUERY, query)
                    if (query.isBlank()) {
                        searchRunner.cancel()
                        clearResults()
                        status.text = startHint()
                    } else {
                        // One character is enough. CatalogSearchRunner only debounces rapid typing;
                        // there is deliberately no minimum query length.
                        searchRunner.submit(query, false)
                    }
                }
            })
        }
        root.addView(input, LinearLayout.LayoutParams(-1, dp(if (compact) 54 else 58)).apply { bottomMargin = dp(8) })
        root.addView(status, LinearLayout.LayoutParams(-1, dp(34)).apply { bottomMargin = dp(6) })

        list = RecyclerView(this).apply {
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            preserveFocusAfterLayout = true
            setPadding(dp(2), dp(4), dp(2), dp(18))
            if (kind == KIND_LIVE) {
                layoutManager = LinearLayoutManager(this@SectionSearchActivity)
                setItemViewCacheSize(22)
                recycledViewPool.setMaxRecycledViews(0, 28)
            } else {
                val widthDp = resources.configuration.screenWidthDp.coerceAtLeast(320)
                val columns = when (device) {
                    DeviceClass.Kind.TV -> if (widthDp >= 1500) 7 else if (widthDp >= 1000) 6 else 5
                    DeviceClass.Kind.TABLET -> if (widthDp >= 900) 5 else 4
                    DeviceClass.Kind.PHONE -> if (widthDp >= 600) 3 else 2
                }
                layoutManager = GridLayoutManager(this@SectionSearchActivity, columns)
                setItemViewCacheSize(18)
                recycledViewPool.setMaxRecycledViews(0, 30)
            }
        }
        root.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        liveAdapter = LiveChannelAdapter(
            onClick = ::guardedOpen,
            onFocus = {},
            onLongClick = {},
            itemKey = { it.key }
        )
        posterAdapter = PosterStreamAdapter(::guardedOpen)
        list.adapter = if (kind == KIND_LIVE) liveAdapter else posterAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val activeId = withContext(Dispatchers.IO) { dao.activeProviderId() }
            provider = activeId?.let { withContext(Dispatchers.IO) { dao.provider(it) } } ?: run {
                status.setText(R.string.search_no_active_playlist)
                input.isEnabled = false
                return@launch
            }
            val restored = savedInstanceState?.getString(EXTRA_QUERY)
                ?: intent.getStringExtra(EXTRA_QUERY).orEmpty()
            if (restored.isNotBlank() && input.text.isNullOrBlank()) {
                input.setText(restored)
                input.setSelection(input.text?.length ?: 0)
            }
            pendingQuery?.takeIf(String::isNotBlank)?.let { searchRunner.submit(it, false) }
            pendingQuery = null
        }
        input.requestFocus()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(EXTRA_QUERY, input.text?.toString().orEmpty())
        super.onSaveInstanceState(outState)
    }

    private suspend fun runSearch(query: String, moveFocus: Boolean) {
        val q = query.trim()
        if (q.isEmpty()) return
        if (!::provider.isInitialized) {
            pendingQuery = q
            return
        }
        val results = withContext(Dispatchers.IO) {
            ContentRepository(BlofyDatabase.get(applicationContext).dao())
                .searchKind(provider.id, kind, q, RESULT_LIMIT)
        }
        if (input.text?.toString()?.trim() != q) return
        if (kind == KIND_LIVE) liveAdapter.replace(results) else posterAdapter.replace(results)
        status.text = if (results.isEmpty()) {
            getString(R.string.search_section_empty, sectionTitle())
        } else {
            getString(R.string.search_section_count, "${results.size}${if (results.size >= RESULT_LIMIT) "+" else ""}", sectionTitle())
        }
        if (moveFocus && results.isNotEmpty()) {
            list.scrollToPosition(0)
            list.post { list.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
        }
    }

    private fun clearResults() {
        if (!::list.isInitialized) return
        if (::liveAdapter.isInitialized) liveAdapter.replace(emptyList())
        if (::posterAdapter.isInitialized) posterAdapter.replace(emptyList())
    }

    private fun guardedOpen(stream: StreamEntity) {
        RecentSearchStore.record(this, input.text?.toString().orEmpty())
        open(stream)
    }

    private fun open(stream: StreamEntity) {
        when (kind) {
            KIND_MOVIE -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_SERIES -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_LIVE -> openLive(stream)
        }
    }

    private fun openLive(stream: StreamEntity) {
        val profile = ProviderProfile(
            providerKey = provider.id,
            liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS
        )
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, KIND_LIVE)
            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
            putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(stream)))
            putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
        })
    }

    private fun sectionTitle() = when (kind) {
        KIND_LIVE -> getString(R.string.search_section_live)
        KIND_SERIES -> getString(R.string.search_section_series)
        else -> getString(R.string.search_section_movies)
    }

    private fun startHint() = when (kind) {
        KIND_LIVE -> getString(R.string.search_section_hint_live)
        KIND_SERIES -> getString(R.string.search_section_hint_series)
        else -> getString(R.string.search_section_hint_movies)
    }

    private fun inputHint() = when (kind) {
        KIND_LIVE -> getString(R.string.search_input_channel)
        KIND_SERIES -> getString(R.string.search_input_series)
        else -> getString(R.string.search_input_movie)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_KIND = "kind"
        private const val EXTRA_QUERY = "query"
        private const val KIND_LIVE = "live"
        private const val KIND_MOVIE = "movie"
        private const val KIND_SERIES = "series"
        private const val RESULT_LIMIT = 180
        private val VALID_KINDS = setOf(KIND_LIVE, KIND_MOVIE, KIND_SERIES)
    }
}
