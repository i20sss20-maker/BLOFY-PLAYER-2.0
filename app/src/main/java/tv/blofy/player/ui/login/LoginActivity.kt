package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
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
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationPortalUrl
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrView: ImageView
    private lateinit var status: TextView
    private lateinit var addButton: Button
    private lateinit var updateButton: Button
    private lateinit var connectButton: Button
    private var updateJob: Job? = null
    private var connectJob: Job? = null
    private val isTv by lazy { DeviceClass.detect(this) == DeviceClass.Kind.TV }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = V339Ui.BLACK
        window.navigationBarColor = V339Ui.BLACK
        setContentView(buildUi())
        if (isTv) connectButton.requestFocus()
        lifecycleScope.launch { refreshIdentity() }
    }

    /** Composition transplanted from v339 MainActivity playlist hub/devicePanel. */
    private fun buildUi(): View {
        createIdentityViews()
        val page = LinearLayout(this).apply {
            orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), dp(26), dp(34), dp(26))
            background = V339Ui.screenGradient()
        }

        val device = devicePanel()
        page.addView(device, LinearLayout.LayoutParams(if (isTv) dp(300) else ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(dp(8), dp(8), dp(20), dp(8)) })

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(32), dp(26), dp(32), dp(26))
            background = V339Ui.gradientPanel(this@LoginActivity,
                Color.argb(246, 13, 11, 24), Color.argb(244, 7, 7, 15), 24, V339Ui.STROKE)
        }
        content.addView(V339Ui.title(this, "قوائم التشغيل", 30f).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        content.addView(V339Ui.text(this, "حدّث بيانات الموقع ثم اضغط اتصال", 14f, V339Ui.MUTED).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)))

        val spacer = View(this)
        content.addView(spacer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        connectButton = V339Ui.button(this, "اتصال", true).apply {
            textSize = 16f; isFocusable = isTv; isFocusableInTouchMode = isTv
            setOnClickListener { connect() }
        }
        updateButton = V339Ui.button(this, "↻  تحديث", false).apply {
            textSize = 16f; isFocusable = isTv; isFocusableInTouchMode = isTv
            setOnClickListener { refreshFromPortal() }
        }
        addButton = V339Ui.button(this, "＋  إضافة قائمة التشغيل", false).apply {
            textSize = 16f; isFocusable = isTv; isFocusableInTouchMode = isTv
            setOnClickListener { startActivity(Intent(this@LoginActivity, PlaylistActivity::class.java)) }
        }
        content.addView(connectButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)).apply { bottomMargin = dp(10) })
        content.addView(updateButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)).apply { bottomMargin = dp(10) })
        content.addView(addButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
        content.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)).apply { topMargin = dp(8) })

        page.addView(content, LinearLayout.LayoutParams(if (isTv) 0 else ViewGroup.LayoutParams.MATCH_PARENT,
            if (isTv) dp(470) else ViewGroup.LayoutParams.WRAP_CONTENT, if (isTv) 1f else 0f).apply {
            setMargins(dp(8), dp(8), dp(8), dp(8))
        })

        return ScrollView(this).apply {
            isFillViewport = true
            addView(page)
        }
    }

    private fun devicePanel(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(20), dp(18), dp(20), dp(18))
        background = V339Ui.gradientPanel(this@LoginActivity,
            Color.argb(238, 25, 18, 46), Color.argb(240, 10, 10, 21), 22, Color.rgb(75, 48, 116))
        addView(ImageView(this@LoginActivity).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }, LinearLayout.LayoutParams(dp(88), dp(88)))
        addView(V339Ui.title(this@LoginActivity, "جهاز BLOFY", 17f).apply { gravity = Gravity.CENTER })
        addView(deviceView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))
        addView(codeView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)))
        addView(qrView, LinearLayout.LayoutParams(dp(142), dp(142)).apply { topMargin = dp(12) })
        addView(V339Ui.text(this@LoginActivity, "امسح الرمز لإدارة الجهاز", 11f, V339Ui.MUTED).apply {
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)))
    }

    private fun createIdentityViews() {
        deviceView = V339Ui.title(this, "غير مسجل", 20f).apply {
            textDirection = View.TEXT_DIRECTION_LTR
            gravity = Gravity.CENTER
            setTextIsSelectable(true)
        }
        codeView = V339Ui.text(this, "رمز الدخول   ------", 14f, V339Ui.PURPLE_LIGHT).apply {
            typeface = Typeface.DEFAULT_BOLD
            textDirection = View.TEXT_DIRECTION_LTR
            gravity = Gravity.CENTER
            setTextIsSelectable(true)
        }
        qrView = ImageView(this).apply {
            setBackgroundColor(Color.WHITE)
            setPadding(dp(7), dp(7), dp(7), dp(7))
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "رمز BLOFY"
        }
        status = V339Ui.text(this, "", 12f, V339Ui.MUTED).apply { gravity = Gravity.CENTER }
    }

    private fun connect() {
        if (connectJob?.isActive == true) return
        connectJob = lifecycleScope.launch {
            connectButton.isEnabled = false
            connectButton.text = "جاري الاتصال..."
            try {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() }
                if (provider == null) {
                    status.text = "لا توجد قائمة تشغيل — اضغط تحديث بعد حفظها في الموقع"
                    return@launch
                }
                withContext(Dispatchers.IO) { dao.saveAndActivateProvider(provider.copy(enabled = true)) }
                if (hasCachedCatalog(dao, provider.id)) {
                    status.text = "تم الاتصال"
                    openHome()
                } else {
                    status.text = "جاري تحميل المحتوى"
                    openCatalogLoading(provider.id)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status.text = "تعذر الاتصال" }
            finally {
                connectButton.isEnabled = true
                connectButton.text = "اتصال"
                connectJob = null
            }
        }
    }

    private fun refreshFromPortal() {
        if (updateJob?.isActive == true) return
        updateJob = lifecycleScope.launch {
            updateButton.isEnabled = false
            updateButton.text = "جاري التحديث..."
            status.text = "جاري جلب البيانات من الموقع"
            try {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                if (endpoint.isBlank()) {
                    status.text = if (dao.providers().first().firstOrNull() == null) "لا توجد قائمة تشغيل" else "القائمة محفوظة — اضغط اتصال"
                    return@launch
                }
                val manager = ActivationManager(applicationContext, dao)
                runCatching { withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME) } }
                val sync = withContext(Dispatchers.IO) { PortalPlaylistClient.sync(applicationContext, endpoint, dao) }
                val provider = sync.activeProvider
                if (provider == null) {
                    status.text = "لم توجد قائمة في الموقع"
                    return@launch
                }
                withContext(Dispatchers.IO) { dao.saveAndActivateProvider(provider.copy(enabled = true)) }
                status.text = if (provider.id in sync.changedProviderIds || !hasCachedCatalog(dao, provider.id)) {
                    "تم التحديث — اضغط اتصال لتحميل القائمة"
                } else {
                    "تم التحديث — اضغط اتصال"
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status.text = "تعذر التحديث" }
            finally {
                updateButton.isEnabled = true
                updateButton.text = "↻  تحديث"
                updateJob = null
            }
        }
    }

    private suspend fun refreshIdentity() {
        val identity = withContext(Dispatchers.IO) {
            ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
        }
        deviceView.text = identity.deviceId
        codeView.text = "رمز الدخول   ${identity.activationCode}"
        val portalUrl = ActivationPortalUrl.create(BuildConfig.ACTIVATION_BASE_URL, identity.deviceId, identity.activationCode)
            ?: "$PORTAL_FALLBACK/#deviceId=${identity.deviceId}&code=${identity.activationCode}"
        qrView.setImageBitmap(createQr(portalUrl))
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "" else "القائمة محفوظة — اضغط اتصال"
    }

    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean = withContext(Dispatchers.IO) {
        CatalogSyncState.isReady(applicationContext, providerId) && dao.allStreamsForProvider(providerId).isNotEmpty()
    }

    private fun openCatalogLoading(providerId: String) {
        CatalogSyncState.markPending(applicationContext, providerId)
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }
    private fun openHome() { startActivity(Intent(this, HomeActivity::class.java)) }
    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).apply {
            for (y in 0 until matrix.height) for (x in 0 until matrix.width) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }
    private fun dp(value: Int) = V339Ui.dp(this, value)

    companion object { private const val PORTAL_FALLBACK = "https://blofy-player-2-0.vercel.app" }
}
