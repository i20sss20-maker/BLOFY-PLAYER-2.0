package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationPortalUrl
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.provider.RemoteProviderProfileClient
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity
import java.util.UUID

class LoginActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrView: ImageView
    private lateinit var addPlaylist: Button
    private lateinit var connectButton: Button
    private var connectJob: Job? = null
    private var canOpenCachedContentDuringSync = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        val root = if (theme.id == "cinema" && deviceKind == DeviceClass.Kind.TV) buildCinemaTvLogin() else buildVisionLogin()
        setContentView(root)
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()

        lifecycleScope.launch {
            val identity = withContext(Dispatchers.IO) {
                ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
            }
            renderIdentity(identity.deviceId, identity.activationCode)
            refreshProviderStatus()
        }
    }

    private fun buildVisionLogin(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP or Gravity.CENTER_HORIZONTAL else Gravity.CENTER
            setPadding(if (phone) 24 else 54, if (phone) 24 else 36, if (phone) 24 else 54, if (phone) 24 else 36)
            setBackgroundColor(theme.background)
        }
        root.addView(title("BLOFY PLAYER", if (phone) 29f else 36f))
        root.addView(subtitle("فعّل جهازك ثم أضف قائمة التشغيل"))
        createIdentityViews(phone)
        root.addView(deviceView)
        root.addView(codeView)
        val qrSize = if (phone) 180 else 220
        root.addView(qrView, LinearLayout.LayoutParams(qrSize, qrSize))
        root.addView(status)
        addPlaylist = actionButton("إضافة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("اتصال") { startOrCancelConnect() }
        val buttonWidth = if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 420
        root.addView(addPlaylist, LinearLayout.LayoutParams(buttonWidth, if (phone) 64 else 74))
        root.addView(connectButton, LinearLayout.LayoutParams(buttonWidth, if (phone) 64 else 74).apply { topMargin = 10 })
        return root
    }

    private fun buildCinemaTvLogin(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(48, 42, 48, 42)
            setBackgroundColor(theme.background)
        }
        createIdentityViews(false)
        val identityPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(36, 28, 36, 28)
            background = panelBackground()
        }
        identityPanel.addView(title("BLOFY", 40f))
        identityPanel.addView(subtitle("CINEMA • DEVICE ACTIVATION"))
        identityPanel.addView(qrView, LinearLayout.LayoutParams(250, 250))
        identityPanel.addView(deviceView)
        identityPanel.addView(codeView)
        root.addView(identityPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = 30 })

        val actionPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(42, 36, 42, 36)
            background = panelBackground()
        }
        actionPanel.addView(title("مرحبًا بك", 32f))
        actionPanel.addView(TextView(this).apply {
            text = "أضف قائمتك مرة واحدة، وبعدها اتصال يفتح البيانات المحلية مباشرة."
            textSize = 17f
            setTextColor(Color.rgb(215, 210, 225))
            setPadding(0, 10, 0, 28)
        })
        actionPanel.addView(status)
        addPlaylist = actionButton("إضافة / إدارة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("اتصال بـ BLOFY") { startOrCancelConnect() }
        actionPanel.addView(addPlaylist, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 82))
        actionPanel.addView(connectButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 82).apply { topMargin = 14 })
        root.addView(actionPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        return root
    }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply { text = "جاري إنشاء هوية الجهاز..."; textSize = 17f; setTextColor(Color.LTGRAY); gravity = Gravity.CENTER }
        codeView = TextView(this).apply { textSize = if (phone) 25f else 30f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, 6, 0, 8) }
        qrView = ImageView(this).apply { contentDescription = "رمز تفعيل BLOFY"; setBackgroundColor(Color.WHITE); setPadding(10, 10, 10, 10) }
        status = TextView(this).apply { textSize = 14f; setTextColor(theme.accent); gravity = Gravity.CENTER; setPadding(0, 8, 0, 16) }
    }

    private fun startOrCancelConnect() {
        if (connectJob?.isActive == true) {
            val openCachedContent = canOpenCachedContentDuringSync
            connectJob?.cancel()
            status.text = if (openCachedContent) "تم إيقاف التحديث • الدخول الآن" else "تم إلغاء الاتصال"
            if (openCachedContent) openHome()
            return
        }

        connectJob = lifecycleScope.launch {
            connectButton.text = "إلغاء"
            try {
                connectFlow()
            } catch (_: CancellationException) {
                // User cancellation is handled by the button and Activity lifecycle.
            } finally {
                canOpenCachedContentDuringSync = false
                connectButton.text = if (deviceKind == DeviceClass.Kind.TV && theme.id == "cinema") "اتصال بـ BLOFY" else "اتصال"
                connectJob = null
            }
        }
    }

    private suspend fun connectFlow() {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()

            if (endpoint.isBlank()) {
                val localProvider = dao.providers().first().firstOrNull()
                if (localProvider == null) {
                    status.text = "أضف قائمة تشغيل أولاً"
                    if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
                    return
                }
                if (hasCachedCatalog(dao, localProvider.id)) {
                    openHome()
                } else {
                    status.text = "القائمة محفوظة لكن لا يوجد محتوى محلي • اتصل بالإنترنت وحدّثها"
                }
                return
            }

            status.text = "جاري التحقق من تفعيل الجهاز..."
            val manager = ActivationManager(applicationContext, dao)
            val result = runSuspendCatching {
                withContext(Dispatchers.IO) {
                    manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                }
            }
            if (result.isSuccess) {
                val currentIdentity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
                renderIdentity(currentIdentity.deviceId, currentIdentity.activationCode)
            }
            result.onSuccess { remote ->
                if (!remote.canUse()) {
                    status.text = activationLabel(remote)
                    return@onSuccess
                }

                status.text = "${activationLabel(remote)} • مزامنة القوائم..."
                val portalSync = runSuspendCatching {
                    PortalPlaylistClient.sync(applicationContext, endpoint, dao)
                }.getOrNull()

                val candidateProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull()
                if (candidateProvider == null) {
                    status.text = "الجهاز مفعل • أضف قائمة من التطبيق أو الموقع"
                    if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
                    return@onSuccess
                }
                var activeProvider = candidateProvider

                val cachedBeforeSync = hasCachedCatalog(dao, activeProvider.id)
                val providerChanged = portalSync?.changedProviderIds?.contains(activeProvider.id) == true
                if (providerChanged || !cachedBeforeSync) {
                    val stagingProvider = activeProvider.copy(
                        id = UUID.randomUUID().toString(),
                        enabled = false
                    )
                    canOpenCachedContentDuringSync = cachedBeforeSync
                    connectButton.text = if (cachedBeforeSync) "الدخول الآن" else "إلغاء"
                    status.text = if (cachedBeforeSync) {
                        "تغيرت بيانات القائمة • بدء تحديث المحتوى (يمكنك الدخول الآن)"
                    } else {
                        "جاري تحميل المحتوى لأول مرة • يرجى الانتظار"
                    }
                    val syncError = try {
                        val syncResult = PlaylistSyncPolicy.run {
                            withContext(Dispatchers.IO) {
                                PlaylistManager(XtreamClient.api, dao).syncAll(stagingProvider) { progress ->
                                    showSyncProgress(progress)
                                }
                            }
                        }
                        check(syncResult.freshItemCount > 0) {
                            "لم يرجع السيرفر محتوى من بيانات الدخول الحالية"
                        }
                        check(syncResult.failedSectionCount == 0) {
                            "تعذر تحميل أحد أقسام القائمة الجديدة"
                        }
                        withContext(Dispatchers.IO) {
                            dao.promoteStagedCatalog(
                                stagingProvider.id,
                                activeProvider.copy(enabled = true)
                            )
                        }
                        null
                    } catch (timeout: TimeoutCancellationException) {
                        timeout
                    } catch (cancelled: CancellationException) {
                        withContext(NonCancellable + Dispatchers.IO) {
                            dao.discardStagedCatalog(stagingProvider.id)
                        }
                        throw cancelled
                    } catch (error: Throwable) {
                        error
                    }
                    canOpenCachedContentDuringSync = false
                    connectButton.text = "إلغاء"
                    syncError?.let { error ->
                        withContext(Dispatchers.IO) {
                            dao.discardStagedCatalog(stagingProvider.id)
                        }
                        val fallbackProvider = dao.providers().first().firstOrNull()
                        val cachedAfterFailure = fallbackProvider?.let { hasCachedCatalog(dao, it.id) } == true
                        val message = if (cachedAfterFailure && error is TimeoutCancellationException) {
                            "انتهت مهلة التحديث • بقيت القائمة السابقة كما هي، حدّث لاحقًا من الإعدادات"
                        } else if (cachedAfterFailure) {
                            "تعذر اعتماد بيانات القائمة الجديدة • بقيت القائمة السابقة كما هي"
                        } else if (error is TimeoutCancellationException) {
                            "انتهت مهلة التحديث ولا يوجد محتوى محفوظ • أعد المحاولة"
                        } else {
                            "لم يصل محتوى صالح من بيانات القائمة • تحقق منها ثم أعد المحاولة"
                        }
                        status.text = message
                        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                        if (cachedAfterFailure) openHome()
                        return@onSuccess
                    }
                    activeProvider = activeProvider.copy(enabled = true)
                } else {
                    withContext(Dispatchers.IO) {
                        dao.saveAndActivateProvider(activeProvider)
                    }
                }

                if (!hasCachedCatalog(dao, activeProvider.id)) {
                    status.text = "لم يصل محتوى من القائمة • تحقق من بياناتها ثم أعد المحاولة"
                    return@onSuccess
                }

                applyRemoteProviderProfile(endpoint, dao, activeProvider.id)
                openHome()
            }.onFailure {
                val cached = withContext(Dispatchers.IO) { dao.activation() }
                val localProvider = dao.providers().first().firstOrNull()
                val hasLocalContent = localProvider?.let { hasCachedCatalog(dao, it.id) } == true
                if (cached != null && manager.cachedCanUse(cached) && localProvider != null && hasLocalContent) {
                    status.text = "تعذر الوصول لخادم التفعيل • استخدام الصلاحية والقائمة المحفوظة"
                    openHome()
                } else if (cached != null && manager.cachedCanUse(cached) && localProvider != null) {
                    status.text = "الصلاحية والقائمة محفوظتان لكن لا يوجد محتوى محلي • أعد الاتصال"
                } else if (cached != null && manager.cachedCanUse(cached)) {
                    status.text = "الصلاحية محفوظة لكن لا توجد قائمة محلية"
                } else {
                    status.text = "تعذر التحقق من التفعيل"
                }
            }
    }

    private suspend fun showSyncProgress(progress: PlaylistSyncProgress) {
        val section = when (progress.stage) {
            PlaylistSyncStage.M3U -> "قائمة M3U"
            PlaylistSyncStage.LIVE -> "القنوات"
            PlaylistSyncStage.MOVIES -> "الأفلام"
            PlaylistSyncStage.SERIES -> "المسلسلات"
        }
        withContext(Dispatchers.Main.immediate) {
            status.text = if (canOpenCachedContentDuringSync) {
                "جاري تحديث $section (${progress.step}/${progress.totalSteps}) • اضغط للدخول الآن"
            } else {
                "جاري تحميل $section (${progress.step}/${progress.totalSteps}) • يرجى الانتظار"
            }
        }
    }

    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean =
        withContext(Dispatchers.IO) {
            CATALOG_KINDS.any { kind -> dao.streams(providerId, kind, null).first().isNotEmpty() }
        }

    private suspend fun <T> runSuspendCatching(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Throwable) {
        Result.failure(error)
    }

    private fun renderIdentity(deviceId: String, activationCode: String) {
        deviceView.text = deviceId
        codeView.text = activationCode
        val portalUrl = ActivationPortalUrl.create(BuildConfig.ACTIVATION_BASE_URL, deviceId, activationCode)
        if (portalUrl != null) {
            qrView.setImageBitmap(createQr(portalUrl))
            qrView.contentDescription = "افتح بوابة تفعيل BLOFY"
        } else {
            qrView.setImageDrawable(null)
            qrView.contentDescription = "بوابة تفعيل BLOFY غير مهيأة"
        }
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

    private fun openHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }
    override fun onResume() { super.onResume(); if (::status.isInitialized) lifecycleScope.launch { refreshProviderStatus() } }
    private suspend fun refreshProviderStatus() {
        if (connectJob?.isActive == true) return
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        if (connectJob?.isActive == true) return
        status.text = if (provider == null) "لا توجد قائمة محفوظة" else "القائمة النشطة: ${provider.name}"
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
        setOnFocusChangeListener { view, focused -> if (tv) { view.background = buttonBackground(focused); view.animate().scaleX(if (focused) theme.focusScale else 1f).scaleY(if (focused) theme.focusScale else 1f).setDuration(theme.motionMs).start() } }
        setOnClickListener { action() }
    }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
    private fun subtitle(value: String) = TextView(this).apply { text = value; textSize = 16f; setTextColor(theme.accent); gravity = Gravity.CENTER; setPadding(0, 8, 0, 16) }
    private fun panelBackground() = GradientDrawable().apply { cornerRadius = 28f; setColor(theme.surface); setStroke(1, theme.accent) }
    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply { cornerRadius = if (theme.id == "cinema") 16f else 20f; setColor(if (focused) theme.accent else theme.surface); setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else theme.accent) }

    companion object {
        private val CATALOG_KINDS = listOf("live", "movie", "series")
    }
}
