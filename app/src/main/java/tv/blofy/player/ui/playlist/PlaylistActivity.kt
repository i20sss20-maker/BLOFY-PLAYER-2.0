package tv.blofy.player.ui.playlist

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import java.util.UUID

class PlaylistActivity : AppCompatActivity() {
    private var mode = MODE_XTREAM

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val editingProviderId = intent.getStringExtra(EXTRA_PROVIDER_ID)
        val tv = DeviceClass.detect(this) == DeviceClass.Kind.TV

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (tv) 74 else 22), dp(if (tv) 28 else 22), dp(if (tv) 74 else 22), dp(if (tv) 28 else 22))
            background = AppCompatResources.getDrawable(this@PlaylistActivity, R.drawable.blofy_home_background)
        }

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }, LinearLayout.LayoutParams(dp(if (tv) 112 else 96), dp(if (tv) 64 else 56)).apply { bottomMargin = dp(8) })

        root.addView(TextView(this).apply {
            text = "إضافة قائمة التشغيل"
            textSize = if (tv) 27f else 23f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50)))

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(22), dp(18), dp(22), dp(20))
            background = panelBackground()
        }
        root.addView(panel, LinearLayout.LayoutParams(if (tv) dp(690) else LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val modeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        lateinit var xtreamButton: Button
        lateinit var m3uButton: Button
        xtreamButton = modeButton("Xtream") {
            mode = MODE_XTREAM
            renderMode(xtreamButton, m3uButton, true)
        }
        m3uButton = modeButton("M3U") {
            mode = MODE_M3U
            renderMode(xtreamButton, m3uButton, false)
        }
        modeRow.addView(xtreamButton, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginEnd = dp(6) })
        modeRow.addView(m3uButton, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginStart = dp(6) })
        panel.addView(modeRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))

        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText
            isSingleLine = true
            textSize = 15f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(142, 130, 154))
            setPadding(dp(18), 0, dp(18), 0)
            background = fieldBackground(false)
            isFocusable = true
            setOnFocusChangeListener { view, focused -> if (tv) view.background = fieldBackground(focused) }
            if (passwordField) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        val url = field("رابط السيرفر")
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        val m3uUrl = field("رابط M3U")

        listOf(url, username, password, m3uUrl).forEach {
            panel.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(9) })
        }

        val status = TextView(this).apply {
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(9), 0, 0)
        }
        panel.addView(status)

        val update = Button(this).apply {
            text = "تحديث"
            isAllCaps = false
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            isFocusable = tv
            isFocusableInTouchMode = tv
            setTextColor(Color.WHITE)
            background = actionBackground(false)
            setOnFocusChangeListener { view, focused -> if (tv) view.background = actionBackground(focused) }
            setOnClickListener {
                val isM3u = mode == MODE_M3U
                val baseUrl = if (isM3u) m3uUrl.text.toString().trim() else url.text.toString().trim()
                val user = if (isM3u) "" else username.text.toString().trim()
                val pass = if (isM3u) "" else password.text.toString()

                if (baseUrl.isBlank()) {
                    status.text = if (isM3u) "أدخل رابط M3U" else "أدخل رابط السيرفر"
                    return@setOnClickListener
                }
                if (!isM3u && (user.isBlank() || pass.isBlank())) {
                    status.text = "أدخل اسم المستخدم وكلمة المرور"
                    return@setOnClickListener
                }
                when (PlaylistUrlPolicy.validate(baseUrl)) {
                    PlaylistUrlPolicy.Result.EMPTY, PlaylistUrlPolicy.Result.INVALID -> { status.text = "الرابط غير صحيح"; return@setOnClickListener }
                    PlaylistUrlPolicy.Result.USER_INFO_NOT_ALLOWED -> { status.text = "استخدم الخانات المخصصة"; return@setOnClickListener }
                    PlaylistUrlPolicy.Result.UNSAFE_HOST -> { status.text = "الرابط غير مسموح"; return@setOnClickListener }
                    else -> Unit
                }

                isEnabled = false
                status.text = "جاري التحديث..."
                lifecycleScope.launch {
                    try {
                        val provider = withContext(Dispatchers.IO) {
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val existing = editingProviderId?.let { dao.provider(it) }
                            val type = if (isM3u) "m3u" else "xtream"
                            val id = existing?.id ?: UUID.nameUUIDFromBytes("$type|$baseUrl|$user".toByteArray()).toString()
                            val next = ProviderEntity(
                                id = id,
                                name = if (isM3u) "BLOFY M3U" else "BLOFY Xtream",
                                baseUrl = if (isM3u) baseUrl else baseUrl.trimEnd('/'),
                                username = user,
                                password = pass,
                                providerType = type,
                                liveFormat = existing?.liveFormat ?: "ts",
                                preferredTransport = existing?.preferredTransport ?: "cronet",
                                preferredEngine = existing?.preferredEngine ?: "media3",
                                allowCrossProtocolRedirects = existing?.allowCrossProtocolRedirects ?: true,
                                enabled = true,
                                updatedAt = System.currentTimeMillis()
                            )
                            dao.saveAndActivateProvider(next)
                            CatalogSyncState.markPending(applicationContext, next.id)
                            next
                        }

                        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                        if (endpoint.isNotBlank()) {
                            try {
                                withContext(Dispatchers.IO) { PortalPlaylistClient.pushProvider(applicationContext, endpoint, provider) }
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (_: Exception) { }
                        }
                        setResult(RESULT_OK)
                        finish()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        status.text = "تعذر التحديث"
                        isEnabled = true
                    }
                }
            }
        }
        panel.addView(update, LinearLayout.LayoutParams(if (tv) dp(300) else LinearLayout.LayoutParams.MATCH_PARENT, dp(62)).apply { topMargin = dp(14) })

        fun applyVisibility() {
            val xtream = mode == MODE_XTREAM
            url.visibility = if (xtream) View.VISIBLE else View.GONE
            username.visibility = if (xtream) View.VISIBLE else View.GONE
            password.visibility = if (xtream) View.VISIBLE else View.GONE
            m3uUrl.visibility = if (xtream) View.GONE else View.VISIBLE
        }
        xtreamButton.setOnClickListener { mode = MODE_XTREAM; renderMode(xtreamButton, m3uButton, true); applyVisibility(); url.requestFocus() }
        m3uButton.setOnClickListener { mode = MODE_M3U; renderMode(xtreamButton, m3uButton, false); applyVisibility(); m3uUrl.requestFocus() }
        renderMode(xtreamButton, m3uButton, true)
        applyVisibility()
        setContentView(root)
        xtreamButton.requestFocus()

        if (editingProviderId != null) {
            lifecycleScope.launch {
                val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().provider(editingProviderId) } ?: return@launch
                if (provider.providerType.equals("m3u", true)) {
                    mode = MODE_M3U
                    m3uUrl.setText(provider.baseUrl)
                    renderMode(xtreamButton, m3uButton, false)
                } else {
                    mode = MODE_XTREAM
                    url.setText(provider.baseUrl)
                    username.setText(provider.username)
                    password.setText(provider.password)
                    renderMode(xtreamButton, m3uButton, true)
                }
                applyVisibility()
            }
        }
    }

    private fun modeButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        isFocusable = true
        background = modeBackground(false)
        setOnClickListener { action() }
    }

    private fun renderMode(xtream: Button, m3u: Button, xtreamSelected: Boolean) {
        xtream.background = modeBackground(xtreamSelected)
        m3u.background = modeBackground(!xtreamSelected)
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        setColor(SURFACE)
        setStroke(dp(1), STROKE)
    }

    private fun fieldBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(13).toFloat()
        setColor(Color.rgb(10, 9, 16))
        setStroke(if (focused) dp(2) else dp(1), if (focused) PURPLE_SOFT else Color.rgb(52, 44, 68))
    }

    private fun actionBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(if (focused) FOCUS else Color.rgb(59, 30, 108))
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else PURPLE_SOFT)
    }

    private fun modeBackground(selected: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(if (selected) FOCUS else Color.rgb(20, 17, 31))
        setStroke(if (selected) dp(2) else dp(1), if (selected) PURPLE_SOFT else STROKE)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        private const val MODE_XTREAM = "xtream"
        private const val MODE_M3U = "m3u"
        private val SURFACE = Color.rgb(17, 16, 30)
        private val STROKE = Color.rgb(69, 55, 88)
        private val FOCUS = Color.rgb(72, 42, 120)
        private val PURPLE_SOFT = Color.rgb(188, 132, 255)
        private val MUTED = Color.rgb(188, 182, 205)
    }
}
