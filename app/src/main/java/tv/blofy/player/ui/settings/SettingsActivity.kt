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
    private lateinit var storageCard: Button
    private lateinit var refreshCard: Button
    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }
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
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = uiDirection
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            setPadding(dp(46), dp(30), dp(46), dp(34))
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
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            layoutDirection = uiDirection
        }
        titleBox.addView(TextView(this).apply {
            text = getString(R.string.settings_title)
            BlofyTvDesign.applyTitle(this)
            gravity = Gravity.END
        })
        titleBox.addView(TextView(this).apply {
            text = getString(R.string.settings_subtitle)
            BlofyTvDesign.applyCaption(this)
            textSize = 14f
            gravity = Gravity.END
            setPadding(0, dp(6), 0, 0)
        })
        header.addView(titleBox, LinearLayout.LayoutParams(0, dp(80), 1f))
        val back = settingButton("↩  ${getString(R.string.back)}", true) { finish() }.apply { id = View.generateViewId() }
        header.addView(back, LinearLayout.LayoutParams(dp(156), dp(54)))
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88)))

        status = TextView(this).apply {
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(10))
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        updateSyncStatus()
        page.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { bottomMargin = dp(18) })

        grid = GridLayout(this).apply {
            columnCount = if (isTv()) 3 else 2
            layoutDirection = uiDirection
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
            clipChildren = false
            clipToPadding = false
        }

        addCard(cycleSetting(getString(R.string.setting_aspect), KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"),
            arrayOf(getString(R.string.setting_aspect_fit), getString(R.string.setting_aspect_zoom), getString(R.string.setting_aspect_fill))))
        addCard(cycleSetting(getString(R.string.setting_audio_output), KEY_AUDIO_OUTPUT,
            arrayOf("auto", "stereo"),
            arrayOf(getString(R.string.setting_audio_auto), getString(R.string.setting_audio_stereo))))
        addCard(cycleSetting(getString(R.string.setting_subtitle_language), KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"),
            arrayOf(getString(R.string.setting_subtitle_ar_first), getString(R.string.setting_auto), getString(R.string.setting_off))))
        addCard(cycleSetting(getString(R.string.setting_subtitle_size), KEY_SUBTITLE_SIZE,
            arrayOf("small", "medium", "large"),
            arrayOf(getString(R.string.setting_small), getString(R.string.setting_medium), getString(R.string.setting_large))))
        addCard(cycleSetting(getString(R.string.setting_live_preview), KEY_AUTOPLAY_LIVE,
            arrayOf("on", "off"),
            arrayOf(getString(R.string.setting_auto), getString(R.string.setting_manual))))
        addCard(cycleSetting(getString(R.string.setting_resume), KEY_RESUME_PROMPT,
            arrayOf("on", "off"),
            arrayOf(getString(R.string.setting_ask_me), getString(R.string.setting_play_directly))))
        addCard(cycleSetting(getString(R.string.setting_next_episode), KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"),
            arrayOf(getString(R.string.setting_ask_me), getString(R.string.setting_auto), getString(R.string.setting_off))))
        addCard(cycleSetting(getString(R.string.setting_motion), KEY_MOTION,
            arrayOf("smooth", "reduced"),
            arrayOf(getString(R.string.setting_smooth), getString(R.string.setting_reduced))))
        addCard(actionCard(getString(R.string.setting_app_language), currentLanguageLabel()) { chooseLanguage() })
        addCard(actionCard(getString(R.string.setting_playlists), getString(R.string.setting_playlists_subtitle)) {
            startActivity(Intent(this, LoginActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            })
        })
        refreshCard = actionCard(getString(R.string.setting_refresh_content), syncSubtitle()) { refreshLibrary() }
        addCard(refreshCard)
        storageCard = actionCard(getString(R.string.setting_storage_local), getString(R.string.setting_storage_calculating)) { showStorageManager() }
        addCard(storageCard)
        addCard(actionCard(getString(R.string.setting_system_status), getString(R.string.setting_system_status_subtitle)) {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })
        addCard(actionCard(getString(R.string.setting_restore), getString(R.string.setting_restore_subtitle)) { restoreDefaults() })

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
            status.text = getString(R.string.setting_saved)
        }
        button.text = "$title\n${labels[currentIndex()]}"
        return button
    }

    private fun actionCard(title: String, subtitle: String, action: () -> Unit): Button =
        settingButton("$title\n$subtitle", false, action)

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
            val visualLeft = if (col + 1 < columns && i + 1 < count) grid.getChildAt(i + 1).id else item.id
            val visualRight = if (col > 0) grid.getChildAt(i - 1).id else item.id
            if (isRtl) {
                item.nextFocusLeftId = visualLeft
                item.nextFocusRightId = visualRight
            } else {
                item.nextFocusLeftId = visualRight
                item.nextFocusRightId = visualLeft
            }
        }
    }

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
        if (::refreshCard.isInitialized) refreshCard.text = "${getString(R.string.setting_refresh_content)}\n${syncSubtitle()}"
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
                storageCard.text = "${getString(R.string.setting_storage_local)}\n" +
                    getString(R.string.setting_storage_used, LocalStorageManager.format(applicationContext, stats.totalBytes))
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
                .setTitle(getString(R.string.storage_title))
                .setMessage(getString(R.string.storage_message, total, database, temporary))
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
            "English" to "en", "العربية" to "ar", "Français" to "fr", "Español" to "es",
            "Deutsch" to "de", "Türkçe" to "tr", "Português" to "pt", "Italiano" to "it"
        )
    }
}
