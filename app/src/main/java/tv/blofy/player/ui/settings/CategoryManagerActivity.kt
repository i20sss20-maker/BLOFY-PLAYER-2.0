package tv.blofy.player.ui.settings

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
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
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.M3uOrderReconciler
import tv.blofy.player.data.M3uOrderingPreference
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

class CategoryManagerActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private var providerId: String? = null
    private var currentKind = "live"
    private var currentItems: List<CategoryEntity> = emptyList()
    private var loadGeneration = 0
    private lateinit var m3uButton: Button
    private lateinit var sourceHostView: TextView
    private var isMatchingM3u = false
    private var orderFeedback: String? = null
    private val isTv by lazy { DeviceClass.isTv(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(if (isTv) 34 else 18), dp(if (isTv) 26 else 18), dp(if (isTv) 34 else 18), dp(24))
            background = AppCompatResources.getDrawable(this@CategoryManagerActivity, R.drawable.blofy_home_background)
        }
        root.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(44)).apply { gravity = Gravity.START; bottomMargin = dp(12) })
        root.addView(TextView(this).apply {
            text = getString(R.string.category_manager_title)
            textSize = if (isTv) 28f else 24f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        status = TextView(this).apply {
            text = getString(R.string.category_manager_loading)
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
        }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(42)))

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.START
        }
        listOf("live" to getString(R.string.category_manager_live), "movie" to getString(R.string.category_manager_movies), "series" to getString(R.string.category_manager_series)).forEach { (kind, label) ->
            tabs.addView(actionButton(label) {
                currentKind = kind
                loadCategories()
            }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(6) })
        }
        root.addView(tabs, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(8) })

        sourceHostView = TextView(this).apply {
            text = "مصدر المحتوى الحالي"
            textSize = 12f
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            typeface = BlofyTvDesign.BodyTypeface
        }
        root.addView(sourceHostView, LinearLayout.LayoutParams(-1, dp(29)))

        // Some Xtream panels return a category/stream order different from their
        // own get.php M3U export. The owner explicitly chooses which to follow.
        m3uButton = actionButton("مطابقة ترتيب القائمة الأصلية M3U (القنوات والأفلام)") {
            matchM3uOrder()
        }
        root.addView(m3uButton, LinearLayout.LayoutParams(-1, dp(if (isTv) 52 else 60)).apply {
            bottomMargin = dp(8)
        })

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(0, dp(4), 0, dp(20))
        }
        root.addView(ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(list)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val selected = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
            }
            providerId = selected?.id
            val uri = runCatching { java.net.URI(selected?.baseUrl) }.getOrNull()
            val host = uri?.host?.let { name ->
                if (uri.port > 0) "$name:${uri.port}" else name
            } ?: "غير معروف"
            val fromM3u = selected?.id?.let {
                M3uOrderingPreference.enabled(applicationContext, it)
            } == true
            sourceHostView.text = "المصدر: $host • الترتيب: ${if (fromM3u) "M3U" else "Xtream API"}"
            loadCategories()
        }
    }

    private fun loadCategories() {
        val generation = ++loadGeneration
        val id = providerId ?: run {
            status.setText(R.string.category_manager_no_provider)
            list.removeAllViews()
            return
        }
        val kind = currentKind
        lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().categorySnapshot(id, kind)
                    .sortedBy { it.orderIndex }
            }
            if (generation != loadGeneration || kind != currentKind || isFinishing || isDestroyed) return@launch
            currentItems = items
            render(items, kind)
        }
    }

    private fun render(items: List<CategoryEntity>, kind: String) {
        list.removeAllViews()
        val hidden = items.count { it.hidden }
        status.text = orderFeedback ?: (
            getString(R.string.category_manager_status, kindLabel(kind), items.size, hidden) +
                " • حسب ترتيب المصدر الحالي"
        )
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = getString(R.string.category_manager_empty)
                textSize = 16f
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.START
                setPadding(dp(14), dp(24), dp(14), dp(24))
            })
            return
        }
        items.forEachIndexed { index, category ->
            list.addView(categoryCard(index, category), LinearLayout.LayoutParams(-1, if (isTv) dp(76) else LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(7)
            })
        }
    }

    private fun categoryCard(index: Int, category: CategoryEntity): LinearLayout = LinearLayout(this).apply {
        orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        layoutDirection = resources.configuration.layoutDirection
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = CinemaStyle.surface(this@CategoryManagerActivity)

        val title = LinearLayout(this@CategoryManagerActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            addView(TextView(this@CategoryManagerActivity).apply {
                text = category.name
                textSize = 15f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(if (category.hidden) BlofyTvDesign.TextMuted else Color.WHITE)
                gravity = Gravity.START
                maxLines = 1
            })
            addView(TextView(this@CategoryManagerActivity).apply {
                text = if (category.hidden) getString(R.string.category_manager_hidden) else getString(R.string.category_manager_visible_order, index + 1)
                textSize = 11.5f
                setTextColor(if (category.hidden) 0xFFFFB0B8.toInt() else BlofyTvDesign.Mint)
                gravity = Gravity.START
            })
        }
        addView(title, if (isTv) LinearLayout.LayoutParams(0, dp(58), 1f) else LinearLayout.LayoutParams(-1, dp(54)))

        val actions = LinearLayout(this@CategoryManagerActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            addView(smallButton(getString(if (category.hidden) R.string.category_manager_show else R.string.category_manager_hide)) { toggleHidden(category) }, LinearLayout.LayoutParams(0, dp(46), if (isTv) 0f else 1f).apply {
                if (isTv) width = dp(86)
                marginStart = dp(6)
            })
        }
        addView(actions, if (isTv) LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(54)) else LinearLayout.LayoutParams(-1, dp(54)))
    }

    private fun matchM3uOrder() {
        if (isMatchingM3u) return
        val id = providerId ?: return
        isMatchingM3u = true
        m3uButton.isEnabled = false
        status.text = "جار فحص ترتيب M3U الأصلي ومقارنته ببيانات بلوفي…"
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    val db = BlofyDatabase.get(applicationContext)
                    val provider = checkNotNull(db.dao().provider(id)) { "Playlist not found" }
                    M3uOrderReconciler(db).apply(provider)
                }
                M3uOrderingPreference.enable(applicationContext, id)
                CatalogSyncState.markOrderChanged(applicationContext, id)
                sourceHostView.text = sourceHostView.text.toString().substringBefore(" • الترتيب:") +
                    " • الترتيب: M3U"
                orderFeedback = "تمت مطابقة ${result.liveMatched}/${result.liveTotal} قناة و" +
                    "${result.movieMatched}/${result.movieTotal} فيلم • " +
                    "${result.categoryMatches} فئة. سيُحفظ ترتيب M3U عند تحديث الباقة."
            } catch (failure: kotlinx.coroutines.CancellationException) {
                throw failure
            } catch (_: Exception) {
                orderFeedback = "تعذرت المطابقة: السيرفر لم يوفر M3U مكتملًا ومتوافقًا. لم نغير ترتيبك السابق."
            } finally {
                isMatchingM3u = false
                m3uButton.isEnabled = true
                loadCategories()
            }
        }
    }

    private fun toggleHidden(category: CategoryEntity) {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().upsertCategories(listOf(category.copy(hidden = !category.hidden)))
            }
            loadCategories()
        }
    }

    private fun kindLabel(kind: String) = when (kind) {
        "movie" -> getString(R.string.category_manager_movies)
        "series" -> getString(R.string.category_manager_series)
        else -> getString(R.string.category_manager_live)
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        CinemaStyle.styleButton(this)
        setOnClickListener { action() }
    }

    private fun smallButton(label: String, action: () -> Unit) = actionButton(label, action).apply {
        minWidth = 0
        minimumWidth = 0
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
