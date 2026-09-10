package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.CatalogLoadingActivity
import java.util.UUID

class ProviderManagerActivity : AppCompatActivity() {
    internal var activationEndpoint: String = BuildConfig.ACTIVATION_BASE_URL.trim()
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var addButton: Button
    private lateinit var websiteRefreshButton: Button
    private var refreshingFromWebsite = false
    private var changingProvider = false
    private val focusButtons = linkedMapOf<String, Button>()
    private val isTv by lazy { DeviceClass.isTv(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(58), dp(34), dp(58), dp(34))
            background = AppCompatResources.getDrawable(this@ProviderManagerActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
        }
        val title = TextView(this).apply {
            text = "قوائم BLOFY"
            BlofyTvDesign.applyTitle(this)
            gravity = Gravity.RIGHT
        }
        header.addView(title, if (isTv) LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            else LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        websiteRefreshButton = actionButton("website_refresh", "↻  تحديث من الموقع") { refreshFromWebsite() }
        header.addView(websiteRefreshButton, LinearLayout.LayoutParams(if (isTv) dp(250) else LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
            if (isTv) marginStart = dp(16) else topMargin = dp(10)
        })
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(TextView(this).apply {
            text = "اتصل مباشرة بالسيرفر المحفوظ أو عدّل بياناته"
            textSize = 16f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, 0)
        })
        status = TextView(this).apply {
            text = "مشتركين BLOFY يحتاج اسم المستخدم وكلمة المرور فقط"
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(14), 0, dp(14), 0)
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        root.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
            topMargin = dp(14); bottomMargin = dp(18)
        })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
            clipChildren = false
        }
        val subscriberButton = actionButton("subscriber", "+  مشتركين BLOFY", primary = true) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java))
        }
        addButton = actionButton("add", "+  Xtream") {
            startActivity(Intent(this, PlaylistActivity::class.java).putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true))
        }
        actions.addView(subscriberButton, LinearLayout.LayoutParams(dp(310), dp(64)).apply { marginStart = dp(12) })
        actions.addView(addButton, LinearLayout.LayoutParams(dp(270), dp(64)))
        root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(70)).apply {
            bottomMargin = dp(18); gravity = Gravity.RIGHT
        })

        root.addView(TextView(this).apply {
            text = "السيرفرات المحفوظة"
            textSize = 20f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)))

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(8), 0, dp(12))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().allProviders().collect { render(it) }
        }
    }

    private fun refreshFromWebsite() {
        if (refreshingFromWebsite || changingProvider) return
        val endpoint = activationEndpoint
        if (endpoint.isBlank()) {
            status.text = "خدمة تحديث القوائم غير مهيأة"
            return
        }
        refreshingFromWebsite = true
        focusButtons.values.forEach { it.isEnabled = false }
        websiteRefreshButton.text = "جاري التحديث..."
        status.text = "جاري جلب القوائم وبياناتها من الموقع..."
        lifecycleScope.launch {
            try {
                val result = withTimeout(20_000L) {
                    withContext(Dispatchers.IO) {
                        val dao = BlofyDatabase.get(applicationContext).dao()
                        val activation = ActivationManager(applicationContext, dao)
                        if (!activation.cachedCanUse(activation.ensureIdentity())) {
                            val checked = activation.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                            check(checked.canUse()) { "device_activation_required" }
                        }
                        val synced = PortalPlaylistClient.sync(applicationContext, endpoint, dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
                        synced.changedProviderIds.forEach { CatalogSyncState.markPending(applicationContext, it) }
                        synced
                    }
                }
                status.text = "تم التحديث من الموقع • ${result.remoteCount} قائمة"
            } catch (_: TimeoutCancellationException) {
                status.text = "انتهت مهلة التحديث • قوائمك محفوظة، حاول مرة أخرى"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = "تعذر التحديث من الموقع • تحقق من الاتصال أو ربط الجهاز"
            } finally {
                refreshingFromWebsite = false
                if (!isFinishing && !isDestroyed) {
                    websiteRefreshButton.text = "↻  تحديث من الموقع"
                    focusButtons.values.forEach { it.isEnabled = true }
                    if (isTv && hasWindowFocus()) websiteRefreshButton.requestFocus()
                }
            }
        }
    }

    private fun render(allItems: List<ProviderEntity>) {
        val items = tv.blofy.player.core.identity.PortalSyncBook.visible(this, allItems)
            .filter { it.providerType.equals("xtream", true) || isBlofySubscriber(it) }
        focusButtons.keys.filter { it !in setOf("add", "subscriber", "website_refresh") }.toList().forEach { focusButtons.remove(it) }
        list.removeAllViews()
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "ما عندك سيرفرات محفوظة حتى الآن\nأضف مشترك BLOFY أو Xtream"
                setTextColor(BlofyTvDesign.TextSecondary)
                textSize = 18f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.RIGHT
                setLineSpacing(dp(4).toFloat(), 1.12f)
                setPadding(dp(22), dp(24), dp(22), dp(24))
                background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
            })
            restoreFocus()
            return
        }

        items.forEach { provider ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(18), dp(10), dp(18), dp(10))
                background = if (provider.enabled) BlofyTvDesign.surface(dp(20).toFloat(), true) else BlofyTvDesign.surface(dp(20).toFloat(), false)
                clipChildren = false
            }

            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                layoutDirection = View.LAYOUT_DIRECTION_RTL
            }
            info.addView(TextView(this).apply {
                text = provider.name
                textSize = 18f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                gravity = Gravity.RIGHT
                setTextColor(Color.WHITE)
            })
            info.addView(TextView(this).apply {
                text = buildString {
                    append(if (provider.enabled) "● القائمة النشطة" else "○ قائمة محفوظة")
                    append("  •  ")
                    append(if (isBlofySubscriber(provider)) "BLOFY Secure" else "XTREAM")
                }
                textSize = 13f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.RIGHT
                setTextColor(if (provider.enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
            })
            row.addView(info, LinearLayout.LayoutParams(0, dp(66), 1f))

            row.addView(actionButton("${provider.id}:connect", "▶  اتصال", primary = true) { connect(provider) }, LinearLayout.LayoutParams(dp(140), dp(56)).apply { marginStart = dp(8) })
            row.addView(actionButton("${provider.id}:edit", "تعديل") { edit(provider) }, LinearLayout.LayoutParams(dp(116), dp(56)).apply { marginStart = dp(8) })
            row.addView(actionButton("${provider.id}:refresh", "مزامنة") { refresh(provider) }, LinearLayout.LayoutParams(dp(120), dp(56)).apply { marginStart = dp(8) })
            row.addView(actionButton("${provider.id}:delete", "حذف") { remove(provider) }, LinearLayout.LayoutParams(dp(104), dp(56)))
            list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(90)).apply { bottomMargin = dp(9) })
        }
        restoreFocus()
    }

    private fun restoreFocus() {
        if (!isTv || refreshingFromWebsite || changingProvider) return
        val key = FocusMemory.restore(this, SCREEN_KEY)
        val target = key?.let(focusButtons::get)
            ?: focusButtons.entries.firstOrNull { it.key.endsWith(":connect") }?.value
            ?: focusButtons["subscriber"]
            ?: addButton
        target.post { if (!isFinishing && !refreshingFromWebsite && !changingProvider) target.requestFocus() }
    }

    private fun connect(provider: ProviderEntity) {
        if (changingProvider || refreshingFromWebsite) return
        if (!provider.providerType.equals("xtream", true) && !isBlofySubscriber(provider)) {
            status.text = "هذه القائمة قديمة وغير مدعومة • استخدم Xtream"
            return
        }
        changingProvider = true
        focusButtons.values.forEach { it.isEnabled = false }
        status.text = "جاري فتح ${provider.name}..."
        lifecycleScope.launch {
            try {
                val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
                val selected = PortalPlaylistClient.selectProvider(applicationContext, activationEndpoint, provider, dao)
                val cached = withContext(Dispatchers.IO) {
                    CatalogSyncState.isEntryReady(applicationContext, selected.id) && dao.hasStreamsForProvider(selected.id)
                }
                if (cached) {
                    startActivity(Intent(this@ProviderManagerActivity, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                } else {
                    startActivity(Intent(this@ProviderManagerActivity, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, selected.id))
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = "تعذر فتح القائمة • حاول مرة أخرى"
            } finally {
                changingProvider = false
                focusButtons.values.forEach { it.isEnabled = !refreshingFromWebsite }
            }
        }
    }

    private fun edit(provider: ProviderEntity) {
        if (isBlofySubscriber(provider)) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java).putExtra(PlaylistActivity.EXTRA_PROVIDER_ID, provider.id))
            return
        }
        startActivity(Intent(this, PlaylistActivity::class.java).apply {
            putExtra(PlaylistActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true)
        })
    }

    private fun isBlofySubscriber(provider: ProviderEntity): Boolean {
        val stableId = UUID.nameUUIDFromBytes("blofy-subscriber".toByteArray()).toString()
        return tv.blofy.player.core.identity.BlofySubscriberClient.isManaged(provider) || provider.id == stableId ||
            provider.name.equals("مشتركين BLOFY", ignoreCase = true) ||
            provider.baseUrl.contains("/subscribers/", ignoreCase = true) ||
            provider.baseUrl.contains("/subscriber/", ignoreCase = true)
    }

    private fun refresh(provider: ProviderEntity) {
        if (!provider.providerType.equals("xtream", true) && !isBlofySubscriber(provider)) {
            status.text = "هذه القائمة قديمة وغير مدعومة • استخدم Xtream"
            return
        }
        startActivity(Intent(this, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, true)
        })
    }

    private fun remove(provider: ProviderEntity) {
        if (changingProvider || refreshingFromWebsite) return
        changingProvider = true
        focusButtons.values.forEach { it.isEnabled = false }
        lifecycleScope.launch {
            try {
                val dao = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao() }
                val wasActive = withContext(Dispatchers.IO) { dao.provider(provider.id)?.enabled == true }
                val synced = PortalPlaylistClient.removeProvider(applicationContext, activationEndpoint, provider, dao)
                if (wasActive) {
                    val next = tv.blofy.player.core.identity.PortalSyncBook.visible(applicationContext, dao.allProviders().first())
                        .firstOrNull { it.providerType.equals("xtream", true) || isBlofySubscriber(it) }
                    if (next != null) PortalPlaylistClient.selectProvider(applicationContext, activationEndpoint, next, dao)
                }
                status.text = if (synced) "تم حذف القائمة من الجهاز والموقع" else "تم إخفاء القائمة • سيُستكمل حذفها من الموقع عند الاتصال"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = "تعذر حذف القائمة • حاول مرة أخرى"
            } finally {
                changingProvider = false
                focusButtons.values.forEach { it.isEnabled = !refreshingFromWebsite }
            }
        }
    }

    private fun actionButton(key: String, label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        id = View.generateViewId()
        text = label
        isAllCaps = false
        textSize = 14f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        stateListAnimator = null
        isEnabled = !refreshingFromWebsite && !changingProvider
        BlofyTvDesign.installTvFocus(this, dp(17).toFloat(), 1.04f, primary) {
            if (isTv) FocusMemory.save(this@ProviderManagerActivity, SCREEN_KEY, key)
        }
        setOnClickListener { if (!refreshingFromWebsite && !changingProvider) action() }
        focusButtons[key] = this
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object { private const val SCREEN_KEY = "provider_manager" }
}
