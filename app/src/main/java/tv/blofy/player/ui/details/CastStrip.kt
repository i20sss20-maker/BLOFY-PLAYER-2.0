package tv.blofy.player.ui.details

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.R
import tv.blofy.player.data.metadata.CinematicMetadataRepository
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

internal object CastStrip {
    fun build(context: Context, people: List<CinematicMetadataRepository.Person>): View {
        fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()
        val scroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(4), 0, dp(4))
            clipChildren = false
        }
        people.take(12).forEach { person ->
            val card = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                setPadding(dp(5), dp(5), dp(5), dp(7))
                background = background(false, dp(14))
                setOnFocusChangeListener { view, focused ->
                    view.background = background(focused, dp(14))
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f)
                        .translationZ(if (focused) dp(8).toFloat() else 1f).setDuration(65).start()
                }
                setOnClickListener {
                    context.startActivity(Intent(context, PersonDetailsActivity::class.java).apply {
                        putExtra(PersonDetailsActivity.EXTRA_NAME, person.name)
                        putExtra(PersonDetailsActivity.EXTRA_PROFILE, person.profileUrl)
                    })
                }
            }
            val image = ImageView(context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setImageResource(R.drawable.blofy_logo)
                background = GradientDrawable().apply {
                    cornerRadius = dp(12).toFloat()
                    setColor(0xFF181020.toInt())
                }
                clipToOutline = true
            }
            card.addView(image, LinearLayout.LayoutParams(dp(92), dp(112)))
            person.profileUrl?.let { ArtworkLoader.load(image, it) }
            card.addView(TextView(context).apply {
                text = person.name
                textSize = 12.5f
                typeface = BlofyTvDesign.LabelTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(dp(112), dp(26)))
            card.addView(TextView(context).apply {
                text = person.character.orEmpty()
                textSize = 10.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(dp(112), dp(22)))
            row.addView(card, LinearLayout.LayoutParams(dp(122), dp(176)).apply { marginStart = dp(8); marginEnd = dp(3) })
        }
        scroll.addView(row)
        return scroll
    }

    private fun background(focused: Boolean, radius: Int) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF563179.toInt(), 0xFF24162E.toInt()) else intArrayOf(0xD91D1527.toInt(), 0xE6130E1B.toInt())
    ).apply {
        cornerRadius = radius.toFloat()
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF3A2A48.toInt())
    }
}
