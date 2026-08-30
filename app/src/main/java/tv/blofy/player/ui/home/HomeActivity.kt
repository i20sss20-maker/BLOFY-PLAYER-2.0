package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class HomeActivity : AppCompatActivity() {
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        val phone = deviceKind == DeviceClass.Kind.PHONE

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) 24 else 62, if (phone) 24 else 46, if (phone) 24 else 62, if (phone) 24 else 46)
            setBackgroundColor(theme.background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = if (phone) 26f else 32f
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = if (theme.id == "cinema") "BLOFY CINEMA" else "كل محتواك. أسرع. أبسط."
            textSize = 15f
            setTextColor(theme.accent)
            setPadding(0, 4, 0, if (phone) 20 else 30)
        })

        val primary = actionRow(phone)
        addAction(primary, "البث المباشر", Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_LIVE))
        addAction(primary, "الأفلام", Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_MOVIE))
        addAction(primary, "المسلسلات", Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_SERIES))
        addAction(primary, "البحث", Intent(this, SearchActivity::class.java))
        root.addView(primary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val secondary = actionRow(phone).apply { setPadding(0, if (phone) 8 else 16, 0, 0) }
        addAction(secondary, "آخر القنوات", Intent(this, RecentChannelsActivity::class.java))
        addAction(secondary, "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addAction(secondary, "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addAction(secondary, "الإعدادات", Intent(this, SettingsActivity::class.java))
        root.addView(secondary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        setContentView(root)
        if (deviceKind == DeviceClass.Kind.TV) primary.getChildAt(0)?.requestFocus()
    }

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply {
        orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
    }

    private fun addAction(row: LinearLayout, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val tv = deviceKind == DeviceClass.Kind.TV
        val button = Button(this).apply {
            text = label
            isAllCaps = false
            textSize = if (phone) 15f else 16f
            isFocusable = tv
            isFocusableInTouchMode = tv
            setTextColor(Color.WHITE)
            setPadding(20, 0, 20, 0)
            background = tile(false)
            setOnFocusChangeListener { view, focused ->
                if (!tv) return@setOnFocusChangeListener
                view.background = tile(focused)
                view.animate().scaleX(if (focused) theme.focusScale else 1f).scaleY(if (focused) theme.focusScale else 1f).setDuration(theme.motionMs).start()
            }
            setOnClickListener { startActivity(intent) }
        }
        val params = if (phone) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 72).apply { bottomMargin = 8 }
        } else {
            LinearLayout.LayoutParams(0, 112, 1f).apply { marginEnd = 14 }
        }
        row.addView(button, params)
    }

    private fun tile(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 22f
        setColor(if (focused) blend(theme.surface, theme.accent, 0.34f) else theme.surface)
        setStroke(if (focused) 3 else 1, if (focused) theme.accent else blend(theme.surface, Color.WHITE, 0.12f))
    }

    private fun blend(a: Int, b: Int, ratio: Float): Int {
        val r = (Color.red(a) * (1f - ratio) + Color.red(b) * ratio).toInt()
        val g = (Color.green(a) * (1f - ratio) + Color.green(b) * ratio).toInt()
        val bl = (Color.blue(a) * (1f - ratio) + Color.blue(b) * ratio).toInt()
        return Color.rgb(r, g, bl)
    }
}
