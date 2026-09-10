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
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationPortalUrl
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.core.provider.RemoteProviderProfileClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    // Tests point requests at MockWebServer; production always starts from the signed build config.
    internal var activationEndpoint: String = BuildConfig.ACTIVATION_BASE_URL.trim()
    private lateinit var status: TextView
    private lateinit var deviceKind: DeviceClass.Kind
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrMessage: TextView
    private lateinit var qrView: ImageView
    private lateinit var addPlaylist: Button
    private lateinit var connectButton: Button
    private lateinit var refreshCodeButton: Button
    private var playlistRow: LinearLayout? = null
    private var connectJob: Job? = null
    private var playlistJob: Job? = null
    private var identityJob: Job? = null
    private var lastQrUrl: String? = null
    private var renderedPlaylists: List<List<String>>? = null
    private var websiteRefreshButton: Button? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvLogin() else buildPhoneLogin())
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
        installWebsiteRefreshButton()
        renderCachedIdentityImmediately()
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
        header.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, LinearLayout.LayoutParams(dp(78), dp(50)).apply { marginEnd = dp(16) })
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(loginText(R.string.login_welcome_title, 24f, true))
            addView(loginText(R.string.login_welcome_hint, 12f))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        refreshCodeButton = actionButton(getString(R.string.refresh_from_website)) { requestIdentityRefresh(true) }.apply {
            textSize = 12f
        }
        header.addView(refreshCodeButton, LinearLayout.LayoutParams(dp(196), dp(44)).apply { marginStart = dp(16) })
        root.addView(header, LinearLayout.LayoutParams(-1, dp(56)))

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
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = premiumPanelBackground(false)
        }
        activation.addView(loginText(R.string.login_link_tv, 19f, true).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(-1, dp(28)))
        activation.addView(loginText(R.string.login_scan_hint, 12f).apply {
            gravity = Gravity.CENTER
            maxLines = 2
        }, LinearLayout.LayoutParams(-1, dp(36)))
        val qrSize = (resources.configuration.screenHeightDp - 360).coerceIn(112, 180)
        activation.addView(qrPanel(), LinearLayout.LayoutParams(dp(qrSize), dp(qrSize)).apply {
            topMargin = dp(8)
            bottomMargin = dp(8)
        })
        val identity = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = premiumFieldBackground(false)
            setPadding(dp(10), dp(5), dp(10), dp(5))
        }
        fun identityField(labelId: Int, value: TextView, size: Float) = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(loginText(labelId, 10f).apply { gravity = Gravity.CENTER })
            value.apply {
                textSize = size
                layoutDirection = View.LAYOUT_DIRECTION_LTR
                textDirection = View.TEXT_DIRECTION_LTR
                gravity = Gravity.CENTER
                setSingleLine(true)
                setPadding(0, 0, 0, 0)
            }
            addView(value, LinearLayout.LayoutParams(-1, dp(30)))
        }
        identity.addView(identityField(R.string.login_device_label, deviceView, 12f), LinearLayout.LayoutParams(0, -1, 1.8f))
        identity.addView(identityField(R.string.login_pairing_label, codeView, 20f), LinearLayout.LayoutParams(0, -1, 1f))
        activation.addView(identity, LinearLayout.LayoutParams(-1, dp(56)))
        activation.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        status.apply {
            textSize = 11f
            maxLines = 2
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 0)
        }
        activation.addView(status, LinearLayout.LayoutParams(-1, dp(32)).apply { topMargin = dp(6) })

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
        }.apply { textSize = 14f }
        connectButton = actionButton(getString(R.string.login_enter_blofy)) { startOrCancelConnect() }.apply { textSize = 14f }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(12) })
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        playlists.addView(actions)
        workspace.addView(activation, LinearLayout.LayoutParams(0, -1, .38f).apply { marginEnd = dp(18) })
        workspace.addView(playlists, LinearLayout.LayoutParams(0, -1, .62f))
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
        background = qrBackground()
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
        root.addView(subtitle("فعّل جهازك ثم اختر قائمة التشغيل"))
        deviceView.background = fieldBackground(); root.addView(deviceView, LinearLayout.LayoutParams(-1, dp(54)))
        codeView.background = premiumFieldBackground(true); root.addView(codeView, LinearLayout.LayoutParams(-1, dp(58)).apply { topMargin = dp(8) })
        root.addView(qrPanel(), LinearLayout.LayoutParams(dp(180), dp(180)).apply { topMargin = dp(12) })
        status.background = statusBackground(); root.addView(status, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        addPlaylist = primaryActionButton("إضافة / إدارة القوائم") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("دخول") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث") { requestIdentityRefresh(fromWebsite = true) }
        root.addView(addPlaylist, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(12) })
        root.addView(connectButton, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(10) })
        root.addView(refreshCodeButton, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        return ScrollView(this).apply {
            isFillViewport = true
            addView(root, FrameLayout.LayoutParams(-1, -2))
        }
    }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply {
            text = "جاري إنشاء هوية الجهاز..."
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
        qrView = ImageView(this).apply {
            contentDescription = getString(R.string.login_qr_description)
            visibility = View.INVISIBLE
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = qrBackground()
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        qrMessage = loginText(R.string.login_qr_loading, 12f).apply {
            gravity = Gravity.CENTER
            setTextColor(0xFF43364F.toInt())
            setPadding(dp(12), dp(12), dp(12), dp(12))
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
        if (connectJob?.isActive == true) { connectJob?.cancel(); status.text = "تم إلغاء الاتصال"; return }
        if (playlistJob?.isActive == true) return
        connectJob = lifecycleScope.launch {
            connectButton.text = "إلغاء"
            try {
                identityJob?.cancelAndJoin()
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
        if (localProvider != null && tv.blofy.player.core.identity.BlofySubscriberClient.isLegacyProxy(localProvider, endpoint)) {
            status.text = "جاري تحديث اتصال مشترك BLOFY..."
            PortalPlaylistClient.ensureSubscriberConnection(applicationContext, endpoint, dao, localProvider.id)
        }
        if (localProvider != null && (endpoint.isBlank() || manager.cachedCanUse(local.first)) &&
            hasCachedCatalog(dao, localProvider.id)) {
            openHome()
            return
        }
        if (endpoint.isBlank()) {
            if (localProvider == null) { status.text = "أضف قائمة تشغيل أولاً"; return }
            if (hasCachedCatalog(dao, localProvider.id)) openHome() else openCatalogLoading(localProvider.id)
            return
        }
        status.text = "جاري التحقق من تفعيل الجهاز..."
        val result = runSuspendCatching { withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME) } }
        if (result.isSuccess) {
            val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
            renderIdentity(identity.deviceId, identity.activationCode)
        }
        result.onSuccess { remote ->
            if (!remote.canUse()) { status.text = activationLabel(remote); return@onSuccess }
            if (localProvider != null && hasCachedCatalog(dao, localProvider.id)) {
                openHome()
                return@onSuccess
            }
            val portalSync = runSuspendCatching { PortalPlaylistClient.sync(applicationContext, endpoint, dao) }.getOrNull()
            renderPortalPlaylists(portalSync?.providers ?: withContext(Dispatchers.IO) { dao.allProvidersStored().first() })
            val activeProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull()
            if (activeProvider == null) { status.text = "الجهاز مفعل • أضف قائمة"; addPlaylist.requestFocus(); return@onSuccess }
            val ready = hasCachedCatalog(dao, activeProvider.id)
            val changed = portalSync?.changedProviderIds?.contains(activeProvider.id) == true
            if (changed || !ready) { status.text = "جاري تجهيز ${activeProvider.name}"; openCatalogLoading(activeProvider.id); return@onSuccess }
            openHome()
        }.onFailure {
            val cached = withContext(Dispatchers.IO) { dao.activation() }
            val provider = dao.providers().first().firstOrNull()
            if (cached != null && manager.cachedCanUse(cached) && provider != null && hasCachedCatalog(dao, provider.id)) openHome()
            else status.text = "تعذر التحقق من التفعيل"
        }
    }

    private fun selectPortalProvider(provider: ProviderEntity) {
        if (playlistJob?.isActive == true || connectJob?.isActive == true) return
        playlistJob = lifecycleScope.launch {
            try {
                identityJob?.cancelAndJoin()
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
                    status.text = "جاري اختيار ${latest.name}..."
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

    private fun renderPortalPlaylists(allProviders: List<ProviderEntity>) {
        val providers = tv.blofy.player.core.identity.PortalSyncBook.visible(this, allProviders)
            .filter { it.providerType.equals("xtream", true) }
            .sortedWith(compareByDescending<ProviderEntity> { it.enabled }.thenByDescending { it.updatedAt })
        val row = playlistRow ?: return
        val presentation = providers.map { listOf(it.id, it.name, it.providerType, it.enabled.toString()) }
        if (presentation == renderedPlaylists) return
        renderedPlaylists = presentation
        val focusedId = (0 until row.childCount).map { row.getChildAt(it) }
            .firstOrNull { it.hasFocus() }?.tag as? String
        row.removeAllViews()
        if (providers.isEmpty()) {
            row.addView(emptyPlaylistView("ما عندك قوائم إلى الآن • اضغط إضافة / إدارة"), LinearLayout.LayoutParams(-1, dp(86)))
            return
        }
        providers.forEach { provider ->
            row.addView(playlistCard(provider), LinearLayout.LayoutParams(-1, dp(80)).apply { bottomMargin = dp(9) })
        }
        if (focusedId != null) row.findViewWithTag<View>(focusedId)?.requestFocus()
    }

    private fun playlistCard(provider: ProviderEntity) = LinearLayout(this).apply {
        tag = provider.id
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(17), dp(8), dp(17), dp(8))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = playlistCardBackground(provider.enabled, false)
        val info = LinearLayout(this@LoginActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START }
        info.addView(TextView(this@LoginActivity).apply {
            text = provider.name
            textSize = 16f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = 1
            gravity = Gravity.START
        })
        info.addView(TextView(this@LoginActivity).apply {
            val type = if (provider.providerType.equals("xtream", true)) "Xtream" else "M3U"
            text = if (provider.enabled) "● القائمة النشطة   •   $type" else "$type   •   اضغط OK للدخول"
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
            view.animate().scaleX(if (focused) 1.018f else 1f).scaleY(if (focused) 1.018f else 1f).translationZ(if (focused) 15f else 2f).setDuration(95).start()
        }
        setOnClickListener { selectPortalProvider(provider) }
    }

    private fun emptyPlaylistView(message: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
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
            addView(TextView(this@LoginActivity).apply { text = "ابدأ بإضافة أول قائمة"; textSize = 14f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.START })
            addView(TextView(this@LoginActivity).apply { text = message; textSize = 11.5f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.START })
        }, LinearLayout.LayoutParams(0, -1, 1f))
    }

    private fun openCatalogLoading(providerId: String) {
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }

    private fun renderCachedIdentityImmediately() {
        val cached = DeviceIdentity.cachedIdentity(applicationContext) ?: return
        deviceView.text = cached.first
        codeView.text = cached.second
        status.setText(R.string.login_loading_saved_playlists)
        lifecycleScope.launch { renderIdentity(cached.first, cached.second) }
    }

    private fun requestIdentityRefresh(fromWebsite: Boolean = false) {
        if (identityJob?.isActive == true || connectJob?.isActive == true || playlistJob?.isActive == true) return
        identityJob = lifecycleScope.launch {
            try {
                if (fromWebsite) {
                    websiteRefreshButton?.isEnabled = false
                    websiteRefreshButton?.setText(R.string.refreshing_from_website)
                }
                withTimeout(20_000L) { refreshIdentityAndProvider(fromWebsite) }
            } catch (_: TimeoutCancellationException) {
                status.text = getString(R.string.refresh_site_failed)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = getString(R.string.refresh_site_failed)
            } finally {
                websiteRefreshButton?.isEnabled = true
                websiteRefreshButton?.setText(R.string.refresh_from_website)
                if (identityJob === coroutineContext[Job]) identityJob = null
            }
        }
    }

    private suspend fun refreshIdentityAndProvider(fromWebsite: Boolean) {
        val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
        val manager = ActivationManager(applicationContext, dao)
        val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
        renderIdentity(identity.deviceId, identity.activationCode)
        // Identity and card labels do not use transport secrets. A slow TV Keystore must not
        // hold the initial screen here; selection/connect resolves the chosen provider later.
        val local = withContext(Dispatchers.IO) { dao.allProvidersStored().first() }
        renderPortalPlaylists(local)
        val active = local.firstOrNull { it.enabled }
        status.text = if (active == null) "في انتظار إضافة قائمة" else "● جاهز • ${active.name}"
        if (!fromWebsite) return
        val endpoint = activationEndpoint
        if (endpoint.isBlank()) { status.setText(R.string.refresh_site_missing); return }
        val remote = withContext(Dispatchers.IO) {
            manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
        }
        val updatedIdentity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
        renderIdentity(updatedIdentity.deviceId, updatedIdentity.activationCode)
        status.text = activationLabel(remote)
        if (!remote.canUse()) return
        val sync = PortalPlaylistClient.sync(applicationContext, endpoint, dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        renderPortalPlaylists(sync.providers)
        sync.activeProvider?.let { applyRemoteProviderProfile(endpoint, dao, it.id) }
        // A website refresh updates data only. Entering a playlist is an explicit user action.
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

    private suspend fun renderIdentity(deviceId: String, activationCode: String) {
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
        val bitmap = withContext(Dispatchers.Default) { createQr(url) }
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

    private fun activationLabel(remote: ActivationCheckResponse) = when (remote.state()) {
        ActivationCheckResponse.State.TRIAL -> "● الفترة التجريبية فعالة"
        ActivationCheckResponse.State.ACTIVE -> "● الجهاز مفعل وجاهز"
        ActivationCheckResponse.State.EXPIRED -> "انتهت صلاحية الجهاز"
        ActivationCheckResponse.State.BLOCKED -> "الجهاز موقوف"
        ActivationCheckResponse.State.UNKNOWN -> remote.message ?: "حالة التفعيل غير معروفة"
    }

    private fun openHome() { startActivity(Intent(this, HomeActivity::class.java)); finish() }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) requestIdentityRefresh()
    }

    override fun onPause() {
        identityJob?.cancel()
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
        cornerRadius = dp(26).toFloat()
        setStroke(dp(1), if (accent) 0xFF8A5EB3.toInt() else 0xFF5A426D.toInt())
    }

    private fun premiumFieldBackground(accent: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (accent) intArrayOf(0xFF261533.toInt(), 0xFF1A1225.toInt()) else intArrayOf(0xFF1D1529.toInt(), 0xFF15101E.toInt())
    ).apply {
        cornerRadius = dp(14).toFloat()
        setStroke(if (accent) dp(2) else dp(1), if (accent) 0xFF8051B0.toInt() else 0xFF543D68.toInt())
    }

    private fun fieldBackground() = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(0xFF1B1428.toInt())
        setStroke(dp(1), 0xFF503C65.toInt())
    }

    private fun statusBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF251A33.toInt(), 0xFF191220.toInt())).apply {
        cornerRadius = dp(14).toFloat()
        setStroke(dp(1), 0xFF65477C.toInt())
    }

    private fun qrBackground() = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        setColor(Color.WHITE)
    }

    private fun miniCircle() = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0xFF2C1B3C.toInt())
        setStroke(dp(1), 0xFF7650A2.toInt())
    }

    private fun emptyBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF21172E.toInt(), 0xFF17101F.toInt())).apply {
        cornerRadius = dp(17).toFloat()
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
        cornerRadius = dp(17).toFloat()
        setStroke(if (focused) dp(2) else dp(1), when { focused -> BlofyTvDesign.PurpleBright; active -> 0xFF715A89.toInt(); else -> 0xFF49375E.toInt() })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
