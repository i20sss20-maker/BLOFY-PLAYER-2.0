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
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var status: TextView
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
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvLogin() else buildPhoneLogin())
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
        lifecycleScope.launch { refreshIdentityAndProvider() }
    }

    private fun buildTvLogin(): LinearLayout {
        createIdentityViews(false)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), dp(16), dp(34), dp(18))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(4), 0, dp(4), 0)
        }
        header.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }, LinearLayout.LayoutParams(dp(126), dp(74)))
        val headerText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        headerText.addView(TextView(this).apply {
            text = "BLOFY PLAYER  •  PREMIUM"
            textSize = 11.5f
            letterSpacing = .11f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        headerText.addView(TextView(this).apply {
            text = "كل شيء يبدأ من هنا"
            textSize = 31f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
            includeFontPadding = false
        })
        headerText.addView(TextView(this).apply {
            text = "فعّل جهازك، اختر قائمتك، وادخل مباشرة إلى BLOFY"
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
        })
        header.addView(headerText, LinearLayout.LayoutParams(0, dp(78), 1f).apply { marginEnd = dp(12) })
        header.addView(TextView(this).apply {
            text = "●  SECURE ACCESS"
            textSize = 11.5f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.CENTER
            background = secureBadge()
        }, LinearLayout.LayoutParams(dp(154), dp(40)))
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(86)))

        val workspace = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER
            clipChildren = false
            clipToPadding = false
        }

        val activation = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(17), dp(24), dp(17))
            background = premiumPanelBackground(true)
            elevation = dp(9).toFloat()
            clipChildren = false
        }
        activation.addView(TextView(this).apply {
            text = "تفعيل جهاز BLOFY"
            textSize = 22f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        })
        activation.addView(TextView(this).apply {
            text = "امسح الرمز بالكاميرا لإدارة هذا الجهاز بسرعة"
            textSize = 12.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, dp(3), 0, dp(9))
        })

        val qrFrame = FrameLayout(this).apply {
            background = qrGlowBackground()
            elevation = dp(10).toFloat()
            setPadding(dp(9), dp(9), dp(9), dp(9))
            addView(qrView, FrameLayout.LayoutParams(-1, -1))
            addView(TextView(this@LoginActivity).apply {
                text = "SCAN TO ACTIVATE"
                textSize = 9.5f
                letterSpacing = .08f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(0xFF6E3FA4.toInt())
                gravity = Gravity.CENTER
                background = GradientDrawable().apply {
                    cornerRadius = dp(10).toFloat()
                    setColor(0xFFF8F3FF.toInt())
                }
            }, FrameLayout.LayoutParams(dp(128), dp(25), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(8) })
        }
        activation.addView(qrFrame, LinearLayout.LayoutParams(dp(218), dp(218)))

        val steps = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            setPadding(0, dp(9), 0, dp(4))
        }
        steps.addView(stepChip("1", "امسح QR"), LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginStart = dp(4) })
        steps.addView(stepChip("2", "أضف قائمتك"), LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginStart = dp(4); marginEnd = dp(4) })
        steps.addView(stepChip("3", "ابدأ المشاهدة"), LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginEnd = dp(4) })
        activation.addView(steps, LinearLayout.LayoutParams(-1, dp(51)))

        activation.addView(label("رقم الجهاز"), LinearLayout.LayoutParams(-1, dp(24)).apply { topMargin = dp(2) })
        deviceView.apply {
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
            background = premiumFieldBackground(false)
            setTextColor(BlofyTvDesign.TextPrimary)
        }
        activation.addView(deviceView, LinearLayout.LayoutParams(-1, dp(49)))
        activation.addView(label("رمز الربط"), LinearLayout.LayoutParams(-1, dp(24)).apply { topMargin = dp(5) })
        codeView.apply {
            textSize = 30f
            letterSpacing = .18f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.PurpleBright)
            background = premiumFieldBackground(true)
        }
        activation.addView(codeView, LinearLayout.LayoutParams(-1, dp(57)))
        status.apply {
            textSize = 12.8f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.PurpleSoft)
            background = statusBackground()
            setPadding(dp(12), 0, dp(12), 0)
        }
        activation.addView(status, LinearLayout.LayoutParams(-1, dp(39)).apply { topMargin = dp(8) })
        refreshCodeButton = actionButton("↻  تحديث حالة التفعيل") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        activation.addView(refreshCodeButton, LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(8) })

        val playlistsPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            setPadding(dp(25), dp(20), dp(25), dp(20))
            background = premiumPanelBackground(false)
            elevation = dp(8).toFloat()
            clipChildren = false
        }
        val playlistHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        playlistHeader.addView(TextView(this).apply {
            text = "قوائم التشغيل"
            textSize = 24f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        playlistHeader.addView(TextView(this).apply {
            text = "● جاهز للدخول"
            textSize = 11.8f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.CENTER
            background = secureBadge()
        }, LinearLayout.LayoutParams(dp(138), dp(36)))
        playlistsPanel.addView(playlistHeader)
        playlistsPanel.addView(TextView(this).apply {
            text = "اختر قائمتك المحفوظة أو أضف قائمة جديدة. العودة لاحقًا تفتح من الكاش مباشرة."
            textSize = 13.2f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(2), 0, dp(12))
        })
        playlistsPanel.addView(featureStrip(), LinearLayout.LayoutParams(-1, dp(72)).apply { bottomMargin = dp(12) })

        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
        }
        playlistRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            addView(emptyPlaylistView("ما عندك قوائم إلى الآن • اضغط إضافة / إدارة"), LinearLayout.LayoutParams(-1, dp(86)))
        }
        scroll.addView(playlistRow, FrameLayout.LayoutParams(-1, -2))
        playlistsPanel.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }
        addPlaylist = primaryActionButton("＋  إضافة / إدارة القوائم") { startActivity(Intent(this@LoginActivity, PlaylistActivity::class.java)) }
        connectButton = actionButton("▶  دخول إلى BLOFY") { startOrCancelConnect() }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginStart = dp(8) })
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(58), 1f))
        playlistsPanel.addView(actions)

        workspace.addView(activation, LinearLayout.LayoutParams(0, -1, .88f).apply { marginEnd = dp(12) })
        workspace.addView(playlistsPanel, LinearLayout.LayoutParams(0, -1, 1.12f).apply { marginStart = dp(12) })
        root.addView(workspace, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(7) })
        root.addView(TextView(this).apply {
            text = "BLOFY SECURE SESSION  •  بياناتك محفوظة محليًا  •  القوائم لا يعاد تحميلها عند كل دخول"
            textSize = 11.5f
            letterSpacing = .02f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, dp(27)).apply { topMargin = dp(3) })
        return root
    }

    private fun buildPhoneLogin(): LinearLayout {
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
        root.addView(qrView, LinearLayout.LayoutParams(dp(180), dp(180)).apply { topMargin = dp(12) })
        status.background = statusBackground(); root.addView(status, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        addPlaylist = primaryActionButton("إضافة / إدارة القوائم") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        connectButton = actionButton("دخول") { startOrCancelConnect() }
        refreshCodeButton = actionButton("تحديث") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        root.addView(addPlaylist, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(12) })
        root.addView(connectButton, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(10) })
        return root
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
            contentDescription = "رمز تفعيل BLOFY"
            background = qrBackground()
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

    private fun stepChip(number: String, textValue: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        background = stepBackground()
        addView(TextView(this@LoginActivity).apply {
            text = number
            textSize = 11f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFF8246D9.toInt()) }
        }, LinearLayout.LayoutParams(dp(24), dp(24)).apply { marginStart = dp(6) })
        addView(TextView(this@LoginActivity).apply {
            text = textValue
            textSize = 10.8f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER
            maxLines = 1
        })
    }

    private fun featureStrip() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        gravity = Gravity.CENTER
        background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF2B183C.toInt(), 0xFF1B1328.toInt())).apply {
            cornerRadius = dp(17).toFloat()
            setStroke(dp(1), 0xFF5D3E77.toInt())
        }
        addView(featurePoint("⚡", "فتح سريع", "من الكاش"), LinearLayout.LayoutParams(0, -1, 1f))
        addView(featurePoint("✓", "قائمة آمنة", "محفوظة محليًا"), LinearLayout.LayoutParams(0, -1, 1f))
        addView(featurePoint("◉", "جهاز واحد", "هوية مستقرة"), LinearLayout.LayoutParams(0, -1, 1f))
    }

    private fun featurePoint(icon: String, title: String, caption: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        addView(TextView(this@LoginActivity).apply { text = icon; textSize = 17f; setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.CENTER })
        addView(TextView(this@LoginActivity).apply { text = title; textSize = 11.5f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.CENTER })
        addView(TextView(this@LoginActivity).apply { text = caption; textSize = 9.5f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER })
    }

    private fun startOrCancelConnect() {
        if (connectJob?.isActive == true) { connectJob?.cancel(); status.text = "تم إلغاء الاتصال"; return }
        connectJob = lifecycleScope.launch {
            connectButton.text = "إلغاء"
            try { connectFlow() } catch (_: CancellationException) { }
            finally { connectButton.text = "▶  دخول إلى BLOFY"; connectJob = null }
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
            val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }
            renderIdentity(identity.deviceId, identity.activationCode)
        }
        result.onSuccess { remote ->
            if (!remote.canUse()) { status.text = activationLabel(remote); return@onSuccess }
            val portalSync = runSuspendCatching { PortalPlaylistClient.sync(applicationContext, endpoint, dao) }.getOrNull()
            renderPortalPlaylists(portalSync?.providers.orEmpty())
            val activeProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull()
            if (activeProvider == null) { status.text = "الجهاز مفعل • أضف قائمة"; addPlaylist.requestFocus(); return@onSuccess }
            withContext(Dispatchers.IO) { dao.upsertProvider(activeProvider) }
            val ready = hasCachedCatalog(dao, activeProvider.id)
            val changed = portalSync?.changedProviderIds?.contains(activeProvider.id) == true
            if (changed || !ready) { status.text = "جاري تجهيز ${activeProvider.name}"; openCatalogLoading(activeProvider.id); return@onSuccess }
            withContext(Dispatchers.IO) { dao.saveAndActivateProvider(activeProvider) }
            applyRemoteProviderProfile(endpoint, dao, activeProvider.id)
            openHome()
        }.onFailure {
            val cached = withContext(Dispatchers.IO) { dao.activation() }
            val provider = dao.providers().first().firstOrNull()
            if (cached != null && manager.cachedCanUse(cached) && provider != null && hasCachedCatalog(dao, provider.id)) openHome()
            else status.text = "تعذر التحقق من التفعيل"
        }
    }

    private fun selectPortalProvider(provider: ProviderEntity) {
        if (playlistJob?.isActive == true) return
        playlistJob = lifecycleScope.launch {
            val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
            val dao = BlofyDatabase.get(applicationContext).dao()
            val existing = withContext(Dispatchers.IO) { dao.provider(provider.id) }
            val changed = existing == null || existing.baseUrl != provider.baseUrl || existing.username != provider.username || existing.password != provider.password || existing.providerType != provider.providerType
            status.text = "جاري اختيار ${provider.name}..."
            runSuspendCatching { PortalPlaylistClient.selectProvider(applicationContext, endpoint, provider, dao) }.onSuccess { selected ->
                renderPortalPlaylists(loadPortalProviders(endpoint, dao))
                if (!changed && hasCachedCatalog(dao, selected.id)) { applyRemoteProviderProfile(endpoint, dao, selected.id); openHome() }
                else { status.text = "جاري تجهيز ${selected.name}"; openCatalogLoading(selected.id) }
            }.onFailure { status.text = "تعذر اختيار القائمة • حاول مرة أخرى" }
            playlistJob = null
        }
    }

    private suspend fun loadPortalProviders(endpoint: String, dao: BlofyDao): List<ProviderEntity> =
        if (endpoint.isBlank()) dao.allProviders().first()
        else runSuspendCatching { PortalPlaylistClient.sync(applicationContext, endpoint, dao).providers }.getOrElse { dao.allProviders().first() }

    private fun renderPortalPlaylists(allProviders: List<ProviderEntity>) {
        val providers = tv.blofy.player.core.identity.PortalSyncBook.visible(this, allProviders)
        val row = playlistRow ?: return
        row.removeAllViews()
        if (providers.isEmpty()) {
            row.addView(emptyPlaylistView("ما عندك قوائم إلى الآن • اضغط إضافة / إدارة"), LinearLayout.LayoutParams(-1, dp(86)))
            return
        }
        providers.sortedWith(compareByDescending<ProviderEntity> { it.enabled }.thenByDescending { it.updatedAt }).forEach { provider ->
            row.addView(playlistCard(provider), LinearLayout.LayoutParams(-1, dp(80)).apply { bottomMargin = dp(9) })
        }
    }

    private fun playlistCard(provider: ProviderEntity) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(17), dp(8), dp(17), dp(8))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = playlistCardBackground(provider.enabled, false)
        val info = LinearLayout(this@LoginActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        info.addView(TextView(this@LoginActivity).apply {
            text = provider.name
            textSize = 16f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = 1
            gravity = Gravity.RIGHT
        })
        info.addView(TextView(this@LoginActivity).apply {
            val type = if (provider.providerType.equals("xtream", true)) "Xtream" else "M3U"
            text = if (provider.enabled) "● القائمة النشطة   •   $type" else "$type   •   اضغط OK للدخول"
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(if (provider.enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
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
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            addView(TextView(this@LoginActivity).apply { text = "ابدأ بإضافة أول قائمة"; textSize = 14f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.RIGHT })
            addView(TextView(this@LoginActivity).apply { text = message; textSize = 11.5f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT })
        }, LinearLayout.LayoutParams(0, -1, 1f))
    }

    private fun openCatalogLoading(providerId: String) {
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }

    private suspend fun refreshIdentityAndProvider() {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val identity = withContext(Dispatchers.IO) { ActivationManager(applicationContext, dao).ensureIdentity() }
        renderIdentity(identity.deviceId, identity.activationCode)
        refreshProviderStatus()
        renderPortalPlaylists(loadPortalProviders(BuildConfig.ACTIVATION_BASE_URL.trim(), dao))
    }

    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean = withContext(Dispatchers.IO) {
        CatalogSyncState.isFullyReady(applicationContext, providerId) && dao.hasStreamsForProvider(providerId)
    }

    private suspend fun <T> runSuspendCatching(block: suspend () -> T): Result<T> = try { Result.success(block()) }
    catch (c: CancellationException) { throw c }
    catch (e: Throwable) { Result.failure(e) }

    private fun renderIdentity(deviceId: String, activationCode: String) {
        deviceView.text = deviceId
        codeView.text = activationCode
        val url = ActivationPortalUrl.create(BuildConfig.ACTIVATION_BASE_URL, deviceId, activationCode)
        if (url != null) qrView.setImageBitmap(createQr(url)) else qrView.setImageDrawable(null)
    }

    private suspend fun applyRemoteProviderProfile(endpoint: String, dao: BlofyDao, providerId: String) {
        val current = dao.provider(providerId) ?: return
        val updated = RemoteProviderProfileClient.applyIfAvailable(applicationContext, endpoint, current)
        if (updated != current) dao.upsertProvider(updated)
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
        if (::status.isInitialized && connectJob?.isActive != true) lifecycleScope.launch { refreshIdentityAndProvider() }
    }

    private suspend fun refreshProviderStatus() {
        if (connectJob?.isActive == true) return
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "في انتظار إضافة قائمة" else "● جاهز • ${provider.name}"
    }

    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.RGB_565).apply {
            for (y in 0 until matrix.height) for (x in 0 until matrix.width) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
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

    private fun label(value: String) = TextView(this).apply {
        text = value
        textSize = 12.2f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(BlofyTvDesign.TextMuted)
        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
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

    private fun qrGlowBackground() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFFB56BFF.toInt(), 0xFF6C35B5.toInt(), 0xFF3F215E.toInt())).apply {
        cornerRadius = dp(24).toFloat()
        setStroke(dp(2), 0xFFD7B2FF.toInt())
    }

    private fun secureBadge() = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(0x221FCB91)
        setStroke(dp(1), 0x6654D3A9)
    }

    private fun stepBackground() = GradientDrawable().apply {
        cornerRadius = dp(13).toFloat()
        setColor(0xFF1E152A.toInt())
        setStroke(dp(1), 0xFF4D365F.toInt())
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
