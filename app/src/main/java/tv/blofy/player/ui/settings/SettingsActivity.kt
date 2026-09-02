package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.GridLayout
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
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.playlist.ProviderManagerActivity

class SettingsActivity : AppCompatActivity() {
    private var provider: ProviderEntity? = null
    private lateinit var status: TextView
    private lateinit var grid: GridLayout
    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
            buildPage()
        }
    }

    private fun buildPage() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(BACKGROUND)
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), dp(24), dp(34), dp(28))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        val back = settingButton("↩  رجوع", true) { finish() }.apply { id = View.generateViewId() }
        header.addView(back, LinearLayout.LayoutParams(dp(150), dp(54)))
        header.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        titleBox.addView(TextView(this).apply {
            text = "الإعدادات"
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        titleBox.addView(TextView(this).apply {
            text = "تشغيل • صوت • ترجمة • أداء • قوائم"
            textSize = 13f
            setTextColor(MUTED)
            gravity = Gravity.RIGHT
        })
        header.addView(titleBox, LinearLayout.LayoutParams(dp(650), dp(70)))
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(78)))

        status = TextView(this).apply {
            text = "المحتوى محفوظ محليًا • لا إعادة تحميل عند فتح القوائم"
            textSize = 13f
            setTextColor(ACCENT_SOFT)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, dp(14))
        }
        page.addView(status)

        grid = GridLayout(this).apply {
            columnCount = if (isTv()) 4 else 2
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
        }
        val p = provider
        addCard(cycleProvider(
            "⚡  محرك التشغيل",
            if (p?.preferredEngine.equals("vlc", true)) "vlc" else "media3",
            arrayOf("media3", "vlc"),
            arrayOf("Media3 + FFmpeg", "VLC")
        ) { value -> p?.let { saveProvider(it.copy(preferredEngine = value)) } })
        addCard(cycleProvider(
            "◉  اتصال الشبكة",
            if (p?.preferredTransport.equals("http", true)) "http" else "cronet",
            arrayOf("cronet", "http"),
            arrayOf("Cronet سريع", "HTTP متوافق")
        ) { value -> p?.let { saveProvider(it.copy(preferredTransport = value)) } })
        addCard(cycleProvider(
            "▶  صيغة البث",
            if (p?.liveFormat.equals("m3u8", true)) "m3u8" else "ts",
            arrayOf("ts", "m3u8"),
            arrayOf("MPEG-TS", "HLS / M3U8")
        ) { value -> p?.let { saveProvider(it.copy(liveFormat = value)) } })
        addCard(cycleSetting("↻  التخزين المؤقت", KEY_BUFFER,
            arrayOf("fast", "auto", "stable"), arrayOf("سريع", "تلقائي", "ثابت / 4K")))

        addCard(cycleSetting("▣  حجم الصورة", KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"), arrayOf("ملاءمة", "تكبير", "ملء الشاشة")))
        addCard(cycleSetting("♫  مخرج الصوت", KEY_AUDIO_OUTPUT,
            arrayOf("auto", "stereo"), arrayOf("تلقائي", "ستيريو 2.0")))
        addCard(cycleSetting("CC  لغة الترجمة", KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"), arrayOf("العربية أولًا", "تلقائي", "إيقاف")))
        addCard(cycleSetting("A  حجم الترجمة", KEY_SUBTITLE_SIZE,
            arrayOf("small", "medium", "large"), arrayOf("صغير", "متوسط", "كبير")))

        addCard(cycleSetting("◉  معاينة المباشر", KEY_AUTOPLAY_LIVE,
            arrayOf("on", "off"), arrayOf("تلقائي", "يدوي")))
        addCard(cycleSetting("◷  مواصلة المشاهدة", KEY_RESUME_PROMPT,
            arrayOf("on", "off"), arrayOf("اسألني", "تشغيل مباشر")))
        addCard(cycleSetting("▶  الحلقة التالية", KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"), arrayOf("اسألني", "تلقائي", "إيقاف")))
        addCard(cycleSetting("✦  حركة الواجهة", KEY_MOTION,
            arrayOf("smooth", "reduced"), arrayOf("سلسة", "خفيفة")))

        addCard(actionCard("🌐  لغة التطبيق", currentLanguageLabel()) { chooseLanguage() })
        addCard(actionCard("▤  قوائم التشغيل", "إدارة القوائم المحفوظة") {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        })
        addCard(actionCard("↻  تحديث المحتوى", "تحديث يدوي فقط") { refreshLibrary() })
        addCard(actionCard("↔  HTTP / HTTPS", if (p?.allowCrossProtocolRedirects == true) "السماح بالتحويل" else "مغلق") {
            provider?.let { saveProvider(it.copy(allowCrossProtocolRedirects = !it.allowCrossProtocolRedirects)) }
        })

        addCard(actionCard("⚙  المحركات", "Media3 + FFmpeg + VLC") {
            status.text = "محركات ومسارات التشغيل الحالية محفوظة بدون تغيير"
        })
        addCard(actionCard("✓  حالة النظام", "الفحص والتوافق") {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })
        addCard(actionCard("ⓘ  الكاش المحلي", "فتح فوري للقوائم") {
            status.text = "القنوات والأفلام والمسلسلات تُفتح من قاعدة البيانات المحلية وتُحدّث يدويًا فقط"
        })
        addCard(actionCard("⟲  استعادة الإعدادات", "القيم الافتراضية") {
            prefs.edit().clear().apply()
            buildPage()
        })

        linkFocus(back)
        page.addView(grid, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        page.addView(TextView(this).apply {
            text = "BLOFY PLAYER 2.0"
            textSize = 11f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(12) })
        scroll.addView(page)
        setContentView(scroll)
        grid.post { if (grid.childCount > 0) grid.getChildAt(0).requestFocus() }
    }

    private fun cycleProvider(title: String, current: String, values: Array<String>, labels: Array<String>, save: (String) -> Unit): Button {
        var index = values.indexOf(current).let { if (it < 0) 0 else it }
        lateinit var button: Button
        button = settingButton("", false) {
            index = (index + 1) % values.size
            button.text = "$title\n${labels[index]}"
            save(values[index])
        }
        button.text = "$title\n${labels[index]}"
        return button
    }

    private fun cycleSetting(title: String, key: String, values: Array<String>, labels: Array<String>): Button {
        fun currentIndex() = values.indexOf(prefs.getString(key, values[0])).let { if (it < 0) 0 else it }
        lateinit var button: Button
        button = settingButton("", false) {
            val next = (currentIndex() + 1) % values.size
            prefs.edit().putString(key, values[next]).apply()
            button.text = "$title\n${labels[next]}"
        }
        button.text = "$title\n${labels[currentIndex()]}"
        return button
    }

    private fun actionCard(title: String, subtitle: String, action: () -> Unit): Button =
        settingButton("$title\n$subtitle", false, action)

    private fun settingButton(label: String, compact: Boolean, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = if (compact) 15f else 14f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        isFocusable = true
        background = cardBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = cardBackground(focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).translationZ(if (focused) 12f else 2f).setDuration(90).start()
        }
        setOnClickListener { action() }
    }

    private fun addCard(button: Button) {
        button.id = View.generateViewId()
        grid.addView(button, GridLayout.LayoutParams().apply {
            columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            width = 0
            height = dp(88)
            setMargins(dp(5), dp(5), dp(5), dp(5))
        })
    }

    private fun linkFocus(back: Button) {
        val columns = grid.columnCount
        val count = grid.childCount
        if (count == 0) return
        back.nextFocusDownId = grid.getChildAt(0).id
        for (i in 0 until count) {
            val item = grid.getChildAt(i)
            val col = i % columns
            item.nextFocusUpId = if (i - columns >= 0) grid.getChildAt(i - columns).id else back.id
            item.nextFocusDownId = if (i + columns < count) grid.getChildAt(i + columns).id else item.id
            item.nextFocusLeftId = if (col + 1 < columns && i + 1 < count) grid.getChildAt(i + 1).id else item.id
            item.nextFocusRightId = if (col > 0) grid.getChildAt(i - 1).id else item.id
        }
    }

    private fun saveProvider(updated: ProviderEntity) {
        lifecycleScope.launch {
            val saved = updated.copy(updatedAt = System.currentTimeMillis())
            BlofyDatabase.get(applicationContext).dao().upsertProvider(saved)
            provider = saved
            status.text = "تم حفظ الإعداد"
        }
    }

    private fun refreshLibrary() {
        val active = provider ?: run { status.text = "لا توجد قائمة تشغيل نشطة"; return }
        status.text = "جاري التحديث اليدوي..."
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(active)
                }
            }.onSuccess { status.text = "اكتمل تحديث القنوات والأفلام والمسلسلات" }
                .onFailure { status.text = "تعذر التحديث • البيانات المحفوظة بقيت كما هي" }
        }
    }

    private fun chooseLanguage() {
        val labels = LANGUAGES.map { it.first }.toTypedArray()
        AlertDialog.Builder(this).setTitle("لغة التطبيق").setItems(labels) { dialog, which ->
            val (label, tag) = LANGUAGES[which]
            prefs.edit().putString(KEY_LANGUAGE, label).putString(KEY_LANGUAGE_TAG, tag).apply()
            AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
            dialog.dismiss()
        }.show()
    }

    private fun currentLanguageLabel(): String {
        val tag = prefs.getString(KEY_LANGUAGE_TAG, "ar") ?: "ar"
        return LANGUAGES.firstOrNull { it.second == tag }?.first ?: "العربية"
    }

    private fun cardBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF8737D5.toInt(), 0xFF5721A4.toInt())
        else intArrayOf(0xE91D1528.toInt(), 0xF00D0A14.toInt())
    ).apply {
        cornerRadius = dp(17).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x594E3766)
    }

    private fun isTv() = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val PREFS = "blofy_player_settings"
        const val KEY_MOTION = "motion_mode"
        private const val KEY_BUFFER = "buffer_mode"
        private const val KEY_AUDIO_OUTPUT = "audio_output"
        private const val KEY_SUBTITLE_LANGUAGE = "subtitle_language"
        private const val KEY_SUBTITLE_SIZE = "subtitle_size"
        private const val KEY_ASPECT = "aspect_mode"
        private const val KEY_AUTOPLAY_LIVE = "autoplay_live"
        private const val KEY_RESUME_PROMPT = "resume_prompt"
        private const val KEY_AUTO_NEXT = "auto_next_episode"
        private const val KEY_LANGUAGE = "app_language"
        private const val KEY_LANGUAGE_TAG = "app_language_tag"
        private const val BACKGROUND = 0xFF09070E.toInt()
        private const val MUTED = 0xFFB5A7C4.toInt()
        private const val ACCENT_SOFT = 0xFFC694FF.toInt()
        private val LANGUAGES = listOf(
            "العربية" to "ar", "English" to "en", "Français" to "fr", "Español" to "es",
            "Deutsch" to "de", "Türkçe" to "tr", "Português" to "pt", "Italiano" to "it"
        )
    }
}
