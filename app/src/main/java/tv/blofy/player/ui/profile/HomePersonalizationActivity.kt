package tv.blofy.player.ui.profile

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.common.BlofyTvDesign

class HomePersonalizationActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    private fun render() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@HomePersonalizationActivity, R.drawable.blofy_home_background)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(40), dp(28), dp(40), dp(34))
        }
        val profile = ProfileStore.active(this)
        root.addView(TextView(this).apply {
            text = "Customize Home"
            textSize = 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = "${profile.name} • choose and reorder the rows shown on Home"
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(4), 0, dp(14))
        })
        status = TextView(this).apply {
            text = "Changes are saved for this profile only"
            textSize = 13f
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        root.addView(status, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) })

        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        root.addView(actionButton("Restore default Home") {
            ProfileLibraryStore.resetHomeRows(this)
            status.text = "Default Home restored"
            render()
        }, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(12) })
        root.addView(actionButton("Back") { finish() }, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(8) })
        scroll.addView(root)
        setContentView(scroll)
        renderRows()
    }

    private fun renderRows() {
        list.removeAllViews()
        val enabled = ProfileLibraryStore.homeRows(this)
        val ordered = enabled + ProfileLibraryStore.ALL_HOME_ROWS.filterNot(enabled::contains)
        ordered.forEach { row ->
            val on = row in enabled
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(10), dp(14), dp(10))
                background = BlofyTvDesign.elevatedSurface(dp(18).toFloat())
            }
            val label = TextView(this).apply {
                text = rowLabel(row) + if (on) "\nVisible" else "\nHidden"
                textSize = 15f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(if (on) Color.WHITE else BlofyTvDesign.TextMuted)
            }
            card.addView(label, LinearLayout.LayoutParams(0, dp(58), 1f))
            if (on) {
                card.addView(actionButton("↑") { move(row, -1) }, LinearLayout.LayoutParams(dp(58), dp(48)).apply { marginStart = dp(6) })
                card.addView(actionButton("↓") { move(row, 1) }, LinearLayout.LayoutParams(dp(58), dp(48)).apply { marginStart = dp(6) })
            }
            card.addView(actionButton(if (on) "Hide" else "Show") {
                ProfileLibraryStore.setHomeRowEnabled(this, row, !on)
                status.text = if (on) "Row hidden" else "Row added to Home"
                renderRows()
            }, LinearLayout.LayoutParams(dp(100), dp(48)).apply { marginStart = dp(8) })
            list.addView(card, LinearLayout.LayoutParams(-1, dp(78)).apply { bottomMargin = dp(8) })
        }
    }

    private fun move(row: String, delta: Int) {
        ProfileLibraryStore.moveHomeRow(this, row, delta)
        status.text = "Home order saved"
        renderRows()
    }

    private fun rowLabel(row: String): String = when (row) {
        "continue_watching" -> "Continue Watching"
        "recent_channels" -> "Recently Watched"
        "watchlist" -> "My Watchlist"
        "latest" -> "Recently Added"
        "top_rated" -> "Top Rated"
        "arabic" -> "Arabic Picks"
        "uhd" -> "4K • UHD"
        else -> row
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13.5f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.025f, false)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
