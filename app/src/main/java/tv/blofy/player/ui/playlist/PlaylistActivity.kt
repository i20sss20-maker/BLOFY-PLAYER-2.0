package tv.blofy.player.ui.playlist

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.widget.doAfterTextChanged
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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val editingProviderId = intent.getStringExtra(EXTRA_PROVIDER_ID)
        val tv = DeviceClass.detect(this) == DeviceClass.Kind.TV

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(if (tv) dp(70) else dp(22), if (tv) dp(28) else dp(22), if (tv) dp(70) else dp(22), if (tv) dp(28) else dp(22))
            background = AppCompatResources.getDrawable(this@PlaylistActivity, R.drawable.blofy_home_background)
        }

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(if (tv) 130 else 110), dp(if (tv) 78 else 68)))

        root.addView(TextView(this).apply {
            text = if (editingProviderId == null) "إضافة قائمة التشغيل" else "تعديل قائمة التشغيل"
            textSize = if (tv) 28f else 24f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "استخدم هذه الصفحة فقط للإضافة اليدوية"
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(12))
        })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(18), dp(24), dp(20))
            background = panelBackground()
        }
        root.addView(panel, LinearLayout.LayoutParams(if (tv) dp(720) else LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

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

        val name = field("اسم القائمة")
        val url = field("رابط السيرفر أو رابط M3U")
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        listOf(name, url, username, password).forEach {
            panel.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(8) })
        }

        val transportNotice = TextView(this).apply {
            text = "يُفضّل HTTPS، وتُقبل روابط HTTP لبعض السيرفرات."
            textSize = 12f
            setTextColor(PURPLE_SOFT)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
        panel.addView(transportNotice)
        url.doAfterTextChanged { value ->
            val candidate = value?.toString()?.trim().orEmpty()
            if (candidate.startsWith("http://", true)) {
                transportNotice.text = "تنبيه: رابط HTTP غير مشفّر"
                transportNotice.setTextColor(Color.rgb(255, 179, 71))
            } else {
                transportNotice.text = "يُفضّل HTTPS، وتُقبل روابط HTTP لبعض السيرفرات."
                transportNotice.setTextColor(PURPLE_SOFT)
            }
        }

        val status = TextView(this).apply {
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }
        panel.addView(status)

        var confirmedHttpUrl: String? = null
        val save = Button(this).apply {
            text = "حفظ"
            isAllCaps = false
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            isFocusable = tv
            isFocusableInTouchMode = tv
            setTextColor(Color.WHITE)
            background = buttonBackground(false)
            setOnFocusChangeListener { view, focused ->
                if (tv) view.background = buttonBackground(focused)
            }
            setOnClickListener {
                val baseUrl = url.text.toString().trim()
                val user = username.text.toString().trim()
                val pass = password.text.toString()
                val isM3u = user.isBlank() && pass.isBlank()
                val partialXtream = user.isBlank() xor pass.isBlank()

                when (PlaylistUrlPolicy.validate(baseUrl)) {
                    PlaylistUrlPolicy.Result.EMPTY -> { status.text = "أدخل رابط القائمة"; return@setOnClickListener }
                    PlaylistUrlPolicy.Result.INVALID -> { status.text = "الرابط غير صحيح"; return@setOnClickListener }
                    PlaylistUrlPolicy.Result.USER_INFO_NOT_ALLOWED -> { status.text = "استخدم حقول المستخدم وكلمة المرور"; return@setOnClickListener }
                    PlaylistUrlPolicy.Result.UNSAFE_HOST -> { status.text = "الرابط المحلي أو الخاص غير مسموح"; return@setOnClickListener }
                    PlaylistUrlPolicy.Result.HTTP_CLEAR_TEXT -> {
                        if (confirmedHttpUrl != baseUrl) {
                            val button = this
                            AlertDialog.Builder(this@PlaylistActivity)
                                .setTitle("اتصال HTTP غير مشفّر")
                                .setMessage("استخدم HTTPS إن توفر. هل تريد حفظ هذا الرابط؟")
                                .setNegativeButton("رجوع", null)
                                .setPositiveButton("حفظ") { _, _ -> confirmedHttpUrl = baseUrl; button.performClick() }
                                .show()
                            return@setOnClickListener
                        }
                    }
                    PlaylistUrlPolicy.Result.VALID -> Unit
                }
                if (partialXtream) {
                    status.text = "أدخل اسم المستخدم وكلمة المرور معًا"
                    return@setOnClickListener
                }

                isEnabled = false
                status.text = "جاري الحفظ..."
                lifecycleScope.launch {
                    try {
                        val provider = withContext(Dispatchers.IO) {
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val existing = editingProviderId?.let { dao.provider(it) }
                            val type = if (isM3u) "m3u" else "xtream"
                            val id = existing?.id ?: UUID.nameUUIDFromBytes("$type|$baseUrl|$user".toByteArray()).toString()
                            val next = ProviderEntity(
                                id = id,
                                name = name.text.toString().trim().ifBlank { if (isM3u) "BLOFY M3U" else "BLOFY Server" },
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
                            } catch (_: Exception) {
                                // Local save succeeded; portal can be retried later with Update.
                            }
                        }
                        status.text = "تم الحفظ"
                        setResult(RESULT_OK)
                        finish()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        status.text = "تعذر حفظ القائمة"
                        isEnabled = true
                    }
                }
            }
        }
        panel.addView(save, LinearLayout.LayoutParams(if (tv) dp(300) else LinearLayout.LayoutParams.MATCH_PARENT, dp(62)).apply { topMargin = dp(14) })
        setContentView(root)
        name.requestFocus()

        if (editingProviderId != null) {
            lifecycleScope.launch {
                val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().provider(editingProviderId) } ?: return@launch
                name.setText(provider.name)
                url.setText(provider.baseUrl)
                username.setText(provider.username)
                password.setText(provider.password)
            }
        }
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

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(if (focused) FOCUS else Color.rgb(59, 30, 108))
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else PURPLE_SOFT)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        private val SURFACE = Color.rgb(17, 16, 30)
        private val STROKE = Color.rgb(69, 55, 88)
        private val FOCUS = Color.rgb(72, 42, 120)
        private val PURPLE_SOFT = Color.rgb(188, 132, 255)
        private val MUTED = Color.rgb(188, 182, 205)
    }
}
