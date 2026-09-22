package tv.blofy.player.ui.library

import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.common.TwoPaneFocusGuard
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class LibraryActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private var favoritesGrid: RecyclerView? = null
    private var favoritesAdapter: PosterStreamAdapter? = null
    private var focusedFavoriteKey: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FAVORITES
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(50), dp(34), dp(50), dp(38))
            background = AppCompatResources.getDrawable(this@LibraryActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.brand_library)
            textSize = 12f
            letterSpacing = .11f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(if (mode == MODE_CONTINUE) R.string.home_continue_watching else R.string.home_favorites)
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
            setPadding(0, dp(4), 0, dp(14))
        })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (mode == MODE_FAVORITES) {
            root.addView(list)
            val widthDp = resources.configuration.screenWidthDp
            val tv = DeviceClass.detect(this) == DeviceClass.Kind.TV
            val columns = ((widthDp - 48) / if (tv) 150 else 130).coerceIn(2, if (tv) 7 else 6)
            favoritesGrid = RecyclerView(this).apply {
                layoutManager = GridLayoutManager(this@LibraryActivity, columns)
                itemAnimator = null
                setHasFixedSize(true)
                setItemViewCacheSize(columns * 2)
                preserveFocusAfterLayout = true
                clipToPadding = false
                setPadding(dp(4), dp(4), dp(4), dp(12))
            }
            root.addView(favoritesGrid, LinearLayout.LayoutParams(-1, 0, 1f))
        } else {
            root.addView(ScrollView(this).apply {
                isFillViewport = true
                addView(list)
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        load(mode)
    }

    private fun load(mode: String) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) { showMessage(getString(R.string.login_add_playlist_first)); return@launch }
            list.removeAllViews()
            if (mode == MODE_CONTINUE) {
                val states = withContext(Dispatchers.IO) { dao.continueWatching(provider.id).first() }
                val entries = withContext(Dispatchers.IO) { ContinueWatchingResolver.load(dao, provider.id, states) }
                if (entries.isEmpty()) showMessage(getString(R.string.library_no_continue))
                entries.forEach { entry ->
                    when (entry) {
                        is ContinueWatchingEntry.StreamEntry -> addRow(provider.id, provider.liveFormat, entry.stream, entry.state.positionMs)
                        is ContinueWatchingEntry.EpisodeEntry -> addEpisodeRow(provider, entry)
                    }
                }
            } else {
                val grid = checkNotNull(favoritesGrid)
                val adapter = PosterStreamAdapter(
                    onClick = { stream -> open(provider.id, provider.liveFormat, stream, 0L) },
                    onFocus = { stream, position ->
                        focusedFavoriteKey = stream.key
                        favoritesAdapter?.let { current ->
                            ArtworkLoader.prefetch(applicationContext, (position + 1..position + 6)
                                .mapNotNull { current.itemAt(it) }
                                .map { it.icon?.takeIf(String::isNotBlank) ?: it.backdrop })
                        }
                    }
                )
                favoritesAdapter = adapter
                grid.adapter = adapter
                repeatOnLifecycle(Lifecycle.State.STARTED) {
                    ContentRepository(dao).favorites(provider.id).distinctUntilChanged().collect { favorites ->
                        list.removeAllViews()
                        val previousPosition = focusedFavoriteKey?.let { key ->
                            (0 until adapter.itemCount).firstOrNull { adapter.itemAt(it)?.key == key }
                        } ?: 0
                        adapter.replace(favorites)
                        grid.visibility = if (favorites.isEmpty()) View.GONE else View.VISIBLE
                        if (favorites.isEmpty()) {
                            showMessage(getString(R.string.library_no_favorites))
                        } else {
                            val position = favorites.indexOfFirst { it.key == focusedFavoriteKey }
                                .takeIf { it >= 0 } ?: previousPosition.coerceAtMost(favorites.lastIndex)
                            grid.post { TwoPaneFocusGuard.focusItem(grid, position) }
                        }
                    }
                }
            }
            list.getChildAt(0)?.requestFocus()
        }
    }

    override fun onDestroy() {
        favoritesGrid?.adapter = null
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val grid = favoritesGrid
        if (grid != null && TwoPaneFocusGuard.handleGrid(event, grid)) return true
        return super.dispatchKeyEvent(event)
    }

    private fun addRow(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        val row = TextView(this).apply {
            text = getString(R.string.library_stream_row, kindLabel(stream.kind), ContentPresentation.of(stream).title)
            textSize = 17f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(dp(24), dp(16), dp(24), dp(16))
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            isFocusable = true; isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                setTextColor(Color.WHITE)
                view.background = rowBackground(focused)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.012f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(9).toFloat()) else 0f)
                    .setDuration(TvUiTuning.focusDuration(view.context, focused))
                    .start()
            }
            setOnClickListener { open(providerId, liveFormat, stream, resumeMs) }
        }
        list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)).apply { topMargin = dp(7) })
    }

    private fun addEpisodeRow(provider: ProviderEntity, entry: ContinueWatchingEntry.EpisodeEntry) {
        val episode = entry.episode
        val seriesName = entry.parentSeries?.name?.takeIf(String::isNotBlank) ?: getString(R.string.details_series_type)
        val row = TextView(this).apply {
            text = listOf(ContentPresentation.title(seriesName, "series"), getString(R.string.episodes_season, episode.season), getString(R.string.cinema_episode_title, episode.episode), ContentPresentation.title(episode.title, "episode")).joinToString("   •   ")
            textSize = 17f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(dp(24), dp(16), dp(24), dp(16))
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            isFocusable = true; isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                setTextColor(Color.WHITE)
                view.background = rowBackground(focused)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.012f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(9).toFloat()) else 0f)
                    .setDuration(TvUiTuning.focusDuration(view.context, focused))
                    .start()
            }
            setOnClickListener { openEpisode(provider, episode, entry.state.positionMs, seriesName) }
        }
        list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)).apply { topMargin = dp(7) })
    }

    private fun open(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        when (stream.kind) {
            "movie" -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply { putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key) })
            "series" -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply { putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key) })
            "live" -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return@launch
                val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this@LibraryActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, "live"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(stream))); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name); putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
                })
            }
        }
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity, resumeMs: Long, seriesName: String) {
        val url = runCatching { ContentUrlResolver.episode(provider, episode) }.getOrNull() ?: run { showMessage(getString(R.string.library_episode_url_failed)); return }
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport); putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects); putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode)); putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(episode)))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs); putExtra(PlayerActivity.EXTRA_TITLE, "$seriesName • S${episode.season} E${episode.episode} • ${episode.title}")
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId); putExtra(PlayerActivity.EXTRA_SEASON, episode.season); putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun kindLabel(kind: String) = when (kind) { "live" -> "LIVE"; "movie" -> "MOVIE"; "series" -> "SERIES"; else -> kind.uppercase() }

    private fun rowBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF68409A.toInt(), 0xFF3D2858.toInt(), 0xFF24182F.toInt())
        else intArrayOf(0xFF241A34.toInt(), 0xFF18111F.toInt())
    ).apply {
        cornerRadius = dp(16).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) BlofyTvDesign.FocusStroke else 0xFF463455.toInt())
    }

    private fun showMessage(text: String) {
        list.addView(TextView(this).apply { this.text = text; textSize = 18f; setTextColor(BlofyTvDesign.TextMuted); setPadding(0, dp(24), 0, 0) })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_FAVORITES = "favorites"
        const val MODE_CONTINUE = "continue"
    }
}
