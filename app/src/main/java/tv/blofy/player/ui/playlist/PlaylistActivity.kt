package tv.blofy.player.ui.playlist

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.V339Ui
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
            background = V339Ui.screenGradient()
        }

        root.addView(V339Ui.title(this, "إضافة قائمة التشغيل", if (tv) 27f else 23f).apply {
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)).apply { bottomMargin = dp(12) })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(22), dp(20), dp(22), dp(22))
            background = V339Ui.panel(this@PlaylistActivity, Color.argb(220, 17, 16, 30), 18, V339Ui.STROKE)
        }
        root.addView(panel, LinearLayout.LayoutParams(if (tv) dp(690) else LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val modeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        lateinit var xtreamButton: Button
        lateinit var m3uButton: Button
        xtreamButton = modeButton("Xtream")
        m3uButton = modeButton("M3U")
        modeRow.addView(xtreamButton, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginEnd = dp(6) })
        modeRow.addView(m3uButton, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginStart = dp(6) })
        panel.addView(modeRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))

        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText
            isSingleLine = true
            textSize = 14f
            setTextColor(V339Ui.TEXT)
            setHintTextColor(V339Ui.MUTED)
            setPadding(dp(18), 0, dp(18), 0)
            background = V339Ui.focusDrawable(this@PlaylistActivity, Color.argb(220, 16, 15, 28), V339Ui.PANEL_SOFT, V339Ui.PURPLE_LIGHT)
            isFocusable = true
            textDirection = View.TEXT_DIRECTION_RTL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            if (passwordField) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        val url = field("رابط السيرفر")
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        val m3uUrl = field("رابط M3U")
        listOf(url, username, password, m3uUrl).forEach {
            panel.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(9) })
        }

        val status = V339Ui.text(this, "", 13f, V339Ui.MUTED).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(9), 0, 0)
        }
        panel.addView(status)

        val update = V339Ui.button(this, "تحديث", true).apply {
            textSize = 16f
            isFocusable = tv
            isFocusableInTouchMode = tv
            setOnClickListener {
                val isM3u = mode == MODE_M3U
                val baseUrl = if (isM3u) m3uUrl.text.toString().trim() else url.text.toString().trim()
                val user = if (isM3u) "" else username.text.toString().trim()
                val pass = if (isM3u) "" else password.text.toString()

                if (baseUrl.isBlank()) { status.text = if (isM3u) "أدخل رابط M3U" else "أدخل رابط السيرفر"; return@setOnClickListener }
                if (!isM3u && (user.isBlank() || pass.isBlank())) { status.text = "أدخل اسم المستخدم وكلمة المرور"; return@setOnClickListener }
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
                            try { withContext(Dispatchers.IO) { PortalPlaylistClient.pushProvider(applicationContext, endpoint, provider) } }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { }
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
        fun applyMode() {
            xtreamButton.background = if (mode == MODE_XTREAM) V339Ui.gradientPanel(this, Color.rgb(62,19,124), Color.rgb(31,15,62), 14, V339Ui.PURPLE_LIGHT)
            else V339Ui.focusDrawable(this, Color.TRANSPARENT, V339Ui.PANEL_SOFT, V339Ui.PURPLE_LIGHT)
            m3uButton.background = if (mode == MODE_M3U) V339Ui.gradientPanel(this, Color.rgb(62,19,124), Color.rgb(31,15,62), 14, V339Ui.PURPLE_LIGHT)
            else V339Ui.focusDrawable(this, Color.TRANSPARENT, V339Ui.PANEL_SOFT, V339Ui.PURPLE_LIGHT)
            applyVisibility()
        }
        xtreamButton.setOnClickListener { mode = MODE_XTREAM; applyMode(); url.requestFocus() }
        m3uButton.setOnClickListener { mode = MODE_M3U; applyMode(); m3uUrl.requestFocus() }
        applyMode()
        setContentView(root)
        xtreamButton.requestFocus()

        if (editingProviderId != null) {
            lifecycleScope.launch {
                val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().provider(editingProviderId) } ?: return@launch
                if (provider.providerType.equals("m3u", true)) {
                    mode = MODE_M3U; m3uUrl.setText(provider.baseUrl)
                } else {
                    mode = MODE_XTREAM; url.setText(provider.baseUrl); username.setText(provider.username); password.setText(provider.password)
                }
                applyMode()
            }
        }
    }

    private fun modeButton(label: String) = V339Ui.button(this, label, false).apply {
        textSize = 16f
        isFocusable = true
    }

    private fun dp(value: Int) = V339Ui.dp(this, value)

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        private const val MODE_XTREAM = "xtream"
        private const val MODE_M3U = "m3u"
    }
}
