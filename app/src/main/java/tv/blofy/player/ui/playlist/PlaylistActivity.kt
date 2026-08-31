package tv.blofy.player.ui.playlist

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import java.util.UUID

class PlaylistActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val editingProviderId = intent.getStringExtra(EXTRA_PROVIDER_ID)
        val device = DeviceClass.detect(this)
        val phone = device == DeviceClass.Kind.PHONE
        val tv = device == DeviceClass.Kind.TV

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP else Gravity.CENTER
            setPadding(if (phone) 22 else 60, if (phone) 24 else 48, if (phone) 22 else 60, if (phone) 24 else 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = if (editingProviderId == null) "إضافة قائمة تشغيل" else "تعديل قائمة التشغيل"
            textSize = if (phone) 25f else 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "Xtream Codes أو M3U مباشر"
            textSize = 15f
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 6, 0, 22)
        })

        fun field(hintText: String, passwordField: Boolean = false) = EditText(this).apply {
            hint = hintText
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setPadding(20, 0, 20, 0)
            background = fieldBackground(false)
            isFocusable = true
            setOnFocusChangeListener { view, focused -> if (tv) view.background = fieldBackground(focused) }
            if (passwordField) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        val name = field("اسم القائمة")
        val url = field("رابط السيرفر أو رابط M3U")
        val username = field("اسم المستخدم — اتركه فارغًا لـ M3U")
        val password = field("كلمة المرور — اتركها فارغة لـ M3U", true)

        fun addField(field: EditText) {
            root.addView(field, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 650, if (phone) 62 else 68).apply { topMargin = 12 })
        }
        addField(name)
        addField(url)

        val transportNotice = TextView(this).apply {
            text = "يفضّل استخدام HTTPS. تُقبل روابط HTTP للتوافق مع بعض السيرفرات."
            textSize = if (phone) 13f else 14f
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(8, 9, 8, 0)
        }
        root.addView(transportNotice, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 650, LinearLayout.LayoutParams.WRAP_CONTENT))
        url.doAfterTextChanged { value ->
            val candidate = value?.toString()?.trim().orEmpty()
            when {
                candidate.startsWith("http://", ignoreCase = true) -> {
                    transportNotice.text = "تنبيه أمني: اتصال HTTP غير مشفّر، وقد تظهر بيانات الدخول والمحتوى لأي جهة على الشبكة."
                    transportNotice.setTextColor(Color.rgb(255, 179, 71))
                }
                candidate.startsWith("https://", ignoreCase = true) -> {
                    transportNotice.text = "اتصال HTTPS مشفّر (موصى به)."
                    transportNotice.setTextColor(Color.rgb(116, 224, 174))
                }
                else -> {
                    transportNotice.text = "يفضّل استخدام HTTPS. تُقبل روابط HTTP للتوافق مع بعض السيرفرات."
                    transportNotice.setTextColor(Color.rgb(185, 140, 255))
                }
            }
        }
        listOf(username, password).forEach {
            root.addView(it, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 650, if (phone) 62 else 68).apply { topMargin = 12 })
        }

        val status = TextView(this).apply {
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 4)
        }
        root.addView(status)

        var confirmedHttpUrl: String? = null
        val save = Button(this).apply {
            text = if (editingProviderId == null) "حفظ القائمة" else "حفظ التعديلات"
            isAllCaps = false
            textSize = 16f
            isFocusable = tv
            isFocusableInTouchMode = tv
            setTextColor(Color.WHITE)
            background = buttonBackground(false)
            setOnFocusChangeListener { view, focused -> if (tv) view.background = buttonBackground(focused) }
            setOnClickListener {
                val baseUrl = url.text.toString().trim()
                val user = username.text.toString().trim()
                val pass = password.text.toString()
                val isM3u = user.isBlank() && pass.isBlank()
                val partialXtream = user.isBlank() xor pass.isBlank()
                when (PlaylistUrlPolicy.validate(baseUrl)) {
                    PlaylistUrlPolicy.Result.EMPTY -> {
                        status.text = "أدخل رابط القائمة"
                        return@setOnClickListener
                    }
                    PlaylistUrlPolicy.Result.INVALID -> {
                        status.text = "الرابط غير صحيح. أدخل رابطًا كاملًا يبدأ بـ https:// أو http://"
                        return@setOnClickListener
                    }
                    PlaylistUrlPolicy.Result.USER_INFO_NOT_ALLOWED -> {
                        status.text = "لا تضع اسم المستخدم أو كلمة المرور داخل الرابط؛ استخدم الحقول المخصصة."
                        return@setOnClickListener
                    }
                    PlaylistUrlPolicy.Result.UNSAFE_HOST -> {
                        status.text = "لا يمكن استخدام عنوان محلي أو خاص. أدخل رابط السيرفر العام."
                        return@setOnClickListener
                    }
                    PlaylistUrlPolicy.Result.HTTP_CLEAR_TEXT -> {
                        if (confirmedHttpUrl != baseUrl) {
                            val saveButton = this
                            AlertDialog.Builder(this@PlaylistActivity)
                                .setTitle("اتصال HTTP غير مشفّر")
                                .setMessage("قد تظهر بيانات الدخول والمحتوى لأي جهة على الشبكة. استخدم HTTPS متى توفر، أو تابع فقط إذا كان هذا هو الرابط الرسمي لسيرفرك.")
                                .setNegativeButton("رجوع", null)
                                .setPositiveButton("متابعة وحفظ") { _, _ ->
                                    confirmedHttpUrl = baseUrl
                                    saveButton.performClick()
                                }
                                .show()
                            return@setOnClickListener
                        }
                    }
                    PlaylistUrlPolicy.Result.VALID -> Unit
                }
                if (partialXtream) { status.text = "أدخل اسم المستخدم وكلمة المرور معًا، أو اتركهما معًا لـ M3U"; return@setOnClickListener }
                isEnabled = false
                status.text = if (isM3u) "جاري قراءة M3U وحفظها محليًا..." else "جاري تحميل Xtream وحفظها محليًا..."
                lifecycleScope.launch {
                    try {
                        val portalSynced = withContext(Dispatchers.IO) {
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
                                enabled = true,
                                updatedAt = System.currentTimeMillis()
                            )
                            val stagingProvider = provider.copy(
                                id = UUID.randomUUID().toString(),
                                enabled = false
                            )
                            var promoted = false

                            try {
                                // Network writes go to an invisible staging ID. Only a non-empty
                                // fresh response is promoted atomically over the working provider.
                                val syncResult = PlaylistSyncPolicy.run {
                                    PlaylistManager(XtreamClient.api, dao).syncAll(stagingProvider)
                                }
                                check(syncResult.freshItemCount > 0) {
                                    "لم يرجع السيرفر أي قنوات أو أفلام أو مسلسلات من بيانات الدخول الحالية"
                                }
                                check(syncResult.failedSectionCount == 0) {
                                    "تعذر تحميل أحد أقسام القائمة؛ بقيت القائمة السابقة كما هي"
                                }
                                dao.promoteStagedCatalog(stagingProvider.id, provider)
                                promoted = true

                                val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
                                if (endpoint.isBlank()) {
                                    true
                                } else {
                                    try {
                                        PortalPlaylistClient.pushProvider(applicationContext, endpoint, provider)
                                        true
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (_: Exception) {
                                        false
                                    }
                                }
                            } finally {
                                if (!promoted) {
                                    withContext(NonCancellable) {
                                        dao.discardStagedCatalog(stagingProvider.id)
                                    }
                                }
                            }
                        }

                        setResult(RESULT_OK)
                        if (portalSynced) {
                            status.text = "تم حفظ القائمة وربطها بالموقع"
                            finish()
                        } else {
                            status.text = "تم حفظ القائمة داخل التطبيق، لكن تعذر ربطها بالموقع. اضغط حفظ لإعادة المحاولة."
                            isEnabled = true
                        }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        status.text = "تعذر تحميل القائمة: ${error.message ?: "خطأ اتصال"}"
                        isEnabled = true
                    }
                }
            }
        }
        root.addView(save, LinearLayout.LayoutParams(if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 380, if (phone) 66 else 78).apply { topMargin = 18 })
        setContentView(root)
        name.requestFocus()

        if (editingProviderId != null) {
            lifecycleScope.launch {
                val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().provider(editingProviderId) } ?: return@launch
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

    companion object { const val EXTRA_PROVIDER_ID = "provider_id" }
}
