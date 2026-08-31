package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ParentalPinManager
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.playlist.ProviderManagerActivity

class SettingsActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var status: TextView
    private lateinit var content: LinearLayout
    private lateinit var sectionRail: LinearLayout
    private var currentSection = SECTION_PLAYBACK
    private val prefs by lazy { getSharedPreferences("blofy_settings", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = LinearLayout.LAYOUT_DIRECTION_LTR
            setPadding(dp(26), dp(22), dp(26), dp(22))
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
        }
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(26), 0, dp(24), 0) }
        content.addView(TextView(this).apply {
            text = getString(R.string.settings_title); textSize = 31f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT
        })
        status = TextView(this).apply { textSize = 13f; setTextColor(SOFT); gravity = Gravity.RIGHT; setPadding(0, dp(6), 0, dp(14)) }
        content.addView(status)
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        sectionRail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP; setPadding(dp(10), dp(12), dp(10), dp(12)); background = panelBackground()
        }
        val sections = listOf(
            SECTION_PLAYBACK to getString(R.string.settings_playback),
            SECTION_AUDIO to getString(R.string.settings_audio),
            SECTION_SUBTITLES to getString(R.string.settings_subtitles),
            SECTION_LANGUAGE to getString(R.string.settings_language),
            SECTION_NETWORK to getString(R.string.settings_network),
            SECTION_APPEARANCE to getString(R.string.settings_appearance),
            SECTION_STORAGE to getString(R.string.settings_storage),
            SECTION_DEVICE to getString(R.string.settings_device),
        )
        sections.forEach { (key, label) ->
            sectionRail.addView(navButton(label) { currentSection = key; renderSection() }, LinearLayout.LayoutParams(dp(245), dp(62)).apply { bottomMargin = dp(7) })
        }
        root.addView(sectionRail, LinearLayout.LayoutParams(dp(275), LinearLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull() ?: run {
                status.text = "لا توجد قائمة تشغيل نشطة"; renderSection(); return@launch
            }
            refreshStatus(); renderSection()
        }
    }

    private fun renderSection() {
        while (content.childCount > 2) content.removeViewAt(2)
        val scroll = ScrollView(this).apply { isFocusable = false }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.RIGHT; setPadding(0, dp(8), 0, dp(22)) }
        when (currentSection) {
            SECTION_PLAYBACK -> {
                box.addView(sectionTitle(getString(R.string.settings_playback))); box.addView(sectionHint("خيارات المشغل والعرض بدون تغيير محرك Media3/FFmpeg الحالي."))
                box.addView(optionRow("صيغة البث المباشر", providerValue { liveFormat.uppercase() }, "MPEG-TS") { updateProvider { copy(liveFormat = "ts") } }, "HLS") { updateProvider { copy(liveFormat = "m3u8") } })
                box.addView(toggleRow("تشغيل المعاينة تلقائيًا", "preview_auto", true))
                box.addView(toggleRow("الانتقال السريع بين القنوات", "fast_channel_zap", true))
                box.addView(toggleRow("استئناف الأفلام والحلقات", "resume_enabled", true))
            }
            SECTION_AUDIO -> {
                box.addView(sectionTitle(getString(R.string.settings_audio))); box.addView(sectionHint("اختيار المسار يتم من مشغل الأفلام والمسلسلات عند توفر أكثر من مسار."))
                box.addView(toggleRow("تذكر آخر مسار صوت", "remember_audio", true)); box.addView(toggleRow("تفضيل Stereo", "prefer_stereo", false))
            }
            SECTION_SUBTITLES -> {
                box.addView(sectionTitle(getString(R.string.settings_subtitles))); box.addView(sectionHint("خيارات الترجمة تظهر في Full Screen للأفلام والمسلسلات فقط."))
                box.addView(toggleRow("تذكر آخر ترجمة", "remember_subtitles", true)); box.addView(choiceRow("حجم الترجمة", "subtitle_size", listOf("صغير", "متوسط", "كبير"), "متوسط"))
            }
            SECTION_LANGUAGE -> {
                box.addView(sectionTitle(getString(R.string.settings_language))); box.addView(sectionHint("اختر لغة الواجهة. العربية تستخدم RTL تلقائيًا واللغات الأخرى LTR."))
                box.addView(languageRow())
            }
            SECTION_NETWORK -> {
                box.addView(sectionTitle(getString(R.string.settings_network))); box.addView(sectionHint("هذه إعدادات اتصال الكتالوج والبث العامة وليست تغييرًا للمحرك."))
                box.addView(optionRow("النقل المفضل", providerValue { preferredTransport.uppercase() }, "Cronet") { updateProvider { copy(preferredTransport = "cronet") } }, "HTTP") { updateProvider { copy(preferredTransport = "http") } })
                box.addView(toggleProviderRow("السماح بتحويلات البروتوكول", { allowCrossProtocolRedirects }) { copy(allowCrossProtocolRedirects = !allowCrossProtocolRedirects) })
            }
            SECTION_APPEARANCE -> {
                box.addView(sectionTitle(getString(R.string.settings_appearance))); box.addView(sectionHint("هوية BLOFY البنفسجية ثابتة في شاشات TV."))
                box.addView(toggleRow("تكبير العنصر عند التركيز", "focus_scale", true)); box.addView(toggleRow("حركات واجهة خفيفة", "ui_motion", true))
            }
            SECTION_STORAGE -> {
                box.addView(sectionTitle(getString(R.string.settings_storage))); box.addView(sectionHint("الكتالوج المحمّل يبقى محليًا لفتح التطبيق بسرعة."))
                box.addView(actionRow("تحديث القنوات والأفلام والمسلسلات") { refreshLibrary() }); box.addView(actionRow("إدارة قوائم التشغيل") { startActivity(Intent(this, ProviderManagerActivity::class.java)) })
            }
            SECTION_DEVICE -> {
                box.addView(sectionTitle(getString(R.string.settings_device)));
                box.addView(infoRow("الإصدار", BuildConfig.VERSION_NAME)); box.addView(infoRow("Media3 + FFmpeg", if (BuildConfig.FFMPEG_EXTENSION_BUNDLED) "جاهز" else "Media3 فقط")); box.addView(actionRow("حالة النظام / QA") { startActivity(Intent(this, SystemStatusActivity::class.java)) })
                box.addView(actionRow(if (ParentalPinManager.hasPin(this)) "تغيير PIN" else "إنشاء PIN") { changePin() })
            }
        }
        scroll.addView(box); content.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        box.post { if (box.childCount > 2) box.getChildAt(2).requestFocus() }
    }

    private fun languageRow(): Button {
        val selectedTag = prefs.getString("app_language_tag", "ar") ?: "ar"
        val selected = LANGUAGES.firstOrNull { it.second == selectedTag }?.first ?: "العربية"
        return actionButton("${getString(R.string.language_app)}: $selected") {
            val labels = LANGUAGES.map { it.first }.toTypedArray()
            AlertDialog.Builder(this).setTitle(getString(R.string.language_app)).setItems(labels) { dialog, which ->
                val (label, tag) = LANGUAGES[which]
                prefs.edit().putString("app_language", label).putString("app_language_tag", tag).apply()
                AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
                dialog.dismiss()
            }.show()
        }
    }

    private fun sectionTitle(value: String) = TextView(this).apply { text = value; textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT }
    private fun sectionHint(value: String) = TextView(this).apply { text = value; textSize = 14f; setTextColor(SOFT); gravity = Gravity.RIGHT; setPadding(0, dp(6), 0, dp(18)) }
    private fun infoRow(label: String, value: String) = TextView(this).apply { text = "$label    $value"; textSize = 17f; setTextColor(Color.WHITE); gravity = Gravity.RIGHT; background = itemBackground(false); setPadding(dp(18), dp(16), dp(18), dp(16)) }
    private fun actionRow(label: String, action: () -> Unit) = actionButton(label, action)

    private fun optionRow(label: String, value: String, a: String, onA: () -> Unit, b: String, onB: () -> Unit): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = LinearLayout.LAYOUT_DIRECTION_RTL; setPadding(0, 0, 0, dp(10))
        addView(TextView(this@SettingsActivity).apply { text = "$label\n$value"; textSize = 16f; setTextColor(Color.WHITE); gravity = Gravity.RIGHT }, LinearLayout.LayoutParams(0, dp(72), 1f))
        addView(actionButton(a, onA), LinearLayout.LayoutParams(dp(170), dp(68)).apply { marginStart = dp(8) }); addView(actionButton(b, onB), LinearLayout.LayoutParams(dp(170), dp(68)))
    }

    private fun toggleRow(label: String, key: String, default: Boolean): Button = actionButton("$label: ${if (prefs.getBoolean(key, default)) getString(R.string.state_on) else getString(R.string.state_off)}") {
        prefs.edit().putBoolean(key, !prefs.getBoolean(key, default)).apply(); renderSection()
    }
    private fun toggleProviderRow(label: String, value: ProviderEntity.() -> Boolean, change: ProviderEntity.() -> ProviderEntity): Button = actionButton("$label: ${if (::provider.isInitialized && provider.value()) getString(R.string.state_on) else getString(R.string.state_off)}") { updateProvider(change) }
    private fun choiceRow(label: String, key: String, values: List<String>, current: String): Button = actionButton("$label: $current") {
        AlertDialog.Builder(this).setTitle(label).setItems(values.toTypedArray()) { _, which -> prefs.edit().putString(key, values[which]).apply(); renderSection() }.show()
    }

    private fun navButton(label: String, action: () -> Unit) = actionButton(label, action)
    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f; isFocusable = true; setTextColor(Color.WHITE); background = itemBackground(false)
        setOnFocusChangeListener { view, focused -> view.background = itemBackground(focused); view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(90).start() }
        setOnClickListener { action() }
    }
    private fun panelBackground() = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0xE4141020.toInt()); setStroke(dp(1), 0x554A355F) }
    private fun itemBackground(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(15).toFloat(); setColor(if (focused) PURPLE else 0xC51B1528.toInt()); setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x554A355F) }

    private fun updateProvider(change: ProviderEntity.() -> ProviderEntity) {
        if (!::provider.isInitialized) return
        lifecycleScope.launch { provider = provider.change().copy(updatedAt = System.currentTimeMillis()); BlofyDatabase.get(applicationContext).dao().upsertProvider(provider); refreshStatus(); renderSection() }
    }
    private fun refreshLibrary() {
        if (!::provider.isInitialized) return
        status.text = "جاري تحديث الباقة..."
        lifecycleScope.launch { runCatching { withContext(Dispatchers.IO) { PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(provider) } }.onSuccess { status.text = "اكتمل التحديث • ${provider.name}" }.onFailure { status.text = "تعذر التحديث: ${it.message ?: "خطأ اتصال"}" } }
    }
    private fun refreshStatus() { status.text = "${provider.name} • ${provider.providerType.uppercase()} • ${provider.liveFormat.uppercase()}" }
    private fun <T> providerValue(block: ProviderEntity.() -> T): String = if (::provider.isInitialized) provider.block().toString() else "—"
    private fun changePin() {
        val input = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD; hint = "4 إلى 6 أرقام"; isSingleLine = true }
        val save = { if (ParentalPinManager.setPin(this, input.text.toString())) status.text = "تم حفظ PIN" else input.error = "أدخل 4 إلى 6 أرقام" }
        val show = { AlertDialog.Builder(this).setTitle("PIN جديد").setView(input).setPositiveButton("حفظ") { _, _ -> save() }.setNegativeButton("إلغاء", null).show() }
        if (ParentalPinManager.hasPin(this)) ParentalGate.requirePin(this) { show() } else show()
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val SECTION_PLAYBACK = "playback"; private const val SECTION_AUDIO = "audio"; private const val SECTION_SUBTITLES = "subtitles"; private const val SECTION_LANGUAGE = "language"; private const val SECTION_NETWORK = "network"; private const val SECTION_APPEARANCE = "appearance"; private const val SECTION_STORAGE = "storage"; private const val SECTION_DEVICE = "device"
        private val PURPLE = Color.rgb(126, 44, 255); private val SOFT = Color.rgb(195, 175, 220)
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
