package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class LibraryActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout
    private var list: LinearLayout? = null
    private var posterGrid: RecyclerView? = null
    private var favoriteAdapter: PosterStreamAdapter? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FAVORITES
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(34), dp(28), dp(34), dp(30))
            background = AppCompatResources.getDrawable(this@LibraryActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        root.addView(TextView(this).apply {
            text = if (mode == MODE_CONTINUE) "متابعة المشاهدة" else "المفضلة"
            textSize = 29f
            setTextColor(Color.WHITE)
            setPadding(dp(6), 0, 0, dp(16))
        })

        if (mode == MODE_FAVORITES) {
            posterGrid = RecyclerView(this).apply {
                layoutManager = GridLayoutManager(this@LibraryActivity, favoriteColumns())
                setPadding(dp(4), dp(4), dp(8), dp(26))
                clipChildren = false
                clipToPadding = false
                itemAnimator = null
                setHasFixedSize(true)
                recycledViewPool.setMaxRecycledViews(0, 24)
            }
            root.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            list = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(4), 0, dp(24))
            }
            val scroll = ScrollView(this).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                addView(list)
            }
            root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }

        setContentView(root)
        load(mode)
    }

    private fun load(mode: String) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) {
                showMessage("أضف قائمة تشغيل أولاً")
                return@launch
            }

            if (mode == MODE_CONTINUE) {
                list?.removeAllViews()
                val states = withContext(Dispatchers.IO) { dao.continueWatching(provider.id).first() }
                val entries = withContext(Dispatchers.IO) { resolveContinueWatching(dao, provider.id, states) }
                if (entries.isEmpty()) {
                    showMessage("لا يوجد محتوى للاستئناف")
                    return@launch
                }
                entries.forEach { entry ->
                    when (entry) {
                        is ContinueWatchingEntry.StreamEntry -> addRow(provider.id, provider.liveFormat, entry.stream, entry.state.positionMs)
                        is ContinueWatchingEntry.EpisodeEntry -> addEpisodeRow(provider, entry)
                    }
                }
                list?.getChildAt(0)?.requestFocus()
            } else {
                val favorites = withContext(Dispatchers.IO) { ContentRepository(dao).favorites(provider.id).first() }
                if (favorites.isEmpty()) {
                    showMessage("لا توجد عناصر في المفضلة")
                    return@launch
                }
                val adapter = PosterStreamAdapter(
                    onClick = { stream -> open(provider.id, provider.liveFormat, stream, 0L) }
                )
                favoriteAdapter = adapter
                posterGrid?.adapter = adapter
                adapter.submit(favorites)
                posterGrid?.post {
                    posterGrid?.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus()
                }
            }
        }
    }

    private suspend fun resolveContinueWatching(
        dao: BlofyDao,
        providerId: String,
        states: List<WatchStateEntity>
    ): List<ContinueWatchingEntry> {
        val streams = LinkedHashMap<String, StreamEntity>()
        val episodes = LinkedHashMap<String, EpisodeEntity>()
        states.forEach { state ->
            if (state.kind == "episode") {
                dao.episode(state.contentKey)?.let { episodes[state.contentKey] = it }
                    ?: dao.stream(state.contentKey)?.let { streams[state.contentKey] = it }
            } else {
                dao.stream(state.contentKey)?.let { streams[state.contentKey] = it }
                    ?: dao.episode(state.contentKey)?.let { episodes[state.contentKey] = it }
            }
        }
        val parentSeries = if (episodes.isEmpty()) emptyList() else dao.streams(providerId, "series", null).first()
        return ContinueWatchingResolver.resolve(states, streams, episodes, parentSeries)
    }

    private fun addRow(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        val row = TextView(this).apply {
            text = "${kindLabel(stream.kind)}   •   ${stream.name}"
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(24, 17, 24, 17)
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
                view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(100).start()
            }
            setOnClickListener { open(providerId, liveFormat, stream, resumeMs) }
        }
        list?.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)).apply { topMargin = dp(7) })
    }

    private fun addEpisodeRow(provider: ProviderEntity, entry: ContinueWatchingEntry.EpisodeEntry) {
        val episode = entry.episode
        val parent = entry.parentSeries
        val seriesName = parent?.name?.takeIf(String::isNotBlank) ?: "مسلسل"
        val row = TextView(this).apply {
            text = "EPISODE   •   $seriesName   •   S${episode.season} E${episode.episode}   •   ${episode.title}"
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(24, 17, 24, 17)
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
                view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(100).start()
            }
            setOnClickListener { openEpisode(provider, episode, entry.state.positionMs, seriesName) }
        }
        list?.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)).apply { topMargin = dp(7) })
    }

    private fun open(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        when (stream.kind) {
            "movie" -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId)
                putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            "series" -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId)
                putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            "live" -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
                val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this@LibraryActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                    putExtra(PlayerActivity.EXTRA_KIND, "live")
                    putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
                    putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
                    putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                    putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
                })
            }
        }
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity, resumeMs: Long, seriesName: String) {
        val url = runCatching { ContentUrlResolver.episode(provider, episode) }.getOrNull()
        if (url == null) { showMessage("تعذر تجهيز رابط الحلقة"); return }
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode")
            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
            putExtra(PlayerActivity.EXTRA_TITLE, "$seriesName • S${episode.season} E${episode.episode} • ${episode.title}")
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId)
            putExtra(PlayerActivity.EXTRA_SEASON, episode.season)
            putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun kindLabel(kind: String) = when (kind) {
        "live" -> "LIVE"
        "movie" -> "MOVIE"
        "series" -> "SERIES"
        else -> kind.uppercase()
    }

    private fun rowBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 16f
        setColor(if (focused) Color.rgb(65, 31, 110) else Color.rgb(18, 17, 28))
        if (focused) setStroke(2, Color.rgb(185, 130, 255))
    }

    private fun showMessage(text: String) {
        val message = TextView(this).apply {
            this.text = text
            textSize = 18f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, dp(28), 0, dp(28))
        }
        val linear = list
        if (linear != null) {
            linear.removeAllViews()
            linear.addView(message, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        } else {
            posterGrid?.visibility = android.view.View.GONE
            root.addView(message, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
    }

    private fun favoriteColumns(): Int {
        val widthDp = resources.displayMetrics.widthPixels / resources.displayMetrics.density
        return when {
            widthDp < 520f -> 2
            widthDp < 900f -> 4
            else -> 5
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_FAVORITES = "favorites"
        const val MODE_CONTINUE = "continue"
    }
}
