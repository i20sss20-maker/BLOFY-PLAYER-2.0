package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

/** Performs the complete staged catalog sync before the user enters Home. */
class CatalogLoadingActivity : AppCompatActivity() {
    private lateinit var percent: TextView
    private lateinit var stage: TextView
    private lateinit var progress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        if (providerId.isBlank()) {
            fail("تعذر تحديد قائمة التشغيل")
            return
        }
        lifecycleScope.launch { sync(providerId) }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(80), dp(60), dp(80), dp(60))
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"; textSize = 34f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "جاري تجهيز مكتبتك"; textSize = 24f; setTextColor(Color.WHITE)
            gravity = Gravity.CENTER; setPadding(0, dp(18), 0, dp(8))
        })
        stage = TextView(this).apply {
            text = "التحقق من القائمة..."; textSize = 17f
            setTextColor(0xFFBCA8D7.toInt()); gravity = Gravity.CENTER
        }
        root.addView(stage)
        percent = TextView(this).apply {
            text = "0%"; textSize = 52f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFF8D5CFF.toInt()); gravity = Gravity.CENTER
            setPadding(0, dp(28), 0, dp(14))
        }
        root.addView(percent)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100; progress = 0; progressDrawable = progressDrawable.mutate()
        }
        root.addView(progress, LinearLayout.LayoutParams(dp(620), dp(18)))
        root.addView(TextView(this).apply {
            text = "يتم تنزيل القنوات والأفلام والمسلسلات وحفظها محليًا قبل الدخول"
            textSize = 14f; setTextColor(0xFF9B91A8.toInt()); gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, 0)
        })
        setContentView(root)
    }

    private suspend fun sync(providerId: String) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val target = withContext(Dispatchers.IO) { dao.provider(providerId) }
            ?: return fail("قائمة التشغيل غير موجودة")
        val staged = target.copy(id = UUID.randomUUID().toString(), enabled = false)
        try {
            render(5, "بدء تحميل الباقة...")
            val result = PlaylistSyncPolicy.run {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncAll(staged) { p ->
                        withContext(Dispatchers.Main.immediate) { renderProgress(p) }
                    }
                }
            }
            check(result.freshItemCount > 0) { "لم يرجع السيرفر محتوى صالح" }
            check(result.failedSectionCount == 0) { "تعذر تحميل أحد أقسام الباقة" }
            render(96, "جاري حفظ الباقة محليًا...")
            withContext(Dispatchers.IO) {
                dao.promoteStagedCatalog(staged.id, target.copy(enabled = true, updatedAt = System.currentTimeMillis()))
            }
            render(100, "اكتمل التحميل")
            startActivity(Intent(this, HomeActivity::class.java))
            finish()
        } catch (cancelled: CancellationException) {
            withContext(Dispatchers.IO) { dao.discardStagedCatalog(staged.id) }
            throw cancelled
        } catch (error: Throwable) {
            withContext(Dispatchers.IO) { dao.discardStagedCatalog(staged.id) }
            fail(error.message ?: "تعذر تحميل الباقة")
        }
    }

    private fun renderProgress(p: PlaylistSyncProgress) {
        val label = when (p.stage) {
            PlaylistSyncStage.M3U -> "جاري تحميل القائمة"
            PlaylistSyncStage.LIVE -> "جاري تحميل القنوات"
            PlaylistSyncStage.MOVIES -> "جاري تحميل الأفلام"
            PlaylistSyncStage.SERIES -> "جاري تحميل المسلسلات"
        }
        render(p.percent, label)
    }

    private fun render(value: Int, label: String) {
        val safe = value.coerceIn(0, 100)
        progress.progress = safe
        percent.text = "$safe%"
        stage.text = label
    }

    private fun fail(message: String) {
        stage.text = message
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
    }
}
