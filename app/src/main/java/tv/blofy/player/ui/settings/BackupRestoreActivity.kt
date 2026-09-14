package tv.blofy.player.ui.settings

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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BackupRestoreActivity : AppCompatActivity() {
    private lateinit var status: TextView

    private val createBackup = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            status.text = "جاري إنشاء النسخة الاحتياطية..."
            runCatching {
                val json = withContext(Dispatchers.IO) { LocalBackupManager.exportJson(applicationContext) }
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(json) }
                        ?: error("cannot_open_backup_file")
                }
            }.onSuccess {
                status.text = "تم حفظ النسخة الاحتياطية بنجاح"
            }.onFailure {
                status.text = backupError(it)
            }
        }
    }

    private val openBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            status.text = "جاري فحص واستعادة النسخة..."
            runCatching {
                val json = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                        ?: error("cannot_read_backup_file")
                }
                withContext(Dispatchers.IO) { LocalBackupManager.restoreJson(applicationContext, json) }
            }.onSuccess { result ->
                status.text = "تمت الاستعادة • ${result.categories} فئة • ${result.flags} مفضلة/قفل • ${result.watchStates} سجل مشاهدة • ${result.settings} إعداد"
            }.onFailure {
                status.text = backupError(it)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP or Gravity.RIGHT
            setPadding(dp(42), dp(32), dp(42), dp(36))
            background = AppCompatResources.getDrawable(this@BackupRestoreActivity, R.drawable.blofy_home_background)
        }
        root.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(44)).apply { gravity = Gravity.LEFT; bottomMargin = dp(14) })
        root.addView(TextView(this).apply {
            text = "النسخ الاحتياطي والاستعادة"
            textSize = 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "يحفظ المفضلة، القفل، سجل المشاهدة، ترتيب الفئات وإعدادات BLOFY. لا يتم حفظ بيانات دخول السيرفر أو PIN."
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(18))
        })
        status = TextView(this).apply {
            text = "الاستعادة متاحة لنفس السيرفر الذي أُنشئت منه النسخة فقط."
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setPadding(dp(16), 0, dp(16), 0)
            background = CinemaStyle.surface(this@BackupRestoreActivity)
        }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(16) })
        root.addView(actionButton("إنشاء نسخة احتياطية") {
            val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
            createBackup.launch("BLOFY-backup-$stamp.json")
        }, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(10) })
        root.addView(actionButton("استعادة نسخة احتياطية") {
            openBackup.launch(arrayOf("application/json", "text/plain"))
        }, LinearLayout.LayoutParams(-1, dp(58)))
        setContentView(root)
    }

    private fun backupError(error: Throwable): String = when (error.message) {
        "no_active_provider" -> "لا يوجد سيرفر نشط حاليًا"
        "unsupported_backup" -> "ملف النسخة غير مدعوم"
        "backup_different_server" -> "هذه النسخة تخص سيرفرًا مختلفًا"
        "cannot_open_backup_file" -> "تعذر إنشاء ملف النسخة"
        "cannot_read_backup_file" -> "تعذر قراءة ملف النسخة"
        else -> "تعذر تنفيذ العملية • تأكد من الملف وحاول مرة أخرى"
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        CinemaStyle.styleButton(this)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
