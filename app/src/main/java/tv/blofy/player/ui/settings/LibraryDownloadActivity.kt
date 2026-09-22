package tv.blofy.player.ui.settings

import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.preparation.FullLibraryPhase
import tv.blofy.player.data.preparation.FullLibrarySyncState
import tv.blofy.player.data.preparation.FullLibrarySyncWorker
import tv.blofy.player.data.preparation.PreparationJournal
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import java.io.File
import java.util.concurrent.TimeUnit

/** Local progress only. Opening this page never refreshes a provider or starts a download. */
class LibraryDownloadActivity : AppCompatActivity() {
    private lateinit var summary: TextView
    private lateinit var saved: TextView
    private lateinit var pending: TextView
    private lateinit var failed: TextView
    private lateinit var hint: TextView
    private lateinit var resume: Button
    private var providerId: String? = null
    private var countedAt = 0L
    private var imageCount = 0L
    private var resuming = false
    private fun copy(ar: String, en: String) = if (ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "ar") ar else en

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(24), dp(24), dp(24), dp(32))
        }
        fun label(size: Float = 17f) = TextView(this).apply {
            textSize = size
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }.also { page.addView(it, LinearLayout.LayoutParams(-1, -2)) }
        page.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(120), dp(48)))
        label(26f).text = copy("حالة حفظ المكتبة والصور", "Library download status")
        summary = label().apply { tag = "library_download_status"; text = copy("جاري قراءة الحالة…", "Reading status…") }
        saved = label().apply { tag = "library_download_saved" }
        pending = label().apply { tag = "library_download_pending" }
        failed = label().apply { tag = "library_download_failed" }
        hint = label(14f).apply { setTextColor(BlofyTvDesign.TextMuted) }
        resume = Button(this).apply {
            tag = "library_download_resume"
            text = copy("استكمال الناقص / إعادة المحاولة", "Resume missing items / Retry")
            CinemaStyle.styleButton(this)
            minimumHeight = dp(48)
            isEnabled = false
            setOnClickListener { resumeDownloads() }
        }
        page.addView(resume, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@LibraryDownloadActivity, R.drawable.blofy_home_background)
            addView(page)
        })
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    refresh()
                    delay(3_000)
                }
            }
        }
    }

    private suspend fun refresh() {
        try {
            val state = withContext(Dispatchers.IO) {
                val app = applicationContext
                val provider = BlofyDatabase.get(app).dao().providerSnapshotStored().firstOrNull { it.enabled }
                val now = SystemClock.elapsedRealtime()
                if (countedAt == 0L || now - countedAt >= 30_000) {
                    // Bounded directory depth; no bitmap decode or credential access.
                    imageCount = File(filesDir, "blofy_library_art").listFiles().orEmpty().sumOf { dir ->
                        dir.listFiles().orEmpty().count { it.name.endsWith(".jpg") && it.length() > 0L }.toLong()
                    }
                    countedAt = now
                }
                if (provider == null) null else {
                    val epoch = CatalogSyncState.lastUpdatedAt(app, provider.id)
                    val cursor = FullLibrarySyncState.read(app, provider.id, epoch, resetInvalid = false)
                    val progress = PreparationJournal(app).use { it.progress(provider.id, epoch) }
                    val running = WorkManager.getInstance(app)
                        .getWorkInfosForUniqueWork(FullLibrarySyncWorker.workName(provider.id))
                        .get(10, TimeUnit.SECONDS).any { it.state == WorkInfo.State.RUNNING }
                    Snapshot(provider.id, provider.name, cursor.complete, cursor.phase,
                        CatalogSyncState.isReady(app, provider.id), progress, running,
                        filesDir.usableSpace < 64L * 1024L * 1024L)
                }
            }
            providerId = state?.id
            saved.text = copy("صور محفوظة على الجهاز (كل القوائم): $imageCount",
                "Saved images on this device (all playlists): $imageCount")
            pending.visibility = if (state == null) View.GONE else View.VISIBLE
            failed.visibility = pending.visibility
            resume.isEnabled = state != null && state.ready && !state.complete && !resuming
            if (state == null) {
                summary.text = copy("لا توجد قائمة نشطة", "No active playlist")
                hint.text = copy("أضف باقتك أولًا من صفحة القوائم.", "Add your playlist first.")
                return
            }
            val status = when {
                state.complete -> copy("اكتمل الحفظ", "Fully saved")
                !state.ready -> copy("بانتظار حفظ الباقة", "Waiting for the base catalog")
                state.lowStorage -> copy("يلزم توفير مساحة ثم الاستكمال", "Free storage, then resume")
                state.running -> copy("جاري الحفظ", "Saving")
                else -> copy("بانتظار الاتصال أو موعد إعادة المحاولة", "Waiting for a connection or scheduled retry")
            }
            summary.text = "${state.name} • $status"
            pending.text = copy("الناقص المكتشف: ${state.progress.pendingImages} صورة • ${state.progress.pendingDetails} تفاصيل محتوى",
                "Known remaining: ${state.progress.pendingImages} images • ${state.progress.pendingDetails} content details")
            failed.text = copy("تعذّر حفظها وتنتظر إعادة المحاولة: ${state.progress.failed}",
                "Failed items waiting for retry: ${state.progress.failed}")
            hint.text = if (state.complete) copy("الصور محفوظة للاستخدام لاحقًا دون إعادة تنزيلها.",
                "Saved images are reused without downloading them again.")
            else if (state.phase.ordinal < FullLibraryPhase.RETRY_DETAILS.ordinal) copy(
                "يجري فحص المكتبة؛ قد يزيد عدد الناقص عند اكتشاف صور وتفاصيل إضافية. التحميل يستكمل من آخر نقطة محفوظة.",
                "The library is still being scanned; remaining items can increase as more images and details are found. Downloads resume from the saved position.")
            else copy("الملفات التي نجح حفظها لا تُحمّل مجددًا. الصور غير المتوفرة لدى المصدر تبقى ضمن الناقص.",
                "Saved files are reused. Images unavailable from the source remain pending.")
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            summary.text = copy("تعذرت قراءة الحالة، ستُعاد المحاولة تلقائيًا.", "Unable to read status. Retrying automatically.")
            resume.isEnabled = false
        }
    }

    private fun resumeDownloads() {
        val id = providerId ?: return
        if (resuming) return
        resuming = true
        resume.isEnabled = false
        lifecycleScope.launch {
            try {
                FullLibrarySyncWorker.resumeNow(applicationContext, id)
                resuming = false
                refresh()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                summary.text = copy("تعذر الاستكمال، حاول مجددًا.", "Unable to resume. Please retry.")
                resume.isEnabled = true
            } finally { resuming = false }
        }
    }

    private data class Snapshot(val id: String, val name: String, val complete: Boolean,
        val phase: FullLibraryPhase, val ready: Boolean, val progress: PreparationJournal.Progress,
        val running: Boolean, val lowStorage: Boolean)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
