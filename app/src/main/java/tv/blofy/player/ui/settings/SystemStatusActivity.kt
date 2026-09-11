package tv.blofy.player.ui.settings

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
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
import android.widget.Button
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/** Lightweight status page: local state only, no playback probing and no external metadata services. */
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
        renderHeader("حول BLOFY")
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
                Snapshot(
                    providerName = provider?.name,
                    providerType = provider?.providerType,
                    ready = provider?.let { CatalogSyncState.isReady(applicationContext, it.id) } == true,
                    fullyReady = manifest?.fullyReady == true,
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
                    }
                )
            }
            if (!isFinishing && !isDestroyed) render(snapshot)
        }
    }

    private fun render(status: Snapshot) {
        content.removeAllViews()
        val total = status.live + status.movies + status.series
        renderHeader("حول BLOFY")
        addSection("التطبيق", listOf(
            "الإصدار" to BuildConfig.VERSION_NAME,
            "حالة التفعيل" to status.activation
        ))
        addSection("مكتبتك", if (status.providerName == null) {
            listOf("القائمة النشطة" to "لا توجد قائمة")
        } else {
            listOf(
                "القائمة النشطة" to status.providerName,
                "القنوات" to status.live.toString(),
                "الأفلام" to status.movies.toString(),
                "المسلسلات" to status.series.toString(),
                "حالة المكتبة" to if (status.ready && total > 0) "جاهزة للتصفح" else "تحتاج تحديث المحتوى",
                "آخر تحديث" to formatTime(status.updatedAt)
            )
        })
        addSection("المساحة المستخدمة", listOf(
            "الملفات المؤقتة" to LocalStorageManager.format(this, status.storage.temporaryBytes),
            "إجمالي مساحة BLOFY" to LocalStorageManager.format(this, status.storage.totalBytes)
        ))
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
                    text = label; textSize = 12.5f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT
                }, LinearLayout.LayoutParams(0, dp(34), 1f))
                addView(TextView(this@SystemStatusActivity).apply {
                    text = value; textSize = 12.5f; typeface = BlofyTvDesign.MediumTypeface; setTextColor(BlofyTvDesign.TextSecondary); gravity = Gravity.LEFT
                }, LinearLayout.LayoutParams(0, dp(34), 1f))
            })
        }
        content.addView(panel, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
    }

    private fun formatTime(value: Long): String = if (value <= 0L) "—" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(value))
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private data class Snapshot(
        val providerName: String?, val providerType: String?, val ready: Boolean, val fullyReady: Boolean, val updatedAt: Long,
        val live: Int, val movies: Int, val series: Int, val episodes: Int, val metadata: Int,
        val storage: LocalStorageManager.StorageStats, val activation: String
    )
}
