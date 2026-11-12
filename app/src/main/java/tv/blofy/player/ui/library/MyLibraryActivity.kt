package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.ForYouActivity

/**
 * One remote-friendly home for existing profile watchlists/favorites/history,
 * new device downloads, and existing catalog-backed recommendations.
 * Does not change the meaning of old favorites or migrate any subscriber data.
 */
class MyLibraryActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            layoutDirection=resources.configuration.layoutDirection
            setPadding(dp(42),dp(28),dp(42),dp(28))
            background=AppCompatResources.getDrawable(this@MyLibraryActivity,R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text="BLOFY  •  MY LIBRARY"
            textSize=12f
            letterSpacing=.1f
            setTextColor(BlofyTvDesign.PurpleBright)
        })
        root.addView(TextView(this).apply {
            text=getString(R.string.stream_library_title)
            textSize=32f
            typeface=BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            setPadding(0,dp(7),0,dp(13))
        })
        root.addView(TextView(this).apply {
            text=getString(R.string.stream_library_subtitle)
            textSize=13f
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0,0,0,dp(20))
        })
        val scroll=ScrollView(this)
        val options=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
        }
        fun add(label:Int, detail:Int,action:()->Unit) {
            val row=Button(this).apply {
                isAllCaps=false
                textSize=15f
                typeface=BlofyTvDesign.BodyTypeface
                gravity=Gravity.CENTER_VERTICAL or Gravity.START
                text=getString(label)+"   •   "+getString(detail)
                CinemaStyle.styleButton(this)
                setOnClickListener { action() }
            }
            options.addView(row,LinearLayout.LayoutParams(-1,dp(78)).apply {
                bottomMargin=dp(11)
            })
        }
        add(R.string.stream_library_downloads,R.string.stream_library_downloads_subtitle) {
            startActivity(Intent(this,DownloadsActivity::class.java))
        }
        add(R.string.home_favorites,R.string.home_favorites_subtitle) {
            startActivity(Intent(this,LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE,LibraryActivity.MODE_FAVORITES))
        }
        add(R.string.home_continue_watching,R.string.home_continue_subtitle) {
            startActivity(Intent(this,LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE,LibraryActivity.MODE_CONTINUE))
        }
        add(R.string.profile_watchlist_title,R.string.profile_watchlist_subtitle_short) {
            startActivity(Intent(this,ProfileWatchlistActivity::class.java))
        }
        add(R.string.stream_library_recommendations,R.string.stream_library_recommendations_subtitle) {
            startActivity(Intent(this,ForYouActivity::class.java))
        }
        scroll.addView(options)
        root.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        setContentView(root)
        options.getChildAt(0)?.post{options.getChildAt(0)?.requestFocus()}
    }
    private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
}
