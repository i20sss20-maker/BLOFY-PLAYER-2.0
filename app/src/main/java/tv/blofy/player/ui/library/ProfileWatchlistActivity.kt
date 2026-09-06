package tv.blofy.player.ui.library

import android.content.Intent
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
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

/** Profile-scoped watchlist. It deliberately reuses the existing details/player flow. */
class ProfileWatchlistActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@ProfileWatchlistActivity, R.drawable.blofy_home_background)
        }
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(38), dp(28), dp(38), dp(36))
        }
        list.addView(TextView(this).apply {
            text = "MY WATCHLIST"
            textSize = 29f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        list.addView(TextView(this).apply {
            text = "${ProfileStore.active(this@ProfileWatchlistActivity).name} • saved titles"
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, dp(4), 0, dp(14))
        })
        scroll.addView(list)
        setContentView(scroll)
        load()
    }

    override fun onResume() {
        super.onResume()
        if (::list.isInitialized) load()
    }

    private fun load() {
        while (list.childCount > 2) list.removeViewAt(2)
        val keys = ProfileLibraryStore.watchlist(applicationContext).toList().asReversed()
        if (keys.isEmpty()) {
            showEmpty()
            return
        }
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                provider.id to keys.mapNotNull { dao.stream(it) }
            }
            if (result == null || result.second.isEmpty()) {
                showEmpty()
                return@launch
            }
            val providerId = result.first
            result.second.forEachIndexed { index, item ->
                val row = Button(this@ProfileWatchlistActivity).apply {
                    text = buildString {
                        append(item.name)
                        item.year?.takeIf(String::isNotBlank)?.let { append("   •   $it") }
                        item.rating?.takeIf(String::isNotBlank)?.let { append("   •   ★ $it") }
                    }
                    isAllCaps = false
                    textSize = 15f
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    setTextColor(Color.WHITE)
                    typeface = BlofyTvDesign.BodyTypeface
                    BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.018f, false)
                    setOnClickListener { openDetails(providerId, item) }
                    setOnLongClickListener {
                        ProfileLibraryStore.setWatchlisted(applicationContext, item.key, false)
                        load()
                        true
                    }
                }
                list.addView(row, LinearLayout.LayoutParams(-1, dp(62)).apply { bottomMargin = dp(8) })
                if (index == 0) row.post { row.requestFocus() }
            }
        }
    }

    private fun showEmpty() {
        list.addView(TextView(this).apply {
            text = "Your watchlist is empty. Add movies or series from their details page."
            textSize = 15f
            setTextColor(BlofyTvDesign.TextMuted)
            typeface = BlofyTvDesign.BodyTypeface
            setPadding(dp(16), dp(22), dp(16), dp(22))
        })
    }

    private fun openDetails(providerId: String, item: StreamEntity) {
        val target = if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
        startActivity(Intent(this, target).apply {
            putExtra("provider_id", providerId)
            putExtra("content_key", item.key)
        })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
