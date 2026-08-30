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

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(60, 48, 60, 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "إضافة قائمة تشغيل"
            textSize = 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "Xtream Codes"
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
        val url = field("رابط السيرفر http://example.com:8080")
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
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
            text = "حفظ القائمة"
            isAllCaps = false
            textSize = 16f
            isFocusable = true
            setTextColor(Color.WHITE)
            background = buttonBackground(false)
            setOnFocusChangeListener { view, focused -> view.background = buttonBackground(focused) }
            setOnClickListener {
                val baseUrl = url.text.toString().trim().trimEnd('/')
                val user = username.text.toString().trim()
                val pass = password.text.toString()
                if (baseUrl.isBlank() || user.isBlank() || pass.isBlank()) {
                    status.text = "أكمل بيانات السيرفر"
                    return@setOnClickListener
                }
                isEnabled = false
                status.text = "جاري حفظ وتحميل القائمة..."
                lifecycleScope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val id = UUID.nameUUIDFromBytes("$baseUrl|$user".toByteArray()).toString()
                            val provider = ProviderEntity(
                                id = id,
                                name = name.text.toString().trim().ifBlank { "BLOFY Server" },
                                baseUrl = baseUrl,
                                username = user,
                                password = pass
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
}
