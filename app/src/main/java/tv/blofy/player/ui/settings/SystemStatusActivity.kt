package tv.blofy.player.ui.settings

import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogManifestStore
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import java.text.DateFormat
import java.util.Date

/**
 * Safe support diagnostics. This screen only reads local app/device state; it never probes playback,
 * exposes provider credentials, or changes the playback/runtime configuration.
 */
class SystemStatusActivity : AppCompatActivity() {
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = ScrollView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@SystemStatusActivity, R.drawable.blofy_home_background)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(50), dp(34), dp(50), dp(46))
        }
        root.addView(content)
        setContentView(root)
        renderHeader("تشخيص BLOFY")
        loadStatus()
    }

    private fun loadStatus() {
        lifecycleScope.launch {
            val snapshot = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull()
                val live = provider?.let { dao.catalogCountAll(it.id, "live") } ?: 0
                val movies = provider?.let { dao.catalogCountAll(it.id, "movie") } ?: 0
                val series = provider?.let { dao.catalogCountAll(it.id, "series") } ?: 0
                val manifest = provider?.let { CatalogManifestStore.read(applicationContext, it.id) }
                val activation = dao.activation()
                val memory = memorySnapshot()
                Snapshot(
                    providerName = provider?.name,
                    providerType = provider?.providerType,
                    ready = provider?.let { CatalogSyncState.isEntryReady(applicationContext, it.id) } == true,
                    fullyReady = provider?.let { CatalogSyncState.isFullyReady(applicationContext, it.id) } == true,
                    metadataReady = provider?.let { CatalogSyncState.isMetadataReady(applicationContext, it.id) } == true,
                    episodesReady = provider?.let { CatalogSyncState.areEpisodesReady(applicationContext, it.id) } == true,
                    updatedAt = provider?.let { CatalogSyncState.lastUpdatedAt(applicationContext, it.id) } ?: 0L,
                    live = live,
                    movies = movies,
                    series = series,
                    episodes = manifest?.episodeCount ?: 0,
                    metadata = manifest?.metadataCount ?: 0,
                    storage = LocalStorageManager.stats(applicationContext),
                    activation = when {
                        activation == null -> "غير معروف"
                        activation.activated -> "مفعّل"
                        else -> "غير مفعّل"
                    },
                    network = networkLabel(),
                    memoryAvailable = memory.first,
                    memoryTotal = memory.second
                )
            }
            if (!isFinishing && !isDestroyed) render(snapshot)
        }
    }

    private fun render(status: Snapshot) {
        content.removeAllViews()
        val total = status.live + status.movies + status.series
        renderHeader("تشخيص BLOFY")

        addSection("التطبيق والجهاز", listOf(
            "الإصدار" to BuildConfig.VERSION_NAME,
            "Version Code" to BuildConfig.VERSION_CODE.toString(),
            "حالة التفعيل" to status.activation,
            "نظام Android" to "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            "الجهاز" to deviceLabel(),
            "نوع الواجهة" to if (DeviceClass.isTv(this)) "TV" else "Mobile / Tablet"
        ))

        addSection("الشبكة والذاكرة", listOf(
            "حالة الشبكة" to status.network,
            "الذاكرة المتاحة" to status.memoryAvailable,
            "إجمالي الذاكرة" to status.memoryTotal
        ))

        addSection("السيرفر والمكتبة", if (status.providerName == null) {
            listOf("القائمة النشطة" to "لا توجد قائمة")
        } else {
            listOf(
                "القائمة النشطة" to status.providerName,
                "نوع السيرفر" to (status.providerType ?: "—").uppercase(),
                "القنوات" to status.live.toString(),
                "الأفلام" to status.movies.toString(),
                "المسلسلات" to status.series.toString(),
                "الحلقات المفهرسة" to status.episodes.toString(),
                "بيانات المحتوى" to status.metadata.toString(),
                "حالة المكتبة" to when {
                    status.fullyReady && total > 0 -> "جاهزة بالكامل"
                    status.ready && total > 0 -> "جاهزة • تجهيزات ثانوية قيد الاكتمال"
                    else -> "تحتاج تحديث المحتوى"
                },
                "بيانات الأفلام والمسلسلات" to if (status.metadataReady) "جاهزة" else "قيد التجهيز / غير متوفرة",
                "فهرس الحلقات" to if (status.episodesReady) "جاهز" else "قيد التجهيز / غير متوفر",
                "آخر تحديث ناجح" to formatTime(status.updatedAt)
            )
        })

        addSection("المساحة المستخدمة", listOf(
            "الملفات المؤقتة" to LocalStorageManager.format(this, status.storage.temporaryBytes),
            "إجمالي مساحة BLOFY" to LocalStorageManager.format(this, status.storage.totalBytes)
        ))

        content.addView(Button(this).apply {
            text = "نسخ تقرير التشخيص"
            CinemaStyle.styleButton(this)
            setOnClickListener { copyReport(status) }
        }, LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(4); bottomMargin = dp(14) })

        content.addView(TextView(this).apply {
            text = "التقرير لا يحتوي اسم المستخدم أو كلمة المرور أو رابط السيرفر."
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
        })
        content.addView(TextView(this).apply {
            text = "BLOFY PLAYER • مكتبتك، بطريقتك"
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(16), 0, 0)
        })
    }

    private fun renderHeader(textValue: String) {
        content.removeAllViews()
        content.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(42)).apply { gravity = Gravity.LEFT; bottomMargin = dp(12) })
        content.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        content.addView(TextView(this).apply {
            text = textValue
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, dp(18))
        })
    }

    private fun addSection(title: String, rows: List<Pair<String, String>>) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(16), dp(20), dp(16))
            background = CinemaStyle.surface(this@SystemStatusActivity, radiusDp = 14)
        }
        panel.addView(TextView(this).apply {
            text = title
            textSize = 16f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(8))
        })
        rows.forEach { (label, value) ->
            panel.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                addView(TextView(this@SystemStatusActivity).apply {
                    text = label
                    textSize = 12.5f
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.RIGHT
                }, LinearLayout.LayoutParams(0, dp(34), 1f))
                addView(TextView(this@SystemStatusActivity).apply {
                    text = value
                    textSize = 12.5f
                    typeface = BlofyTvDesign.MediumTypeface
                    setTextColor(BlofyTvDesign.TextSecondary)
                    gravity = Gravity.LEFT
                    maxLines = 1
                }, LinearLayout.LayoutParams(0, dp(34), 1f))
            })
        }
        content.addView(panel, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
    }

    private fun memorySnapshot(): Pair<String, String> {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(info)
        return LocalStorageManager.format(this, info.availMem) to LocalStorageManager.format(this, info.totalMem)
    }

    private fun networkLabel(): String {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork ?: return "غير متصل"
        val capabilities = manager.getNetworkCapabilities(network) ?: return "غير متصل"
        val transport = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi‑Fi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "Network"
        }
        val state = if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) "متصل" else "بدون تحقق إنترنت"
        return "$transport • $state"
    }

    private fun deviceLabel(): String = listOf(Build.MANUFACTURER, Build.MODEL)
        .map { it.orEmpty().trim() }
        .filter { it.isNotBlank() }
        .distinctBy { it.lowercase() }
        .joinToString(" ")
        .ifBlank { "Android device" }

    private fun copyReport(status: Snapshot) {
        val report = buildString {
            appendLine("BLOFY PLAYER DIAGNOSTICS")
            appendLine("App: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine("Android: ${Build.VERSION.RELEASE} / SDK ${Build.VERSION.SDK_INT}")
            appendLine("Device: ${deviceLabel()}")
            appendLine("Form factor: ${if (DeviceClass.isTv(this@SystemStatusActivity)) "TV" else "Mobile/Tablet"}")
            appendLine("Network: ${status.network}")
            appendLine("Memory: ${status.memoryAvailable} available / ${status.memoryTotal} total")
            appendLine("Activation: ${status.activation}")
            appendLine("Provider: ${status.providerName ?: "none"}")
            appendLine("Provider type: ${status.providerType ?: "none"}")
            appendLine("Catalog: live=${status.live}, movies=${status.movies}, series=${status.series}, episodes=${status.episodes}, metadata=${status.metadata}")
            appendLine("Catalog ready: ${status.ready}; fullyReady=${status.fullyReady}; metadataReady=${status.metadataReady}; episodesReady=${status.episodesReady}")
            appendLine("Last successful refresh: ${formatTime(status.updatedAt)}")
            appendLine("Storage: ${LocalStorageManager.format(this@SystemStatusActivity, status.storage.totalBytes)}")
        }.trim()
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("BLOFY diagnostics", report))
        Toast.makeText(this, "تم نسخ تقرير التشخيص", Toast.LENGTH_SHORT).show()
    }

    private fun formatTime(value: Long): String =
        if (value <= 0L) "—" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(value))

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private data class Snapshot(
        val providerName: String?,
        val providerType: String?,
        val ready: Boolean,
        val fullyReady: Boolean,
        val metadataReady: Boolean,
        val episodesReady: Boolean,
        val updatedAt: Long,
        val live: Int,
        val movies: Int,
        val series: Int,
        val episodes: Int,
        val metadata: Int,
        val storage: LocalStorageManager.StorageStats,
        val activation: String,
        val network: String,
        val memoryAvailable: String,
        val memoryTotal: String
    )
}
