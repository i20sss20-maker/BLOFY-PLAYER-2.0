package tv.blofy.player.ui.settings

import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import java.io.ByteArrayOutputStream
import java.util.Locale

/**
 * QA-only Android / Android TV local playback bench.
 *
 * Never calls the Content Hub, uses no bearer tokens and never displays a
 * remote URL. The operator imports the public-safe, locally saved worksheet
 * and *separately* picks a licensed local video using Android's SAF picker.
 * The association between the selected worksheet row and selected file is
 * operator-provided, NOT a proof that the stored Hub media played.
 *
 * Not available through release build navigation. Component is non-exported
 * and guarded again here to fail closed even if launched internally.
 */
@OptIn(markerClass = [UnstableApi::class])
class PrivateMediaQaActivity : AppCompatActivity() {
    private val expectedPlatform by lazy {
        val mask = resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK
        if (mask == Configuration.UI_MODE_TYPE_TELEVISION) "android_tv" else "android"
    }
    private lateinit var root: LinearLayout
    private lateinit var status: TextView
    private lateinit var diagnostics: TextView
    private lateinit var playerView: PlayerView
    private lateinit var rows: LinearLayout
    private lateinit var export: Button
    private lateinit var imageCheck: CheckBox
    private lateinit var soundCheck: CheckBox
    private lateinit var navigationCheck: CheckBox
    private lateinit var subtitleCheck: CheckBox
    private var player: ExoPlayer? = null
    private var selected: Episode? = null
    private var seasonKey: String? = null
    private var localVideo: Uri? = null
    private var firstFrame = false
    private var hasAudioTrack = false
    private var hasSubtitleTrack = false
    private var playerReady = false
    private var mediaError: String? = null
    private var playingObserved = false

    private data class Episode(val id: String, val number: Int,
                               val title: String, val candidate: Boolean)

    private val loadWorksheet = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val parsed = runCatching {
                val raw = withContext(Dispatchers.IO) { readDocumentBounded(uri, 128 * 1024) }
                parseWorksheet(raw)
            }
            parsed.onSuccess { (key, items) ->
                seasonKey = key
                rows.removeAllViews()
                stopLocalPlayback()
                selected = null
                items.forEach { episode ->
                    rows.addView(action("الحلقة ${episode.number} · ${episode.title}" +
                        if (episode.candidate) " · مرشحة لاختبار خاص" else " · غير معتمدة للاختبار") {
                        // The worksheet is a guide only. Do not run unapproved
                        // files or assume a matching local file was selected.
                        stopLocalPlayback()
                        selected = episode
                        resetManualChecks()
                        status.text = "اختر ملف فيديو محليًا مرخصًا للحلقة ${episode.number}. لا توجد روابط بث في هذه الصفحة."
                    })
                }
                status.text = "تم تحميل ورقة اختبار ${items.size} حلقة للموسم $key. لا تبدأ المعاينة إلا بعد اختيار ملف محلي بنفسك."
            }.onFailure {
                status.text = "ورقة الاختبار مرفوضة أو كبيرة أو غير مطابقة للجهاز. لم يتم تشغيل أي محتوى."
            }
        }
    }
    private val chooseLocalVideo = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null || selected == null) return@registerForActivityResult
        if (!PrivateMediaQaPolicy.maySelectLocalVideo(
                episodeSelected = selected != null,
                candidateForPrivateDeviceTest = selected?.candidate == true,
                documentScheme = uri.scheme
            )) {
            status.text = "الفيديو المحلي يجب اختياره عبر منتقي ملفات النظام فقط."
            return@registerForActivityResult
        }
        stopLocalPlayback()
        resetManualChecks()
        localVideo = uri
        status.text = "اختير ملف محلي. اضغط زر التشغيل داخل المشغل لاختبار الصورة والصوت. التحقق اليدوي لا يُعتمد تلقائيًا."
        startLocalPlayer(uri)
    }
    private val exportWorksheet = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null || selected == null || seasonKey == null) return@registerForActivityResult
        val chosen = checkNotNull(selected)
        val report = JSONObject().apply {
            put("schema", "blofy.local-device-qa-observation")
            put("version", 1)
            put("sourceWorksheet", "blofy.private-device-qa-manifest")
            put("platform", expectedPlatform)
            put("seasonKey", seasonKey)
            put("runId", chosen.id)
            put("episodeNumber", chosen.number)
            put("localSampleChosen", localVideo != null)
            put("playerReadyObserved", playerReady)
            put("playingObserved", playingObserved)
            put("firstFrameObserved", firstFrame)
            put("audioTrackDetected", hasAudioTrack)
            put("subtitleTrackDetected", hasSubtitleTrack)
            put("imageConfirmedByOperator", imageCheck.isChecked && playingObserved)
            put("audioConfirmedByOperator", soundCheck.isChecked && playingObserved)
            put("navigationConfirmedByOperator", navigationCheck.isChecked)
            put("subtitleTestConfirmedByOperator", subtitleCheck.isChecked)
            put("playbackErrorObserved", mediaError != null)
            put("exportedAtUtc", System.currentTimeMillis())
            put("deviceMediaOrigin", "owner_selected_local_content_uri_only")
            put("hubMediaIdentityVerified", false)
            put("hubBackendUpdated", false)
            put("contentReleaseApproved", false)
            put("customerCutover", false)
        }
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    contentResolver.openOutputStream(uri, "w")?.use {
                        it.write(report.toString(2).toByteArray(Charsets.UTF_8))
                    } ?: error("cannot_write_report")
                }
            }
            status.text = if (result.isSuccess) {
                "حُفظ التقرير المحلي بنجاح. لم تُرسل أي بيانات للخادم ولم يتغير بث المشتركين."
            } else "تعذر حفظ التقرير؛ لم تتغير بيانات الخادم."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DEBUG) { finish(); return }
        buildPage()
    }

    private fun buildPage() {
        val screen = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.rgb(8, 22, 35))
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(20), dp(20), dp(30))
        }
        val heading = text("BLOFY · مختبر الفيديو الخاص للأجهزة", 23f, Color.WHITE)
        root.addView(heading)
        root.addView(text(
            "تجربة محلية على ${if (expectedPlatform == "android_tv") "Android TV" else "Android"} فقط. " +
                "حمّل ورقة QA JSON من مركز المحتوى، ثم اختر عينة فيديو مرخصة من ملفات جهازك. " +
                "لا نربط التطبيق بخادم الإدارة ولا نرسل بيانات أو نعرض ملفات المشتركين.", 14f))
        root.addView(action("١ · استيراد ورقة اختبار الجهاز JSON") {
            loadWorksheet.launch(arrayOf("application/json", "text/plain"))
        })
        status = text("لم تُحمّل ورقة اختبار بعد.", 13f)
        root.addView(status)
        rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(rows)
        root.addView(action("٢ · اختيار فيديو محلي مرخص (دون إنترنت)") {
            if (selected == null) {
                status.text = "اختر أولًا حلقة من ورقة الاختبار."
            } else if (selected?.candidate != true) {
                status.text = "هذه الحلقة غير مرشحة في ورقة الاختبار، راجع تحقق التخزين والصوت والصورة أولًا."
            } else {
                chooseLocalVideo.launch(arrayOf("video/*"))
            }
        })
        playerView = PlayerView(this).apply {
            useController = true
            keepScreenOn = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(250))
        }
        root.addView(playerView)
        diagnostics = text("فحص الجهاز: لم يتم تشغيل ملف محلي بعد.", 13f)
        root.addView(diagnostics)
        imageCheck = checkbox("شاهدت صورة واضحة بنفسي")
        soundCheck = checkbox("سمعت صوتًا سليمًا بنفسي")
        navigationCheck = checkbox("تحققت من التنقل والتقديم والريموت")
        subtitleCheck = checkbox("راجعت الترجمة (أو دونت أنها غير متوفرة)")
        listOf(imageCheck, soundCheck, navigationCheck, subtitleCheck).forEach(root::addView)
        export = action("٣ · حفظ تقرير اختبار محلي (بدون إرسال)") {
            if (!PrivateMediaQaPolicy.mayExportObservation(
                    selected != null, localVideo != null, playingObserved
                )) {
                status.text = "شغّل عينة محلية فعليًا أولًا ثم احفظ التقرير."
            } else {
                exportWorksheet.launch("BLOFY-device-qa-${expectedPlatform}-${selected?.number}.json")
            }
        }
        root.addView(export)
        root.addView(action("إغلاق المختبر") { finish() })
        screen.addView(root)
        setContentView(screen)
        resetManualChecks()
    }

    private fun parseWorksheet(data: ByteArray): Pair<String, List<Episode>> {
        val root = JSONObject(data.toString(Charsets.UTF_8))
        val rows = root.optJSONArray("episodes") ?: error("no_episodes")
        require(PrivateMediaQaPolicy.acceptsWorksheet(
            schema = root.optString("schema"),
            version = root.optInt("version"),
            platform = root.optString("platform"),
            expectedPlatform = expectedPlatform,
            privateOnly = root.optBoolean("privateOnly"),
            readOnly = root.optBoolean("readOnly"),
            customerCutover = root.optBoolean("customerCutover", true),
            releaseApproved = root.optBoolean("releaseToSubscribersApproved", true),
            appIntegrationCompleted = root.optBoolean("appIntegrationCompleted", true),
            mediaUrlsIncluded = root.optBoolean("playableMediaUrlsIncluded", true),
            episodeCount = rows.length()
        ))
        val season = root.optString("seasonKey")
        require(PrivateMediaQaPolicy.validSeasonKey(season))
        val seen = HashSet<String>()
        val episodes = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val id = row.getString("runId")
            require(PrivateMediaQaPolicy.validRunId(id) && seen.add(id))
            val number = row.getInt("episodeNumber")
            require(number in 1..500)
            // Never read any URL, token, storage key, host or player hint from
            // imported data. Only the safe display subset is accepted.
            val title = row.optString("title").take(120)
                .map { if (Character.isISOControl(it)) ' ' else it }.joinToString("")
            Episode(id, number, title, row.optBoolean("candidateForOwnerDeviceTesting"))
        }
        return season to episodes
    }

    private fun readDocumentBounded(uri: Uri, maxBytes: Int): ByteArray {
        require(uri.scheme == "content")
        val output = ByteArrayOutputStream()
        contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (output.size() + read > maxBytes) error("qa_document_too_large")
                output.write(buffer, 0, read)
            }
        } ?: error("qa_document_unreadable")
        return output.toByteArray()
    }

    private fun startLocalPlayer(uri: Uri) {
        // ExoPlayer reads only content:// provided by Android's system picker.
        // It never sees the Content Hub URL or an operator credential.
        val playback = ExoPlayer.Builder(this).build()
        player = playback
        playerView.player = playback
        playback.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) playerReady = true
                refreshDiagnostics()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) playingObserved = true
                refreshDiagnostics()
            }
            override fun onRenderedFirstFrame() {
                firstFrame = true
                refreshDiagnostics()
            }
            override fun onTracksChanged(tracks: Tracks) {
                hasAudioTrack = tracks.groups.any {
                    it.type == C.TRACK_TYPE_AUDIO && it.isSelected
                }
                hasSubtitleTrack = tracks.groups.any {
                    it.type == C.TRACK_TYPE_TEXT
                }
                refreshDiagnostics()
            }
            override fun onPlayerError(error: PlaybackException) {
                mediaError = "فشل مشغل العينة المحلية: ${error.errorCodeName}"
                refreshDiagnostics()
            }
        })
        playback.setMediaItem(MediaItem.fromUri(uri))
        playback.playWhenReady = false
        playback.prepare()
    }

    private fun stopLocalPlayback() {
        playerView.player = null
        player?.release()
        player = null
        localVideo = null
        firstFrame = false
        hasAudioTrack = false
        hasSubtitleTrack = false
        playerReady = false
        playingObserved = false
        mediaError = null
        if (::diagnostics.isInitialized) refreshDiagnostics()
    }
    private fun refreshDiagnostics() {
        if (!::diagnostics.isInitialized) return
        diagnostics.text = "جاهز: ${yes(playerReady)} · بدأ التشغيل: ${yes(playingObserved)} · " +
            "أول إطار صورة: ${yes(firstFrame)} · مسار صوت: ${yes(hasAudioTrack)} · " +
            "مسار ترجمة: ${yes(hasSubtitleTrack)}\n" +
            (mediaError ?: "وجود مسار صوت لا يثبت سماعه؛ يتطلب تأكيدك الشخصي.")
    }
    private fun resetManualChecks() {
        if (!::imageCheck.isInitialized) return
        listOf(imageCheck, soundCheck, navigationCheck, subtitleCheck).forEach {
            it.isChecked = false
        }
    }
    private fun yes(value: Boolean) = if (value) "نعم" else "لا"
    private fun text(value: String, size: Float, color: Int = Color.rgb(192, 218, 232)) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(8))
        }
    private fun action(title: String, onTap: () -> Unit) =
        Button(this).apply {
            text = title
            textSize = 15f
            isAllCaps = false
            setOnClickListener { onTap() }
            isFocusable = true
        }
    private fun checkbox(label: String) = CheckBox(this).apply {
        text = label
        textSize = 14f
        setTextColor(Color.WHITE)
        isChecked = false
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onStop() {
        // Android system document pickers also stop this Activity. Pause but
        // preserve the selected media and observations for CreateDocument.
        player?.pause()
        super.onStop()
    }
    override fun onDestroy() {
        stopLocalPlayback()
        super.onDestroy()
    }
}
