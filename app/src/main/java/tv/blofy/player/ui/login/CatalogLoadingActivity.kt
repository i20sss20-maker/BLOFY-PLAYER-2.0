package tv.blofy.player.ui.login

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.data.preparation.FullCatalogPreparer
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
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
    private lateinit var deviceKind: DeviceClass.Kind

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deviceKind = DeviceClass.detect(this)
        TvUiTuning.enter(this)
        buildUi()
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        if (providerId.isBlank()) {
            fail(getString(R.string.catalog_provider_missing))
            return
        }
        val forceRefresh = intent.getBooleanExtra(EXTRA_FORCE_REFRESH, false)
        retryButton.setOnClickListener { startLoading(providerId, forceRefresh = false) }
        startLoading(providerId, forceRefresh)
    }

    private fun startLoading(providerId: String, forceRefresh: Boolean) {
        if (loadJob?.isActive == true) return
        retryButton.visibility = View.GONE
        stage.setTextColor(BlofyTvDesign.TextPrimary)
        render(1, getString(R.string.catalog_preflight))
        loadJob = lifecycleScope.launch {
            try {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val hasCachedCatalog = withTimeout(20_000L) {
                    withContext(Dispatchers.IO) { dao.hasCatalog(providerId) }
                }
                val catalogReady = CatalogSyncState.isReady(applicationContext, providerId)
                if (!forceRefresh && CatalogSyncState.isFullyReady(applicationContext, providerId) && hasCachedCatalog) {
                    openHome(providerId)
                } else if (!forceRefresh && catalogReady && hasCachedCatalog) {
                    awaitEntryReadyCache(providerId)
                    openHome(providerId)
                } else {
                    CatalogSyncState.markPending(applicationContext, providerId)
                    sync(providerId)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: TimeoutCancellationException) {
                fail(getString(R.string.catalog_preflight_timeout))
            } catch (error: Exception) {
                fail(preparationMessage(error))
            }
        }
    }

    private fun preparationMessage(error: Throwable): String = when (error) {
        is FullCatalogPreparer.Incomplete -> error.message.orEmpty()
        is ArtworkLoader.StorageFull -> error.message.orEmpty()
        else -> getString(R.string.catalog_prepare_failed)
    }

    private fun buildUi() {
        fun u(v: Int) = TvUiTuning.dp(this, v)
        fun s(v: Float) = TvUiTuning.sp(this, v)
        val compact = deviceKind == DeviceClass.Kind.PHONE
        val tablet = deviceKind == DeviceClass.Kind.TABLET
        val screenWidthDp = resources.configuration.screenWidthDp.takeIf { it > 0 } ?: resources.configuration.smallestScreenWidthDp

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(
                u(if (compact) 14 else if (tablet) 28 else 72),
                u(if (compact) 16 else 40),
                u(if (compact) 14 else if (tablet) 28 else 72),
                u(if (compact) 16 else 40)
            )
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(
                u(if (compact) 20 else if (tablet) 34 else 52),
                u(if (compact) 22 else 34),
                u(if (compact) 20 else if (tablet) 34 else 52),
                u(if (compact) 22 else 34)
            )
            background = BlofyTvDesign.glassSurface(u(BlofyTvDesign.PanelRadius).toFloat())
            elevation = u(6).toFloat()
        }
        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(u(if (compact) 120 else 176), u(if (compact) 66 else 96)))
        panel.addView(TextView(this).apply {
            text = getString(R.string.catalog_title)
            BlofyTvDesign.applyTitle(this)
            textSize = s(if (compact) 23f else if (tablet) 27f else 30f)
            gravity = Gravity.CENTER
            setPadding(0, u(4), 0, u(4))
        })
        panel.addView(TextView(this).apply {
            text = getString(R.string.catalog_subtitle)
            BlofyTvDesign.applyBody(this)
            textSize = s(if (compact) 12f else 14f)
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, u(if (compact) 12 else 20))
        })

        val progressRow = LinearLayout(this).apply {
            orientation = if (compact) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = ColorStateList.valueOf(BlofyTvDesign.Divider)
        }
        if (compact) {
            progressRow.addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(10)).apply {
                bottomMargin = u(8)
            })
        } else {
            progressRow.addView(progress, LinearLayout.LayoutParams(0, u(12), 1f).apply { marginEnd = u(24) })
        }
        percent = TextView(this).apply {
            text = "0%"
            textSize = s(if (compact) 32f else 40f)
            typeface = BlofyTvDesign.DisplayTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }
        progressRow.addView(percent, if (compact) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(50))
        } else {
            LinearLayout.LayoutParams(u(132), u(64))
        })
        panel.addView(progressRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(if (compact) 72 else 72)))

        stage = TextView(this).apply {
            text = getString(R.string.catalog_connecting)
            BlofyTvDesign.applyHeading(this)
            textSize = s(if (compact) 16f else 20f)
            gravity = Gravity.CENTER
            setPadding(0, u(if (compact) 6 else 12), 0, u(6))
        }
        panel.addView(stage)
        panel.addView(TextView(this).apply {
            text = getString(R.string.catalog_note)
            BlofyTvDesign.applyCaption(this)
            textSize = s(if (compact) 11f else 12.5f)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, u(if (compact) 14 else 22))
        })

        val steps = LinearLayout(this).apply {
            orientation = if (compact) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = resources.configuration.layoutDirection
        }
        serverStep = step(getString(R.string.catalog_step_server))
        contentStep = step(getString(R.string.catalog_step_content))
        prepareStep = step(getString(R.string.catalog_step_prepare))
        readyStep = step(getString(R.string.catalog_step_ready))
        steps.addView(serverStep, stepParams(compact))
        steps.addView(contentStep, stepParams(compact))
        steps.addView(prepareStep, stepParams(compact))
        steps.addView(readyStep, stepParams(compact))

        retryButton = Button(this).apply {
            text = getString(R.string.catalog_retry)
            isAllCaps = false
            visibility = View.GONE
            isFocusable = true
            isFocusableInTouchMode = deviceKind == DeviceClass.Kind.TV
            if (deviceKind == DeviceClass.Kind.TV) {
                BlofyTvDesign.installTvFocus(this, u(16).toFloat(), 1.02f, true) {}
            }
        }
        panel.addView(retryButton, LinearLayout.LayoutParams(
            if (compact) LinearLayout.LayoutParams.MATCH_PARENT else u(320),
            u(if (compact) 50 else 54)
        ).apply { bottomMargin = u(if (compact) 8 else 0) })
        panel.addView(steps, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            if (compact) LinearLayout.LayoutParams.WRAP_CONTENT else u(60)
        ))

        val panelWidth = when {
            compact -> LinearLayout.LayoutParams.MATCH_PARENT
            tablet -> u(minOf(760, (screenWidthDp - 56).coerceAtLeast(520)))
            else -> u(minOf(980, (screenWidthDp - 120).coerceAtLeast(680)))
        }
        root.addView(panel, LinearLayout.LayoutParams(panelWidth, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    private fun step(label: String) = TextView(this).apply {
        text = "○  $label"
        textSize = TvUiTuning.sp(this@CatalogLoadingActivity, if (deviceKind == DeviceClass.Kind.PHONE) 11.5f else 12.5f)
        typeface = BlofyTvDesign.MediumTypeface
        setTextColor(BlofyTvDesign.TextMuted)
        gravity = Gravity.CENTER
    }

    private fun stepParams(compact: Boolean) = if (compact) {
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, TvUiTuning.dp(this, 32)).apply {
            topMargin = TvUiTuning.dp(this@CatalogLoadingActivity, 2)
        }
    } else {
        LinearLayout.LayoutParams(0, TvUiTuning.dp(this, 50), 1f).apply {
            marginStart = TvUiTuning.dp(this@CatalogLoadingActivity, 5)
            marginEnd = TvUiTuning.dp(this@CatalogLoadingActivity, 5)
        }
    }

    private suspend fun sync(providerId: String) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val target = withTimeout(20_000L) {
            withContext(Dispatchers.IO) { dao.provider(providerId) }
        } ?: return fail(getString(R.string.catalog_provider_not_found))
        val firstLoad = withTimeout(20_000L) {
            withContext(Dispatchers.IO) { !dao.hasStreamsForProvider(providerId) }
        }
        val syncProvider: ProviderEntity = if (firstLoad) {
            target.copy(enabled = true, updatedAt = System.currentTimeMillis())
        } else {
            target.copy(id = UUID.randomUUID().toString(), enabled = false)
        }
        var catalogCommitted = false
        try {
            render(5, getString(if (firstLoad) R.string.catalog_start_full else R.string.catalog_start_refresh))
            val result = PlaylistSyncPolicy.run {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncAll(syncProvider) { p ->
                        withContext(Dispatchers.Main.immediate) { renderProgress(p) }
                    }
                }
            }
            check(result.freshItemCount > 0) { getString(R.string.catalog_invalid_content) }
            check(result.failedSectionCount == 0) { getString(R.string.catalog_section_failed) }
            render(30, getString(if (firstLoad) R.string.catalog_finishing else R.string.catalog_saving_refresh))
            withContext(Dispatchers.IO) {
                if (firstLoad) {
                    dao.saveAndActivateProvider(syncProvider.copy(enabled = true, updatedAt = System.currentTimeMillis()))
                } else {
                    dao.promoteStagedCatalog(syncProvider.id, target.copy(enabled = true, updatedAt = System.currentTimeMillis()))
                }
            }
            catalogCommitted = true
            if (!firstLoad) {
                withContext(Dispatchers.IO) { ProviderMetadataCache.clearProvider(applicationContext, providerId) }
            }
            CatalogSyncState.markCatalogCommitted(applicationContext, providerId)
            awaitEntryReadyCache(providerId)
            render(100, getString(R.string.catalog_complete))
            delay(120L)
            openHome(providerId)
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
                render(30, getString(R.string.catalog_refresh_kept))
                stage.setTextColor(BlofyTvDesign.Mint)
                Toast.makeText(this, getString(R.string.catalog_kept_opening), Toast.LENGTH_SHORT).show()
                if (!CatalogSyncState.isFullyReady(applicationContext, providerId)) awaitEntryReadyCache(providerId)
                openHome(providerId)
            } else {
                fail(getString(R.string.catalog_first_failed, error.message ?: getString(R.string.catalog_unknown_error)))
            }
        }
    }

    private suspend fun awaitEntryReadyCache(providerId: String) {
        FullCatalogPreparer.prepare(applicationContext, providerId) { update ->
            val label = when (update.percent) {
                in 0..31 -> getString(R.string.catalog_preflight)
                in 32..54 -> getString(R.string.catalog_finishing)
                in 55..81 -> getString(R.string.catalog_subtitle)
                in 82..89 -> getString(R.string.catalog_finishing)
                in 90..95 -> getString(R.string.catalog_preflight)
                in 96..99 -> getString(R.string.catalog_preflight)
                else -> getString(R.string.catalog_complete)
            }
            withContext(Dispatchers.Main.immediate) { render(update.percent, label) }
        }
    }

    private fun renderProgress(p: PlaylistSyncProgress) {
        val label = when (p.stage) {
            PlaylistSyncStage.M3U -> getString(R.string.catalog_stage_m3u)
            PlaylistSyncStage.LIVE -> getString(R.string.catalog_stage_live)
            PlaylistSyncStage.MOVIES -> getString(R.string.catalog_stage_movies)
            PlaylistSyncStage.SERIES -> getString(R.string.catalog_stage_series)
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
        serverStep.text = "${if (safe >= 10) "✓" else "●"}  ${getString(R.string.catalog_step_server)}"
        contentStep.text = "${if (safe >= 30) "✓" else "○"}  ${getString(R.string.catalog_step_content)}"
        prepareStep.text = "${if (safe >= 100) "✓" else "○"}  ${getString(R.string.catalog_step_prepare)}"
        readyStep.text = "${if (safe >= 100) "✓" else "○"}  ${getString(R.string.catalog_step_ready)}"
    }

    private fun openHome(providerId: String) {
        // Fully-ready libraries bypass preparation on later launches. Restart the durable
        // background enrichment pass here so a force-close/reboot never loses progress.
        FullCatalogPreparer.resumeBackground(applicationContext, providerId)
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    private fun fail(message: String) {
        stage.text = message
        stage.setTextColor(BlofyTvDesign.Error)
        retryButton.visibility = View.VISIBLE
        retryButton.post { if (!isFinishing && deviceKind == DeviceClass.Kind.TV) retryButton.requestFocus() }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_FORCE_REFRESH = "force_refresh"
    }
}
