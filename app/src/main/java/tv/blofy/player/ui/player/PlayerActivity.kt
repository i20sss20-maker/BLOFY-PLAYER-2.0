package tv.blofy.player.ui.player

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.PlayerPreference
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import tv.blofy.player.core.remote.RemoteAction
import tv.blofy.player.core.remote.RemoteKeyRouter
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(markerClass = [UnstableApi::class])
class PlayerActivity : AppCompatActivity() {
    private lateinit var session: BlofyPlaybackSession
    private lateinit var playerView: PlayerView
    private lateinit var hud: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var epgView: TextView
    private lateinit var channelNumberView: TextView
    private lateinit var audioButton: Button
    private lateinit var subtitleButton: Button
    private lateinit var favoriteButton: Button
    private var epgJob: Job? = null
    private var digitBuffer = ""
    private var digitGeneration = 0

    private val providerId by lazy { intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty() }
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty() }
    private val categoryId by lazy { intent.getStringExtra(EXTRA_CATEGORY_ID) }
    private var currentContentKey = ""
    private var currentStreamId = ""
    private var currentTitle = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        if (url.isBlank()) {
            finish()
            return
        }

        currentContentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        currentStreamId = intent.getStringExtra(EXTRA_STREAM_ID).orEmpty()
        currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty()

        val profile = profileFromIntent()
        session = BlofyPlaybackSession(this, profile, kind.ifBlank { "unknown" })
        buildPlayerUi()
        session.play(url, intent.getLongExtra(EXTRA_RESUME_MS, 0L))
        updateTitle(currentTitle)
        refreshFavoriteState()
        if (kind == "live") observeEpg()
    }

    private fun buildPlayerUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        playerView = PlayerView(this).apply {
            useController = false
            player = session.player
            isFocusable = true
            isFocusableInTouchMode = true
            setShutterBackgroundColor(Color.BLACK)
        }
        root.addView(playerView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        channelNumberView = TextView(this).apply {
            textSize = 34f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(24, 10, 24, 10)
            background = GradientDrawable().apply {
                cornerRadius = 18f
                setColor(Color.argb(225, 43, 18, 76))
                setStroke(2, Color.rgb(185, 140, 255))
            }
            visibility = View.GONE
        }
        root.addView(channelNumberView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = 34
            marginEnd = 42
        })

        hud = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 24, 36, 28)
            background = GradientDrawable().apply {
                setColor(Color.argb(220, 10, 7, 18))
                cornerRadii = floatArrayOf(26f, 26f, 26f, 26f, 0f, 0f, 0f, 0f)
            }
            visibility = View.GONE
        }
        titleView = TextView(this).apply {
            textSize = 23f
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, 6)
        }
        hud.addView(titleView)

        epgView = TextView(this).apply {
            textSize = 15f
            setTextColor(Color.rgb(205, 190, 230))
            setPadding(0, 0, 0, 14)
            visibility = if (kind == "live") View.VISIBLE else View.GONE
        }
        hud.addView(epgView)

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START
        }
        audioButton = controlButton("الصوت") { showTrackDialog(C.TRACK_TYPE_AUDIO) }
        subtitleButton = controlButton("الترجمة") { showTrackDialog(C.TRACK_TYPE_TEXT) }
        favoriteButton = controlButton("☆ المفضلة") { toggleFavorite() }
        controls.addView(audioButton, LinearLayout.LayoutParams(190, 74).apply { marginEnd = 12 })
        controls.addView(subtitleButton, LinearLayout.LayoutParams(190, 74).apply { marginEnd = 12 })
        controls.addView(favoriteButton, LinearLayout.LayoutParams(210, 74))
        if (kind == "live") {
            controls.addView(TextView(this).apply {
                text = "  CH+/CH− للتبديل  •  اكتب رقم القناة مباشرة"
                textSize = 15f
                setTextColor(Color.rgb(185, 140, 255))
                gravity = Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 74))
        }
        hud.addView(controls)

        root.addView(hud, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        setContentView(root)
        playerView.requestFocus()
    }

    private fun controlButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        isFocusable = true
        setOnClickListener { action() }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val routed = RemoteKeyRouter.route(event)
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        return when (routed.action) {
            RemoteAction.BACK -> {
                if (hud.visibility == View.VISIBLE) {
                    hideHud(); true
                } else {
                    finish(); true
                }
            }
            RemoteAction.PLAY_PAUSE -> {
                if (session.player.isPlaying) session.player.pause() else session.player.play(); true
            }
            RemoteAction.FAST_FORWARD -> {
                if (kind != "live") session.player.seekTo(session.player.currentPosition + 10_000L)
                true
            }
            RemoteAction.REWIND -> {
                if (kind != "live") session.player.seekTo((session.player.currentPosition - 10_000L).coerceAtLeast(0L))
                true
            }
            RemoteAction.CHANNEL_NEXT -> {
                if (kind == "live") switchLive(1) else return super.dispatchKeyEvent(event)
                true
            }
            RemoteAction.CHANNEL_PREVIOUS -> {
                if (kind == "live") switchLive(-1) else return super.dispatchKeyEvent(event)
                true
            }
            RemoteAction.DIGIT -> {
                if (kind == "live" && routed.digit != null) {
                    handleChannelDigit(routed.digit)
                    true
                } else super.dispatchKeyEvent(event)
            }
            RemoteAction.OK -> {
                if (hud.visibility == View.VISIBLE) hideHud() else showHud()
                true
            }
            else -> super.dispatchKeyEvent(event)
        }
    }

    private fun handleChannelDigit(digit: Int) {
        if (digitBuffer.length >= 4) digitBuffer = ""
        digitBuffer += digit.toString()
        channelNumberView.text = digitBuffer
        channelNumberView.visibility = View.VISIBLE
        val generation = ++digitGeneration
        channelNumberView.postDelayed({
            if (generation != digitGeneration || isFinishing) return@postDelayed
            val number = digitBuffer.toIntOrNull()
            digitBuffer = ""
            channelNumberView.visibility = View.GONE
            if (number != null && number > 0) playChannelNumber(number)
        }, 900L)
    }

    private fun playChannelNumber(number: Int) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: return@launch
            val list = dao.streams(providerId, "live", categoryId).first()
            val target = list.getOrNull(number - 1) ?: return@launch
            playLiveStream(provider, target)
        }
    }

    private fun showHud() {
        hud.visibility = View.VISIBLE
        audioButton.requestFocus()
    }

    private fun hideHud() {
        hud.visibility = View.GONE
        playerView.requestFocus()
    }

    private fun updateTitle(title: String) {
        titleView.text = if (title.isBlank()) "BLOFY PLAYER" else title
    }

    private fun switchLive(delta: Int) {
        if (providerId.isBlank() || currentStreamId.isBlank()) return
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: return@launch
            val list = dao.streams(providerId, "live", categoryId).first()
            if (list.isEmpty()) return@launch
            val currentIndex = list.indexOfFirst { it.remoteId == currentStreamId }.let { if (it < 0) 0 else it }
            val targetIndex = (currentIndex + delta).floorMod(list.size)
            playLiveStream(provider, list[targetIndex])
        }
    }

    private fun playLiveStream(provider: ProviderEntity, stream: StreamEntity) {
        val profile = providerProfile(provider)
        currentStreamId = stream.remoteId
        currentContentKey = stream.key
        currentTitle = stream.name
        updateTitle(stream.name)
        session.play(ContentUrlResolver.live(provider, profile, stream))
        refreshFavoriteState()
        observeEpg()
        if (hud.visibility != View.VISIBLE) showHudBriefly()
    }

    private fun refreshFavoriteState() {
        if (currentContentKey.isBlank() || !::favoriteButton.isInitialized) return
        lifecycleScope.launch {
            val item = BlofyDatabase.get(applicationContext).dao().stream(currentContentKey)
            favoriteButton.text = if (item?.favorite == true) "★ في المفضلة" else "☆ المفضلة"
        }
    }

    private fun toggleFavorite() {
        if (currentContentKey.isBlank()) return
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val item = dao.stream(currentContentKey) ?: return@launch
            dao.setFavorite(currentContentKey, !item.favorite)
            favoriteButton.text = if (!item.favorite) "★ في المفضلة" else "☆ المفضلة"
        }
    }

    private fun observeEpg() {
        if (providerId.isBlank() || currentStreamId.isBlank()) return
        epgJob?.cancel()
        epgJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().epg(providerId, currentStreamId, System.currentTimeMillis()).collect { items ->
                val now = System.currentTimeMillis()
                val current = items.firstOrNull { now in it.startMs until it.endMs } ?: items.firstOrNull()
                val next = current?.let { c -> items.firstOrNull { it.startMs >= c.endMs } }
                epgView.text = buildString {
                    if (current != null) {
                        append(time(current.startMs)).append("–").append(time(current.endMs)).append("  ").append(current.title)
                    } else {
                        append("لا تتوفر معلومات البرنامج")
                    }
                    if (next != null) append("   •   التالي: ").append(time(next.startMs)).append(" ").append(next.title)
                }
            }
        }
    }

    private fun time(ms: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))

    private fun showHudBriefly() {
        hud.visibility = View.VISIBLE
        hud.postDelayed({ if (!isFinishing) hideHud() }, 1600L)
    }

    private fun showTrackDialog(trackType: Int) {
        val groups = session.player.currentTracks.groups.filter { it.type == trackType && it.length > 0 }
        val entries = mutableListOf<TrackEntry>()
        groups.forEach { group ->
            for (index in 0 until group.length) {
                if (group.isTrackSupported(index)) {
                    entries += TrackEntry(group, index, trackLabel(group.getTrackFormat(index), trackType))
                }
            }
        }
        val isText = trackType == C.TRACK_TYPE_TEXT
        val labels = buildList {
            if (isText) add("إيقاف الترجمة")
            addAll(entries.map { it.label })
        }
        if (labels.isEmpty()) {
            AlertDialog.Builder(this).setMessage(if (isText) "لا توجد ترجمات متاحة" else "لا توجد مسارات صوت إضافية").setPositiveButton("حسنًا", null).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle(if (isText) "الترجمة" else "المسار الصوتي")
            .setItems(labels.toTypedArray()) { dialog, which ->
                if (isText && which == 0) {
                    session.player.trackSelectionParameters = session.player.trackSelectionParameters
                        .buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
                } else {
                    val entry = entries[which - if (isText) 1 else 0]
                    val override = TrackSelectionOverride(entry.group.mediaTrackGroup, listOf(entry.index))
                    session.player.trackSelectionParameters = session.player.trackSelectionParameters
                        .buildUpon()
                        .setTrackTypeDisabled(trackType, false)
                        .setOverrideForType(override)
                        .build()
                }
                dialog.dismiss()
            }
            .show()
    }

    private fun trackLabel(format: Format, type: Int): String {
        val language = format.language?.uppercase() ?: if (type == C.TRACK_TYPE_AUDIO) "AUDIO" else "SUB"
        val label = format.label?.takeIf { it.isNotBlank() }
        val codec = format.codecs?.takeIf { it.isNotBlank() }
        return listOfNotNull(label, language, codec).distinct().joinToString(" • ")
    }

    override fun onStop() {
        saveResume()
        super.onStop()
    }

    override fun onDestroy() {
        digitGeneration++
        epgJob?.cancel()
        if (::session.isInitialized) session.release()
        super.onDestroy()
    }

    private fun saveResume() {
        if (kind == "live" || currentContentKey.isBlank() || providerId.isBlank() || !::session.isInitialized) return
        val position = session.player.currentPosition.coerceAtLeast(0L)
        val duration = session.player.duration.coerceAtLeast(0L)
        lifecycleScope.launch(Dispatchers.IO) {
            ContentRepository(BlofyDatabase.get(applicationContext).dao())
                .saveResume(currentContentKey, providerId, kind, position, duration)
        }
    }

    private fun profileFromIntent() = ProviderProfile(
        providerKey = providerId.ifBlank { "default" },
        liveFormat = if (intent.getStringExtra(EXTRA_LIVE_FORMAT) == "m3u8") LiveFormat.HLS else LiveFormat.TS
    )

    private fun providerProfile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS,
        transport = if (provider.preferredTransport.equals("http", true)) TransportPreference.HTTP_FIRST else TransportPreference.CRONET_FIRST,
        player = if (provider.preferredEngine.equals("vlc", true)) PlayerPreference.VLC else PlayerPreference.MEDIA3,
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects
    )

    private fun Int.floorMod(size: Int): Int = ((this % size) + size) % size

    private data class TrackEntry(val group: Tracks.Group, val index: Int, val label: String)

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_CONTENT_KEY = "content_key"
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_KIND = "kind"
        const val EXTRA_LIVE_FORMAT = "live_format"
        const val EXTRA_RESUME_MS = "resume_ms"
        const val EXTRA_STREAM_ID = "stream_id"
        const val EXTRA_CATEGORY_ID = "category_id"
        const val EXTRA_TITLE = "title"
    }
}
