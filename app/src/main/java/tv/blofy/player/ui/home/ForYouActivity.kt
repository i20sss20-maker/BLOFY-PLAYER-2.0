package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
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
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

class ForYouActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(38), dp(28), dp(38), dp(28))
            background = AppCompatResources.getDrawable(this@ForYouActivity, R.drawable.blofy_home_background)
        }
        val title = TextView(this).apply {
            text = "مختار لك"
            textSize = 31f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        }
        val subtitle = TextView(this).apply {
            text = "نرتبها من مشاهداتك داخل BLOFY فقط"
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, dp(14))
        }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false }
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false }
        scroll.addView(body)
        root.addView(title)
        root.addView(subtitle)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) {
                body.addView(message("أضف قائمة تشغيل أولاً"))
                return@launch
            }
            val snapshot = withContext(Dispatchers.IO) { SmartHomeEngine.build(dao, provider.id) }
            subtitle.text = "تفضيلك الحالي: ${kindLabel(snapshot.preferredKind)} • يتغير تلقائيًا حسب استخدامك"
            addSection(body, "أكمل المشاهدة", snapshot.continueItems, provider.id)
            addSection(body, "قد يناسبك", snapshot.recommended, provider.id)
            addSection(body, "شاهدتها مؤخرًا", snapshot.recentItems, provider.id)
            body.post { firstFocusable(body)?.requestFocus() }
        }
    }

    private fun addSection(parent: LinearLayout, label: String, items: List<StreamEntity>, providerId: String) {
        if (items.isEmpty()) return
        parent.addView(TextView(this).apply {
            text = label
            textSize = 19f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(14), 0, dp(8))
        })
        items.take(24).forEach { item ->
            val row = TextView(this).apply {
                text = buildString {
                    append(item.name)
                    item.year?.takeIf { it.isNotBlank() }?.let { append("   •   ").append(it) }
                    item.rating?.takeIf { it.isNotBlank() }?.let { append("   •   ★ ").append(it) }
                }
                textSize = 15f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                setPadding(dp(18), 0, dp(18), 0)
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                background = BlofyTvDesign.glassSurface(dp(14).toFloat())
                setOnFocusChangeListener { view, focused ->
                    setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextSecondary)
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.012f else 1f).scaleY(if (focused) 1.012f else 1f)
                        .translationZ(if (focused) dp(8).toFloat() else 1f).setDuration(65).start()
                }
                setOnClickListener { open(providerId, item) }
            }
            parent.addView(row, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(6) })
        }
    }

    private fun open(providerId: String, item: StreamEntity) {
        val target = if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
        startActivity(Intent(this, target).apply {
            putExtra("provider_id", providerId)
            putExtra("content_key", item.key)
        })
    }

    private fun message(value: String) = TextView(this).apply {
        text = value; textSize = 17f; setTextColor(BlofyTvDesign.TextSecondary); gravity = Gravity.CENTER; setPadding(0, dp(40), 0, 0)
    }

    private fun firstFocusable(root: LinearLayout): View? {
        for (i in 0 until root.childCount) if (root.getChildAt(i).isFocusable) return root.getChildAt(i)
        return null
    }

    private fun kindLabel(kind: String) = when (kind) { "series" -> "المسلسلات"; "live" -> "البث المباشر"; else -> "الأفلام" }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
