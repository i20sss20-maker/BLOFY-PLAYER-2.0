package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
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
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.ui.playlist.ProviderManagerActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SettingsActivity : AppCompatActivity() {
    private var provider: ProviderEntity? = null
    private lateinit var status: TextView
    private lateinit var grid: GridLayout
    private lateinit var storageCard: Button
    private lateinit var refreshCard: Button
    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Draw the settings screen immediately. Opening Room can take a few seconds on some TV
        // boxes after a large catalog import, and it must never leave the user on a blank screen.
        buildPage()
        lifecycleScope.launch {
            provider = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
            }
            if (!isFinishing) updateSyncStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) updateSyncStatus()
    }

    private fun buildPage() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(46), dp(30), dp(46), dp(34))
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        titleBox.addView(TextView(this).apply {
            text = "الإعدادات"
            BlofyTvDesign.applyTitle(this)
            gravity = Gravity.RIGHT
        })
        titleBox.addView(TextView(this).apply {
            text = "خيارات واضحة للمشاهدة والقوائم والتخزين"
            BlofyTvDesign.applyCaption(this)
            textSize = 14f
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, 0)
        })
        header.addView(titleBox, LinearLayout.LayoutParams(0, dp(80), 1f))
        val back = settingButton("↩  رجوع", true) { finish() }.apply { id = View.generateViewId() }
        header.addView(back, LinearLayout.LayoutParams(dp(156), dp(54)))
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88)))

        status = TextView(this).apply {
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(10))
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        updateSyncStatus()
        page.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { bottomMargin = dp(18) })

        grid = GridLayout(this).apply {
            columnCount = if (isTv()) 3 else 2
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
            clipChildren = false
            clipToPadding = false
        }

        addCard(cycleSetting("▣  حجم الصورة", KEY_ASPECT, arrayOf("fit", "zoom", "fill"), arrayOf("ملاءمة", "تكبير", "ملء الشاشة")))
        addCard(cycleSetting("♫  مخرج الصوت", KEY_AUDIO_OUTPUT, arrayOf("auto", "stereo"), arrayOf("تلقائي", "ستيريو 2.0")))
        addCard(cycleSetting("CC  لغة الترجمة", KEY_SUBTITLE_LANGUAGE, arrayOf("ar", "auto", "off"), arrayOf("العربية أولًا", "تلقائي", "إيقاف")))
        addCard(cycleSetting("A  حجم الترجمة", KEY_SUBTITLE_SIZE, arrayOf("small", "medium", "large"), arrayOf("صغير", "متوسط", "كبير")))
        addCard(cycleSetting("◉  معاينة البث", KEY_AUTOPLAY_LIVE, arrayOf("on", "off"), arrayOf("تلقائي", "يدوي")))
        addCard(cycleSetting("◷  مواصلة المشاهدة", KEY_RESUME_PROMPT, arrayOf("on", "off"), arrayOf("اسألني", "تشغيل مباشر")))
        addCard(cycleSetting("▶  الحلقة التالية", KEY_AUTO_NEXT, arrayOf("ask", "on", "off"), arrayOf("اسألني", "تلقائي", "إيقاف")))
        addCard(cycleSetting("✦  حركة الواجهة", KEY_MOTION, arrayOf("smooth", "reduced"), arrayOf("سلسة", "خفيفة")))
        addCard(actionCard("🌐  لغة التطبيق", currentLanguageLabel()) { chooseLanguage() })
        addCard(actionCard("▤  قوائم التشغيل", "إدارة القوائم المحفوظة") { startActivity(Intent(this, ProviderManagerActivity::class.java)) })
        refreshCard = actionCard("↻  تحديث المحتوى", syncSubtitle()) { refreshLibrary() }
        addCard(refreshCard)
        storageCard = actionCard("💾  التخزين المحلي", "جارٍ حساب المساحة...") { showStorageManager() }
        addCard(storageCard)
        addCard(actionCard("✓  حالة النظام", "معلومات النسخة والجهاز") { startActivity(Intent(this, SystemStatusActivity::class.java)) })
        addCard(actionCard("⟲  استعادة الإعدادات", "العودة للوضع الافتراضي") { restoreDefaults() })

        linkFocus(back)
        page.addView(grid, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        page.addView(TextView(this).apply {
            text = "BLOFY PLAYER 2.0"
            BlofyTvDesign.applyCaption(this)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(16) })
        scroll.addView(page)
        setContentView(scroll)
        updateStorageCard()
        grid.post { if (grid.childCount > 0) grid.getChildAt(0).requestFocus() }
    }

    private fun cycleSetting(title: String, key: String, values: Array<String>, labels: Array<String>): Button {
        fun currentIndex() = values.indexOf(prefs.getString(key, values[0])).let { if (it < 0) 0 else it }
        lateinit var button: Button
        button = settingButton("", false) {
            val next = (currentIndex() + 1) % values.size
            prefs.edit().putString(key, values[next]).apply()
            button.text = "$title\n${labels[next]}"
            status.text = "✓  تم حفظ الإعداد"
        }
        button.text = "$title\n${labels[currentIndex()]}"
        return button
    }

    private fun actionCard(title: String, subtitle: String, action: () -> Unit): Button = settingButton("$title\n$subtitle", false, action)

    private fun settingButton(label: String, compact: Boolean, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = if (compact) 15f else 14.5f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        includeFontPadding = false
        letterSpacing = 0.005f
        BlofyTvDesign.installTvFocus(this, dp(if (compact) 18 else 21).toFloat(), if (compact) 1.02f else 1.018f, false)
        setOnClickListener { action() }
    }

    private fun addCard(button: Button) {
        button.id = View.generateViewId()
        grid.addView(button, GridLayout.LayoutParams().apply {
            columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            width = 0
            height = dp(100)
            setMargins(dp(8), dp(8), dp(8), dp(8))
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

    private fun restoreDefaults() {
        prefs.edit().clear().apply()
        status.text = "✓  تمت استعادة إعدادات المشاهدة الافتراضية"
        buildPage()
    }

    private fun refreshLibrary() {
        val active = provider ?: run { status.text = "لا توجد قائمة تشغيل نشطة"; return }
        status.text = "جاري فتح التحديث الآمن... البيانات الحالية ستبقى متاحة حتى يكتمل"
        startActivity(Intent(this, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, active.id)
            putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, true)
        })
    }

    private fun updateSyncStatus() {
        val active = provider
        status.text = if (active == null) {
            "الإعدادات جاهزة • جاري قراءة حالة المكتبة"
        } else {
            val last = CatalogSyncState.lastSyncedAt(applicationContext, active.id)
            if (last > 0L) "✓  البيانات محفوظة محليًا • آخر تحديث ${formatSyncTime(last)}"
            else "✓  البيانات محفوظة محليًا وتفتح بدون إعادة تحميل"
        }
        if (::refreshCard.isInitialized) refreshCard.text = "↻  تحديث المحتوى\n${syncSubtitle()}"
    }

    private fun syncSubtitle(): String {
        val active = provider ?: return "يدوي عند الحاجة فقط"
        val last = CatalogSyncState.lastSyncedAt(applicationContext, active.id)
        return if (last > 0L) "آخر تحديث ${formatSyncTime(last)}" else "يدوي عند الحاجة فقط"
    }

    private fun formatSyncTime(value: Long): String {
        val sameDay = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date(value)) == SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())
        return SimpleDateFormat(if (sameDay) "HH:mm" else "dd/MM HH:mm", Locale("ar")).format(Date(value))
    }

    private fun updateStorageCard() {
        if (!::storageCard.isInitialized) return
        lifecycleScope.launch {
            val stats = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext) }
            if (!isFinishing && ::storageCard.isInitialized) {
                storageCard.text = "💾  التخزين المحلي\n${LocalStorageManager.format(applicationContext, stats.totalBytes)} مستخدم • إدارة وتنظيف"
            }
        }
    }

    private fun showStorageManager() {
        lifecycleScope.launch {
            val stats = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext) }
            val database = LocalStorageManager.format(applicationContext, stats.databaseBytes)
            val temporary = LocalStorageManager.format(applicationContext, stats.temporaryBytes)
            val total = LocalStorageManager.format(applicationContext, stats.totalBytes)
            AlertDialog.Builder(this@SettingsActivity)
                .setTitle("التخزين المحلي")
                .setMessage(
                    "المستخدم حاليًا: $total\n\n" +
                        "• الكتالوج والحلقات والبيانات المحفوظة: $database\n" +
                        "• الصور والملفات المؤقتة: $temporary\n\n" +
                        "التنظيف الآمن لا يحذف التفعيل أو القوائم أو المفضلة أو الاستئناف."
                )
                .setPositiveButton("تنظيف آمن") { _, _ -> confirmSafeCleanup() }
                .setNegativeButton("إغلاق", null)
                .show()
        }
    }

    private fun confirmSafeCleanup() {
        AlertDialog.Builder(this)
            .setTitle("تنظيف التخزين")
            .setMessage("سيتم حذف الصور والملفات المؤقتة وبيانات دليل البرامج المؤقتة فقط. بيانات العميل وقوائم التشغيل ستبقى محفوظة.")
            .setPositiveButton("تنظيف") { _, _ -> cleanSafeStorage() }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun cleanSafeStorage() {
        status.text = "جاري تنظيف التخزين المحلي..."
        lifecycleScope.launch {
            val before = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext).totalBytes }
            runCatching { withContext(Dispatchers.IO) { LocalStorageManager.cleanSafely(applicationContext) } }
                .onSuccess {
                    val after = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext).totalBytes }
                    val freed = (before - after).coerceAtLeast(0L)
                    status.text = "✓  تم تنظيف ${LocalStorageManager.format(applicationContext, freed)} بدون حذف بياناتك"
                    updateStorageCard()
                }
                .onFailure {
                    status.text = "تعذر تنظيف بعض الملفات — بياناتك لم تتأثر"
                    updateStorageCard()
                }
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

    private fun isTv() = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val PREFS = "blofy_player_settings"
        const val KEY_MOTION = "motion_mode"
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
