package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
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
import tv.blofy.player.core.identity.BlofySubscriberClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

class BlofySubscriberActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val kind = DeviceClass.detect(this)
        val phone = kind == DeviceClass.Kind.PHONE
        val tv = kind == DeviceClass.Kind.TV

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            background = AppCompatResources.getDrawable(this@BlofySubscriberActivity, R.drawable.blofy_home_background)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (phone) 22 else 54), dp(if (phone) 24 else 34), dp(if (phone) 22 else 54), dp(if (phone) 28 else 38))
        }
        scroll.addView(root, ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT))

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }, LinearLayout.LayoutParams(dp(if (phone) 150 else 180), dp(if (phone) 72 else 82)))

        root.addView(TextView(this).apply {
            text = "مشتركين BLOFY"
            textSize = if (phone) 27f else 32f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "سجّل باسم المستخدم وكلمة المرور فقط"
            textSize = if (phone) 14f else 15f
            setTextColor(0xFFB8ABC7.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, dp(20))
        })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (phone) 18 else 30), dp(if (phone) 20 else 26), dp(if (phone) 18 else 30), dp(if (phone) 20 else 26))
            background = panelBackground()
            clipChildren = false
            clipToPadding = false
        }
        root.addView(panel, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else dp(660), LinearLayout.LayoutParams.WRAP_CONTENT))

        fun label(textValue: String) = TextView(this).apply {
            text = textValue
            textSize = if (phone) 13f else 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFEADDF7.toInt())
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(6))
        }

        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText
            textSize = if (phone) 16f else 17f
            isSingleLine = true
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_LTR
            setTextColor(Color.WHITE)
            setHintTextColor(0xFF8E829A.toInt())
            setPadding(dp(18), 0, dp(18), 0)
            background = fieldBackground(false)
            isFocusable = true
            isFocusableInTouchMode = true
            inputType = if (passwordField) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            }
            imeOptions = if (passwordField) EditorInfo.IME_ACTION_DONE else EditorInfo.IME_ACTION_NEXT
            setSelectAllOnFocus(false)
            setOnFocusChangeListener { view, focused ->
                view.background = fieldBackground(focused)
                if (tv) view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(90).start()
            }
        }

        panel.addView(label("اسم المستخدم"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val username = field("أدخل اسم المستخدم")
        panel.addView(username, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (phone) 62 else 66)))

        panel.addView(label("كلمة المرور"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        val password = field("أدخل كلمة المرور", true)
        panel.addView(password, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (phone) 62 else 66)))

        val status = TextView(this).apply {
            setTextColor(0xFFB78CFF.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
            minHeight = dp(36)
            setPadding(dp(8), dp(12), dp(8), dp(2))
        }
        panel.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        lateinit var login: Button
        fun submit() {
            val user = username.text.toString().trim()
            val pass = password.text.toString()
            if (user.isBlank()) {
                status.text = "أدخل اسم المستخدم"
                username.requestFocus()
                return
            }
            if (pass.isBlank()) {
                status.text = "أدخل كلمة المرور"
                password.requestFocus()
                return
            }
            val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
            if (endpoint.isBlank()) {
                status.text = "خدمة BLOFY غير مهيأة"
                return
            }

            login.isEnabled = false
            username.isEnabled = false
            password.isEnabled = false
            status.text = "جاري التحقق وتجهيز الاشتراك..."

            lifecycleScope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        val session = BlofySubscriberClient.createSession(applicationContext, endpoint, user, pass)
                        val dao = BlofyDatabase.get(applicationContext).dao()
                        val providerId = UUID.nameUUIDFromBytes("blofy-subscriber".toByteArray()).toString()
                        val next = ProviderEntity(
                            providerId,
                            session.providerName.ifBlank { "مشتركين BLOFY" },
                            session.baseUrl,
                            session.username,
                            session.password,
                            "xtream",
                            "ts",
                            "cronet",
                            "media3",
                            true,
                            true,
                            System.currentTimeMillis()
                        )
                        val readyCatalog = CatalogSyncState.isReady(applicationContext, providerId) && dao.hasCatalog(providerId)
                        if (!readyCatalog) {
                            CatalogSyncState.markPending(applicationContext, providerId)
                            dao.clearProviderCatalog(providerId)
                            dao.upsertProvider(next)
                            try {
                                val result = PlaylistSyncPolicy.run { PlaylistManager(XtreamClient.api, dao).syncAll(next) }
                                check(result.freshItemCount > 0) { "لم يرجع الاشتراك أي محتوى" }
                                check(result.failedSectionCount == 0) { "تعذر تحميل أحد أقسام الاشتراك" }
                                dao.saveAndActivateProvider(next)
                                CatalogSyncState.markReady(applicationContext, providerId)
                            } catch (error: Throwable) {
                                dao.clearProviderCatalog(providerId)
                                CatalogSyncState.markPending(applicationContext, providerId)
                                throw error
                            }
                        } else {
                            dao.upsertProvider(next)
                            dao.disableAllProviders()
                            dao.activateProvider(providerId)
                        }
                        runCatching { PortalPlaylistClient.pushProvider(applicationContext, endpoint, next) }
                    }
                    setResult(RESULT_OK)
                    status.text = "تم الحفظ • جاري الدخول"
                    startActivity(Intent(this@BlofySubscriberActivity, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                    finish()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    status.text = "تعذر الدخول • ${error.message ?: "تحقق من البيانات"}"
                    login.isEnabled = true
                    username.isEnabled = true
                    password.isEnabled = true
                    username.requestFocus()
                }
            }
        }

        login = Button(this).apply {
            text = "حفظ واتصال"
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
            setOnClickListener { submit() }
        }
        panel.addView(login, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else dp(330), dp(if (phone) 64 else 68)).apply { topMargin = dp(12) })

        password.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submit()
                true
            } else false
        }

        panel.addView(TextView(this).apply {
            text = "عنوان الخدمة الخاص مخفي داخل التطبيق"
            textSize = 12f
            setTextColor(0xFF857B91.toInt())
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(12), dp(10), 0)
        })

        setContentView(scroll)
        username.post { username.requestFocus() }
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = dp(26).toFloat()
        setColor(0xEE151020.toInt())
        setStroke(dp(1), 0xFF67458E.toInt())
    }

    private fun fieldBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(17).toFloat()
        setColor(0xFF110F19.toInt())
        setStroke(dp(if (focused) 3 else 1), if (focused) 0xFFBE87FF.toInt() else 0xFF342C44.toInt())
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        setColor(if (focused) 0xFF7D45D9.toInt() else 0xFF5F2AB5.toInt())
        setStroke(dp(if (focused) 3 else 1), if (focused) Color.WHITE else 0xFF8C59D8.toInt())
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
