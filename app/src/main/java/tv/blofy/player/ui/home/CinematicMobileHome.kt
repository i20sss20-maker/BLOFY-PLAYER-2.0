package tv.blofy.player.ui.home

import android.app.Dialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.ColorDrawable
import android.os.Handler
import android.os.Looper
import android.graphics.Rect
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.playlist.PlaylistActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

/**
 * Cinema-style mobile home, driven only by the current user's authorized catalog.
 * A missing metadata image stays empty; no example/movie art is substituted.
 * The Android TV dashboard is intentionally not replaced.
 */
internal class CinematicMobileHome(
    private val host: AppCompatActivity,
    private val catalogIntent: (String) -> Intent
) {
    private val compact = host.resources.configuration.screenWidthDp < 600
    private val body = LinearLayout(host).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
    }
    private val rails = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL }
    private val heroArt = ImageView(host).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        setBackgroundColor(BlofyTvDesign.Surface)
        contentDescription = "صورة العمل المميز"
    }
    private val heroTitle = label("مكتبتك السينمائية", if (compact) 26f else 35f, true)
    private val heroMeta = label("أفلام • مسلسلات • بث مباشر", 13f)
    private val heroRating = label("", 13f)
    private val heroCounter = label("", 14f, true)
    private lateinit var heroPlayButton: Button
    private var heroCandidates: List<StreamEntity> = emptyList()
    private var heroPosition = 0
    private var featured: StreamEntity? = null
    private var selectedProvider: ProviderEntity? = null
    private var continuing: Map<String, Int> = emptyMap()
    private val handler = Handler(Looper.getMainLooper())
    private val heroClock = object : Runnable {
        override fun run() {
            if (!body.isAttachedToWindow) return
            val visible = Rect()
            val reducedMotion = host.getSharedPreferences("blofy_player_settings", 0)
                .getString("motion_mode", "smooth") == "reduced"
            if (!reducedMotion && heroArt.getGlobalVisibleRect(visible) &&
                visible.height() > dp(110) && heroCandidates.size > 1) {
                showHero((heroPosition + 1) % heroCandidates.size)
            }
            handler.postDelayed(this, 9500L)
        }
    }

    fun build(): View {
        val shell = ScrollView(host).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF140A20.toInt(), 0xFF08060D.toInt(), 0xFF090612.toInt()))
        }
        shell.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
                handler.removeCallbacks(heroClock)
                handler.postDelayed(heroClock, 9500L)
            }
            override fun onViewDetachedFromWindow(view: View) { handler.removeCallbacks(heroClock) }
        })
        body.setPadding(dp(if (compact) 15 else 38), dp(14), dp(if (compact) 15 else 38), dp(34))
        shell.addView(body, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        body.addView(header(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { bottomMargin = dp(17) })
        body.addView(hero(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(if (compact) 390 else 460)).apply { bottomMargin = dp(9) })
        body.addView(heroPager(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(41)).apply { bottomMargin = dp(10) })
        body.addView(quickDestinations(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(66)).apply { bottomMargin = dp(22) })
        rails.addView(label("جارٍ عرض مكتبتك…", 15f), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
        body.addView(rails)
        host.lifecycleScope.launch {
            val snapshot = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(host.applicationContext).dao()
                val provider = dao.providers().first().firstOrNull()
                if (provider == null) null else HomeSnapshot(
                    provider,
                    dao.latestHomeStreams(provider.id, 220),
                    dao.latestHomeOfKind(provider.id, "movie", 18),
                    dao.latestHomeOfKind(provider.id, "series", 18),
                    dao.highRatedHomeStreams(provider.id, 10),
                    dao.continueWatching(provider.id, 10).first().mapNotNull { dao.stream(it.contentKey) }
                        .filter { it.kind == "movie" || it.kind == "series" },
                    dao.continueWatching(provider.id, 10).first().mapNotNull {
                        if (it.durationMs <= 0L) null else it.contentKey to
                            (it.positionMs * 100L / it.durationMs).toInt().coerceIn(1, 99)
                    }.toMap()
                )
            }
            if (host.isFinishing || host.isDestroyed) return@launch
            render(snapshot)
        }
        return shell
    }

    private fun header(): View {
        val row = LinearLayout(host).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER_VERTICAL
        }
        val menuButton = glyph("☰", "فتح القائمة")
        row.addView(menuButton, LinearLayout.LayoutParams(dp(42), dp(46)))
        menuButton.setOnClickListener {
            showDrawer("استكشف BLOFY", listOf(
                "الرئيسية" to {},
                "الأفلام" to { openCatalog("movie") },
                "المسلسلات" to { openCatalog("series") },
                "البث المباشر" to { openCatalog("live") },
                "المفضلة" to { openLibrary(LibraryActivity.MODE_FAVORITES) },
                "متابعة المشاهدة" to { openLibrary(LibraryActivity.MODE_CONTINUE) },
                "إدارة القوائم" to { start(PlaylistActivity::class.java) },
                "الإعدادات" to { start(SettingsActivity::class.java) }
            ))
        }
        row.addView(ImageView(host).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "BLOFY PLAYER"
        }, LinearLayout.LayoutParams(dp(70), dp(46)))
        row.addView(View(host), LinearLayout.LayoutParams(0, dp(1), 1f))
        val search = glyph("⌕", "البحث")
        search.setOnClickListener { start(SearchActivity::class.java) }
        row.addView(search, LinearLayout.LayoutParams(dp(43), dp(46)))
        val saved = glyph("♡", "المفضلة")
        saved.setOnClickListener { openLibrary(LibraryActivity.MODE_FAVORITES) }
        row.addView(saved, LinearLayout.LayoutParams(dp(43), dp(46)))
        val profile = glyph("◉", "حسابي والإعدادات")
        profile.setOnClickListener {
            showDrawer("حساب BLOFY", listOf(
                "إدارة قوائم التشغيل" to { start(PlaylistActivity::class.java) },
                "المفضلة" to { openLibrary(LibraryActivity.MODE_FAVORITES) },
                "إعدادات التطبيق" to { start(SettingsActivity::class.java) }
            ))
        }
        row.addView(profile, LinearLayout.LayoutParams(dp(43), dp(46)))
        return row
    }

    private fun hero(): View {
        val panel = FrameLayout(host).apply {
            background = BlofyTvDesign.posterCard(dp(22).toFloat())
            clipToOutline = true
        }
        panel.addView(heroArt, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        panel.addView(View(host).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0x180A0718, 0x25090713, 0xCB180E26.toInt(), 0xFD090611.toInt()))
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        panel.addView(label("✦  BLOFY CINEMA", 12f, true).apply {
            gravity = Gravity.RIGHT
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(18), dp(17), dp(18), 0)
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54), Gravity.TOP))
        val text = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            setPadding(dp(19), dp(15), dp(19), dp(22))
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        text.addView(label("BLOFY  •  اختير لك", 12f).apply { setTextColor(BlofyTvDesign.Mint) })
        text.addView(heroTitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
        })
        text.addView(heroMeta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(7); bottomMargin = dp(6)
        })
        heroRating.setTextColor(BlofyTvDesign.Amber)
        text.addView(heroRating, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(15)
        })
        val actions = LinearLayout(host).apply { gravity = Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        heroPlayButton = action("▶  تشغيل", primary = true) {
            val provider = selectedProvider
            val item = featured
            if (provider != null && item != null) openItem(provider, item, playDirectly = true) else openCatalog("movie")
        }
        actions.addView(heroPlayButton, LinearLayout.LayoutParams(0, dp(52), 1.25f).apply { marginEnd = dp(8) })
        actions.addView(action("المزيد من التفاصيل") {
            val provider = selectedProvider
            val item = featured
            if (provider != null && item != null) openItem(provider, item) else openCatalog("series")
        }, LinearLayout.LayoutParams(0, dp(52), 1f))
        text.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        panel.addView(text, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        return panel
    }

    private fun heroPager(): View {
        val row = LinearLayout(host).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        row.addView(heroCounter, LinearLayout.LayoutParams(0, dp(40), 1f))
        val previous = glyph("›", "العمل السابق")
        previous.setOnClickListener {
            if (heroCandidates.isNotEmpty()) showHero((heroPosition + heroCandidates.size - 1) % heroCandidates.size)
        }
        val next = glyph("‹", "العمل التالي")
        next.setOnClickListener {
            if (heroCandidates.isNotEmpty()) showHero((heroPosition + 1) % heroCandidates.size)
        }
        row.addView(previous, LinearLayout.LayoutParams(dp(40), dp(40)))
        row.addView(next, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(8) })
        return row
    }

    private fun showHero(index: Int) {
        val item = heroCandidates.getOrNull(index) ?: return
        heroPosition = index
        featured = item
        heroTitle.text = item.name
        heroTitle.maxLines = 2
        heroTitle.ellipsize = android.text.TextUtils.TruncateAt.END
        heroMeta.text = listOfNotNull(
            item.genre?.takeIf(String::isNotBlank)?.take(40),
            item.year?.takeIf(String::isNotBlank),
            if (item.kind == "series") "مسلسل" else "فيلم"
        ).joinToString("  •  ")
        heroRating.text = CinematicHomePolicy.ratingBadge(item.rating)
            ?.let { "$it  •  تقييم المصدر" } ?: "شاهد تفاصيل العمل"
        heroPlayButton.text = if (item.kind == "series") "▶  الحلقات" else "▶  تشغيل"
        heroCounter.text = if (heroCandidates.size > 1) {
            "المميز  •  ${index + 1} / ${heroCandidates.size}"
        } else "المميز"
        ArtworkLoader.load(heroArt, listOf(item.backdrop, item.icon))
    }

    private fun quickDestinations(): View = LinearLayout(host).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        addView(action("◉  مباشر") { openCatalog("live") }, LinearLayout.LayoutParams(0, dp(60), 1f).apply { marginEnd = dp(4) })
        addView(action("▣  أفلام") { openCatalog("movie") }, LinearLayout.LayoutParams(0, dp(60), 1f).apply { marginEnd = dp(4) })
        addView(action("▤  مسلسلات") { openCatalog("series") }, LinearLayout.LayoutParams(0, dp(60), 1f))
    }

    private fun render(snapshot: HomeSnapshot?) {
        rails.removeAllViews()
        if (snapshot == null) {
            rails.addView(label("أضف قائمة M3U أو Xtream لتظهر مكتبتك هنا.", 16f))
            rails.addView(action("إدارة قوائم التشغيل") { start(PlaylistActivity::class.java) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)).apply { topMargin = dp(12) })
            return
        }
        selectedProvider = snapshot.provider
        continuing = snapshot.continueProgress
        heroCandidates = CinematicHomePolicy.heroCandidates(snapshot.latest)
        showHero(0)
        ArtworkLoader.prefetch(host, heroCandidates.map { it.backdrop ?: it.icon })
        if (snapshot.latest.isEmpty()) {
            rails.addView(label("لا توجد أفلام أو مسلسلات في القائمة المختارة.", 16f))
            return
        }
        addRail("متابعة المشاهدة", snapshot.continueItems, snapshot.provider)
        addRail("أحدث الإضافات", snapshot.latest, snapshot.provider)
        addRankedRail("أفضل 10 حسب تقييم المصدر", snapshot.rated, snapshot.provider)
        addRail("عالم الأفلام", snapshot.movies, snapshot.provider)
        addRail("عالم المسلسلات", snapshot.series, snapshot.provider)
        val universes = CinematicHomePolicy.universeRails(snapshot.latest)
        universes.forEach { collection ->
            addRail(collection.title, collection.items, snapshot.provider)
        }
    }

    private fun addRail(title: String, items: List<StreamEntity>, provider: ProviderEntity) {
        if (items.isEmpty()) return
        rails.addView(sectionTitle(title), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))
        val row = LinearLayout(host).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        items.take(18).forEach { item ->
            val poster = poster(item, provider)
            row.addView(poster, LinearLayout.LayoutParams(dp(if (compact) 130 else 164), dp(if (compact) 211 else 255)).apply {
                marginEnd = dp(11)
            })
        }
        rails.addView(HorizontalScrollView(host).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(row)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(if (compact) 224 else 270)))
    }

    private fun addRankedRail(title: String, items: List<StreamEntity>, provider: ProviderEntity) {
        if (items.isEmpty()) return
        rails.addView(sectionTitle(title), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))
        val row = LinearLayout(host).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        items.take(10).forEachIndexed { index, item ->
            val cell = FrameLayout(host)
            cell.addView(label((index + 1).toString(), 90f, true).apply {
                alpha = .23f
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.CENTER_VERTICAL
            }, FrameLayout.LayoutParams(dp(73), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.RIGHT))
            cell.addView(poster(item, provider), FrameLayout.LayoutParams(dp(if (compact) 120 else 155), dp(if (compact) 192 else 240), Gravity.LEFT or Gravity.BOTTOM))
            row.addView(cell, LinearLayout.LayoutParams(dp(if (compact) 160 else 195), dp(if (compact) 199 else 248)).apply { marginEnd = dp(5) })
        }
        rails.addView(HorizontalScrollView(host).apply {
            isHorizontalScrollBarEnabled = false
            addView(row)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(if (compact) 212 else 255)))
    }

    private fun poster(item: StreamEntity, provider: ProviderEntity): View {
        val frame = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            background = BlofyTvDesign.posterCard(dp(14).toFloat())
            clipToOutline = true
            isClickable = true
            isFocusable = true
            contentDescription = item.name
            setOnClickListener { openItem(provider, item) }
        }
        val art = ImageView(host).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
        }
        ArtworkLoader.load(art, item.icon)
        frame.addView(art, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        continuing[item.key]?.let { percent ->
            frame.addView(ProgressBar(host, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100
                progress = percent
                progressTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
                progressBackgroundTintList = ColorStateList.valueOf(BlofyTvDesign.SurfaceRaised)
                contentDescription = "شاهدت $percent بالمئة"
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4)))
        }
        frame.setOnFocusChangeListener { view, focused ->
            view.background = BlofyTvDesign.posterCard(dp(14).toFloat(), focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.045f else 1f)
                .scaleY(if (focused) 1.045f else 1f)
                .setDuration(if (focused) 110L else 90L).start()
        }
        frame.addView(label(item.name, 12f).apply {
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(7), dp(4), dp(7), dp(5))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(31)))
        return frame
    }

    private fun openItem(provider: ProviderEntity, item: StreamEntity, playDirectly: Boolean = false) {
        val proceed = {
            when {
                item.kind == "movie" && playDirectly -> host.startActivity(Intent(host, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.movie(provider, item))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, item.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                    putExtra(PlayerActivity.EXTRA_KIND, "movie")
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
                    putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(item))
                    putExtra(PlayerActivity.EXTRA_TITLE, item.name)
                })
                item.kind == "movie" -> host.startActivity(Intent(host, MovieDetailsActivity::class.java)
                    .putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                    .putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, item.key))
                item.kind == "series" -> host.startActivity(Intent(host, SeriesDetailsActivity::class.java)
                    .putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                    .putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, item.key))
                else -> Unit
            }
        }
        if (item.locked) ParentalGate.requirePin(host) { proceed() } else proceed()
    }

    private fun showDrawer(title: String, entries: List<Pair<String, () -> Unit>>) {
        val dialog = Dialog(host)
        val backdrop = FrameLayout(host).apply {
            setBackgroundColor(0xDF05030B.toInt())
            setOnClickListener { dialog.dismiss() }
        }
        val pane = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(43), dp(20), dp(20))
            background = BlofyTvDesign.elevatedSurface(dp(24).toFloat(), emphasis = true)
            isClickable = true
        }
        pane.addView(label("✕  $title", 24f, true).apply {
            setOnClickListener { dialog.dismiss() }
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)).apply { bottomMargin = dp(10) })
        entries.forEach { (name, open) ->
            pane.addView(label(name, 22f, true).apply {
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                alpha = if (name == "الرئيسية") 1f else 0.85f
                isClickable = true
                isFocusable = true
                setPadding(dp(8), 0, dp(8), 0)
                setOnClickListener { dialog.dismiss(); open() }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(57)))
        }
        backdrop.addView(pane, FrameLayout.LayoutParams(
            minOf(dp(320), host.resources.displayMetrics.widthPixels - dp(26)),
            ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.RIGHT))
        dialog.setContentView(backdrop)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun sectionTitle(title: String): TextView = label(title, if (compact) 20f else 24f, true).apply {
        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        setPadding(0, dp(10), 0, dp(2))
    }
    private fun label(text: String, sp: Float, bold: Boolean = false): TextView = TextView(host).apply {
        this.text = text
        textSize = sp
        typeface = if (bold) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
        setTextColor(if (bold) Color.WHITE else BlofyTvDesign.TextSecondary)
        gravity = Gravity.RIGHT
    }
    private fun glyph(text: String, description: String): TextView = label(text, 25f).apply {
        contentDescription = description
        gravity = Gravity.CENTER
        isClickable = true
        isFocusable = true
        background = BlofyTvDesign.glassPanel(dp(12).toFloat())
    }
    private fun action(text: String, primary: Boolean = false, pressed: () -> Unit): Button = Button(host).apply {
        this.text = text
        isAllCaps = false
        textSize = if (compact) 13f else 15f
        setTextColor(Color.WHITE)
        typeface = BlofyTvDesign.HeadingTypeface
        minHeight = 0
        minWidth = 0
        stateListAnimator = null
        BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.025f, primary)
        setOnClickListener { pressed() }
    }
    private fun openCatalog(kind: String) = host.startActivity(catalogIntent(kind))
    private fun openLibrary(mode: String) = host.startActivity(Intent(host, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, mode))
    private fun start(clazz: Class<*>) = host.startActivity(Intent(host, clazz))
    private fun dp(value: Int) = (value * host.resources.displayMetrics.density).toInt()

    private data class HomeSnapshot(
        val provider: ProviderEntity,
        val latest: List<StreamEntity>,
        val movies: List<StreamEntity>,
        val series: List<StreamEntity>,
        val rated: List<StreamEntity>,
        val continueItems: List<StreamEntity>,
        val continueProgress: Map<String, Int>
    )
}
