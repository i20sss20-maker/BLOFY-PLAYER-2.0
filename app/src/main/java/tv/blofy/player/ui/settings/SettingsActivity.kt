package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ParentalPinManager
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.playlist.ProviderManagerActivity

class SettingsActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var status: TextView
    private lateinit var content: LinearLayout
    private var currentSection = SECTION_PLAYBACK
    private val prefs by lazy { getSharedPreferences("blofy_settings", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = LinearLayout.LAYOUT_DIRECTION_LTR
            setPadding(dp(26), dp(22), dp(26), dp(22))
            background = V339Ui.screenGradient()
        }

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), 0, dp(24), 0)
            layoutDirection = LinearLayout.LAYOUT_DIRECTION_RTL
        }
        content.addView(V339Ui.title(this, getString(R.string.settings_title), 31f).apply { gravity = Gravity.RIGHT })
        status = V339Ui.text(this, "إعدادات BLOFY PLAYER", 13f, V339Ui.MUTED).apply {
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, dp(14))
        }
        content.addView(status)
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        val sectionRail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            layoutDirection = LinearLayout.LAYOUT_DIRECTION_RTL
            setPadding(dp(10), dp(12), dp(10), dp(12))
            background = V339Ui.panel(this@SettingsActivity, V339Ui.PANEL, 18, V339Ui.STROKE)
        }
        listOf(
            SECTION_PLAYBACK to "التشغيل",
            SECTION_MEDIA to "الصوت والترجمة",
            SECTION_LANGUAGE to "اللغة",
            SECTION_LIBRARY to "المحتوى",
            SECTION_PARENTAL to "الرقابة الأبوية"
        ).forEach { (key, label) ->
            sectionRail.addView(navButton(label) {
                currentSection = key
                renderSection()
            }, LinearLayout.LayoutParams(dp(245), dp(62)).apply { bottomMargin = dp(7) })
        }
        root.addView(sectionRail, LinearLayout.LayoutParams(dp(275), LinearLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull() ?: run {
                renderSection()
                return@launch
            }
            renderSection()
        }
    }

    private fun renderSection() {
        while (content.childCount > 2) content.removeViewAt(2)
        val scroll = ScrollView(this).apply { isFocusable = false }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT
            layoutDirection = LinearLayout.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(8), 0, dp(22))
        }
        when (currentSection) {
            SECTION_PLAYBACK -> renderPlayback(box)
            SECTION_MEDIA -> renderMedia(box)
            SECTION_LANGUAGE -> renderLanguage(box)
            SECTION_LIBRARY -> renderLibrary(box)
            SECTION_PARENTAL -> renderParental(box)
        }
        scroll.addView(box)
        content.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        box.post { if (box.childCount > 2) box.getChildAt(2).requestFocus() }
    }

    private fun renderPlayback(box: LinearLayout) {
        box.addView(sectionTitle("التشغيل"))
        if (!::provider.isInitialized) {
            box.addView(sectionHint("أضف قائمة تشغيل أولاً لعرض إعدادات المحرك."))
            return
        }
        box.addView(sectionHint("هذه الخيارات مرتبطة مباشرة بملف تشغيل السيرفر الحالي."))
        box.addView(choiceButton("محرك التشغيل", if (provider.preferredEngine.equals("vlc", true)) "VLC" else "Media3", listOf("Media3", "VLC")) { selected ->
            updateProvider(provider.copy(preferredEngine = if (selected == "VLC") "vlc" else "media3"))
        })
        box.addView(choiceButton("اتصال الشبكة", if (provider.preferredTransport.equals("http", true)) "HTTP" else "Cronet", listOf("Cronet", "HTTP")) { selected ->
            updateProvider(provider.copy(preferredTransport = if (selected == "HTTP") "http" else "cronet"))
        })
        box.addView(choiceButton("صيغة البث المباشر", if (provider.liveFormat.equals("m3u8", true)) "M3U8 / HLS" else "TS", listOf("TS", "M3U8 / HLS")) { selected ->
            updateProvider(provider.copy(liveFormat = if (selected.startsWith("M3U8")) "m3u8" else "ts"))
        })
        box.addView(toggleProviderRow("السماح بالتحويل بين HTTP و HTTPS", provider.allowCrossProtocolRedirects) { enabled ->
            updateProvider(provider.copy(allowCrossProtocolRedirects = enabled))
        })
    }

    private fun renderMedia(box: LinearLayout) {
        box.addView(sectionTitle("الصوت والترجمة"))
        box.addView(sectionHint("اختيار المسار الصوتي والترجمة والجودة يتم من شاشة المشغل عند توفرها في الملف."))
        box.addView(infoRow("الصوت", "اختيار المسارات المتوفرة داخل الفيلم أو الحلقة"))
        box.addView(infoRow("الترجمة", "تشغيل أو إيقاف واختيار مسار الترجمة من المشغل"))
        box.addView(infoRow("الجودة", "اختيار دقة الفيديو المتاحة من نفس البث"))
        box.addView(infoRow("البث المباشر", "لا تظهر له أزرار الصوت والترجمة والجودة غير الضرورية"))
    }

    private fun renderLanguage(box: LinearLayout) {
        box.addView(sectionTitle("اللغة"))
        box.addView(sectionHint("اختر لغة واجهة التطبيق من اللغات المتاحة."))
        box.addView(languageRow())
    }

    private fun renderLibrary(box: LinearLayout) {
        box.addView(sectionTitle("المحتوى"))
        box.addView(sectionHint("تحديث الباقة يدويًا أو إدارة قوائم التشغيل."))
        box.addView(actionRow("تحديث القنوات والأفلام والمسلسلات") { refreshLibrary() })
        box.addView(actionRow("إدارة قوائم التشغيل") { startActivity(Intent(this, ProviderManagerActivity::class.java)) })
    }

    private fun renderParental(box: LinearLayout) {
        box.addView(sectionTitle("الرقابة الأبوية"))
        box.addView(sectionHint("حماية المحتوى برمز PIN."))
        box.addView(actionRow(if (ParentalPinManager.hasPin(this)) "تغيير PIN" else "إنشاء PIN") { changePin() })
    }

    private fun languageRow(): Button {
        val selectedTag = prefs.getString("app_language_tag", "ar") ?: "ar"
        val selected = LANGUAGES.firstOrNull { it.second == selectedTag }?.first ?: "العربية"
        return actionButton("لغة التطبيق: $selected") {
            val labels = LANGUAGES.map { it.first }.toTypedArray()
            AlertDialog.Builder(this).setTitle("لغة التطبيق").setItems(labels) { dialog, which ->
                val (label, tag) = LANGUAGES[which]
                prefs.edit().putString("app_language", label).putString("app_language_tag", tag).apply()
                AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
                dialog.dismiss()
            }.show()
        }
    }

    private fun sectionTitle(value: String) = V339Ui.title(this, value, 27f).apply { gravity = Gravity.RIGHT }

    private fun sectionHint(value: String) = V339Ui.text(this, value, 14f, V339Ui.MUTED).apply {
        gravity = Gravity.RIGHT
        setPadding(0, dp(6), 0, dp(18))
    }

    private fun infoRow(title: String, description: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.RIGHT
        layoutDirection = LinearLayout.LAYOUT_DIRECTION_RTL
        setPadding(dp(20), dp(14), dp(20), dp(14))
        background = V339Ui.focusDrawable(this@SettingsActivity, V339Ui.PANEL, V339Ui.PANEL_SOFT, V339Ui.PURPLE_LIGHT)
        addView(V339Ui.title(this@SettingsActivity, title, 16f).apply { gravity = Gravity.RIGHT })
        addView(V339Ui.text(this@SettingsActivity, description, 13f, V339Ui.MUTED).apply {
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, 0)
        })
    }.also {
        it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) }
    }

    private fun choiceButton(label: String, current: String, values: List<String>, onSelect: (String) -> Unit): Button =
        actionButton("$label: $current") {
            AlertDialog.Builder(this).setTitle(label).setItems(values.toTypedArray()) { dialog, which ->
                onSelect(values[which])
                dialog.dismiss()
            }.show()
        }

    private fun toggleProviderRow(label: String, enabled: Boolean, onChange: (Boolean) -> Unit): Button =
        actionButton("$label: ${if (enabled) getString(R.string.state_on) else getString(R.string.state_off)}") { onChange(!enabled) }

    private fun updateProvider(updated: ProviderEntity) {
        lifecycleScope.launch {
            val saved = updated.copy(updatedAt = System.currentTimeMillis())
            BlofyDatabase.get(applicationContext).dao().upsertProvider(saved)
            provider = saved
            status.text = "تم حفظ إعدادات التشغيل"
            renderSection()
        }
    }

    private fun actionRow(label: String, action: () -> Unit) = actionButton(label, action)
    private fun navButton(label: String, action: () -> Unit) = actionButton(label, action)

    private fun actionButton(label: String, action: () -> Unit) = V339Ui.button(this, label, false).apply {
        textSize = 15f
        setOnClickListener { action() }
    }

    private fun refreshLibrary() {
        if (!::provider.isInitialized) {
            status.text = "لا توجد قائمة تشغيل نشطة"
            return
        }
        status.text = "جاري تحديث المحتوى..."
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(provider)
                }
            }.onSuccess { status.text = "اكتمل تحديث المحتوى" }
                .onFailure { status.text = "تعذر تحديث المحتوى" }
        }
    }

    private fun changePin() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "4 إلى 6 أرقام"
            isSingleLine = true
            setTextColor(V339Ui.TEXT)
            setHintTextColor(V339Ui.MUTED)
            background = V339Ui.focusDrawable(this@SettingsActivity, Color.argb(220, 16, 15, 28), V339Ui.PANEL_SOFT, V339Ui.PURPLE_LIGHT)
        }
        val show = {
            AlertDialog.Builder(this)
                .setTitle("PIN جديد")
                .setView(input)
                .setPositiveButton("حفظ") { _, _ ->
                    if (ParentalPinManager.setPin(this, input.text.toString())) status.text = "تم حفظ PIN"
                    else status.text = "أدخل 4 إلى 6 أرقام"
                }
                .setNegativeButton("إلغاء", null)
                .show()
        }
        if (ParentalPinManager.hasPin(this)) ParentalGate.requirePin(this) { show() } else show()
    }

    private fun dp(v: Int) = V339Ui.dp(this, v)

    companion object {
        private const val SECTION_PLAYBACK = "playback"
        private const val SECTION_MEDIA = "media"
        private const val SECTION_LANGUAGE = "language"
        private const val SECTION_LIBRARY = "library"
        private const val SECTION_PARENTAL = "parental"
        private val LANGUAGES = listOf(
            "العربية" to "ar",
            "English" to "en",
            "Français" to "fr",
            "Español" to "es",
            "Deutsch" to "de",
            "Türkçe" to "tr",
            "Português" to "pt",
            "Italiano" to "it"
        )
    }
}
