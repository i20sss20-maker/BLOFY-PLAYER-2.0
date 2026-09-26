package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
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
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import java.util.UUID

class BlofySubscriberActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        val kind = DeviceClass.detect(this)
        val phone = kind == DeviceClass.Kind.PHONE
        val tv = kind == DeviceClass.Kind.TV
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = android.view.View.OVER_SCROLL_NEVER
            background = AppCompatResources.getDrawable(this@BlofySubscriberActivity, R.drawable.blofy_home_background)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(if (phone) 22 else 54, if (phone) 24 else 34, if (phone) 22 else 54, if (phone) 34 else 34)
        }
        scroll.addView(root, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(if (phone) 150 else 170, if (phone) 72 else 76))
        root.addView(TextView(this).apply { text = "مشتركين BLOFY"; BlofyTvDesign.applyTitle(this); textSize = if (phone) 27f else 32f; gravity = Gravity.CENTER })
        root.addView(TextView(this).apply { text = "اسم المستخدم وكلمة المرور فقط"; textSize = if (phone) 14f else 15f; setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.CENTER; setPadding(0, 6, 0, 20) })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(if (phone) 18 else 30, if (phone) 20 else 24, if (phone) 18 else 30, if (phone) 20 else 24); background = panelBackground()
        }
        root.addView(panel, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 660, LinearLayout.LayoutParams.WRAP_CONTENT))
        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText; isSingleLine = true; gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL; setTextColor(BlofyTvDesign.TextPrimary); setHintTextColor(BlofyTvDesign.TextDim); setPadding(22,0,22,0)
            background = fieldBackground(false); isFocusable = true; isFocusableInTouchMode = true
            if (passwordField) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            setOnFocusChangeListener { view, focused -> view.background = fieldBackground(focused); if (tv) view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(90).start() }
        }
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        username.imeOptions = EditorInfo.IME_ACTION_NEXT
        password.imeOptions = EditorInfo.IME_ACTION_DONE
        panel.addView(username, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phone) 62 else 64).apply { topMargin = 8 })
        panel.addView(password, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phone) 62 else 64).apply { topMargin = 10 })
        val status = TextView(this).apply { setTextColor(BlofyTvDesign.PurpleSoft); textSize = 14f; gravity = Gravity.CENTER; setPadding(8,14,8,2) }
        panel.addView(status)

        val login = Button(this).apply {
            text = "حفظ واتصال"; isAllCaps = false; textSize = 17f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(BlofyTvDesign.TextPrimary); isFocusable = true; isFocusableInTouchMode = true; stateListAnimator = null; background = buttonBackground(false)
            setOnFocusChangeListener { view, focused -> view.background = buttonBackground(focused); if (tv) view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).setDuration(100).start() }
            setOnClickListener {
                val user = username.text.toString().trim(); val pass = password.text.toString()
                if (user.isBlank()) { status.text = "أدخل اسم المستخدم"; username.requestFocus(); return@setOnClickListener }
                if (pass.isBlank()) { status.text = "أدخل كلمة المرور"; password.requestFocus(); return@setOnClickListener }
                val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim(); if (endpoint.isBlank()) { status.text = "خدمة BLOFY غير مهيأة"; return@setOnClickListener }
                isEnabled = false; username.isEnabled = false; password.isEnabled = false; status.text = "جاري التحقق وتجهيز الاشتراك..."
                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            val session = BlofySubscriberClient.createSession(applicationContext, endpoint, user, pass)
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val providerId = UUID.nameUUIDFromBytes("blofy-subscriber".toByteArray()).toString()
                            val next = ProviderEntity(providerId, "مشتركين BLOFY", session.baseUrl, session.username, session.password, "xtream", "ts", "cronet", "media3", true, true, System.currentTimeMillis())
                            val readyCatalog = CatalogSyncState.isReady(applicationContext, providerId) && dao.hasCatalog(providerId)
                            if (!readyCatalog) {
                                CatalogSyncState.markPending(applicationContext, providerId)
                                dao.clearProviderCatalog(providerId)
                                dao.upsertProvider(next)
                                try {
                                    val result = PlaylistSyncPolicy.run {
                                        PlaylistManager(XtreamClient.api, dao).syncAll(next) { progress ->
                                            withContext(Dispatchers.Main) { status.text = syncProgressText(progress) }
                                        }
                                    }
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
                                dao.disableAllProviders(); dao.activateProvider(providerId)
                            }
                            runCatching { PortalPlaylistClient.pushProvider(applicationContext, endpoint, next) }
                        }
                        setResult(RESULT_OK); status.text = "تم الحفظ • جاري الدخول"
                        startActivity(Intent(this@BlofySubscriberActivity, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish()
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        status.text = "تعذر الدخول • ${error.message ?: "تحقق من البيانات"}"
                        isEnabled = true; username.isEnabled = true; password.isEnabled = true; username.requestFocus()
                    }
                }
            }
        }
        password.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                login.performClick()
                true
            } else false
        }
        panel.addView(login, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 330, if (phone) 64 else 68).apply { topMargin = 14 })
        panel.addView(TextView(this).apply { text = "عنوان الخدمة الخاص مخفي داخل التطبيق"; textSize = 12f; setTextColor(BlofyTvDesign.TextDim); gravity = Gravity.CENTER; setPadding(10,12,10,0) })
        setContentView(scroll); username.requestFocus()
    }

    private fun syncProgressText(progress: PlaylistSyncProgress): String {
        val stage = when (progress.stage) {
            PlaylistSyncStage.M3U -> "M3U"
            PlaylistSyncStage.LIVE -> "البث المباشر"
            PlaylistSyncStage.MOVIES -> "الأفلام"
            PlaylistSyncStage.SERIES -> "المسلسلات"
        }
        return "جاري تحميل $stage  •  ${progress.percent}%"
    }

    private fun panelBackground() = BlofyTvDesign.elevatedSurface(26f, emphasis = true)
    private fun fieldBackground(focused: Boolean) = BlofyTvDesign.inputField(17f, focused)
    private fun buttonBackground(focused: Boolean) = BlofyTvDesign.primaryButton(18f, focused)
}
