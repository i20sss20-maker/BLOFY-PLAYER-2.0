package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
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
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class LibraryActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FAVORITES
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(50, 34, 50, 38)
            background = AppCompatResources.getDrawable(this@LibraryActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY LIBRARY"
            textSize = 12f
            letterSpacing = .11f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = if (mode == MODE_CONTINUE) "تابع المشاهدة" else "المفضلة"
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
            setPadding(0, 4, 0, 14)
        })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        setContentView(root)
        load(mode)
    }

    private fun load(mode: String) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
            if (provider == null) { showMessage("أضف قائمة تشغيل أولاً"); return@launch }
            list.removeAllViews()
            if (mode == MODE_CONTINUE) {
                val states = withContext(Dispatchers.IO) { dao.continueWatching(provider.id).first() }
                val entries = withContext(Dispatchers.IO) { resolveContinueWatching(dao, provider.id, states) }
                if (entries.isEmpty()) showMessage("لا يوجد محتوى للاستئناف")
                entries.forEach { entry ->
                    when (entry) {
                        is ContinueWatchingEntry.StreamEntry -> addRow(provider.id, provider.liveFormat, entry.stream, entry.state.positionMs)
                        is ContinueWatchingEntry.EpisodeEntry -> addEpisodeRow(provider, entry)
                    }
                }
            } else {
                val favorites = withContext(Dispatchers.IO) { ContentRepository(dao).favorites(provider.id).first() }
                if (favorites.isEmpty()) showMessage("لا توجد عناصر في المفضلة")
                favorites.forEach { stream -> addRow(provider.id, provider.liveFormat, stream, 0L) }
            }
            list.getChildAt(0)?.requestFocus()
        }
    }

    private suspend fun resolveContinueWatching(dao: BlofyDao, providerId: String, states: List<WatchStateEntity>): List<ContinueWatchingEntry> {
        val streams = LinkedHashMap<String, StreamEntity>()
        val episodes = LinkedHashMap<String, EpisodeEntity>()
        states.forEach { state ->
            if (state.kind == "episode") dao.episode(state.contentKey)?.let { episodes[state.contentKey] = it } ?: dao.stream(state.contentKey)?.let { streams[state.contentKey] = it }
            else dao.stream(state.contentKey)?.let { streams[state.contentKey] = it } ?: dao.episode(state.contentKey)?.let { episodes[state.contentKey] = it }
        }
        val parentSeries = if (episodes.isEmpty()) emptyList() else dao.streams(providerId, "series", null).first()
        return ContinueWatchingResolver.resolve(states, streams, episodes, parentSeries)
    }

    private fun addRow(providerId: String, liveFormat: String, stream: StreamEntity, resumeMs: Long) {
        val row = TextView(this).apply {
            text = "${kindLabel(stream.kind)}   •   ${stream.name}"
            textSize = 17f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(24, 16, 24, 16)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            isFocusable = true; isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                setTextColor(Color.WHITE)
                view.background = rowBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).translationZ(if (focused) 9f else 1f).setDuration(75).start()
            }
            setOnClickListener { open(providerId, liveFormat, stream, resumeMs) }
        }
        list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 66).apply { topMargin = 7 })
    }

    private fun addEpisodeRow(provider: ProviderEntity, entry: ContinueWatchingEntry.EpisodeEntry) {
        val episode = entry.episode
        val seriesName = entry.parentSeries?.name?.takeIf(String::isNotBlank) ?: "مسلسل"
        val row = TextView(this).apply {
            text = "$seriesName   •   الموسم ${episode.season}   •   الحلقة ${episode.episode}   •   ${episode.title}"
            textSize = 17f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(24, 16, 24, 16)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            isFocusable = true; isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                setTextColor(Color.WHITE)
                view.background = rowBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).translationZ(if (focused) 9f else 1f).setDuration(75).start()
            }
            setOnClickListener { openEpisode(provider, episode, entry.state.positionMs, seriesName) }
        }
        list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 66).apply { topMargin = 7 })
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
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name); putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
                })
            }
        }
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity, resumeMs: Long, seriesName: String) {
        val url = runCatching { ContentUrlResolver.episode(provider, episode) }.getOrNull() ?: run { showMessage("تعذر تجهيز رابط الحلقة"); return }
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport); putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects); putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs); putExtra(PlayerActivity.EXTRA_TITLE, "$seriesName • S${episode.season} E${episode.episode} • ${episode.title}")
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId); putExtra(PlayerActivity.EXTRA_SEASON, episode.season); putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun kindLabel(kind: String) = when (kind) { "live" -> "LIVE"; "movie" -> "MOVIE"; "series" -> "SERIES"; else -> kind.uppercase() }

    private fun rowBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF7139BE.toInt(), 0xFF402461.toInt()) else intArrayOf(0xFF241A34.toInt(), 0xFF18111F.toInt())
    ).apply {
        cornerRadius = 16f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF463455.toInt())
    }

    private fun showMessage(text: String) {
        list.addView(TextView(this).apply { this.text = text; textSize = 18f; setTextColor(BlofyTvDesign.TextMuted); setPadding(0, 24, 0, 0) })
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_FAVORITES = "favorites"
        const val MODE_CONTINUE = "continue"
    }
}
