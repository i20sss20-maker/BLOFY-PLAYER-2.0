package tv.blofy.player.ui.login

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.view.View
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import tv.blofy.player.data.preparation.FullCatalogPreparer
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
import kotlinx.coroutines.delay
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
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

class CatalogLoadingActivity : AppCompatActivity() {
    private lateinit var retryButton: Button
    private var loadJob: Job? = null
    private var displayedPercent = 0
    private lateinit var percent: TextView
    private lateinit var stage: TextView
    private lateinit var progress: ProgressBar
    private lateinit var serverStep: TextView
    private lateinit var contentStep: TextView
    private lateinit var prepareStep: TextView
    private lateinit var readyStep: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TvUiTuning.enter(this)
        buildUi()
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        if (providerId.isBlank()) { fail("تعذر تحديد قائمة التشغيل"); return }
        val forceRefresh = intent.getBooleanExtra(EXTRA_FORCE_REFRESH, false)
        retryButton.setOnClickListener { startLoading(providerId, forceRefresh = false) }
        startLoading(providerId, forceRefresh)
    }

    private fun startLoading(providerId: String, forceRefresh: Boolean) {
        if (loadJob?.isActive == true) return
        retryButton.visibility = View.GONE
        stage.setTextColor(BlofyTvDesign.TextPrimary)
        loadJob = lifecycleScope.launch {
            try {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val hasCachedCatalog = withContext(Dispatchers.IO) { dao.hasCatalog(providerId) }
                val catalogReady = CatalogSyncState.isReady(applicationContext, providerId)
                if (!forceRefresh && CatalogSyncState.isFullyReady(applicationContext, providerId) && hasCachedCatalog) {
                    openHome()
                } else if (!forceRefresh && catalogReady && hasCachedCatalog) {
                    awaitFullLocalCache(providerId)
                    openHome()
                } else {
                    CatalogSyncState.markPending(applicationContext, providerId)
                    sync(providerId)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { fail(preparationMessage(error)) }
        }
    }

    private fun preparationMessage(error: Throwable): String = when (error) {
        is FullCatalogPreparer.Incomplete -> error.message.orEmpty()
        is tv.blofy.player.ui.catalog.ArtworkLoader.StorageFull -> error.message.orEmpty()
        else -> "تعذر إكمال التخزين • أعد المحاولة لاستكمال الناقص دون مسح المحفوظ"
    }

    private fun buildUi() {
        fun u(v: Int) = TvUiTuning.dp(this, v)
        fun s(v: Float) = TvUiTuning.sp(this, v)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(u(72), u(40), u(72), u(40))
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(u(52), u(34), u(52), u(34))
            background = BlofyTvDesign.glassSurface(u(BlofyTvDesign.PanelRadius).toFloat())
            elevation = u(6).toFloat()
        }
        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(u(176), u(96)))
        panel.addView(TextView(this).apply {
            text = "جاري تجهيز مكتبتك"
            BlofyTvDesign.applyTitle(this)
            textSize = s(30f)
            gravity = Gravity.CENTER
            setPadding(0, u(4), 0, u(4))
        })
        panel.addView(TextView(this).apply {
            text = "يتم تحميل الباقة والتفاصيل والحلقات مرة واحدة وحفظها محليًا"
            BlofyTvDesign.applyBody(this)
            textSize = s(14f)
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, u(20))
        })
        val progressRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_LTR
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = ColorStateList.valueOf(BlofyTvDesign.Divider)
        }
        progressRow.addView(progress, LinearLayout.LayoutParams(0, u(12), 1f).apply { marginEnd = u(24) })
        percent = TextView(this).apply {
            text = "0%"
            textSize = s(40f)
            typeface = BlofyTvDesign.DisplayTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }
        progressRow.addView(percent, LinearLayout.LayoutParams(u(132), u(64)))
        panel.addView(progressRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(72)))
        stage = TextView(this).apply {
            text = "جاري الاتصال بالخادم..."
            BlofyTvDesign.applyHeading(this)
            textSize = s(20f)
            gravity = Gravity.CENTER
            setPadding(0, u(12), 0, u(6))
        }
        panel.addView(stage)
        panel.addView(TextView(this).apply {
            text = "أول تحميل يعتمد على حجم الباقة وسرعة السيرفر. بعد اكتماله تفتح الصفحات من التخزين المحلي."
            BlofyTvDesign.applyCaption(this)
            textSize = s(12.5f)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, u(22))
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
        retryButton = Button(this).apply {
            text = "↻ استكمال الناقص"
            isAllCaps = false
            visibility = View.GONE
            BlofyTvDesign.installTvFocus(this, u(16).toFloat(), 1.02f, true) {}
        }
        panel.addView(retryButton, LinearLayout.LayoutParams(u(320), u(54)))
        panel.addView(steps, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(60)))
        root.addView(panel, LinearLayout.LayoutParams(u(980), LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    private fun step(value: String) = TextView(this).apply {
        text = value
        textSize = TvUiTuning.sp(this@CatalogLoadingActivity, 12.5f)
        typeface = BlofyTvDesign.MediumTypeface
        setTextColor(BlofyTvDesign.TextMuted)
        gravity = Gravity.CENTER
    }

    private fun stepParams() = LinearLayout.LayoutParams(0, TvUiTuning.dp(this, 50), 1f).apply {
        marginStart = TvUiTuning.dp(this@CatalogLoadingActivity, 5)
        marginEnd = TvUiTuning.dp(this@CatalogLoadingActivity, 5)
    }

    private suspend fun sync(providerId: String) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val target = withContext(Dispatchers.IO) { dao.provider(providerId) } ?: return fail("قائمة التشغيل غير موجودة")
        val firstLoad = withContext(Dispatchers.IO) { !dao.hasStreamsForProvider(providerId) }
        val syncProvider: ProviderEntity = if (firstLoad) target.copy(enabled = true, updatedAt = System.currentTimeMillis()) else target.copy(id = UUID.randomUUID().toString(), enabled = false)
        var catalogCommitted = false
        try {
            render(5, if (firstLoad) "بدء التحميل الكامل للباقة..." else "بدء تحديث الباقة...")
            val result = PlaylistSyncPolicy.run {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncAll(syncProvider) { p ->
                        withContext(Dispatchers.Main.immediate) { renderProgress(p) }
                    }
                }
            }
            check(result.freshItemCount > 0) { "لم يرجع السيرفر محتوى صالح" }
            check(result.failedSectionCount == 0) { "تعذر تحميل أحد أقسام الباقة" }
            render(30, if (firstLoad) "جاري إنهاء المكتبة..." else "جاري حفظ التحديث بأمان...")
            withContext(Dispatchers.IO) {
                if (firstLoad) dao.saveAndActivateProvider(syncProvider.copy(enabled = true, updatedAt = System.currentTimeMillis()))
                else dao.promoteStagedCatalog(syncProvider.id, target.copy(enabled = true, updatedAt = System.currentTimeMillis()))
            }
            catalogCommitted = true
            if (!firstLoad) {
                withContext(Dispatchers.IO) { ProviderMetadataCache.clearProvider(applicationContext, providerId) }
            }
            CatalogSyncState.markCatalogCommitted(applicationContext, providerId)
            awaitFullLocalCache(providerId)
            render(100, "المكتبة كاملة وجاهزة")
            delay(120)
            openHome()
        } catch (cancelled: CancellationException) {
            if (!catalogCommitted) {
                withContext(NonCancellable + Dispatchers.IO) {
                    if (firstLoad) dao.clearProviderCatalog(providerId) else dao.discardStagedCatalog(syncProvider.id)
                }
                if (!firstLoad) CatalogSyncState.markReady(applicationContext, providerId)
            }
            throw cancelled
        } catch (error: Throwable) {
            if (catalogCommitted) {
                fail(preparationMessage(error))
                return
            }
            withContext(Dispatchers.IO) {
                if (firstLoad) dao.clearProviderCatalog(providerId) else dao.discardStagedCatalog(syncProvider.id)
            }
            if (!firstLoad) {
                CatalogSyncState.markReady(applicationContext, providerId)
                render(30, "تعذر تحديث النسخة الجديدة • تم الاحتفاظ بالمكتبة السابقة")
                stage.setTextColor(BlofyTvDesign.Mint)
                Toast.makeText(this, "تم الاحتفاظ بالنسخة المحفوظة وفتحها بأمان", Toast.LENGTH_SHORT).show()
                if (!CatalogSyncState.isFullyReady(applicationContext, providerId)) awaitFullLocalCache(providerId)
                openHome()
            } else {
                fail("تعذر تجهيز المكتبة: ${error.message ?: "خطأ غير معروف"}")
            }
        }
    }

    private suspend fun awaitFullLocalCache(providerId: String) {
        FullCatalogPreparer.prepare(applicationContext, providerId) { update ->
            withContext(Dispatchers.Main.immediate) { render(update.percent, update.label) }
        }
    }

    private fun renderProgress(p: PlaylistSyncProgress) {
        val label = when (p.stage) {
            PlaylistSyncStage.M3U -> "جاري تحميل القائمة"
            PlaylistSyncStage.LIVE -> "جاري تحميل القنوات"
            PlaylistSyncStage.MOVIES -> "جاري تحميل الأفلام"
            PlaylistSyncStage.SERIES -> "جاري تحميل المسلسلات"
        }
        render((p.percent.coerceIn(0, 95) * 30 / 95), label)
    }

    private fun render(value: Int, label: String) {
        val safe = maxOf(displayedPercent, value.coerceIn(0, 100))
        displayedPercent = safe
        progress.progress = safe
        percent.text = "$safe%"
        stage.text = label
        serverStep.setTextColor(if (safe >= 5) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextMuted)
        contentStep.setTextColor(if (safe >= 10) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextMuted)
        prepareStep.setTextColor(if (safe >= 30) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextMuted)
        readyStep.setTextColor(if (safe >= 100) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
        serverStep.text = if (safe >= 10) "✓  الاتصال بالخادم" else "●  الاتصال بالخادم"
        contentStep.text = if (safe >= 30) "✓  جلب المحتوى" else "○  جلب المحتوى"
        prepareStep.text = if (safe >= 100) "✓  تحضير المكتبة" else "○  تحضير المكتبة"
        readyStep.text = if (safe >= 100) "✓  جاهز" else "○  جاهز"
    }

    private fun openHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    private fun fail(message: String) {
        stage.text = message
        stage.setTextColor(BlofyTvDesign.Error)
        retryButton.visibility = View.VISIBLE
        retryButton.post { if (!isFinishing) retryButton.requestFocus() }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_FORCE_REFRESH = "force_refresh"
    }
}
