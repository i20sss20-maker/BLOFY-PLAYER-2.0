package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
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
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

/** Performs catalog sync before the user enters Home. First load writes directly to the final provider to avoid a huge promote transaction. */
class CatalogLoadingActivity : AppCompatActivity() {
    private lateinit var percent: TextView
    private lateinit var stage: TextView
    private lateinit var progress: ProgressBar
    private lateinit var serverStep: TextView
    private lateinit var contentStep: TextView
    private lateinit var prepareStep: TextView
    private lateinit var readyStep: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        if (providerId.isBlank()) {
            fail("تعذر تحديد قائمة التشغيل")
            return
        }
        CatalogSyncState.markPending(applicationContext, providerId)
        lifecycleScope.launch { sync(providerId) }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(80), dp(44), dp(80), dp(44))
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(54), dp(34), dp(54), dp(32))
            background = GradientDrawable().apply {
                cornerRadius = dp(28).toFloat()
                setColor(0xE8151024.toInt())
                setStroke(dp(1), 0xFF5C357F.toInt())
            }
        }

        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(170), dp(96)))

        panel.addView(TextView(this).apply {
            text = "جاري تجهيز مكتبتك"
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(2))
        })

        panel.addView(TextView(this).apply {
            text = "يتم تحميل الباقة وحفظها محليًا مرة واحدة، وبعدها يكون الدخول مباشرًا"
            textSize = 14f
            setTextColor(0xFFB7A8C9.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(18))
        })

        val progressRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_LTR
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = android.content.res.ColorStateList.valueOf(0xFF8D39FF.toInt())
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(0xFF2D243A.toInt())
        }
        progressRow.addView(progress, LinearLayout.LayoutParams(0, dp(14), 1f).apply { marginEnd = dp(22) })
        percent = TextView(this).apply {
            text = "0%"
            textSize = 34f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        progressRow.addView(percent, LinearLayout.LayoutParams(dp(120), dp(54)))
        panel.addView(progressRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)))

        stage = TextView(this).apply {
            text = "جاري الاتصال بالخادم..."
            textSize = 19f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(4))
        }
        panel.addView(stage)

        panel.addView(TextView(this).apply {
            text = "يمكن أن يستغرق أول تحميل وقتًا حسب حجم الباقة، لكن التحضير النهائي لن يعيد نسخ المكتبة كاملة"
            textSize = 13f
            setTextColor(0xFF9587A8.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(24))
        })

        val steps = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
        }
        serverStep = step("●  الاتصال بالخادم")
        contentStep = step("○  جلب المحتوى")
        prepareStep = step("○  تحضير المكتبة")
        readyStep = step("○  جاهز")
        steps.addView(serverStep, stepParams())
        steps.addView(contentStep, stepParams())
        steps.addView(prepareStep, stepParams())
        steps.addView(readyStep, stepParams())
        panel.addView(steps, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))

        root.addView(panel, LinearLayout.LayoutParams(dp(980), LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    private fun step(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(0xFF756B82.toInt())
        gravity = Gravity.CENTER
    }

    private fun stepParams() = LinearLayout.LayoutParams(0, dp(50), 1f).apply {
        marginStart = dp(5)
        marginEnd = dp(5)
    }

    private suspend fun sync(providerId: String) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val target = withContext(Dispatchers.IO) { dao.provider(providerId) }
            ?: return fail("قائمة التشغيل غير موجودة")

        val firstLoad = withContext(Dispatchers.IO) { !dao.hasStreamsForProvider(providerId) }
        val syncProvider: ProviderEntity = if (firstLoad) {
            target.copy(enabled = true, updatedAt = System.currentTimeMillis())
        } else {
            target.copy(id = UUID.randomUUID().toString(), enabled = false)
        }

        try {
            render(5, if (firstLoad) "بدء التحميل السريع للباقة..." else "بدء تحديث الباقة...")
            val result = PlaylistSyncPolicy.run {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncAll(syncProvider) { p ->
                        withContext(Dispatchers.Main.immediate) { renderProgress(p) }
                    }
                }
            }
            check(result.freshItemCount > 0) { "لم يرجع السيرفر محتوى صالح" }
            check(result.failedSectionCount == 0) { "تعذر تحميل أحد أقسام الباقة" }

            render(96, if (firstLoad) "جاري إنهاء المكتبة..." else "جاري حفظ التحديث بأمان...")
            withContext(Dispatchers.IO) {
                if (firstLoad) {
                    dao.saveAndActivateProvider(syncProvider.copy(enabled = true, updatedAt = System.currentTimeMillis()))
                } else {
                    dao.promoteStagedCatalog(
                        syncProvider.id,
                        target.copy(enabled = true, updatedAt = System.currentTimeMillis())
                    )
                }
            }

            CatalogSyncState.markReady(applicationContext, providerId)
            render(100, "المكتبة جاهزة")
            startActivity(Intent(this, HomeActivity::class.java))
            finish()
        } catch (cancelled: CancellationException) {
            withContext(Dispatchers.IO) {
                if (firstLoad) dao.clearProviderCatalog(providerId) else dao.discardStagedCatalog(syncProvider.id)
            }
            throw cancelled
        } catch (error: Throwable) {
            withContext(Dispatchers.IO) {
                if (firstLoad) dao.clearProviderCatalog(providerId) else dao.discardStagedCatalog(syncProvider.id)
            }
            fail("تعذر تجهيز المكتبة: ${error.message ?: "خطأ غير معروف"}")
        }
    }

    private fun renderProgress(p: PlaylistSyncProgress) {
        val label = when (p.stage) {
            PlaylistSyncStage.M3U -> "جاري تحميل القائمة"
            PlaylistSyncStage.LIVE -> "جاري تحميل القنوات"
            PlaylistSyncStage.MOVIES -> "جاري تحميل الأفلام"
            PlaylistSyncStage.SERIES -> "جاري تحميل المسلسلات"
        }
        render(p.percent.coerceAtMost(95), label)
    }

    private fun render(value: Int, label: String) {
        val safe = value.coerceIn(0, 100)
        progress.progress = safe
        percent.text = "$safe%"
        stage.text = label
        serverStep.setTextColor(if (safe >= 5) 0xFFB96CFF.toInt() else 0xFF756B82.toInt())
        contentStep.setTextColor(if (safe >= 15) 0xFFB96CFF.toInt() else 0xFF756B82.toInt())
        prepareStep.setTextColor(if (safe >= 90) 0xFFB96CFF.toInt() else 0xFF756B82.toInt())
        readyStep.setTextColor(if (safe >= 100) 0xFF45E3C2.toInt() else 0xFF756B82.toInt())
        serverStep.text = if (safe >= 15) "✓  الاتصال بالخادم" else "●  الاتصال بالخادم"
        contentStep.text = if (safe >= 90) "✓  جلب المحتوى" else "○  جلب المحتوى"
        prepareStep.text = if (safe >= 100) "✓  تحضير المكتبة" else "○  تحضير المكتبة"
        readyStep.text = if (safe >= 100) "✓  جاهز" else "○  جاهز"
    }

    private fun fail(message: String) {
        stage.text = message
        stage.setTextColor(0xFFFF879B.toInt())
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
    }
}
