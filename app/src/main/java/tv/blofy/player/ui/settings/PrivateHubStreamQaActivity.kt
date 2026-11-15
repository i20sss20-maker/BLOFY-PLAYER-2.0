package tv.blofy.player.ui.settings

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import tv.blofy.player.BuildConfig

/** Owner-only device lab; DEBUG builds only. No subscriber or Xtream routing. */
@OptIn(markerClass = [UnstableApi::class])
class PrivateHubStreamQaActivity : AppCompatActivity() {
    private lateinit var runField: EditText
    private lateinit var ticketField: EditText
    private lateinit var movie: CheckBox
    private lateinit var rights: CheckBox
    private lateinit var status: TextView
    private lateinit var view: PlayerView
    private var player: ExoPlayer? = null
    private var firstFrame = false
    private var audioTrack = false
    private var playObserved = false
    private var errorCode: String? = null

    private fun text(value: String, size: Float = 15f) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(Color.WHITE)
        setPadding(0, 9, 0, 9)
        gravity = Gravity.RIGHT
    }
    private fun button(value: String, action: () -> Unit) = Button(this).apply {
        text = value
        isAllCaps = false
        isFocusable = true
        setOnClickListener { action() }
    }
    private fun checkbox(value: String) = CheckBox(this).apply {
        text = value
        setTextColor(Color.WHITE)
        isFocusable = true
    }
    private fun input(hint: String, secret: Boolean = false) = EditText(this).apply {
        this.hint = hint
        setTextColor(Color.WHITE)
        setHintTextColor(Color.LTGRAY)
        inputType = InputType.TYPE_CLASS_TEXT or (if (secret)
            InputType.TYPE_TEXT_VARIATION_PASSWORD
        else InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
        if (secret) transformationMethod = PasswordTransformationMethod.getInstance()
        isSingleLine = true
        isSaveEnabled = false
        isFocusable = true
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DEBUG) { finish(); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val isTv = resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
            Configuration.UI_MODE_TYPE_TELEVISION
        val screen = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(9, 22, 34))
            isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(24, 24, 24, 32)
        }
        root.addView(text("BLOFY · تجربة الملف المحفوظ فعليًا", 24f))
        root.addView(text("مختبر خاص " + (if (isTv) "Android TV" else "Android") +
            " فقط. لا يستخدم Xtream مباشرة ولا يغيّر مكتبة المشتركين. " +
            "أدخل معرّف الملف والرمز المؤقت من لوحة الإدارة بعد فحص الفيديو والصوت."))
        runField = input("runId: mirror_...")
        ticketField = input("رمز الاختبار المؤقت (15 دقيقة)", true)
        root.addView(runField)
        root.addView(ticketField)
        movie = checkbox("اختبار فيلم (اتركها لاختبار حلقة)")
        rights = checkbox("أؤكد ترخيص الملف وأن هذا اختبار خاص فقط")
        root.addView(movie)
        root.addView(rights)
        view = PlayerView(this).apply {
            useController = true
            keepScreenOn = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 260)
            isFocusable = true
        }
        root.addView(view)
        status = text("لم يبدأ التشغيل. لا يوجد اتصال بالخادم.", 13f)
        root.addView(status)
        root.addView(button("تشغيل الملف المحفوظ من BLOFY") { startQa() })
        root.addView(button("إيقاف التجربة ومسح الرمز") { stopQa() })
        root.addView(button("إنهاء الاختبار") { finish() })
        screen.addView(root)
        setContentView(screen)
    }
    private fun startQa() {
        if (!BuildConfig.DEBUG) return
        stopPlayer()
        val kind = if (movie.isChecked) "movie" else "episode"
        val run = runField.text.toString().trim()
        val ticket = ticketField.text.toString().trim()
        if (!PrivateHubDeviceQaPolicy.approved(kind,run,ticket,rights.isChecked)) {
            status.text = "مرفوض: يلزم ملف معتمد ورمز صحيح وتأكيد الترخيص."
            return
        }
        val uri = android.net.Uri.parse(PrivateHubDeviceQaPolicy.endpoint(kind,run))
        val source = ProgressiveMediaSource.Factory(DataSource.Factory {
            PrivateHubBoundedDataSource(uri.toString(),ticket,
                if (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
                    Configuration.UI_MODE_TYPE_TELEVISION) "android_tv" else "android")
        }).createMediaSource(MediaItem.fromUri(uri))
        val p = ExoPlayer.Builder(this).build()
        player = p
        view.player = p
        p.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() {
                firstFrame = true
                updateStatus()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) playObserved = true
                updateStatus()
            }
            override fun onTracksChanged(tracks: Tracks) {
                audioTrack = tracks.groups.any {
                    it.type == C.TRACK_TYPE_AUDIO && it.isSelected
                }
                updateStatus()
            }
            override fun onPlayerError(error: PlaybackException) {
                errorCode = error.errorCodeName
                updateStatus()
            }
        })
        p.setMediaSource(source)
        p.playWhenReady = false
        p.prepare()
        status.text = "جاري فحص ملف BLOFY المحفوظ، دون الوصول إلى Xtream."
    }
    private fun updateStatus() {
        if (!::status.isInitialized) return
        status.text = "صورة: " + (if (firstFrame) "ظهرت" else "لم تظهر") +
            " · مسار صوت: " + (if (audioTrack) "موجود" else "غير معروف") +
            " · بدأ التشغيل: " + (if (playObserved) "نعم" else "لا") +
            (errorCode?.let { " · خطأ " + it } ?: "") +
            "\nوجود مسار صوت لا يثبت سماعه؛ راجع الصوت والصورة بنفسك."
    }
    private fun stopPlayer() {
        if (::view.isInitialized) view.player = null
        player?.release()
        player = null
        firstFrame = false
        audioTrack = false
        playObserved = false
        errorCode = null
    }
    private fun stopQa() {
        stopPlayer()
        ticketField.text.clear()
        status.text = "أوقفت التجربة ومسحت الرمز المؤقت."
    }
    override fun onStop() {
        player?.pause()
        super.onStop()
    }
    override fun onDestroy() {
        stopPlayer()
        if (::ticketField.isInitialized) ticketField.text.clear()
        super.onDestroy()
    }
}
