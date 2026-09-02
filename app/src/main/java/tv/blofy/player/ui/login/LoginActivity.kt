package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
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
import tv.blofy.player.ui.common.TvUiTuning
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
        TvUiTuning.enter(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvLogin() else buildPhoneLogin())
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
        lifecycleScope.launch { refreshIdentityAndProvider() }
    }

    private fun buildTvLogin(): LinearLayout {
        createIdentityViews(false)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(BlofyTvDesign.ScreenPadding), dp(18), dp(BlofyTvDesign.ScreenPadding), dp(20))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        header.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(112), dp(68)))
        val headerText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        headerText.addView(TextView(this).apply { text = "BLOFY PLAYER"; textSize = sp(12.5f); letterSpacing = .12f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.RIGHT })
        headerText.addView(TextView(this).apply { text = "جاهز للمشاهدة"; textSize = sp(30f); typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.RIGHT; includeFontPadding = false })
        headerText.addView(TextView(this).apply { text = "تفعيل الجهاز وإدارة القوائم من شاشة واحدة"; textSize = sp(14f); typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextSecondary); gravity = Gravity.RIGHT })
        header.addView(headerText, LinearLayout.LayoutParams(0, dp(76), 1f).apply { marginEnd = dp(12) })
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(82)))

        val workspace = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR; gravity = Gravity.CENTER; clipChildren = false; clipToPadding = false }
        val activation = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(24), dp(18), dp(24), dp(18)); background = panelBackground(true); elevation = dp(7).toFloat() }
        activation.addView(TextView(this).apply { text = "تفعيل الجهاز"; textSize = sp(21f); typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.CENTER })
        activation.addView(TextView(this).apply { text = "امسح QR أو استخدم رقم الجهاز ورمز الربط"; textSize = sp(12.5f); typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER; setPadding(0, dp(4), 0, dp(10)) })
        activation.addView(qrView, LinearLayout.LayoutParams(dp(188), dp(188)))
        activation.addView(label("رقم الجهاز"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(27)).apply { topMargin = dp(9) })
        deviceView.apply { textSize = sp(18f); gravity = Gravity.CENTER; setPadding(dp(12), 0, dp(12), 0); background = fieldBackground(); setTextColor(BlofyTvDesign.TextPrimary) }
        activation.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50)))
        activation.addView(label("رمز الربط"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(27)).apply { topMargin = dp(7) })
        codeView.apply { textSize = sp(29f); letterSpacing = .16f; gravity = Gravity.CENTER; setTextColor(BlofyTvDesign.PurpleBright); background = fieldBackground() }
        activation.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))
        status.apply { textSize = sp(13f); gravity = Gravity.CENTER; setTextColor(BlofyTvDesign.PurpleSoft); background = statusBackground(); setPadding(dp(12), 0, dp(12), 0) }
        activation.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)).apply { topMargin = dp(9) })
        refreshCodeButton = actionButton("↻  تحديث التفعيل") { lifecycleScope.launch { refreshIdentityAndProvider() } }
        activation.addView(refreshCodeButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(9) })

        val playlistsPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.TOP; setPadding(dp(25), dp(20), dp(25), dp(20)); background = panelBackground(false); elevation = dp(7).toFloat() }
        val playlistHeader = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
        playlistHeader.addView(TextView(this).apply { text = "قوائم التشغيل"; textSize = sp(23f); typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.RIGHT }, LinearLayout.LayoutParams(0, dp(40), 1f))
        playlistHeader.addView(TextView(this).apply { text = "● جاهز"; textSize = sp(12.5f); typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.Mint); gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(dp(120), dp(40)))
        playlistsPanel.addView(playlistHeader)
        playlistsPanel.addView(TextView(this).apply { text = "اختر القائمة التي تريدها ثم ادخل مباشرة — البيانات المحفوظة تفتح من الكاش"; textSize = sp(13.5f); typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT; setPadding(0, 0, 0, dp(12)) })
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER }
        playlistRow = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.TOP; addView(emptyPlaylistView("بعد إضافة القوائم ستظهر هنا"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(70))) }
        scroll.addView(playlistRow, android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.WRAP_CONTENT))
        playlistsPanel.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER; setPadding(0, dp(10), 0, 0) }
        addPlaylist = primaryActionButton("＋  إضافة / إدارة") { startActivity(Intent(this@LoginActivity, PlaylistActivity::class.java)) }
        connectButton = actionButton("▶  دخول") { startOrCancelConnect() }
        actions.addView(addPlaylist, LinearLayout.LayoutParams(0, dp(56), 1f).apply { marginStart = dp(8) }); actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(56), 1f)); playlistsPanel.addView(actions)
        workspace.addView(activation, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, .84f).apply { marginEnd = dp(12) }); workspace.addView(playlistsPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.16f).apply { marginStart = dp(12) })
        root.addView(workspace, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })
        root.addView(TextView(this).apply { text = "بياناتك محفوظة محليًا • لا نعيد تحميل القوائم عند كل دخول"; textSize = sp(12f); typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(26)).apply { topMargin = dp(4) })
        return root
    }

    private fun buildPhoneLogin(): LinearLayout {
        createIdentityViews(true)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; setPadding(dp(24), dp(24), dp(24), dp(24)); background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background) }
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(dp(150), dp(82)))
        root.addView(title("BLOFY PLAYER", 29f)); root.addView(subtitle("فعّل جهازك ثم اختر قائمة التشغيل")); deviceView.background = fieldBackground(); root.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54))); codeView.background = fieldBackground(); root.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(8) }); root.addView(qrView, LinearLayout.LayoutParams(dp(180), dp(180)).apply { topMargin = dp(12) }); status.background = statusBackground(); root.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(10) })
        addPlaylist = primaryActionButton("إضافة / إدارة القوائم") { startActivity(Intent(this, PlaylistActivity::class.java)) }; connectButton = actionButton("دخول") { startOrCancelConnect() }; refreshCodeButton = actionButton("تحديث") { lifecycleScope.launch { refreshIdentityAndProvider() } }; root.addView(addPlaylist, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)).apply { topMargin = dp(12) }); root.addView(connectButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)).apply { topMargin = dp(10) }); return root
    }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply { text = "جاري إنشاء هوية الجهاز..."; textSize = if (phone) 17f else sp(21f); typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); gravity = Gravity.CENTER; setPadding(dp(12), 0, dp(12), 0) }
        codeView = TextView(this).apply { textSize = if (phone) 25f else sp(34f); typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.CENTER }
        qrView = ImageView(this).apply { contentDescription = "رمز تفعيل BLOFY"; background = qrBackground(); setPadding(dp(12), dp(12), dp(12), dp(12)) }
        status = TextView(this).apply { textSize = if (phone) 14f else sp(14f); typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.PurpleSoft); gravity = Gravity.CENTER; setPadding(dp(10), dp(8), dp(10), dp(8)) }
    }

    private fun startOrCancelConnect() { if (connectJob?.isActive == true) { connectJob?.cancel(); status.text = "تم إلغاء الاتصال"; return }; connectJob = lifecycleScope.launch { connectButton.text = "إلغاء"; try { connectFlow() } catch (_: CancellationException) { } finally { connectButton.text = "▶  دخول"; connectJob = null } } }
    private suspend fun connectFlow() {
        val dao = BlofyDatabase.get(applicationContext).dao(); val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) { val localProvider = dao.providers().first().firstOrNull(); if (localProvider == null) { status.text = "أضف قائمة تشغيل أولاً"; return }; if (hasCachedCatalog(dao, localProvider.id)) openHome() else openCatalogLoading(localProvider.id); return }
        status.text = "جاري التحقق من تفعيل الجهاز..."; val manager = ActivationManager(applicationContext, dao); val result = runSuspendCatching { withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME) } }
        if (result.isSuccess) { val identity = withContext(Dispatchers.IO) { manager.ensureIdentity() }; renderIdentity(identity.deviceId, identity.activationCode) }
        result.onSuccess { remote -> if (!remote.canUse()) { status.text = activationLabel(remote); return@onSuccess }; val portalSync = runSuspendCatching { PortalPlaylistClient.sync(applicationContext, endpoint, dao) }.getOrNull(); renderPortalPlaylists(portalSync?.providers.orEmpty()); val activeProvider = portalSync?.activeProvider ?: dao.providers().first().firstOrNull(); if (activeProvider == null) { status.text = "الجهاز مفعل • أضف قائمة"; addPlaylist.requestFocus(); return@on