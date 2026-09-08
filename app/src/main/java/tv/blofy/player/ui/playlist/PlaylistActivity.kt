package tv.blofy.player.ui.playlist

import android.content.Intent
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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.BlofySubscriberClient
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.login.CatalogLoadingActivity
import java.util.UUID

class PlaylistActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val editingProviderId = intent.getStringExtra(EXTRA_PROVIDER_ID)
        if (editingProviderId == null && !intent.getBooleanExtra(EXTRA_DIRECT_FORM, false)) {
            startActivity(Intent(this, ProviderManagerActivity::class.java)); finish(); return
        }

        val phone = DeviceClass.detect(this) == DeviceClass.Kind.PHONE
        val tv = DeviceClass.isTv(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(if (phone) 22 else 54, if (phone) 24 else 28, if (phone) 22 else 54, if (phone) 24 else 28)
            background = AppCompatResources.getDrawable(this@PlaylistActivity, R.drawable.blofy_home_background)
        }
        root.addView(ImageView(this).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE }, LinearLayout.LayoutParams(if (phone) 150 else 170, if (phone) 72 else 76))
        root.addView(TextView(this).apply {
            text = if (editingProviderId == null) "إضافة سيرفر" else "تعديل السيرفر"; textSize = if (phone) 25f else 30f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply { text = "Xtream Codes"; textSize = if (phone) 13f else 15f; setTextColor(0xFFB8ABC7.toInt()); gravity = Gravity.CENTER; setPadding(0, 5, 0, 16) })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(if (phone) 18 else 28, if (phone) 18 else 22, if (phone) 18 else 28, if (phone) 18 else 22); background = panelBackground()
        }
        root.addView(panel, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 760, LinearLayout.LayoutParams.WRAP_CONTENT))

        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText; isSingleLine = true; gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL; setTextColor(Color.WHITE); setHintTextColor(0xFF8E829A.toInt()); setPadding(22,0,22,0)
            background = fieldBackground(false); isFocusable = true; isFocusableInTouchMode = true
            setOnFocusChangeListener { view, focused -> if (tv) view.background = fieldBackground(focused) }
            if (passwordField) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val name = field("اسم السيرفر (اختياري)")
        val url = field("رابط السيرفر")
        val username = field("اسم المستخدم")
        val password = field("كلمة المرور", true)
        listOf(name, url).forEach { panel.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phone) 62 else 64).apply { topMargin = 9 }) }

        val transportNotice = TextView(this).apply { text = "يفضل HTTPS • HTTP متاح عند الحاجة"; textSize = if (phone) 12f else 13f; setTextColor(0xFFB78CFF.toInt()); gravity = Gravity.RIGHT; setPadding(8,8,8,1) }
        panel.addView(transportNotice)
        url.doAfterTextChanged { value ->
            val candidate = value?.toString()?.trim().orEmpty()
            when {
                candidate.startsWith("http://", true) -> { transportNotice.text = "تنبيه: اتصال HTTP غير مشفر"; transportNotice.setTextColor(Color.rgb(255,179,71)) }
                candidate.startsWith("https://", true) -> { transportNotice.text = "اتصال HTTPS مشفر"; transportNotice.setTextColor(Color.rgb(116,224,174)) }
                else -> { transportNotice.text = "يفضل HTTPS • HTTP متاح عند الحاجة"; transportNotice.setTextColor(0xFFB78CFF.toInt()) }
            }
        }
        listOf(username, password).forEach { panel.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phone) 62 else 64).apply { topMargin = 9 }) }
        val status = TextView(this).apply { setTextColor(0xFFB78CFF.toInt()); gravity = Gravity.RIGHT; setPadding(0,12,0,2) }
        panel.addView(status)

        var confirmedHttpUrl: String? = null
        var busy = false
        suspend fun persist(connectAfter: Boolean) {
            val baseUrl = url.text.toString().trim(); val user = username.text.toString().trim(); val pass = password.text.toString()
            val playlistName = name.text.toString().trim().ifBlank { "BLOFY Server" }
            val validation = PlaylistUrlPolicy.validate(baseUrl)
            if (validation == PlaylistUrlPolicy.Result.EMPTY) { status.text = "أدخل رابط السيرفر"; return }
            if (validation == PlaylistUrlPolicy.Result.INVALID) { status.text = "الرابط غير صحيح"; return }
            if (validation == PlaylistUrlPolicy.Result.USER_INFO_NOT_ALLOWED) { status.text = "استخدم حقول اسم المستخدم وكلمة المرور"; return }
            if (validation == PlaylistUrlPolicy.Result.UNSAFE_HOST) { status.text = "عنوان السيرفر غير مسموح"; return }
            if (user.isBlank() || pass.isBlank()) { status.text = "أدخل اسم المستخدم وكلمة المرور"; return }
            if (validation == PlaylistUrlPolicy.Result.HTTP_CLEAR_TEXT && confirmedHttpUrl != baseUrl) {
                AlertDialog.Builder(this@PlaylistActivity).setTitle("اتصال HTTP غير مشفر").setMessage("هل تريد المتابعة بهذا الرابط؟")
                    .setNegativeButton("رجوع", null).setPositiveButton("متابعة") { _, _ -> confirmedHttpUrl = baseUrl; lifecycleScope.launch { persist(connectAfter) } }.show(); return
            }
            if (busy) return
            busy = true; status.text = "جاري حفظ Xtream..."
            try {
                val provider = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao(); val existing = editingProviderId?.let { dao.provider(it) }
                    val type = "xtream"
                    val normalizedBaseUrl = baseUrl.trimEnd('/')
                    val id = existing?.id ?: UUID.nameUUIDFromBytes("$type|$normalizedBaseUrl|$user".toByteArray()).toString()
                    val next = ProviderEntity(id, playlistName, normalizedBaseUrl, user, pass, type,
                        existing?.liveFormat ?: "ts", existing?.preferredTransport ?: "cronet", existing?.preferredEngine ?: "media3", existing?.allowCrossProtocolRedirects ?: true, true, System.currentTimeMillis())
                    val hasCatalog = dao.hasCatalog(id)
                    val cacheReady = hasCatalog && CatalogSyncState.isReady(applicationContext, id)
                    val sourceChanged = existing != null && (existing.baseUrl != next.baseUrl || existing.username != next.username || existing.password != next.password || existing.providerType != next.providerType)

                    if (!cacheReady) {
                        // Do not perform a huge first import inside this form. Persist the provider and
                        // let CatalogLoadingActivity own progress, cancellation and section checkpoints.
                        CatalogSyncState.markPending(applicationContext, id)
                        dao.saveAndActivateProvider(next)
                    } else if (sourceChanged) {
                        // Existing healthy libraries keep the staged replacement path so a failed edit
                        // cannot destroy the last known-good catalog.
                        CatalogSyncState.markPending(applicationContext, id)
                        val staging = next.copy(id = UUID.randomUUID().toString(), enabled = false); var promoted = false
                        try {
                            val result = PlaylistSyncPolicy.run { PlaylistManager(XtreamClient.api, dao).syncAll(staging) }
                            check(result.freshItemCount > 0) { "السيرفر لم يرجع محتوى" }; check(result.failedSectionCount == 0) { "تعذر تحميل أحد أقسام القائمة" }
                            withContext(NonCancellable) {
                                dao.promoteStagedCatalog(staging.id, next); promoted = true
                                CatalogSyncState.markSourceReplaced(applicationContext, id)
                            }
                        } finally { if (!promoted) withContext(NonCancellable) { dao.discardStagedCatalog(staging.id) } }
                        CatalogSyncState.markReady(applicationContext, id)
                    } else {
                        dao.saveAndActivateProvider(next)
                        CatalogSyncState.markReady(applicationContext, id)
                    }
                    val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim(); if (endpoint.isNotBlank()) runCatching { PortalPlaylistClient.pushProvider(applicationContext, endpoint, next) }
                    next
                }
                setResult(RESULT_OK); status.text = if (connectAfter) "تم الحفظ • جاري الدخول" else "تم الحفظ"
                if (connectAfter) {
                    startActivity(Intent(this@PlaylistActivity, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id)); finish()
                } else finish()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { status.text = "تعذر تجهيز السيرفر • ${error.message ?: "خطأ اتصال"}"; busy = false }
        }

        fun action(label: String, primary: Boolean, connectAfter: Boolean) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 16f; setTextColor(Color.WHITE); isFocusable = true; isFocusableInTouchMode = true; background = buttonBackground(false, primary)
            setOnFocusChangeListener { view, focused -> view.background = buttonBackground(focused, primary); view.animate().scaleX(if (focused) 1.03f else 1f).scaleY(if (focused) 1.03f else 1f).setDuration(90).start() }
            setOnClickListener { lifecycleScope.launch { persist(connectAfter) } }
        }
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER }
        val saveConnect = action("حفظ واتصال", true, true); val saveOnly = action("حفظ", false, false)
        actions.addView(saveConnect, LinearLayout.LayoutParams(if (phone) 0 else 300, if (phone) 62 else 66, if (phone) 1f else 0f).apply { marginStart = 8 })
        actions.addView(saveOnly, LinearLayout.LayoutParams(if (phone) 0 else 220, if (phone) 62 else 66, if (phone) 1f else 0f))
        panel.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, if (phone) 72 else 76).apply { topMargin = 12 })
        setContentView(root); name.requestFocus()

        if (editingProviderId != null) lifecycleScope.launch {
            val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().provider(editingProviderId) } ?: return@launch
            if (BlofySubscriberClient.isManaged(provider)) {
                startActivity(Intent(this@PlaylistActivity, BlofySubscriberActivity::class.java).putExtra(EXTRA_PROVIDER_ID, provider.id))
                finish()
                return@launch
            }
            name.setText(provider.name); url.setText(provider.baseUrl); username.setText(provider.username); password.setText(provider.password)
            status.text = if (provider.providerType.equals("xtream", true)) "XTREAM • ${provider.name}" else "هذه القائمة قديمة وغير مدعومة • أدخل بيانات Xtream"
        }
    }

    private fun panelBackground() = GradientDrawable().apply { cornerRadius = 24f; setColor(0xEA151020.toInt()); setStroke(1, 0xFF67458E.toInt()) }
    private fun fieldBackground(focused: Boolean) = GradientDrawable().apply { cornerRadius = 16f; setColor(0xFF110F19.toInt()); setStroke(if (focused) 3 else 1, if (focused) 0xFFBE87FF.toInt() else 0xFF342C44.toInt()) }
    private fun buttonBackground(focused: Boolean, primary: Boolean) = GradientDrawable().apply { cornerRadius = 18f; setColor(if (focused) 0xFF7D45D9.toInt() else if (primary) 0xFF5F2AB5.toInt() else 0xFF241A30.toInt()); setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else 0xFF69468F.toInt()) }

    companion object { const val EXTRA_PROVIDER_ID = "provider_id"; const val EXTRA_DIRECT_FORM = "direct_form" }
}
