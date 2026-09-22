package tv.blofy.player.ui.details

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.R
import tv.blofy.player.data.metadata.ProviderMetadata
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

internal object CastStrip {
    fun build(context: Context, people: List<ProviderMetadata.Person>): View {
        fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()
        val scroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
            layoutDirection = context.resources.configuration.layoutDirection
            setPadding(dp(2), dp(2), dp(2), dp(2))
        }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = context.resources.configuration.layoutDirection
            setPadding(0, dp(5), 0, dp(7))
            clipChildren = false
            clipToPadding = false
        }
        people.take(14).forEach { person ->
            val card = LinearLayout(context).apply {
                tag = "blofy_cast_${person.name}"
                contentDescription = listOfNotNull(person.name, person.character).joinToString(". ")
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                setPadding(dp(6), dp(6), dp(6), dp(8))
                background = BlofyTvDesign.glassSurface(dp(17).toFloat(), false)
                elevation = dp(2).toFloat()
                setOnFocusChangeListener { view, focused ->
                    view.animate().cancel()
                    view.background = BlofyTvDesign.glassSurface(dp(17).toFloat(), focused)
                    val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.018f) else 1f
                    view.animate()
                        .scaleX(targetScale)
                        .scaleY(targetScale)
                        .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(7).toFloat()) else 0f)
                        .alpha(if (focused) 1f else .96f)
                        .setDuration(TvUiTuning.focusDuration(view.context, focused))
                        .start()
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
                    cornerRadius = dp(13).toFloat()
                    setColor(BlofyTvDesign.Surface)
                    setStroke(dp(1), BlofyTvDesign.Divider)
                }
                clipToOutline = true
            }
            val portrait = FrameLayout(context).apply {
                background = BlofyTvDesign.glassSurface(dp(13).toFloat(), false)
                addView(TextView(context).apply {
                    text = person.name.trim().take(1).uppercase()
                    textSize = 21f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(BlofyTvDesign.PurpleSoft)
                    gravity = Gravity.CENTER
                }, FrameLayout.LayoutParams(-1, -1))
                if (!person.profileUrl.isNullOrBlank()) addView(image, FrameLayout.LayoutParams(-1, -1))
            }
            card.addView(portrait, LinearLayout.LayoutParams(dp(86), dp(96)))
            person.profileUrl?.let { ArtworkLoader.load(image, it) }
            card.addView(TextView(context).apply {
                text = person.name
                textSize = 12.4f
                typeface = BlofyTvDesign.LabelTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                includeFontPadding = false
            }, LinearLayout.LayoutParams(dp(106), dp(34)).apply { topMargin = dp(5) })
            card.addView(TextView(context).apply {
                text = person.character.orEmpty()
                textSize = 10.1f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                includeFontPadding = false
                visibility = if (person.character.isNullOrBlank()) View.GONE else View.VISIBLE
            }, LinearLayout.LayoutParams(dp(106), dp(18)))
            row.addView(card, LinearLayout.LayoutParams(dp(116), dp(172)).apply {
                marginStart = dp(8)
                marginEnd = dp(3)
            })
        }
        scroll.addView(row)
        return scroll
    }
}
