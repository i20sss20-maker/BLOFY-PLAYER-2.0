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
import androidx.lifecycle.LiveData
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.core.identity.StreamCodeClient
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.device.StreamDeviceCompatibility
import tv.blofy.player.core.diagnostics.StreamConnectionDiagnostics
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.CatalogRefreshWorker
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.DeviceLocalTime
import tv.blofy.player.ui.playlist.ProviderManagerActivity
import tv.blofy.player.ui.profile.HomePersonalizationActivity
import tv.blofy.player.ui.login.CodeOnlyLoginActivity
import tv.blofy.player.ui.login.StartupEntryState
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
    private var refreshJobs: LiveData<List<WorkInfo>>? = null
    private var observedRefreshProvider: String? = null
    private var refreshState: WorkInfo.State? = null
    private var refreshStage: String? = null
    private var refreshRequested = false
    private var refreshNotice: String? = null
    private val prefs by lazy { getSharedPreferences(RuntimeSettings.PREFS, MODE_PRIVATE) }
    private val isRtl: Boolean get() = resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
    private val uiDirection: Int get() = if (isRtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.CODE_ONLY_LOGIN) buildStreamPage() else buildPage()
        lifecycleScope.launch {
            provider = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                dao.activeProviderId()?.let { dao.provider(it) }
                    ?: dao.providers().first().firstOrNull()
            }
            if (!isFinishing) {
                provider?.let { observeRefresh(it.id) }
                updateSyncStatus()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) updateSyncStatus()
        // Provider manager can change the active playlist while Settings is stopped.
        // Reload only the local active record; never contact the stream provider on UI resume.
        lifecycleScope.launch {
            val active = try {
                withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    dao.activeProviderId()?.let { dao.provider(it) }
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                null
            }
            if (isFinishing || isDestroyed) return@launch
            if (active != null && provider?.id != active.id) {
                provider = active
                observeRefresh(active.id)
            }
            if (::status.isInitialized) updateSyncStatus()
        }
    }

    /**
     * Separate STREAM UI: the player offers many specialist settings, but a code-based
     * viewer only needs their subscription, playback preferences and support.
     * Uses the same focusable cards on remote and a one-column stack on phones.
     */
    private fun buildStreamPage() {
        cardRows.clear()
        sections.clear()
        val screen = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = uiDirection
            overScrollMode = View.OVER_SCROLL_NEVER
            background = AppCompatResources.getDrawable(this@SettingsActivity, R.drawable.blofy_home_background)
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            clipChildren = false
            clipToPadding = false
            setPadding(dp(if (isTv()) 44 else 20), dp(22), dp(if (isTv()) 44 else 20), dp(28))
        }
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
        }
        header.addView(android.widget.ImageView(this).apply {
            setImageResource(R.drawable.stream_logo)
            contentDescription = "BLOFY STREAM"
        }, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginEnd = dp(14) })
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@SettingsActivity).apply {
                text = "BLOFY STREAM"
                BlofyTvDesign.applyHeading(this)
                textSize = if (isTv()) 26f else 22f
                letterSpacing = .06f
            })
            addView(TextView(this@SettingsActivity).apply {
                text = copy("إعدادات بسيطة لمشاهدة أفضل", "Simple settings. Better streaming.")
                BlofyTvDesign.applyCaption(this)
                textSize = 13f
            })
        }, LinearLayout.LayoutParams(0, -2, 1f))
        val back = settingButton(copy("رجوع", "Back"), true) { finish() }.apply {
            id = View.generateViewId()
            contentDescription = copy("العودة للرئيسية", "Back to home")
        }
        header.addView(back, LinearLayout.LayoutParams(dp(82), dp(48)))
        page.addView(header, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(18) })

        status = TextView(this).apply {
            textSize = 12.5f
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(12), dp(18), dp(12))
            background = CinemaStyle.surface(this@SettingsActivity, radiusDp = 18)
        }
        updateSyncStatus()
        page.addView(status, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })

        addSection(page, copy("اشتراكي والمكتبة", "Subscription & library"))
        addCard(actionCard(copy("اشتراكي", "My subscription"),
            copy("حالة الكود وتاريخ انتهاء الاشتراك", "Status and subscription expiry")) { showStreamSubscription() })
        refreshCard = actionCard(copy("تحديث المحتوى", "Refresh content"),
            copy("تحديث القنوات والأفلام والمسلسلات دون حذف المكتبة", "Refresh live, movies and series safely")) { refreshLibrary() }
        addCard(refreshCard)

        addSection(page, copy("المشاهدة", "Playback"))
        addCard(cycleSetting(copy("حجم الصورة", "Picture fit"), RuntimeSettings.KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"),
            arrayOf(copy("ملاءمة", "Fit"), copy("تكبير", "Zoom"), copy("ملء", "Fill"))))
        addCard(cycleSetting(copy("الترجمة", "Subtitles"), RuntimeSettings.KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"),
            arrayOf(copy("العربية أولًا", "Arabic first"), copy("تلقائي", "Automatic"), copy("إيقاف", "Off"))))
        addCard(cycleSetting(copy("الحلقة التالية", "Next episode"), RuntimeSettings.KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"),
            arrayOf(copy("اسألني", "Ask me"), copy("تلقائي", "Auto"), copy("إيقاف", "Off"))))
        addCard(actionCard(copy("حماية الأطفال", "Parental controls"),
            copy("إدارة رمز PIN والمحتوى المقفل", "PIN and locked content")) {
            startActivity(Intent(this, ParentalSettingsActivity::class.java))
        })

        addSection(page, copy("الحساب والمساعدة", "Account & help"))
        addCard(actionCard(copy("فحص الجهاز والاتصال", "Device & connection"),
            copy("اختبار HTTPS ومعرفة وضع تشغيل الجهاز", "HTTPS check and device compatibility")) {
            showStreamCompatibility()
        })
        addCard(actionCard(copy("معلومات التطبيق", "App information"),
            copy("إصدار التطبيق وتقرير الدعم", "Version and support diagnostics")) {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })
        addCard(actionCard(copy("تسجيل الخروج", "Sign out"),
            copy("الخروج من الحساب على هذا الجهاز فقط", "Sign out on this device only")) {
            confirmStreamSignOut()
        }.apply { tag = "stream_sign_out" })

        linkFocus(back)
        page.addView(TextView(this).apply {
            text = "BLOFY STREAM  •  " + BuildConfig.VERSION_NAME
            BlofyTvDesign.applyCaption(this)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, dp(46)).apply { topMargin = dp(12) })
        screen.addView(page)
        setContentView(screen)
        screen.post { sections.firstOrNull()?.getChildAt(0)?.requestFocus() }
    }

    private fun confirmStreamSignOut() {
        if (!BuildConfig.CODE_ONLY_LOGIN) return
        AlertDialog.Builder(this)
            .setTitle(copy("تسجيل الخروج", "Sign out"))
            .setMessage(copy(
                "راح نزيل جلسة الدخول من هذا الجهاز فقط. اشتراكك في السيرفر ما ينلغي، وقد تحتاج كودًا صالحًا عند الدخول مرة ثانية.",
                "Only this device's local session is cleared. Your server subscription stays active; a valid code may be needed to sign in again."
            ))
            .setNegativeButton(copy("إلغاء", "Cancel"), null)
            .setPositiveButton(copy("تسجيل الخروج", "Sign out")) { _, _ ->
                // Keep installationKey intact: a redeemed code can be rebound to its
                // original installation; removing it would incorrectly create a new device.
                StreamCodeSession.clearClaim(applicationContext)
                StartupEntryState.clear(applicationContext)
                startActivity(Intent(this, CodeOnlyLoginActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                finish()
            }
            .show()
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
        header.addView(titleBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val back = settingButton(getString(R.string.back), true) { finish() }.apply { id = View.generateViewId() }
        header.addView(back, LinearLayout.LayoutParams(dp(98), dp(48)))
        header.minimumHeight = dp(64)
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })

        status = TextView(this).apply {
            textSize = 12f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(CinemaStyle.Muted)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(14), 0, dp(14), 0)
            background = CinemaStyle.surface(this@SettingsActivity)
        }
        updateSyncStatus()
        page.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)).apply { bottomMargin = dp(12) })

        addSection(page, copy("عام", "General"))
        addCard(actionCard(getString(R.string.setting_app_language), currentLanguageLabel()) { chooseLanguage() })
        addCard(cycleSetting(getString(R.string.setting_motion), RuntimeSettings.KEY_MOTION,
            arrayOf("smooth", "reduced"),
            arrayOf(getString(R.string.setting_smooth), getString(R.string.setting_reduced))))
        addCard(actionCard(
            copy("ترتيب وإخفاء أقسام الرئيسية", "Home section order and visibility"),
            copy("رتّب ما يظهر لك وأخفِ الأقسام غير المهمة", "Reorder your Home rows and hide what you do not need")
        ) {
            startActivity(Intent(this, HomePersonalizationActivity::class.java))
        })
        if (!BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(copy("باقتي", "My plan"), copy("مدة التفعيل والأجهزة المسموحة", "Activation period and allowed devices")) {
            startActivity(Intent(this, tv.blofy.player.ui.subscription.SubscriptionActivity::class.java))
        }.apply { tag = "blofy_subscription_entry" })
        if (BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(copy("اشتراكي في BLOFY STREAM", "My BLOFY STREAM subscription"),
            copy("حالة الاشتراك والأيام المتبقية وتاريخ الانتهاء", "Subscription status, remaining days, expiry")) {
            showStreamSubscription()
        })
        if (!BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(copy("حالة الاشتراك", "Subscription status"), copy("صلاحية المحتوى والاتصالات الحالية", "Content validity and active connections")) {
            startActivity(Intent(this, tv.blofy.player.ui.subscription.ConnectionStatusActivity::class.java))
        })
        if (!BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(getString(R.string.account_title), getString(R.string.privacy_policy)) {
            startActivity(Intent(this, tv.blofy.player.ui.account.AccountActivity::class.java))
        })
        if (!BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(
            copy("بيانات الجهاز والباركود", "Device & barcode"),
            copy("عرض رقم الجهاز ورمز التفعيل والباركود", "View device ID, activation code and barcode")
        ) {
            startActivity(Intent(this, tv.blofy.player.ui.login.LoginActivity::class.java))
        }.apply { tag = "blofy_device_barcode_entry" })

        addSection(page, copy("التشغيل", "Playback"))
        addCard(cycleSetting(getString(R.string.setting_aspect), RuntimeSettings.KEY_ASPECT,
            arrayOf("fit", "zoom", "fill"),
            arrayOf(getString(R.string.setting_aspect_fit), getString(R.string.setting_aspect_zoom), getString(R.string.setting_aspect_fill))))
        addCard(actionCard(copy("جودة الصور والأداء", "Artwork and performance"), copy("وضوح البوسترات وخفة الواجهة", "Poster quality and a lighter interface")) {
            startActivity(Intent(this, CommercialSettingsActivity::class.java))
        })

        addSection(page, copy("البث المباشر", "Live TV"))
        addCard(cycleSetting(getString(R.string.setting_live_preview), RuntimeSettings.KEY_AUTOPLAY_LIVE,
            arrayOf("on", "off"),
            arrayOf(getString(R.string.setting_auto), getString(R.string.setting_manual))))

        addSection(page, copy("الأفلام والمسلسلات", "Movies and series"))
        addCard(cycleSetting(getString(R.string.setting_resume), RuntimeSettings.KEY_RESUME_PROMPT,
            arrayOf("on", "off"),
            arrayOf(getString(R.string.setting_ask_me), getString(R.string.setting_play_directly))))
        addCard(cycleSetting(getString(R.string.setting_next_episode), RuntimeSettings.KEY_AUTO_NEXT,
            arrayOf("ask", "on", "off"),
            arrayOf(getString(R.string.setting_ask_me), getString(R.string.setting_auto), getString(R.string.setting_off))))
        addCard(cycleSetting(
            copy("حجم عرض البوسترات", "Poster layout"),
            RuntimeSettings.KEY_CATALOG_DENSITY,
            arrayOf("comfortable", "compact"),
            arrayOf(copy("مريح", "Comfortable"), copy("مضغوط", "Compact"))
        ))

        addSection(page, copy("الترجمة والصوت", "Subtitles and audio"))
        addCard(cycleSetting(getString(R.string.setting_audio_output), RuntimeSettings.KEY_AUDIO_OUTPUT,
            arrayOf("auto", "stereo"),
            arrayOf(getString(R.string.setting_audio_auto), getString(R.string.setting_audio_stereo))))
        addCard(cycleSetting(getString(R.string.setting_subtitle_language), RuntimeSettings.KEY_SUBTITLE_LANGUAGE,
            arrayOf("ar", "auto", "off"),
            arrayOf(getString(R.string.setting_subtitle_ar_first), getString(R.string.setting_auto), getString(R.string.setting_off))))
        addCard(cycleSetting(getString(R.string.setting_subtitle_size), RuntimeSettings.KEY_SUBTITLE_SIZE,
            arrayOf("small", "medium", "large"),
            arrayOf(getString(R.string.setting_small), getString(R.string.setting_medium), getString(R.string.setting_large))))

        addSection(page, copy("القوائم والسيرفرات", "Playlists and servers"))
        if (!BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(copy("إدارة السيرفرات والقوائم", "Manage servers and playlists"), copy("تبديل، تعديل، مزامنة وحالة كل سيرفر", "Switch, edit, refresh and view each server status")) {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        })
        addCard(actionCard(copy("ترتيب وإخفاء الفئات", "Category order and visibility"), copy("البث والأفلام والمسلسلات لكل سيرفر", "Live, movies and series categories for the active server")) {
            startActivity(Intent(this, CategoryManagerActivity::class.java))
        })
        refreshCard = actionCard(getString(R.string.setting_refresh_content), syncSubtitle()) { refreshLibrary() }
        addCard(refreshCard)
        addCard(actionCard(copy("حالة حفظ المكتبة والصور", "Library download status"),
            copy("المحفوظ والناقص واستكمال التحميل", "Saved files, remaining items and resume")) {
            startActivity(Intent(this, LibraryDownloadActivity::class.java))
        }.apply { tag = "blofy_library_download_entry" })

        addSection(page, copy("الحماية", "Security"))
        addCard(actionCard(copy("الحماية الأبوية وPIN", "Parental control and PIN"), copy("تعيين أو تغيير رمز فتح المحتوى المقفل", "Set or change the PIN for locked content")) {
            startActivity(Intent(this, ParentalSettingsActivity::class.java))
        })

        addSection(page, copy("التحديث", "Updates"))
        if (!BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(getString(R.string.update_check), getString(R.string.update_check_hint)) {
            tv.blofy.player.core.update.AppUpdatePrompt.check(this, force = true)
        })

        addSection(page, copy("حول التطبيق", "About app"))
        if (BuildConfig.CODE_ONLY_LOGIN) addCard(actionCard(
            copy("فحص توافق الجهاز والاتصال", "Device and connection compatibility"),
            copy("Android وذاكرة الجهاز ومحرك الفيديو وشهادة HTTPS", "Android, memory, video engine and HTTPS certificate")
        ) { showStreamCompatibility() })
        addCard(actionCard(copy("تشخيص BLOFY", "BLOFY diagnostics"), copy("الجهاز والشبكة والمكتبة وتقرير الدعم", "Device, network, library and support report")) {
            startActivity(Intent(this, SystemStatusActivity::class.java))
        })
        addCard(actionCard(copy("نسخ احتياطي واستعادة", "Backup and restore"), copy("المفضلة، السجل، الفئات والإعدادات بدون بيانات الدخول", "Favorites, history, categories and settings without credentials")) {
            startActivity(Intent(this, BackupRestoreActivity::class.java))
        })
        storageCard = actionCard(getString(R.string.setting_storage_local), getString(R.string.setting_storage_calculating)) { showStorageManager() }
        addCard(storageCard)
        addCard(actionCard(getString(R.string.setting_restore), getString(R.string.setting_restore_subtitle)) { restoreDefaults() })

        linkFocus(back)
        page.addView(TextView(this).apply {
            text = if (BuildConfig.CODE_ONLY_LOGIN) "BLOFY STREAM • 55.8.7" else "BLOFY PLAYER ${BuildConfig.VERSION_NAME}"
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
            val gap = dp(if (isTv()) 4 else 6)
            setMargins(gap, gap, gap, gap)
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
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(CinemaStyle.White)
            gravity = Gravity.START
            setPadding(dp(5), dp(if (isTv()) 13 else 18), dp(5), dp(if (isTv()) 5 else 8))
        })
        grid = GridLayout(this).apply {
            val available = resources.configuration.screenWidthDp - if (isTv()) 72 else 36
            val preferredWidth = (250 * resources.configuration.fontScale.coerceAtLeast(1f)).toInt()
            columnCount = (available / preferredWidth).coerceIn(1, 2)
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
        RuntimeSettings.KEY_CATALOG_DENSITY -> copy("غيّر عدد البوسترات الظاهرة بدون التأثير على جودة الصور", "Change how many posters fit on screen without changing artwork quality")
        else -> ""
    }

    private fun copy(arabic: String, english: String) =
        if (androidx.core.os.ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "ar") arabic else english

    /**
     * Credential-free live self-check. No redeem request is sent here and no code,
     * bearer, source host or subscriber details enter this dialog.
     */
    private fun showStreamCompatibility() {
        val device = StreamDeviceCompatibility.current(this)
        val kind = if (device.television) "Android TV / TV Box" else "هاتف أو جهاز لوحي"
        val memory = if (device.lowMemory) "اقتصادي (وضع خفيف تلقائي)" else "طبيعي"
        val info = "Android SDK ${device.sdk} • $kind\n" +
            "الذاكرة: $memory\n" +
            "المحرك: Media3 مع بدائل Decoder\n" +
            "تحميل المكتبة: ${device.maxCatalogRequestsPerHost} اتصالات لكل مضيف\n" +
            "التنقل: ريموت D-pad / لوحة المفاتيح\n"
        val dialog = AlertDialog.Builder(this)
            .setTitle("توافق BLOFY STREAM")
            .setMessage(info + "\nجارِ اختبار HTTPS مع سيرفر BLOFY...")
            .setPositiveButton("إغلاق", null)
            .show()
        lifecycleScope.launch {
            val result = StreamConnectionDiagnostics.probe()
            if (isFinishing || isDestroyed || !dialog.isShowing) return@launch
            val connection = if (result.reachable)
                "اتصال HTTPS ناجح (الخادم متاح)"
            else StreamConnectionDiagnostics.guidance(
                result.cause ?: StreamConnectionDiagnostics.Cause.OTHER)
            dialog.setMessage(info + "\n" + connection +
                "\n\nهذا الفحص لا يؤكد صلاحية كود الاشتراك أو توفر قنوات المصدر.")
        }
    }

    private fun showStreamSubscription() {
        val token=StreamCodeSession.token(applicationContext)
        if(token==null){
            AlertDialog.Builder(this).setTitle("اشتراك BLOFY STREAM")
                .setMessage("لا يوجد اشتراك مفعّل على هذا الجهاز.")
                .setPositiveButton("حسنًا",null).show()
            return
        }
        lifecycleScope.launch {
            val current=StreamCodeClient.sessionStatus(token)
            if (isFinishing||isDestroyed) return@launch
            when {
                current==null -> AlertDialog.Builder(this@SettingsActivity)
                    .setTitle("حالة الاشتراك")
                    .setMessage("تعذر الاتصال بالسيرفر الآن. اشتراكك محفوظ ولم يتم حذفه.")
                    .setPositiveButton("حسنًا",null).show()
                !current.active -> AlertDialog.Builder(this@SettingsActivity)
                    .setTitle("اشتراك منتهي أو موقوف")
                    .setMessage("أدخل كودًا جديدًا أو تواصل مع الدعم لإعادة التفعيل.")
                    .setNegativeButton("إلغاء",null)
                    .setPositiveButton("إدخال كود") { _,_ ->
                        StreamCodeSession.clearClaim(applicationContext)
                        startActivity(Intent(this@SettingsActivity,
                            tv.blofy.player.ui.login.CodeOnlyLoginActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                        finish()
                    }.show()
                else -> {
                    val expiry=current.expiresAt?.let {
                        SimpleDateFormat("dd/MM/yyyy HH:mm",Locale.ENGLISH).apply {
                            timeZone=java.util.TimeZone.getTimeZone("Asia/Riyadh")
                        }.format(Date(it))
                    } ?: "غير محدد"
                    val remaining=current.daysRemaining?.let { "$it يوم" } ?: "ساري"
                    AlertDialog.Builder(this@SettingsActivity)
                        .setTitle("اشتراكي في BLOFY STREAM ✓")
                        .setMessage("الحالة: ساري\nالمدة المتبقية: $remaining\nانتهاء الاشتراك: $expiry\nبتوقيت السعودية\n\nيتم التحقق من المدة عبر السيرفر وليس ساعة الجهاز.")
                        .setPositiveButton("حسنًا",null).show()
                }
            }
        }
    }

    private fun restoreDefaults() {
        prefs.edit().clear().apply()
        status.text = getString(R.string.setting_restored)
        buildPage()
    }

    /** Settings and Home watch the same manual WorkManager task; neither blocks playback. */
    private fun observeRefresh(providerId: String) {
        if (observedRefreshProvider == providerId) return
        refreshJobs?.removeObservers(this)
        observedRefreshProvider = providerId
        refreshState = null
        refreshStage = null
        refreshRequested = false
        refreshNotice = null
        refreshJobs = WorkManager.getInstance(applicationContext)
            .getWorkInfosForUniqueWorkLiveData(CatalogRefreshWorker.manualWorkName(providerId))
            .also { jobs ->
                jobs.observe(this) { all ->
                    val current = all.firstOrNull { !it.state.isFinished } ?: all.lastOrNull()
                    refreshState = current?.state
                    refreshStage = current?.progress?.getString("catalog_stage")
                    if (::status.isInitialized) updateSyncStatus()
                }
            }
    }

    /** Single manual action: progress and final result stay on this settings card. */
    private fun refreshLibrary() {
        val active = provider
        if (active == null) {
            refreshNotice = copy("اختر قائمة تشغيل أولًا.", "Choose a playlist first.")
            updateSyncStatus()
            return
        }
        if (!CatalogSyncState.isReady(applicationContext, active.id)) {
            refreshNotice = copy(
                "أكمل إعداد القائمة أولًا، ثم حدّث المحتوى من هنا.",
                "Finish the first playlist setup, then refresh content here."
            )
            updateSyncStatus()
            return
        }
        // The card stays focusable for TV remotes, but repeated presses never enqueue duplicates.
        if (refreshState == WorkInfo.State.RUNNING ||
            refreshState == WorkInfo.State.ENQUEUED ||
            refreshState == WorkInfo.State.BLOCKED
        ) return

        observeRefresh(active.id)
        refreshNotice = null
        refreshRequested = true
        refreshStage = null
        refreshState = WorkInfo.State.ENQUEUED
        updateSyncStatus()
        try {
            CatalogRefreshWorker.enqueueNow(applicationContext, active.id, manual = true)
        } catch (_: Exception) {
            refreshState = WorkInfo.State.FAILED
            refreshNotice = copy("تعذر بدء التحديث. حاول مجددًا.", "Could not start refresh. Try again.")
            updateSyncStatus()
        }
    }

    private fun updateSyncStatus() {
        val active = provider
        status.text = if (active == null) getString(R.string.setting_status_reading)
        else {
            val last = CatalogSyncState.lastSyncedAt(applicationContext, active.id)
            if (last > 0L) getString(R.string.setting_status_saved_at, formatSyncTime(last))
            else getString(R.string.setting_status_saved)
        }
        if (!::refreshCard.isInitialized) return

        val busy = refreshState == WorkInfo.State.RUNNING ||
            refreshState == WorkInfo.State.ENQUEUED ||
            refreshState == WorkInfo.State.BLOCKED
        val section = when (refreshStage) {
            "LIVE" -> getString(R.string.home_live)
            "MOVIES" -> getString(R.string.home_movies)
            "SERIES" -> getString(R.string.home_series)
            "SAVE" -> copy("حفظ التغييرات", "Saving changes")
            else -> null
        }
        val value = when {
            refreshNotice != null -> copy("تعذر بدء التحديث", "Refresh unavailable")
            active == null -> copy("تحديث الآن", "Refresh now")
            refreshState == WorkInfo.State.RUNNING -> copy("جارٍ تحديث المحتوى…", "Updating content…")
            refreshState == WorkInfo.State.ENQUEUED || refreshState == WorkInfo.State.BLOCKED ->
                copy("بانتظار بدء التحديث…", "Waiting to refresh…")
            refreshRequested && refreshState == WorkInfo.State.SUCCEEDED ->
                copy("✓ تم تحديث المحتوى", "✓ Content updated")
            refreshRequested && (refreshState == WorkInfo.State.FAILED || refreshState == WorkInfo.State.CANCELLED) ->
                copy("تعذر التحديث • اضغط للمحاولة", "Refresh failed • tap to retry")
            else -> copy("تحديث الآن", "Refresh now")
        }
        val hint = when {
            refreshNotice != null -> refreshNotice.orEmpty()
            refreshState == WorkInfo.State.RUNNING ->
                section?.let { copy("المرحلة الحالية: $it", "Current section: $it") }
                    ?: copy("يُحدَّث المحتوى والمكتبة السابقة محفوظة", "Updating; your saved library remains available")
            refreshState == WorkInfo.State.ENQUEUED || refreshState == WorkInfo.State.BLOCKED ->
                copy("سيبدأ عند توفر الاتصال والموارد", "Starts when network and device are ready")
            else -> syncSubtitle()
        }
        refreshCard.bind(getString(R.string.setting_refresh_content), value, hint)
        refreshCard.setBusy(busy)
    }

    private fun syncSubtitle(): String {
        val active = provider ?: return copy("لا توجد قائمة محددة", "No playlist selected")
        val last = CatalogSyncState.lastSyncedAt(applicationContext, active.id)
        return if (last > 0L) getString(R.string.setting_last_refresh, formatSyncTime(last))
        else copy("لم يتم التحديث بعد", "Not refreshed yet")
    }

    private fun formatSyncTime(value: Long): String {
        val now = System.currentTimeMillis()
        return DeviceLocalTime.format(this, value, if (DeviceLocalTime.isSameLocalDay(this, value, now)) "HH:mm" else "dd/MM HH:mm")
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
