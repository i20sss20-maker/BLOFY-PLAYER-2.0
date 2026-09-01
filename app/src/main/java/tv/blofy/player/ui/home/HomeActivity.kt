package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.playlist.ProviderManagerActivity
import tv.blofy.player.ui.settings.SettingsActivity

/** TV home composition transplanted from v339 SevenMaxActivity.showHome(). */
class HomeActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = V339Ui.BLACK
        window.navigationBarColor = V339Ui.BLACK
        setContentView(buildV339Home())
    }

    private fun buildV339Home(): LinearLayout {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(34), dp(20), dp(34), dp(20))
            background = V339Ui.screenGradient()
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        header.addView(brand("P L A Y E R"), LinearLayout.LayoutParams(dp(260), dp(64)))
        header.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        val account = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        account.addView(V339Ui.text(this, "●  قائمة التشغيل متصلة", 12f, V339Ui.SUCCESS).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(dp(360), dp(28)))
        account.addView(V339Ui.text(this, "BLOFY PLAYER", 11f, V339Ui.MUTED).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(dp(360), dp(26)))
        header.addView(account, LinearLayout.LayoutParams(dp(380), dp(62)))
        page.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(72)))

        val launchers = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }

        val availableWidth = maxOf(820, (resources.displayMetrics.widthPixels / resources.displayMetrics.density).toInt() - 68)
        val liveWidth = minOf(330, maxOf(250, availableWidth * 29 / 100))
        val systemWidth = minOf(264, maxOf(200, availableWidth * 23 / 100))
        val mediaWidth = minOf(452, maxOf(338, availableWidth - liveWidth - systemWidth - 32))

        val live = homeTile("◉", "بث مباشر", true) {
            startActivity(Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, "live"))
        }
        launchers.addView(live, LinearLayout.LayoutParams(dp(liveWidth), dp(292)).apply { marginEnd = dp(16) })

        val media = GridLayout(this).apply {
            columnCount = 2
            rowCount = 2
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
        }
        val mediaTileWidth = maxOf(160, (mediaWidth - 16) / 2)
        val movies = homeTile("●", "الأفلام", false) {
            startActivity(Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, "movie"))
        }
        val series = homeTile("▣", "المسلسلات", false) {
            startActivity(Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, "series"))
        }
        val sports = homeTile("⚽", "الرياضة", false) {
            startActivity(Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, "live"))
        }
        val playlists = homeTile("▤", "تغيير قائمة التشغيل", false) {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        }
        addHomeGridTile(media, movies, mediaTileWidth)
        addHomeGridTile(media, series, mediaTileWidth)
        addHomeGridTile(media, sports, mediaTileWidth)
        addHomeGridTile(media, playlists, mediaTileWidth)
        launchers.addView(media, LinearLayout.LayoutParams(dp(mediaWidth), dp(292)))

        val system = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        launchers.addView(system, LinearLayout.LayoutParams(dp(systemWidth), dp(292)).apply { marginStart = dp(16) })
        val settings = homeTile("⚙", "الإعدادات", false) {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        val refresh = homeTile("↻", "تحديث القائمة", false) {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        }
        val exit = homeTile("↪", "خروج", false) { finishAffinity() }
        addSystemTile(system, settings)
        addSystemTile(system, refresh)
        addSystemTile(system, exit)
        linkHomeFocus(live, movies, series, sports, playlists, settings, refresh, exit)

        page.addView(launchers, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        footer.addView(V339Ui.text(this, "BLOFY PLAYER", 11f, V339Ui.PURPLE_LIGHT).apply {
            textDirection = View.TEXT_DIRECTION_LTR
        }, LinearLayout.LayoutParams(dp(250), dp(42)))
        footer.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        footer.addView(V339Ui.text(this, "BLOFY", 11f, V339Ui.MUTED).apply {
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(dp(560), dp(42)))
        page.addView(footer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))

        live.requestFocus()
        return page
    }

    private fun homeTile(icon: String, label: String, primary: Boolean, action: () -> Unit): TextView {
        return V339Ui.title(this, "$icon\n$label", if (primary) 25f else 18f).apply {
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_RTL
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            setPadding(dp(14), dp(12), dp(14), dp(12))
            val normal = if (primary) Color.rgb(64, 29, 112) else Color.rgb(28, 25, 43)
            val focused = if (primary) Color.rgb(119, 42, 210) else Color.rgb(88, 39, 151)
            background = V339Ui.focusDrawable(this@HomeActivity, normal, focused, V339Ui.PURPLE_LIGHT)
            setOnClickListener { action() }
            setOnFocusChangeListener { view, hasFocus ->
                view.animate().scaleX(if (hasFocus) 1.025f else 1f).scaleY(if (hasFocus) 1.025f else 1f).setDuration(110L).start()
            }
        }
    }

    private fun addHomeGridTile(grid: GridLayout, tile: TextView, tileWidth: Int) {
        grid.addView(tile, GridLayout.LayoutParams().apply {
            width = dp(tileWidth)
            height = dp(138)
            setMargins(dp(4), dp(4), dp(4), dp(4))
        })
    }

    private fun addSystemTile(column: LinearLayout, tile: TextView) {
        column.addView(tile, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply {
            setMargins(0, dp(4), 0, dp(4))
        })
    }

    private fun linkHomeFocus(live: View, movies: View, series: View, sports: View, playlists: View,
                              settings: View, refresh: View, exit: View) {
        val views = listOf(live, movies, series, sports, playlists, settings, refresh, exit)
        views.forEach { it.id = View.generateViewId() }
        live.nextFocusRightId = live.id; live.nextFocusLeftId = movies.id
        movies.nextFocusRightId = live.id; movies.nextFocusLeftId = settings.id; movies.nextFocusDownId = sports.id
        series.nextFocusRightId = live.id; series.nextFocusLeftId = settings.id; series.nextFocusDownId = playlists.id
        sports.nextFocusUpId = movies.id; sports.nextFocusRightId = live.id; sports.nextFocusLeftId = refresh.id
        playlists.nextFocusUpId = series.id; playlists.nextFocusRightId = live.id; playlists.nextFocusLeftId = exit.id
        settings.nextFocusRightId = movies.id; settings.nextFocusDownId = refresh.id
        refresh.nextFocusUpId = settings.id; refresh.nextFocusRightId = sports.id; refresh.nextFocusDownId = exit.id
        exit.nextFocusUpId = refresh.id; exit.nextFocusRightId = playlists.id
    }

    private fun brand(subtitle: String): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        val logo = android.widget.ImageView(this).apply {
            setImageResource(tv.blofy.player.R.drawable.blofy_logo)
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        }
        row.addView(logo, LinearLayout.LayoutParams(dp(50), dp(50)))
        val labels = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(9), 0, 0, 0)
        }
        labels.addView(V339Ui.title(this, "BLOFY", 18f).apply {
            textDirection = View.TEXT_DIRECTION_LTR; gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
        })
        labels.addView(V339Ui.text(this, subtitle, 9f, V339Ui.PURPLE_LIGHT).apply {
            textDirection = View.TEXT_DIRECTION_LTR; gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
        })
        row.addView(labels, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return row
    }

    private fun dp(value: Int) = V339Ui.dp(this, value)
}
