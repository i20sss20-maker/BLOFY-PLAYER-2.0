package tv.blofy.player.ui.login

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
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
        CatalogSyncState.markPending(applicationContext, providerId)
        lifecycleScope.launch { sync(providerId) }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(44), dp(28), dp(44), dp(28))
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(58), dp(34), dp(58), dp(30))
            background = classicPanel()
        }

        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
            isFocusable = false
        }, LinearLayout.LayoutParams(dp(138), dp(82)).apply { bottomMargin = dp(8) })

        panel.addView(TextView(this).apply {
            text = "جاري تجهيز مكتبتك"
            textSize = 25f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)))

        percent = TextView(this).apply {
            text = "0%"
            textSize = 56f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        panel.addView(percent, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(86)).apply { topMargin = dp(10) })

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = ColorStateList.valueOf(CLASSIC_PURPLE)
            progressBackgroundTintList = ColorStateList.valueOf(PROGRESS_TRACK)
        }
        panel.addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(12)).apply {
            topMargin = dp(4)
            bottomMargin = dp(16)
        })

        stage = TextView(this).apply {
            text = "جاري الاتصال بالخادم..."
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_MUTED)
            gravity = Gravity.CENTER
        }
        panel.addView(stage, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))

        panel.addView(TextView(this).apply {
            text = "يتم حفظ المحتوى محليًا بعد اكتمال التحميل"
            textSize = 12f
            setTextColor(TEXT_DIM)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36)))

        root.addView(panel, LinearLayout.LayoutParams(dp(700), LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    private fun classicPanel() = GradientDrawable().apply {
        cornerRadius = dp(22).toFloat()
        setColor(CLASSIC_SURFACE)
        setStroke(dp(1), CLASSIC_STROKE)
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
            CatalogSyncState.markReady(applicationContext, providerId)
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
        stage.setTextColor(ERROR)
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        private val CLASSIC_SURFACE = Color.rgb(17, 16, 30)
        private val CLASSIC_STROKE = Color.rgb(69, 55, 88)
        private val CLASSIC_PURPLE = Color.rgb(124, 43, 255)
        private val PROGRESS_TRACK = Color.rgb(40, 34, 52)
        private val TEXT_MUTED = Color.rgb(188, 182, 205)
        private val TEXT_DIM = Color.rgb(151, 139, 165)
        private val ERROR = Color.rgb(255, 135, 155)
    }
}
