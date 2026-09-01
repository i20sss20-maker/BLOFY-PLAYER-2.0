package tv.blofy.player.ui.login

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
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
import tv.blofy.player.ui.V339Ui
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
            setPadding(dp(34), dp(20), dp(34), dp(20))
            background = V339Ui.screenGradient()
        }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(46), dp(28), dp(46), dp(26))
            background = V339Ui.gradientPanel(
                this@CatalogLoadingActivity,
                V339Ui.PANEL_ALT,
                V339Ui.BLACK,
                20,
                V339Ui.STROKE
            )
        }

        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
            isFocusable = false
        }, LinearLayout.LayoutParams(dp(126), dp(72)).apply { bottomMargin = dp(6) })

        panel.addView(V339Ui.title(this, "جاري تجهيز مكتبتك", 24f).apply {
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))

        percent = V339Ui.title(this, "0%", 54f).apply {
            gravity = Gravity.CENTER
            setTextColor(V339Ui.TEXT)
        }
        panel.addView(percent, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(82)).apply {
            topMargin = dp(6)
        })

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = V339Ui.progressColors()
            progressBackgroundTintList = ColorStateList.valueOf(V339Ui.DIVIDER)
        }
        panel.addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(10)).apply {
            topMargin = dp(2)
            bottomMargin = dp(14)
        })

        stage = V339Ui.title(this, "جاري الاتصال بالخادم...", 16f).apply {
            setTextColor(V339Ui.MUTED)
            gravity = Gravity.CENTER
        }
        panel.addView(stage, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)))

        panel.addView(V339Ui.text(this, "يتم حفظ المحتوى محليًا بعد اكتمال التحميل", 12f, V339Ui.MUTED).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34)))

        root.addView(panel, LinearLayout.LayoutParams(dp(660), LinearLayout.LayoutParams.WRAP_CONTENT))
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
        stage.setTextColor(V339Ui.ERROR)
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(v: Int) = V339Ui.dp(this, v)

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
    }
}
