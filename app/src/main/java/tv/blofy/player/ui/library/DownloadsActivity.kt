package tv.blofy.player.ui.library

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.series.EpisodesActivity

/** One screen for queued, active, completed and failed user-owned transfers. */
class DownloadsActivity : AppCompatActivity() {
    private lateinit var rows: LinearLayout
    private lateinit var empty: TextView
    private lateinit var space: TextView
    private val buttons = LinkedHashMap<Long, Button>()
    private var rowKeys: List<Long> = emptyList()
    private var currentFilter = "all"
    private val filterButtons = linkedMapOf<String, Button>()
    private val progressSamples = mutableMapOf<Long, Pair<Long, Long>>()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Never expose previously saved files from a signed-out device.
        if (BuildConfig.CODE_ONLY_LOGIN && StreamCodeSession.authorization(this) == null) {
            finish()
            return
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(36), dp(24), dp(36), dp(32))
            layoutDirection = resources.configuration.layoutDirection
            background = AppCompatResources.getDrawable(this@DownloadsActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.stream_downloads_title)
            textSize = 30f; setTextColor(Color.WHITE)
            typeface = BlofyTvDesign.HeadingTypeface
            gravity = Gravity.START
            setPadding(0,0,0,dp(10))
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.stream_downloads_note)
            textSize = 12.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(-1,-2).apply { bottomMargin = dp(12) })
        space = TextView(this).apply {
            textSize=12f
            setTextColor(BlofyTvDesign.TextSecondary)
            setPadding(0,0,0,dp(9))
        }
        root.addView(space)
        // New transfers only: Android DownloadManager is responsible for
        // auto-suspending on metered networks and resuming when Wi-Fi returns.
        root.addView(Button(this).apply {
            isAllCaps = false
            textSize = 13f
            CinemaStyle.styleButton(this)
            fun updateLabel() {
                text = getString(R.string.stream_downloads_network_policy) + ": " +
                    getString(if (OfflineDownloadSettings.wifiOnly(this@DownloadsActivity))
                        R.string.stream_downloads_wifi_only
                    else R.string.stream_downloads_any_network)
            }
            updateLabel()
            setOnClickListener {
                OfflineDownloadSettings.setWifiOnly(
                    applicationContext, !OfflineDownloadSettings.wifiOnly(applicationContext))
                updateLabel()
            }
        }, LinearLayout.LayoutParams(-1, dp(44)).apply { bottomMargin = dp(10) })
        val filters = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
        }
        listOf(
            "all" to R.string.stream_downloads_filter_all,
            "active" to R.string.stream_downloads_filter_active,
            "ready" to R.string.stream_downloads_filter_ready,
            "failed" to R.string.stream_downloads_filter_failed
        ).forEach { (key, label) ->
            filters.addView(Button(this).apply {
                text = getString(label)
                isAllCaps = false
                minWidth = 0
                minimumWidth = 0
                textSize = 12f
                setOnClickListener {
                    currentFilter = key
                    rowKeys = emptyList()
                    filterButtons.forEach { (name, button) ->
                        CinemaStyle.styleButton(button, name == currentFilter)
                    }
                    lifecycleScope.launch { refresh() }
                }
                filterButtons[key] = this
                CinemaStyle.styleButton(this, key == currentFilter)
            }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(6) })
        }
        root.addView(filters, LinearLayout.LayoutParams(-1, dp(56)).apply {
            bottomMargin = dp(8)
        })
        empty = TextView(this).apply {
            text = getString(R.string.stream_downloads_empty)
            setTextColor(BlofyTvDesign.TextMuted)
            textSize = 16f
            setPadding(dp(8),dp(24),dp(8),dp(12))
        }
        rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply {
            addView(LinearLayout(this@DownloadsActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(empty)
                addView(rows)
            })
        },LinearLayout.LayoutParams(-1,0,1f))
        setContentView(root)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while(isActive) {
                    refresh()
                    delay(2200)
                }
            }
        }
    }
    private suspend fun refresh() {
        val states = withContext(Dispatchers.IO) {
            val activeProvider = BlofyDatabase.get(applicationContext).dao().activeProviderId()
            OfflineDownloadStore.records(applicationContext,activeProvider ?: "__none__").mapNotNull { record ->
                OfflineDownloadStore.progress(applicationContext,record)
                    ?: OfflineDownloadStore.Progress(record,-1,0L,-1L,0,null)
            }
        }
        val downloadedBytes=states.asSequence()
            .filter { it.status==DownloadManager.STATUS_SUCCESSFUL }
            .sumOf { it.downloaded.coerceAtLeast(0L) }
        val free=withContext(Dispatchers.IO) {
            getExternalFilesDir(Environment.DIRECTORY_MOVIES)?.usableSpace ?: -1L
        }
        space.text=getString(R.string.stream_downloads_space,
            OfflineDownloadStore.formatSize(downloadedBytes),
            if(free>=0) OfflineDownloadStore.formatSize(free) else "—")
        if (free in 0 until 536_870_912L) {
            space.append("\n" + getString(R.string.stream_downloads_low_space))
        }
        val visible = states.filter { p -> when(currentFilter) {
            "active" -> p.status in setOf(
                DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING,
                DownloadManager.STATUS_PAUSED)
            "ready" -> p.status == DownloadManager.STATUS_SUCCESSFUL
            "failed" -> p.status == DownloadManager.STATUS_FAILED
            else -> true
        }}.sortedWith(compareBy<OfflineDownloadStore.Progress>(
            { if (it.record.kind == "movie") 0 else 1 },
            { if (it.record.kind == "episode")
                it.record.title.substringBefore(" • S").lowercase() else "" },
            { -it.record.createdAt }
        ))
        empty.visibility = if(visible.isEmpty()) View.VISIBLE else View.GONE
        val ids=visible.map { it.record.id }
        if(ids!=rowKeys) {
            rowKeys=ids
            buttons.clear()
            rows.removeAllViews()
            var lastGroup: String? = null
            visible.forEach { p ->
                val group = if (p.record.kind == "movie")
                    getString(R.string.stream_downloads_group_movies)
                else p.record.title.substringBefore(" • S").takeIf { it != p.record.title }
                    ?: getString(R.string.stream_downloads_group_episodes)
                if (group != lastGroup) {
                    rows.addView(TextView(this).apply {
                        text = group
                        textSize = 17f
                        typeface = BlofyTvDesign.HeadingTypeface
                        setTextColor(Color.WHITE)
                        setPadding(dp(4), dp(13), 0, dp(7))
                    })
                    lastGroup = group
                }
                val button = Button(this).apply {
                    isAllCaps=false
                    textSize=13.5f
                    typeface=BlofyTvDesign.BodyTypeface
                    gravity=Gravity.START or Gravity.CENTER_VERTICAL
                    CinemaStyle.styleButton(this)
                    setOnClickListener {
                        if(p.status==DownloadManager.STATUS_SUCCESSFUL && p.readyUri!=null) {
                            play(p)
                        } else if (p.status == DownloadManager.STATUS_FAILED) {
                            showFailure(p)
                        } else {
                            AlertDialog.Builder(this@DownloadsActivity)
                                .setTitle(p.record.title)
                                .setMessage(getString(R.string.stream_downloads_remove_note))
                                .setPositiveButton(getString(R.string.stream_downloads_remove)) { _,_ ->
                                    lifecycleScope.launch(Dispatchers.IO) {
                                        OfflineDownloadStore.remove(applicationContext,p.record)
                                    }
                                }
                                .setNegativeButton(android.R.string.cancel,null).show()
                        }
                    }
                    setOnLongClickListener {
                        AlertDialog.Builder(this@DownloadsActivity)
                            .setTitle(p.record.title)
                            .setMessage(getString(R.string.stream_downloads_remove_note))
                            .setPositiveButton(getString(R.string.stream_downloads_remove)) { _,_ ->
                                lifecycleScope.launch(Dispatchers.IO) {
                                    OfflineDownloadStore.remove(applicationContext,p.record)
                                }
                            }.setNegativeButton(android.R.string.cancel,null).show()
                        true
                    }
                }
                buttons[p.record.id]=button
                rows.addView(button, LinearLayout.LayoutParams(-1,dp(80)).apply {bottomMargin=dp(8)})
            }
        }
        val nowMs = android.os.SystemClock.elapsedRealtime()
        visible.forEach { p ->
            val sample = progressSamples[p.record.id]
            val speed = if (sample == null || p.status != DownloadManager.STATUS_RUNNING)
                0L else DownloadTransferPolicy.bytesPerSecond(
                    sample.first, p.downloaded, nowMs - sample.second)
            progressSamples[p.record.id] = p.downloaded to nowMs
            buttons[p.record.id]?.apply {
                text=buildString {
                    append(p.record.title)
                    append("   •   ")
                    append(when(p.status) {
                        DownloadManager.STATUS_RUNNING -> getString(R.string.stream_downloads_running)
                        DownloadManager.STATUS_PENDING -> getString(R.string.stream_downloads_pending)
                        DownloadManager.STATUS_PAUSED -> getString(R.string.stream_downloads_paused)
                        DownloadManager.STATUS_SUCCESSFUL -> getString(R.string.stream_downloads_ready)
                        DownloadManager.STATUS_FAILED -> getString(R.string.stream_downloads_failed)
                        else -> getString(R.string.stream_downloads_missing)
                    })
                    if(p.status in setOf(DownloadManager.STATUS_RUNNING,DownloadManager.STATUS_PAUSED)) {
                        p.percent?.let { append("  •  $it%") }
                        append("  •  ")
                        append(OfflineDownloadStore.formatSize(p.downloaded))
                        if(p.total>0) {append(" / ");append(OfflineDownloadStore.formatSize(p.total))}
                    }
                    if (p.status == OfflineDownloadStore.STATUS_MISSING) {
                        append("  •  " + getString(R.string.stream_downloads_unavailable_file))
                    }
                    if (p.status == DownloadManager.STATUS_RUNNING && speed > 0L) {
                        val eta = DownloadTransferPolicy.secondsRemaining(
                            p.total, p.downloaded, speed)
                        append("  •  ")
                        if (eta != null) append(getString(
                            R.string.stream_downloads_speed_eta,
                            OfflineDownloadStore.formatSize(speed),
                            if (eta >= 3600L) "${eta / 3600}h ${(eta % 3600) / 60}m"
                            else if (eta >= 60L) "${eta / 60}m ${eta % 60}s"
                            else "${eta}s"
                        ))
                        else append(getString(R.string.stream_downloads_speed_only,
                            OfflineDownloadStore.formatSize(speed)))
                    }
                    if (p.status == DownloadManager.STATUS_FAILED) {
                        append("  •  ")
                        append(if (p.reason == DownloadManager.ERROR_INSUFFICIENT_SPACE)
                            getString(R.string.stream_downloads_failure_space).substringBefore('.')
                        else p.reason.toString())
                    }
                }
                // Update click handler with CURRENT status, not the captured
                // status when a row was first built.
                setOnClickListener {
                    if(p.status==DownloadManager.STATUS_SUCCESSFUL && p.readyUri!=null) play(p)
                    else if(p.status==DownloadManager.STATUS_FAILED) showFailure(p)
                    else AlertDialog.Builder(this@DownloadsActivity)
                        .setTitle(p.record.title)
                        .setMessage(getString(R.string.stream_downloads_remove_note))
                        .setPositiveButton(getString(R.string.stream_downloads_remove)) { _,_ ->
                            lifecycleScope.launch(Dispatchers.IO) {
                                OfflineDownloadStore.remove(applicationContext,p.record)
                            }
                        }.setNegativeButton(android.R.string.cancel,null).show()
                }
            }
        }
    }

    /** Android DownloadManager error codes are actionable, not just numbers. */
    private fun showFailure(progress: OfflineDownloadStore.Progress) {
        val reasonText = when (progress.reason) {
            DownloadManager.ERROR_INSUFFICIENT_SPACE -> R.string.stream_downloads_failure_space
            DownloadManager.ERROR_UNHANDLED_HTTP_CODE, DownloadManager.ERROR_TOO_MANY_REDIRECTS ->
                R.string.stream_downloads_failure_http
            DownloadManager.ERROR_HTTP_DATA_ERROR -> R.string.stream_downloads_failure_network
            DownloadManager.ERROR_CANNOT_RESUME -> R.string.stream_downloads_failure_resume
            DownloadManager.ERROR_FILE_ERROR, DownloadManager.ERROR_DEVICE_NOT_FOUND,
            DownloadManager.ERROR_FILE_ALREADY_EXISTS -> R.string.stream_downloads_failure_file
            else -> null
        }
        val networkMessage = when (progress.reason) {
            401, 403 -> getString(R.string.stream_downloads_failure_http_access)
            404, 410 -> getString(R.string.stream_downloads_failure_http_missing)
            429 -> getString(R.string.stream_downloads_failure_http_busy)
            in 500..599 -> getString(R.string.stream_downloads_failure_http_server)
            else -> null
        }
        val message = networkMessage ?: reasonText?.let(::getString) ?:
            getString(R.string.stream_downloads_failure_generic, progress.reason)
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.stream_downloads_failure_title)
            .setMessage(message)
            .setNeutralButton(R.string.stream_downloads_remove) { _, _ ->
                lifecycleScope.launch(Dispatchers.IO) {
                    OfflineDownloadStore.remove(applicationContext, progress.record)
                }
            }
            .setNegativeButton(R.string.stream_ui_close, null)
        if (progress.reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) {
            dialog.setPositiveButton(R.string.stream_downloads_storage_settings) { _, _ ->
                runCatching { startActivity(Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS)) }
                    .onFailure { runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) } }
            }
        } else {
            dialog.setPositiveButton(R.string.stream_downloads_retry_from_details) { _, _ ->
                openDownloadSource(progress.record)
            }
        }
        dialog.show()
    }

    /** Never persist a fresh URL/credential to retry an expired download. */
    private fun openDownloadSource(record: OfflineDownloadStore.Record) {
        if (record.kind == "movie") {
            startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, record.providerId)
                putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, record.contentKey)
            })
        } else {
            lifecycleScope.launch {
                val episode = withContext(Dispatchers.IO) {
                    BlofyDatabase.get(applicationContext).dao().episode(record.contentKey)
                } ?: return@launch
                startActivity(Intent(this@DownloadsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, record.providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, episode.seriesId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME,
                        record.title.substringBefore(" • S"))
                })
            }
        }
    }

    private fun play(progress: OfflineDownloadStore.Progress) {
        val uri=progress.readyUri ?: return
        // Reuse the existing player/content-access gate, never bypass login,
        // parental controls or content licensing to open an offline file.
        startActivity(Intent(this,PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL,uri.toString())
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY,progress.record.contentKey)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID,progress.record.providerId)
            putExtra(PlayerActivity.EXTRA_KIND,progress.record.kind)
            putExtra(PlayerActivity.EXTRA_TITLE,progress.record.title)
            putExtra(PlayerActivity.EXTRA_RESUME_MS,0L)
        })
    }
    private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
}
