package tv.blofy.player.ui.home

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Remote-first TV cinema surface. The existing right sidebar is retained.
 * Only the user's actual catalogue supplies images, titles, and links.
 * The hero never auto-plays content or switches provider without consent.
 */
internal class CinematicTvSpotlight(
    private val host: AppCompatActivity,
    private val openItem: (ProviderEntity, StreamEntity, Boolean) -> Unit,
    private val registerFocus: (String, View) -> Unit
) {
    private val artwork = ImageView(host).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        setBackgroundColor(BlofyTvDesign.Surface)
        contentDescription = "صورة العمل المميز"
    }
    private val name = label("مكتبتك السينمائية", 31f, true)
    private val info = label("كل أفلامك ومسلسلاتك من قائمتك الحالية", 15f)
    private val counter = label("BLOFY CINEMA", 13f)
    private var owner: ProviderEntity? = null
    private var featured = emptyList<StreamEntity>()
    private var recentTitles = emptyList<StreamEntity>()
    private var topRatedTitles = emptyList<StreamEntity>()
    private var index = 0
    // A TV's logical height can be 540dp even at 1080p. Prevent clipping on 720p/1080p boxes.
    private val compactTv = host.resources.configuration.screenHeightDp < 700
    private val posterImageHeight = if (compactTv) 61 else 91
    private val posterCardHeight = posterImageHeight + 27
    private val posterRow = LinearLayout(host).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        gravity = Gravity.CENTER_VERTICAL
    }
    private val watch = button("▶  مشاهدة", "tv_cinema_watch", true) {
        selected()?.let { (provider, item) -> openItem(provider, item, true) }
    }
    private val details = button("معلومات العمل", "tv_cinema_details") {
        selected()?.let { (provider, item) -> openItem(provider, item, false) }
    }
    private val previous = button("‹", "tv_cinema_previous") { change(-1) }
    private val next = button("›", "tv_cinema_next") { change(1) }
    private val newest = button("أحدث الإضافات", "tv_cinema_newest") {
        showPosters(recentTitles)
    }
    private val topTen = button("★ أفضل 10", "tv_cinema_top10") {
        showPosters(topRatedTitles, ranked = true)
    }

    fun hero(): View {
        val root = FrameLayout(host).apply {
            background = BlofyTvDesign.posterCard(dp(23).toFloat())
            clipToOutline = true
        }
        root.addView(artwork, FrameLayout.LayoutParams(-1, -1))
        root.addView(View(host).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xEC10091C.toInt(), 0xCF100B21.toInt(), 0x58080411, 0x10080411))
        }, FrameLayout.LayoutParams(-1, -1))
        val content = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(36), dp(20), dp(36), dp(24))
        }
        content.addView(label("✦  BLOFY PLAYER  •  CINEMA", 13f, true).apply {
            setTextColor(BlofyTvDesign.PurpleSoft)
        })
        content.addView(name, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        content.addView(info, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(7)
            bottomMargin = dp(16)
        })
        val actions = LinearLayout(host).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        actions.addView(watch, LinearLayout.LayoutParams(dp(168), dp(52)).apply { marginEnd = dp(10) })
        actions.addView(details, LinearLayout.LayoutParams(dp(173), dp(52)).apply { marginEnd = dp(10) })
        actions.addView(previous, LinearLayout.LayoutParams(dp(58), dp(52)).apply { marginEnd = dp(6) })
        actions.addView(next, LinearLayout.LayoutParams(dp(58), dp(52)))
        content.addView(actions)
        content.addView(counter, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        root.addView(content, FrameLayout.LayoutParams(-1, -1))
        watch.isEnabled = false
        details.isEnabled = false
        previous.isEnabled = false
        next.isEnabled = false
        return root
    }

    fun railHeader(): View = LinearLayout(host).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        addView(label("اختيارات سينمائية", 18f, true), LinearLayout.LayoutParams(0, dp(38), 1f))
        addView(newest, LinearLayout.LayoutParams(dp(143), dp(36)).apply { marginEnd = dp(8) })
        addView(topTen, LinearLayout.LayoutParams(dp(122), dp(36)))
        newest.isEnabled = false
        topTen.isEnabled = false
    }

    fun rail(): View = HorizontalScrollView(host).apply {
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        isFocusable = false
        clipChildren = false
        clipToPadding = false
        setPadding(dp(6), 0, dp(6), 0)
        addView(posterRow)
        posterRow.addView(label("جاري تحميل المكتبة…", 15f),
            LinearLayout.LayoutParams(dp(240), dp(posterCardHeight)))
    }

    fun load() {
        host.lifecycleScope.launch {
            val snapshot = try {
                withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(host.applicationContext).dao()
                    val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                    Triple(
                        provider,
                        dao.latestHomeStreams(provider.id, 80),
                        dao.highRatedHomeStreams(provider.id, 10)
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                null
            }
            if (host.isFinishing || host.isDestroyed) return@launch
            if (snapshot == null) {
                showEmpty("أضف قائمة Xtream أو M3U لعرض المحتوى")
                return@launch
            }
            owner = snapshot.first
            val titles = snapshot.second.filter { !it.locked && it.kind in setOf("movie", "series") }
            recentTitles = titles.take(15)
            topRatedTitles = snapshot.third.filter { !it.locked && it.kind in setOf("movie", "series") }
            featured = CinematicHomePolicy.heroCandidates(titles)
            if (featured.isEmpty()) {
                showEmpty("لا توجد أفلام أو مسلسلات متاحة في هذه القائمة")
                return@launch
            }
            display(0)
            newest.isEnabled = recentTitles.isNotEmpty()
            topTen.isEnabled = topRatedTitles.isNotEmpty()
            showPosters(recentTitles)
            ArtworkLoader.prefetch(host, featured.map { it.backdrop ?: it.icon })
        }
    }

    private fun selected(): Pair<ProviderEntity, StreamEntity>? {
        val provider = owner ?: return null
        val item = featured.getOrNull(index) ?: return null
        return provider to item
    }

    private fun change(direction: Int) {
        if (featured.size > 1) display((index + direction + featured.size) % featured.size)
    }

    private fun display(position: Int) {
        val item = featured.getOrNull(position) ?: return
        index = position
        name.text = item.name
        name.maxLines = 2
        info.text = listOfNotNull(
            item.year?.takeIf(String::isNotBlank),
            item.genre?.takeIf(String::isNotBlank)?.take(52),
            CinematicHomePolicy.ratingBadge(item.rating)?.let { "$it • تقييم القائمة" },
            if (item.kind == "series") "مسلسل" else "فيلم"
        ).joinToString("  •  ")
        counter.text = if (featured.size > 1) {
            "مميز  ${position + 1} / ${featured.size}"
        } else "مميز من مكتبتك"
        watch.text = if (item.kind == "series") "▶  الحلقات" else "▶  مشاهدة"
        ArtworkLoader.load(artwork, listOf(item.backdrop, item.icon))
        watch.isEnabled = true
        details.isEnabled = true
        previous.isEnabled = featured.size > 1
        next.isEnabled = featured.size > 1
    }

    private fun showPosters(items: List<StreamEntity>, ranked: Boolean = false) {
        posterRow.removeAllViews()
        val provider = owner ?: return
        items.forEachIndexed { rank, item ->
            val card = LinearLayout(host).apply {
                orientation = LinearLayout.VERTICAL
                background = BlofyTvDesign.posterCard(dp(12).toFloat())
                isFocusable = true
                isClickable = true
                contentDescription = if (ranked) "المركز ${rank + 1}: ${item.name}" else item.name
            }
            val poster = ImageView(host).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = BlofyTvDesign.posterCard(dp(12).toFloat())
                clipToOutline = true
            }
            ArtworkLoader.load(poster, item.icon)
            card.addView(poster, LinearLayout.LayoutParams(-1, dp(posterImageHeight)))
            card.addView(label((if (ranked) "${rank + 1}  •  " else "") + item.name, 12f).apply {
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(dp(5), 0, dp(5), 0)
            }, LinearLayout.LayoutParams(-1, dp(27)))
            card.setOnClickListener { openItem(provider, item, false) }
            card.setOnFocusChangeListener { view, focused ->
                if (focused) FocusMemory.save(host, "home", if (ranked) "tv_cinema_top_${item.key}" else "tv_cinema_poster_${item.key}")
                view.background = BlofyTvDesign.posterCard(dp(12).toFloat(), focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.045f else 1f)
                    .scaleY(if (focused) 1.045f else 1f).setDuration(105L).start()
            }
            registerFocus(if (ranked) "tv_cinema_top_${item.key}" else "tv_cinema_poster_${item.key}", card)
            posterRow.addView(card, LinearLayout.LayoutParams(dp(if (compactTv) 118 else 140), dp(posterCardHeight)).apply { marginEnd = dp(12) })
        }
    }

    private fun showEmpty(message: String) {
        name.text = "BLOFY CINEMA"
        info.text = message
        counter.text = "مكتبتك • خصوصيتك"
        posterRow.removeAllViews()
        posterRow.addView(label(message, 15f), LinearLayout.LayoutParams(-2, dp(posterCardHeight)))
    }

    private fun button(title: String, key: String, primary: Boolean = false, pressed: () -> Unit) =
        Button(host).apply {
            text = title
            isAllCaps = false
            textSize = 15f
            minWidth = 0
            minHeight = 0
            setTextColor(Color.WHITE)
            typeface = BlofyTvDesign.HeadingTypeface
            BlofyTvDesign.installTvFocus(this, dp(15).toFloat(), 1.04f, primary) {
                FocusMemory.save(host, "home", key)
            }
            setOnClickListener { pressed() }
            registerFocus(key, this)
        }

    private fun label(value: String, size: Float, bold: Boolean = false) = TextView(host).apply {
        text = value
        textSize = size
        setTextColor(if (bold) BlofyTvDesign.TextPrimary else BlofyTvDesign.TextSecondary)
        typeface = if (bold) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
        gravity = Gravity.RIGHT
    }

    private fun dp(n: Int) = (n * host.resources.displayMetrics.density).toInt()
}
