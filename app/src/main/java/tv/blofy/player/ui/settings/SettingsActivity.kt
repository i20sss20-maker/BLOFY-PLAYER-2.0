package tv.blofy.player.ui.settings

import tv.blofy.player.ui.common.CinemaStyle

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
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.ui.login.LoginActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SettingsActivity : AppCompatActivity() {
    private var provider: ProviderEntity? = null
    private lateinit var status: TextView
    private lateinit var grid: GridLayout
    private val cardRows = mutableListOf<List<View>>()
    private val sections = mutableListOf<GridLayout>()
    private lateinit var storageCard: SettingCard
    private lateinit var refreshCard: SettingCard
    private val prefs by lazy { getSharedPreferences(RuntimeSettings.PREFS, MODE_PRIVATE) }
    private val isRtl: Boolean get() = resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
    private val uiDirection: Int get() = if (isRtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        cardRows.clear()
        sections.clear()
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = uiDirection
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            setPadding(dp(if (isTv()) 36 else 18), dp(22), dp(if (isTv()) 36 else 18), dp(24))
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = uiDirection
        }
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            layoutDirection = uiDirection
        }
        titleBox.addView(TextView(this).apply {
            text = getString(R.string.settings_title)
            BlofyTvDesign.applyTitle(this)
            textSize = 26f
            gravity = Gravity.START
        })
        titleBox.addView(TextView(this).apply {
            text = getString(R.string.settings_subtitle)
            BlofyTvDesign.applyCaption(this)
            textSize = 12f
            gravity = Gravity.START
            setPadding(0, dp(6), 0, 0)
        })
        header.addView(titleBox, LinearLayout.LayoutParams(0, dp(56), 1f))
        val back = settingButton(getString(R.string.back), true) { finish() }.apply { id = View.generateViewId() }
        header.addView(back, LinearLayout.LayoutParams(dp(98), dp(48)))
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)))

        status = TextView(this).apply {
            textSize = 12f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(CinemaStyle.Muted)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(14), 0, dp(14), 0)
            background = CinemaStyle.surface(this@SettingsActivity)
        }
        updateSyncStatus()
        page.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(32)).apply { bottomMargin = dp(12) })

        addSection(page, copy("الصورة والصوت", "Picture and sound"))
        addCard(cycleSetting(getString(R.string.setting_aspect), RuntimeSettings.KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"),
            arrayOf(getString(R.string.setting_aspect_fit), getString(R.string.setting_aspect_zoom), getString(R.string.setting_aspect_fill))))
        addCard(cycleSetting(getString(R.string.setting_audio_output), RuntimeSettings.KEY_AUDIO_OUTPUT,
            arrayOf("auto", "stereo"),
            arrayOf(getString(R.string.setting_audio_auto), getString(R.string.setting_audio_stereo))))
        addCard(actionCard(copy("جودة الصور والأداء", "Artwork and performance"), copy("وضوح البوسترات وخفة الواجهة", "Poster quality and a lighter interface")) {
            startActivity(Intent(this, CommercialSettingsActivity::class.java))
        })
        addSection(page, getString(R.string.settings_subtitles))
        addCard(cycleSetting(getString(R.string.setting_subtitle_language), RuntimeSettings.KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"),
            arrayOf(getString(R.string.setting_subtitle_ar_first), getString(R.string.setting_auto), getString(R.string.setting_off))))
        addCard(cycleSetting(getString(R.string.setting_subtitle_size), RuntimeSettings.KEY_SUBTITLE_SIZE,
            arrayOf("small", "medium", "large"),
            arrayOf(getString(R.string.setting_small), getString(R.string.setting_medium), getString(R.string.setting_large))))
        addSection(page, copy("تجربة المشاهدة", "Watching preferences"))
        addCard(cycleSetting(getString(R.string.setting_live_preview), RuntimeSettings.KEY_AUTOPLAY_LIVE,
            arrayOf("on", "off"),
            arrayOf(getString(R.string.setting_auto), getString(R.string.setting_manual))))
        addCard(cycleSetting(getString(R.string.setting_resume), RuntimeSettings.KEY_RESUME_PROMPT,
            arrayOf("on", "off"),
            arrayOf(getString(R.string.setting_ask_me), getString(R.string.setting_play_directly))))
        addCard(cycleSetting(getString(R.string.setting_next_episode), RuntimeSettings.KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"),
            arrayOf(getString(R.string.setting_ask_me), getString(R.string.setting_auto), getString(R.string.setting_off))))
        addSection(page, copy("المظهر واللغة", "Appearance and language"))
        addCard(cycleSetting(getString(R.string.setting_motion), RuntimeSettings.KEY_MOTION,
            arrayOf("smooth", "reduced"),
            arrayOf(getString(R.string.setting_smooth), getString(R.string.setting_reduced))))
        addCard(actionCard(getString(R.string.setting_app_language), currentLanguageLabel()) { chooseLanguage() })
        addSection(page, copy("المكتبة والحساب", "Library and account"))
        addCard(actionCard(copy("باقتي", "My plan"), copy("مدة التفعيل والأجهزة المسموحة", "Activation period and allowed devices")) {
            startActivity(Intent(this, tv.blofy.player.ui.subscription.SubscriptionActivity::class.java))
        }.apply { tag = "blofy_subscription_entry" })
        addCard(actionCard(copy("حالة الاشتراك", "Subscription status"), copy("صلاحية المحتوى والاتصالات الحالية", "Content validity and active connections")) {
            startActivity(Intent(this, tv.blofy.player.ui.subscription.ConnectionStatusActivity::class.java))
        })
        addCard(actionCard(getString(R.string.setting_playlists), getString(R.string.setting_playlists_subtitle)) {
            startActivity(Intent(this, LoginActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            })
        })
        refreshCard = actionCard(getString(R.string.setting_refresh_content), syncSubtitle()) { refreshLibrary() }
        addCard(refreshCard)
        addSection(page, copy("التطبيق", "App"))
        addCard(actionCard(getString(R.string.update_check), getString(R.string.update_check_hint)) {
            tv.blofy.player.core.update.AppUpdatePrompt.check(this, force = true)
        })
        storageCard = actionCard(getString(R.string.setting_storage_local), getString(R.string.setting_storage_calculating)) { showStorageManager() }
        addCard(storageCard)
        addCard(actionCard(copy("حول BLOFY", "About BLOFY"), copy("الإصدار والمكتبة والمساحة", "Version, library and storage")) {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })
        addCard(actionCard(getString(R.string.setting_restore), getString(R.string.setting_restore_subtitle)) { restoreDefaults() })

        linkFocus(back)
        page.addView(TextView(this).apply {
            text = "BLOFY PLAYER 2.0"
            BlofyTvDesign.applyCaption(this)
            letterSpacing = .08f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(16) })
        scroll.addView(page)
        setContentView(scroll)
        updateStorageCard()
        scroll.post { sections.firstOrNull()?.getChildAt(0)?.requestFocus() }
    }

    private fun cycleSetting(title: String, key: String, values: Array<String>, labels: Array<String>): SettingCard {
        fun currentIndex() = values.indexOf(prefs.getString(key, values[0])).let { if (it < 0) 0 else it }
        return SettingCard(this).apply {
            tag = "setting_$key"
            bind(title, labels[currentIndex()], preferenceHint(key), cycle = true)
            setOnClickListener {
                val next = (currentIndex() + 1) % values.size
                prefs.edit().putString(key, values[next]).apply()
                bind(title, labels[next], preferenceHint(key), cycle = true)
                status.text = getString(R.string.setting_saved)
            }
        }
    }

    private fun actionCard(title: String, subtitle: String, action: () -> Unit): SettingCard =
        SettingCard(this).apply {
            bind(title, subtitle)
            setOnClickListener { action() }
        }

    private fun settingButton(label: String, compact: Boolean, action: () -> Unit): Button = Button(this).apply {
        text = label
        CinemaStyle.styleButton(this)
        setOnClickListener { action() }
    }

    private fun addCard(card: SettingCard) {
        card.id = View.generateViewId()
        val position = grid.childCount
        grid.addView(card, GridLayout.LayoutParams().apply {
            rowSpec = GridLayout.spec(position / grid.columnCount, GridLayout.FILL)
            columnSpec = GridLayout.spec(position % grid.columnCount, 1f)
            width = 0
            height = ViewGroup.LayoutParams.WRAP_CONTENT
            setMargins(dp(6), dp(6), dp(6), dp(6))
        })
    }

    private fun linkFocus(back: Button) {
        sections.forEach { section ->
            cardRows.addAll((0 until section.childCount).map(section::getChildAt).chunked(section.columnCount))
        }
        back.nextFocusDownId = cardRows.firstOrNull()?.firstOrNull()?.id ?: back.id
        cardRows.forEachIndexed { rowIndex, row ->
            row.forEachIndexed { col, item ->
                val previous = cardRows.getOrNull(rowIndex - 1)
                val next = cardRows.getOrNull(rowIndex + 1)
                item.nextFocusUpId = previous?.get(col.coerceAtMost(previous.lastIndex))?.id ?: back.id
                item.nextFocusDownId = next?.get(col.coerceAtMost(next.lastIndex))?.id ?: item.id
                val forward = row.getOrNull(col + 1)?.id ?: item.id
                val backward = row.getOrNull(col - 1)?.id ?: item.id
                item.nextFocusLeftId = if (isRtl) forward else backward
                item.nextFocusRightId = if (isRtl) backward else forward
            }
        }
    }

    private fun addSection(page: LinearLayout, title: String) {
        page.addView(TextView(this).apply {
            text = title
            textSize = 17f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(CinemaStyle.White)
            gravity = Gravity.START
            setPadding(dp(5), dp(18), dp(5), dp(8))
        })
        grid = GridLayout(this).apply {
            val available = resources.configuration.screenWidthDp - if (isTv()) 72 else 36
            val preferredWidth = (250 * resources.configuration.fontScale.coerceAtLeast(1f)).toInt()
            columnCount = (available / preferredWidth).coerceIn(1, if (isTv()) 3 else 2)
            layoutDirection = uiDirection
            alignmentMode = GridLayout.ALIGN_BOUNDS
            clipChildren = false
            clipToPadding = false
        }
        sections.add(grid)
        page.addView(grid, LinearLayout.LayoutParams(-1, -2))
    }

    private fun preferenceHint(key: String): String = when (key) {
        RuntimeSettings.KEY_ASPECT -> copy("طريقة عرض الفيديو على الشاشة", "How video fits your screen")
        RuntimeSettings.KEY_AUDIO_OUTPUT -> copy("اختر الصوت المناسب لسماعاتك", "Match sound to your speakers")
        RuntimeSettings.KEY_SUBTITLE_LANGUAGE -> copy("تُستخدم عند توفر الترجمة بالمحتوى", "Used when subtitles are available")
        RuntimeSettings.KEY_SUBTITLE_SIZE -> copy("حجم نص الترجمة أثناء المشاهدة", "Subtitle text size during playback")
        RuntimeSettings.KEY_AUTOPLAY_LIVE -> copy("تشغيل القناة عند تحديدها", "Play a channel when highlighted")
        RuntimeSettings.KEY_RESUME_PROMPT -> copy("السؤال قبل متابعة آخر نقطة", "Ask before resuming your progress")
        RuntimeSettings.KEY_AUTO_NEXT -> copy("ما يحدث عند انتهاء الحلقة", "What happens when an episode ends")
        RuntimeSettings.KEY_MOTION -> copy("حركة الانتقال بين عناصر الواجهة", "Animations as you browse")
        else -> ""
    }

    private fun copy(arabic: String, english: String) =
        if (androidx.core.os.ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "ar") arabic else english

    private fun restoreDefaults() {
        prefs.edit().clear().apply()
        status.text = getString(R.string.setting_restored)
        buildPage()
    }

    private fun refreshLibrary() {
        val active = provider ?: run {
            status.text = getString(R.string.setting_no_active_playlist)
            return
        }
        status.text = getString(R.string.setting_refresh_opening)
        startActivity(Intent(this, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, active.id)
            putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, true)
        })
    }

    private fun updateSyncStatus() {
        val active = provider
        status.text = if (active == null) {
            getString(R.string.setting_status_reading)
        } else {
            val last = CatalogSyncState.lastSyncedAt(applicationContext, active.id)
            if (last > 0L) getString(R.string.setting_status_saved_at, formatSyncTime(last))
            else getString(R.string.setting_status_saved)
        }
        if (::refreshCard.isInitialized) refreshCard.bind(getString(R.string.setting_refresh_content), syncSubtitle())
    }

    private fun syncSubtitle(): String {
        val active = provider ?: return getString(R.string.setting_manual_only)
        val last = CatalogSyncState.lastSyncedAt(applicationContext, active.id)
        return if (last > 0L) getString(R.string.setting_last_refresh, formatSyncTime(last))
        else getString(R.string.setting_manual_only)
    }

    private fun formatSyncTime(value: Long): String {
        val locale = Locale.getDefault()
        val sameDay = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date(value)) ==
            SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())
        return SimpleDateFormat(if (sameDay) "HH:mm" else "dd/MM HH:mm", locale).format(Date(value))
    }

    private fun updateStorageCard() {
        if (!::storageCard.isInitialized) return
        lifecycleScope.launch {
            val stats = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext) }
            if (!isFinishing && ::storageCard.isInitialized) {
                storageCard.bind(
                    getString(R.string.setting_storage_local),
                    getString(R.string.setting_storage_used, LocalStorageManager.format(applicationContext, stats.totalBytes))
                )
            }
        }
    }

    private fun showStorageManager() {
        lifecycleScope.launch {
            val stats = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext) }
            val database = LocalStorageManager.format(applicationContext, stats.databaseBytes)
            val artwork = LocalStorageManager.format(applicationContext, stats.artworkBytes)
            val persistent = LocalStorageManager.format(applicationContext, stats.otherPersistentBytes)
            val temporary = LocalStorageManager.format(applicationContext, stats.temporaryBytes)
            val total = LocalStorageManager.format(applicationContext, stats.totalBytes)
            AlertDialog.Builder(this@SettingsActivity)
                .setTitle(getString(R.string.storage_title))
                .setMessage(getString(R.string.storage_message_detailed, total, database, artwork, persistent, temporary))
                .setPositiveButton(getString(R.string.storage_safe_clean)) { _, _ -> confirmSafeCleanup() }
                .setNegativeButton(getString(R.string.close), null)
                .show()
        }
    }

    private fun confirmSafeCleanup() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.storage_cleanup_title))
            .setMessage(getString(R.string.storage_cleanup_message))
            .setPositiveButton(getString(R.string.clean)) { _, _ -> cleanSafeStorage() }
            .setNegativeButton(getString(R.string.cancel), null)
            .show()
    }

    private fun cleanSafeStorage() {
        status.text = getString(R.string.storage_cleaning)
        lifecycleScope.launch {
            val before = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext).totalBytes }
            runCatching { withContext(Dispatchers.IO) { LocalStorageManager.cleanSafely(applicationContext) } }
                .onSuccess {
                    val after = withContext(Dispatchers.IO) { LocalStorageManager.stats(applicationContext).totalBytes }
                    val freed = (before - after).coerceAtLeast(0L)
                    status.text = getString(R.string.storage_cleaned, LocalStorageManager.format(applicationContext, freed))
                    updateStorageCard()
                }
                .onFailure {
                    status.text = getString(R.string.storage_clean_failed)
                    updateStorageCard()
                }
        }
    }

    private fun chooseLanguage() {
        val labels = LANGUAGES.map { it.first }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.language_app))
            .setItems(labels) { dialog, which ->
                val (label, tag) = LANGUAGES[which]
                prefs.edit().putString(KEY_LANGUAGE, label).putString(KEY_LANGUAGE_TAG, tag).apply()
                AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
                dialog.dismiss()
            }
            .show()
    }

    private fun currentLanguageLabel(): String {
        val selected = AppCompatDelegate.getApplicationLocales().toLanguageTags()
            .substringBefore(',')
            .ifBlank { prefs.getString(KEY_LANGUAGE_TAG, "en") ?: "en" }
        return LANGUAGES.firstOrNull { it.second.equals(selected, ignoreCase = true) }?.first ?: "English"
    }

    private fun isTv() = DeviceClass.isTv(this)
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val KEY_LANGUAGE = "app_language"
        private const val KEY_LANGUAGE_TAG = "app_language_tag"
        private val LANGUAGES = listOf(
            "English" to "en", "العربية" to "ar", "Français" to "fr", "Español" to "es",
            "Deutsch" to "de", "Türkçe" to "tr", "Português" to "pt", "Italiano" to "it"
        )
    }
}
