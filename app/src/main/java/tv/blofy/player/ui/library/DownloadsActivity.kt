package tv.blofy.player.ui.library

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Environment
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

/** One screen for queued, active, completed and failed user-owned transfers. */
class DownloadsActivity : AppCompatActivity() {
    private lateinit var rows: LinearLayout
    private lateinit var empty: TextView
    private lateinit var space: TextView
    private val buttons = LinkedHashMap<Long, Button>()
    private var rowKeys: List<Long> = emptyList()
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
        empty.visibility = if(states.isEmpty()) View.VISIBLE else View.GONE
        val ids=states.map { it.record.id }
        if(ids!=rowKeys) {
            rowKeys=ids
            buttons.clear()
            rows.removeAllViews()
            states.forEach { p ->
                val button = Button(this).apply {
                    isAllCaps=false
                    textSize=13.5f
                    typeface=BlofyTvDesign.BodyTypeface
                    gravity=Gravity.START or Gravity.CENTER_VERTICAL
                    CinemaStyle.styleButton(this)
                    setOnClickListener {
                        if(p.status==DownloadManager.STATUS_SUCCESSFUL && p.readyUri!=null) {
                            play(p)
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
        states.forEach { p ->
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
                    if(p.status==DownloadManager.STATUS_FAILED) append("  •  ${p.reason}")
                }
                // Update click handler with CURRENT status, not the captured
                // status when a row was first built.
                setOnClickListener {
                    if(p.status==DownloadManager.STATUS_SUCCESSFUL && p.readyUri!=null) play(p)
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
