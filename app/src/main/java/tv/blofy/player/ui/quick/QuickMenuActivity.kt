package tv.blofy.player.ui.quick

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.ui.catalog.SmartCollectionsActivity
import tv.blofy.player.ui.guide.LiveGuideActivity
import tv.blofy.player.ui.home.ForYouActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.profile.ProfilesActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.CommercialSettingsActivity
import tv.blofy.player.ui.settings.SettingsActivity

/** Lightweight TV overlay-style hub. It never touches playback/catalog state. */
class QuickMenuActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply { setBackgroundColor(0xC9080710.toInt()) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(22), dp(16), dp(22), dp(16))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF261832.toInt(), 0xFF120D1A.toInt())).apply {
                cornerRadius = dp(22).toFloat()
                setStroke(dp(1), 0xFF68498A.toInt())
            }
            elevation = dp(16).toFloat()
        }
        root.addView(panel, FrameLayout.LayoutParams(dp(400), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        panel.addView(TextView(this).apply {
            text = "BLOFY QUICK MENU"
            textSize = 11.5f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFB574FF.toInt())
            gravity = Gravity.RIGHT
        })
        panel.addView(TextView(this).apply {
            text = "وصول سريع"
            textSize = 26f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(3), 0, dp(10))
        })

        addAction(panel, "✦", "مختار لك", "Smart Home حسب مشاهداتك", Intent(this, ForYouActivity::class.java), true)
        addAction(panel, "▤", "دليل القنوات", "الآن، التالي وتشغيل مباشر", Intent(this, LiveGuideActivity::class.java))
        addAction(panel, "⌕", "البحث الشامل", "قنوات، أفلام، مسلسلات وممثلين", Intent(this, SearchActivity::class.java))
        addAction(panel, "▶", "متابعة المشاهدة", "ارجع لآخر نقطة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addAction(panel, "★", "المفضلة", "اختياراتك المحفوظة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addAction(panel, "◉", "آخر القنوات", "ارجع للبث بسرعة", Intent(this, RecentChannelsActivity::class.java))
        addAction(panel, "◆", "BLOFY Collections", "الأعلى تقييمًا، 4K، عربي والجديد", Intent(this, SmartCollectionsActivity::class.java))
        addAction(panel, "👤", "الملفات والحماية", "الرئيسي، أطفال وPIN", Intent(this, ProfilesActivity::class.java))
        addAction(panel, "◈", "الأداء والاستقرار", "Safe Mode، الصور وFeature Flags", Intent(this, CommercialSettingsActivity::class.java))
        addAction(panel, "⚙", "الإعدادات", "المشغل، المحتوى والتطبيق", Intent(this, SettingsActivity::class.java))

        setContentView(root)
        panel.post { panel.getChildAt(2)?.requestFocus() }
    }

    private fun addAction(parent: LinearLayout, icon: String, title: String, subtitle: String, intent: Intent, primary: Boolean = false) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            setPadding(dp(14), dp(4), dp(14), dp(4))
            background = itemBackground(false, primary)

            addView(TextView(this@QuickMenuActivity).apply {
                text = icon
                textSize = 19f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(0xFFB574FF.toInt())
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(dp(46), dp(46)).apply { marginStart = dp(9) })

            val copy = LinearLayout(this@QuickMenuActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                addView(TextView(this@QuickMenuActivity).apply {
                    text = title
                    textSize = 14.6f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@QuickMenuActivity).apply {
                    text = subtitle
                    textSize = 10.4f
                    setTextColor(0xFFB2A7BE.toInt())
                    gravity = Gravity.RIGHT
                })
            }
            addView(copy, LinearLayout.LayoutParams(0, dp(49), 1f))

            setOnFocusChangeListener { view, focused ->
                view.background = itemBackground(focused, primary)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.014f else 1f).scaleY(if (focused) 1.014f else 1f)
                    .translationZ(if (focused) dp(10).toFloat() else dp(1).toFloat()).setDuration(60).start()
            }
            setOnClickListener { startActivity(intent); finish() }
        }
        parent.addView(row, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(5) })
    }

    private fun itemBackground(focused: Boolean, primary: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            focused -> intArrayOf(0xFF6F3BA7.toInt(), 0xFF392151.toInt())
            primary -> intArrayOf(0xFF38204E.toInt(), 0xFF20142C.toInt())
            else -> intArrayOf(0xE6251933.toInt(), 0xE617101F.toInt())
        }
    ).apply {
        cornerRadius = dp(15).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC897FF.toInt() else 0xFF49345E.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
