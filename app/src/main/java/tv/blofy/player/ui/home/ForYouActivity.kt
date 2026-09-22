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
        val uiDirection = resources.configuration.layoutDirection
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            setPadding(dp(38), dp(28), dp(38), dp(28))
            background = AppCompatResources.getDrawable(this@ForYouActivity, R.drawable.blofy_home_background)
        }
        val title = TextView(this).apply {
            text = getString(R.string.for_you_title)
            textSize = 31f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.END
        }
        val subtitle = TextView(this).apply {
            text = getString(R.string.for_you_subtitle)
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.END
            setPadding(0, dp(4), 0, dp(14))
        }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false }
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; layoutDirection = uiDirection }
        scroll.addView(body)
        root.addView(title)
        root.addView(subtitle)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) {
                body.addView(message(getString(R.string.for_you_add_playlist)))
                return@launch
            }
            val data = withContext(Dispatchers.IO) {
                val smart = SmartHomeEngine.build(dao, provider.id)
                val favorites = dao.favorites(provider.id).first()
                    .filter { it.kind == "movie" || it.kind == "series" }
                    .distinctBy { it.key }
                    .take(24)
                val latest = dao.latestHomeStreams(provider.id, 40)
                    .filter { it.kind == "movie" || it.kind == "series" }
                    .distinctBy { it.key }
                    .take(24)
                PersonalData(smart, favorites, latest)
            }
            subtitle.text = getString(R.string.for_you_current_preference, kindLabel(data.smart.preferredKind))
            addSection(body, getString(R.string.for_you_continue), data.smart.continueItems, provider.id)
            addSection(body, getString(R.string.for_you_recommended), data.smart.recommended, provider.id)
            addSection(body, "المفضلة", data.favorites, provider.id)
            addSection(body, "أضيف حديثًا", data.latest, provider.id)
            addSection(body, getString(R.string.for_you_recent), data.smart.recentItems, provider.id)
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
            gravity = Gravity.END
            setPadding(0, dp(14), 0, dp(8))
        })
        items.take(24).forEach { item ->
            val row = TextView(this).apply {
                text = buildString {
                    append(item.name)
                    item.year?.takeIf { it.isNotBlank() }?.let { append("   •   ").append(it) }
                    item.rating?.takeIf { it.isNotBlank() }?.let { append("   •   ★ ").append(it) }
                    if (item.favorite) append("   •   ★ مفضلة")
                }
                textSize = 15f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.CENTER_VERTICAL or Gravity.END
                setPadding(dp(18), 0, dp(18), 0)
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                background = BlofyTvDesign.glassSurface(dp(14).toFloat())
                setOnFocusChangeListener { view, focused ->
                    setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextSecondary)
                    view.background = BlofyTvDesign.glassSurface(dp(14).toFloat(), focused)
                    view.animate().cancel()
                    view.animate()
                        .scaleX(if (focused) 1.012f else 1f)
                        .scaleY(if (focused) 1.012f else 1f)
                        .translationZ(if (focused) dp(8).toFloat() else 1f)
                        .setDuration(if (focused) BlofyTvDesign.FocusInMs else BlofyTvDesign.FocusOutMs)
                        .start()
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

    private fun kindLabel(kind: String) = when (kind) {
        "series" -> getString(R.string.home_series)
        "live" -> getString(R.string.home_live)
        else -> getString(R.string.home_movies)
    }

    private data class PersonalData(
        val smart: SmartHomeEngine.Snapshot,
        val favorites: List<StreamEntity>,
        val latest: List<StreamEntity>
    )

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
