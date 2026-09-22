package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import java.io.Reader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BackupRestoreActivity : AppCompatActivity() {
    private lateinit var status: TextView

    private val createBackup = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            status.setText(R.string.backup_creating)
            runCatching {
                val json = withContext(Dispatchers.IO) { LocalBackupManager.exportJson(applicationContext) }
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(json) }
                        ?: error("cannot_open_backup_file")
                }
            }.onSuccess {
                status.setText(R.string.backup_saved)
            }.onFailure {
                status.text = backupError(it)
            }
        }
    }

    private val openBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            status.setText(R.string.backup_checking)
            runCatching {
                withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.bufferedReader()?.use(::readBoundedBackup)
                        ?: error("cannot_read_backup_file")
                }
            }.onSuccess(::confirmRestore)
                .onFailure { status.text = backupError(it) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.TOP or Gravity.START
            setPadding(dp(42), dp(32), dp(42), dp(36))
            background = AppCompatResources.getDrawable(this@BackupRestoreActivity, R.drawable.blofy_home_background)
        }
        root.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(44)).apply { gravity = Gravity.START; bottomMargin = dp(14) })
        root.addView(TextView(this).apply {
            text = getString(R.string.backup_title)
            textSize = 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.backup_description)
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START
            setPadding(0, dp(8), 0, dp(18))
        })
        status = TextView(this).apply {
            text = getString(R.string.backup_restore_same_server)
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(16), 0, dp(16), 0)
            background = CinemaStyle.surface(this@BackupRestoreActivity)
        }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(16) })
        root.addView(actionButton(getString(R.string.backup_create)) {
            val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
            createBackup.launch("BLOFY-backup-$stamp.json")
        }, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(10) })
        root.addView(actionButton(getString(R.string.backup_restore)) {
            openBackup.launch(arrayOf("application/json", "text/plain"))
        }, LinearLayout.LayoutParams(-1, dp(58)))
        setContentView(root)
    }

    private fun readBoundedBackup(reader: Reader): String {
        val out = StringBuilder()
        val buffer = CharArray(8192)
        while (true) {
            val count = reader.read(buffer)
            if (count < 0) break
            if (out.length + count > MAX_BACKUP_CHARS) error("backup_too_large")
            out.append(buffer, 0, count)
        }
        return out.toString()
    }

    private fun confirmRestore(json: String) {
        if (isFinishing || isDestroyed) return
        status.setText(R.string.backup_ready_confirm)
        AlertDialog.Builder(this)
            .setTitle(R.string.backup_confirm_title)
            .setMessage(R.string.backup_confirm_message)
            .setPositiveButton(R.string.backup_confirm_restore) { _, _ -> restore(json) }
            .setNegativeButton(R.string.profiles_cancel) { _, _ -> status.setText(R.string.backup_cancelled) }
            .show()
    }

    private fun restore(json: String) {
        lifecycleScope.launch {
            status.setText(R.string.backup_restoring)
            runCatching {
                withContext(Dispatchers.IO) { LocalBackupManager.restoreJson(applicationContext, json) }
            }.onSuccess { result ->
                status.text = getString(R.string.backup_restore_result, result.categories, result.flags, result.watchStates, result.settings)
            }.onFailure {
                status.text = backupError(it)
            }
        }
    }

    private fun backupError(error: Throwable): String = when (error.message) {
        "no_active_provider" -> getString(R.string.backup_error_no_active_provider)
        "unsupported_backup" -> getString(R.string.backup_error_unsupported)
        "backup_different_server" -> getString(R.string.backup_error_different_server)
        "backup_too_large" -> getString(R.string.backup_error_too_large)
        "cannot_open_backup_file" -> getString(R.string.backup_error_create_file)
        "cannot_read_backup_file" -> getString(R.string.backup_error_read_file)
        else -> getString(R.string.backup_error_generic)
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        CinemaStyle.styleButton(this)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val MAX_BACKUP_CHARS = 8 * 1024 * 1024
    }
}
