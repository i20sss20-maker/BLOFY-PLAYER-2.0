package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationConnectionDiagnostics
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationDisplayState
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationPortalUrl
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.core.identity.PortalRefreshFeedback
import tv.blofy.player.core.identity.PortalRefreshFailure
import tv.blofy.player.core.provider.RemoteProviderProfileClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity
import tv.blofy.player.ui.playlist.ProviderDisplayName

class LoginActivity : AppCompatActivity() {
    // Tests point requests at MockWebServer; production always starts from the signed build config.
    internal var activationEndpoint: String = BuildConfig.ACTIVATION_BASE_URL.trim()
    internal var savedPlaylistDeadlineMillis = 8_000L
    private lateinit var status: TextView
    private lateinit var deviceKind: DeviceClass.Kind
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrMessage: TextView
    private lateinit var qrView: ImageView
    private lateinit var trialView: ActivationStatusView
    private var trialSnapshot: ActivationDisplayState.Snapshot? = null
    private var trialTicker: Job? = null
    private lateinit var addPlaylist: Button
    private lateinit var connectButton: Button
    private lateinit var refreshCodeButton: Button
    private var playlistRow: LinearLayout? = null
    private var tvPrivacyButton: Button? = null
    private var connectJob: Job? = null
    private var playlistJob: Job? = null
    private var identityJob: Job? = null
    private var autoPairJob: Job? = null
    private var resolvedIdentity = false
    private var identityRendered = false
    private var lastQrUrl: String? = null
    private var renderedPlaylists: List<List<String>>? = null
    private var websiteRefreshButton: Button? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvLogin() else buildPhoneLogin())
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
        installWebsiteRefreshButton()
        renderCachedIdentity()
    }

    private fun buildTvLogin(): LinearLayout {
        createIdentityViews(false)
        val direction = resources.configuration.layoutDirection
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = direction
            setPadding(dp(32), dp(20), dp(32), dp(20))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        // Preserve the Xiaomi v74 logo asset but give it a high-contrast TV tile:
        // its original dark lettering disappears against the plum header.
        header.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = GradientDrawable().apply {
                setColor(0xFFF5F0FF.toInt())
                cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
            }
        }, LinearLayout.LayoutParams(dp(76), dp(66)).apply { marginEnd = dp(16) })
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(loginText(R.string.login_welcome_title, 24f, true))
            addView(loginText(R.string.login_welcome_hint, 12f))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        refreshCodeButton = actionButton(getString(R.string.refresh_from_website)) { requestIdentityRefresh(true) }.apply {
            textSize = 12f
            id = View.generateViewId()
        }
        header.addView(refreshCodeButton, LinearLayout.LayoutParams(dp(196), dp(44)).apply { marginStart = dp(16) })
        val privacyButton = accountButton().apply { id = View.generateViewId() }
        tvPrivacyButton = privacyButton
        header.addView(privacyButton, LinearLayout.LayoutParams(dp(176), dp(44)).apply { marginStart = dp(8) })
        root.addView(header, LinearLayout.LayoutParams(-1, dp(72)))

        val shortTv = resources.configuration.screenHeightDp <= 600
        val workspace = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            // Match the selected language; the English UI must not retain Arabic ordering.
            layoutDirection = direction
            clipChildren = false
            clipToPadding = false
        }
        val activation = LinearLayout(this).apply {
            tag = "blofy_login_activation_panel"
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL or (if (shortTv) Gravity.TOP else Gravity.CENTER_VERTICAL)
            setPadding(dp(18), dp(if (shortTv) 8 else 14), dp(18), dp(if (shortTv) 8 else 14))
            background = premiumPanelBackground(true)
        }
        activation.addView(TextView(this).apply {
            text = getString(R.string.brand_link)
            textSize = 10.5f
            letterSpacing = .14f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.CENTER
            background = BlofyTvDesign.badge(dp(12).toFloat())
            setPadding(dp(14), 0, dp(14), 0)
        }, LinearLayout.LayoutParams(-2, dp(if (shortTv) 22 else 28)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(if (shortTv) 2 else 6)
        })
        activation.addView(loginText(R.string.login_link_tv, if (shortTv) 18f else 20f, true).apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(-1, dp(if (shortTv) 26 else 30)))
        activation.addView(loginText(R.string.login_scan_hint, 12f).apply {
            visibility = if (shortTv) View.GONE else View.VISIBLE
            gravity = Gravity.CENTER
            maxLines = 2
        }, LinearLayout.LayoutParams(-1, dp(36)))
        val screenHeightDp = resources.configuration.screenHeightDp
        val qrSize = LoginLayoutSpec.tvQrSizeDp(screenHeightDp)
        activation.addView(qrPanel(), LinearLayout.LayoutParams(dp(qrSize), dp(qrSize)).apply {
            topMargin = dp(if (shortTv) 2 else 6)
            bottomMargin = dp(if (shortTv) 2 else 6)
        })
        activation.addView(trialView, LinearLayout.LayoutParams(-1, -2).apply {
            bottomMargin = dp(if (shortTv) 2 else 6)
        })
        // Device ID and pairing code have separate, equally styled surfaces: numbers stay legible
        // and neither can steal width from the other when the language is RTL.
        val identity = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = direction
        }
        fun identityField(labelId: Int, value: TextView, size: Float) = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = identityPanelBackground()
            setPadding(dp(6), dp(3), dp(6), dp(3))
            addView(loginText(labelId, 10f).apply {
                gravity = Gravity.CENTER
                setTextColor(BlofyTvDesign.TextMuted)
            }, LinearLayout.LayoutParams(-1, dp(16)))
            value.apply {
                textSize = size
                layoutDirection = View.LAYOUT_DIRECTION_LTR
                textDirection = View.TEXT_DIRECTION_LTR
                gravity = Gravity.CENTER
                setSingleLine(true)
                setPadding(0, 0, 0, 0)
            }
            addView(value, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        identity.addView(identityField(R.string.login_device_label, deviceView, 12f),
            LinearLayout.LayoutParams(0, -1, 1.5f).apply { marginEnd = dp(8) })
        identity.addView(identityField(R.string.login_pairing_label, codeView, if (shortTv) 21f else 24f),
            LinearLayout.LayoutParams(0, -1, 1f))
        activation.addView(identity, LinearLayout.LayoutParams(-1, dp(if (shortTv) 54 else 62)))
        activation.addView(View(this), LinearLayout.LayoutParams(1, dp(if (shortTv) 2 else 8)))
        status.apply {
            textSize = 11f
            maxLines = 2
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 0)
        }
        activation.addView(status, LinearLayout.LayoutParams(-1, dp(if (shortTv) 28 else 32)).apply {
            topMargin = dp(if (shortTv) 2 else 4)
        })

        val playlists = LinearLayout(this).apply {
            tag = "blofy_login_playlists_panel"
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(20))
            background = premiumPanelBackground(false)
            clipChildren = false
            clipToPadding = false
        }
        playlists.addView(loginText(R.string.login_your_playlists, 21f, true), LinearLayout.LayoutParams(-1, dp(32)))
        playlists.addView(loginText(R.string.login_playlists_hint, 13f).apply { maxLines = 2 }, LinearLayout.LayoutParams(-1, dp(42)))
        val scroll = ScrollView(this).apply {
            // Saved cards own focus; an empty scroll viewport must not consume a DPAD stop.
            isFocusable = false
            isFocusableInTouchMode = false
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
            setPadding(dp(4), dp(6), dp(4), dp(6))
        }
        playlistRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(subtitle(getString(R.string.login_loading_saved_playlists)), LinearLayout.LayoutParams(-1, dp(86)))
        }
        scroll.addView(playlistRow, FrameLayout.LayoutParams(-1, -2))
        playlists.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(12), 0, 0)
            clipChildren = false
            clipToPadding = false
        }
        addPlaylist = primaryActionButton(getString(R.string.login_add_playlist)) {
            startActivity(Intent(this@LoginActivity, PlaylistActivity::class.java))
        }.apply {
            textSize = 14f
            id = View.generateViewId()
        }
        connectButton = actionButton(getString(R.string.login_enter_blofy)) { startOrCancelConnect() }.apply {
            textSize = 14f
            id = View.generateViewId()
        }
        // Android TV 9 remotes must not jump to the QR (not focusable) or exit.
        // Explicitly connect the header and first action row in both directions.
        val rtl = direction == View.LAYOUT_DIRECTION_RTL
        refreshCodeButton.nextFocusDownId = addPlaylist.id
        privacyButton.nextFocusDownId = connectButton.id
        addPlaylist.nextFocusUpId = refreshCodeButton.id
        connectButton.nextFocusUpId = privacyButton.id
        if (rtl) {
            refreshCodeButton.nextFocusLeftId = privacyButton.id
            privacyButton.nextFocusRightId = refreshCodeButton.id
            addPlaylist.nextFocusLeftId = connectButton.id
            connectButton.nextFocusRightId = addPlaylist.id
        } else {
            refreshCodeButton.nextFocusRightId = privacyButton.id
            privacyButton.nextFocusLeftId = refreshCodeButton.id
            addPlaylist.nextFocusRightId = connectButton.id
            connectButton.nextFocusLeftId = addPlaylist.id
        }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(12) })
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        playlists.addView(actions)
        val activationWeight = LoginLayoutSpec.tvActivationWeight(resources.configuration.screenWidthDp)
        workspace.addView(activation, LinearLayout.LayoutParams(0, -1, activationWeight).apply { marginEnd = dp(14) })
        workspace.addView(playlists, LinearLayout.LayoutParams(0, -1, 1f - activationWeight))
        root.addView(workspace, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(16) })
        root.addView(loginText(R.string.login_remote_hint, 10f).apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(-1, dp(20)))
        return root
    }

    private fun loginText(labelId: Int, size: Float, heading: Boolean = false) = TextView(this).apply {
        setText(labelId)
        textSize = size
        typeface = if (heading) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
        setTextColor(if (heading) BlofyTvDesign.TextPrimary else BlofyTvDesign.TextSecondary)
        gravity = Gravity.START or Gravity.CENTER_VERTICAL
        includeFontPadding = false
    }

    private fun qrPanel() = FrameLayout(this).apply {
        tag = "blofy_login_qr_panel"
        background = qrFrameBackground()
        setPadding(dp(6), dp(6), dp(6), dp(6))
        elevation = dp(8).toFloat()
        addView(qrView, FrameLayout.LayoutParams(-1, -1))
        addView(qrMessage, FrameLayout.LayoutParams(-1, -1))
    }

    private fun buildPhoneLogin(): View {
        createIdentityViews(true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(150), dp(82)))
        root.addView(title("BLOFY PLAYER", 29f))
        root.addView(subtitle(getString(R.string.login_phone_subtitle)))
        deviceView.background = fieldBackground(); root.addView(deviceView, LinearLayout.LayoutParams(-1, dp(54)))
        codeView.background = premiumFieldBackground(true); root.addView(codeView, LinearLayout.LayoutParams(-1, dp(58)).apply { topMargin = dp(8) })
        val phoneQr = LoginLayoutSpec.phoneQrSizeDp(resources.configuration.screenWidthDp)
        root.addView(qrPanel(), LinearLayout.LayoutParams(dp(phoneQr), dp(phoneQr)).apply { topMargin = dp(14) })
        root.addView(trialView, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        status.background = statusBackground(); root.addView(status, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        root.addView(loginText(R.string.login_your_playlists, 18f, true), LinearLayout.LayoutParams(-1, dp(40)))
        playlistRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(subtitle(getString(R.string.login_loading_saved_playlists)), LinearLayout.LayoutParams(-1, dp(60)))
        }
        root.addView(playlistRow, LinearLayout.LayoutParams(-1, -2))
        addPlaylist = primaryActionButton(getString(R.string.login_add_manage_playlists_plain)) { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton(getString(R.string.login_enter)) { startOrCancelConnect() }
        refreshCodeButton = actionButton(getString(R.string.login_refresh)) { requestIdentityRefresh(fromWebsite = true) }
        root.addView(addPlaylist, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(12) })
        root.addView(connectButton, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(10) })
        root.addView(refreshCodeButton, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        root.addView(accountButton(), LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        return ScrollView(this).apply {
            isFillViewport = true
            addView(root, FrameLayout.LayoutParams(-1, -2))
        }
    }

    private fun accountButton() = actionButton(getString(R.string.account_title)) {
        startActivity(Intent(this, tv.blofy.player.ui.account.AccountActivity::class.java))
    }.apply { textSize = 12f; tag = "blofy_account_entry" }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply {
            text = getString(R.string.login_creating_identity)
            textSize = if (phone) 17f else 21f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
        }
        codeView = TextView(this).apply {
            textSize = if (phone) 25f else 34f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.CENTER
        }
        trialView = ActivationStatusView(this)
        qrView = ImageView(this).apply {
            contentDescription = getString(R.string.login_qr_description)
            visibility = View.INVISIBLE
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = qrBackground()
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        qrMessage = loginText(R.string.login_qr_loading, 12.5f).apply {
            gravity = Gravity.CENTER
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        status = TextView(this).apply {
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
    }

    private fun startOrCancelConnect() {
        if (connectJob?.isActive == true) { connectJob?.cancel(); status.setText(R.string.login_connection_cancelled); return }
        if (playlistJob?.isActive == true) return
        connectJob = lifecycleScope.launch {
            connectButton.setText(android.R.string.cancel)
            try {
                identityJob?.cancel()
                withTimeout(25_000L) { connectFlow() }
            } catch (_: TimeoutCancellationException) {
                status.text = getString(R.string.refresh_site_failed)
            } catch (_: CancellationException) {
                // User pressed Cancel or the Activity was destroyed.
            } catch (_: Exception) {
                status.text = getString(R.string.refresh_site_failed)
            } finally {
                connectButton.setText(R.string.login_enter_blofy)
                if (connectJob === coroutineContext[Job]) connectJob = null
            }
        }
    }

    private suspend fun connectFlow() {
        val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
        val endpoint = activationEndpoint
        val manager = ActivationManager(applicationContext, dao)
        val local = withTimeout(5_000L) {
            withContext(Dispatchers.IO) {
                manager.ensureIdentity() to dao.providers().first().firstOrNull()
            }
        }
        val localProvider = local.second
        // A fresh receiver has nothing to play yet. Enter must open registration, not wait
        // for activation/portal requests and leave the user on the same empty welcome screen.
        // Opening the form grants no playback access; submission and entry still check activation.
        if (localProvider == null) {
            openPlaylistManagement()
            return
        }
        if (tv.blofy.player.core.identity.BlofySubscriberClient.isLegacyProxy(localProvider, endpoint)) {
            status.setText(R.string.login_updating_subscriber_connection)
            PortalPlaylistClient.ensureSubscriberConnection(applicationContext, endpoint, dao, localProvider.id)
        }
        if ((endpoint.isBlank() || manager.cachedCanUse(local.first)) &&
            hasCachedCatalog(dao, localProvider.id)) {
            openHome()
            return
        }
        if (endpoint.isBlank()) {
            if (hasCachedCatalog(dao, localProvider.id)) openHome() else openCatalogLoading(localProvider.id)
            return
        }
        status.setText(R.string.login_checking_activation)
        val result = runSuspendCatching { withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME) } }
        if (result.isSuccess) {
            val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
            renderIdentity(identity.deviceId, identity.activationCode)
        }
        result.onSuccess { remote ->
            if (!remote.canUse()) { status.text = activationLabel(remote); return@onSuccess }
            if (hasCachedCatalog(dao, localProvider.id)) {
                openHome()
                return@onSuccess
            }
            // Enter uses the playlist the user selected locally. Website imports belong only
            // to the explicit refresh action, never to activation or an empty catalog.
            runSuspendCatching { PortalPlaylistClient.retryPendingDeletes(applicationContext, endpoint) }
            status.text = getString(R.string.login_preparing_playlist, localProvider.name)
            openCatalogLoading(localProvider.id)
        }.onFailure {
            val cached = withContext(Dispatchers.IO) { dao.activation() }
            val provider = dao.providers().first().firstOrNull()
            if (cached != null && manager.cachedCanUse(cached) && provider != null && hasCachedCatalog(dao, provider.id)) openHome()
            else status.setText(R.string.login_activation_check_failed)
        }
    }

    private fun selectPortalProvider(provider: ProviderEntity) {
        if (playlistJob?.isActive == true || connectJob?.isActive == true) return
        playlistJob = lifecycleScope.launch {
            try {
                identityJob?.cancel()
                withTimeout(25_000L) {
                    val endpoint = activationEndpoint
                    val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
                    val manager = ActivationManager(applicationContext, dao)
                    val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
                    if (endpoint.isNotBlank() && !manager.cachedCanUse(identity)) {
                        val remote = withContext(Dispatchers.IO) {
                            manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                        }
                        if (!remote.canUse()) { status.text = activationLabel(remote); return@withTimeout }
                    }
                    val latest = withContext(Dispatchers.IO) { dao.provider(provider.id) }
                    if (latest == null) { status.text = getString(R.string.refresh_site_failed); return@withTimeout }
                    status.text = getString(R.string.login_selecting_playlist, latest.name)
                    // The client serializes selection with explicit website refresh and mirrors it
                    // asynchronously. Do not immediately request another website list/profile here.
                    val selected = PortalPlaylistClient.selectProvider(applicationContext, endpoint, latest, dao)
                    if (hasCachedCatalog(dao, selected.id)) openHome()
                    else openCatalogLoading(selected.id)
                }
            } catch (_: TimeoutCancellationException) {
                status.text = getString(R.string.refresh_site_failed)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = getString(R.string.refresh_site_failed)
            } finally {
                if (playlistJob === coroutineContext[Job]) playlistJob = null
            }
        }
    }

    // Internal so Android TV instrumentation can verify real saved-card remote navigation.
    internal fun renderPortalPlaylists(allProviders: List<ProviderEntity>) {
        val providers = tv.blofy.player.core.identity.PortalSyncBook.visible(this, allProviders)
            .filter { it.providerType.equals("xtream", true) }
            .sortedWith(compareByDescending<ProviderEntity> { it.enabled }.thenByDescending { it.updatedAt })
        val row = playlistRow ?: return
        val presentation = providers.map { listOf(it.id, ProviderDisplayName.forUi(it), it.providerType, it.enabled.toString()) }
        if (presentation == renderedPlaylists) return
        renderedPlaylists = presentation
        val focusedId = (0 until row.childCount).map { row.getChildAt(it) }
            .firstOrNull { it.hasFocus() }?.tag as? String
        row.removeAllViews()
        if (providers.isEmpty()) {
            row.addView(emptyPlaylistView(getString(R.string.login_no_playlists)), LinearLayout.LayoutParams(-1, dp(86)))
            linkTvPlaylistDpad(emptyList())
            // Do not strand focus when the website removes the selected playlist.
            if (focusedId != null && deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
            return
        }
        providers.forEach { provider ->
            val cardHeight = if (deviceKind == DeviceClass.Kind.TV)
                LoginLayoutSpec.tvPlaylistRowHeightDp(resources.configuration.screenHeightDp) else 80
            row.addView(playlistCard(provider), LinearLayout.LayoutParams(-1, dp(cardHeight)).apply { bottomMargin = dp(9) })
        }
        val cards = (0 until row.childCount).map { row.getChildAt(it) }
        linkTvPlaylistDpad(cards)
        // Refreshes replace card views. Restore the selected card, or the nearest valid one.
        if (focusedId != null) (row.findViewWithTag<View>(focusedId) ?: cards.first()).requestFocus()
    }

    /** Explicit DPAD graph: header -> first list -> all saved lists -> bottom actions.
     * Android TV focus search may otherwise skip the ScrollView and jump straight to buttons.
     */
    private fun linkTvPlaylistDpad(cards: List<View>) {
        if (deviceKind != DeviceClass.Kind.TV) return
        val first = cards.firstOrNull()
        val last = cards.lastOrNull()
        refreshCodeButton.nextFocusDownId = first?.id ?: addPlaylist.id
        tvPrivacyButton?.nextFocusDownId = first?.id ?: connectButton.id
        addPlaylist.nextFocusUpId = last?.id ?: refreshCodeButton.id
        connectButton.nextFocusUpId = last?.id ?: (tvPrivacyButton?.id ?: refreshCodeButton.id)
        cards.forEachIndexed { index, card ->
            card.nextFocusUpId = cards.getOrNull(index - 1)?.id ?: refreshCodeButton.id
            card.nextFocusDownId = cards.getOrNull(index + 1)?.id ?: addPlaylist.id
        }
    }

    private fun playlistCard(provider: ProviderEntity) = LinearLayout(this).apply {
        tag = provider.id
        id = View.generateViewId() // Stable target for the current dynamic DPAD focus graph.
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = resources.configuration.layoutDirection
        setPadding(dp(17), dp(8), dp(17), dp(8))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = playlistCardBackground(provider.enabled, false)
        val type = if (provider.providerType.equals("xtream", true)) "Xtream" else "M3U"
        val displayName = ProviderDisplayName.forUi(provider).takeIf { it.length > 1 }
            ?: getString(R.string.login_playlist_default_name, type)
        val info = LinearLayout(this@LoginActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START }
        info.addView(TextView(this@LoginActivity).apply {
            text = displayName
            textSize = 16f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = 1
            gravity = Gravity.START
        })
        info.addView(TextView(this@LoginActivity).apply {
            text = if (provider.enabled) getString(R.string.login_active_playlist_type, type) else getString(R.string.login_playlist_press_ok, type)
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(if (provider.enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
            gravity = Gravity.START
        })
        addView(info, LinearLayout.LayoutParams(0, -1, 1f))
        addView(TextView(this@LoginActivity).apply {
            text = "▶"
            textSize = 18f
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.CENTER
            background = miniCircle()
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
        setOnFocusChangeListener { view, focused ->
            view.background = playlistCardBackground(provider.enabled, focused)
            view.animate().cancel()
            val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.018f) else 1f
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (focused) TvUiTuning.focusElevation(view.context, 15f) else 0f)
                .setDuration(TvUiTuning.focusDuration(view.context, focused))
                .start()
        }
        setOnClickListener { selectPortalProvider(provider) }
    }

    private fun emptyPlaylistView(message: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutDirection = resources.configuration.layoutDirection
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(18), 0, dp(18), 0)
        background = emptyBackground()
        addView(TextView(this@LoginActivity).apply {
            text = "＋"
            textSize = 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(54), -1))
        addView(LinearLayout(this@LoginActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            addView(TextView(this@LoginActivity).apply { text = getString(R.string.login_add_first_playlist); textSize = 14f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.START })
            addView(TextView(this@LoginActivity).apply { text = message; textSize = 11.5f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.START })
        }, LinearLayout.LayoutParams(0, -1, 1f))
    }

    private fun openCatalogLoading(providerId: String) {
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }

    private fun openPlaylistManagement() {
        startActivity(Intent(this, PlaylistActivity::class.java))
    }

    private fun renderCachedIdentity() {
        lifecycleScope.launch {
            // DeviceIdentity also protects synchronous durable writes and firmware binder reads.
            // Never wait for its monitor before drawing the first Login frame.
            val cached = try {
                withContext(Dispatchers.IO) {
                    DeviceIdentity.cachedIdentity(applicationContext) ?: run {
                        // Only a genuinely fresh installation may show a locally derived code
                        // before Room is ready. Existing databases are authoritative and must
                        // not be replaced by a newly invented credential.
                        val database = applicationContext.getDatabasePath("blofy-player-2.db")
                        if (database.exists()) null
                        else DeviceIdentity.deviceId(applicationContext) to DeviceIdentity.activationCode(applicationContext)
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
            // A late cache read must not replace an identity resolved/rotated by an explicit flow.
            if (cached != null && !resolvedIdentity) renderIdentity(cached.first, cached.second, cached = true)
        }
    }

    private fun requestIdentityRefresh(fromWebsite: Boolean = false) {
        if (identityJob?.isActive == true || connectJob?.isActive == true || playlistJob?.isActive == true) return
        identityJob = lifecycleScope.launch {
            // The playlist deadline is not an identity deadline. Slow SQLite catalog reads
            // must never cancel the 6-digit code / Device ID recovery task.
            val cardsDeadline = lifecycleScope.launch {
                delay(savedPlaylistDeadlineMillis)
                if (renderedPlaylists == null) renderPlaylistLoadFailure()
            }
            try {
                if (fromWebsite) {
                    websiteRefreshButton?.isEnabled = false
                    websiteRefreshButton?.setText(R.string.refreshing_from_website)
                }
                withTimeout(if (fromWebsite) 40_000L else 20_000L) { refreshIdentityAndProvider(fromWebsite) }
            } catch (error: TimeoutCancellationException) {
                status.text = PortalRefreshFeedback.failure(this@LoginActivity, error)
                renderPlaylistLoadFailure()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                status.text = PortalRefreshFeedback.failure(this@LoginActivity, error)
                renderPlaylistLoadFailure()
            } finally {
                cardsDeadline.cancel()
                websiteRefreshButton?.isEnabled = true
                websiteRefreshButton?.setText(R.string.refresh_from_website)
                if (identityJob === coroutineContext[Job]) identityJob = null
            }
        }
    }

    private suspend fun refreshIdentityAndProvider(fromWebsite: Boolean) {
        val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
        val manager = ActivationManager(applicationContext, dao)
        // Device ID and pairing code are independent of IPTV catalog size, stored playlist
        // rows, host credentials and website availability. Always display them first.
        val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
        renderIdentity(identity.deviceId, identity.activationCode)
        bindTrialStatus(identity)

        // A busy or malformed playlist table must not hide a valid activation code.
        val local = try {
            withContext(Dispatchers.IO) { dao.providerSnapshotStored() }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            renderPlaylistLoadFailure()
            null
        }
        if (local != null) {
            renderPortalPlaylists(local)
            val active = local.firstOrNull { it.enabled }
            status.text = if (active == null) getString(R.string.login_waiting_for_playlist)
                else getString(R.string.login_ready_provider, ProviderDisplayName.forUi(active))
        }
        if (!fromWebsite) return
        val endpoint = activationEndpoint
        if (endpoint.isBlank()) { status.setText(R.string.refresh_site_missing); return }
        val remote = try { withContext(Dispatchers.IO) {
            manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
        } } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { throw PortalRefreshFailure("AUTH", cause = error) }
        val updatedIdentity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
        renderIdentity(updatedIdentity.deviceId, updatedIdentity.activationCode)
        bindTrialStatus(updatedIdentity)
        status.text = activationLabel(remote)
        if (!remote.canUse()) return
        val sync = PortalPlaylistClient.sync(applicationContext, endpoint, dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        renderPortalPlaylists(sync.providers)
        status.text = PortalRefreshFeedback.result(this, sync)
        // Optional hints cannot turn a saved playlist refresh into a failure.
        sync.activeProvider?.let { provider -> lifecycleScope.launch {
            runSuspendCatching { applyRemoteProviderProfile(endpoint, dao, provider.id) }
        } }
        // A website refresh updates data only. Entering a playlist is an explicit user action.
    }

    private fun renderPlaylistLoadFailure() {
        if (renderedPlaylists != null || isFinishing || isDestroyed) return
        status.setText(R.string.login_saved_playlists_failed)
        val row = playlistRow ?: return
        row.removeAllViews()
        row.addView(subtitle(getString(R.string.login_saved_playlists_failed)), LinearLayout.LayoutParams(-1, -2))
        row.addView(actionButton(getString(R.string.catalog_retry)) { requestIdentityRefresh() },
            LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(12) })
    }

    /** Keep refresh in the layout flow so it cannot cover headings or the QR code. */
    private fun installWebsiteRefreshButton() {
        websiteRefreshButton = refreshCodeButton.apply { tag = "blofy_login_portal_refresh" }
    }

    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean = withContext(Dispatchers.IO) {
        CatalogSyncState.isEntryReady(applicationContext, providerId) && dao.hasStreamsForProvider(providerId)
    }

    private suspend fun <T> runSuspendCatching(block: suspend () -> T): Result<T> = try { Result.success(block()) }
    catch (c: CancellationException) { throw c }
    catch (e: Throwable) { Result.failure(e) }

    private suspend fun renderIdentity(deviceId: String, activationCode: String, cached: Boolean = false) {
        if (!cached) resolvedIdentity = true
        identityRendered = true
        deviceView.text = deviceId
        codeView.text = activationCode
        val url = ActivationPortalUrl.create(activationEndpoint, deviceId, activationCode)
        if (url == null) {
            lastQrUrl = null
            qrView.setImageDrawable(null)
            qrView.visibility = View.INVISIBLE
            qrMessage.setText(R.string.login_qr_unavailable)
            qrMessage.visibility = View.VISIBLE
            return
        }
        if (lastQrUrl == url && qrView.drawable != null) return
        val bitmap = try {
            withContext(Dispatchers.Default) { createQr(url) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            lastQrUrl = null
            qrView.setImageDrawable(null)
            qrView.visibility = View.INVISIBLE
            qrMessage.setText(R.string.login_qr_unavailable)
            qrMessage.visibility = View.VISIBLE
            return
        }
        if (deviceView.text.toString() != deviceId || codeView.text.toString() != activationCode ||
            ActivationPortalUrl.create(activationEndpoint, deviceId, activationCode) != url) return
        qrView.setImageBitmap(bitmap)
        qrView.visibility = View.VISIBLE
        qrMessage.visibility = View.GONE
        // Cache only a rendered URL. A cancelled render or missing endpoint must remain retryable.
        lastQrUrl = url
    }

    internal suspend fun applyRemoteProviderProfile(endpoint: String, dao: BlofyDao, providerId: String) {
        val current = dao.provider(providerId) ?: return
        val remoteId = PortalSyncBook.remoteId(applicationContext, providerId)
        val updated = RemoteProviderProfileClient.applyIfAvailable(applicationContext, endpoint, current)
        if (updated != current) PortalPlaylistClient.mergeProviderProfile(applicationContext, dao, current, remoteId, updated)
    }

    private fun bindTrialStatus(identity: tv.blofy.player.data.local.ActivationEntity) {
        trialSnapshot = ActivationDisplayState.read(applicationContext, identity)
        trialView.render(trialSnapshot)
    }

    private fun activationLabel(remote: ActivationCheckResponse) = when (remote.state()) {
        ActivationCheckResponse.State.TRIAL -> getString(R.string.login_trial_active)
        ActivationCheckResponse.State.ACTIVE -> getString(R.string.login_device_active)
        ActivationCheckResponse.State.EXPIRED -> getString(R.string.login_device_expired)
        ActivationCheckResponse.State.BLOCKED -> getString(R.string.login_device_blocked)
        ActivationCheckResponse.State.UNKNOWN -> remote.message ?: getString(R.string.login_activation_unknown)
    }

    private fun openHome() { startActivity(Intent(this, HomeActivity::class.java)); finish() }

    /**
     * TV pairing should complete without asking the customer to press Refresh or Enter.
     * The QR and six-digit code are generated locally before any network call. While
     * Login is visible, a bounded, cancellable check watches for server-approved
     * activation. Once approved, only the server's playlists are pulled and the
     * selected provider opens automatically. No entitlement is granted locally.
     *
     * Uses coroutine delays (monotonic scheduling), not the TV wall clock, and does
     * not require changing the device language, clock or TLS trust configuration.
     */
    private fun startAutoPairing() {
        val endpoint = activationEndpoint
        if (endpoint.isBlank()) return
        autoPairJob?.cancel()
        autoPairJob = lifecycleScope.launch {
            delay(2_500L)
            val dao = try {
                withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { return@launch }
            val manager = ActivationManager(applicationContext, dao)
            val api = ActivationRemoteClient.create(endpoint)
            var failures = 0
            var lastIssue: ActivationConnectionDiagnostics.Issue? = null
            while (isActive && !isFinishing && !isDestroyed) {
                var stage = ActivationConnectionDiagnostics.Stage.VERIFICATION
                var retryIssue: ActivationConnectionDiagnostics.Issue? = null
                // Do not race an explicit refresh, provider selection or connect action.
                if (identityJob?.isActive == true || connectJob?.isActive == true || playlistJob?.isActive == true) {
                    delay(1_500L)
                    continue
                }
                try {
                    val remote = withContext(Dispatchers.IO) {
                        // Optional legacy-device migration may take a separate bounded call.
                        withTimeout(60_000L) { manager.refresh(api, BuildConfig.VERSION_NAME) }
                    }
                    val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
                    renderIdentity(identity.deviceId, identity.activationCode)
                    bindTrialStatus(identity)
                    if (remote.canUse()) {
                        // Paid and trial devices both use the same server-approved pairing flow.
                        status.text = activationLabel(remote)
                        // PULL_ONLY avoids uploading or removing customers' local playlists.
                        stage = ActivationConnectionDiagnostics.Stage.PLAYLIST_SYNC
                        val synced = withContext(Dispatchers.IO) {
                            withTimeout(24_000L) {
                                PortalPlaylistClient.sync(
                                    applicationContext, endpoint, dao, PortalPlaylistClient.SyncMode.PULL_ONLY
                                )
                            }
                        }
                        renderPortalPlaylists(synced.providers)
                        failures = 0
                        lastIssue = null
                        val provider = synced.activeProvider
                        if (provider != null && !isFinishing && !isDestroyed) {
                            if (hasCachedCatalog(dao, provider.id)) openHome()
                            else openCatalogLoading(provider.id)
                            return@launch
                        }
                        status.setText(R.string.login_waiting_for_playlist)
                    } else {
                        // A server response is authoritative, including waiting, blocked or expired.
                        failures = 0
                        lastIssue = null
                        if (remote.state() == ActivationCheckResponse.State.EXPIRED ||
                            remote.state() == ActivationCheckResponse.State.BLOCKED) {
                            status.text = activationLabel(remote)
                        }
                    }
                } catch (timeout: TimeoutCancellationException) {
                    failures++
                    retryIssue = if (stage == ActivationConnectionDiagnostics.Stage.PLAYLIST_SYNC)
                        ActivationConnectionDiagnostics.Issue.PLAYLIST
                    else ActivationConnectionDiagnostics.Issue.TIMEOUT
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    // No URL, code, token, server message or credential is sent to diagnostics.
                    // A failed check never changes the cached activation or hides the QR.
                    failures++
                    retryIssue = ActivationConnectionDiagnostics.classify(error, stage)
                }
                if (retryIssue != null) {
                    val issue = retryIssue
                    if (failures == 1 || issue != lastIssue) {
                        status.text = getString(
                            if (stage == ActivationConnectionDiagnostics.Stage.PLAYLIST_SYNC)
                                R.string.login_auto_retry_playlists
                            else R.string.login_auto_retry_verification,
                            issue.code
                        )
                    }
                    lastIssue = issue
                }
                delay(ActivationConnectionDiagnostics.retryDelayMs(failures, retryIssue))
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) {
            requestIdentityRefresh()
            startAutoPairing()
        }
        trialTicker?.cancel()
        trialTicker = lifecycleScope.launch {
            while (true) {
                if (::trialView.isInitialized) trialView.render(trialSnapshot)
                delay(30_000L)
            }
        }
    }

    override fun onPause() {
        autoPairJob?.cancel()
        autoPairJob = null
        identityJob?.cancel()
        trialTicker?.cancel()
        super.onPause()
    }

    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        val pixels = IntArray(matrix.width * matrix.height) { index ->
            if (matrix[index % matrix.width, index / matrix.width]) Color.BLACK else Color.WHITE
        }
        return Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.RGB_565)
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14.5f
        typeface = BlofyTvDesign.BodyTypeface
        gravity = Gravity.CENTER
        setTextColor(BlofyTvDesign.TextPrimary)
        if (deviceKind == DeviceClass.Kind.TV) BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.022f, false)
        else background = BlofyTvDesign.secondaryButton(dp(16).toFloat(), false)
        setOnClickListener { action() }
    }

    private fun primaryActionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = BlofyTvDesign.HeadingTypeface
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        if (deviceKind == DeviceClass.Kind.TV) BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.025f, true)
        else background = BlofyTvDesign.primaryButton(dp(16).toFloat(), false)
        setOnClickListener { action() }
    }

    private fun title(value: String, size: Float) = TextView(this).apply {
        text = value
        textSize = size
        typeface = BlofyTvDesign.HeadingTypeface
        setTextColor(BlofyTvDesign.TextPrimary)
        gravity = Gravity.CENTER
    }

    private fun subtitle(value: String) = TextView(this).apply {
        text = value
        textSize = 16f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(BlofyTvDesign.PurpleSoft)
        gravity = Gravity.CENTER
        setPadding(0, dp(8), 0, dp(16))
    }

    private fun premiumPanelBackground(accent: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (accent) intArrayOf(0xFF3A2252.toInt(), 0xFF21142F.toInt(), 0xFF120D1A.toInt())
        else intArrayOf(0xFF2B1C3C.toInt(), 0xFF1A1225.toInt(), 0xFF100C17.toInt())
    ).apply {
        cornerRadius = dp(BlofyTvDesign.PanelRadius).toFloat()
        setStroke(dp(1), if (accent) 0xFF8A5EB3.toInt() else 0xFF5A426D.toInt())
    }

    private fun premiumFieldBackground(accent: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (accent) intArrayOf(0xFF261533.toInt(), 0xFF1A1225.toInt()) else intArrayOf(0xFF1D1529.toInt(), 0xFF15101E.toInt())
    ).apply {
        cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
        setStroke(if (accent) dp(2) else dp(1), if (accent) 0xFF8051B0.toInt() else 0xFF543D68.toInt())
    }

    private fun fieldBackground() = GradientDrawable().apply {
        cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
        setColor(0xFF1B1428.toInt())
        setStroke(dp(1), 0xFF503C65.toInt())
    }

    private fun statusBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF251A33.toInt(), 0xFF191220.toInt())).apply {
        cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
        setStroke(dp(1), 0xFF65477C.toInt())
    }

    private fun qrBackground() = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(Color.WHITE)
    }

    private fun qrFrameBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFFB987F3.toInt(), 0xFF7041B4.toInt(), 0xFF2B193E.toInt())
    ).apply {
        cornerRadius = dp(BlofyTvDesign.PanelRadius).toFloat()
        setStroke(dp(1), BlofyTvDesign.FocusStroke)
    }

    private fun identityPanelBackground() = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xD921142E.toInt(), 0xE5160F20.toInt())
    ).apply {
        cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
        setStroke(dp(1), 0xFF735394.toInt())
    }

    private fun miniCircle() = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0xFF2C1B3C.toInt())
        setStroke(dp(1), 0xFF7650A2.toInt())
    }

    private fun emptyBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF21172E.toInt(), 0xFF17101F.toInt())).apply {
        cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
        setStroke(dp(1), 0xFF503A63.toInt())
    }

    private fun playlistCardBackground(active: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            focused -> intArrayOf(0xFF7E42C8.toInt(), 0xFF48266E.toInt(), 0xFF2C183F.toInt())
            active -> intArrayOf(0xFF2E2542.toInt(), 0xFF20192F.toInt())
            else -> intArrayOf(0xFF241931.toInt(), 0xFF17111F.toInt())
        }
    ).apply {
        cornerRadius = dp(BlofyTvDesign.CardRadius).toFloat()
        setStroke(if (focused) dp(2) else dp(1), when { focused -> BlofyTvDesign.FocusStroke; active -> 0xFF715A89.toInt(); else -> 0xFF49375E.toInt() })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
