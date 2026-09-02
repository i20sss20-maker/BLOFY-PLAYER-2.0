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
import android.widget.HorizontalScrollView
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
            setPadding(dp(64), dp(18), dp(64), dp(18))
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
        }, LinearLayout.LayoutParams(dp(124), dp(82)))

        val headerText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        headerText.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 14f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            letterSpacing = 0.12f
            setTextColor(0xFFC987FF.toInt())
            gravity = Gravity.RIGHT
        })
        headerText.addView(TextView(this).apply {
            text = "فعّل جهازك وابدأ المشاهدة"
            textSize = 34f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            includeFontPadding = false
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        headerText.addView(TextView(this).apply {
            text = "امسح رمز QR من جوالك، أضف قوائمك من الموقع، ثم اختر القائمة التي تريد تشغيلها"
            textSize = 15.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(0xFFC2B3D0.toInt())
            gravity = Gravity.RIGHT
            setPadding(0, dp(3), 0, 0)
        })
        header.addView(headerText, LinearLayout.LayoutParams(0, dp(92), 1f).apply { marginEnd = dp(16) })
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(94)))

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
            setPadding(dp(24), dp(16), dp(24), dp(8))
        }

        val qrPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(8), 0, dp(18), 0)
        }
        qrPanel.addView(TextView(this).apply {
            text = "امسح الرمز من جوالك"
            textSize = 19f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(8))
        })
        qrPanel.addView(qrView, LinearLayout.LayoutParams(dp(218), dp(218)))
        qrPanel.addView(TextView(this).apply {
            text = "يفتح صفحة جهازك مباشرة لإضافة وإدارة القوائم"
            textSize = 12.5f
            setTextColor(0xFFC9BDD8.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(1))
        })
        qrPanel.addView(TextView(this).apply {
            text = "blofy-player-2-0.vercel.app"
            textSize = 12.5f
            setTextColor(0xFFC987FF.toInt())
            gravity = Gravity.CENTER
        })
        content.addView(qrPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 0.88f))

        val divider = View(this).apply { setBackgroundColor(0xFF3A2949.toInt()) }
        content.addView(divider, LinearLayout.LayoutParams(dp(1), LinearLayout.LayoutParams.MATCH_PARENT).apply {
            marginStart = dp(16); marginEnd = dp(20)
        })

        val infoPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(22), 0, dp(4), 0)
        }
        infoPanel.addView(TextView(this).apply {
            text = "بيانات هذا الجهاز"
            textSize = 21f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(10))
        })

        infoPanel.addView(label("رقم الجهاز"))
        deviceView.apply {
            textSize = 21f
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            setPadding(dp(22), 0, dp(22), 0)
            background = fieldBackground()
        }
        infoPanel.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(5) })

        infoPanel.addView(label("رمز الربط"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)).apply { topMargin = dp(8) })
        codeView.apply {
            textSize = 38f
            letterSpacing = 0.18f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = fieldBackground()
        }
        infoPanel.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(70)).apply { topMargin = dp(3) })

        status.apply {
            textSize = 14f
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setTextColor(0xFFE9E0EF.toInt())
            setPadding(dp(18), 0, dp(18), 0)
            background = statusBackground()
        }
        infoPanel.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(10) })
        content.addView(infoPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.22f))

        card.addView(content, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        card.addView(View(this).apply { setBackgroundColor(0xFF342441.toInt()) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))
        card.addView(buildPlaylistSection(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(126)))
        card.addView(View(this).apply { setBackgroundColor(0xFF342441.toInt()) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(18), dp(10), dp(18), dp(10))
        }
        addPlaylist = primaryActionButton("＋  إضافة / إدارة القوائم") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("▶  تشغيل القائمة النشطة") { startOrCancelConnect() }
        refreshCodeButton = actionButton("↻  تحديث") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(58), 1.25f).apply { marginStart = dp(7); marginEnd = dp(7) })
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(58), 1.05f).apply { marginStart = dp(7); marginEnd = dp(7) })
        actions.addView(refreshCodeButton, LinearLayout.LayoutParams(0, dp(58), 0.72f).apply { marginStart = dp(7); marginEnd = dp(7) })
        card.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(78)))

        root.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(6) })
        root.addView(TextView(this).apply {
            text = "🔒  بيانات القوائم محمية ومشفّرة • يمكنك إدارتها من الموقع أو من الجهاز"
            textSize = 12f
            setTextColor(0xFF9D91A9.toInt())
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)).apply { topMargin = dp(4) })
        return root
    }

    private fun buildPlaylistSection(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(20), dp(8), dp(20), dp(8))
        val titleRow = LinearLayout(this@LoginActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        titleRow.addView(TextView(this@LoginActivity).apply {
            text = "قوائمك"
            textSize = 18f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(0, dp(30), 1f))
        titleRow.addView(TextView(this@LoginActivity).apply {
            text = "اختر بالريموت"
            textSize = 12f
            setTextColor(0xFFB69FC9.toInt())
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(dp(150), dp(30)))
        addView(titleRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)))

        val scroller = HorizontalScrollView(this@LoginActivity).apply {
            isHorizontalScrollBarEnabled = false
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        playlistRow = LinearLayout(this@LoginActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            addView(emptyPlaylistView("بعد التفعيل، تظهر هنا القوائم المحفوظة في الموقع"), LinearLayout.LayoutParams(dp(430), dp(72)))
        }
        scroller.addView(playlistRow, android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.WRAP_CONTENT, android.widget.FrameLayout.LayoutParams.MATCH_PARENT))
        addView(scroller, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    private fun buildPhoneLogin(): LinearLayout {
        createIdentityViews(true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(24), dp(24), dp(24)); setBackgroundColor(theme.background)
        }
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(150), dp(82)))
        root.addView(title("BLOFY PLAYER", 29f)); root.addView(subtitle("فعّل جهازك ثم اختر قائمة التشغيل"))
        root.addView(deviceView); root.addView(codeView); root.addView(qrView, LinearLayout.LayoutParams(dp(180), dp(180))); root.addView(status)
        addPlaylist = actionButton("إضافة / إدارة القوائم") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("تشغيل القائمة النشطة") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث") { lifecycleScope.launch { refreshIdentityAndProvider() } }
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
        qrView = ImageView(this).apply {
            contentDescription = "رمز تفعيل BLOFY"
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        status = TextView(this).apply { textSize = 14f; setTextColor(0xFFB8ABC7.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8)) }
    }

    private fun startOrCancelConnect() {
        if (connectJob?.isActive == true) { connectJob?.cancel(); status.text = "تم إلغاء الاتصال"; return }
        connectJob = lifecycleScope.launch {
            connectButton.text = "إلغاء"
            try { connectFlow() } catch (_: CancellationException) { }
            finally { connectButton.text = if (deviceKind == DeviceClass.Kind.TV) "▶  تشغيل القائمة النشطة" else "تشغيل القائمة النشطة"; connectJob = null }
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
            renderPortalPlaylists(portalSync?.providers.orEmpty())
            val activeProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull()
            if (activeProvider == null) { status.text = "الجهاز مفعل • أضف قائمة من الموقع أو التطبيق"; addPlaylist.requestFocus(); return@onSuccess }

            withContext(Dispatchers.IO) { dao.upsertProvider(activeProvider) }
            val cachedBeforeSync = hasCachedCatalog(dao, activeProvider.id)
            val providerChanged = portalSync?.changedProviderIds?.contains(activeProvider.id) == true
            if (providerChanged || !cachedBeforeSync) {
                status.text = "تم التحقق • جاري تجهيز ${activeProvider.name}"
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

    private fun selectPortalProvider(provider: ProviderEntity) {
        if (playlistJob?.isActive == true) return
        playlistJob = lifecycleScope.launch {
            val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
            val dao = BlofyDatabase.get(applicationContext).dao()
            val existing = withContext(Dispatchers.IO) { dao.provider(provider.id) }
            val contentChanged = existing == null || existing.baseUrl != provider.baseUrl || existing.username != provider.username || existing.password != provider.password || existing.providerType != provider.providerType
            status.text = "جاري اختيار ${provider.name}..."
            val result = runSuspendCatching { PortalPlaylistClient.selectProvider(applicationContext, endpoint, provider, dao) }
            result.onSuccess { selected ->
                renderPortalPlaylists(loadPortalProviders(endpoint, dao))
                val cached = !contentChanged && hasCachedCatalog(dao, selected.id)
                if (cached) {
                    applyRemoteProviderProfile(endpoint, dao, selected.id)
                    status.text = "تم اختيار ${selected.name}"
                    openHome()
                } else {
                    status.text = "تم اختيار ${selected.name} • جاري تجهيز الباقة"
                    openCatalogLoading(selected.id)
                }
            }.onFailure { status.text = "تعذر اختيار القائمة • حاول مرة أخرى" }
            playlistJob = null
        }
    }

    private suspend fun loadPortalProviders(endpoint: String, dao: BlofyDao): List<ProviderEntity> {
        if (endpoint.isBlank()) return dao.allProviders().first()
        return runSuspendCatching { PortalPlaylistClient.sync(applicationContext, endpoint, dao).providers }.getOrElse { dao.allProviders().first() }
    }

    private fun renderPortalPlaylists(providers: List<ProviderEntity>) {
        val row = playlistRow ?: return
        row.removeAllViews()
        if (providers.isEmpty()) {
            row.addView(emptyPlaylistView("لا توجد قوائم بعد • أضفها من الموقع وستظهر هنا تلقائيًا"), LinearLayout.LayoutParams(dp(520), dp(72)))
            return
        }
        providers.sortedWith(compareByDescending<ProviderEntity> { it.enabled }.thenByDescending { it.updatedAt }).forEach { provider ->
            row.addView(playlistCard(provider), LinearLayout.LayoutParams(dp(285), dp(74)).apply { marginStart = dp(8); marginEnd = dp(8) })
        }
    }

    private fun playlistCard(provider: ProviderEntity): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(16), dp(7), dp(16), dp(7))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = playlistCardBackground(provider.enabled, false)
        addView(TextView(this@LoginActivity).apply {
            text = provider.name
            textSize = 15.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            maxLines = 1
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)))
        addView(TextView(this@LoginActivity).apply {
            val type = if (provider.providerType.equals("xtream", true)) "Xtream" else "M3U"
            text = if (provider.enabled) "●  النشطة   •   $type" else "$type   •   اضغط للاختيار"
            textSize = 11.5f
            setTextColor(if (provider.enabled) 0xFF79E7C6.toInt() else 0xFFBCA9CA.toInt())
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(24)))
        setOnFocusChangeListener { view, focused ->
            view.background = playlistCardBackground(provider.enabled, focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).translationZ(if (focused) 16f else 2f).setDuration(if (focused) 110 else 85).start()
        }
        setOnClickListener { selectPortalProvider(provider) }
    }

    private fun emptyPlaylistView(message: String) = TextView(this).apply {
        text = message
        textSize = 13f
        setTextColor(0xFFAC9BBA.toInt())
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        setPadding(dp(16), 0, dp(16), 0)
        background = fieldBackground()
    }

    private fun openCatalogLoading(providerId: String) {
        CatalogSyncState.markPending(applicationContext, providerId)
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }

    private suspend fun refreshIdentityAndProvider() {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val identity = withContext(Dispatchers.IO) { ActivationManager(applicationContext, dao).ensureIdentity() }
        renderIdentity(identity.deviceId, identity.activationCode)
        refreshProviderStatus()
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        renderPortalPlaylists(loadPortalProviders(endpoint, dao))
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

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized && connectJob?.isActive != true) lifecycleScope.launch { refreshIdentityAndProvider() }
    }

    private suspend fun refreshProviderStatus() {
        if (connectJob?.isActive == true) return
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "في انتظار إضافة قائمة" else "جاهز • القائمة النشطة: ${provider.name}"
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
        textSize = 15f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view, focused ->
            if (tv) {
                view.background = buttonBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).translationZ(if (focused) 12f else 1f).setDuration(100).start()
            }
        }
        setOnClickListener { action() }
    }

    private fun primaryActionButton(label: String, action: () -> Unit) = Button(this).apply {
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label
        isAllCaps = false
        textSize = 16f
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        background = primaryButtonBackground(false)
        setOnFocusChangeListener { view, focused ->
            if (tv) {
                view.background = primaryButtonBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).translationZ(if (focused) 16f else 2f).setDuration(105).start()
            }
        }
        setOnClickListener { action() }
    }

    private fun label(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(0xFFAA9AB8.toInt())
        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
    }

    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
    private fun subtitle(value: String) = TextView(this).apply { text = value; textSize = 16f; setTextColor(theme.accent); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(16)) }

    private fun panelBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xF0181023.toInt(), 0xF40A0710.toInt())
    ).apply {
        cornerRadius = dp(26).toFloat()
        setStroke(dp(1), 0xFF5F3B7B.toInt())
    }

    private fun fieldBackground() = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(0xCC0B0811.toInt())
        setStroke(dp(1), 0xFF392849.toInt())
    }

    private fun statusBackground() = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xC81A1023.toInt(), 0xC9110B18.toInt())
    ).apply {
        cornerRadius = dp(16).toFloat()
        setStroke(dp(1), 0xFF3D2A4B.toInt())
    }

    private fun playlistCardBackground(active: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        when {
            focused -> intArrayOf(0xFF7131AF.toInt(), 0xFF3B175D.toInt())
            active -> intArrayOf(0xE72C1840.toInt(), 0xEE171022.toInt())
            else -> intArrayOf(0xE5161020.toInt(), 0xEE0D0912.toInt())
        }
    ).apply {
        cornerRadius = dp(16).toFloat()
        setStroke(if (focused) dp(2) else dp(1), when { focused -> 0xFFE4C5FF.toInt(); active -> 0xFF8D5DB5.toInt(); else -> 0xFF463354.toInt() })
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(if (focused) 0xFF48236B.toInt() else 0xFF17111F.toInt())
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFD7AAFF.toInt() else 0xFF4B365C.toInt())
    }

    private fun primaryButtonBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(if (focused) 0xFF7A32DA.toInt() else 0xFF6030A7.toInt(), if (focused) 0xFFC85BC7.toInt() else 0xFF8E3FA4.toInt())
    ).apply {
        cornerRadius = dp(16).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0xFFC98BE6.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
