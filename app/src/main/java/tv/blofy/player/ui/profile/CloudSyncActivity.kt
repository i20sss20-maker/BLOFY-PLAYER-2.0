package tv.blofy.player.ui.profile

import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.cloud.ProfileCloudSync
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.DeviceLocalTime

class CloudSyncActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var stats: TextView
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@CloudSyncActivity, R.drawable.blofy_home_background)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(36), dp(28), dp(36), dp(36))
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.cloud_title)
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.cloud_subtitle)
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(4), 0, dp(16))
        })
        status = TextView(this).apply {
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(16), dp(13), dp(16), dp(13))
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        root.addView(status, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
        stats = TextView(this).apply {
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = BlofyTvDesign.elevatedSurface(dp(18).toFloat())
        }
        root.addView(stats, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })

        root.addView(actionButton(getString(R.string.cloud_sync_now)) { runSync() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton(getString(R.string.cloud_backup_profile)) { backup() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton(getString(R.string.cloud_restore)) { confirmRestore() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton(getString(R.string.cloud_generate_pair)) { createPairCode() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton(getString(R.string.cloud_restore_other)) { askPairCode() }, LinearLayout.LayoutParams(-1, dp(54)))

        root.addView(TextView(this).apply {
            text = getString(R.string.cloud_pair_note)
            textSize = 12f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(18), 0, 0)
        })
        scroll.addView(root)
        setContentView(scroll)
        renderState(getString(R.string.cloud_ready))
    }

    override fun onResume() {
        super.onResume()
        renderState(status.text?.toString().orEmpty().ifBlank { getString(R.string.cloud_ready) })
    }

    private fun runSync() = runOperation(getString(R.string.cloud_syncing)) {
        val result = ProfileCloudSync.syncActive(applicationContext)
        result?.let { getString(R.string.cloud_sync_complete, it.revision) } ?: getString(R.string.cloud_sync_unavailable)
    }

    private fun backup() = runOperation(getString(R.string.cloud_backing_up)) {
        val result = ProfileCloudSync.backupActive(applicationContext)
        result?.let { getString(R.string.cloud_backup_saved, it.revision) } ?: getString(R.string.cloud_backup_unavailable)
    }

    private fun confirmRestore() {
        AlertDialog.Builder(this)
            .setTitle(R.string.cloud_restore_title)
            .setMessage(R.string.cloud_restore_message)
            .setNegativeButton(R.string.cloud_cancel, null)
            .setPositiveButton(R.string.cloud_restore_button) { _, _ -> restore() }
            .show()
    }

    private fun restore() = runOperation(getString(R.string.cloud_restoring)) {
        val result = ProfileCloudSync.restoreActive(applicationContext)
        when (result?.action) {
            "restore" -> getString(R.string.cloud_restore_complete, result.revision)
            "no_backup" -> getString(R.string.cloud_no_backup)
            else -> getString(R.string.cloud_restore_unavailable)
        }
    }

    private fun createPairCode() = runOperation(getString(R.string.cloud_pair_creating)) {
        val pair = ProfileCloudSync.createPairCodeActive(applicationContext)
            ?: return@runOperation getString(R.string.cloud_pair_create_failed)
        withContext(Dispatchers.Main) {
            AlertDialog.Builder(this@CloudSyncActivity)
                .setTitle(R.string.cloud_pair_title)
                .setMessage(getString(R.string.cloud_pair_message, pair.code, pair.ttlMinutes))
                .setPositiveButton(R.string.cloud_pair_ok, null)
                .show()
        }
        getString(R.string.cloud_pair_ready, pair.code, formatTime(pair.expiresAt))
    }

    private fun askPairCode() {
        val field = EditText(this).apply {
            hint = getString(R.string.cloud_pair_hint)
            isSingleLine = true
            setPadding(dp(18), dp(8), dp(18), dp(8))
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.cloud_restore_other)
            .setMessage(R.string.cloud_pair_restore_message)
            .setView(field)
            .setNegativeButton(R.string.cloud_cancel, null)
            .setPositiveButton(R.string.cloud_restore_button) { _, _ -> restorePair(field.text?.toString().orEmpty()) }
            .show()
    }

    private fun restorePair(code: String) {
        val clean = code.trim().uppercase()
        if (!Regex("^[A-HJ-NP-Z2-9]{8}$").matches(clean)) {
            renderState(getString(R.string.cloud_pair_invalid))
            return
        }
        runOperation(getString(R.string.cloud_pair_restoring)) {
            val result = ProfileCloudSync.restorePairActive(applicationContext, clean)
            result?.let { getString(R.string.cloud_pair_restore_complete, it.revision) }
                ?: getString(R.string.cloud_pair_restore_unavailable)
        }
    }

    private fun runOperation(message: String, block: suspend () -> String) {
        if (busy) return
        busy = true
        status.text = message
        lifecycleScope.launch {
            val text = runCatching { withContext(Dispatchers.IO) { block() } }
                .getOrElse { errorText(it.message ?: getString(R.string.cloud_error_network)) }
            busy = false
            renderState(text)
        }
    }

    private fun errorText(code: String): String = when (code) {
        "pair_code_expired_or_used" -> getString(R.string.cloud_error_expired)
        "same_device_pair" -> getString(R.string.cloud_error_same_device)
        "unauthorized_device" -> getString(R.string.cloud_error_unauthorized)
        "cloud_snapshot_missing" -> getString(R.string.cloud_error_missing_snapshot)
        else -> getString(R.string.cloud_error_generic, code)
    }

    private fun renderState(message: String) {
        val profile = ProfileStore.active(this)
        val snapshot = ProfileLibraryStore.snapshot(this, profile.id)
        val last = ProfileCloudSync.lastSyncAt(this, profile.id)
        val revision = ProfileCloudSync.knownRevision(this, profile.id)
        status.text = message
        val baseStats = getString(
            R.string.cloud_stats,
            profile.name,
            snapshot.watchlist.size,
            snapshot.hiddenCategories.size,
            snapshot.homeRows.size,
            revision,
            if (last > 0L) formatTime(last) else getString(R.string.cloud_not_synced)
        )
        stats.text = if (profile.guest) {
            getString(R.string.cloud_stats_with_guest, baseStats, getString(R.string.cloud_guest_local_only))
        } else baseStats
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14.5f
        gravity = Gravity.CENTER
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.025f, false)
        setOnClickListener { action() }
    }

    private fun formatTime(value: Long): String = DeviceLocalTime.format(this, value, "dd MMM • HH:mm")
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
