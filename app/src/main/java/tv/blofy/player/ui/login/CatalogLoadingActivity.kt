package tv.blofy.player.ui.login

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.activity.addCallback
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import tv.blofy.player.data.preparation.CatalogLoadAttempt
import tv.blofy.player.data.preparation.CatalogLoadPersistence
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.CatalogProgressThrottle
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.preparation.FullCatalogPreparer
import tv.blofy.player.data.preparation.FullLibrarySyncWorker
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID
import java.util.Locale

class CatalogLoadingActivity : AppCompatActivity() {
    private lateinit var retryButton: Button
    // Back key remains available for accessibility; no on-screen cancel action.
    private var leaving = false
    private var hasSavedLibrary = false
    private var loadJob: Job? = null
    private var forceRefreshOnRetry = false
    private var displayedPercent = 0
    private lateinit var percent: TextView
    private lateinit var stage: TextView
    private lateinit var progress: ProgressBar
    private lateinit var deviceKind: DeviceClass.Kind

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        deviceKind = DeviceClass.detect(this)
        TvUiTuning.enter(this)
        buildUi()
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        if (providerId.isBlank()) {
            fail(getString(R.string.catalog_provider_missing))
            return
        }
        val forceRefresh = intent.getBooleanExtra(EXTRA_FORCE_REFRESH, false)
        retryButton.setOnClickListener { startLoading(providerId, forceRefreshOnRetry) }
        onBackPressedDispatcher.addCallback(this) { leaveLoading(providerId) }
        startLoading(providerId, forceRefresh)
    }

    private fun startLoading(providerId: String, forceRefresh: Boolean) {
        if (loadJob?.isActive == true) return
        hasSavedLibrary = false
        leaving = false
        forceRefreshOnRetry = forceRefresh
        retryButton.visibility = View.GONE
        stage.setTextColor(BlofyTvDesign.TextPrimary)
        displayedPercent = 0
        render(1, getString(R.string.catalog_preflight))
        loadJob = lifecycleScope.launch {
            var preflight = true
            CatalogLoadAttempt.run(
                onTimeout = { fail(getString(if (preflight) R.string.catalog_preflight_timeout else R.string.catalog_prepare_failed)) },
                onFailure = { fail(preparationMessage(it)) }
            ) {
                CatalogLoadPersistence.withProviderLock(providerId) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    // Check the committed local catalog FIRST. A down upstream server
                    // must never prevent a user from opening last week's working library.
                    val hasCachedCatalog = withTimeout(20_000L) {
                        withContext(Dispatchers.IO) {
                            CatalogLoadPersistence.hasCommittedCatalog(applicationContext, dao, providerId)
                        }
                    }
                    hasSavedLibrary = hasCachedCatalog
                    if (!forceRefresh && hasCachedCatalog) {
                        openHome(providerId)
                        return@withProviderLock
                    }
                    try {
                        PortalPlaylistClient.ensureSubscriberConnection(
                            applicationContext, tv.blofy.player.BuildConfig.ACTIVATION_BASE_URL, dao, providerId
                        )
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        if (!hasCachedCatalog) throw error
                        // Offline refresh is not a reason to erase the known-good library.
                        Toast.makeText(this@CatalogLoadingActivity, "تعذر الاتصال بالتحديث • تم الاحتفاظ بالمكتبة", Toast.LENGTH_LONG).show()
                        openHome(providerId)
                        return@withProviderLock
                    }
                    preflight = false
                    if (!hasCachedCatalog) CatalogSyncState.markPending(applicationContext, providerId)
                    sync(providerId, forceRefresh)
                }
            }
        }
    }

    private fun leaveLoading(providerId: String) {
        if (isFinishing || leaving) return
        leaving = true
        val active = loadJob
        lifecycleScope.launch {
            // Wait for the previous job to roll back any temporary data before
            // opening the preserved catalog or leaving first-time setup.
            active?.cancelAndJoin()
            if (hasSavedLibrary && CatalogSyncState.isReady(applicationContext, providerId)) {
                openHome(providerId)
            } else finish()
        }
    }

    private fun preparationMessage(error: Throwable): String = when (error) {
        is FullCatalogPreparer.Incomplete -> error.message.orEmpty()
        is ArtworkLoader.StorageFull -> error.message.orEmpty()
        else -> if (error.message?.startsWith("تعذر تجديد هوست BLOFY الداخلي") == true)
            "تعذر تحديث هوست BLOFY • أعد تسجيل الدخول إلى مشتركين BLOFY"
        else getString(R.string.catalog_prepare_failed)
    }

    private fun buildUi() {
        fun u(v: Int) = TvUiTuning.dp(this, v)
        fun s(v: Float) = TvUiTuning.sp(this, v)
        val compact = deviceKind == DeviceClass.Kind.PHONE
        val tablet = deviceKind == DeviceClass.Kind.TABLET
        val shortTv = deviceKind == DeviceClass.Kind.TV && resources.configuration.screenHeightDp in 1..620
        val screenWidthDp = resources.configuration.screenWidthDp.takeIf { it > 0 } ?: resources.configuration.smallestScreenWidthDp

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(
                u(if (compact) 14 else if (tablet) 28 else if (shortTv) 38 else 72),
                u(if (compact) 16 else if (shortTv) 18 else 40),
                u(if (compact) 14 else if (tablet) 28 else if (shortTv) 38 else 72),
                u(if (compact) 16 else if (shortTv) 18 else 40)
            )
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(
                u(if (compact) 20 else if (tablet) 34 else if (shortTv) 34 else 52),
                u(if (compact) 22 else if (shortTv) 22 else 34),
                u(if (compact) 20 else if (tablet) 34 else if (shortTv) 34 else 52),
                u(if (compact) 22 else if (shortTv) 22 else 34)
            )
            background = BlofyTvDesign.glassSurface(u(BlofyTvDesign.PanelRadius).toFloat())
            elevation = u(6).toFloat()
        }
        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(u(if (compact) 128 else if (shortTv) 154 else 196), u(if (compact) 70 else if (shortTv) 82 else 108)))
        panel.addView(TextView(this).apply {
            text = getString(R.string.catalog_title)
            BlofyTvDesign.applyTitle(this)
            textSize = s(if (compact) 23f else if (tablet) 27f else if (shortTv) 27f else 30f)
            gravity = Gravity.CENTER
            setPadding(0, u(4), 0, u(4))
        })
        val progressRow = LinearLayout(this).apply {
            orientation = if (compact) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(u(if (compact) 14 else 20), u(if (compact) 12 else if (shortTv) 11 else 16), u(if (compact) 14 else 20), u(if (compact) 12 else if (shortTv) 11 else 16))
            background = progressCardBackground()
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            progressTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = ColorStateList.valueOf(BlofyTvDesign.Divider)
        }
        if (compact) {
            progressRow.addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(12)).apply {
                bottomMargin = u(8)
            })
        } else {
            progressRow.addView(progress, LinearLayout.LayoutParams(0, u(16), 1f).apply { marginEnd = u(20) })
        }
        percent = TextView(this).apply {
            text = "0%"
            textSize = s(if (compact) 30f else if (shortTv) 33f else 36f)
            typeface = BlofyTvDesign.DisplayTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            textDirection = View.TEXT_DIRECTION_LTR
            includeFontPadding = false
            background = percentBadgeBackground()
        }
        progressRow.addView(percent, if (compact) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(48))
        } else {
            LinearLayout.LayoutParams(u(if (shortTv) 102 else 112), u(if (shortTv) 52 else 58))
        })
        panel.addView(progressRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, u(if (compact) 86 else if (shortTv) 76 else 88)).apply {
            bottomMargin = u(if (compact) 6 else if (shortTv) 6 else 10)
        })

        stage = TextView(this).apply {
            text = getString(R.string.catalog_connecting)
            BlofyTvDesign.applyHeading(this)
            textSize = s(if (compact) 17f else if (shortTv) 20f else 22f)
            gravity = Gravity.CENTER
            setPadding(0, u(if (compact) 6 else if (shortTv) 4 else 10), 0, u(4))
        }
        panel.addView(stage)
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
        // Recovery is a single centered Retry button and is shown only on errors.
        panel.addView(retryButton, LinearLayout.LayoutParams(
            if (compact) LinearLayout.LayoutParams.MATCH_PARENT else u(380),
            u(if (compact) 50 else 54)
        ).apply { bottomMargin = u(if (compact) 8 else 0) })
        val panelWidth = when {
            compact -> LinearLayout.LayoutParams.MATCH_PARENT
            tablet -> u(minOf(760, (screenWidthDp - 56).coerceAtLeast(520)))
            else -> u(minOf(980, (screenWidthDp - 120).coerceAtLeast(680)))
        }
        root.addView(panel, LinearLayout.LayoutParams(panelWidth, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    private suspend fun sync(providerId: String, forceRefresh: Boolean) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val target = withTimeout(20_000L) {
            withContext(Dispatchers.IO) { dao.provider(providerId) }
        } ?: return fail(getString(R.string.catalog_provider_not_found))
        val firstLoad = withTimeout(20_000L) {
            withContext(Dispatchers.IO) {
                !CatalogSyncState.isReady(applicationContext, providerId) || !dao.hasStreamsForProvider(providerId)
            }
        }
        val pendingSource = if (firstLoad) null else withContext(Dispatchers.IO) {
            PortalPlaylistClient.pendingSource(applicationContext, dao, providerId)
        }
        val source = pendingSource ?: target
        val explicitSourceReplacement = CatalogLoadPersistence.isApprovedSourceReplacement(
            forceRefresh, pendingSource, intent.getStringExtra(EXTRA_APPROVED_SOURCE_FINGERPRINT)
        )

        // A staged refresh temporarily duplicates catalog rows. Clean disposable cache first and
        // refuse the refresh if there is not enough disk headroom; the existing catalog stays safe.
        if (!firstLoad) {
            val storageReady = withContext(Dispatchers.IO) {
                LocalStorageManager.prepareForCatalogRefresh(applicationContext)
            }
            if (!storageReady) {
                render(30, getString(R.string.catalog_refresh_kept))
                stage.setTextColor(BlofyTvDesign.Mint)
                Toast.makeText(this, getString(R.string.storage_cleanup_message), Toast.LENGTH_LONG).show()
                openHome(providerId)
                return
            }
        }

        val syncProvider: ProviderEntity = if (firstLoad) {
            source.copy(enabled = true, updatedAt = System.currentTimeMillis())
        } else {
            source.copy(id = UUID.randomUUID().toString(), enabled = false)
        }
        val persistence = CatalogLoadPersistence(applicationContext, dao, target, syncProvider.id, firstLoad)
        try {
            render(5, getString(if (firstLoad) R.string.catalog_start_full else R.string.catalog_start_refresh))
            persistence.prepareFirstImport()
            val progressThrottle = CatalogProgressThrottle()
            val result = PlaylistSyncPolicy.run {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncAll(syncProvider,
                        completedSections = persistence.completedSections,
                        onSectionComplete = persistence::sectionCompleted) { p ->
                        if (progressThrottle.shouldRender(p)) {
                            withContext(Dispatchers.Main.immediate) { renderProgress(p) }
                        }
                    }
                }
            }
            check(result.freshItemCount > 0) { getString(R.string.catalog_invalid_content) }
            check(result.failedSectionCount == 0) { result.safeFailureMessage() }
            val savingLabel = getString(if (firstLoad) R.string.catalog_finishing else R.string.catalog_saving_refresh)
            render(30, savingLabel)
            // SQLite commit has no measurable percentage. Keep the completed download checkpoint internally,
            // but replace the frozen number with an explicit indeterminate state until measurable preparation resumes.
            progress.isIndeterminate = true
            percent.text = "…"
            val commit: suspend () -> Unit = {
                persistence.commit {
                    if (firstLoad) {
                        dao.activateImportedProvider(target)
                    } else if (explicitSourceReplacement) {
                        dao.promoteExplicitSourceReplacement(
                            syncProvider.id, source.copy(enabled = true, updatedAt = System.currentTimeMillis()), target
                        )
                    } else {
                        dao.promoteStagedRefresh(
                            syncProvider.id, source.copy(enabled = true, updatedAt = System.currentTimeMillis()),
                            expectedSource = target
                        )
                    }
                }
            }
            try {
                if (pendingSource != null) PortalPlaylistClient.commitPendingSource(applicationContext, dao, pendingSource, commit)
                else commit()
            } finally {
                progress.isIndeterminate = false
            }
            // Base catalog is already durable. A damaged or slow secondary Home/search
            // cache must not trap Android TV viewers after a successful DB commit.
            try {
                withTimeout(45_000L) { awaitEntryReadyCache(providerId) }
            } catch (secondary: Exception) {
                currentCoroutineContext().ensureActive()
                val baseReady = withContext(Dispatchers.IO) {
                    CatalogSyncState.isEntryReady(applicationContext, providerId) &&
                        dao.hasCatalog(providerId)
                }
                if (!persistence.catalogCommitted || !baseReady) throw secondary
                // The committed rows remain readable, with direct bounded Home fallback.
                FullLibrarySyncWorker.enqueue(applicationContext, providerId)
            }
            render(100, getString(R.string.catalog_complete))
            delay(120L)
            openHome(providerId)
        } catch (cancelled: CancellationException) {
            persistence.discardIfUncommitted()
            throw cancelled
        } catch (error: Throwable) {
            if (persistence.catalogCommitted) {
                fail(preparationMessage(error))
                return
            }
            persistence.discardIfUncommitted()
            if (!firstLoad) {
                render(30, getString(R.string.catalog_refresh_kept))
                stage.setTextColor(BlofyTvDesign.Mint)
                Toast.makeText(this, getString(R.string.catalog_kept_opening), Toast.LENGTH_SHORT).show()
                if (!CatalogSyncState.isEntryReady(applicationContext, providerId)) awaitEntryReadyCache(providerId)
                openHome(providerId)
            } else {
                val safe = when {
                    error.message?.startsWith("مسار ") == true -> error.message.orEmpty()
                    error.message?.startsWith("تعذر اكتمال تحميل") == true -> error.message.orEmpty()
                    error.message?.startsWith("تعذر تحميل") == true -> error.message.orEmpty()
                    error.message?.startsWith("رفض السيرفر") == true -> error.message.orEmpty()
                    error.message?.startsWith("خطأ سيرفر") == true -> error.message.orEmpty()
                    else -> getString(R.string.catalog_unknown_error)
                }
                fail(getString(R.string.catalog_first_failed, safe))
            }
        } finally {
            if (persistence.catalogCommitted) forceRefreshOnRetry = false
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
        // Only show section-specific progress when the server declares a
        // real byte length. No invented 99% overall completion.
        progress.isIndeterminate = p.sectionTransferPercent == null
        if (p.sectionTransferPercent != null) progress.progress = p.sectionTransferPercent
        percent.text = "${p.step.coerceAtLeast(1)}/${p.totalSteps.coerceAtLeast(1)}"
        stage.text = when {
            p.retryAttempt > 0 -> "$label • ${getString(R.string.catalog_retry)} (${p.retryAttempt}/3)"
            p.parsedItems != null -> "$label • ${String.format(Locale.US, "%,d", p.parsedItems)} عنصر"
            else -> label
        }
    }

    private fun render(value: Int, label: String) {
        val completed = value >= 100
        displayedPercent = maxOf(displayedPercent, value.coerceIn(0, 100))
        progress.isIndeterminate = !completed
        if (completed) progress.progress = 100
        percent.text = if (completed) "✓" else "…"
        stage.text = label
    }

    private suspend fun openHome(providerId: String) {
        withContext(Dispatchers.IO) {
            BlofyDatabase.get(applicationContext).dao().activateExistingProvider(providerId)
        }
        // The durable worker owns deep metadata/episode/artwork enrichment. It survives process
        // death and resumes from a disk checkpoint without blocking entry into Home.
        FullLibrarySyncWorker.enqueue(applicationContext, providerId)
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    private fun progressCardBackground() = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xE5251735.toInt(), 0xE3181025.toInt(), 0xE50D0A12.toInt())
    ).apply {
        cornerRadius = TvUiTuning.dp(this@CatalogLoadingActivity, 18).toFloat()
        setStroke(TvUiTuning.dp(this@CatalogLoadingActivity, 1), 0xFF674A84.toInt())
    }

    private fun percentBadgeBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF7F4AC6.toInt(), 0xFF4C2A73.toInt())
    ).apply {
        cornerRadius = TvUiTuning.dp(this@CatalogLoadingActivity, 16).toFloat()
        setStroke(TvUiTuning.dp(this@CatalogLoadingActivity, 1), BlofyTvDesign.FocusStroke)
    }

    private fun stepBackground(done: Boolean, active: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            done -> intArrayOf(0x5538CFA4, 0x33217E67)
            active -> intArrayOf(0x665F3890, 0x33351F50)
            else -> intArrayOf(0x331B1424, 0x22110D17)
        }
    ).apply {
        cornerRadius = TvUiTuning.dp(this@CatalogLoadingActivity, 12).toFloat()
        setStroke(
            TvUiTuning.dp(this@CatalogLoadingActivity, 1),
            when {
                done -> 0x995BDEBB.toInt()
                active -> 0x998C65B6.toInt()
                else -> 0x334E3A60
            }
        )
    }

    private fun fail(message: String) {
        progress.isIndeterminate = false
        progress.progress = 0
        percent.text = "تعذر"
        percent.text = "!"
        stage.text = message
        stage.setTextColor(BlofyTvDesign.Error)
        retryButton.visibility = View.VISIBLE
        retryButton.post { if (!isFinishing && deviceKind == DeviceClass.Kind.TV) retryButton.requestFocus() }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_FORCE_REFRESH = "force_refresh"
        const val EXTRA_APPROVED_SOURCE_FINGERPRINT = "approved_source_fingerprint"
    }
}
