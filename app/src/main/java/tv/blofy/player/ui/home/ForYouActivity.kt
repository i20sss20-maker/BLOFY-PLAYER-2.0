package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
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
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
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
            gravity = Gravity.START
        }
        val subtitle = TextView(this).apply {
            text = getString(R.string.for_you_subtitle)
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
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
            addSection(body, getString(R.string.home_favorites), data.favorites, provider.id)
            addSection(body, getString(R.string.home_recently_added), data.latest, provider.id)
            addSection(body, getString(R.string.for_you_recent), data.smart.recentItems, provider.id)
            body.post { firstFocusable(body)?.requestFocus() }
        }
    }

    /** Cinematic poster rails keep titles visible while focusing by D-pad. */
    private fun addSection(parent: LinearLayout, label: String, items: List<StreamEntity>, providerId: String) {
        if (items.isEmpty()) return
        parent.addView(TextView(this).apply {
            text = label
            textSize = 20f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(dp(5), dp(16), 0, dp(11))
        })
        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            clipChildren = false
            clipToPadding = false
            layoutDirection = resources.configuration.layoutDirection
        }
        items.distinctBy { it.key }.take(14).forEach { item ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                isFocusable = true
                isClickable = true
                clipChildren = false
                background = BlofyTvDesign.glassSurface(dp(16).toFloat())
                setPadding(dp(5), dp(5), dp(5), dp(9))
                setOnFocusChangeListener { view, focused ->
                    view.background = BlofyTvDesign.glassSurface(dp(16).toFloat(), focused)
                    view.animate().cancel()
                    view.animate()
                        .scaleX(TvUiTuning.focusScale(view.context, if (focused) 1.035f else 1f))
                        .scaleY(TvUiTuning.focusScale(view.context, if (focused) 1.035f else 1f))
                        .setDuration(TvUiTuning.focusDuration(view.context, focused)).start()
                }
                contentDescription = item.name
                setOnClickListener { open(item.providerId, item) }
            }
            val art = ImageView(this).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                clipToOutline = true
                background = BlofyTvDesign.glassSurface(dp(12).toFloat())
                isFocusable = false
            }
            card.addView(art, LinearLayout.LayoutParams(-1, dp(179)))
            ArtworkLoader.load(art, listOf(item.icon, item.backdrop))
            card.addView(TextView(this).apply {
                text = item.name
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                textSize = 13f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.START
                setPadding(dp(5), dp(5), dp(5), 0)
            }, LinearLayout.LayoutParams(-1, dp(43)))
            card.addView(TextView(this).apply {
                text = listOfNotNull(
                    item.year?.takeIf(String::isNotBlank),
                    item.rating?.takeIf(String::isNotBlank)?.let { "★ $it" }
                ).joinToString("  •  ")
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                textSize = 11f
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                setPadding(dp(5), 0, dp(5), 0)
            }, LinearLayout.LayoutParams(-1, dp(22)))
            rail.addView(card, LinearLayout.LayoutParams(dp(150), dp(260)).apply {
                marginEnd = dp(10); bottomMargin = dp(4)
            })
        }
        parent.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            clipChildren = false
            clipToPadding = false
            isFocusable = false
            addView(rail)
        }, LinearLayout.LayoutParams(-1, dp(280)))
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
