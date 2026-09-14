package tv.blofy.player.ui.library

import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    private var loadJob: Job? = null
    private var loadGeneration = 0L

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
            textSize = 26f
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
    }

    override fun onResume() {
        super.onResume()
        if (::list.isInitialized) load()
    }

    override fun onStop() {
        loadGeneration++
        loadJob?.cancel()
        loadJob = null
        super.onStop()
    }

    private fun load() {
        val generation = ++loadGeneration
        loadJob?.cancel()
        loadJob = null
        while (list.childCount > 2) list.removeViewAt(2)
        val keys = ProfileLibraryStore.watchlist(applicationContext).toList().asReversed()
        if (keys.isEmpty()) {
            showEmpty()
            return
        }
        loadJob = lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                keys.mapNotNull { dao.stream(it) }
            }
            if (generation != loadGeneration) return@launch
            if (result.isEmpty()) {
                showEmpty()
                return@launch
            }
            result.forEachIndexed { index, item ->
                val row = Button(this@ProfileWatchlistActivity).apply {
                    text = buildString {
                        append(ContentPresentation.of(item).title)
                        item.year?.takeIf(String::isNotBlank)?.let { append("   •   $it") }
                        item.rating?.takeIf(String::isNotBlank)?.let { append("   •   ★ $it") }
                    }
                    isAllCaps = false
                    textSize = 15f
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    setTextColor(Color.WHITE)
                    typeface = BlofyTvDesign.BodyTypeface
                    CinemaStyle.styleButton(this)
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    textSize = 13f
                    setOnClickListener { openDetails(item) }
                    setOnLongClickListener {
                        ProfileLibraryStore.setWatchlisted(applicationContext, item.key, false)
                        load()
                        true
                    }
                }
                list.addView(row, LinearLayout.LayoutParams(-1, dp(48)).apply { bottomMargin = dp(8) })
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

    private fun openDetails(item: StreamEntity) {
        val target = if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
        startActivity(Intent(this, target).apply {
            putExtra("provider_id", item.providerId)
            putExtra("content_key", item.key)
        })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
