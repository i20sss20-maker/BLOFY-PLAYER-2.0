package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
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
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ParentalPinManager
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.playlist.ProviderManagerActivity

/** Remote-first grid composition transplanted from v339 SettingsActivity.buildGrid(). */
class SettingsActivity : AppCompatActivity() {
    private var provider: ProviderEntity? = null
    private lateinit var status: TextView
    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = V339Ui.BLACK
        window.navigationBarColor = V339Ui.BLACK
        lifecycleScope.launch {
            provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
            buildGrid()
        }
    }

    private fun buildGrid() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = V339Ui.screenGradient()
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), dp(22), dp(34), dp(24))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        val back = V339Ui.button(this, "↩  رجوع", false).apply {
            id = View.generateViewId()
            setOnClickListener { finish() }
        }
        header.addView(back, LinearLayout.LayoutParams(dp(150), dp(52)))
        header.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        titles.addView(V339Ui.title(this, "الإعدادات", 29f).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(dp(600), dp(38)))
        titles.addView(V339Ui.text(this, "تحكم كامل بالتشغيل والصوت والترجمة من شاشة واحدة", 12f, V339Ui.MUTED).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(dp(600), dp(26)))
        header.addView(titles, LinearLayout.LayoutParams(dp(620), dp(66)))
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(76)))

        status = V339Ui.text(this, "", 12f, V339Ui.MUTED).apply { gravity = Gravity.RIGHT }
        page.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)))

        val grid = GridLayout(this).apply {
            columnCount = if (V339Ui.isTv(this@SettingsActivity)) 4 else 2
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
        }
        val p = provider
        addGridSetting(grid, providerCycle("⚡  محرك التشغيل",
            if (p?.preferredEngine.equals("vlc", true)) "vlc" else "media3",
            arrayOf("media3", "vlc"), arrayOf("Media3", "VLC")) { selected ->
            p?.let { updateProvider(it.copy(preferredEngine = selected)) }
        })
        addGridSetting(grid, providerCycle("◉  اتصال الشبكة",
            if (p?.preferredTransport.equals("http", true)) "http" else "cronet",
            arrayOf("cronet", "http"), arrayOf("Cronet", "HTTP")) { selected ->
            p?.let { updateProvider(it.copy(preferredTransport = selected)) }
        })
        addGridSetting(grid, providerCycle("▶  صيغة البث",
            if (p?.liveFormat.equals("m3u8", true)) "m3u8" else "ts",
            arrayOf("ts", "m3u8"), arrayOf("MPEG-TS", "HLS / M3U8")) { selected ->
            p?.let { updateProvider(it.copy(liveFormat = selected)) }
        })
        addGridSetting(grid, actionCycle("↻  التخزين المؤقت", KEY_BUFFER,
            arrayOf("fast", "auto", "stable"), arrayOf("سريع", "تلقائي", "ثابت / 4K")))

        addGridSetting(grid, actionCycle("▣  حجم الصورة", KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"), arrayOf("ملاءمة", "تكبير", "ملء الشاشة")))
        addGridSetting(grid, actionCycle("♫  مخرج الصوت", KEY_AUDIO_OUTPUT,
            arrayOf("auto", "stereo"), arrayOf("تلقائي", "ستيريو 2.0")))
        addGridSetting(grid, actionCycle("CC  لغة الترجمة", KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"), arrayOf("العربية أولًا", "تلقائي", "إيقاف")))
        addGridSetting(grid, actionCycle("A  حجم الترجمة", KEY_SUBTITLE_SIZE,
            arrayOf("small", "medium", "large"), arrayOf("صغير", "متوسط", "كبير")))

        addGridSetting(grid, actionCycle("◉  معاينة المباشر", KEY_AUTOPLAY_LIVE,
            arrayOf("on", "off"), arrayOf("تلقائي", "يدوي")))
        addGridSetting(grid, actionCycle("◷  مواصلة المشاهدة", KEY_RESUME_PROMPT,
            arrayOf("on", "off"), arrayOf("اسألني", "تشغيل مباشر")))
        addGridSetting(grid, actionCycle("▶  الحلقة التالية", KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"), arrayOf("اسألني", "تلقائي", "إيقاف")))
        addGridSetting(grid, actionCycle("✦  حركة الواجهة", KEY_MOTION,
            arrayOf("smooth", "reduced"), arrayOf("سلسة", "خفيفة")))

        addGridSetting(grid, gridAction("🌐  لغة التطبيق", currentLanguageLabel()) { chooseLanguage() })
        addGridSetting(grid, gridAction("▤  تغيير قائمة التشغيل", "القوائم المحفوظة") {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        })
        addGridSetting(grid, gridAction("↻  تحديث القائمة", "القنوات والأفلام والمسلسلات") { refreshLibrary() })
        addGridSetting(grid, gridAction("🔒  الرقابة الأبوية",
            if (ParentalPinManager.hasPin(this)) "تغيير PIN" else "إنشاء PIN") { changePin() })

        addGridSetting(grid, gridAction("↔  HTTP / HTTPS",
            if (p?.allowCrossProtocolRedirects == true) "مسموح" else "مغلق") {
            p?.let { updateProvider(it.copy(allowCrossProtocolRedirects = !it.allowCrossProtocolRedirects)) }
        })
        addGridSetting(grid, gridAction("ℹ  معلومات التشغيل",
            "Media3 + VLC + 4K / HEVC") { status.text = "محركات التشغيل الحالية محفوظة كما هي" })
        addGridSetting(grid, gridAction("⟲  استعادة التلقائي", "إلغاء إعدادات الواجهة") {
            prefs.edit().clear().apply(); buildGrid()
        })
        addGridSetting(grid, gridAction("✓  حالة النظام", "جاهز") {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })

        linkGridFocus(grid, grid.columnCount, back)
        page.addView(grid, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        page.addView(V339Ui.text(this, "BLOFY PLAYER", 11f, V339Ui.MUTED).apply {
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_LTR
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)).apply { topMargin = dp(14) })

        scroll.addView(page)
        setContentView(scroll)
        if (grid.childCount > 0) grid.getChildAt(0).requestFocus()
    }

    private fun providerCycle(title: String, current: String, values: Array<String>, labels: Array<String>, onSelect: (String) -> Unit): Button {
        val button = V339Ui.button(this, "", false)
        var selected = values.indexOf(current).let { if (it < 0) 0 else it }
        fun refresh() { button.text = "$title\n${labels[selected]}" }
        refresh()
        button.setOnClickListener {
            selected = (selected + 1) % values.size
            refresh()
            onSelect(values[selected])
        }
        return button
    }

    private fun actionCycle(title: String, key: String, values: Array<String>, labels: Array<String>): Button {
        val button = V339Ui.button(this, "", false)
        fun index(): Int = values.indexOf(prefs.getString(key, values[0])).let { if (it < 0) 0 else it }
        fun refresh() { button.text = "$title\n${labels[index()]}" }
        refresh()
        button.setOnClickListener {
            val next = (index() + 1) % values.size
            prefs.edit().putString(key, values[next]).apply()
            refresh()
        }
        return button
    }

    private fun gridAction(title: String, subtitle: String, action: () -> Unit): Button =
        V339Ui.button(this, "$title\n$subtitle", false).apply { setOnClickListener { action() } }

    private fun addGridSetting(grid: GridLayout, button: Button) {
        button.id = View.generateViewId()
        grid.addView(button, GridLayout.LayoutParams().apply {
            columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            width = 0
            height = dp(88)
            setMargins(dp(5), dp(5), dp(5), dp(5))
        })
    }

    private fun linkGridFocus(grid: GridLayout, columns: Int, back: Button) {
        val count = grid.childCount
        if (count == 0) return
        back.nextFocusDownId = grid.getChildAt(0).id
        for (index in 0 until count) {
            val item = grid.getChildAt(index)
            val column = index % columns
            val up = index - columns
            val down = index + columns
            val left = index + 1
            val right = index - 1
            item.nextFocusUpId = if (up >= 0) grid.getChildAt(up).id else back.id
            item.nextFocusDownId = if (down < count) grid.getChildAt(down).id else item.id
            item.nextFocusLeftId = if (column + 1 < columns && left < count) grid.getChildAt(left).id else item.id
            item.nextFocusRightId = if (column > 0) grid.getChildAt(right).id else item.id
        }
    }

    private fun updateProvider(updated: ProviderEntity) {
        lifecycleScope.launch {
            val saved = updated.copy(updatedAt = System.currentTimeMillis())
            BlofyDatabase.get(applicationContext).dao().upsertProvider(saved)
            provider = saved
            status.text = "تم حفظ الإعداد"
        }
    }

    private fun refreshLibrary() {
        val p = provider ?: run { status.text = "لا توجد قائمة تشغيل نشطة"; return }
        status.text = "جاري تحديث المحتوى..."
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(p)
                }
            }.onSuccess { status.text = "اكتمل تحديث المحتوى" }
                .onFailure { status.text = "تعذر تحديث المحتوى" }
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

    private fun changePin() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "4 إلى 6 أرقام"
            isSingleLine = true
        }
        val show = {
            AlertDialog.Builder(this).setTitle("PIN جديد").setView(input)
                .setPositiveButton("حفظ") { _, _ ->
                    status.text = if (ParentalPinManager.setPin(this, input.text.toString())) "تم حفظ PIN" else "أدخل 4 إلى 6 أرقام"
                }.setNegativeButton("إلغاء", null).show()
        }
        if (ParentalPinManager.hasPin(this)) ParentalGate.requirePin(this) { show() } else show()
    }

    private fun dp(v: Int) = V339Ui.dp(this, v)

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
        private val LANGUAGES = listOf(
            "العربية" to "ar", "English" to "en", "Français" to "fr", "Español" to "es",
            "Deutsch" to "de", "Türkçe" to "tr", "Português" to "pt", "Italiano" to "it"
        )
    }
}
