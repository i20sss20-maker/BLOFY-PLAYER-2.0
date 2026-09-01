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
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationPortalUrl
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrView: ImageView
    private lateinit var status: TextView
    private lateinit var addButton: Button
    private lateinit var updateButton: Button
    private var updateJob: Job? = null
    private val isTv by lazy { DeviceClass.detect(this) == DeviceClass.Kind.TV }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        if (isTv) addButton.requestFocus()
        lifecycleScope.launch { refreshIdentity() }
    }

    private fun buildUi(): LinearLayout {
        createIdentityViews()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (isTv) 72 else 24), dp(if (isTv) 26 else 24), dp(if (isTv) 72 else 24), dp(if (isTv) 26 else 24))
            background = AppCompatResources.getDrawable(this@LoginActivity, R.drawable.blofy_home_background)
        }

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(if (isTv) 150 else 128), dp(if (isTv) 92 else 76)).apply { bottomMargin = dp(8) })

        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = if (isTv) 29f else 25f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "أضف القائمة من الموقع ثم اضغط تحديث"
            textSize = if (isTv) 15f else 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(14))
        })

        val card = LinearLayout(this).apply {
            orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = if (isTv) View.LAYOUT_DIRECTION_LTR else View.LAYOUT_DIRECTION_RTL
            setPadding(dp(22), dp(20), dp(22), dp(20))
            background = panelBackground()
        }

        val qrPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        qrPanel.addView(qrView, LinearLayout.LayoutParams(dp(if (isTv) 230 else 190), dp(if (isTv) 230 else 190)))
        qrPanel.addView(TextView(this).apply {
            text = "امسح الرمز لفتح موقع BLOFY PLAYER"
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(9), 0, 0)
        })

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(if (isTv) dp(30) else 0, if (isTv) 0 else dp(18), 0, 0)
        }
        info.addView(label("رقم الجهاز"))
        info.addView(deviceView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(5); bottomMargin = dp(10) })
        info.addView(label("رمز الربط"))
        info.addView(codeView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply { topMargin = dp(5) })
        info.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(10) })

        if (isTv) {
            card.addView(qrPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 0.88f))
            card.addView(info, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.12f))
        } else {
            card.addView(qrPanel)
            card.addView(info, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(card, LinearLayout.LayoutParams(if (isTv) dp(900) else LinearLayout.LayoutParams.MATCH_PARENT, if (isTv) dp(385) else LinearLayout.LayoutParams.WRAP_CONTENT))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(16), 0, 0)
        }
        addButton = actionButton("إضافة قائمة التشغيل", primary = false) {
            startActivity(Intent(this, PlaylistActivity::class.java))
        }
        updateButton = actionButton("تحديث", primary = true) { refreshFromPortal() }
        actions.addView(updateButton, LinearLayout.LayoutParams(0, dp(66), 1f).apply { marginStart = dp(7); marginEnd = dp(7) })
        actions.addView(addButton, LinearLayout.LayoutParams(0, dp(66), 1f).apply { marginStart = dp(7); marginEnd = dp(7) })
        root.addView(actions, LinearLayout.LayoutParams(if (isTv) dp(760) else LinearLayout.LayoutParams.MATCH_PARENT, dp(84)))
        return root
    }

    private fun createIdentityViews() {
        deviceView = TextView(this).apply {
            text = "..."
            textSize = if (isTv) 20f else 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL or Gravity.LEFT
            setPadding(dp(18), 0, dp(18), 0)
            background = fieldBackground()
        }
        codeView = TextView(this).apply {
            text = "------"
            textSize = if (isTv) 36f else 28f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = .16f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = fieldBackground()
        }
        qrView = ImageView(this).apply {
            setBackgroundColor(Color.WHITE)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            contentDescription = "رمز BLOFY"
        }
        status = TextView(this).apply {
            text = "جاهز"
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
        }
    }

    private fun refreshFromPortal() {
        if (updateJob?.isActive == true) return
        updateJob = lifecycleScope.launch {
            updateButton.isEnabled = false
            updateButton.text = "جاري التحديث..."
            status.text = "جاري جلب بيانات الموقع"
            try {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                if (endpoint.isBlank()) {
                    val local = dao.providers().first().firstOrNull()
                    if (local == null) status.text = "أضف قائمة تشغيل أولاً"
                    else if (hasCachedCatalog(dao, local.id)) openHome() else openCatalogLoading(local.id)
                    return@launch
                }

                val manager = ActivationManager(applicationContext, dao)
                runCatching {
                    withContext(Dispatchers.IO) { manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME) }
                }

                val sync = withContext(Dispatchers.IO) { PortalPlaylistClient.sync(applicationContext, endpoint, dao) }
                val provider = sync.activeProvider
                if (provider == null) {
                    status.text = "لم توجد قائمة في الموقع"
                    return@launch
                }

                withContext(Dispatchers.IO) { dao.upsertProvider(provider.copy(enabled = true)) }
                val changed = provider.id in sync.changedProviderIds
                if (changed || !hasCachedCatalog(dao, provider.id)) {
                    status.text = "تم جلب القائمة • جاري تحميل المحتوى"
                    openCatalogLoading(provider.id)
                } else {
                    withContext(Dispatchers.IO) { dao.saveAndActivateProvider(provider.copy(enabled = true)) }
                    status.text = "تم التحديث"
                    openHome()
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = "تعذر التحديث من الموقع • حاول مرة أخرى"
            } finally {
                updateButton.isEnabled = true
                updateButton.text = "تحديث"
                updateJob = null
            }
        }
    }

    private suspend fun refreshIdentity() {
        val identity = withContext(Dispatchers.IO) {
            ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
        }
        deviceView.text = identity.deviceId
        codeView.text = identity.activationCode
        val portalUrl = ActivationPortalUrl.create(BuildConfig.ACTIVATION_BASE_URL, identity.deviceId, identity.activationCode)
        if (portalUrl != null) qrView.setImageBitmap(createQr(portalUrl)) else qrView.setImageDrawable(null)
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "أضف القائمة من الموقع ثم اضغط تحديث" else "القائمة محفوظة • اضغط تحديث لجلب أي تغيير"
    }

    private suspend fun hasCachedCatalog(dao: BlofyDao, providerId: String): Boolean = withContext(Dispatchers.IO) {
        CatalogSyncState.isReady(applicationContext, providerId) && dao.allStreamsForProvider(providerId).isNotEmpty()
    }

    private fun openCatalogLoading(providerId: String) {
        CatalogSyncState.markPending(applicationContext, providerId)
        startActivity(Intent(this, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId))
    }

    private fun openHome() {
        startActivity(Intent(this, HomeActivity::class.java))
    }

    private fun actionButton(label: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        typeface = Typeface.DEFAULT_BOLD
        isFocusable = isTv
        isFocusableInTouchMode = isTv
        setTextColor(Color.WHITE)
        background = buttonBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            if (isTv) {
                view.background = buttonBackground(focused, primary)
                view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(80).start()
            }
        }
        setOnClickListener { action() }
    }

    private fun label(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(MUTED)
        gravity = Gravity.RIGHT
    }

    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.RGB_565).apply {
            for (y in 0 until matrix.height) for (x in 0 until matrix.width) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = dp(20).toFloat()
        setColor(SURFACE)
        setStroke(dp(1), STROKE)
    }

    private fun fieldBackground() = GradientDrawable().apply {
        cornerRadius = dp(13).toFloat()
        setColor(Color.rgb(10, 9, 16))
        setStroke(dp(1), Color.rgb(57, 45, 73))
    }

    private fun buttonBackground(focused: Boolean, primary: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(when {
            focused -> FOCUS
            primary -> Color.rgb(59, 30, 108)
            else -> SURFACE
        })
        setStroke(if (focused) dp(2) else dp(1), if (focused) PURPLE_SOFT else STROKE)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private val SURFACE = Color.rgb(17, 16, 30)
        private val STROKE = Color.rgb(69, 55, 88)
        private val FOCUS = Color.rgb(72, 42, 120)
        private val PURPLE_SOFT = Color.rgb(188, 132, 255)
        private val MUTED = Color.rgb(188, 182, 205)
    }
}
