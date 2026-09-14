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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), dp(26), dp(34), dp(30))
            background = AppCompatResources.getDrawable(this@CategoryManagerActivity, R.drawable.blofy_home_background)
        }
        root.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(44)).apply { gravity = Gravity.LEFT; bottomMargin = dp(12) })
        root.addView(TextView(this).apply {
            text = "ترتيب الفئات"
            textSize = 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        status = TextView(this).apply {
            text = "جاري قراءة الفئات..."
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(42)))

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
        }
        listOf("live" to "البث المباشر", "movie" to "الأفلام", "series" to "المسلسلات").forEach { (kind, label) ->
            tabs.addView(actionButton(label) {
                currentKind = kind
                loadCategories()
            }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(6) })
        }
        root.addView(tabs, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(8) })

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(4), 0, dp(20))
        }
        root.addView(ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(list)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            providerId = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()?.id
            }
            loadCategories()
        }
    }

    private fun loadCategories() {
        val id = providerId ?: run {
            status.text = "لا يوجد سيرفر نشط"
            list.removeAllViews()
            return
        }
        lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().categorySnapshot(id, currentKind)
                    .sortedWith(compareBy<CategoryEntity> { it.orderIndex }.thenBy { it.name.lowercase() })
            }
            currentItems = items
            render(items)
        }
    }

    private fun render(items: List<CategoryEntity>) {
        list.removeAllViews()
        val hidden = items.count { it.hidden }
        status.text = "${kindLabel(currentKind)} • ${items.size} فئة • المخفية $hidden"
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "ما فيه فئات محفوظة لهذا القسم"
                textSize = 16f
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.RIGHT
                setPadding(dp(14), dp(24), dp(14), dp(24))
            })
            return
        }
        items.forEachIndexed { index, category ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(8), dp(14), dp(8))
                background = CinemaStyle.surface(this@CategoryManagerActivity)
            }
            val title = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }
            title.addView(TextView(this).apply {
                text = category.name
                textSize = 15f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(if (category.hidden) BlofyTvDesign.TextMuted else Color.WHITE)
                gravity = Gravity.RIGHT
                maxLines = 1
            })
            title.addView(TextView(this).apply {
                text = if (category.hidden) "مخفية" else "ظاهرة • ترتيب ${index + 1}"
                textSize = 11.5f
                setTextColor(if (category.hidden) 0xFFFFB0B8.toInt() else BlofyTvDesign.Mint)
                gravity = Gravity.RIGHT
            })
            row.addView(title, LinearLayout.LayoutParams(0, dp(58), 1f))
            row.addView(smallButton(if (category.hidden) "إظهار" else "إخفاء") { toggleHidden(category) }, LinearLayout.LayoutParams(dp(86), dp(46)).apply { marginStart = dp(6) })
            row.addView(smallButton("تثبيت") { move(index, 0) }, LinearLayout.LayoutParams(dp(82), dp(46)).apply { marginStart = dp(6) })
            row.addView(smallButton("↑") { move(index, index - 1) }, LinearLayout.LayoutParams(dp(58), dp(46)).apply { marginStart = dp(6) })
            row.addView(smallButton("↓") { move(index, index + 1) }, LinearLayout.LayoutParams(dp(58), dp(46)))
            list.addView(row, LinearLayout.LayoutParams(-1, dp(76)).apply { bottomMargin = dp(7) })
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

    private fun move(from: Int, target: Int) {
        if (from !in currentItems.indices || target !in currentItems.indices || from == target) return
        val reordered = currentItems.toMutableList().apply {
            val item = removeAt(from)
            add(target, item)
        }.mapIndexed { index, category -> category.copy(orderIndex = index * 10) }
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().upsertCategories(reordered)
            }
            loadCategories()
        }
    }

    private fun kindLabel(kind: String) = when (kind) {
        "movie" -> "الأفلام"
        "series" -> "المسلسلات"
        else -> "البث المباشر"
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
