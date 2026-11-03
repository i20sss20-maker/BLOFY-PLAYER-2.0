package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Job
import androidx.activity.addCallback
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

/** Performs catalog sync before the user enters Home. First load writes directly to the final provider to avoid a huge promote transaction. */
class CatalogLoadingActivity : AppCompatActivity() {
    private lateinit var percent: TextView
    private lateinit var stage: TextView
    private lateinit var detail: TextView
    private lateinit var progress: ProgressBar
    private lateinit var serverStep: TextView
    private lateinit var contentStep: TextView
    private lateinit var prepareStep: TextView
    private lateinit var readyStep: TextView
    private lateinit var retryButton: Button
    private lateinit var backButton: Button
    private var currentProviderId: String = ""
    private var lastPercent = 0
    private var hasSavedLibrary = false
    private var syncJob: Job? = null
    private val isPhone by lazy { DeviceClass.detect(this) == DeviceClass.Kind.PHONE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildUi()
        currentProviderId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        if (currentProviderId.isBlank()) {
            fail("تعذر تحديد قائمة التشغيل")
            return
        }
        onBackPressedDispatcher.addCallback(this) { leaveSync() }
        startSync()
    }

    private fun buildUi() {
        val compact = isPhone && (
            resources.configuration.screenWidthDp < 400 ||
                resources.configuration.screenHeightDp < 700
            )
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (isPhone) Gravity.TOP or Gravity.CENTER_HORIZONTAL else Gravity.CENTER
            setPadding(if (compact) dp(12) else if (isPhone) dp(18) else dp(80), if (compact) dp(12) else if (isPhone) dp(22) else dp(44), if (compact) dp(12) else if (isPhone) dp(18) else dp(80), if (compact) dp(12) else if (isPhone) dp(22) else dp(44))
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(if (compact) dp(16) else if (isPhone) dp(24) else dp(54), if (compact) dp(16) else if (isPhone) dp(24) else dp(34), if (compact) dp(16) else if (isPhone) dp(24) else dp(54), if (compact) dp(16) else if (isPhone) dp(24) else dp(32))
            background = BlofyTvDesign.elevatedSurface(dp(28).toFloat(), emphasis = true)
        }

        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(if (compact) 130 else 170), dp(if (compact) 72 else 96)))

        panel.addView(TextView(this).apply {
            text = "جاري تجهيز مكتبتك"
            textSize = if (compact) 21f else if (isPhone) 24f else 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(2))
        })

        panel.addView(TextView(this).apply {
            text = "يتم تحميل الباقة وحفظها محليًا مرة واحدة، وبعدها يكون الدخول مباشرًا"
            textSize = if (compact) 12.5f else 14f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(if (compact) 10 else 18))
        })

        val progressRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_LTR
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.SurfaceRaised)
        }
        progressRow.addView(progress, LinearLayout.LayoutParams(0, dp(14), 1f).apply { marginEnd = dp(22) })
        percent = TextView(this).apply {
            text = "0%"
            textSize = if (compact) 24f else if (isPhone) 28f else 34f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        }
        progressRow.addView(percent, LinearLayout.LayoutParams(dp(if (compact) 88 else 120), dp(if (compact) 46 else 54)))
        panel.addView(progressRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (compact) 52 else 62)))

        stage = TextView(this).apply {
            text = "جاري الاتصال بالخادم..."
            textSize = if (compact) 17f else 19f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            setPadding(0, dp(if (compact) 8 else 12), 0, dp(4))
        }
        panel.addView(stage)

        detail = TextView(this).apply {
            text = "التحميل الحقيقي من السيرفر • لن نعرض 100% قبل اكتمال الحفظ فعليًا"
            textSize = if (compact) 12f else 13f
            setTextColor(BlofyTvDesign.TextDim)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(if (compact) 14 else 24))
        }
        panel.addView(detail)

        val steps = LinearLayout(this).apply {
            orientation = if (isPhone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
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
        panel.addView(steps, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (isPhone) LinearLayout.LayoutParams.WRAP_CONTENT else dp(58)))

        val recoveryActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            visibility = android.view.View.GONE
        }
        retryButton = recoveryButton("↻  إعادة المحاولة") { startSync() }
        backButton = recoveryButton("إلغاء التحديث") { leaveSync() }
        recoveryActions.addView(retryButton, LinearLayout.LayoutParams(0, dp(56), 1f).apply { marginStart = dp(8) })
        recoveryActions.addView(backButton, LinearLayout.LayoutParams(0, dp(56), 1f))
        panel.addView(recoveryActions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(12) })

        root.addView(panel, LinearLayout.LayoutParams(if (isPhone) LinearLayout.LayoutParams.MATCH_PARENT else dp(980), LinearLayout.LayoutParams.WRAP_CONTENT))
        if (isPhone) {
            val scroll = ScrollView(this).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                overScrollMode = android.view.View.OVER_SCROLL_NEVER
                background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
            }
            scroll.addView(root, android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.WRAP_CONTENT))
            setContentView(scroll)
        } else {
            setContentView(root)
        }
    }

    private fun step(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(BlofyTvDesign.TextDim)
        gravity = Gravity.CENTER
    }

    private fun stepParams() = if (isPhone) {
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36)).apply {
            topMargin = dp(2)
            bottomMargin = dp(2)
        }
    } else {
        LinearLayout.LayoutParams(0, dp(50), 1f).apply {
            marginStart = dp(5)
            marginEnd = dp(5)
        }
    }

    private fun recoveryButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        setTextColor(BlofyTvDesign.TextPrimary)
        typeface = BlofyTvDesign.BodyTypeface
        stateListAnimator = null
        BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.035f, false)
        setOnClickListener { action() }
    }

    private fun startSync() {
        if (syncJob?.isActive == true) return
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        lastPercent = 0
        render(0, "جاري الاتصال بالخادم...")
        retryButton.visibility = android.view.View.GONE
        backButton.text = "إلغاء التحديث"
        recoveryContainer()?.visibility = android.view.View.VISIBLE
        CatalogSyncState.markPending(applicationContext, currentProviderId)
        syncJob = lifecycleScope.launch { sync(currentProviderId) }
    }

    private fun leaveSync() {
        syncJob?.cancel()
        CatalogSyncState.markFailed(applicationContext, currentProviderId)
        if (hasSavedLibrary) startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    private fun recoveryContainer(): LinearLayout? =
        if (::retryButton.isInitialized) retryButton.parent as? LinearLayout else null

    private suspend fun sync(providerId: String) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val target = withContext(Dispatchers.IO) { dao.provider(providerId) }
            ?: return fail("قائمة التشغيل غير موجودة")

        val firstLoad = withContext(Dispatchers.IO) { !dao.hasStreamsForProvider(providerId) }
        hasSavedLibrary = !firstLoad
        backButton.text = if (hasSavedLibrary) "الدخول بالمكتبة المحفوظة" else "إلغاء التحديث"
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
            check(result.failedSectionCount == 0) { "تعذر تحديث: ${result.failedSectionNames()}" }

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
            withContext(NonCancellable + Dispatchers.IO) {
                if (firstLoad) dao.clearProviderCatalog(providerId) else dao.discardStagedCatalog(syncProvider.id)
            }
            CatalogSyncState.markFailed(applicationContext, providerId)
            throw cancelled
        } catch (error: Throwable) {
            withContext(NonCancellable + Dispatchers.IO) {
                if (firstLoad) dao.clearProviderCatalog(providerId) else dao.discardStagedCatalog(syncProvider.id)
            }
            CatalogSyncState.markFailed(applicationContext, providerId)
            fail("تعذر تجهيز المكتبة: ${error.message ?: "خطأ غير معروف"}")
        }
    }

    private fun renderProgress(p: PlaylistSyncProgress) {
        val section = when (p.stage) {
            PlaylistSyncStage.M3U -> "القائمة"
            PlaylistSyncStage.LIVE -> "القنوات"
            PlaylistSyncStage.MOVIES -> "الأفلام"
            PlaylistSyncStage.SERIES -> "المسلسلات"
        }
        val phase = if (p.totalSteps > 1) "القسم ${p.step} من ${p.totalSteps}" else "القائمة"
        render(p.percent.coerceAtMost(95), "جاري تحميل $section • $phase")
        val actual = p.downloadPercent
        if (actual != null) {
            progress.isIndeterminate = false
            progress.progress = actual.coerceIn(0, 100)
            percent.text = "${actual.coerceIn(0, 100)}%"
            progress.contentDescription = "نسبة تنزيل بيانات $section ${actual.coerceIn(0, 100)} بالمئة"
            detail.text = "هذه نسبة تنزيل $section فقط، وليست الباقة بالكامل" +
                p.parsedItems?.let { " • تمت قراءة $it عنصر" }.orEmpty()
        } else {
            // Xtream does not always send Content-Length. Never display a
            // fabricated percentage based on how many catalog items arrived.
            detail.text = "التحميل جارٍ من السيرفر" +
                p.parsedItems?.let { " • تمت قراءة $it عنصر" }.orEmpty() +
                " • لا تتوفر نسبة دقيقة لهذا القسم"
        }
    }

    private fun render(value: Int, label: String) {
        val safe = if (value >= 100) 100 else maxOf(lastPercent, value.coerceIn(0, 99))
        lastPercent = safe
        progress.isIndeterminate = safe < 100
        if (safe == 100) progress.progress = 100
        progress.contentDescription = if (safe == 100)
            "اكتمل تحديث مكتبة BLOFY" else "جاري تحديث مكتبة BLOFY"
        percent.text = if (safe == 100) "100%" else "…"
        stage.text = label
        detail.text = when {
            safe == 100 -> "اكتمل حفظ المكتبة الجديدة • يمكنك بدء المشاهدة"
            safe >= 96 -> "انتهى تحميل الأقسام • جاري اعتماد المكتبة بأمان"
            safe >= 15 -> "جاري جلب بيانات الأقسام من السيرفر"
            safe >= 5 -> "جاري تحميل أقسام الباقة من السيرفر"
            else -> "جاري الاتصال والتحقق من القائمة…"
        }
        stage.setTextColor(BlofyTvDesign.TextPrimary)
        serverStep.setTextColor(if (safe >= 60) BlofyTvDesign.PurpleBright else BlofyTvDesign.TextDim)
        contentStep.setTextColor(if (safe >= 96) BlofyTvDesign.PurpleBright else BlofyTvDesign.TextDim)
        prepareStep.setTextColor(if (safe >= 100) BlofyTvDesign.PurpleBright else BlofyTvDesign.TextDim)
        readyStep.setTextColor(if (safe >= 100) BlofyTvDesign.Mint else BlofyTvDesign.TextDim)
        serverStep.text = if (safe >= 60) "✓  الاتصال بالخادم" else "●  الاتصال بالخادم"
        contentStep.text = if (safe >= 96) "✓  جلب المحتوى" else "●  جلب المحتوى"
        prepareStep.text = if (safe >= 100) "✓  تحضير المكتبة" else "○  تحضير المكتبة"
        readyStep.text = if (safe >= 100) "✓  جاهز" else "○  جاهز"
    }

    private fun fail(message: String) {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        progress.isIndeterminate = false
        progress.progress = 0
        percent.text = "تعذر"
        retryButton.visibility = android.view.View.VISIBLE
        stage.text = message
        stage.setTextColor(BlofyTvDesign.Danger)
        detail.text = if (hasSavedLibrary)
            "لم يُعتمد التحديث غير المكتمل • مكتبتك السابقة محفوظة ويمكن الدخول إليها"
        else "لم يتم اعتماد المكتبة غير المكتملة • يمكنك إعادة المحاولة بأمان"
        recoveryContainer()?.visibility = android.view.View.VISIBLE
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
    }
}
