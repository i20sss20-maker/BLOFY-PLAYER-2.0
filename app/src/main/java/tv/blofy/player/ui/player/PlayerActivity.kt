package tv.blofy.player.ui.player

import tv.blofy.player.ui.common.ContentPresentation

import android.app.AlertDialog
import android.content.res.Configuration
import android.graphics.Color
import tv.blofy.player.ui.common.CinemaStyle
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.widget.AppCompatImageButton
import android.content.res.ColorStateList
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import tv.blofy.player.core.playback.ArabicSubtitlePolicy
import tv.blofy.player.core.playback.ResumeCheckpoint
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.BlofyApp
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.playback.PlaybackResumeState
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.playback.SmartZappingCache
import tv.blofy.player.core.playback.SmartZappingCoordinator
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.PlayerPreference
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import tv.blofy.player.core.remote.RemoteAction
import tv.blofy.player.core.remote.RemoteKeyRouter
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.ResumeWriteRequest
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(markerClass = [UnstableApi::class])
open class PlayerActivity : AppCompatActivity() {
    private lateinit var session: BlofyPlaybackSession
    private var sessionReleased = true
    private var suspendedPlayback: PlaybackResumeState? = null
    private var episodeNavigationJob: Job? = null
    private lateinit var playerView: PlayerView
    private lateinit var hud: LinearLayout
    private lateinit var hudOverlay: View
    private var touchPlaybackControls: LinearLayout? = null
    private var controlInsets = Insets.NONE
    private var seeking = false
    private val checkpoint = ResumeCheckpoint()
    private val subtitlePolicy = ArabicSubtitlePolicy()
    private var lastCheckpointAt = 0L
    private var defaultTextDisabled = false
    private var pendingNetworkRecovery = false
    private lateinit var connectionNotice: TextView
    private lateinit var controlHint: TextView
    private var networkRegistered = false
    private val connectivity by lazy { getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) { runOnUiThread {
            if (!sessionReleased && !online()) {
                pendingNetworkRecovery = true
                saveResume()
                showConnectionNotice(getString(R.string.player_offline))
            }
        } }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) runOnUiThread {
                if (!sessionReleased && pendingNetworkRecovery) {
                    pendingNetworkRecovery = false
                    if (session.player.playerError != null || session.player.playbackState == Player.STATE_BUFFERING || session.player.playbackState == Player.STATE_IDLE) retryPlayback()
                    else if (::connectionNotice.isInitialized) connectionNotice.visibility = View.GONE
                }
            }
        }
    }
    private val isTv by lazy { DeviceClass.isTv(this) }
    private lateinit var titleView: TextView
    private lateinit var epgView: TextView
    private lateinit var channelNumberView: TextView
    private lateinit var audioButton: AppCompatImageButton
    private lateinit var subtitleButton: AppCompatImageButton
    private lateinit var qualityButton: AppCompatImageButton
    private lateinit var favoriteButton: AppCompatImageButton
    private lateinit var playPauseButton: AppCompatImageButton

    private var progressBar: ProgressBar? = null
    private var positionView: TextView? = null
    private var durationView: TextView? = null
    private var epgJob: Job? = null
    private var epgRefreshJob: Job? = null
    private var zappingWarmJob: Job? = null
    private var zappingJob: Job? = null

    private var digitBuffer = ""
    private var digitGeneration = 0
    private var channelOverlayGeneration = 0
    private var autoNextTriggered = false
    private var pendingZapDelta = 0

    private val providerId by lazy { intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty() }
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty() }
    private val categoryId by lazy { intent.getStringExtra(EXTRA_CATEGORY_ID) }
    private val seriesId by lazy { intent.getStringExtra(EXTRA_SERIES_ID).orEmpty() }
    private val dao by lazy { BlofyDatabase.get(applicationContext).dao() }
    private val zappingCoordinator by lazy { SmartZappingCoordinator(dao) }

    private var liveProvider: ProviderEntity? = null
    private var currentContentKey = ""
    private var currentStreamId = ""
    private var currentTitle = ""
    private var currentSeason = 0
    private var currentEpisode = 0

    private val hideHudRunnable = Runnable {
        if (::hud.isInitialized && !isFinishing) hideHud()
    }

    private val progressRunnable = object : Runnable {
        override fun run() {
            if (!::session.isInitialized || sessionReleased || isFinishing || kind == KIND_LIVE) return
            updateProgressUi()
            val now = android.os.SystemClock.elapsedRealtime()
            if (now - lastCheckpointAt >= 5_000L) { saveResume(); lastCheckpointAt = now }
            hud.postDelayed(this, 500L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        if (url.isBlank()) {
            finish()
            return
        }

        currentContentKey = savedInstanceState?.getString(EXTRA_CONTENT_KEY) ?: intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        currentStreamId = savedInstanceState?.getString(EXTRA_STREAM_ID) ?: intent.getStringExtra(EXTRA_STREAM_ID).orEmpty()
        currentTitle = savedInstanceState?.getString(EXTRA_TITLE) ?: intent.getStringExtra(EXTRA_TITLE).orEmpty()
        currentSeason = savedInstanceState?.getInt(EXTRA_SEASON) ?: intent.getIntExtra(EXTRA_SEASON, 0)
        currentEpisode = savedInstanceState?.getInt(EXTRA_EPISODE) ?: intent.getIntExtra(EXTRA_EPISODE, 0)

        val initialPosition = savedInstanceState?.getLong(EXTRA_RESUME_MS) ?: intent.getLongExtra(EXTRA_RESUME_MS, 0L)
        checkpoint.reset(initialPosition)
        subtitlePolicy.manual = savedInstanceState?.getBoolean("subtitle_manual") ?: false
        subtitlePolicy.disabledAutomatically = savedInstanceState?.getBoolean("subtitle_auto_disabled") ?: false
        initializePlaybackSession()
        defaultTextDisabled = session.player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
        savedInstanceState?.getBundle("track_parameters")?.let {
            session.player.trackSelectionParameters = androidx.media3.common.TrackSelectionParameters.fromBundle(it)
        }

        buildPlayerUi()
        if (savedInstanceState != null && currentContentKey != intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()) {
            // Persist identities, never credential-bearing stream URLs in saved state.
            lifecycleScope.launch {
                val provider = dao.provider(providerId) ?: run { finish(); return@launch }
                val episode = if (kind == KIND_EPISODE) dao.episode(currentContentKey) else null
                val stream = if (kind != KIND_EPISODE) dao.stream(currentContentKey) else null
                val restoredUrl = when {
                    episode != null -> ContentUrlResolver.episode(provider, episode)
                    stream != null && kind == KIND_LIVE -> ContentUrlResolver.live(provider, profileFromIntent(), stream)
                    stream != null -> ContentUrlResolver.movie(provider, stream)
                    else -> null
                }
                if (restoredUrl == null) { finish(); return@launch }
                val fallbacks = when {
                    episode != null -> ContentUrlResolver.recoveryUrls(provider, episode)
                    stream != null -> ContentUrlResolver.recoveryUrls(provider, profileFromIntent(), stream)
                    else -> emptyList()
                }
                val state = PlaybackResumeState(restoredUrl, initialPosition, savedInstanceState.getBoolean("play_when_ready", true),
                    fallbacks, session.player.trackSelectionParameters)
                if (sessionReleased) suspendedPlayback = state else {
                    session.play(state.url, state.positionMs, fallbackUrls = state.fallbackUrls)
                    session.player.playWhenReady = state.playWhenReady
                }
            }
        } else {
            session.play(url, initialPosition, fallbackUrl = intent.getStringExtra(EXTRA_FALLBACK_URL),
                fallbackUrls = intent.getStringArrayListExtra(EXTRA_FALLBACK_URLS).orEmpty())
            savedInstanceState?.let { session.player.playWhenReady = it.getBoolean("play_when_ready", true) }
        }
        updateTitle(currentTitle)
        refreshFavoriteState()

        if (kind == KIND_LIVE) {
            RecentChannelStore.record(this, providerId, currentContentKey)
            primeSmartZapping()
            requestShortEpgRefresh()
            observeEpg()
        }
    }

    internal open fun createPlaybackSession(): BlofyPlaybackSession = BlofyPlaybackSession(
            context = this,
            profile = profileFromIntent(),
            contentKind = kind.ifBlank { "unknown" }
        ) {
            saveResume()
            pendingNetworkRecovery = !online()
            showConnectionNotice(getString(if (pendingNetworkRecovery) R.string.player_offline else R.string.player_retry_error))
        }

    private fun initializePlaybackSession() {
        session = createPlaybackSession()
        sessionReleased = false
        session.player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (sessionReleased) return
                if (playbackState == Player.STATE_READY && ::connectionNotice.isInitialized) {
                    connectionNotice.visibility = View.GONE
                }
                if (playbackState == Player.STATE_ENDED) saveResume()
                if (playbackState == Player.STATE_ENDED && kind == KIND_EPISODE && !autoNextTriggered) {
                    autoNextTriggered = true
                    playAdjacentEpisode(1, automatic = true)
                }
                if (kind != KIND_LIVE) {
                    updateProgressUi()
                }
                updatePlayPauseLabel()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!sessionReleased) { updatePlayPauseLabel(); if (!isPlaying) saveResume() }
            }
            override fun onTracksChanged(tracks: Tracks) {
                if (sessionReleased || kind == KIND_LIVE) return
                val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                    .firstNotNullOfOrNull { group -> (0 until group.length).firstOrNull { group.isTrackSelected(it) }?.let { group.getTrackFormat(it).language } }
                val disabled = subtitlePolicy.textDisabled(audio) ?: return
                val desired = disabled || defaultTextDisabled
                if (session.player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) != desired) {
                    session.player.trackSelectionParameters = session.player.trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, desired).build()
                }
            }
        })
    }

    private fun restorePlaybackSession() {
        if (!sessionReleased || isFinishing) return
        val state = suspendedPlayback ?: return
        initializePlaybackSession()
        playerView.player = session.player
        session.player.trackSelectionParameters = state.trackSelectionParameters
        session.play(state.url, state.positionMs, fallbackUrls = state.fallbackUrls)
        session.player.playWhenReady = state.playWhenReady
        suspendedPlayback = null
    }

    private fun releasePlaybackSession() {
        if (!::session.isInitialized || sessionReleased) return
        saveResume()
        suspendedPlayback = session.resumeState()?.let { state ->
            if (kind != KIND_LIVE && state.positionMs <= 0L && session.player.playbackState != Player.STATE_READY)
                state.copy(positionMs = checkpoint.positionMs) else state
        }
        sessionReleased = true
        episodeNavigationJob?.cancel()
        zappingJob?.cancel()
        pendingZapDelta = 0
        if (::hud.isInitialized) {
            hud.removeCallbacks(progressRunnable)
            hud.removeCallbacks(hideHudRunnable)
        }
        session.release { if (::playerView.isInitialized) playerView.player = null }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun controlSize(widthDp: Int): LinearLayout.LayoutParams {
        val narrow = !isTv && resources.configuration.screenWidthDp < 600
        return LinearLayout.LayoutParams(if (narrow) 0 else dp(if (widthDp == 100) 60 else 52), dp(52), if (narrow) 1f else 0f)
    }

    private fun buildPlayerUi() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        playerView = PlayerView(this).apply {
            useController = false
            player = session.player
            isFocusable = true
            isFocusableInTouchMode = true
            setShutterBackgroundColor(Color.BLACK)
        }
        root.addView(
            playerView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        if (!isTv) {
            root.addView(View(this).apply {
                contentDescription = getString(R.string.player_toggle_controls)
                isFocusable = false
                setOnClickListener {
                    if (hud.visibility == View.VISIBLE) hideHud() else showHudBriefly()
                }
            }, FrameLayout.LayoutParams(-1, -1))
        }

        channelNumberView = TextView(this).apply {
            textSize = 34f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(24, 10, 24, 10)
            background = GradientDrawable().apply {
                cornerRadius = 18f
                setColor(Color.argb(225, 43, 18, 76))
                setStroke(2, PURPLE_SOFT)
            }
            visibility = View.GONE
        }
        root.addView(
            channelNumberView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            ).apply {
                topMargin = 34
                marginEnd = 42
            }
        )

        hud = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(36), dp(30), dp(36), dp(18))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0x00090B10, 0xCC090B10.toInt(), 0xFA090B10.toInt())
            )
            visibility = View.GONE
        }

        connectionNotice = TextView(this).apply {
            textSize = 13f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            setPadding(dp(18), dp(12), dp(18), dp(12))
            background = GradientDrawable().apply { setColor(0xED17131F.toInt()); cornerRadius = dp(14).toFloat(); setStroke(dp(1), PURPLE_SOFT) }
            isFocusable = true; isClickable = true; visibility = View.GONE
            setOnClickListener { retryPlayback() }
            setOnFocusChangeListener { view, focused -> view.alpha = if (focused) 1f else .85f }
        }
        root.addView(connectionNotice, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            topMargin = dp(30); leftMargin = dp(24); rightMargin = dp(24)
        })

        val eyebrow = TextView(this).apply {
            text = when (kind) {
                KIND_LIVE -> "BLOFY LIVE"
                KIND_EPISODE -> "BLOFY SERIES"
                else -> "BLOFY CINEMA"
            }
            textSize = 9f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(PURPLE_SOFT)
            letterSpacing = .08f
            setPadding(0, 0, 0, 5)
        }
        hud.addView(eyebrow)

        titleView = TextView(this).apply {
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, 0, 0, dp(6))
        }
        hud.addView(titleView)

        epgView = TextView(this).apply {
            textSize = 15f
            setTextColor(Color.rgb(214, 203, 228))
            setPadding(0, 0, 0, 16)
            visibility = if (kind == KIND_LIVE) View.VISIBLE else View.GONE
            background = if (kind == KIND_LIVE) {
                GradientDrawable().apply {
                    cornerRadius = 14f
                    setColor(0x4D281D39)
                    setStroke(1, 0x554F3868)
                }
            } else {
                null
            }
            if (kind == KIND_LIVE) setPadding(18, 12, 18, 12)
        }
        hud.addView(epgView)

        if (kind != KIND_LIVE) {
            val timeline = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_LTR
                setPadding(0, dp(4), 0, dp(8))
            }
            positionView = TextView(this).apply {
                text = "00:00"
                textSize = 11f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                isSingleLine = true
                textDirection = View.TEXT_DIRECTION_LTR
            }
            durationView = TextView(this).apply {
                text = "00:00"
                textSize = 11f
                setTextColor(Color.rgb(190, 180, 205))
                gravity = Gravity.CENTER
                isSingleLine = true
                textDirection = View.TEXT_DIRECTION_LTR
            }
            progressBar = if (!isTv) SeekBar(this).apply {
                max = 1000
                contentDescription = getString(R.string.player_seek_position)
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onStartTrackingTouch(seekBar: SeekBar) { seeking = true; keepHudVisible() }
                    override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) = Unit
                    override fun onStopTrackingTouch(seekBar: SeekBar) {
                        seeking = false
                        val duration = session.player.duration
                        if (duration > 0) session.player.seekTo(duration * seekBar.progress / seekBar.max)
                        showHudBriefly()
                    }
                })
            } else ProgressBar(
                this,
                null,
                android.R.attr.progressBarStyleHorizontal
            ).apply {
                max = 1000
                progress = 0
            }

            timeline.addView(positionView, LinearLayout.LayoutParams(dp(66), dp(26)))
            timeline.addView(
                progressBar,
                LinearLayout.LayoutParams(0, dp(if (isTv) 3 else 48), 1f).apply {
                    marginEnd = dp(10)
                    marginStart = dp(10)
                }
            )
            timeline.addView(durationView, LinearLayout.LayoutParams(dp(66), dp(26)))
            hud.addView(timeline)
        }

        controlHint = TextView(this).apply {
            textSize = 11f; setTextColor(PURPLE_SOFT); gravity = Gravity.CENTER
            visibility = if (isTv) View.GONE else View.VISIBLE
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        hud.addView(controlHint, LinearLayout.LayoutParams(-1, dp(22)))

        run {
            val playbackControls = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                // Seek follows the physical, left-to-right timeline in either app language.
                layoutDirection = View.LAYOUT_DIRECTION_LTR
                clipChildren = false
            }

            val rewindButton = controlButton(R.drawable.player_back, getString(if (kind == KIND_LIVE) R.string.player_previous else R.string.player_seek_back)) {
                if (kind == KIND_LIVE) switchLive(-1) else seekBy(-10_000L)
                showHudBriefly()
            }
            playPauseButton = controlButton(R.drawable.player_pause, getString(R.string.player_pause)) {
                togglePlayPause()
            }.apply { tag = "blofy_play_pause" }
            val forwardButton = controlButton(R.drawable.player_forward, getString(if (kind == KIND_LIVE) R.string.player_next else R.string.player_seek_forward)) {
                if (kind == KIND_LIVE) switchLive(1) else seekBy(10_000L)
                showHudBriefly()
            }

            playbackControls.addView(
                rewindButton,
                controlSize(76).apply { marginEnd = dp(8) }
            )
            playbackControls.addView(
                playPauseButton,
                controlSize(100).apply { marginEnd = dp(8) }
            )
            playbackControls.addView(
                forwardButton,
                controlSize(76)
            )
            hud.addView(
                playbackControls,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(10) }
            )
            if (!isTv) touchPlaybackControls = playbackControls

            val options = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                layoutDirection = resources.configuration.layoutDirection
                clipChildren = false
            }

            audioButton = controlButton(R.drawable.player_audio, getString(R.string.player_audio)) {
                showTrackDialog(C.TRACK_TYPE_AUDIO)
            }
            subtitleButton = controlButton(R.drawable.player_subtitles, getString(R.string.player_subtitles)) {
                showTrackDialog(C.TRACK_TYPE_TEXT)
            }
            qualityButton = controlButton(R.drawable.player_quality, getString(R.string.player_quality)) {
                showVideoQualityDialog()
            }
            favoriteButton = controlButton(R.drawable.player_favorite, getString(R.string.player_favorite)) {
                toggleFavorite()
            }.apply {
                visibility = if (kind == KIND_EPISODE) View.GONE else View.VISIBLE
            }

            options.addView(
                audioButton,
                controlSize(88).apply { marginEnd = dp(8) }
            )
            options.addView(
                subtitleButton,
                controlSize(88).apply { marginEnd = dp(8) }
            )
            options.addView(
                qualityButton,
                controlSize(88).apply { marginEnd = dp(8) }
            )

            if (kind != KIND_EPISODE) {
                options.addView(
                    favoriteButton,
                    controlSize(88)
                )
            } else {
                options.addView(
                    controlButton(R.drawable.player_previous, getString(R.string.player_previous)) { playAdjacentEpisode(-1) },
                    controlSize(76).apply { marginEnd = dp(8) }
                )
                options.addView(
                    controlButton(R.drawable.player_next, getString(R.string.player_next)) { playAdjacentEpisode(1) },
                    controlSize(76)
                )
            }
            if (isTv) {
                hud.removeView(playbackControls)
                val previousEpisode = if (kind == KIND_EPISODE) options.getChildAt(3) else null
                val nextEpisode = if (kind == KIND_EPISODE) options.getChildAt(4) else null
                options.removeAllViews()
                playbackControls.removeAllViews()
                val dock = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                    layoutDirection = View.LAYOUT_DIRECTION_LTR
                    setPadding(dp(9), dp(8), dp(9), dp(8))
                    background = GradientDrawable().apply {
                        cornerRadius = dp(23).toFloat(); setColor(0xD4111116.toInt())
                        setStroke(dp(1), 0x403F374D)
                    }
                }
                val controls = listOfNotNull(audioButton, subtitleButton, previousEpisode, rewindButton,
                    playPauseButton, forwardButton, nextEpisode, qualityButton,
                    favoriteButton.takeIf { kind != KIND_EPISODE })
                controls.forEachIndexed { index, view ->
                    dock.addView(view, controlSize(if (view === playPauseButton) 100 else 76).apply {
                        if (index < controls.lastIndex) marginEnd = dp(8)
                    })
                    view.nextFocusLeftId = controls.getOrNull(index - 1)?.id ?: view.id
                    view.nextFocusRightId = controls.getOrNull(index + 1)?.id ?: view.id
                }
                hud.addView(dock, LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_HORIZONTAL })
            } else {
                for (index in 0 until options.childCount) {
                    options.getChildAt(index).layoutParams = (options.getChildAt(index).layoutParams as LinearLayout.LayoutParams).apply {
                        width = dp(52)
                        weight = 0f
                    }
                }
                hud.addView(CinemaStyle.actionStrip(this, options).apply { isHorizontalScrollBarEnabled = true })
            }
        }

        hudOverlay = if (isTv) hud else ScrollView(this).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = false
            addView(hud, FrameLayout.LayoutParams(-1, -2))
            visibility = View.GONE
        }
        root.addView(
            hudOverlay,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            )
        )
        setContentView(root)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            controlInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            updateHudLayout()
            insets
        }
        updateHudLayout()
        enterFullscreen()
        playerView.requestFocus()
        if (kind != KIND_LIVE) hud.post(progressRunnable)
        if (!isTv) showHudBriefly()
    }

    private fun enterFullscreen() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun updateHudLayout() {
        if (!::hud.isInitialized) return
        val horizontal = dp(if (isTv) 36 else 16)
        hud.setPadding(horizontal + controlInsets.left, dp(if (isTv) 30 else 12) + controlInsets.top,
            horizontal + controlInsets.right, dp(if (isTv) 18 else 12) + controlInsets.bottom)
        touchPlaybackControls?.let { row ->
            for (index in 0 until row.childCount) {
                row.getChildAt(index).layoutParams = controlSize(if (index == 1) 100 else 76).apply {
                    if (index < row.childCount - 1) marginEnd = dp(8)
                }
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateHudLayout()
        ViewCompat.requestApplyInsets(window.decorView)
        enterFullscreen()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterFullscreen()
    }

    private fun controlButton(icon: Int, label: String, action: () -> Unit) = AppCompatImageButton(this).apply {
        id = View.generateViewId()
        setImageResource(icon); contentDescription = label
        androidx.appcompat.widget.TooltipCompat.setTooltipText(this, label)
        scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        setPadding(dp(13), dp(13), dp(13), dp(13))
        imageTintList = ColorStateList.valueOf(Color.WHITE)
        isFocusable = true; isFocusableInTouchMode = isTv
        minimumWidth = dp(48); minimumHeight = dp(48)
        fun surface(focused: Boolean) = GradientDrawable().apply {
            cornerRadius = dp(18).toFloat()
            setColor(if (focused) 0xFF744AC2.toInt() else if (icon == R.drawable.player_pause) 0xFF4E317C.toInt() else 0xB31B1A20.toInt())
            setStroke(dp(1), if (focused) 0xFFE2D0FF.toInt() else 0x404D455A)
        }
        background = surface(false)
        setOnFocusChangeListener { view, focused ->
            view.background = surface(focused)
            if (!isTv) {
                if (focused) { controlHint.text = view.contentDescription; keepHudVisible() }
                else if (controlHint.text == view.contentDescription) controlHint.text = ""
            }
            if (focused) keepHudVisible()
        }
        setOnClickListener { action() }
    }

    private fun togglePlayPause() {
        if (session.player.isPlaying) {
            session.player.pause()
        } else {
            session.player.play()
        }
        updatePlayPauseLabel()
        showHudBriefly()
    }

    private fun updatePlayPauseLabel() {
        if (!::playPauseButton.isInitialized) return
        playPauseButton.setImageResource(if (session.player.isPlaying) R.drawable.player_pause else R.drawable.player_play)
        playPauseButton.contentDescription = if (session.player.isPlaying) {
            getString(R.string.player_pause)
        } else {
            getString(R.string.player_play)
        }
        androidx.appcompat.widget.TooltipCompat.setTooltipText(playPauseButton, playPauseButton.contentDescription)
        if (!isTv && ::controlHint.isInitialized && playPauseButton.hasFocus()) controlHint.text = playPauseButton.contentDescription
    }

    private fun seekBy(deltaMs: Long) {
        val duration = session.player.duration.takeIf { it > 0L }
        val target = (session.player.currentPosition + deltaMs).coerceAtLeast(0L)
        session.player.seekTo(
            if (duration != null) target.coerceAtMost(duration) else target
        )
    }

    private fun updateProgressUi() {
        if (kind == KIND_LIVE || !::session.isInitialized) return
        checkpoint.sample(session.player.currentPosition, session.player.duration,
            session.player.playbackState == Player.STATE_READY || session.player.playbackState == Player.STATE_ENDED)
        val position = checkpoint.positionMs
        val duration = checkpoint.durationMs
        positionView?.text = formatDuration(position)
        durationView?.text = formatDuration(duration)
        if (!seeking) progressBar?.progress = if (duration > 0L) {
            ((position * 1000L / duration).coerceIn(0L, 1000L)).toInt()
        } else {
            0
        }
    }

    private fun formatDuration(ms: Long): String {
        val total = ms / 1000L
        val h = total / 3600L
        val m = (total % 3600L) / 60L
        val s = total % 60L
        return if (h > 0) {
            String.format(Locale.US, "%d:%02d:%02d", h, m, s)
        } else {
            String.format(Locale.US, "%02d:%02d", m, s)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val routed = RemoteKeyRouter.route(event)
        if (event.action != KeyEvent.ACTION_DOWN) {
            return super.dispatchKeyEvent(event)
        }
        if (routed.action == RemoteAction.OK && ::connectionNotice.isInitialized && connectionNotice.hasFocus()) {
            connectionNotice.performClick()
            return true
        }
        if (hud.visibility == View.VISIBLE && routed.action in HUD_NAVIGATION_ACTIONS) {
            keepHudVisible()
        }

        return when (routed.action) {
            RemoteAction.BACK -> {
                if (hud.visibility == View.VISIBLE) {
                    hideHud()
                } else {
                    finish()
                }
                true
            }

            RemoteAction.PLAY_PAUSE -> {
                if (kind != KIND_LIVE) {
                    togglePlayPause()
                } else if (session.player.isPlaying) {
                    session.player.pause()
                } else {
                    session.player.play()
                }
                true
            }

            RemoteAction.FAST_FORWARD -> {
                if (kind != KIND_LIVE) {
                    seekBy(10_000L)
                    showHudBriefly()
                }
                true
            }

            RemoteAction.REWIND -> {
                if (kind != KIND_LIVE) {
                    seekBy(-10_000L)
                    showHudBriefly()
                }
                true
            }

            RemoteAction.RIGHT -> {
                if (kind != KIND_LIVE && hud.visibility != View.VISIBLE) {
                    seekBy(10_000L)
                    showHudBriefly()
                    true
                } else {
                    super.dispatchKeyEvent(event)
                }
            }

            RemoteAction.LEFT -> {
                if (kind != KIND_LIVE && hud.visibility != View.VISIBLE) {
                    seekBy(-10_000L)
                    showHudBriefly()
                    true
                } else {
                    super.dispatchKeyEvent(event)
                }
            }

            RemoteAction.CHANNEL_NEXT -> {
                when (kind) {
                    KIND_LIVE -> switchLive(1)
                    KIND_EPISODE -> playAdjacentEpisode(1)
                    else -> return super.dispatchKeyEvent(event)
                }
                true
            }

            RemoteAction.CHANNEL_PREVIOUS -> {
                when (kind) {
                    KIND_LIVE -> switchLive(-1)
                    KIND_EPISODE -> playAdjacentEpisode(-1)
                    else -> return super.dispatchKeyEvent(event)
                }
                true
            }

            RemoteAction.DIGIT -> {
                if (kind == KIND_LIVE && routed.digit != null) {
                    handleChannelDigit(routed.digit)
                    true
                } else {
                    super.dispatchKeyEvent(event)
                }
            }

            RemoteAction.OK -> {
                val focusedControl = actionableFocusedHudControl()
                when (
                    PlayerHudKeyPolicy.okAction(
                        hud.visibility == View.VISIBLE,
                        focusedControl != null
                    )
                ) {
                    HudOkAction.SHOW_HUD -> showHud()
                    HudOkAction.HIDE_HUD -> hideHud()
                    HudOkAction.CLICK_FOCUSED_CONTROL -> {
                        keepHudVisible()
                        focusedControl?.performClick()
                    }
                }
                true
            }

            else -> super.dispatchKeyEvent(event)
        }
    }

    private fun playAdjacentEpisode(delta: Int, automatic: Boolean = false) {
        if (kind != KIND_EPISODE || providerId.isBlank() || seriesId.isBlank()) {
            autoNextTriggered = false
            return
        }
        episodeNavigationJob?.cancel()
        episodeNavigationJob = lifecycleScope.launch {
            val provider = dao.provider(providerId) ?: run {
                autoNextTriggered = false
                return@launch
            }
            val items = dao.episodes(providerId, seriesId)
                .first()
                .sortedWith(compareBy({ it.season }, { it.episode }))
            val currentIndex = items.indexOfFirst { it.key == currentContentKey }
            val target = items.getOrNull(currentIndex + delta)
            if (target == null) {
                autoNextTriggered = false
                if (!automatic) {
                    Toast.makeText(
                        this@PlayerActivity,
                        if (delta > 0) "هذه آخر حلقة" else "هذه أول حلقة",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return@launch
            }

            transitionEpisode(automatic, ::saveResume, ::markCurrentCompleted) {
                checkpoint.reset()
                subtitlePolicy.reset()
                session.player.trackSelectionParameters = session.player.trackSelectionParameters.buildUpon()
                    .clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, defaultTextDisabled).build()
                currentContentKey = target.key
                currentTitle = target.title
                currentSeason = target.season
                currentEpisode = target.episode
                updateTitle("S${target.season} E${target.episode} • ${target.title}")
                session.play(
                    url = ContentUrlResolver.episode(provider, target),
                    resumeMs = 0L,
                    fallbackUrl = ContentUrlResolver.directFallback(target), fallbackUrls = ContentUrlResolver.recoveryUrls(target)
                )
            }
            autoNextTriggered = false
            showHudBriefly()
        }
    }

    private fun markCurrentCompleted() {
        if (currentContentKey.isBlank()) return
        val completedContentKey = currentContentKey
        val completedProviderId = providerId
        val completedDuration = session.player.duration.coerceAtLeast(0L)
        if (completedDuration > 0L) (application as BlofyApp).resumeStateWriter.enqueue(
            ResumeWriteRequest(completedContentKey, completedProviderId, KIND_EPISODE, completedDuration, completedDuration)
        )
    }

    private fun handleChannelDigit(digit: Int) {
        channelOverlayGeneration++
        if (digitBuffer.length >= 4) digitBuffer = ""
        digitBuffer += digit.toString()
        channelNumberView.text = digitBuffer
        channelNumberView.visibility = View.VISIBLE
        val generation = ++digitGeneration

        channelNumberView.postDelayed({
            if (generation != digitGeneration || isFinishing) {
                return@postDelayed
            }
            val number = digitBuffer.toIntOrNull()
            digitBuffer = ""
            channelNumberView.visibility = View.GONE
            if (number != null && number > 0) playChannelNumber(number)
        }, 900L)
    }

    private fun playChannelNumber(number: Int) {
        if (providerId.isBlank()) return

        val cached = SmartZappingCache.byNumber(providerId, categoryId, number)
        val provider = liveProvider
        if (cached != null && provider != null) {
            playLiveStream(provider, cached)
            return
        }

        lifecycleScope.launch {
            val resolvedProvider = liveProvider ?: dao.provider(providerId) ?: return@launch
            liveProvider = resolvedProvider
            val target = zappingCoordinator.channelNumber(
                providerId = providerId,
                categoryId = categoryId,
                number = number
            )
            if (target == null) {
                Toast.makeText(
                    this@PlayerActivity,
                    "رقم القناة غير موجود في هذه الفئة",
                    Toast.LENGTH_SHORT
                ).show()
                return@launch
            }
            playLiveStream(resolvedProvider, target)
        }
    }

    private fun showHud() {
        keepHudVisible()
        hud.visibility = View.VISIBLE
        hudOverlay.visibility = View.VISIBLE
        if (kind != KIND_LIVE) updateProgressUi()
        playPauseButton.requestFocus()
    }

    private fun hideHud() {
        keepHudVisible()
        hud.visibility = View.GONE
        hudOverlay.visibility = View.GONE
        playerView.requestFocus()
    }

    private fun keepHudVisible() {
        if (::hud.isInitialized) hud.removeCallbacks(hideHudRunnable)
    }

    private fun actionableFocusedHudControl(): View? {
        val focused = currentFocus ?: return null
        if (!focused.isShown || !focused.isEnabled || !focused.isClickable) {
            return null
        }
        var current: View? = focused
        while (current != null) {
            if (current === hud) return focused
            current = current.parent as? View
        }
        return null
    }

    private fun updateTitle(title: String) {
        titleView.text = if (title.isBlank()) "BLOFY PLAYER" else ContentPresentation.title(title, kind)
    }

    private fun primeSmartZapping() {
        if (providerId.isBlank() || kind != KIND_LIVE) return
        zappingWarmJob?.cancel()
        zappingWarmJob = lifecycleScope.launch {
            val provider = dao.provider(providerId) ?: return@launch
            liveProvider = provider
            zappingCoordinator.warm(providerId, categoryId)
            showCachedChannelPosition(currentStreamId)
        }
    }

    private fun switchLive(delta: Int) {
        if (providerId.isBlank() || currentStreamId.isBlank() || delta == 0) return

        val cached = SmartZappingCache.adjacent(
            providerId = providerId,
            categoryId = categoryId,
            currentRemoteId = currentStreamId,
            delta = delta
        )
        val provider = liveProvider
        if (cached != null && provider != null) {
            playLiveStream(provider, cached)
            return
        }

        pendingZapDelta += delta
        zappingJob?.cancel()
        zappingJob = lifecycleScope.launch {
            delay(ZAP_COALESCE_MS)
            val resolvedProvider = liveProvider ?: dao.provider(providerId) ?: run {
                pendingZapDelta = 0
                return@launch
            }
            liveProvider = resolvedProvider
            zappingCoordinator.warm(providerId, categoryId)

            val requestedDelta = pendingZapDelta
            pendingZapDelta = 0
            if (requestedDelta == 0) return@launch
            val target = zappingCoordinator.adjacent(
                providerId = providerId,
                categoryId = categoryId,
                currentRemoteId = currentStreamId,
                delta = requestedDelta
            ) ?: return@launch

            if (target.remoteId != currentStreamId) {
                playLiveStream(resolvedProvider, target)
            }
        }
    }

    private fun playLiveStream(provider: ProviderEntity, stream: StreamEntity) {
        if (
            stream.remoteId == currentStreamId &&
            stream.key == currentContentKey &&
            session.player.currentMediaItem != null
        ) {
            showCachedChannelPosition(stream.remoteId)
            showHudBriefly()
            return
        }

        val profile = providerProfile(provider)
        liveProvider = provider
        currentStreamId = stream.remoteId
        currentContentKey = stream.key
        currentTitle = stream.name

        RecentChannelStore.record(this, provider.id, stream.key)
        updateTitle(stream.name)
        showCachedChannelPosition(stream.remoteId)
        session.play(
            url = ContentUrlResolver.live(provider, profile, stream),
            fallbackUrl = ContentUrlResolver.directFallback(stream), fallbackUrls = ContentUrlResolver.recoveryUrls(stream)
        )
        refreshFavoriteState()
        requestShortEpgRefresh(provider, stream)
        observeEpg()
        if (hud.visibility != View.VISIBLE) showHudBriefly()
    }

    private fun showCachedChannelPosition(remoteId: String) {
        val position = SmartZappingCache.position(
            providerId = providerId,
            categoryId = categoryId,
            currentRemoteId = remoteId
        ) ?: return

        val generation = ++channelOverlayGeneration
        digitGeneration++
        digitBuffer = ""
        channelNumberView.text = "${position.number}"
        channelNumberView.visibility = View.VISIBLE
        channelNumberView.postDelayed({
            if (
                generation == channelOverlayGeneration &&
                digitBuffer.isEmpty() &&
                !isFinishing
            ) {
                channelNumberView.visibility = View.GONE
            }
        }, 1100L)
    }

    private fun refreshFavoriteState() {
        if (
            currentContentKey.isBlank() ||
            !::favoriteButton.isInitialized ||
            kind == KIND_EPISODE
        ) {
            return
        }
        lifecycleScope.launch {
            val item = dao.stream(currentContentKey)
            favoriteButton.contentDescription = if (item?.favorite == true) {
                "★ " + getString(R.string.player_favorite)
            } else {
                getString(R.string.player_favorite)
            }
        }
    }

    private fun toggleFavorite() {
        if (currentContentKey.isBlank() || kind == KIND_EPISODE) return
        lifecycleScope.launch {
            val item = dao.stream(currentContentKey) ?: return@launch
            dao.setFavorite(currentContentKey, !item.favorite)
            favoriteButton.contentDescription = if (!item.favorite) {
                "★ " + getString(R.string.player_favorite)
            } else {
                getString(R.string.player_favorite)
            }
        }
    }

    private fun requestShortEpgRefresh(
        provider: ProviderEntity? = null,
        stream: StreamEntity? = null
    ) {
        if (providerId.isBlank() || currentStreamId.isBlank()) return

        val expectedStreamId = stream?.remoteId ?: currentStreamId
        val expectedContentKey = stream?.key ?: currentContentKey
        epgRefreshJob?.cancel()
        epgRefreshJob = lifecycleScope.launch {
            delay(EPG_REFRESH_DEBOUNCE_MS)
            if (expectedStreamId != currentStreamId || isFinishing) return@launch

            val resolvedProvider = provider ?: dao.provider(providerId) ?: return@launch
            if (resolvedProvider.providerType.equals("m3u", true)) return@launch
            val resolvedStream = stream
                ?: dao.stream(expectedContentKey)
                ?: return@launch
            runCatching {
                PlaylistManager(XtreamClient.api, dao)
                    .syncShortEpg(resolvedProvider, resolvedStream.remoteId)
            }
        }
    }

    private fun observeEpg() {
        if (providerId.isBlank() || currentStreamId.isBlank()) return
        val observedStreamId = currentStreamId
        epgJob?.cancel()
        epgJob = lifecycleScope.launch {
            dao.epg(providerId, observedStreamId, System.currentTimeMillis())
                .collect { items ->
                    if (observedStreamId != currentStreamId) return@collect
                    val now = System.currentTimeMillis()
                    val current = items.firstOrNull {
                        now in it.startMs until it.endMs
                    } ?: items.firstOrNull()
                    val next = current?.let { currentItem ->
                        items.firstOrNull { it.startMs >= currentItem.endMs }
                    }

                    epgView.text = buildString {
                        if (current != null) {
                            append("الآن  ")
                                .append(time(current.startMs))
                                .append("–")
                                .append(time(current.endMs))
                                .append("   ")
                                .append(current.title)
                        } else {
                            append("لا تتوفر معلومات البرنامج")
                        }
                        if (next != null) {
                            append("\nالتالي  ")
                                .append(time(next.startMs))
                                .append("   ")
                                .append(next.title)
                        }
                    }
                }
        }
    }

    private fun time(ms: Long): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))

    private fun showHudBriefly() {
        keepHudVisible()
        hud.visibility = View.VISIBLE
        hudOverlay.visibility = View.VISIBLE
        if (kind != KIND_LIVE) {
            updateProgressUi()
        }
        updatePlayPauseLabel()
        hud.postDelayed(
            hideHudRunnable,
            if (kind == KIND_LIVE) 2200L else 3200L
        )
    }

    private fun showTrackDialog(trackType: Int) {
        val groups = session.player.currentTracks.groups.filter {
            it.type == trackType && it.length > 0
        }
        val entries = mutableListOf<TrackEntry>()
        groups.forEach { group ->
            for (index in 0 until group.length) {
                if (group.isTrackSupported(index)) {
                    entries += TrackEntry(
                        group,
                        index,
                        trackLabel(group.getTrackFormat(index), trackType)
                    )
                }
            }
        }

        val isText = trackType == C.TRACK_TYPE_TEXT
        val labels = buildList {
            if (isText) add("إيقاف الترجمة")
            addAll(entries.map { it.label })
        }
        if (labels.isEmpty()) {
            AlertDialog.Builder(this)
                .setMessage(
                    if (isText) {
                        "لا توجد ترجمات متاحة"
                    } else {
                        "لا توجد مسارات صوت إضافية"
                    }
                )
                .setPositiveButton("حسنًا", null)
                .show()
            return
        }

        AlertDialog.Builder(this)
            .setTitle(if (isText) "الترجمة" else "المسار الصوتي")
            .setItems(labels.toTypedArray()) { dialog, which ->
                if (isText) subtitlePolicy.manual = true
                if (isText && which == 0) {
                    session.player.trackSelectionParameters =
                        session.player.trackSelectionParameters
                            .buildUpon()
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .build()
                } else {
                    val entry = entries[which - if (isText) 1 else 0]
                    val override = TrackSelectionOverride(
                        entry.group.mediaTrackGroup,
                        listOf(entry.index)
                    )
                    session.player.trackSelectionParameters =
                        session.player.trackSelectionParameters
                            .buildUpon()
                            .setTrackTypeDisabled(trackType, false)
                            .setOverrideForType(override)
                            .build()
                }
                dialog.dismiss()
            }
            .show()
    }

    private fun showVideoQualityDialog() {
        val entries = mutableListOf<TrackEntry>()
        session.player.currentTracks.groups
            .filter { it.type == C.TRACK_TYPE_VIDEO && it.length > 0 }
            .forEach { group ->
                for (index in 0 until group.length) {
                    if (group.isTrackSupported(index)) {
                        entries += TrackEntry(
                            group,
                            index,
                            videoLabel(group.getTrackFormat(index))
                        )
                    }
                }
            }

        if (entries.isEmpty()) {
            AlertDialog.Builder(this)
                .setMessage("لا توجد جودات فيديو متعددة")
                .setPositiveButton("حسنًا", null)
                .show()
            return
        }

        val labels = listOf("تلقائي (Auto)") + entries.map { it.label }
        AlertDialog.Builder(this)
            .setTitle("الجودة")
            .setItems(labels.toTypedArray()) { dialog, which ->
                val builder = session.player.trackSelectionParameters
                    .buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false)
                if (which == 0) {
                    builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                } else {
                    val entry = entries[which - 1]
                    builder.setOverrideForType(
                        TrackSelectionOverride(
                            entry.group.mediaTrackGroup,
                            listOf(entry.index)
                        )
                    )
                }
                session.player.trackSelectionParameters = builder.build()
                dialog.dismiss()
            }
            .show()
    }

    private fun videoLabel(format: Format): String {
        val resolution = when {
            format.height >= 2160 -> "4K"
            format.height >= 1440 -> "1440p"
            format.height >= 1080 -> "1080p"
            format.height >= 720 -> "720p"
            format.height > 0 -> "${format.height}p"
            else -> "VIDEO"
        }
        val fps = if (format.frameRate > 0) {
            "${format.frameRate.toInt()}fps"
        } else {
            null
        }
        val bitrate = if (format.bitrate > 0) {
            "${format.bitrate / 1_000_000.0}Mbps"
        } else {
            null
        }
        return listOfNotNull(
            resolution,
            fps,
            bitrate,
            format.codecs
        ).joinToString(" • ")
    }

    private fun trackLabel(format: Format, type: Int): String {
        val language = format.language?.uppercase()
            ?: if (type == C.TRACK_TYPE_AUDIO) "AUDIO" else "SUB"
        val label = format.label?.takeIf { it.isNotBlank() }
        val codec = format.codecs?.takeIf { it.isNotBlank() }
        return listOfNotNull(label, language, codec)
            .distinct()
            .joinToString(" • ")
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT > 23) restorePlaybackSession()
    }

    override fun onResume() {
        if (Build.VERSION.SDK_INT <= 23) restorePlaybackSession()
        super.onResume()
        if (!networkRegistered) {
            runCatching { connectivity.registerNetworkCallback(NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), networkCallback) }
                .onSuccess { networkRegistered = true }
        }
        enterFullscreen()
        if (::hud.isInitialized && !sessionReleased && kind != KIND_LIVE) {
            hud.removeCallbacks(progressRunnable)
            hud.post(progressRunnable)
        }
    }

    override fun onPause() {
        saveResume()
        // Back/finish must close before Android destroys the video surface. On API 23,
        // paused activities cannot retain scarce decoder resources either.
        if (isFinishing || Build.VERSION.SDK_INT <= 23) releasePlaybackSession()
        super.onPause()
    }

    override fun onStop() {
        if (networkRegistered) { runCatching { connectivity.unregisterNetworkCallback(networkCallback) }; networkRegistered = false }
        releasePlaybackSession()
        super.onStop()
    }

    override fun onDestroy() {
        digitGeneration++
        channelOverlayGeneration++
        epgJob?.cancel()
        epgRefreshJob?.cancel()
        zappingWarmJob?.cancel()
        zappingJob?.cancel()
        if (::hud.isInitialized) {
            hud.removeCallbacks(hideHudRunnable)
            hud.removeCallbacks(progressRunnable)
        }
        releasePlaybackSession()
        super.onDestroy()
    }

    private fun saveResume() {
        if (
            kind == KIND_LIVE ||
            currentContentKey.isBlank() ||
            providerId.isBlank() ||
            !::session.isInitialized || sessionReleased
        ) {
            return
        }
        if (!checkpoint.sample(session.player.currentPosition, session.player.duration,
                session.player.playbackState == Player.STATE_READY || session.player.playbackState == Player.STATE_ENDED)) return
        val position = checkpoint.positionMs
        val duration = checkpoint.durationMs
        persistResume(
            ResumeWriteRequest(
                contentKey = currentContentKey,
                providerId = providerId,
                kind = kind,
                positionMs = position,
                durationMs = duration
            )
        )
    }

    internal open fun persistResume(request: ResumeWriteRequest) {
        (application as BlofyApp).resumeStateWriter.enqueue(request)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        saveResume()
        val state = if (::session.isInitialized && !sessionReleased) session.resumeState() else suspendedPlayback
        if (state != null) {
            outState.putLong(EXTRA_RESUME_MS, maxOf(state.positionMs, if (state.positionMs <= 0L) checkpoint.positionMs else 0L))
            outState.putBoolean("play_when_ready", state.playWhenReady)
            outState.putBundle("track_parameters", state.trackSelectionParameters.toBundle())
        }
        outState.putBoolean("subtitle_manual", subtitlePolicy.manual)
        outState.putBoolean("subtitle_auto_disabled", subtitlePolicy.disabledAutomatically)
        outState.putString(EXTRA_CONTENT_KEY, currentContentKey)
        outState.putString(EXTRA_STREAM_ID, currentStreamId)
        outState.putString(EXTRA_TITLE, currentTitle)
        outState.putInt(EXTRA_SEASON, currentSeason)
        outState.putInt(EXTRA_EPISODE, currentEpisode)
        super.onSaveInstanceState(outState)
    }

    private fun online(): Boolean = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true

    private fun showConnectionNotice(message: String) {
        if (!::connectionNotice.isInitialized || isFinishing || sessionReleased) return
        connectionNotice.text = message
        connectionNotice.visibility = View.VISIBLE
        if (isTv && session.player.playerError != null) connectionNotice.requestFocus()
    }

    private fun retryPlayback() {
        if (sessionReleased) return
        if (!online()) { pendingNetworkRecovery = true; showConnectionNotice(getString(R.string.player_offline)); return }
        saveResume()
        val playWhenReady = session.player.playWhenReady
        session.retrySameUrl()
        if (kind != KIND_LIVE && checkpoint.positionMs > 0L) session.player.seekTo(checkpoint.positionMs)
        session.player.playWhenReady = playWhenReady
        showConnectionNotice(getString(R.string.player_reconnecting))
    }

    private fun profileFromIntent() = ProviderProfile(
        providerKey = providerId.ifBlank { "default" },
        liveFormat = if (
            intent.getStringExtra(EXTRA_LIVE_FORMAT) == "m3u8"
        ) {
            LiveFormat.HLS
        } else {
            LiveFormat.TS
        },
        transport = if (
            intent.getStringExtra(EXTRA_PREFERRED_TRANSPORT)
                .equals("http", true)
        ) {
            TransportPreference.HTTP_FIRST
        } else {
            TransportPreference.CRONET_FIRST
        },
        player = if (
            intent.getStringExtra(EXTRA_PREFERRED_ENGINE)
                .equals("vlc", true)
        ) {
            PlayerPreference.VLC
        } else {
            PlayerPreference.MEDIA3
        },
        allowCrossProtocolRedirects = intent.getBooleanExtra(
            EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS,
            true
        ),
        providerKind = ProviderKind.from(
            intent.getStringExtra(EXTRA_PROVIDER_TYPE)
        )
    )

    private fun providerProfile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) {
            LiveFormat.HLS
        } else {
            LiveFormat.TS
        },
        transport = if (
            provider.preferredTransport.equals("http", true)
        ) {
            TransportPreference.HTTP_FIRST
        } else {
            TransportPreference.CRONET_FIRST
        },
        player = if (provider.preferredEngine.equals("vlc", true)) {
            PlayerPreference.VLC
        } else {
            PlayerPreference.MEDIA3
        },
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects,
        providerKind = ProviderKind.from(provider.providerType)
    )

    private data class TrackEntry(
        val group: Tracks.Group,
        val index: Int,
        val label: String
    )

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_CONTENT_KEY = "content_key"
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_KIND = "kind"
        const val EXTRA_LIVE_FORMAT = "live_format"
        const val EXTRA_PROVIDER_TYPE = "provider_type"
        const val EXTRA_PREFERRED_TRANSPORT = "preferred_transport"
        const val EXTRA_PREFERRED_ENGINE = "preferred_engine"
        const val EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS =
            "allow_cross_protocol_redirects"
        const val EXTRA_FALLBACK_URL = "fallback_url"
        const val EXTRA_FALLBACK_URLS = "fallback_urls"
        const val EXTRA_RESUME_MS = "resume_ms"
        const val EXTRA_STREAM_ID = "stream_id"
        const val EXTRA_CATEGORY_ID = "category_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_SERIES_ID = "series_id"
        const val EXTRA_SEASON = "season"
        const val EXTRA_EPISODE = "episode"

        private const val KIND_LIVE = "live"
        private const val KIND_EPISODE = "episode"
        private const val EPG_REFRESH_DEBOUNCE_MS = 650L
        private const val ZAP_COALESCE_MS = 45L

        private val PURPLE = Color.rgb(111, 54, 218)
        private val PURPLE_SOFT = Color.rgb(196, 157, 255)
        private val HUD_NAVIGATION_ACTIONS = setOf(
            RemoteAction.OK,
            RemoteAction.UP,
            RemoteAction.DOWN,
            RemoteAction.LEFT,
            RemoteAction.RIGHT
        )
    }
}
