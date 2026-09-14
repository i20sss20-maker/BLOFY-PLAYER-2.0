package tv.blofy.player.ui.search

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
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
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
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(34), dp(28), dp(34), dp(28))
            setBackgroundColor(Color.rgb(5, 5, 10))
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        root.addView(TextView(this).apply {
            text = "بحث BLOFY"
            textSize = 29f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        input = EditText(this).apply {
            hint = "اكتب اسم قناة أو فيلم أو مسلسل"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
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
                    if (query.isBlank()) {
                        results.removeAllViews()
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
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(18), 0, dp(30))
        }
        scroll.addView(results, ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT))
        root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        input.requestFocus()
    }

    private fun runSearch(query: String, moveFocus: Boolean) {
        val normalized = query.trim()
        if (normalized.isEmpty()) {
            results.removeAllViews()
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
                showMessage("لا توجد نتائج")
                return@launch
            }

            val vod = items.filter { it.kind == "movie" || it.kind == "series" }
            val live = items.filter { it.kind == "live" }
            var firstFocusable: View? = null

            if (vod.isNotEmpty()) {
                results.addView(sectionTitle("الأفلام والمسلسلات"))
                val columns = if (resources.configuration.smallestScreenWidthDp >= 600) 5 else 3
                val grid = GridLayout(this@SearchActivity).apply {
                    columnCount = columns
                    alignmentMode = GridLayout.ALIGN_BOUNDS
                    useDefaultMargins = false
                    layoutDirection = View.LAYOUT_DIRECTION_RTL
                }
                vod.take(60).forEach { stream ->
                    val card = posterCard(provider.id, provider.liveFormat, stream)
                    if (firstFocusable == null) firstFocusable = card
                    grid.addView(card, GridLayout.LayoutParams().apply {
                        columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                        width = 0
                        height = dp(250)
                        setMargins(dp(6), dp(6), dp(6), dp(10))
                    })
                }
                results.addView(grid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            }

            if (live.isNotEmpty()) {
                results.addView(sectionTitle("القنوات"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
                live.take(80).forEach { stream ->
                    val row = liveRow(provider.id, provider.liveFormat, stream)
                    if (firstFocusable == null) firstFocusable = row
                    results.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)).apply { topMargin = dp(6) })
                }
            }

            if (moveFocus) firstFocusable?.requestFocus()
        }
    }

    private fun posterCard(providerId: String, liveFormat: String, stream: StreamEntity): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(6), dp(6), dp(6), dp(8))
            isFocusable = true
            isClickable = true
            background = posterBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = posterBackground(focused)
                view.animate().scaleX(if (focused) 1.045f else 1f).scaleY(if (focused) 1.045f else 1f).setDuration(100).start()
            }
            setOnClickListener { guardedOpen(providerId, liveFormat, stream) }
        }
        val imageFrame = FrameLayout(this).apply { setBackgroundColor(0xFF15101F.toInt()) }
        val image = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        imageFrame.addView(image, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        ArtworkLoader.load(image, stream.icon)
        card.addView(imageFrame, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        card.addView(TextView(this).apply {
            text = stream.name
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 2
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(7), dp(4), 0)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)))
        val meta = buildList {
            stream.year?.takeIf { it.isNotBlank() }?.let(::add)
            stream.rating?.takeIf { it.isNotBlank() }?.let { add("★ $it") }
        }.joinToString("  •  ")
        if (meta.isNotBlank()) {
            card.addView(TextView(this).apply {
                text = meta
                textSize = 11.5f
                setTextColor(0xFFC6A8E7.toInt())
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(24)))
        }
        return card
    }

    private fun liveRow(providerId: String, liveFormat: String, stream: StreamEntity): View = TextView(this).apply {
        text = "${if (stream.locked) "🔒 " else ""}${stream.name}"
        textSize = 18f
        setTextColor(Color.WHITE)
        setPadding(dp(22), 0, dp(22), 0)
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        isFocusable = true
        isClickable = true
        background = rowBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = rowBackground(focused)
            view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(100).start()
        }
        setOnClickListener { guardedOpen(providerId, liveFormat, stream) }
    }

    private fun sectionTitle(text: String) = TextView(this).apply {
        this.text = text
        textSize = 20f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.RIGHT
        setPadding(0, dp(6), 0, dp(8))
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

    private fun rowBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(if (focused) Color.rgb(65, 31, 110) else Color.rgb(18, 17, 28))
        if (focused) setStroke(dp(2), Color.rgb(185, 130, 255))
    }

    private fun posterBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(if (focused) 0xFF3E205E.toInt() else 0xD9181225.toInt())
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC784FF.toInt() else 0x66533B68)
    }

    private fun showMessage(text: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply {
            this.text = text
            textSize = 18f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(24), 0, 0)
        })
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        searchJob?.cancel()
        super.onDestroy()
    }
}
