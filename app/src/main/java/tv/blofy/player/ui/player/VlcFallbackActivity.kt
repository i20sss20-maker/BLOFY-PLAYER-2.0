package tv.blofy.player.ui.player

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media as VlcMedia
import org.videolan.libvlc.MediaPlayer as VlcMediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import tv.blofy.player.BlofyApp
import tv.blofy.player.R
import tv.blofy.player.data.ResumeWriteRequest
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Narrow 4K/HEVC compatibility path.
 *
 * Media3 remains BLOFY's primary playback engine. This screen is entered only after Media3
 * exhausts its decoder compatibility retry for non-live UHD content. LibVLC first tries its
 * hardware path and, if that fails, performs one software-decoder attempt.
 */
class VlcFallbackActivity : AppCompatActivity() {
    private lateinit var videoLayout: VLCVideoLayout
    private lateinit var notice: TextView
    private lateinit var progress: TextView
    private lateinit var hint: TextView

    private var libVlc: LibVLC? = null
    private var player: VlcMediaPlayer? = null
    private var playbackUrl = ""
    private var title = ""
    private var contentKey = ""
    private var providerId = ""
    private var contentKind = ""
    private var resumeMs = 0L
    private var softwareAttempted = false
    private var resumeApplied = false
    private var started = false
    private var ended = false

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY

        playbackUrl = intent.getStringExtra(PlayerActivity.EXTRA_URL).orEmpty()
        title = intent.getStringExtra(PlayerActivity.EXTRA_TITLE).orEmpty()
        contentKey = intent.getStringExtra(PlayerActivity.EXTRA_CONTENT_KEY).orEmpty()
        providerId = intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
        contentKind = intent.getStringExtra(PlayerActivity.EXTRA_KIND).orEmpty()
        resumeMs = intent.getLongExtra(PlayerActivity.EXTRA_RESUME_MS, 0L).coerceAtLeast(0L)

        if (playbackUrl.isBlank()) {
            finish()
            return
        }
        buildUi()
    }

    override fun onStart() {
        super.onStart()
        if (!started && playbackUrl.isNotBlank()) startVlc(hardware = true)
    }

    override fun onStop() {
        if (!ended) saveResume()
        releasePlayer()
        super.onStop()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        releasePlayer()
        runCatching { libVlc?.release() }
        libVlc = null
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        return when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_SPACE -> {
                togglePlayback()
                true
            }
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_MEDIA_REWIND -> {
                seekBy(-10_000L)
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                seekBy(10_000L)
                true
            }
            KeyEvent.KEYCODE_BACK -> {
                finish()
                true
            }
            else -> super.dispatchKeyEvent(event)
        }
    }

    private fun buildUi() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
        }

        videoLayout = VLCVideoLayout(this)
        root.addView(videoLayout, FrameLayout.LayoutParams(-1, -1))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(22), dp(15), dp(22), dp(15))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xD708060D.toInt(), 0x7208060D, 0x0008060D)
            )
        }
        top.addView(TextView(this).apply {
            text = title.ifBlank { getString(R.string.player_4k_compatibility_title) }
            textSize = 17f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            maxLines = 1
        }, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(TextView(this).apply {
            text = "4K · VLC"
            textSize = 11f
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            setTextColor(0xFFF0DDFF.toInt())
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(5), dp(10), dp(5))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xB3321C49.toInt())
                setStroke(dp(1), 0xFFB98AEF.toInt())
            }
        })
        root.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        notice = TextView(this).apply {
            text = getString(R.string.player_4k_compatibility_starting)
            textSize = 13f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(11), dp(18), dp(11))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0xE324172F.toInt())
                setStroke(dp(1), 0xFFB98AEF.toInt())
            }
        }
        root.addView(notice, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            topMargin = dp(74)
        })

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(14), dp(20), dp(14))
            background = GradientDrawable(
                GradientDrawable.Orientation.BOTTOM_TOP,
                intArrayOf(0xE508060D.toInt(), 0x8A08060D.toInt(), 0x0008060D)
            )
        }
        progress = TextView(this).apply {
            text = "00:00 / --:--"
            textSize = 13f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        hint = TextView(this).apply {
            text = getString(R.string.player_4k_compatibility_controls)
            textSize = 11.5f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        }
        bottom.addView(progress)
        bottom.addView(hint)
        root.addView(bottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        setContentView(root)
        root.requestFocus()
    }

    private fun ensureLibVlc(): LibVLC {
        libVlc?.let { return it }
        return LibVLC(applicationContext, arrayListOf(
            "--no-video-title-show",
            "--network-caching=1500"
        )).also { libVlc = it }
    }

    private fun startVlc(hardware: Boolean) {
        if (isFinishing || playbackUrl.isBlank()) return
        releasePlayer()
        resumeApplied = false

        val vlc = ensureLibVlc()
        val next = VlcMediaPlayer(vlc)
        player = next
        started = true

        runCatching { next.attachViews(videoLayout, null, true, false) }
            .onFailure {
                started = false
                showTerminalFailure()
                return
            }

        next.setEventListener { event ->
            when (event.type) {
                VlcMediaPlayer.Event.Playing -> runOnUiThread {
                    if (!resumeApplied && resumeMs > 0L) {
                        runCatching { next.setTime(resumeMs) }
                        resumeApplied = true
                    }
                    notice.visibility = View.GONE
                    updateProgress()
                }
                VlcMediaPlayer.Event.TimeChanged,
                VlcMediaPlayer.Event.LengthChanged -> runOnUiThread { updateProgress() }
                VlcMediaPlayer.Event.Paused -> runOnUiThread {
                    notice.text = getString(R.string.player_4k_compatibility_paused)
                    notice.visibility = View.VISIBLE
                }
                VlcMediaPlayer.Event.EndReached -> runOnUiThread {
                    ended = true
                    saveResume(completed = true)
                    finish()
                }
                VlcMediaPlayer.Event.EncounteredError -> runOnUiThread {
                    if (!softwareAttempted && !isFinishing) {
                        resumeMs = maxOf(resumeMs, runCatching { next.time }.getOrDefault(0L).coerceAtLeast(0L))
                        softwareAttempted = true
                        notice.text = getString(R.string.player_4k_compatibility_software)
                        notice.visibility = View.VISIBLE
                        mainHandler.post { if (!isFinishing) startVlc(hardware = false) }
                    } else {
                        showTerminalFailure()
                    }
                }
            }
        }

        val media = VlcMedia(vlc, Uri.parse(playbackUrl)).apply {
            setHWDecoderEnabled(hardware, hardware)
            addOption(":network-caching=1500")
            addOption(":http-user-agent=BLOFY PLAYER/2.0")
        }
        next.media = media
        media.release()
        notice.text = getString(
            if (hardware) R.string.player_4k_compatibility_starting
            else R.string.player_4k_compatibility_software
        )
        notice.visibility = View.VISIBLE
        next.play()
    }

    private fun togglePlayback() {
        val active = player ?: return
        if (active.isPlaying) {
            active.pause()
        } else {
            active.play()
            notice.visibility = View.GONE
        }
    }

    private fun seekBy(deltaMs: Long) {
        val active = player ?: return
        if (!active.isSeekable) return
        val length = runCatching { active.length }.getOrDefault(0L).coerceAtLeast(0L)
        val current = runCatching { active.time }.getOrDefault(0L).coerceAtLeast(0L)
        val target = (current + deltaMs).coerceAtLeast(0L).let { if (length > 0L) it.coerceAtMost(length) else it }
        runCatching { active.setTime(target) }
        resumeMs = target
        updateProgress()
    }

    private fun updateProgress() {
        val active = player ?: return
        val position = runCatching { active.time }.getOrDefault(resumeMs).coerceAtLeast(0L)
        val duration = runCatching { active.length }.getOrDefault(0L).coerceAtLeast(0L)
        resumeMs = position
        progress.text = "${formatTime(position)} / ${if (duration > 0L) formatTime(duration) else "--:--"}"
    }

    private fun saveResume(completed: Boolean = false) {
        if (contentKind == "live" || contentKey.isBlank() || providerId.isBlank()) return
        val active = player
        val duration = runCatching { active?.length ?: 0L }.getOrDefault(0L).coerceAtLeast(0L)
        val sampled = runCatching { active?.time ?: resumeMs }.getOrDefault(resumeMs).coerceAtLeast(0L)
        val position = if (completed && duration > 0L) duration else maxOf(resumeMs, sampled)
        resumeMs = position
        (application as? BlofyApp)?.resumeStateWriter?.enqueue(
            ResumeWriteRequest(
                contentKey = contentKey,
                providerId = providerId,
                kind = contentKind,
                positionMs = position,
                durationMs = duration
            )
        )
    }

    private fun releasePlayer() {
        val active = player ?: run {
            started = false
            return
        }
        player = null
        started = false
        runCatching { active.stop() }
        runCatching { active.detachViews() }
        runCatching { active.release() }
    }

    private fun showTerminalFailure() {
        notice.text = getString(R.string.player_4k_compatibility_failed_vlc)
        notice.visibility = View.VISIBLE
        progress.text = getString(R.string.player_4k_compatibility_back)
    }

    private fun formatTime(ms: Long): String {
        val total = (ms.coerceAtLeast(0L) / 1000L)
        val hours = total / 3600L
        val minutes = (total % 3600L) / 60L
        val seconds = total % 60L
        return if (hours > 0L) "%d:%02d:%02d".format(hours, minutes, seconds)
        else "%02d:%02d".format(minutes, seconds)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
