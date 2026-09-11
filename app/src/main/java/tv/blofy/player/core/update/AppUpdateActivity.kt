package tv.blofy.player.core.update

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.ui.common.CinemaStyle

class AppUpdateActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var action: Button
    private var ready = false
    private var checkingPackage = false
    private val version by lazy { intent.getIntExtra(AppUpdateWorker.VERSION, 0) }
    private val manager by lazy { WorkManager.getInstance(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(AppUpdateWorker.URL).orEmpty()
        if (version <= BuildConfig.VERSION_CODE || !AppUpdateWorker.safeUrl(url)) { finish(); return }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(30), dp(36), dp(30), dp(30)); setBackgroundColor(0xFF08080B.toInt())
        }
        fun text(value: String, size: Float) = TextView(this).apply {
            text = value; textSize = size; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(10))
        }
        page.addView(text(getString(R.string.update_title), 25f).apply { typeface = Typeface.DEFAULT_BOLD })
        page.addView(text(intent.getStringExtra("name").orEmpty(), 16f))
        page.addView(text(intent.getStringExtra("notes").orEmpty(), 14f))
        status = text(getString(R.string.update_preparing), 15f)
        page.addView(status)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; isIndeterminate = true }
        page.addView(progress, LinearLayout.LayoutParams(-1, dp(8)).apply { topMargin = dp(12); bottomMargin = dp(24) })
        action = Button(this).apply {
            text = getString(R.string.update_downloading); isEnabled = false
            CinemaStyle.styleButton(this)
            setOnClickListener { if (ready) install() else download(ExistingWorkPolicy.REPLACE) }
        }
        page.addView(action, LinearLayout.LayoutParams(-1, dp(52)))
        page.addView(Button(this).apply {
            text = getString(R.string.update_cancel); CinemaStyle.styleButton(this)
            setOnClickListener { manager.cancelUniqueWork(AppUpdateWorker.workName(version)); finish() }
        }, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(12) })
        page.addView(text(getString(R.string.update_leave_hint), 12f))
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(page) })
        manager.getWorkInfosForUniqueWorkLiveData(AppUpdateWorker.workName(version)).observe(this) { items ->
            val work = items.lastOrNull() ?: return@observe
            ready = work.state == WorkInfo.State.SUCCEEDED && AppUpdateWorker.file(this, version).isFile
            when {
                ready -> {
                    progress.isIndeterminate = false; progress.progress = 100
                    status.text = getString(R.string.update_ready)
                    action.text = getString(R.string.update_install); action.isEnabled = true
                }
                work.state.isFinished -> {
                    progress.isIndeterminate = false
                    status.text = getString(if (work.outputData.getString(AppUpdateWorker.ERROR) == "invalid_package") R.string.update_invalid else R.string.update_failed)
                    action.text = getString(R.string.update_retry); action.isEnabled = true
                }
                else -> {
                    val total = work.progress.getLong(AppUpdateWorker.TOTAL, -1)
                    val bytes = work.progress.getLong(AppUpdateWorker.BYTES, 0)
                    progress.isIndeterminate = total <= 0
                    progress.progress = if (total > 0) (bytes * 100 / total).toInt() else 0
                    status.text = if (total > 0) getString(R.string.update_progress, progress.progress) else getString(R.string.update_downloading)
                    action.text = getString(R.string.update_downloading); action.isEnabled = false
                }
            }
        }
        download(ExistingWorkPolicy.KEEP)
    }

    private fun download(policy: ExistingWorkPolicy) {
        ready = false
        val request = OneTimeWorkRequestBuilder<AppUpdateWorker>().setInputData(workDataOf(
            AppUpdateWorker.VERSION to version, AppUpdateWorker.URL to intent.getStringExtra(AppUpdateWorker.URL)
        )).build()
        manager.enqueueUniqueWork(AppUpdateWorker.workName(version), policy, request)
    }

    private fun install() {
        if (checkingPackage) return
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            status.text = getString(R.string.update_allow_installs)
            try { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
            catch (_: ActivityNotFoundException) { status.text = getString(R.string.update_installer_missing) }
            return
        }
        checkingPackage = true
        lifecycleScope.launch {
            val file = AppUpdateWorker.file(this@AppUpdateActivity, version)
            val valid = withContext(Dispatchers.IO) { UpdatePackageVerifier.verify(this@AppUpdateActivity, file, version) }
            checkingPackage = false
            if (!valid) {
                ready = false; status.text = getString(R.string.update_invalid); action.text = getString(R.string.update_retry)
                return@launch
            }
            val uri = FileProvider.getUriForFile(this@AppUpdateActivity, "$packageName.updates", file)
            try {
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            } catch (_: ActivityNotFoundException) { status.text = getString(R.string.update_installer_missing) }
            catch (_: SecurityException) { status.text = getString(R.string.update_allow_installs) }
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
