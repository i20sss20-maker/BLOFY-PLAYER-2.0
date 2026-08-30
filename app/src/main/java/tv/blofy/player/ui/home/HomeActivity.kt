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
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.mobile.MobileContentActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class HomeActivity : AppCompatActivity() {
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind
    private var firstAction: Button? = null
    private val actionButtons = linkedMapOf<String, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        val root = if (theme.id == "cinema" && deviceKind == DeviceClass.Kind.TV) buildCinemaTvHome() else buildVisionHome()
        setContentView(root)
        restoreFocus()
    }

    private fun buildVisionHome(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) 24 else 62, if (phone) 24 else 46, if (phone) 24 else 62, if (phone) 24 else 46)
            setBackgroundColor(theme.background)
        }
        root.addView(title("BLOFY PLAYER", if (phone) 26f else 32f))
        root.addView(subtitle("كل محتواك. أسرع. أبسط.", if (phone) 20 else 30))

        val primary = actionRow(phone)
        addAction(primary, "live", "البث المباشر", contentIntent("live"))
        addAction(primary, "movies", "الأفلام", contentIntent("movie"))
        addAction(primary, "series", "المسلسلات", contentIntent("series"))
        addAction(primary, "search", "البحث", Intent(this, SearchActivity::class.java))
        root.addView(primary)

        val secondary = actionRow(phone).apply { setPadding(0, if (phone) 8 else 16, 0, 0) }
        addAction(secondary, "recent", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java))
        addAction(secondary, "continue", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addAction(secondary, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addAction(secondary, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java))
        root.addView(secondary)
        return root
    }

    private fun buildCinemaTvHome(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(46, 38, 46, 38)
            setBackgroundColor(theme.background)
        }
        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 24, 0)
        }
        rail.addView(title("BLOFY", 34f))
        rail.addView(subtitle("CINEMA", 24))
        addRailAction(rail, "live", "LIVE", contentIntent("live"))
        addRailAction(rail, "movies", "MOVIES", contentIntent("movie"))
        addRailAction(rail, "series", "SERIES", contentIntent("series"))
        addRailAction(rail, "search", "SEARCH", Intent(this, SearchActivity::class.java))
        root.addView(rail, LinearLayout.LayoutParams(300, LinearLayout.LayoutParams.MATCH_PARENT))

        val stage = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(34, 20, 10, 20)
            background = GradientDrawable().apply {
                cornerRadius = 30f
                setColor(theme.surface)
                setStroke(1, blend(theme.surface, Color.WHITE, 0.10f))
            }
        }
        stage.addView(title("BLOFY CINEMA", 38f))
        stage.addView(TextView(this).apply {
            text = "واجهة سينمائية مستقلة • تنقل سريع بالريموت"
            textSize = 16f
            setTextColor(theme.accent)
            setPadding(0, 8, 0, 28)
        })
        val library = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        addAction(library, "recent", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java), 124)
        addAction(library, "continue", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE), 124)
        addAction(library, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES), 124)
        stage.addView(library, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val utility = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, 18, 0, 0) }
        addAction(utility, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java), 92)
        stage.addView(utility)
        root.addView(stage, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        return root
    }

    private fun contentIntent(kind: String): Intent = if (deviceKind == DeviceClass.Kind.TV) {
        Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
    } else {
        Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)
    }

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply { orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL }

    private fun addRailAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val button = makeButton(key, label, intent)
        row.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 72).apply { topMargin = 10 })
    }

    private fun addAction(row: LinearLayout, key: String, label: String, intent: Intent, height: Int? = null) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val button = makeButton(key, label, intent)
        val params = if (phone) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, height ?: 72).apply { bottomMargin = 8 }
        } else {
            LinearLayout.LayoutParams(0, height ?: 112, 1f).apply { marginEnd = 14 }
        }
        row.addView(button, params)
    }

    private fun makeButton(key: String, label: String, intent: Intent) = Button(this).apply {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label
        isAllCaps = false
        textSize = if (phone) 15f else 16f
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        setPadding(18, 0, 18, 0)
        background = tile(false)
        setOnFocusChangeListener { view, focused ->
            if (!tv) return@setOnFocusChangeListener
            view.background = tile(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) theme.focusScale else 1f).scaleY(if (focused) theme.focusScale else 1f).setDuration(theme.motionMs).start()
        }
        setOnClickListener {
            if (tv) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            startActivity(intent)
        }
        actionButtons[key] = this
        if (firstAction == null) firstAction = this
    }

    private fun restoreFocus() {
        if (deviceKind != DeviceClass.Kind.TV) return
        val saved = FocusMemory.restore(this, SCREEN_KEY)
        (saved?.let { actionButtons[it] } ?: firstAction)?.requestFocus()
    }

    private fun title(textValue: String, size: Float) = TextView(this).apply { text = textValue; textSize = size; setTextColor(Color.WHITE) }
    private fun subtitle(textValue: String, bottom: Int) = TextView(this).apply { text = textValue; textSize = 15f; setTextColor(theme.accent); setPadding(0, 4, 0, bottom) }
    private fun tile(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = if (theme.id == "cinema") 16f else 22f
        setColor(if (focused) blend(theme.surface, theme.accent, 0.34f) else theme.surface)
        setStroke(if (focused) 3 else 1, if (focused) theme.accent else blend(theme.surface, Color.WHITE, 0.12f))
    }
    private fun blend(a: Int, b: Int, ratio: Float): Int {
        val r = (Color.red(a) * (1f - ratio) + Color.red(b) * ratio).toInt()
        val g = (Color.green(a) * (1f - ratio) + Color.green(b) * ratio).toInt()
        val bl = (Color.blue(a) * (1f - ratio) + Color.blue(b) * ratio).toInt()
        return Color.rgb(r, g, bl)
    }

    companion object { private const val SCREEN_KEY = "home" }
}
