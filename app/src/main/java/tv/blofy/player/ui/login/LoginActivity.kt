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
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.provider.RemoteProviderProfileClient
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
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
    private var connectJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildApprovedTvLogin() else buildPhoneLogin())
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
        lifecycleScope.launch { refreshIdentityAndProvider() }
    }

    private fun buildApprovedTvLogin(): LinearLayout {
        createIdentityViews(false)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(54), dp(28), dp(54), dp(30))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }

        val brandRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        brandRow.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(118), dp(86)))
        val brandText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL }
        brandText.addView(TextView(this).apply {
            text = "BLOFY PLAYER"; textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT
        })
        brandText.addView(TextView(this).apply {
            text = "فعّل جهازك بسهولة"; textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT
        })
        brandText.addView(TextView(this).apply {
            text = "امسح رمز QR أو استخدم رقم الجهاز ورمز الربط"; textSize = 13f; setTextColor(0xFFB8ABC7.toInt()); gravity = Gravity.RIGHT
        })
        brandRow.addView(brandText, LinearLayout.LayoutParams(0, dp(88), 1f).apply { marginStart = dp(12) })
        root.addView(brandRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(92)))

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(30), dp(24), dp(30), dp(24))
            background = panelBackground()
        }
        val qrPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        qrPanel.addView(qrView, LinearLayout.LayoutParams(dp(245), dp(245)))
        qrPanel.addView(TextView(this).apply {
            text = "امسح الرمز لإضافة القائمة"; textSize = 13f; setTextColor(0xFFB8ABC7.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(10), 0, 0)
        })
        card.addView(qrPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        val infoPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), 0, dp(18), 0)
        }
        infoPanel.addView(label("رقم الجهاز"))
        infoPanel.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))
        infoPanel.addView(label("رمز الربط"))
        infoPanel.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)))
        status.gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        infoPanel.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)))
        card.addView(infoPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.15f))
        root.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(345)).apply { topMargin = dp(14) })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        addPlaylist = actionButton("إضافة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("اتصال") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث الرمز") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        actions.addView(addPlaylist, actionParams())
        actions.addView(connectButton, actionParams())
        actions.addView(refreshCodeButton, actionParams())
        root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76)).apply { topMargin = dp(18) })
        return root
    }

    private fun buildPhoneLogin(): LinearLayout {
        createIdentityViews(true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(24), dp(24), dp(24)); setBackgroundColor(theme.background)
        }
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(150), dp(82)))
        root.addView(title("BLOFY PLAYER", 29f)); root.addView(subtitle("فعّل جهازك ثم أضف قائمة التشغيل"))
        root.addView(deviceView); root.addView(codeView); root.addView(qrView, LinearLayout.LayoutParams(dp(180), dp(180))); root.addView(status)
        addPlaylist = actionButton("إضافة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("اتصال") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث الرمز") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        root.addView(addPlaylist, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)))
        root.addView(connectButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(10) })
        return root
    }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply {
            text = "جاري إنشاء هوية الجهاز..."; textSize = if (phone) 17f else 21f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = if (phone) Gravity.CENTER else Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        codeView = TextView(this).apply {
            textSize = if (phone) 25f else 34f; typeface = Typeface.DEFAULT_BOLD; setTextColor(0xFFB78CFF.toInt())
            gravity = if (phone) Gravity.CENTER else Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        qrView = ImageView(this).apply { contentDescription = "رمز تفعيل BLOFY"; setBackgroundColor(Color.WHITE); setPadding(dp(10), dp(10), dp(10), dp(10)) }
        status = TextView(this).apply { textSize = 14f; setTextColor(0xFFB8ABC7.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8)) }
    }

    private fun startOrCancelConnect() {
        if (connectJob?.isActive == true) { connectJob?.cancel(); status.text = "تم إلغاء الاتصال"; return }
        connectJob = lifecycleScope.launch {
            connectButton.text = "إلغاء"
            try { connectFlow() } catch (_: CancellationException) { }
            finally { connectButton.text = "اتصال"; connectJob = null }
        }
    }

    private suspend fun connectFlow() {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) {
            val localProvider = dao.providers().first().firstOrNull()
            if (localProvider == null) { status.text = "أضف قائمة تشغيل أولاً"; return }
            if (hasCachedCatalog(dao, localProvider.id)) openHome() else openCatalogLoading(localProvider.id)
            return
        }

        status.text = "جاري التحقق من تفعيل الجهاز..."
        val manager = ActivationManager(applicationContext, dao)
        val result = runSuspendCatching { withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME) } }
        if (result.isSuccess) {
            val currentIdentity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
            renderIdentity(currentIdentity.deviceId, currentIdentity.activationCode)
        }
        result.onSuccess { remote ->
            if (!remote.canUse()) { status.text = activationLabel(remote); return@onSuccess }
            val portalSync = runSuspendCatching { PortalPlaylistClient.sync(applicationContext, endpoint, dao) }.getOrNull()
            val activeProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull()
            if (activeProvider == null) { status.text = "في انتظار إضافة قائمة"; addPlaylist.requestFocus(); return@onSuccess }

            withContext(Dispatchers.IO) { dao.upsertProvider(activeProvider) }
            val cachedBeforeSync = hasCachedCatalog(dao, activeProvider.id)
            val providerChanged = portalSync?.changedProviderIds?.contains(activeProvider.id) == true
            if (providerChanged || !cachedBeforeSync) {
                status.text = "تم التحقق • جاري تجهيز الباقة"
                openCatalogLoading(activeProvider.id)
                return@onSuccess
            }

            withContext(Dispatchers.IO) { dao.saveAndActivateProvider(activeProvider) }
            applyRemoteProviderProfile(endpoint, dao, activeProvider.id)
            openHome()
        }.onFailure {
            val cached = withContext(Dispatchers.IO) { dao.activation() }
            val localProvider = dao.providers().first().firstOrNull()
            val hasLocalContent = localProvider?.let { hasCachedCatalog(dao, it.id) } == true
            if (cached != null && manager.cachedCanUse(cached) && localProvider != null && hasLocalContent) openHome()
            else status.text = "تعذر التحقق من التفعيل"
        }
    }

    private fun openCatalogLoading(providerId: String) {
        CatalogSyncState.markPending(applicationContext, providerId)
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }

    private suspend fun refreshIdentityAndProvider() {
        val identity = withContext(Dispatchers.IO) { ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity() }
        renderIdentity(identity.deviceId, identity.activationCode)
        refreshProviderStatus()
    }

    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean = withContext(Dispatchers.IO) {
        CatalogSyncState.isReady(applicationContext, providerId) && dao.allStreamsForProvider(providerId).isNotEmpty()
    }

    private suspend fun <T> runSuspendCatching(block: suspend () -> T): Result<T> = try { Result.success(block()) }
    catch (cancelled: CancellationException) { throw cancelled } catch (error: Throwable) { Result.failure(error) }

    private fun renderIdentity(deviceId: String, activationCode: String) {
        deviceView.text = deviceId; codeView.text = activationCode
        val portalUrl = ActivationPortalUrl.create(BuildConfig.ACTIVATION_BASE_URL, deviceId, activationCode)
        if (portalUrl != null) { qrView.setImageBitmap(createQr(portalUrl)); qrView.contentDescription = "افتح بوابة تفعيل BLOFY" }
        else { qrView.setImageDrawable(null); qrView.contentDescription = "بوابة تفعيل BLOFY غير مهيأة" }
    }

    private suspend fun applyRemoteProviderProfile(endpoint: String, dao: BlofyDao, providerId: String) {
        val current = dao.provider(providerId) ?: return
        val updated = RemoteProviderProfileClient.applyIfAvailable(applicationContext, endpoint, current)
        if (updated != current) dao.upsertProvider(updated)
    }

    private fun activationLabel(remote: ActivationCheckResponse): String = when (remote.state()) {
        ActivationCheckResponse.State.TRIAL -> "الفترة التجريبية فعالة"
        ActivationCheckResponse.State.ACTIVE -> "الجهاز مفعل"
        ActivationCheckResponse.State.EXPIRED -> "انتهت صلاحية الجهاز"
        ActivationCheckResponse.State.BLOCKED -> "الجهاز موقوف"
        ActivationCheckResponse.State.UNKNOWN -> remote.message ?: "حالة التفعيل غير معروفة"
    }

    private fun openHome() { startActivity(Intent(this, HomeActivity::class.java)); finish() }
    override fun onResume() { super.onResume(); if (::status.isInitialized && connectJob?.isActive != true) lifecycleScope.launch { refreshProviderStatus() } }
    private suspend fun refreshProviderStatus() {
        if (connectJob?.isActive == true) return
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "في انتظار إضافة قائمة" else "القائمة جاهزة: ${provider.name}"
    }

    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.RGB_565).apply {
            for (y in 0 until matrix.height) for (x in 0 until matrix.width) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label; isAllCaps = false; textSize = 16f; isFocusable = tv; isFocusableInTouchMode = tv; setTextColor(Color.WHITE); background = buttonBackground(false)
        setOnFocusChangeListener { view, focused -> if (tv) { view.background = buttonBackground(focused); view.animate().scaleX(if (focused) 1.04f else 1f).scaleY(if (focused) 1.04f else 1f).setDuration(110).start() } }
        setOnClickListener { action() }
    }
    private fun actionParams() = LinearLayout.LayoutParams(0, dp(68), 1f).apply { marginStart = dp(7); marginEnd = dp(7) }
    private fun label(value: String) = TextView(this).apply { text = value; textSize = 13f; setTextColor(0xFF9E90AE.toInt()); gravity = Gravity.RIGHT }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
    private fun subtitle(value: String) = TextView(this).apply { text = value; textSize = 16f; setTextColor(theme.accent); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(16)) }
    private fun panelBackground() = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(0xEA151020.toInt()); setStroke(dp(1), 0xFF67458E.toInt()) }
    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(if (focused) 0xFF7D45D9.toInt() else 0xFF241A30.toInt()); setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0xFF69468F.toInt()) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
