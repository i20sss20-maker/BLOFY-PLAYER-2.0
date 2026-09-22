package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalRefreshFailure
import tv.blofy.player.core.identity.PortalRefreshFeedback
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.CatalogLoadingActivity
import java.text.DateFormat
import java.util.Date
import java.util.UUID

class ProviderManagerActivity : AppCompatActivity() {
    internal var activationEndpoint: String = BuildConfig.ACTIVATION_BASE_URL.trim()
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var addButton: Button
    private lateinit var websiteRefreshButton: Button
    private var refreshingFromWebsite = false
    private var changingProvider = false
    private var summaryGeneration = 0
    private val summaryViews = linkedMapOf<String, TextView>()
    private val focusButtons = linkedMapOf<String, Button>()
    private val isTv by lazy { DeviceClass.isTv(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(if (isTv) 58 else 18), dp(if (isTv) 34 else 18), dp(if (isTv) 58 else 18), dp(if (isTv) 34 else 22))
            background = AppCompatResources.getDrawable(this@ProviderManagerActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
        }
        val title = TextView(this).apply {
            text = getString(R.string.provider_manager_title)
            BlofyTvDesign.applyTitle(this)
            gravity = Gravity.START
        }
        header.addView(title, if (isTv) LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            else LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        websiteRefreshButton = actionButton("website_refresh", getString(R.string.provider_manager_refresh_from_website)) { refreshFromWebsite() }
        header.addView(websiteRefreshButton, LinearLayout.LayoutParams(if (isTv) dp(250) else LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
            if (isTv) marginStart = dp(16) else topMargin = dp(10)
        })
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(TextView(this).apply {
            text = getString(R.string.provider_manager_subtitle)
            textSize = if (isTv) 16f else 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START
            setPadding(0, dp(6), 0, 0)
        })
        status = TextView(this).apply {
            text = getString(R.string.provider_manager_subscriber_hint)
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(14), 0, dp(14), 0)
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        root.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (isTv) 44 else 52)).apply {
            topMargin = dp(14); bottomMargin = dp(14)
        })

        val actions = LinearLayout(this).apply {
            orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.START
            clipChildren = false
        }
        val subscriberButton = actionButton("subscriber", getString(R.string.provider_manager_add_subscriber), primary = true) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java))
        }
        addButton = actionButton("add", "+  Xtream") {
            startActivity(Intent(this, PlaylistActivity::class.java).putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true))
        }
        if (isTv) {
            actions.addView(subscriberButton, LinearLayout.LayoutParams(dp(310), dp(64)).apply { marginStart = dp(12) })
            actions.addView(addButton, LinearLayout.LayoutParams(dp(270), dp(64)))
            root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(70)).apply {
                bottomMargin = dp(18); gravity = Gravity.START
            })
        } else {
            actions.addView(subscriberButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply { bottomMargin = dp(8) })
            actions.addView(addButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)))
            root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(16)
            })
        }

        root.addView(TextView(this).apply {
            text = getString(R.string.provider_manager_saved_servers)
            textSize = if (isTv) 20f else 18f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)))

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(0, dp(8), 0, dp(12))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            try {
                val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
                dao.allProvidersStored().collect { render(it) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.setText(R.string.provider_manager_read_failed)
            }
        }
    }

    private fun refreshFromWebsite() {
        if (refreshingFromWebsite || changingProvider) return
        val endpoint = activationEndpoint
        if (endpoint.isBlank()) {
            status.setText(R.string.provider_manager_refresh_unconfigured)
            return
        }
        refreshingFromWebsite = true
        focusButtons.values.forEach { it.isEnabled = false }
        websiteRefreshButton.setText(R.string.provider_manager_refreshing)
        status.setText(R.string.provider_manager_fetching)
        lifecycleScope.launch {
            try {
                val result = withTimeout(40_000L) {
                    withContext(Dispatchers.IO) {
                        val dao = BlofyDatabase.get(applicationContext).dao()
                        val activation = ActivationManager(applicationContext, dao)
                        if (!activation.cachedCanUse(activation.ensureIdentity())) {
                            val checked = try {
                                activation.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (error: Exception) { throw PortalRefreshFailure("AUTH", cause = error) }
                            if (!checked.canUse()) throw PortalRefreshFailure("AUTH", 403)
                        }
                        val synced = PortalPlaylistClient.sync(applicationContext, endpoint, dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
                        synced.changedProviderIds.forEach { CatalogSyncState.markPending(applicationContext, it) }
                        synced
                    }
                }
                status.text = PortalRefreshFeedback.result(this@ProviderManagerActivity, result)
            } catch (error: TimeoutCancellationException) {
                status.text = PortalRefreshFeedback.failure(this@ProviderManagerActivity, error)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                status.text = PortalRefreshFeedback.failure(this@ProviderManagerActivity, error)
            } finally {
                refreshingFromWebsite = false
                if (!isFinishing && !isDestroyed) {
                    websiteRefreshButton.setText(R.string.provider_manager_refresh_from_website)
                    focusButtons.values.forEach { it.isEnabled = true }
                    if (isTv && hasWindowFocus()) websiteRefreshButton.requestFocus()
                }
            }
        }
    }

    private fun render(allItems: List<ProviderEntity>) {
        val items = tv.blofy.player.core.identity.PortalSyncBook.visible(this, allItems)
            .filter { it.providerType.equals("xtream", true) || isBlofySubscriber(it) }
        val generation = ++summaryGeneration
        summaryViews.clear()
        focusButtons.keys.filter { it !in setOf("add", "subscriber", "website_refresh") }.toList().forEach { focusButtons.remove(it) }
        list.removeAllViews()
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = getString(R.string.provider_manager_empty)
                setTextColor(BlofyTvDesign.TextSecondary)
                textSize = 18f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.START
                setLineSpacing(dp(4).toFloat(), 1.12f)
                setPadding(dp(22), dp(24), dp(22), dp(24))
                background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
            })
            restoreFocus()
            return
        }

        items.forEach { provider ->
            val row = LinearLayout(this).apply {
                orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
                layoutDirection = resources.configuration.layoutDirection
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(if (isTv) 18 else 14), dp(9), dp(if (isTv) 18 else 14), dp(9))
                background = if (provider.enabled) BlofyTvDesign.surface(dp(20).toFloat(), true) else BlofyTvDesign.surface(dp(20).toFloat(), false)
                clipChildren = false
            }

            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                layoutDirection = resources.configuration.layoutDirection
            }
            info.addView(TextView(this).apply {
                text = provider.name
                textSize = 18f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                gravity = Gravity.START
                setTextColor(Color.WHITE)
                maxLines = 1
            })
            info.addView(TextView(this).apply {
                text = buildString {
                    append(getString(
                        R.string.provider_manager_source_format,
                        getString(if (provider.enabled) R.string.provider_manager_active else R.string.provider_manager_saved),
                        if (isBlofySubscriber(provider)) "BLOFY Secure" else "XTREAM"
                    ))
                }
                textSize = 13f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.START
                setTextColor(if (provider.enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
            })
            val summary = TextView(this).apply {
                text = getString(R.string.provider_manager_summary_loading)
                textSize = 11.5f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.START
                maxLines = if (isTv) 1 else 2
                setTextColor(BlofyTvDesign.TextMuted)
            }
            info.addView(summary)
            summaryViews[provider.id] = summary
            row.addView(info, if (isTv) LinearLayout.LayoutParams(0, dp(76), 1f)
                else LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(82)))

            if (isTv) {
                row.addView(actionButton("${provider.id}:connect", getString(R.string.provider_manager_connect), primary = true) { connect(provider) }, LinearLayout.LayoutParams(dp(140), dp(56)).apply { marginStart = dp(8) })
                row.addView(actionButton("${provider.id}:edit", getString(R.string.provider_manager_edit)) { edit(provider) }, LinearLayout.LayoutParams(dp(116), dp(56)).apply { marginStart = dp(8) })
                row.addView(actionButton("${provider.id}:refresh", getString(R.string.provider_manager_sync)) { refresh(provider) }, LinearLayout.LayoutParams(dp(120), dp(56)).apply { marginStart = dp(8) })
                row.addView(actionButton("${provider.id}:delete", getString(R.string.provider_manager_delete)) { remove(provider) }, LinearLayout.LayoutParams(dp(104), dp(56)))
            } else {
                val rowActions = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutDirection = resources.configuration.layoutDirection
                    gravity = Gravity.CENTER_VERTICAL
                }
                rowActions.addView(actionButton("${provider.id}:connect", getString(R.string.provider_manager_connect_plain), primary = true) { connect(provider) }, LinearLayout.LayoutParams(0, dp(50), 1.25f).apply { marginStart = dp(5) })
                rowActions.addView(actionButton("${provider.id}:edit", getString(R.string.provider_manager_edit)) { edit(provider) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(5) })
                rowActions.addView(actionButton("${provider.id}:refresh", getString(R.string.provider_manager_sync)) { refresh(provider) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(5) })
                rowActions.addView(actionButton("${provider.id}:delete", getString(R.string.provider_manager_delete)) { remove(provider) }, LinearLayout.LayoutParams(0, dp(50), .85f))
                row.addView(rowActions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)))
            }
            list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (isTv) dp(100) else LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(9)
            })
        }
        loadLocalSummaries(items, generation)
        restoreFocus()
    }

    private fun loadLocalSummaries(items: List<ProviderEntity>, generation: Int) {
        lifecycleScope.launch {
            val summaries = try {
                withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    items.map { provider ->
                        ProviderSummary(
                            id = provider.id,
                            live = dao.catalogCountAll(provider.id, "live"),
                            movies = dao.catalogCountAll(provider.id, "movie"),
                            series = dao.catalogCountAll(provider.id, "series"),
                            ready = CatalogSyncState.isEntryReady(applicationContext, provider.id),
                            lastUpdatedAt = CatalogSyncState.lastUpdatedAt(applicationContext, provider.id)
                        )
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                emptyList()
            }
            if (generation != summaryGeneration || isFinishing || isDestroyed) return@launch
            if (summaries.isEmpty()) {
                summaryViews.values.forEach { it.setText(R.string.provider_manager_summary_failed) }
                return@launch
            }
            summaries.forEach { summary ->
                val base = getString(
                    R.string.provider_manager_summary_format,
                    getString(if (summary.ready) R.string.provider_manager_ready else R.string.provider_manager_needs_update),
                    getString(R.string.provider_manager_channels_count, summary.live),
                    getString(R.string.provider_manager_movies_count, summary.movies),
                    getString(R.string.provider_manager_series_count, summary.series)
                )
                summaryViews[summary.id]?.text = if (summary.lastUpdatedAt > 0L) {
                    getString(R.string.provider_manager_summary_with_time, base, formatShortTime(summary.lastUpdatedAt))
                } else base
            }
        }
    }

    private fun formatShortTime(value: Long): String =
        DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(value))

    private fun restoreFocus() {
        if (!isTv || refreshingFromWebsite || changingProvider) return
        val key = FocusMemory.restore(this, SCREEN_KEY)
        val target = key?.let(focusButtons::get)
            ?: focusButtons.entries.firstOrNull { it.key.endsWith(":connect") }?.value
            ?: focusButtons["subscriber"]
            ?: addButton
        target.post { if (!isFinishing && !refreshingFromWebsite && !changingProvider) target.requestFocus() }
    }

    private fun connect(provider: ProviderEntity) {
        if (changingProvider || refreshingFromWebsite) return
        if (!provider.providerType.equals("xtream", true) && !isBlofySubscriber(provider)) {
            status.setText(R.string.provider_manager_legacy_unsupported)
            return
        }
        changingProvider = true
        focusButtons.values.forEach { it.isEnabled = false }
        status.text = getString(R.string.provider_manager_opening, provider.name)
        lifecycleScope.launch {
            try {
                val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
                val selected = PortalPlaylistClient.selectProvider(applicationContext, activationEndpoint, provider, dao)
                val cached = withContext(Dispatchers.IO) {
                    CatalogSyncState.isEntryReady(applicationContext, selected.id) && dao.hasStreamsForProvider(selected.id)
                }
                if (cached) {
                    startActivity(Intent(this@ProviderManagerActivity, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                } else {
                    startActivity(Intent(this@ProviderManagerActivity, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, selected.id))
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.setText(R.string.provider_manager_open_failed)
            } finally {
                changingProvider = false
                focusButtons.values.forEach { it.isEnabled = !refreshingFromWebsite }
            }
        }
    }

    private fun edit(provider: ProviderEntity) {
        if (isBlofySubscriber(provider)) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java).putExtra(PlaylistActivity.EXTRA_PROVIDER_ID, provider.id))
            return
        }
        startActivity(Intent(this, PlaylistActivity::class.java).apply {
            putExtra(PlaylistActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true)
        })
    }

    private fun isBlofySubscriber(provider: ProviderEntity): Boolean {
        val stableId = UUID.nameUUIDFromBytes("blofy-subscriber".toByteArray()).toString()
        return tv.blofy.player.core.identity.BlofySubscriberClient.isManaged(provider) || provider.id == stableId ||
            provider.name.equals("مشتركين BLOFY", ignoreCase = true) ||
            provider.baseUrl.contains("/subscribers/", ignoreCase = true) ||
            provider.baseUrl.contains("/subscriber/", ignoreCase = true)
    }

    private fun refresh(provider: ProviderEntity) {
        if (!provider.providerType.equals("xtream", true) && !isBlofySubscriber(provider)) {
            status.setText(R.string.provider_manager_legacy_unsupported)
            return
        }
        startActivity(Intent(this, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, true)
        })
    }

    private fun remove(provider: ProviderEntity) {
        if (changingProvider || refreshingFromWebsite) return
        changingProvider = true
        focusButtons.values.forEach { it.isEnabled = false }
        lifecycleScope.launch {
            try {
                val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
                val wasActive = withContext(Dispatchers.IO) { dao.provider(provider.id)?.enabled == true }
                val synced = PortalPlaylistClient.removeProvider(applicationContext, activationEndpoint, provider, dao)
                if (wasActive) {
                    val next = tv.blofy.player.core.identity.PortalSyncBook.visible(applicationContext, dao.allProviders().first())
                        .firstOrNull { it.providerType.equals("xtream", true) || isBlofySubscriber(it) }
                    if (next != null) PortalPlaylistClient.selectProvider(applicationContext, activationEndpoint, next, dao)
                }
                status.text = getString(if (synced) R.string.provider_manager_removed_synced else R.string.provider_manager_removed_pending)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.setText(R.string.provider_manager_remove_failed)
            } finally {
                changingProvider = false
                focusButtons.values.forEach { it.isEnabled = !refreshingFromWebsite }
            }
        }
    }

    private fun actionButton(key: String, label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        id = View.generateViewId()
        text = label
        isAllCaps = false
        textSize = if (isTv) 14f else 12.5f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        stateListAnimator = null
        isEnabled = !refreshingFromWebsite && !changingProvider
        BlofyTvDesign.installTvFocus(this, dp(17).toFloat(), 1.04f, primary) {
            if (isTv) FocusMemory.save(this@ProviderManagerActivity, SCREEN_KEY, key)
        }
        setOnClickListener { if (!refreshingFromWebsite && !changingProvider) action() }
        focusButtons[key] = this
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private data class ProviderSummary(
        val id: String,
        val live: Int,
        val movies: Int,
        val series: Int,
        val ready: Boolean,
        val lastUpdatedAt: Long
    )

    companion object { private const val SCREEN_KEY = "provider_manager" }
}
