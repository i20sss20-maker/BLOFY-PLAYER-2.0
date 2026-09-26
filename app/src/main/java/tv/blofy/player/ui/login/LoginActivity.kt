package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationPortalUrl
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.provider.RemoteProviderProfileClient
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrView: ImageView
    private lateinit var addPlaylist: Button
    private lateinit var connectButton: Button
    private lateinit var refreshCodeButton: Button
    private var playlistRow: LinearLayout? = null
    private var connectJob: Job? = null
    private var playlistJob: Job? = null
    private var pairingWatcherJob: Job? = null
    private var renderedQrUrl: String? = null
    private var renderedProviders: List<ProviderEntity> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildApprovedTvLogin() else buildPhoneLogin())
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
    }

    private fun buildApprovedTvLogin(): LinearLayout {
        createIdentityViews(false)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(42), dp(16), dp(42), dp(18))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        header.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(112), dp(70)))
        val headerText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        headerText.addView(TextView(this).apply { text = "BLOFY PLAYER"; textSize = 13f; letterSpacing = .12f; setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.RIGHT })
        headerText.addView(TextView(this).apply { text = "جاهز للمشاهدة"; textSize = 30f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.RIGHT; includeFontPadding = false })
        headerText.addView(TextView(this).apply { text = "فعّل الجهاز من اليسار، وأدر قوائمك واتصل بها من اليمين"; textSize = 14.5f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT })
        header.addView(headerText, LinearLayout.LayoutParams(0, dp(76), 1f).apply { marginEnd = dp(12) })
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(80)))

        val workspace = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER
            clipChildren = false
        }

        val activation = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(18), dp(24), dp(18))
            background = panelBackground()
        }
        activation.addView(TextView(this).apply { text = "تفعيل الجهاز"; textSize = 21f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.CENTER })
        activation.addView(TextView(this).apply { text = "امسح QR بالجوال — الربط يتحدث تلقائيًا على هذه الشاشة"; textSize = 12.5f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER; setPadding(0, dp(4), 0, dp(10)) })
        activation.addView(qrView, LinearLayout.LayoutParams(dp(216), dp(216)))
        activation.addView(pairingLinkHint(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)).apply { topMargin = dp(6) })
        activation.addView(label("رقم الجهاز"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)).apply { topMargin = dp(10) })
        deviceView.apply { textSize = 18f; gravity = Gravity.CENTER; setPadding(dp(12),0,dp(12),0); background = fieldBackground() }
        activation.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)))
        activation.addView(label("رمز الربط"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)).apply { topMargin = dp(8) })
        codeView.apply { textSize = 30f; letterSpacing = .16f; gravity = Gravity.CENTER; setTextColor(BlofyTvDesign.TextPrimary); background = fieldBackground() }
        activation.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)))
        status.apply { textSize = 13f; gravity = Gravity.CENTER; setTextColor(BlofyTvDesign.TextSecondary); background = statusBackground(); setPadding(dp(12),0,dp(12),0) }
        activation.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply { topMargin = dp(10) })
        refreshCodeButton = actionButton("↻  فحص الآن") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        activation.addView(refreshCodeButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(10) })

        val playlistsPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            setPadding(dp(24), dp(18), dp(24), dp(18))
            background = panelBackground()
        }
        val playlistHeader = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
        playlistHeader.addView(TextView(this).apply { text = "قوائم التشغيل"; textSize = 23f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.RIGHT }, LinearLayout.LayoutParams(0, dp(40), 1f))
        playlistHeader.addView(TextView(this).apply { text = "اتصال مباشر"; textSize = 12.5f; setTextColor(BlofyTvDesign.Mint); gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(dp(130), dp(40)))
        playlistsPanel.addView(playlistHeader)
        playlistsPanel.addView(TextView(this).apply { text = "اختر أي قائمة للاتصال، أو افتح إدارة القوائم للإضافة والتعديل"; textSize = 13.5f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT; setPadding(0,0,0,dp(10)) })

        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER }
        playlistRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            addView(emptyPlaylistView("بعد إضافة القوائم ستظهر هنا، وكل قائمة يمكن تشغيلها مباشرة"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(70)))
        }
        scroll.addView(playlistRow, android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.WRAP_CONTENT))
        playlistsPanel.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER; setPadding(0,dp(10),0,0) }
        addPlaylist = primaryActionButton("＋  إضافة / إدارة") { startActivity(Intent(this@LoginActivity, PlaylistActivity::class.java)) }
        connectButton = actionButton("▶  تشغيل القائمة النشطة") { startOrCancelConnect() }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(56), 1f).apply { marginStart = dp(8) })
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(56), 1f))
        playlistsPanel.addView(actions)

        workspace.addView(activation, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, .82f).apply { marginEnd = dp(10) })
        workspace.addView(playlistsPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.18f).apply { marginStart = dp(10) })
        root.addView(workspace, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })
        root.addView(TextView(this).apply { text = "🔒  بيانات القوائم محفوظة محليًا • الدخول التالي يستخدم الكاش الجاهز مباشرة"; textSize = 12f; setTextColor(BlofyTvDesign.TextDim); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(26)).apply { topMargin = dp(4) })
        return root
    }

    private fun buildPhoneLogin(): View {
        createIdentityViews(true)
        val widthDp = resources.configuration.screenWidthDp
        val compact = widthDp < 400
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            setPadding(dp(if (compact) 16 else 24), dp(20), dp(if (compact) 16 else 24), dp(28))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(150),dp(82)))
        root.addView(title("BLOFY PLAYER",29f)); root.addView(subtitle("اربط جهازك ثم اختر قائمة التشغيل"))
        root.addView(label("رقم الجهاز"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)))
        deviceView.apply { background = fieldBackground(); setPadding(dp(12),0,dp(12),0) }
        root.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)))
        root.addView(label("رمز الربط"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)).apply { topMargin = dp(8) })
        codeView.apply { background = fieldBackground(); letterSpacing = .14f }
        root.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))
        root.addView(TextView(this).apply { text = "امسح QR بالجوال — التحديث يظهر تلقائيًا هنا"; textSize = 13f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER; setPadding(0,dp(14),0,dp(8)) })
        root.addView(qrView, LinearLayout.LayoutParams(dp(if (compact) 196 else 228), dp(if (compact) 196 else 228)))
        root.addView(pairingLinkHint(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34)))
        status.apply {
            background = statusBackground()
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        root.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8); bottomMargin = dp(10)
        })
        addPlaylist = actionButton("إضافة / إدارة القوائم") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("تشغيل القائمة النشطة") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        root.addView(addPlaylist, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,dp(64)))
        root.addView(connectButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,dp(60)).apply { topMargin = dp(8) })
        root.addView(refreshCodeButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,dp(56)).apply { topMargin = dp(8) })
        root.addView(TextView(this).apply {
            text = "🔒  بيانات القوائم محفوظة محليًا على جهازك"
            textSize = 12f
            setTextColor(BlofyTvDesign.TextDim)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, 0)
        })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }
        scroll.addView(root, android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.WRAP_CONTENT))
        return scroll
    }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply { text = "جاري إنشاء هوية الجهاز..."; textSize = if(phone)17f else 21f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = if(phone)Gravity.CENTER else Gravity.RIGHT or Gravity.CENTER_VERTICAL }
        codeView = TextView(this).apply { textSize = if(phone)25f else 34f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.PurpleBright); gravity = if(phone)Gravity.CENTER else Gravity.RIGHT or Gravity.CENTER_VERTICAL }
        qrView = ImageView(this).apply {
            contentDescription = "رمز ربط BLOFY"
            background = qrBackground()
            setPadding(dp(12),dp(12),dp(12),dp(12))
            elevation = dp(6).toFloat()
        }
        status = TextView(this).apply { textSize = 14f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER; setPadding(0,dp(8),0,dp(8)) }
    }

    private fun startOrCancelConnect() {
        if (connectJob?.isActive == true) { connectJob?.cancel(); status.text = "تم إلغاء الاتصال"; return }
        connectJob = lifecycleScope.launch {
            connectButton.text = "إلغاء"
            try { connectFlow() } catch (_: CancellationException) { }
            finally { connectButton.text = if(deviceKind == DeviceClass.Kind.TV) "▶  اتصال بالنشطة" else "تشغيل القائمة النشطة"; connectJob = null }
        }
    }

    private suspend fun connectFlow() {
        val dao = BlofyDatabase.get(applicationContext).dao(); val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) {
            val localProvider = dao.providers().first().firstOrNull()
            if (localProvider == null) { status.text = "أضف قائمة تشغيل أولاً"; return }
            if (hasCachedCatalog(dao,localProvider.id)) openHome() else openCatalogLoading(localProvider.id)
            return
        }
        status.text = "جاري التحقق من تفعيل الجهاز..."
        val manager = ActivationManager(applicationContext,dao)
        val result = runSuspendCatching { withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint),BuildConfig.VERSION_NAME) } }
        if (result.isSuccess) { val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }; renderIdentity(identity.deviceId,identity.activationCode) }
        result.onSuccess { remote ->
            if (!remote.canUse()) { status.text = activationLabel(remote); return@onSuccess }
            val portalSync = runSuspendCatching { PortalPlaylistClient.sync(applicationContext,endpoint,dao) }.getOrNull()
            renderPortalPlaylists(portalSync?.providers.orEmpty())
            val activeProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull()
            if (activeProvider == null) { status.text = "الجهاز مفعل • أضف قائمة"; addPlaylist.requestFocus(); return@onSuccess }
            withContext(Dispatchers.IO) { dao.upsertProvider(activeProvider) }
            val ready = hasCachedCatalog(dao,activeProvider.id); val changed = portalSync?.changedProviderIds?.contains(activeProvider.id) == true
            if (changed || !ready) { status.text = "جاري تجهيز ${activeProvider.name}"; openCatalogLoading(activeProvider.id); return@onSuccess }
            withContext(Dispatchers.IO) { dao.saveAndActivateProvider(activeProvider) }
            applyRemoteProviderProfile(endpoint,dao,activeProvider.id); openHome()
        }.onFailure {
            val cached = withContext(Dispatchers.IO) { dao.activation() }; val provider = dao.providers().first().firstOrNull()
            if (cached != null && manager.cachedCanUse(cached) && provider != null && hasCachedCatalog(dao,provider.id)) openHome() else status.text = "تعذر التحقق من التفعيل"
        }
    }

    private fun selectPortalProvider(provider: ProviderEntity) {
        if (playlistJob?.isActive == true) return
        playlistJob = lifecycleScope.launch {
            val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim(); val dao = BlofyDatabase.get(applicationContext).dao(); val existing = withContext(Dispatchers.IO) { dao.provider(provider.id) }
            val changed = existing == null || existing.baseUrl != provider.baseUrl || existing.username != provider.username || existing.password != provider.password || existing.providerType != provider.providerType
            status.text = "جاري اختيار ${provider.name}..."
            runSuspendCatching { PortalPlaylistClient.selectProvider(applicationContext,endpoint,provider,dao) }.onSuccess { selected ->
                renderPortalPlaylists(loadPortalProviders(endpoint,dao))
                if (!changed && hasCachedCatalog(dao,selected.id)) { applyRemoteProviderProfile(endpoint,dao,selected.id); openHome() }
                else { status.text = "جاري تجهيز ${selected.name}"; openCatalogLoading(selected.id) }
            }.onFailure { status.text = "تعذر اختيار القائمة • حاول مرة أخرى" }
            playlistJob = null
        }
    }

    private suspend fun loadPortalProviders(endpoint: String, dao: BlofyDao): List<ProviderEntity> = if (endpoint.isBlank()) dao.allProviders().first() else runSuspendCatching { PortalPlaylistClient.sync(applicationContext,endpoint,dao).providers }.getOrElse { dao.allProviders().first() }

    private fun renderPortalPlaylists(providers: List<ProviderEntity>) {
        val row = playlistRow ?: return
        val sorted = providers.sortedWith(compareByDescending<ProviderEntity> { it.enabled }.thenByDescending { it.updatedAt })
        if (sorted == renderedProviders) return
        renderedProviders = sorted.toList()
        row.removeAllViews()
        if (sorted.isEmpty()) {
            row.addView(
                emptyPlaylistView("لا توجد قوائم • استخدم إضافة / إدارة"),
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(70))
            )
            return
        }
        sorted.forEach { provider ->
            row.addView(
                playlistCard(provider),
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply {
                    bottomMargin = dp(8)
                }
            )
        }
    }

    private fun playlistCard(provider: ProviderEntity) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(16),dp(7),dp(16),dp(7)); isFocusable = true; isFocusableInTouchMode = true; isClickable = true; background = playlistCardBackground(provider.enabled,false)
        val info = LinearLayout(this@LoginActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        info.addView(TextView(this@LoginActivity).apply { text = provider.name; textSize = 15.5f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); maxLines = 1; gravity = Gravity.RIGHT })
        info.addView(TextView(this@LoginActivity).apply { val type = if(provider.providerType.equals("xtream",true)) "Xtream" else "M3U"; text = if(provider.enabled) "● النشطة • $type" else "$type • جاهزة للاتصال"; textSize = 11.5f; setTextColor(if(provider.enabled)BlofyTvDesign.Mint else BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT })
        addView(info, LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.MATCH_PARENT,1f))
        addView(TextView(this@LoginActivity).apply { text = "▶"; textSize = 18f; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(44),LinearLayout.LayoutParams.MATCH_PARENT))
        setOnFocusChangeListener { view, focused ->
            view.background = playlistCardBackground(provider.enabled, focused)
            view.animate()
                .scaleX(if (focused) 1.025f else 1f)
                .scaleY(if (focused) 1.025f else 1f)
                .translationZ(if (focused) dp(14).toFloat() else dp(2).toFloat())
                .setDuration(100)
                .start()
        }
        setOnClickListener { selectPortalProvider(provider) }
    }

    private fun emptyPlaylistView(message: String) = TextView(this).apply { text = message; textSize = 13f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; setPadding(dp(16),0,dp(16),0); background = fieldBackground() }
    private fun openCatalogLoading(providerId: String) { CatalogSyncState.markPending(applicationContext,providerId); startActivity(Intent(this,CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID,providerId)) }

    private suspend fun refreshIdentityAndProvider() {
        val dao = BlofyDatabase.get(applicationContext).dao(); val identity = withContext(Dispatchers.IO) { ActivationManager(applicationContext,dao).ensureIdentity() }; renderIdentity(identity.deviceId,identity.activationCode); refreshProviderStatus(); renderPortalPlaylists(loadPortalProviders(BuildConfig.ACTIVATION_BASE_URL.trim(),dao))
    }
    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean = withContext(Dispatchers.IO) { CatalogSyncState.isReady(applicationContext,providerId) && dao.hasStreamsForProvider(providerId) }
    private suspend fun <T> runSuspendCatching(block: suspend () -> T): Result<T> = try { Result.success(block()) } catch (c: CancellationException) { throw c } catch (e: Throwable) { Result.failure(e) }

    private suspend fun renderIdentity(deviceId: String, activationCode: String) {
        deviceView.text = deviceId
        codeView.text = activationCode
        val url = ActivationPortalUrl.create(BuildConfig.ACTIVATION_BASE_URL, deviceId, activationCode)
        if (url != null) {
            if (url != renderedQrUrl || qrView.drawable == null) {
                val bitmap = withContext(Dispatchers.Default) { createQr(url) }
                if (!isFinishing && !isDestroyed) {
                    qrView.setImageBitmap(bitmap)
                    renderedQrUrl = url
                }
            }
            qrView.alpha = 1f
        } else {
            renderedQrUrl = null
            qrView.setImageDrawable(null)
            qrView.alpha = .35f
        }
    }
    private suspend fun applyRemoteProviderProfile(endpoint: String, dao: BlofyDao, providerId: String) { val current = dao.provider(providerId) ?: return; val updated = RemoteProviderProfileClient.applyIfAvailable(applicationContext,endpoint,current); if(updated != current) dao.upsertProvider(updated) }
    private fun activationLabel(remote: ActivationCheckResponse) = when(remote.state()) { ActivationCheckResponse.State.TRIAL -> "الفترة التجريبية فعالة"; ActivationCheckResponse.State.ACTIVE -> "الجهاز مفعل"; ActivationCheckResponse.State.EXPIRED -> "انتهت صلاحية الجهاز"; ActivationCheckResponse.State.BLOCKED -> "الجهاز موقوف"; ActivationCheckResponse.State.UNKNOWN -> remote.message ?: "حالة التفعيل غير معروفة" }
    private fun openHome() { startActivity(Intent(this,HomeActivity::class.java)); finish() }
    override fun onResume() {
        super.onResume()
        startPairingWatcher()
    }

    override fun onPause() {
        pairingWatcherJob?.cancel()
        pairingWatcherJob = null
        super.onPause()
    }

    private fun startPairingWatcher() {
        if (!::status.isInitialized || pairingWatcherJob?.isActive == true) return
        pairingWatcherJob = lifecycleScope.launch {
            while (isActive) {
                if (connectJob?.isActive != true && playlistJob?.isActive != true) {
                    runSuspendCatching { refreshIdentityAndProvider() }
                }
                delay(PAIRING_REFRESH_MS)
            }
        }
    }
    private suspend fun refreshProviderStatus() { if(connectJob?.isActive == true) return; val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull(); status.text = if(provider==null) "في انتظار إضافة قائمة" else "جاهز • ${provider.name}" }
    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(
            value,
            BarcodeFormat.QR_CODE,
            512,
            512,
            mapOf(
                EncodeHintType.MARGIN to 1,
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.Q,
                EncodeHintType.CHARACTER_SET to "UTF-8"
            )
        )
        return Bitmap.createBitmap(matrix.width,matrix.height,Bitmap.Config.ARGB_8888).apply {
            for(y in 0 until matrix.height) for(x in 0 until matrix.width) {
                setPixel(x,y,if(matrix[x,y])Color.BLACK else Color.WHITE)
            }
        }
    }

    private fun pairingLinkHint() = TextView(this).apply {
        text = "blofyplayer.com/connect  •  تحديث تلقائي"
        textSize = 12.5f
        typeface = BlofyTvDesign.HeadingTypeface
        setTextColor(BlofyTvDesign.PurpleSoft)
        gravity = Gravity.CENTER
        letterSpacing = .02f
    }
    private fun qrBackground() = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        setColor(Color.WHITE)
        setStroke(dp(2), BlofyTvDesign.FocusStroke)
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply { val tv = deviceKind == DeviceClass.Kind.TV; text = label; isAllCaps = false; textSize = 14.5f; setTextColor(BlofyTvDesign.TextPrimary); isFocusable = tv; isFocusableInTouchMode = tv; background = buttonBackground(false); setOnFocusChangeListener { v,f -> if(tv){ v.background = buttonBackground(f); v.animate().scaleX(if(f)1.025f else 1f).scaleY(if(f)1.025f else 1f).setDuration(90).start() } }; setOnClickListener { action() } }
    private fun primaryActionButton(label: String, action: () -> Unit) = Button(this).apply { val tv = deviceKind == DeviceClass.Kind.TV; text = label; isAllCaps = false; textSize = 15f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); isFocusable = tv; isFocusableInTouchMode = tv; background = primaryButtonBackground(false); setOnFocusChangeListener { v,f -> if(tv){ v.background = primaryButtonBackground(f); v.animate().scaleX(if(f)1.03f else 1f).scaleY(if(f)1.03f else 1f).setDuration(95).start() } }; setOnClickListener { action() } }
    private fun label(value: String) = TextView(this).apply { text = value; textSize = 12.5f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }
    private fun title(value: String,size:Float)=TextView(this).apply{text=value;textSize=size;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(BlofyTvDesign.TextPrimary);gravity=Gravity.CENTER}
    private fun subtitle(value:String)=TextView(this).apply{text=value;textSize=16f;setTextColor(theme.accent);gravity=Gravity.CENTER;setPadding(0,dp(8),0,dp(16))}
    private fun panelBackground() = BlofyTvDesign.elevatedSurface(dp(24).toFloat(), emphasis = true)
    private fun fieldBackground() = BlofyTvDesign.inputField(dp(14).toFloat(), false)
    private fun statusBackground() = BlofyTvDesign.statusPill(dp(14).toFloat(), false)
    private fun playlistCardBackground(active:Boolean, focused:Boolean) =
        when {
            focused -> BlofyTvDesign.glassPanel(dp(15).toFloat(), true)
            active -> BlofyTvDesign.statusPill(dp(15).toFloat(), true)
            else -> BlofyTvDesign.surface(dp(15).toFloat(), false)
        }
    private fun buttonBackground(focused:Boolean) = BlofyTvDesign.secondaryButton(dp(15).toFloat(), focused)
    private fun primaryButtonBackground(focused:Boolean) = BlofyTvDesign.primaryButton(dp(15).toFloat(), focused)
    private fun dp(value:Int)=(value*resources.displayMetrics.density).toInt()

    companion object {
        private const val PAIRING_REFRESH_MS = 10_000L
    }
}