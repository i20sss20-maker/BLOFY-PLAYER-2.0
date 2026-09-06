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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
            setPadding(dp(36), dp(28), dp(36), dp(36))
        }
        root.addView(TextView(this).apply {
            text = "BLOFY CLOUD"
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = "Backup, sync and move your profile experience safely"
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

        root.addView(actionButton("Sync now") { runSync() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton("Back up this profile") { backup() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton("Restore from BLOFY Cloud") { confirmRestore() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton("Generate Pair & Restore code") { createPairCode() }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
        root.addView(actionButton("Restore from another device") { askPairCode() }, LinearLayout.LayoutParams(-1, dp(54)))

        root.addView(TextView(this).apply {
            text = "Pair codes are one-time and expire after 10 minutes. BLOFY Cloud transfers only Watchlist, hidden categories and Home layout. Playlist credentials and playback URLs are never included."
            textSize = 12f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(18), 0, 0)
        })
        scroll.addView(root)
        setContentView(scroll)
        renderState("Ready")
    }

    override fun onResume() {
        super.onResume()
        renderState(status.text?.toString().orEmpty().ifBlank { "Ready" })
    }

    private fun runSync() = runOperation("Syncing profile…") {
        val result = ProfileCloudSync.syncActive(applicationContext)
        result?.let { "Sync complete • revision ${it.revision}" } ?: "Cloud sync unavailable for this profile"
    }

    private fun backup() = runOperation("Backing up profile…") {
        val result = ProfileCloudSync.backupActive(applicationContext)
        result?.let { "Backup saved • revision ${it.revision}" } ?: "Cloud backup unavailable for this profile"
    }

    private fun confirmRestore() {
        AlertDialog.Builder(this)
            .setTitle("Restore profile")
            .setMessage("Cloud data will replace this profile's local Watchlist, hidden categories and Home layout. Continue?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Restore") { _, _ -> restore() }
            .show()
    }

    private fun restore() = runOperation("Restoring profile…") {
        val result = ProfileCloudSync.restoreActive(applicationContext)
        when (result?.action) {
            "restore" -> "Restore complete • revision ${result.revision}"
            "no_backup" -> "No cloud backup found for this profile"
            else -> "Cloud restore unavailable for this profile"
        }
    }

    private fun createPairCode() = runOperation("Creating one-time Pair code…") {
        val pair = ProfileCloudSync.createPairCodeActive(applicationContext)
            ?: return@runOperation "Unable to create Pair code for this profile"
        withContext(Dispatchers.Main) {
            AlertDialog.Builder(this@CloudSyncActivity)
                .setTitle("Pair & Restore")
                .setMessage("Enter this code on the new device:\n\n${pair.code}\n\nExpires in ${pair.ttlMinutes} minutes. The code works once only.")
                .setPositiveButton("OK", null)
                .show()
        }
        "Pair code ${pair.code} ready • expires ${formatTime(pair.expiresAt)}"
    }

    private fun askPairCode() {
        val field = EditText(this).apply {
            hint = "8-character Pair code"
            isSingleLine = true
            setPadding(dp(18), dp(8), dp(18), dp(8))
        }
        AlertDialog.Builder(this)
            .setTitle("Restore from another device")
            .setMessage("Generate a Pair code on your old device, then enter it here. This profile's local cloud data will be replaced.")
            .setView(field)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Restore") { _, _ -> restorePair(field.text?.toString().orEmpty()) }
            .show()
    }

    private fun restorePair(code: String) {
        val clean = code.trim().uppercase()
        if (!Regex("^[A-HJ-NP-Z2-9]{8}$").matches(clean)) {
            renderState("Pair code must be 8 valid characters")
            return
        }
        runOperation("Restoring from paired device…") {
            val result = ProfileCloudSync.restorePairActive(applicationContext, clean)
            result?.let { "Pair restore complete • revision ${it.revision}" }
                ?: "Pair restore unavailable for this profile"
        }
    }

    private fun runOperation(message: String, block: suspend () -> String) {
        if (busy) return
        busy = true
        status.text = message
        lifecycleScope.launch {
            val text = runCatching { withContext(Dispatchers.IO) { block() } }
                .getOrElse { errorText(it.message ?: "network error") }
            busy = false
            renderState(text)
        }
    }

    private fun errorText(code: String): String = when (code) {
        "pair_code_expired_or_used" -> "Pair code expired or was already used"
        "same_device_pair" -> "Pair code must be used on a different device"
        "unauthorized_device" -> "Device activation could not be verified"
        "cloud_snapshot_missing" -> "Back up the old profile first, then create a Pair code"
        else -> "Cloud operation failed • $code"
    }

    private fun renderState(message: String) {
        val profile = ProfileStore.active(this)
        val snapshot = ProfileLibraryStore.snapshot(this, profile.id)
        val last = ProfileCloudSync.lastSyncAt(this, profile.id)
        val revision = ProfileCloudSync.knownRevision(this, profile.id)
        status.text = message
        stats.text = buildString {
            append("Profile: ${profile.name}")
            append("\nWatchlist: ${snapshot.watchlist.size}")
            append(" • Hidden categories: ${snapshot.hiddenCategories.size}")
            append(" • Home rows: ${snapshot.homeRows.size}")
            append("\nCloud revision: $revision")
            append(" • Last sync: ${if (last > 0L) formatTime(last) else "Not synced yet"}")
            if (profile.guest) append("\nGuest profiles are local-only")
        }
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

    private fun formatTime(value: Long): String = SimpleDateFormat("dd MMM • HH:mm", Locale.getDefault()).format(Date(value))
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
