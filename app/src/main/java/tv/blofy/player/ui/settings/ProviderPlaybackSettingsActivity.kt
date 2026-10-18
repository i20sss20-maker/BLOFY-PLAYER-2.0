package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.playback.PlaybackSourceProbe
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Local, per-provider playback preferences.
 * Never touches credentials, activation, watch history, favorites or cached catalog.
 * All source tests are explicit opt-in and show only credential-free outcomes.
 */
class ProviderPlaybackSettingsActivity : AppCompatActivity() {
    private var selectedProvider: ProviderEntity? = null
    private lateinit var heading: TextView
    private lateinit var status: TextView
    private lateinit var formatButton: Button
    private lateinit var transportButton: Button
    private lateinit var testButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val narrow = resources.configuration.screenWidthDp < 600
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@ProviderPlaybackSettingsActivity, R.drawable.blofy_home_background)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP or Gravity.RIGHT
            setPadding(dp(if (narrow) 18 else 65), dp(28), dp(if (narrow) 18 else 65), dp(28))
        }
        scroll.addView(body)
        body.addView(label("إعدادات تشغيل القائمة", if (narrow) 25f else 31f, true))
        body.addView(label(
            "غيّر الصيغة أو طريقة الاتصال عند تعطل التشغيل، دون مسح القوائم أو تسجيل الدخول من جديد.",
            15f
        ), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(12)
        })
        heading = label("جاري قراءة القائمة النشطة…", 17f, true)
        body.addView(heading, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(65)).apply { topMargin = dp(14) })
        val choose = action("▤  اختيار قائمة أخرى") { chooseProvider() }
        body.addView(choose, layout().apply { bottomMargin = dp(12) })
        formatButton = action("") { chooseFormat() }
        body.addView(formatButton, layout().apply { bottomMargin = dp(10) })
        transportButton = action("") { chooseTransport() }
        body.addView(transportButton, layout().apply { bottomMargin = dp(10) })
        testButton = action("⌕  اختبار اتصال قناة من القائمة") { testSource() }
        body.addView(testButton, layout().apply { bottomMargin = dp(10) })
        body.addView(label("الفحص يختبر استجابة المصدر فقط، ولا يضمن تشغيل الترميز أو توفر الحقوق. قد يستخدم اتصال بيانات إضافيًا.", 13f))
        status = label("جارٍ التحميل…", 14f)
        body.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(16)
            bottomMargin = dp(18)
        })
        body.addView(action("↩  رجوع") { finish() }, layout())
        setContentView(scroll)
        refreshButtons()
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val requestedId = intent.getStringExtra(EXTRA_PROVIDER_ID)?.takeIf { it.isNotBlank() }
            selectedProvider = withContext(Dispatchers.IO) {
                requestedId?.let { dao.provider(it) } ?: dao.providers().first().firstOrNull()
                    ?: dao.allProviders().first().firstOrNull()
            }
            status.text = if (selectedProvider == null) "لا توجد قائمة. أضف Xtream أو M3U أولًا." else "الخيارات محفوظة على هذا الجهاز فقط."
            refreshButtons()
        }
    }

    private fun chooseProvider() {
        lifecycleScope.launch {
            val providers = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().allProviders().first() }
            if (providers.isEmpty()) { status.text = "لا توجد قوائم محفوظة"; return@launch }
            AlertDialog.Builder(this@ProviderPlaybackSettingsActivity)
                .setTitle("اختر القائمة")
                .setItems(providers.map { it.name }.toTypedArray()) { dialog, index ->
                    selectedProvider = providers[index]
                    status.text = "الخيارات محفوظة على هذا الجهاز فقط."
                    refreshButtons()
                    dialog.dismiss()
                }
                .setNegativeButton("إلغاء", null)
                .show()
        }
    }

    private fun chooseFormat() {
        val item = selectedProvider ?: return
        if (item.providerType.equals("m3u", true)) {
            status.text = "قوائم M3U تستخدم صيغة الرابط الأصلية. لا حاجة لتبديل TS/HLS."
            return
        }
        val formats = listOf("ts", "m3u8")
        AlertDialog.Builder(this).setTitle("صيغة البث المباشر")
            .setSingleChoiceItems(arrayOf("TS — عادةً للقنوات", "HLS — صيغة M3U8"),
                formats.indexOf(item.liveFormat).coerceAtLeast(0)) { dialog, index ->
                save(item.id, liveFormat = formats[index], transport = null)
                dialog.dismiss()
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun chooseTransport() {
        val item = selectedProvider ?: return
        val transports = listOf("cronet", "http")
        AlertDialog.Builder(this).setTitle("طريقة الاتصال بمصدر الفيديو")
            .setSingleChoiceItems(arrayOf("Cronet — تلقائي", "HTTP — الوضع الأكثر توافقًا"),
                transports.indexOf(item.preferredTransport).coerceAtLeast(0)) { dialog, index ->
                save(item.id, liveFormat = null, transport = transports[index])
                dialog.dismiss()
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun save(providerId: String, liveFormat: String?, transport: String?) {
        status.text = "جارٍ حفظ خيارات التشغيل…"
        lifecycleScope.launch {
            try {
                val updated = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    val current = dao.provider(providerId) ?: return@withContext null
                    // Targeted UPDATE, not REPLACE: avoid touching activation, metadata or catalog.
                    dao.updateProviderPlaybackOptions(
                        providerId,
                        liveFormat ?: current.liveFormat,
                        transport ?: current.preferredTransport
                    )
                    dao.provider(providerId)
                }
                if (updated == null) {
                    status.text = "لم تعد هذه القائمة موجودة."
                } else {
                    if (selectedProvider?.id == providerId) selectedProvider = updated
                    status.text = "✓ تم الحفظ. ارجع للقائمة وافتح الفيديو مجددًا لتجربة الإعداد."
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status.text = "تعذر حفظ الإعداد. حاول مرة أخرى." }
            refreshButtons()
        }
    }

    private fun testSource() {
        val item = selectedProvider ?: return
        testButton.isEnabled = false
        status.text = "جاري فحص مصدر من القائمة المحددة…"
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    val latest = dao.provider(item.id) ?: return@withContext "القائمة لم تعد موجودة"
                    val stream = dao.sampleLiveStream(latest.id)
                        ?: return@withContext "القائمة لا تحتوي قنوات بث مباشر؛ جرّب فيلمًا من المشغل."
                    val format = if (latest.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS
                    val url = ContentUrlResolver.live(latest, ProviderProfile(latest.id, liveFormat = format), stream)
                    PlaybackSourceProbe.inspect(url)
                }
                if (selectedProvider?.id == item.id && !isFinishing) status.text = result
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                if (selectedProvider?.id == item.id) status.text = "تعذر إجراء الفحص. تأكد من اتصال الجهاز."
            } finally {
                testButton.isEnabled = selectedProvider != null
            }
        }
    }

    private fun refreshButtons() {
        val item = selectedProvider
        if (!::formatButton.isInitialized || !::transportButton.isInitialized || !::testButton.isInitialized) return
        heading.text = item?.name ?: "لا توجد قائمة محددة"
        formatButton.text = "صيغة القنوات\n" + if (item == null) "—" else if (item.providerType.equals("m3u", true)) "حسب المصدر (M3U)" else if (item.liveFormat.equals("m3u8", true)) "HLS / M3U8" else "TS"
        transportButton.text = "طريقة اتصال الفيديو\n" + if (item?.preferredTransport.equals("http", true)) "HTTP (الأكثر توافقًا)" else "Cronet (تلقائي)"
        formatButton.isEnabled = item != null && !item.providerType.equals("m3u", true)
        transportButton.isEnabled = item != null
        testButton.isEnabled = item != null
    }

    private fun label(content: String, size: Float, title: Boolean = false) = TextView(this).apply {
        text = content
        textSize = size
        typeface = if (title) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
        setTextColor(if (title) BlofyTvDesign.TextPrimary else BlofyTvDesign.TextSecondary)
        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
    }

    private fun action(content: String, onClick: () -> Unit) = Button(this).apply {
        text = content
        textSize = 15f
        isAllCaps = false
        setTextColor(BlofyTvDesign.TextPrimary)
        BlofyTvDesign.installTvFocus(this, dp(19).toFloat(), 1.025f, false)
        setOnClickListener { onClick() }
    }

    private fun layout() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68))
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
    }
}
