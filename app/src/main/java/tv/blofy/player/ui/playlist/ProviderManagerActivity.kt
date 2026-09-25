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
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.CatalogLoadingActivity

class ProviderManagerActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var addButton: Button
    private val focusButtons = linkedMapOf<String, Button>()
    private val isTv by lazy { DeviceClass.isTv(this) }
    private val isPhone by lazy { DeviceClass.detect(this) == DeviceClass.Kind.PHONE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(if (isPhone) dp(20) else dp(58), if (isPhone) dp(20) else dp(34), if (isPhone) dp(20) else dp(58), if (isPhone) dp(20) else dp(34))
            background = AppCompatResources.getDrawable(this@ProviderManagerActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        root.addView(TextView(this).apply {
            text = "إدارة قوائم BLOFY"
            BlofyTvDesign.applyTitle(this)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "اتصل مباشرة بالقائمة المحفوظة أو عدّل بياناتها"
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
        addButton = actionButton("add", "+  Xtream / M3U") {
            startActivity(Intent(this, PlaylistActivity::class.java).putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true))
        }
        if (isPhone) {
            actions.addView(subscriberButton, LinearLayout.LayoutParams(0, dp(60), 1f).apply { marginStart = dp(8) })
            actions.addView(addButton, LinearLayout.LayoutParams(0, dp(60), 1f))
            root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(68)).apply {
                bottomMargin = dp(14)
            })
        } else {
            actions.addView(subscriberButton, LinearLayout.LayoutParams(dp(310), dp(64)).apply { marginStart = dp(12) })
            actions.addView(addButton, LinearLayout.LayoutParams(dp(270), dp(64)))
            root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(70)).apply {
                bottomMargin = dp(18); gravity = Gravity.RIGHT
            })
        }

        root.addView(TextView(this).apply {
            text = "القوائم المحفوظة"
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
            val dao = BlofyDatabase.get(applicationContext).dao()
            dao.allProviders().collect { providers ->
                val readiness = withContext(Dispatchers.IO) {
                    providers.associate { provider ->
                        provider.id to (
                            CatalogSyncState.isReady(applicationContext, provider.id) &&
                                dao.hasStreamsForProvider(provider.id)
                            )
                    }
                }
                render(providers, readiness)
            }
        }
    }

    private fun render(items: List<ProviderEntity>, readiness: Map<String, Boolean>) {
        focusButtons.keys.filter { it !in setOf("add", "subscriber") }.toList().forEach { focusButtons.remove(it) }
        list.removeAllViews()
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "ما عندك قوائم محفوظة حتى الآن\nأضف مشترك BLOFY أو Xtream / M3U"
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
                orientation = if (isPhone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(if (isPhone) 14 else 18), dp(if (isPhone) 10 else 10), dp(if (isPhone) 14 else 18), dp(if (isPhone) 10 else 10))
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
                textSize = if (isPhone) 16f else 18f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                gravity = Gravity.RIGHT
                setTextColor(Color.WHITE)
                maxLines = 1
            })
            info.addView(TextView(this).apply {
                text = buildString {
                    append(if (provider.enabled) "● القائمة النشطة" else "○ قائمة محفوظة")
                    append("  •  ")
                    append(if (provider.name == "مشتركين BLOFY") "BLOFY Secure" else provider.providerType.uppercase())
                }
                textSize = 13f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.RIGHT
                setTextColor(if (provider.enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
            })
            info.addView(TextView(this).apply {
                val ready = readiness[provider.id] == true
                text = if (ready) "✓ جاهزة محليًا" else "↻ تحتاج تحميل أو تحديث"
                textSize = 12.5f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.RIGHT
                setTextColor(if (ready) 0xFF79E1BA.toInt() else 0xFFE3B86D.toInt())
                setPadding(0, dp(3), 0, 0)
            })

            if (isPhone) {
                row.addView(info, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)))
                val phoneActions = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutDirection = View.LAYOUT_DIRECTION_RTL
                    gravity = Gravity.CENTER
                }
                phoneActions.addView(actionButton("${provider.id}:connect", "اتصال", primary = true) { connect(provider) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(5) })
                phoneActions.addView(actionButton("${provider.id}:edit", "تعديل") { edit(provider) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(5) })
                phoneActions.addView(actionButton("${provider.id}:refresh", "مزامنة") { refresh(provider) }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(5) })
                phoneActions.addView(actionButton("${provider.id}:delete", "حذف") { remove(provider) }, LinearLayout.LayoutParams(0, dp(50), 1f))
                row.addView(phoneActions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(5) })
                list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(146)).apply { bottomMargin = dp(9) })
            } else {
                row.addView(info, LinearLayout.LayoutParams(0, dp(72), 1f))
                row.addView(actionButton("${provider.id}:connect", "▶  اتصال", primary = true) { connect(provider) }, LinearLayout.LayoutParams(dp(140), dp(56)).apply { marginStart = dp(8) })
                row.addView(actionButton("${provider.id}:edit", "تعديل") { edit(provider) }, LinearLayout.LayoutParams(dp(116), dp(56)).apply { marginStart = dp(8) })
                row.addView(actionButton("${provider.id}:refresh", "مزامنة") { refresh(provider) }, LinearLayout.LayoutParams(dp(120), dp(56)).apply { marginStart = dp(8) })
                row.addView(actionButton("${provider.id}:delete", "حذف") { remove(provider) }, LinearLayout.LayoutParams(dp(104), dp(56)))
                list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(96)).apply { bottomMargin = dp(9) })
            }
        }
        restoreFocus()
    }

    private fun restoreFocus() {
        if (!isTv) return
        val key = FocusMemory.restore(this, SCREEN_KEY)
        val target = key?.let(focusButtons::get)
            ?: focusButtons.entries.firstOrNull { it.key.endsWith(":connect") }?.value
            ?: focusButtons["subscriber"]
            ?: addButton
        target.post { if (!isFinishing) target.requestFocus() }
    }

    private fun connect(provider: ProviderEntity) {
        status.text = "جاري فتح ${provider.name}..."
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            withContext(Dispatchers.IO) {
                dao.disableAllProviders()
                dao.activateProvider(provider.id)
            }
            val cached = withContext(Dispatchers.IO) {
                CatalogSyncState.isReady(applicationContext, provider.id) && dao.hasStreamsForProvider(provider.id)
            }
            if (cached) {
                startActivity(Intent(this@ProviderManagerActivity, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
            } else {
                startActivity(Intent(this@ProviderManagerActivity, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id))
            }
        }
    }

    private fun edit(provider: ProviderEntity) {
        if (provider.name == "مشتركين BLOFY" && provider.baseUrl.contains("/api/v1/subscribers/xtream")) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java))
            return
        }
        startActivity(Intent(this, PlaylistActivity::class.java).apply {
            putExtra(PlaylistActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true)
        })
    }

    private fun refresh(provider: ProviderEntity) {
        status.text = "فتح التحديث الآمن لـ ${provider.name}..."
        startActivity(Intent(this, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id)
        })
    }

    private fun remove(provider: ProviderEntity) {
        AlertDialog.Builder(this)
            .setTitle("حذف القائمة؟")
            .setMessage("سيتم حذف «${provider.name}» من هذا الجهاز. التفعيل وبقية القوائم لن تتأثر.")
            .setPositiveButton("حذف") { _, _ -> removeConfirmed(provider) }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun removeConfirmed(provider: ProviderEntity) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            dao.deleteProvider(provider.id)
            if (provider.enabled) {
                val next = dao.allProviders().first().firstOrNull()
                if (next != null) dao.activateProvider(next.id)
            }
            status.text = "تم حذف ${provider.name}"
        }
    }

    private fun actionButton(key: String, label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        stateListAnimator = null
        BlofyTvDesign.installTvFocus(this, dp(17).toFloat(), 1.04f, primary) {
            if (isTv) FocusMemory.save(this@ProviderManagerActivity, SCREEN_KEY, key)
        }
        setOnClickListener { action() }
        focusButtons[key] = this
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object { private const val SCREEN_KEY = "provider_manager" }
}
