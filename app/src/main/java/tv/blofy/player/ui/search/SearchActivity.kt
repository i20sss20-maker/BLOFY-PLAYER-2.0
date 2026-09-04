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
import android.widget.ImageView
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
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout
    private lateinit var hint: TextView
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(44), dp(30), dp(44), dp(32))
            background = AppCompatResources.getDrawable(this@SearchActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY SEARCH"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "ابحث في كل شيء"
            textSize = 31f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(3), 0, dp(4))
        })
        hint = TextView(this).apply {
            text = "القنوات، الأفلام والمسلسلات من بحث واحد"
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(hint)

        input = EditText(this).apply {
            hint = "اكتب اسم المحتوى"
            textSize = 18f
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = searchField(false)
            setPadding(dp(22), dp(8), dp(22), dp(8))
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            isFocusable = true
            setOnFocusChangeListener { _, focused -> background = searchField(focused) }
            setOnEditorActionListener { _, _, _ ->
                searchJob?.cancel()
                runSearch(text?.toString().orEmpty(), true)
                true
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    searchJob?.cancel()
                    val q = s?.toString().orEmpty()
                    if (q.isBlank()) {
                        results.removeAllViews()
                        this@SearchActivity.hint.text = "القنوات، الأفلام والمسلسلات من بحث واحد"
                        return
                    }
                    searchJob = lifecycleScope.launch {
                        delay(140)
                        runSearch(q, false)
                    }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }

        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
        }
        root.addView(input, LinearLayout.LayoutParams(-1, dp(64)))
        root.addView(results, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(14) })
        setContentView(root)
        input.requestFocus()
    }

    private fun runSearch(query: String, moveFocus: Boolean) {
        val q = query.trim()
        if (q.isEmpty()) { results.removeAllViews(); return }
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) { showMessage("أضف قائمة تشغيل أولاً"); return@launch }

            val items = withContext(Dispatchers.IO) {
                ContentRepository(dao).search(provider.id, q).distinctBy { it.key }.take(100)
            }

            if (input.text?.toString()?.trim() != q) return@launch
            results.removeAllViews()
            hint.text = "${items.size} نتيجة"
            if (items.isEmpty()) { showMessage("ما لقينا نتائج مطابقة داخل باقتك"); return@launch }
            items.forEach { stream ->
                results.addView(
                    resultCard(stream) { guardedOpen(provider.id, provider.liveFormat, stream) },
                    LinearLayout.LayoutParams(-1, dp(84)).apply { bottomMargin = dp(7) }
                )
            }
            if (moveFocus) results.getChildAt(0)?.requestFocus()
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
            layoutDirection = View.LAYOUT_DIRECTION_RTL
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

            val copy = LinearLayout(this@SearchActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
            copy.addView(TextView(this@SearchActivity).apply {
                text = (if (stream.locked) "🔒  " else "") + stream.name
                textSize = 16f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); maxLines = 1; gravity = Gravity.RIGHT
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            copy.addView(TextView(this@SearchActivity).apply {
                text = metadata.joinToString("   •   "); textSize = 11.5f; setTextColor(BlofyTvDesign.TextMuted); maxLines = 1; gravity = Gravity.RIGHT
            })
            addView(copy, LinearLayout.LayoutParams(0, -1, 1f))

            val badge = TextView(this@SearchActivity).apply {
                text = kindLabel(stream.kind); textSize = 10.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(BlofyTvDesign.PurpleSoft); gravity = Gravity.CENTER
                background = GradientDrawable().apply { cornerRadius = dp(11).toFloat(); setColor(0x66382252); setStroke(dp(1), 0x995F3D82.toInt()) }
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
        if (stream.locked) ParentalGate.requirePin(this) { openStream(providerId, format, stream) }
        else openStream(providerId, format, stream)
    }

    private fun openStream(providerId: String, format: String, stream: StreamEntity) {
        when (stream.kind) {
            "movie" -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            "series" -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            "live" -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
                val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (format.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this@SearchActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, "live"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun kindLabel(kind: String) = when (kind) { "live" -> "LIVE"; "movie" -> "MOVIE"; "series" -> "SERIES"; else -> kind.uppercase() }

    private fun searchField(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF332044.toInt(), 0xFF21152E.toInt()) else intArrayOf(0xFF21172F.toInt(), 0xFF17101F.toInt())
    ).apply { cornerRadius = dp(20).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.PurpleBright else 0xFF513D67.toInt()) }

    private fun rowBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF713EC0.toInt(), 0xFF3A2358.toInt()) else intArrayOf(0xE6241A36.toInt(), 0xE6191222.toInt())
    ).apply { cornerRadius = dp(16).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.PurpleBright else 0xFF49375E.toInt()) }

    private fun showMessage(message: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply { text = message; textSize = 17f; setTextColor(BlofyTvDesign.TextSecondary); gravity = Gravity.CENTER; setPadding(0, dp(30), 0, 0) })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onDestroy() { searchJob?.cancel(); super.onDestroy() }
}
