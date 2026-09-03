package tv.blofy.player.ui.settings

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.playback.PlaybackIntelligence
import tv.blofy.player.core.playback.SmartZappingCache
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class SystemStatusActivity : AppCompatActivity() {
    private lateinit var content: LinearLayout
    private lateinit var loading: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = ScrollView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(
                this@SystemStatusActivity,
                R.drawable.blofy_home_background
            )
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(50), dp(34), dp(50), dp(46))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(content)
        setContentView(root)

        renderLoading()
        loadStatus()
    }

    private fun renderLoading() {
        content.removeAllViews()
        addHeader("جاري فحص النسخة والمكتبة والتشغيل...")
        loading = ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
        }
        content.addView(
            loading,
            LinearLayout.LayoutParams(dp(54), dp(54)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(70)
            }
        )
    }

    private fun loadStatus() {
        lifecycleScope.launch {
            val snapshot = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull()
                val activation = dao.activation()
                val liveCount = provider?.let { dao.catalogCountAll(it.id, "live") } ?: 0
                val movieCount = provider?.let { dao.catalogCountAll(it.id, "movie") } ?: 0
                val seriesCount = provider?.let { dao.catalogCountAll(it.id, "series") } ?: 0
                val storage = LocalStorageManager.stats(applicationContext)
                val playback = provider?.let {
                    PlaybackIntelligence.snapshot(applicationContext, it.id)
                }
                val zapping = provider?.let {
                    SmartZappingCache.status(it.id)
                }
                StatusSnapshot(
                    provider = provider,
                    activationText = activationText(activation),
                    activationCheckedAt = activation?.lastCheckAt ?: 0L,
                    liveCount = liveCount,
                    movieCount = movieCount,
                    seriesCount = seriesCount,
                    catalogReady = provider?.let {
                        CatalogSyncState.isReady(applicationContext, it.id)
                    } == true,
                    lastCatalogUpdateAt = provider?.let {
                        CatalogSyncState.lastUpdatedAt(applicationContext, it.id)
                    } ?: 0L,
                    storage = storage,
                    playback = playback,
                    zapping = zapping,
                    network = networkState(applicationContext),
                    profile = ProfileStore.active(applicationContext)
                )
            }
            if (!isFinishing && !isDestroyed) renderStatus(snapshot)
        }
    }

    private fun renderStatus(status: StatusSnapshot) {
        content.removeAllViews()
        val total = status.liveCount + status.movieCount + status.seriesCount
        val overallReady = status.provider != null && status.catalogReady && total > 0
        addHeader(
            if (overallReady) {
                "النظام جاهز • المحتوى محفوظ محليًا"
            } else {
                "يوجد جزء يحتاج مراجعة قبل الاستخدام الكامل"
            }
        )

        content.addView(
            statusBanner(
                title = if (overallReady) "BLOFY جاهز للعمل" else "BLOFY يحتاج مراجعة",
                subtitle = when {
                    status.provider == null -> "لا توجد قائمة نشطة على هذا الجهاز"
                    total <= 0 -> "القائمة موجودة لكن المكتبة المحلية فارغة"
                    !status.catalogReady -> "المحتوى موجود والكاش لم يُعلّم كمزامنة مكتملة"
                    else -> "الدخول التالي يفتح من الكاش بدون إعادة تحميل القوائم"
                },
                positive = overallReady
            ),
            LinearLayout.LayoutParams(-1, dp(96)).apply { bottomMargin = dp(14) }
        )

        addSection(
            title = "النسخة والجهاز",
            badge = status.network.label,
            positive = status.network.connected,
            rows = listOf(
                StatusRow("النسخة", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"),
                StatusRow("البناء", BuildConfig.BUILD_SHA.take(12)),
                StatusRow("نوع الجهاز", DeviceClass.detect(this).name),
                StatusRow("الملف الحالي", if (status.profile.kids) "${status.profile.name} • وضع أطفال" else status.profile.name),
                StatusRow("FFmpeg", if (BuildConfig.FFMPEG_EXTENSION_BUNDLED) "مدمج وجاهز" else "غير مدمج في هذا البناء"),
                StatusRow("خدمة التفعيل", if (BuildConfig.ACTIVATION_BASE_URL.isBlank()) "غير مضبوطة" else "مضبوطة"),
                StatusRow("حالة التفعيل", status.activationText),
                StatusRow("آخر تحقق", formatTime(status.activationCheckedAt))
            )
        )

        val provider = status.provider
        addSection(
            title = "المكتبة المحلية",
            badge = if (status.catalogReady && total > 0) "جاهزة" else "تحتاج مزامنة",
            positive = status.catalogReady && total > 0,
            rows = if (provider == null) {
                listOf(StatusRow("القائمة النشطة", "لا توجد قائمة"))
            } else {
                listOf(
                    StatusRow("القائمة النشطة", provider.name),
                    StatusRow("النوع", provider.providerType.uppercase(Locale.US)),
                    StatusRow("القنوات", formatNumber(status.liveCount)),
                    StatusRow("الأفلام", formatNumber(status.movieCount)),
                    StatusRow("المسلسلات", formatNumber(status.seriesCount)),
                    StatusRow("إجمالي المكتبة", formatNumber(total)),
                    StatusRow("حالة الكاش", if (status.catalogReady) "محفوظ وجاهز للدخول الفوري" else "غير مكتمل"),
                    StatusRow("آخر تحديث ناجح", formatTime(status.lastCatalogUpdateAt))
                )
            }
        )

        addPlaybackSection(status)

        addSection(
            title = "الخدمات والتخزين",
            badge = "آمن",
            positive = true,
            rows = listOf(
                StatusRow("TMDb", if (BuildConfig.TMDB_TOKEN.isBlank()) "غير مفعّل في هذا البناء • بيانات السيرفر تعمل" else "التقييمات والممثلون جاهزون"),
                StatusRow("قاعدة البيانات", LocalStorageManager.format(this, status.storage.databaseBytes)),
                StatusRow("الصور والملفات المؤقتة", LocalStorageManager.format(this, status.storage.temporaryBytes)),
                StatusRow("إجمالي مساحة BLOFY", LocalStorageManager.format(this, status.storage.totalBytes)),
                StatusRow("الخصوصية", "لا تُعرض بيانات الدخول أو رابط السيرفر")
            )
        )

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
            clipChildren = false
            setPadding(0, dp(6), 0, 0)
        }
        actions.addView(
            actionButton("تحديث الحالة", true) {
                renderLoading()
                loadStatus()
            },
            LinearLayout.LayoutParams(dp(190), dp(56)).apply { marginStart = dp(10) }
        )
        actions.addView(
            actionButton("إعادة تعلم البث", false) {
                val currentProvider = status.provider
                if (currentProvider == null) {
                    Toast.makeText(this, "لا توجد قائمة نشطة", Toast.LENGTH_SHORT).show()
                } else {
                    PlaybackIntelligence.clear(this, currentProvider.id)
                    Toast.makeText(
                        this,
                        "تم مسح القياسات فقط • سيختار BLOFY الأفضل من جديد",
                        Toast.LENGTH_SHORT
                    ).show()
                    renderLoading()
                    loadStatus()
                }
            },
            LinearLayout.LayoutParams(dp(210), dp(56))
        )
        content.addView(actions)

        content.addView(TextView(this).apply {
            text = "مركز الحالة يقرأ البيانات المحلية فقط ولا يعيد تحميل القنوات أو الأفلام أو المسلسلات."
            textSize = 11.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(16), 0, 0)
        })
    }

    private fun addPlaybackSection(status: StatusSnapshot) {
        val provider = status.provider
        val playback = status.playback
        val zapping = status.zapping
        val bestFormat = playback?.preferredFormat?.uppercase(Locale.US)
            ?: provider?.liveFormat?.uppercase(Locale.US)
            ?: "—"

        val rows = mutableListOf<StatusRow>()
        if (provider == null) {
            rows += StatusRow("المشغل", "لا توجد قائمة لاختبارها")
        } else {
            rows += StatusRow("المحرك", provider.preferredEngine.uppercase(Locale.US))
            rows += StatusRow("النقل", provider.preferredTransport.uppercase(Locale.US))
            rows += StatusRow("صيغة البداية الذكية", bestFormat)
            rows += StatusRow(
                "Smart Zapping",
                if (zapping?.ready == true) {
                    "جاهز • ${formatNumber(zapping.cachedChannelCount)} قناة في ${zapping.freshCategoryCount} فئة"
                } else {
                    "يُجهّز تلقائيًا عند دخول البث"
                }
            )
            rows += StatusRow(
                "كاش التنقل",
                if (zapping?.newestEntryAt ?: 0L > 0L) {
                    "آخر تجهيز ${formatTime(zapping?.newestEntryAt ?: 0L)}"
                } else {
                    "لم يُجهّز بعد"
                }
            )
            rows += StatusRow("HLS", formatPlaybackStats(playback?.hls))
            rows += StatusRow("TS", formatPlaybackStats(playback?.ts))
            rows += StatusRow(
                "آخر تعلّم",
                formatTime(playback?.lastUpdatedAt ?: 0L)
            )
        }

        addSection(
            title = "ذكاء التشغيل والبث",
            badge = if (playback?.hasLearning == true) "يتعلم" else "تلقائي",
            positive = true,
            rows = rows
        )
    }

    private fun addHeader(subtitle: String) {
        content.addView(TextView(this).apply {
            text = "BLOFY HEALTH CENTER"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        content.addView(TextView(this).apply {
            text = "حالة BLOFY PLAYER"
            BlofyTvDesign.applyHeroTitle(this)
            textSize = 34f
            gravity = Gravity.RIGHT
            includeFontPadding = false
            setPadding(0, dp(2), 0, 0)
        })
        content.addView(TextView(this).apply {
            text = subtitle
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            setPadding(0, dp(7), 0, dp(20))
        })
    }

    private fun addSection(
        title: String,
        badge: String,
        positive: Boolean,
        rows: List<StatusRow>
    ) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(24), dp(19), dp(24), dp(20))
            background = sectionBackground()
            elevation = dp(5).toFloat()
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = title
            textSize = 18f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(38), 1f))
        header.addView(statusChip(badge, positive))
        card.addView(header)

        rows.forEachIndexed { index, row ->
            val line = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, if (index == 0) dp(7) else dp(4), 0, dp(4))
            }
            line.addView(TextView(this).apply {
                text = row.label
                textSize = 12.5f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(dp(190), dp(31)))
            line.addView(TextView(this).apply {
                text = row.value
                textSize = 13.2f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(0, dp(31), 1f))
            card.addView(line)
        }

        content.addView(
            card,
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(13) }
        )
    }

    private fun statusBanner(
        title: String,
        subtitle: String,
        positive: Boolean
    ) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(24), dp(14), dp(24), dp(14))
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            if (positive) {
                intArrayOf(0xFF244437.toInt(), 0xFF171D24.toInt())
            } else {
                intArrayOf(0xFF513226.toInt(), 0xFF241820.toInt())
            }
        ).apply {
            cornerRadius = dp(19).toFloat()
            setStroke(
                dp(1),
                if (positive) 0xFF4FAF86.toInt() else 0xFFD48B57.toInt()
            )
        }
        addView(TextView(this@SystemStatusActivity).apply {
            text = title
            textSize = 19f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        })
        addView(TextView(this@SystemStatusActivity).apply {
            text = subtitle
            textSize = 12.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, 0)
        })
    }

    private fun statusChip(label: String, positive: Boolean) = TextView(this).apply {
        text = label
        textSize = 11.5f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(if (positive) 0xFF9FF0C7.toInt() else 0xFFFFC592.toInt())
        gravity = Gravity.CENTER
        setPadding(dp(12), 0, dp(12), 0)
        background = GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            setColor(if (positive) 0x66316E55 else 0x665C3627)
            setStroke(
                dp(1),
                if (positive) 0xFF4FAF86.toInt() else 0xFFD48B57.toInt()
            )
        }
    }.also {
        it.layoutParams = LinearLayout.LayoutParams(-2, dp(30))
    }

    private fun actionButton(
        label: String,
        primary: Boolean,
        action: () -> Unit
    ) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13.5f
        typeface = BlofyTvDesign.HeadingTypeface
        isFocusable = true
        isFocusableInTouchMode = true
        setTextColor(Color.WHITE)
        background = actionBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = actionBackground(focused, primary)
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.018f else 1f)
                .scaleY(if (focused) 1.018f else 1f)
                .translationZ(if (focused) dp(8).toFloat() else dp(1).toFloat())
                .setDuration(65L)
                .start()
        }
        setOnClickListener { action() }
    }

    private fun sectionBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xF022182F.toInt(), 0xF0140F1C.toInt())
    ).apply {
        cornerRadius = dp(19).toFloat()
        setStroke(dp(1), 0xFF49365D.toInt())
    }

    private fun actionBackground(focused: Boolean, primary: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFA653FF.toInt(), 0xFF7130D2.toInt())
            primary -> intArrayOf(0xFF843FE6.toInt(), 0xFF5720AD.toInt())
            focused -> intArrayOf(0xFF633A8D.toInt(), 0xFF35214C.toInt())
            else -> intArrayOf(0xE62B203B.toInt(), 0xE61A1325.toInt())
        }
    ).apply {
        cornerRadius = dp(15).toFloat()
        setStroke(
            if (focused) dp(2) else dp(1),
            if (focused) BlofyTvDesign.PurpleBright else 0x99513C67.toInt()
        )
    }

    private fun activationText(
        activation: tv.blofy.player.data.local.ActivationEntity?
    ): String = when {
        activation == null -> "غير موجودة"
        activation.activated && activation.expiresAt == null ->
            "مفعّل • بدون تاريخ انتهاء محلي"
        activation.activated && activation.expiresAt != null ->
            "مفعّل • ينتهي ${formatTime(activation.expiresAt)}"
        activation.expiresAt != null &&
            activation.expiresAt <= System.currentTimeMillis() ->
            "منتهي • ${formatTime(activation.expiresAt)}"
        else -> "غير مفعّل"
    }

    private fun networkState(context: Context): NetworkState {
        val manager = context.getSystemService(ConnectivityManager::class.java)
            ?: return NetworkState(false, "غير متصل")
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
            ?: return NetworkState(false, "غير متصل")
        val hasInternet = capabilities.hasCapability(
            NetworkCapabilities.NET_CAPABILITY_INTERNET
        )
        val validated = capabilities.hasCapability(
            NetworkCapabilities.NET_CAPABILITY_VALIDATED
        )
        return when {
            validated -> NetworkState(true, "الإنترنت متصل")
            hasInternet -> NetworkState(true, "الشبكة متصلة")
            else -> NetworkState(false, "غير متصل")
        }
    }

    private fun formatPlaybackStats(
        stats: PlaybackIntelligence.FormatStats?
    ): String {
        if (stats == null || stats.attempts == 0) return "لم يُختبر بعد"
        val average = if (stats.averageStartupMs > 0L) {
            String.format(
                Locale.US,
                "%.1fث",
                stats.averageStartupMs / 1000.0
            )
        } else {
            "—"
        }
        return "نجاح ${stats.successes} • فشل ${stats.failures} • ${stats.reliabilityPercent}% • متوسط $average"
    }

    private fun formatNumber(value: Int): String =
        String.format(Locale.US, "%,d", value)

    private fun formatTime(value: Long): String =
        if (value <= 0L) {
            "—"
        } else {
            DateFormat.getDateTimeInstance(
                DateFormat.MEDIUM,
                DateFormat.SHORT
            ).format(Date(value))
        }

    private fun dp(value: Int) =
        (value * resources.displayMetrics.density).toInt()

    private data class StatusRow(
        val label: String,
        val value: String
    )

    private data class NetworkState(
        val connected: Boolean,
        val label: String
    )

    private data class StatusSnapshot(
        val provider: ProviderEntity?,
        val activationText: String,
        val activationCheckedAt: Long,
        val liveCount: Int,
        val movieCount: Int,
        val seriesCount: Int,
        val catalogReady: Boolean,
        val lastCatalogUpdateAt: Long,
        val storage: LocalStorageManager.StorageStats,
        val playback: PlaybackIntelligence.Snapshot?,
        val zapping: SmartZappingCache.ProviderStatus?,
        val network: NetworkState,
        val profile: ProfileStore.Profile
    )
}
