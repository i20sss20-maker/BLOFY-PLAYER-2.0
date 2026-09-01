package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.GridLayout
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
import tv.blofy.player.R
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.playlist.ProviderManagerActivity

class SettingsActivity : AppCompatActivity() {
    private var provider: ProviderEntity? = null
    private lateinit var status: TextView
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
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(38), dp(28), dp(38), dp(30))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER_VERTICAL
        }
        val back = actionButton("↩  رجوع", false) { finish() }
        header.addView(back, LinearLayout.LayoutParams(dp(155), dp(56)))
        header.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        val titleBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.RIGHT }
        titleBox.addView(TextView(this@SettingsActivity).apply {
            text = "الإعدادات"
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        titleBox.addView(TextView(this@SettingsActivity).apply {
            text = "تحكم واضح وسريع بالمشاهدة والصوت والترجمة والمحتوى"
            textSize = 13f
            setTextColor(SOFT)
            gravity = Gravity.RIGHT
        })
        header.addView(titleBox, LinearLayout.LayoutParams(dp(680), dp(68)))
        page.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(78)))

        status = TextView(this).apply {
            text = "المحركات ومسارات التشغيل محمية ولا تتغير من هذه الصفحة"
            textSize = 13f
            setTextColor(ACCENT)
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(14))
        }
        page.addView(status)

        val grid = GridLayout(this).apply {
            columnCount = 4
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
        }

        addSetting(grid, cycleButton("◉  معاينة البث", KEY_AUTOPLAY_LIVE,
            arrayOf("on", "off"), arrayOf("تلقائي", "يدوي")))
        addSetting(grid, cycleButton("⚡  سرعة التنقل", KEY_FAST_ZAP,
            arrayOf("on", "off"), arrayOf("سريع", "عادي")))
        addSetting(grid, cycleButton("◷  الاستئناف", KEY_RESUME_PROMPT,
            arrayOf("ask", "direct"), arrayOf("اسألني", "مباشر")))
        addSetting(grid, cycleButton("▶  الحلقة التالية", KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"), arrayOf("اسألني", "تلقائي", "إيقاف")))

        addSetting(grid, cycleButton("▣  حجم الصورة", KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"), arrayOf("ملاءمة", "تكبير", "ملء")))
        addSetting(grid, cycleButton("♫  الصوت", KEY_AUDIO_OUTPUT,
            arrayOf("auto", "stereo"), arrayOf("تلقائي", "ستيريو 2.0")))
        addSetting(grid, cycleButton("CC  الترجمة", KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"), arrayOf("العربية أولًا", "تلقائي", "إيقاف")))
        addSetting(grid, cycleButton("A  حجم الترجمة", KEY_SUBTITLE_SIZE,
            arrayOf("small", "medium", "large"), arrayOf("صغير", "متوسط", "كبير")))

        addSetting(grid, cycleButton("↻  التخزين المؤقت", KEY_BUFFER,
            arrayOf("fast", "auto", "stable"), arrayOf("سريع", "تلقائي", "ثابت / 4K")))
        addSetting(grid, cycleButton("✦  حركة الواجهة", KEY_MOTION,
            arrayOf("smooth", "reduced"), arrayOf("سلسة", "خفيفة")))
        addSetting(grid, simpleButton("🌐  لغة التطبيق", currentLanguageLabel()) { chooseLanguage() })
        addSetting(grid, simpleButton("▤  قوائم التشغيل", "إدارة وتبديل السيرفر") {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        })

        addSetting(grid, simpleButton("↻  تحديث المحتوى", "يدوي فقط") { refreshLibrary() })
        addSetting(grid, simpleButton("✓  حالة النظام", "فحص التطبيق") {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })
        addSetting(grid, simpleButton("⟲  إعادة الإعدادات", "استعادة الافتراضي") {
            prefs.edit().clear().apply(); buildPage()
        })
        addSetting(grid, simpleButton("ℹ  BLOFY PLAYER", "Media3 + FFmpeg") {
            status.text = "التشغيل الداخلي فقط • لا يوجد مشغل خارجي • المحركات الحالية محفوظة"
        })

        linkGridFocus(grid, back)
        page.addView(grid)
        page.addView(TextView(this).apply {
            text = "BLOFY PLAYER 2.0"
            textSize = 11f
            setTextColor(SOFT)
            gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, 0)
        })
        scroll.addView(page)
        setContentView(scroll)
        if (grid.childCount > 0) grid.getChildAt(0).requestFocus()
    }

    private fun cycleButton(title: String, key: String, values: Array<String>, labels: Array<String>): Button {
        val button = actionButton("", false) {}
        fun index() = values.indexOf(prefs.getString(key, values[0])).let { if (it < 0) 0 else it }
        fun refresh() { button.text = "$title\n${labels[index()]}" }
        refresh()
        button.setOnClickListener {
            val next = (index() + 1) % values.size
            prefs.edit().putString(key, values[next]).apply()
            refresh()
        }
        return button
    }

    private fun simpleButton(title: String, subtitle: String, action: () -> Unit): Button =
        actionButton("$title\n$subtitle", false, action)

    private fun actionButton(label: String, primary: Boolean, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        isFocusable = true
        isFocusableInTouchMode = true
        background = tileBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = tileBackground(focused, primary)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.028f else 1f).scaleY(if (focused) 1.028f else 1f).translationZ(if (focused) 12f else 1f).setDuration(90).start()
        }
        setOnClickListener { action() }
    }

    private fun addSetting(grid: GridLayout, button: Button) {
        button.id = View.generateViewId()
        grid.addView(button, GridLayout.LayoutParams().apply {
            columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            width = 0
            height = dp(94)
            setMargins(dp(6), dp(6), dp(6), dp(6))
        })
    }

    private fun linkGridFocus(grid: GridLayout, back: Button) {
        val columns = grid.columnCount
        val count = grid.childCount
        if (count == 0) return
        back.nextFocusDownId = grid.getChildAt(0).id
        for (index in 0 until count) {
            val item = grid.getChildAt(index)
            val col = index % columns
            val up = index - columns
            val down = index + columns
            item.nextFocusUpId = if (up >= 0) grid.getChildAt(up).id else back.id
            item.nextFocusDownId = if (down < count) grid.getChildAt(down).id else item.id
            item.nextFocusLeftId = if (col + 1 < columns && index + 1 < count) grid.getChildAt(index + 1).id else item.id
            item.nextFocusRightId = if (col > 0) grid.getChildAt(index - 1).id else item.id
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

    private fun refreshLibrary() {
        val p = provider ?: run { status.text = "لا توجد قائمة تشغيل نشطة"; return }
        status.text = "جاري تحديث القنوات والأفلام والمسلسلات..."
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(p)
                }
            }.onSuccess { status.text = "اكتمل التحديث • سيتم استخدام النسخة المحلية حتى التحديث القادم" }
                .onFailure { status.text = "تعذر التحديث • المحتوى المحلي لم يتغير" }
        }
    }

    private fun tileBackground(focused: Boolean, primary: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        when {
            focused -> intArrayOf(0xFF6E2AB3.toInt(), 0xFF2A153B.toInt())
            primary -> intArrayOf(0xFF4B1B82.toInt(), 0xFF24122F.toInt())
            else -> intArrayOf(0xED191321.toInt(), 0xF00C0A12.toInt())
        }
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFE3B8FF.toInt() else 0x66533B68)
    }

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
        private const val KEY_FAST_ZAP = "fast_channel_zap"
        private const val KEY_RESUME_PROMPT = "resume_prompt"
        private const val KEY_AUTO_NEXT = "auto_next_episode"
        private const val KEY_LANGUAGE = "app_language"
        private const val KEY_LANGUAGE_TAG = "app_language_tag"
        private val SOFT = Color.rgb(195, 175, 220)
        private val ACCENT = Color.rgb(202, 151, 255)
        private val LANGUAGES = listOf(
            "العربية" to "ar", "English" to "en", "Français" to "fr", "Español" to "es",
            "Deutsch" to "de", "Türkçe" to "tr", "Português" to "pt", "Italiano" to "it"
        )
    }
}
