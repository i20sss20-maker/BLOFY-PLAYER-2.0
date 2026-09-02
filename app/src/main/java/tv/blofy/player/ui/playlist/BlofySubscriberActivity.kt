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
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.BlofySubscriberClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import java.util.UUID

class BlofySubscriberActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kind = DeviceClass.detect(this)
        val phone = kind == DeviceClass.Kind.PHONE
        val tv = kind == DeviceClass.Kind.TV

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(if (phone) 22 else 54, if (phone) 24 else 34, if (phone) 22 else 54, if (phone) 24 else 34)
            background = AppCompatResources.getDrawable(this@BlofySubscriberActivity, R.drawable.blofy_home_background)
        }

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(if (phone) 150 else 190, if (phone) 72 else 82))

        root.addView(TextView(this).apply {
            text = "مشتركين BLOFY"
            textSize = if (phone) 27f else 34f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "دخول سريع وآمن — أدخل بيانات اشتراكك فقط"
            textSize = if (phone) 14f else 16f
            setTextColor(0xFFB8ABC7.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 7, 0, if (phone) 18 else 24)
        })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(if (phone) 18 else 32, if (phone) 20 else 28, if (phone) 18 else 32, if (phone) 20 else 28)
            background = panelBackground()
        }
        root.addView(panel, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 700, LinearLayout.LayoutParams.WRAP_CONTENT))

        panel.addView(TextView(this).apply {
            text = "BLOFY SECURE ACCESS"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFB78CFF.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 10)
        })

        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(0xFF8E829A.toInt())
            setPadding(22, 0, 22, 0)
            background = fieldBackground(false)
            isFocusable = true
            isFocusableInTouchMode = true
            if (passwordField) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            setOnFocusChangeListener { view, focused ->
                view.background = fieldBackground(focused)
                if (tv) view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(90).start()
            }
        }

        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        panel.addView(username, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phone) 62 else 68).apply { topMargin = 8 })
        panel.addView(password, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phone) 62 else 68).apply { topMargin = 12 })

        val status = TextView(this).apply {
            setTextColor(0xFFB78CFF.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(8, 16, 8, 2)
        }
        panel.addView(status)

        val login = Button(this).apply {
            text = "دخول"
            isAllCaps = false
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            isFocusable = true
            isFocusableInTouchMode = true
            background = buttonBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = buttonBackground(focused)
                if (tv) view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).setDuration(100).start()
            }
            setOnClickListener {
                val user = username.text.toString().trim()
                val pass = password.text.toString()
                if (user.isBlank()) { status.text = "أدخل اسم المستخدم"; username.requestFocus(); return@setOnClickListener }
                if (pass.isBlank()) { status.text = "أدخل كلمة المرور"; password.requestFocus(); return@setOnClickListener }
                val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                if (endpoint.isBlank()) { status.text = "خدمة BLOFY غير مهيأة"; return@setOnClickListener }

                isEnabled = false
                username.isEnabled = false
                password.isEnabled = false
                status.text = "جاري التحقق وتحميل المحتوى بأمان..."
                lifecycleScope.launch {
                    try {
                        val portalSynced = withContext(Dispatchers.IO) {
                            val session = BlofySubscriberClient.createSession(applicationContext, endpoint, user, pass)
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val providerId = UUID.nameUUIDFromBytes("blofy-subscriber".toByteArray()).toString()
                            val provider = ProviderEntity(
                                id = providerId,
                                name = "مشتركين BLOFY",
                                baseUrl = session.baseUrl,
                                username = session.username,
                                password = session.password,
                                providerType = "xtream",
                                liveFormat = "ts",
                                preferredTransport = "cronet",
                                preferredEngine = "media3",
                                allowCrossProtocolRedirects = true,
                                enabled = true,
                                updatedAt = System.currentTimeMillis()
                            )
                            val staging = provider.copy(id = UUID.randomUUID().toString(), enabled = false)
                            var promoted = false
                            try {
                                val result = PlaylistSyncPolicy.run { PlaylistManager(XtreamClient.api, dao).syncAll(staging) }
                                check(result.freshItemCount > 0) { "لم يرجع الاشتراك أي محتوى" }
                                check(result.failedSectionCount == 0) { "تعذر تحميل أحد أقسام الاشتراك" }
                                dao.promoteStagedCatalog(staging.id, provider)
                                promoted = true
                                try {
                                    PortalPlaylistClient.pushProvider(applicationContext, endpoint, provider)
                                    true
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (_: Exception) {
                                    false
                                }
                            } finally {
                                if (!promoted) withContext(NonCancellable) { dao.discardStagedCatalog(staging.id) }
                            }
                        }
                        setResult(RESULT_OK)
                        status.text = if (portalSynced) "تم الدخول وربط اشتراك BLOFY" else "تم الدخول وحفظ الاشتراك على الجهاز"
                        finish()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        status.text = error.message ?: "تعذر تسجيل الدخول"
                        isEnabled = true
                        username.isEnabled = true
                        password.isEnabled = true
                        username.requestFocus()
                    }
                }
            }
        }
        panel.addView(login, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 360, if (phone) 64 else 72).apply { topMargin = 16 })

        panel.addView(TextView(this).apply {
            text = "عنوان الخدمة الخاص لا يظهر داخل التطبيق ولا يتم حفظه على الجهاز."
            textSize = 12f
            setTextColor(0xFF857B91.toInt())
            gravity = Gravity.CENTER
            setPadding(10, 14, 10, 0)
        })

        setContentView(root)
        username.requestFocus()
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = 26f
        setColor(0xEE151020.toInt())
        setStroke(1, 0xFF67458E.toInt())
    }

    private fun fieldBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 17f
        setColor(0xFF110F19.toInt())
        setStroke(if (focused) 3 else 1, if (focused) 0xFFBE87FF.toInt() else 0xFF342C44.toInt())
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 18f
        setColor(if (focused) 0xFF7D45D9.toInt() else 0xFF5F2AB5.toInt())
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else 0xFF8C59D8.toInt())
    }
}
