package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
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
import tv.blofy.player.ui.common.BlofyTvDesign
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
                renderHero(true)
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
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(202), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(20) })

        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        shell.addView(main, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        top.addView(TextView(this).apply {
            text = "اكتشف الآن"
            BlofyTvDesign.applyHeading(this)
            textSize = 28f
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(58), 1f))
        top.addView(navButton("⌕  بحث", Intent(this, SearchActivity::class.java)), LinearLayout.LayoutParams(dp(164), dp(52)))
        main.addView(top)
        main.addView(buildHero(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.5f))

        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(13), 0, dp(13))
            clipChildren = false
        }
        quick.addView(infoCard("تابع المشاهدة", "ارجع من حيث توقفت", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(10) })
        quick.addView(infoCard("المفضلة", "اختياراتك المحفوظة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(10) })
        quick.addView(infoCard("آخر قناة", "عودة سريعة للبث", Intent(this, RecentChannelsActivity::class.java)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        main.addView(quick, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.46f))

        main.addView(TextView(this).apply {
            text = "أضيف حديثًا"
            BlofyTvDesign.applyHeading(this)
            textSize = 20f
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)))

        featuredRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        main.addView(featuredRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.64f))
        return root
    }

    private fun buildSidebar(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(12), dp(14), dp(12), dp(14))
        background = BlofyTvDesign.elevatedSurface(dp(26).toFloat())
        elevation = dp(6).toFloat()
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(126), dp(88)).apply { bottomMargin = dp(12) })
        addView(sideItem("⌂", "الرئيسية", null, true))
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
        setPadding(dp(14), 0, dp(14), 0)
        isFocusable = !selected
        isFocusableInTouchMode = !selected
        isClickable = !selected
        background = if (selected) BlofyTvDesign.primaryButton(dp(19).toFloat(), false) else BlofyTvDesign.surface(dp(19).toFloat(), false)
        addView(TextView(this@HomeActivity).apply {
            text = label
            BlofyTvDesign.applyLabel(this)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        addView(TextView(this@HomeActivity).apply {
            text = icon
            textSize = 21f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(38), LinearLayout.LayoutParams.MATCH_PARENT))
        if (!selected) {
            setOnFocusChangeListener { view, focused -> animateFocus(view, focused) }
            setOnClickListener { intent?.let(::startActivity) }
        }
    }.also { it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { bottomMargin = dp(7) } }

    private fun buildHero(): FrameLayout {
        val frame = FrameLayout(this).apply {
            background = BlofyTvDesign.elevatedSurface(dp(30).toFloat())
            clipToOutline = true
            elevation = dp(7).toFloat()
        }
        heroImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.72f
            setBackgroundColor(BlofyTvDesign.Background)
        }
        frame.addView(heroImage, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        frame.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0x28100A17, 0xB50D0915.toInt(), 0xF407050C.toInt()))
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(48), dp(28), dp(48), dp(28))
        }
        heroBadge = TextView(this).apply {
            text = "BLOFY"
            textSize = BlofyTvDesign.CaptionSp
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.RIGHT
            background = BlofyTvDesign.badge(dp(14).toFloat())
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        heroTitle = TextView(this).apply {
            text = "محتواك جاهز"
            BlofyTvDesign.applyHeroTitle(this)
            textSize = 41f
            gravity = Gravity.RIGHT
            maxLines = 2
            setPadding(0, dp(9), 0, 0)
        }
        heroMeta = TextView(this).apply {
            textSize = 15.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
            setPadding(0, dp(10), 0, dp(10))
        }
        heroPlot = TextView(this).apply {
            text = "أحدث الأفلام والمسلسلات من قائمتك"
            BlofyTvDesign.applyBody(this)
            textSize = 16.5f
            gravity = Gravity.RIGHT
            maxLines = 3
            setPadding(0, 0, 0, dp(19))
        }
        info.addView(heroBadge)
        info.addView(heroTitle, LinearLayout.LayoutParams(dp(780), LinearLayout.LayoutParams.WRAP_CONTENT))
        info.addView(heroMeta, LinearLayout.LayoutParams(dp(780), LinearLayout.LayoutParams.WRAP_CONTENT))
        info.addView(heroPlot, LinearLayout.LayoutParams(dp(780), LinearLayout.LayoutParams.WRAP_CONTENT))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
            clipChildren = false
        }
        heroPrimary = heroButton("▶  التفاصيل", true) { openHeroItem() }
        heroSecondary = heroButton("التالي  ›", false) { nextHero() }
        actions.addView(heroPrimary, LinearLayout.LayoutParams(dp(192), dp(62)).apply { marginStart = dp(12) })
        actions.addView(heroSecondary, LinearLayout.LayoutParams(dp(154), dp(62)))
        info.addView(actions)
        frame.addView(info, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return frame
    }

    private fun loadLocalHomeContent() {
        lifecycleScope.launch {
            val loaded = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                provider.id to dao.latestHomeStreams(provider.id, 14)
            } ?: return@launch
            providerId = loaded.first
            heroItems = loaded.second
            heroIndex = 0
            renderHero(false)
            renderFeatured()
            ArtworkLoader.prefetch(this@HomeActivity, heroItems.take(8).flatMap { listOf(it.backdrop, it.icon) })
            handler.removeCallbacks(rotateHero)
            handler.postDelayed(rotateHero, HERO_INTERVAL_MS)
        }
    }

    private fun renderHero(animated: Boolean) {
        val item = heroItems.getOrNull(heroIndex) ?: return
        val candidates = listOf(item.backdrop, item.icon)
        if (animated) {
            heroImage.animate().cancel()
            heroImage.animate().alpha(0.20f).setDuration(110).withEndAction {
                ArtworkLoader.load(heroImage, candidates)
                heroImage.animate().alpha(0.72f).setDuration(250).start()
            }.start()
        } else {
            ArtworkLoader.load(heroImage, candidates)
            heroImage.alpha = 0.72f
        }
        heroBadge.text = if (item.kind == "series") "BLOFY  •  مسلسل" else "BLOFY  •  فيلم"
        heroTitle.text = item.name
        heroMeta.text = listOfNotNull(item.year?.takeIf { it.isNotBlank() }, item.genre?.takeIf { it.isNotBlank() }?.substringBefore(','), item.rating?.takeIf { it.isNotBlank() }?.let { "★ $it" }).joinToString("  •  ")
        heroPlot.text = item.plot?.takeIf { it.isNotBlank() } ?: "اكتشف هذا المحتوى الآن على BLOFY PLAYER"
    }

    private fun renderFeatured() {
        featuredRow.removeAllViews()
        heroItems.take(6).forEach { item ->
            val card = FrameLayout(this).apply {
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                background = BlofyTvDesign.surface(dp(18).toFloat(), false)
                clipToOutline = true
                elevation = dp(3).toFloat()
                val image = ImageView(this@HomeActivity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    setBackgroundColor(BlofyTvDesign.Surface)
                }
                addView(image, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                ArtworkLoader.load(image, listOf(item.icon, item.backdrop))
                addView(View(this@HomeActivity).apply {
                    background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00100A17, 0xE80A0710.toInt()))
                }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                addView(TextView(this@HomeActivity).apply {
                    text = item.name
                    textSize = 13.5f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(Color.WHITE)
                    gravity = Gravity.BOTTOM or Gravity.RIGHT
                    maxLines = 2
                    setPadding(dp(14), dp(8), dp(14), dp(14))
                }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                setOnFocusChangeListener { view, focused -> animateFocus(view, focused, 1.06f) }
                setOnClickListener { openItem(item) }
            }
            featuredRow.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(6); marginEnd = dp(6) })
        }
    }

    private fun nextHero() {
        if (heroItems.isEmpty()) return
        heroIndex = (heroIndex + 1) % heroItems.size
        renderHero(true)
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
        setPadding(dp(22), dp(13), dp(22), dp(13))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = BlofyTvDesign.surface(dp(20).toFloat(), false)
        addView(TextView(this@HomeActivity).apply {
            text = title
            textSize = 17.5f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            includeFontPadding = false
        })
        addView(TextView(this@HomeActivity).apply {
            text = subtitle
            textSize = 12.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(5), 0, 0)
        })
        setOnFocusChangeListener { view, focused -> animateFocus(view, focused) }
        setOnClickListener { startActivity(intent) }
    }

    private fun navButton(label: String, intent: Intent) = heroButton(label, false) { startActivity(intent) }

    private fun heroButton(label: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15.5f
        typeface = BlofyTvDesign.BodyTypeface
        includeFontPadding = false
        setTextColor(Color.WHITE)
        BlofyTvDesign.installTvFocus(this, dp(19).toFloat(), 1.045f, primary)
        setOnClickListener { action() }
    }

    private fun animateFocus(view: View, focused: Boolean, focusedScale: Float = 1.035f) {
        view.background = BlofyTvDesign.surface(dp(20).toFloat(), focused)
        view.animate().cancel()
        view.animate()
            .scaleX(if (focused) focusedScale else 1f)
            .scaleY(if (focused) focusedScale else 1f)
            .translationZ(if (focused) 16f else 2f)
            .alpha(if (focused) 1f else 0.97f)
            .setDuration(if (focused) 115L else 90L)
            .start()
    }

    private fun contentIntent(kind: String): Intent {
        val device = DeviceClass.detect(this)
        if (device == DeviceClass.Kind.PHONE) return Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)
        return if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_LIVE)
        else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, if (kind == "series") PosterCatalogActivity.KIND_SERIES else PosterCatalogActivity.KIND_MOVIE)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        handler.removeCallbacks(rotateHero)
        super.onDestroy()
    }

    companion object {
        private const val HERO_INTERVAL_MS = 6200L
    }
}
