package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.mobile.MobileContentActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class HomeActivity : AppCompatActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private var heroItems: List<StreamEntity> = emptyList()
    private var heroIndex = 0
    private var providerId = ""

    private lateinit var heroImage: ImageView
    private lateinit var heroTitle: TextView
    private lateinit var heroMeta: TextView
    private lateinit var heroPlot: TextView
    private lateinit var heroBadge: TextView
    private lateinit var heroPrimary: Button
    private lateinit var heroSecondary: Button
    private lateinit var featuredRow: LinearLayout

    private val rotateHero = object : Runnable {
        override fun run() {
            if (heroItems.size > 1 && !heroPrimary.hasFocus() && !heroSecondary.hasFocus()) {
                heroIndex = (heroIndex + 1) % heroItems.size
                renderHero(animated = true)
            }
            handler.postDelayed(this, HERO_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildHome())
        loadLocalHomeContent()
    }

    private fun buildHome(): FrameLayout {
        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(14), dp(12), dp(14), dp(12))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, 0, dp(14), 0)
            clipChildren = false
            clipToPadding = false
        }
        shell.addView(main, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(188), LinearLayout.LayoutParams.MATCH_PARENT))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        top.addView(TextView(this).apply {
            text = "اكتشف الآن"
            textSize = 25f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(52), 1f))
        val search = navButton("⌕  بحث", Intent(this, SearchActivity::class.java))
        top.addView(search, LinearLayout.LayoutParams(dp(150), dp(48)))
        main.addView(top)

        main.addView(buildHero(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.45f))

        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(10), 0, dp(10))
        }
        quick.addView(infoCard("تابع المشاهدة", "ارجع من حيث توقفت", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(8) })
        quick.addView(infoCard("المفضلة", "اختياراتك المحفوظة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(8) })
        quick.addView(infoCard("آخر قناة", "عودة سريعة للبث", Intent(this, RecentChannelsActivity::class.java)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        main.addView(quick, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.45f))

        main.addView(TextView(this).apply {
            text = "أضيف حديثًا"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36)))

        featuredRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        main.addView(featuredRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.62f))
        return root
    }

    private fun buildSidebar(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(12), dp(12), dp(12), dp(12))
        background = panelBackground()
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(118), dp(88)).apply { bottomMargin = dp(8) })
        addView(sideItem("⌂", "الرئيسية", null, selected = true))
        addView(sideItem("◉", "بث مباشر", contentIntent("live")))
        addView(sideItem("▣", "الأفلام", contentIntent("movie")))
        addView(sideItem("▤", "المسلسلات", contentIntent("series")))
        addView(sideItem("♡", "المفضلة", Intent(this@HomeActivity, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)))
        addView(sideItem("⌕", "بحث", Intent(this@HomeActivity, SearchActivity::class.java)))
        addView(sideItem("⚙", "الإعدادات", Intent(this@HomeActivity, SettingsActivity::class.java)))
    }

    private fun sideItem(icon: String, label: String, intent: Intent?, selected: Boolean = false): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(13), 0, dp(13), 0)
        isFocusable = !selected
        isFocusableInTouchMode = !selected
        isClickable = !selected
        background = if (selected) selectedBackground() else focusBackground(false)
        addView(TextView(this@HomeActivity).apply {
            text = label
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        addView(TextView(this@HomeActivity).apply {
            text = icon
            textSize = 21f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(38), LinearLayout.LayoutParams.MATCH_PARENT))
        if (!selected) {
            setOnFocusChangeListener { view, focused ->
                view.background = focusBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(85).start()
            }
            setOnClickListener { intent?.let(::startActivity) }
        }
    }.also { it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { bottomMargin = dp(5) } }

    private fun buildHero(): FrameLayout {
        val frame = FrameLayout(this).apply {
            background = heroPanel()
            clipToOutline = true
        }
        heroImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.60f
            setBackgroundColor(0xFF0B0810.toInt())
        }
        frame.addView(heroImage, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val scrim = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF20A0710.toInt(), 0xA30D0915.toInt(), 0x1A0B0710))
        }
        frame.addView(scrim, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(38), dp(22), dp(38), dp(22))
        }
        heroBadge = TextView(this).apply {
            text = "BLOFY"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFF59E4C7.toInt())
            gravity = Gravity.RIGHT
        }
        heroTitle = TextView(this).apply {
            text = "محتواك جاهز"
            textSize = 35f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            maxLines = 2
            setPadding(0, dp(6), 0, 0)
        }
        heroMeta = TextView(this).apply {
            textSize = 15f
            setTextColor(0xFFD0B8E8.toInt())
            gravity = Gravity.RIGHT
            setPadding(0, dp(7), 0, dp(8))
        }
        heroPlot = TextView(this).apply {
            text = "أحدث الأفلام والمسلسلات من قائمتك"
            textSize = 16f
            setTextColor(0xFFE4DEE9.toInt())
            gravity = Gravity.RIGHT
            maxLines = 3
            setLineSpacing(0f, 1.12f)
            setPadding(0, 0, 0, dp(16))
        }
        info.addView(heroBadge)
        info.addView(heroTitle, LinearLayout.LayoutParams(dp(720), LinearLayout.LayoutParams.WRAP_CONTENT))
        info.addView(heroMeta, LinearLayout.LayoutParams(dp(720), LinearLayout.LayoutParams.WRAP_CONTENT))
        info.addView(heroPlot, LinearLayout.LayoutParams(dp(720), LinearLayout.LayoutParams.WRAP_CONTENT))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
        }
        heroPrimary = heroButton("▶  التفاصيل", primary = true) { openHeroItem() }
        heroSecondary = heroButton("التالي  ›", primary = false) { nextHero() }
        actions.addView(heroPrimary, LinearLayout.LayoutParams(dp(180), dp(58)).apply { marginStart = dp(10) })
        actions.addView(heroSecondary, LinearLayout.LayoutParams(dp(145), dp(58)))
        info.addView(actions)
        frame.addView(info, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return frame
    }

    private fun loadLocalHomeContent() {
        lifecycleScope.launch {
            val loaded = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                val movies = dao.streams(provider.id, "movie", null).first()
                val series = dao.streams(provider.id, "series", null).first()
                provider.id to (movies + series)
                    .sortedWith(compareByDescending<StreamEntity> { it.addedAt ?: 0L }.thenBy { it.name })
                    .take(12)
            } ?: return@launch
            providerId = loaded.first
            heroItems = loaded.second
            heroIndex = 0
            renderHero(animated = false)
            renderFeatured()
            handler.removeCallbacks(rotateHero)
            handler.postDelayed(rotateHero, HERO_INTERVAL_MS)
        }
    }

    private fun renderHero(animated: Boolean) {
        val item = heroItems.getOrNull(heroIndex) ?: return
        if (animated) {
            heroImage.animate().alpha(0.15f).setDuration(120).withEndAction {
                ArtworkLoader.load(heroImage, item.backdrop ?: item.icon)
                heroImage.animate().alpha(0.60f).setDuration(260).start()
            }.start()
        } else {
            ArtworkLoader.load(heroImage, item.backdrop ?: item.icon)
            heroImage.alpha = 0.60f
        }
        heroBadge.text = if (item.kind == "series") "مسلسل" else "فيلم"
        heroTitle.text = item.name
        heroMeta.text = listOfNotNull(
            item.year?.takeIf { it.isNotBlank() },
            item.genre?.takeIf { it.isNotBlank() }?.substringBefore(','),
            item.rating?.takeIf { it.isNotBlank() }?.let { "★ $it" }
        ).joinToString("  •  ")
        heroPlot.text = item.plot?.takeIf { it.isNotBlank() } ?: "اكتشف هذا المحتوى الآن على BLOFY PLAYER"
    }

    private fun renderFeatured() {
        featuredRow.removeAllViews()
        heroItems.take(6).forEach { item ->
            val card = FrameLayout(this).apply {
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                background = focusBackground(false)
                clipToOutline = true
                val image = ImageView(this@HomeActivity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    setBackgroundColor(0xFF15101E.toInt())
                }
                addView(image, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                ArtworkLoader.load(image, item.icon ?: item.backdrop)
                val shade = View(this@HomeActivity).apply {
                    background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00100A17, 0xD90A0710.toInt()))
                }
                addView(shade, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                addView(TextView(this@HomeActivity).apply {
                    text = item.name
                    textSize = 13f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.BOTTOM or Gravity.RIGHT
                    maxLines = 2
                    setPadding(dp(12), dp(8), dp(12), dp(12))
                }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                setOnFocusChangeListener { view, focused ->
                    view.background = focusBackground(focused)
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.045f else 1f).scaleY(if (focused) 1.045f else 1f).translationZ(if (focused) 15f else 2f).setDuration(90).start()
                }
                setOnClickListener { openItem(item) }
            }
            featuredRow.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(5); marginEnd = dp(5) })
        }
    }

    private fun nextHero() {
        if (heroItems.isEmpty()) return
        heroIndex = (heroIndex + 1) % heroItems.size
        renderHero(animated = true)
    }

    private fun openHeroItem() = heroItems.getOrNull(heroIndex)?.let(::openItem)

    private fun openItem(item: StreamEntity) {
        if (providerId.isBlank()) return
        startActivity(Intent(this, if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId)
            putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, item.key)
        })
    }

    private fun infoCard(title: String, subtitle: String, intent: Intent) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(20), dp(12), dp(20), dp(12))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = focusBackground(false)
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 17f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 12f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT; setPadding(0, dp(4), 0, 0) })
        setOnFocusChangeListener { view, focused -> view.background = focusBackground(focused); view.animate().scaleX(if (focused) 1.02f else 1f).scaleY(if (focused) 1.02f else 1f).setDuration(80).start() }
        setOnClickListener { startActivity(intent) }
    }

    private fun navButton(label: String, intent: Intent) = heroButton(label, false) { startActivity(intent) }

    private fun heroButton(label: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        isFocusable = true
        isFocusableInTouchMode = true
        background = buttonBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused, primary)
            view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(80).start()
        }
        setOnClickListener { action() }
    }

    private fun contentIntent(kind: String): Intent {
        val device = DeviceClass.detect(this)
        if (device == DeviceClass.Kind.PHONE) {
            return Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)
        }
        return if (kind == "live") {
            Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_LIVE)
        } else {
            Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, if (kind == "series") PosterCatalogActivity.KIND_SERIES else PosterCatalogActivity.KIND_MOVIE)
        }
    }

    private fun panelBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xED171020.toInt(), 0xF20B0811.toInt())).apply {
        cornerRadius = dp(22).toFloat(); setStroke(dp(1), 0x554B3761)
    }

    private fun heroPanel() = GradientDrawable().apply {
        cornerRadius = dp(24).toFloat(); setColor(0xFF0C0912.toInt()); setStroke(dp(1), 0x665D3C77)
    }

    private fun selectedBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF5A1DC1.toInt(), 0xFF9B2DCE.toInt())).apply {
        cornerRadius = dp(16).toFloat(); setStroke(dp(1), 0xFFD697FF.toInt())
    }

    private fun focusBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF632A9E.toInt(), 0xFF281535.toInt()) else intArrayOf(0xE91A1424.toInt(), 0xF00C0912.toInt())
    ).apply {
        cornerRadius = dp(16).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFE2B7FF.toInt() else 0x554C385E)
    }

    private fun buttonBackground(focused: Boolean, primary: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            focused -> intArrayOf(0xFF9C46E8.toInt(), 0xFF6B25C7.toInt())
            primary -> intArrayOf(0xFF6B27C7.toInt(), 0xFF45168B.toInt())
            else -> intArrayOf(0xDD25172F.toInt(), 0xE6150E1D.toInt())
        }
    ).apply {
        cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x665D3D78)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        handler.removeCallbacks(rotateHero)
        super.onDestroy()
    }

    companion object {
        private const val HERO_INTERVAL_MS = 6500L
        private val TEXT_MUTED = Color.rgb(187, 170, 204)
    }
}
