package tv.blofy.player.ui.playlist

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import java.util.UUID

class PlaylistActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val editingProviderId = intent.getStringExtra(EXTRA_PROVIDER_ID)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(60, 48, 60, 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        val title = TextView(this).apply {
            text = if (editingProviderId == null) "إضافة قائمة تشغيل" else "تعديل قائمة التشغيل"
            textSize = 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        root.addView(title)
        root.addView(TextView(this).apply {
            text = "Xtream Codes أو M3U مباشر"
            textSize = 15f
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 6, 0, 22)
        })

        fun field(hintText: String, password: Boolean = false) = EditText(this).apply {
            hint = hintText
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setPadding(20, 0, 20, 0)
            background = fieldBackground(false)
            isFocusable = true
            setOnFocusChangeListener { view, focused -> view.background = fieldBackground(focused) }
            if (password) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        val name = field("اسم القائمة")
        val url = field("رابط السيرفر أو رابط M3U")
        val username = field("اسم المستخدم — اتركه فارغًا لـ M3U")
        val password = field("كلمة المرور — اتركها فارغة لـ M3U", true)
        listOf(name, url, username, password).forEach {
            root.addView(it, LinearLayout.LayoutParams(650, 68).apply { topMargin = 12 })
        }

        val status = TextView(this).apply {
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 4)
        }
        root.addView(status)

        val save = Button(this).apply {
            text = if (editingProviderId == null) "حفظ القائمة" else "حفظ التعديلات"
            isAllCaps = false
            textSize = 16f
            isFocusable = true
            setTextColor(Color.WHITE)
            background = buttonBackground(false)
            setOnFocusChangeListener { view, focused -> view.background = buttonBackground(focused) }
            setOnClickListener {
                val baseUrl = url.text.toString().trim()
                val user = username.text.toString().trim()
                val pass = password.text.toString()
                val isM3u = user.isBlank() && pass.isBlank()
                val partialXtream = user.isBlank() xor pass.isBlank()
                if (baseUrl.isBlank()) {
                    status.text = "أدخل رابط القائمة"
                    return@setOnClickListener
                }
                if (partialXtream) {
                    status.text = "أدخل اسم المستخدم وكلمة المرور معًا، أو اتركهما معًا لـ M3U"
                    return@setOnClickListener
                }
                isEnabled = false
                status.text = if (isM3u) "جاري قراءة M3U وحفظها محليًا..." else "جاري تحميل Xtream وحفظها محليًا..."
                lifecycleScope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val existing = editingProviderId?.let { dao.provider(it) }
                            val type = if (isM3u) "m3u" else "xtream"
                            val id = existing?.id ?: UUID.nameUUIDFromBytes("$type|$baseUrl|$user".toByteArray()).toString()
                            val provider = ProviderEntity(
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
                                enabled = existing?.enabled ?: true,
                                updatedAt = System.currentTimeMillis()
                            )
                            dao.upsertProvider(provider)
                            PlaylistManager(XtreamClient.api, dao).syncAll(provider)
                        }
                    }.onSuccess {
                        status.text = "تم حفظ القائمة"
                        setResult(RESULT_OK)
                        finish()
                    }.onFailure {
                        status.text = "تعذر تحميل القائمة: ${it.message ?: "خطأ اتصال"}"
                        isEnabled = true
                    }
                }
            }
        }
        root.addView(save, LinearLayout.LayoutParams(380, 78).apply { topMargin = 18 })
        setContentView(root)
        name.requestFocus()

        if (editingProviderId != null) {
            lifecycleScope.launch {
                val provider = withContext(Dispatchers.IO) {
                    BlofyDatabase.get(applicationContext).dao().provider(editingProviderId)
                } ?: return@launch
                name.setText(provider.name)
                url.setText(provider.baseUrl)
                username.setText(provider.username)
                password.setText(provider.password)
                status.text = "${provider.providerType.uppercase()}  •  ${provider.name}"
            }
        }
    }

    private fun fieldBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 16f
        setColor(Color.rgb(17, 15, 25))
        setStroke(if (focused) 3 else 1, if (focused) Color.rgb(190, 135, 255) else Color.rgb(52, 44, 68))
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 20f
        setColor(if (focused) Color.rgb(73, 34, 122) else Color.rgb(24, 19, 35))
        setStroke(if (focused) 3 else 1, if (focused) Color.rgb(190, 135, 255) else Color.rgb(52, 44, 68))
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
    }
}
