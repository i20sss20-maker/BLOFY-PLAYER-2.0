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
            layoutDirection = resources.configuration.layoutDirection
            background = AppCompatResources.getDrawable(this@SystemStatusActivity, R.drawable.blofy_home_background)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.START
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(50), dp(34), dp(50), dp(46))
        }
        root.addView(content)
        setContentView(root)
        renderHeader(getString(R.string.system_status_title))
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
                        activation == null -> getString(R.string.system_status_activation_unknown)
                        activation.activated -> getString(R.string.system_status_activation_active)
                        else -> getString(R.string.system_status_activation_inactive)
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
        renderHeader(getString(R.string.system_status_title))

        addSection(getString(R.string.system_status_section_app_device), listOf(
            getString(R.string.system_status_version) to BuildConfig.VERSION_NAME,
            getString(R.string.system_status_version_code) to BuildConfig.VERSION_CODE.toString(),
            getString(R.string.system_status_activation) to status.activation,
            getString(R.string.system_status_android) to getString(R.string.system_status_android_format, Build.VERSION.RELEASE, Build.VERSION.SDK_INT),
            getString(R.string.system_status_device) to deviceLabel(),
            getString(R.string.system_status_form_factor) to getString(if (DeviceClass.isTv(this)) R.string.system_status_tv else R.string.system_status_mobile)
        ))

        addSection(getString(R.string.system_status_section_network_memory), listOf(
            getString(R.string.system_status_network) to status.network,
            getString(R.string.system_status_memory_available) to status.memoryAvailable,
            getString(R.string.system_status_memory_total) to status.memoryTotal
        ))

        addSection(getString(R.string.system_status_section_server_library), if (status.providerName == null) {
            listOf(getString(R.string.system_status_active_playlist) to getString(R.string.system_status_no_playlist))
        } else {
            listOf(
                getString(R.string.system_status_active_playlist) to status.providerName,
                getString(R.string.system_status_server_type) to (status.providerType ?: "—").uppercase(),
                getString(R.string.system_status_channels) to status.live.toString(),
                getString(R.string.system_status_movies) to status.movies.toString(),
                getString(R.string.system_status_series) to status.series.toString(),
                getString(R.string.system_status_indexed_episodes) to status.episodes.toString(),
                getString(R.string.system_status_metadata) to status.metadata.toString(),
                getString(R.string.system_status_library_state) to when {
                    status.fullyReady && total > 0 -> getString(R.string.system_status_library_ready_full)
                    status.ready && total > 0 -> getString(R.string.system_status_library_ready_secondary)
                    else -> getString(R.string.system_status_library_needs_refresh)
                },
                getString(R.string.system_status_metadata_state) to getString(if (status.metadataReady) R.string.system_status_ready else R.string.system_status_preparing_unavailable),
                getString(R.string.system_status_episode_index) to getString(if (status.episodesReady) R.string.system_status_episode_index_ready else R.string.system_status_episode_index_preparing),
                getString(R.string.system_status_last_refresh) to formatTime(status.updatedAt)
            )
        })

        addSection(getString(R.string.system_status_section_storage), listOf(
            getString(R.string.system_status_temp_files) to LocalStorageManager.format(this, status.storage.temporaryBytes),
            getString(R.string.system_status_total_storage) to LocalStorageManager.format(this, status.storage.totalBytes)
        ))

        content.addView(Button(this).apply {
            text = getString(R.string.system_status_copy_report)
            CinemaStyle.styleButton(this)
            setOnClickListener { copyReport(status) }
        }, LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(4); bottomMargin = dp(14) })

        content.addView(TextView(this).apply {
            text = getString(R.string.system_status_privacy_note)
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
        })
        content.addView(TextView(this).apply {
            text = getString(R.string.system_status_tagline)
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, dp(16), 0, 0)
        })
    }

    private fun renderHeader(textValue: String) {
        content.removeAllViews()
        content.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(42)).apply { gravity = Gravity.START; bottomMargin = dp(12) })
        content.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.START
        })
        content.addView(TextView(this).apply {
            text = textValue
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, dp(4), 0, dp(18))
        })
    }

    private fun addSection(title: String, rows: List<Pair<String, String>>) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(20), dp(16), dp(20), dp(16))
            background = CinemaStyle.surface(this@SystemStatusActivity, radiusDp = 14)
        }
        panel.addView(TextView(this).apply {
            text = title
            textSize = 16f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, 0, 0, dp(8))
        })
        rows.forEach { (label, value) ->
            panel.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = resources.configuration.layoutDirection
                gravity = Gravity.CENTER_VERTICAL
                addView(TextView(this@SystemStatusActivity).apply {
                    text = label
                    textSize = 12.5f
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.START
                }, LinearLayout.LayoutParams(0, dp(34), 1f))
                addView(TextView(this@SystemStatusActivity).apply {
                    text = value
                    textSize = 12.5f
                    typeface = BlofyTvDesign.MediumTypeface
                    setTextColor(BlofyTvDesign.TextSecondary)
                    gravity = Gravity.END
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
        val network = manager.activeNetwork ?: return getString(R.string.system_status_disconnected)
        val capabilities = manager.getNetworkCapabilities(network) ?: return getString(R.string.system_status_disconnected)
        val transport = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi‑Fi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "Network"
        }
        val state = getString(if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) R.string.system_status_connected else R.string.system_status_unverified_internet)
        return getString(R.string.system_status_network_format, transport, state)
    }

    private fun deviceLabel(): String = listOf(Build.MANUFACTURER, Build.MODEL)
        .map { it.orEmpty().trim() }
        .filter { it.isNotBlank() }
        .distinctBy { it.lowercase() }
        .joinToString(" ")
        .ifBlank { getString(R.string.system_status_android_device) }

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
        Toast.makeText(this, getString(R.string.system_status_report_copied), Toast.LENGTH_SHORT).show()
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
