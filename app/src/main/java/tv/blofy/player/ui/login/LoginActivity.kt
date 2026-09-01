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
            setPadding(dp(72), dp(22), dp(72), dp(22))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        header.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(132), dp(92)))

        val headerText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        headerText.addView(TextView(this).apply {
            text = "فعّل جهازك بسهولة"
            textSize = 38f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        headerText.addView(TextView(this).apply {
            text = "امسح الرمز أو استخدم رقم الجهاز لإضافة قائمة التشغيل"
            textSize = 17f
            setTextColor(CLASSIC_MUTED)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, 0)
        })
        header.addView(headerText, LinearLayout.LayoutParams(0, dp(104), 1f).apply { marginEnd = dp(16) })
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(106)))

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = panelBackground()
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(26), dp(22), dp(26), dp(12))
        }

        val qrPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(10), 0, dp(20), 0)
        }
        qrPanel.addView(TextView(this).apply {
            text = "امسح رمز QR"
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(10))
        })
        qrPanel.addView(qrView, LinearLayout.LayoutParams(dp(254), dp(254)))
        qrPanel.addView(TextView(this).apply {
            text = "افتح موقع BLOFY PLAYER من جوالك ثم امسح الرمز"
            textSize = 13f
            setTextColor(CLASSIC_MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(2))
        })
        qrPanel.addView(TextView(this).apply {
            text = "blofy-player-2-0.vercel.app"
            textSize = 13f
            setTextColor(CLASSIC_PURPLE_SOFT)
            gravity = Gravity.CENTER
        })
        content.addView(qrPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 0.95f))

        val divider = View(this).apply { setBackgroundColor(CLASSIC_STROKE) }
        content.addView(divider, LinearLayout.LayoutParams(dp(1), LinearLayout.LayoutParams.MATCH_PARENT).apply {
            marginStart = dp(14); marginEnd = dp(20)
        })

        val infoPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(24), 0, dp(4), 0)
        }
        infoPanel.addView(TextView(this).apply {
            text = "بيانات الجهاز"
            textSize = 23f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(12))
        })

        infoPanel.addView(label("رقم الجهاز"))
        deviceView.apply {
            textSize = 23f
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            setPadding(dp(24), 0, dp(24), 0)
            background = fieldBackground()
        }
        infoPanel.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)).apply { topMargin = dp(6) })

        infoPanel.addView(label("رمز الربط"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34)).apply { topMargin = dp(12) })
        codeView.apply {
            textSize = 44f
            letterSpacing = 0.18f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = fieldBackground()
        }
        infoPanel.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(84)).apply { topMargin = dp(4) })

        status.apply {
            textSize = 15f
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setTextColor(Color.rgb(231, 226, 239))
            setPadding(dp(20), 0, dp(20), 0)
            background = statusBackground()
        }
        infoPanel.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(12) })
        content.addView(infoPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.25f))

        card.addView(content, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        val separator = View(this).apply { setBackgroundColor(CLASSIC_STROKE) }
        card.addView(separator, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(18), dp(12), dp(18), dp(12))
        }
        addPlaylist = primaryActionButton("إضافة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("اتصال") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث الرمز") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(66), 1.35f).apply { marginStart = dp(8); marginEnd = dp(8) })
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(66), 0.9f).apply { marginStart = dp(8); marginEnd = dp(8) })
        actions.addView(refreshCodeButton, LinearLayout.LayoutParams(0, dp(66), 0.9f).apply { marginStart = dp(8); marginEnd = dp(8) })
        card.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(92)))

        root.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })

        root.addView(TextView(this).apply {
            text = "♢  بياناتك محفوظة بشكل آمن ومشفّر"
            textSize = 13f
            setTextColor(Color.rgb(151, 139, 165))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34)).apply { topMargin = dp(6) })
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
            textSize = if (phone) 25f else 34f; typeface = Typeface.DEFAULT_BOLD; setTextColor(CLASSIC_PURPLE_SOFT)
            gravity = if (phone) Gravity.CENTER else Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        qrView = ImageView(this).apply {
            contentDescription = "رمز تفعيل BLOFY"
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        status = TextView(this).apply { textSize = 14f; setTextColor(CLASSIC_MUTED); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8)) }
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
        text = label
        isAllCaps = false
        textSize = 16f
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view, focused ->
            if (tv) {
                view.background = buttonBackground(focused)
                view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(90).start()
            }
        }
        setOnClickListener { action() }
    }

    private fun primaryActionButton(label: String, action: () -> Unit) = Button(this).apply {
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label
        isAllCaps = false
        textSize = 18f
        typeface = Typeface.DEFAULT_BOLD
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        background = primaryButtonBackground(false)
        setOnFocusChangeListener { view, focused ->
            if (tv) {
                view.background = primaryButtonBackground(focused)
                view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(90).start()
            }
        }
        setOnClickListener { action() }
    }

    private fun label(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(CLASSIC_MUTED)
        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
    }

    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
    private fun subtitle(value: String) = TextView(this).apply { text = value; textSize = 16f; setTextColor(CLASSIC_PURPLE_SOFT); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(16)) }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = dp(22).toFloat()
        setColor(CLASSIC_SURFACE)
        setStroke(dp(1), CLASSIC_STROKE)
    }

    private fun fieldBackground() = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(Color.rgb(11, 9, 17))
        setStroke(dp(1), Color.rgb(53, 44, 68))
    }

    private fun statusBackground() = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(Color.rgb(14, 12, 22))
        setStroke(dp(1), CLASSIC_STROKE)
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(if (focused) CLASSIC_FOCUS else CLASSIC_SURFACE)
        setStroke(if (focused) dp(2) else dp(1), if (focused) CLASSIC_PURPLE_SOFT else CLASSIC_STROKE)
    }

    private fun primaryButtonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(if (focused) CLASSIC_FOCUS else Color.rgb(59, 30, 108))
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else CLASSIC_PURPLE_SOFT)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private val CLASSIC_SURFACE = Color.rgb(17, 16, 30)
        private val CLASSIC_STROKE = Color.rgb(69, 55, 88)
        private val CLASSIC_FOCUS = Color.rgb(72, 42, 120)
        private val CLASSIC_PURPLE_SOFT = Color.rgb(188, 132, 255)
        private val CLASSIC_MUTED = Color.rgb(188, 182, 205)
    }
}
