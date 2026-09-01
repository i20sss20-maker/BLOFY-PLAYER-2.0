package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
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
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
        }

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), 0, dp(24), 0)
        }
        content.addView(TextView(this).apply {
            text = getString(R.string.settings_title)
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        status = TextView(this).apply {
            text = "إعدادات أساسية فقط"
            textSize = 13f
            setTextColor(SOFT)
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, dp(14))
        }
        content.addView(status)
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        val sectionRail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setPadding(dp(10), dp(12), dp(10), dp(12))
            background = panelBackground()
        }
        listOf(
            SECTION_PLAYBACK to "التشغيل",
            SECTION_MEDIA to "الصوت والترجمة",
            SECTION_LANGUAGE to "اللغة",
            SECTION_LIBRARY to "المحتوى"
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
            setPadding(0, dp(8), 0, dp(22))
        }

        when (currentSection) {
            SECTION_PLAYBACK -> {
                box.addView(sectionTitle("التشغيل"))
                box.addView(sectionHint("خيارات المشاهدة اليومية فقط."))
                box.addView(toggleRow("تشغيل معاينة القناة تلقائيًا", "preview_auto", true))
                box.addView(toggleRow("التنقل السريع بين القنوات", "fast_channel_zap", true))
                box.addView(toggleRow("استئناف الأفلام والحلقات", "resume_enabled", true))
            }
            SECTION_MEDIA -> {
                box.addView(sectionTitle("الصوت والترجمة"))
                box.addView(sectionHint("اختيار المسار نفسه يتم من شاشة التشغيل عند توفره."))
                box.addView(toggleRow("تذكر آخر مسار صوت", "remember_audio", true))
                box.addView(toggleRow("تذكر آخر ترجمة", "remember_subtitles", true))
                box.addView(choiceRow("حجم الترجمة", "subtitle_size", listOf("صغير", "متوسط", "كبير"), prefs.getString("subtitle_size", "متوسط") ?: "متوسط"))
            }
            SECTION_LANGUAGE -> {
                box.addView(sectionTitle("اللغة"))
                box.addView(sectionHint("اختر لغة واجهة التطبيق."))
                box.addView(languageRow())
            }
            SECTION_LIBRARY -> {
                box.addView(sectionTitle("المحتوى"))
                box.addView(sectionHint("تحديث الباقة أو تغيير قائمة التشغيل فقط."))
                box.addView(actionRow("تحديث القنوات والأفلام والمسلسلات") { refreshLibrary() })
                box.addView(actionRow("إدارة قوائم التشغيل") { startActivity(Intent(this, ProviderManagerActivity::class.java)) })
            }
        }

        scroll.addView(box)
        content.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        box.post { if (box.childCount > 2) box.getChildAt(2).requestFocus() }
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

    private fun sectionTitle(value: String) = TextView(this).apply {
        text = value
        textSize = 27f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.RIGHT
    }

    private fun sectionHint(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(SOFT)
        gravity = Gravity.RIGHT
        setPadding(0, dp(6), 0, dp(18))
    }

    private fun actionRow(label: String, action: () -> Unit) = actionButton(label, action)

    private fun toggleRow(label: String, key: String, default: Boolean): Button =
        actionButton("$label: ${if (prefs.getBoolean(key, default)) getString(R.string.state_on) else getString(R.string.state_off)}") {
            prefs.edit().putBoolean(key, !prefs.getBoolean(key, default)).apply()
            renderSection()
        }

    private fun choiceRow(label: String, key: String, values: List<String>, current: String): Button =
        actionButton("$label: $current") {
            AlertDialog.Builder(this).setTitle(label).setItems(values.toTypedArray()) { _, which ->
                prefs.edit().putString(key, values[which]).apply()
                renderSection()
            }.show()
        }

    private fun navButton(label: String, action: () -> Unit) = actionButton(label, action)

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        isFocusable = true
        setTextColor(Color.WHITE)
        background = itemBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = itemBackground(focused)
            view.animate().scaleX(if (focused) 1.018f else 1f).scaleY(if (focused) 1.018f else 1f).setDuration(70).start()
        }
        setOnClickListener { action() }
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = dp(22).toFloat()
        setColor(0xE4141020.toInt())
        setStroke(dp(1), 0x554A355F)
    }

    private fun itemBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(if (focused) PURPLE else 0xC51B1528.toInt())
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x554A355F)
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
            }.onSuccess {
                status.text = "اكتمل تحديث المحتوى"
            }.onFailure {
                status.text = "تعذر تحديث المحتوى"
            }
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val SECTION_PLAYBACK = "playback"
        private const val SECTION_MEDIA = "media"
        private const val SECTION_LANGUAGE = "language"
        private const val SECTION_LIBRARY = "library"
        private val PURPLE = Color.rgb(126, 44, 255)
        private val SOFT = Color.rgb(195, 175, 220)
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
