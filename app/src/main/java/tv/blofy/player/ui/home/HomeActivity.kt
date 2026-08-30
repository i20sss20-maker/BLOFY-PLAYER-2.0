package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class HomeActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(56, 44, 56, 44)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER 2.0"
            textSize = 30f
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = "الرئيسية"
            textSize = 16f
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(0, 4, 0, 28)
        })

        val primary = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        addAction(primary, "البث المباشر", Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_LIVE))
        addAction(primary, "الأفلام", Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_MOVIE))
        addAction(primary, "المسلسلات", Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, ContentBrowserActivity.KIND_SERIES))
        addAction(primary, "البحث", Intent(this, SearchActivity::class.java))
        root.addView(primary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val secondary = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 14, 0, 0)
        }
        addAction(secondary, "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addAction(secondary, "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addAction(secondary, "الإعدادات", Intent(this, SettingsActivity::class.java))
        root.addView(secondary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        setContentView(root)
        primary.getChildAt(0)?.requestFocus()
    }

    private fun addAction(row: LinearLayout, label: String, intent: Intent) {
        row.addView(Button(this).apply {
            text = label
            isAllCaps = false
            isFocusable = true
            setOnClickListener { startActivity(intent) }
        }, LinearLayout.LayoutParams(0, 110, 1f).apply { marginEnd = 14 })
    }
}
