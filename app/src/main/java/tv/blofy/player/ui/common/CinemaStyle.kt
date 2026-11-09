package tv.blofy.player.ui.common

import android.content.Context
import tv.blofy.player.BuildConfig
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import tv.blofy.player.core.device.DeviceClass
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout

/** Shared cinematic actions: compact visuals and a distinct remote focus state. */
object CinemaStyle {
    // Only STREAM's separate package gets the ocean/cyan identity. PLAYER is unchanged.
    val Background = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF06161D.toInt() else 0xFF090611.toInt()
    val Surface = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF10303B.toInt() else 0xFF21162F.toInt()
    val White = if (BuildConfig.CODE_ONLY_LOGIN) 0xFFF2FCFB.toInt() else 0xFFF8F5FC.toInt()
    val Muted = if (BuildConfig.CODE_ONLY_LOGIN) 0xFFAACBD0.toInt() else 0xFFCFC3DD.toInt()
    val Accent = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF46E4D0.toInt() else 0xFFC9A7FF.toInt()
    const val ActionHeight = 34

    fun surface(context: Context, focused: Boolean = false, filledFocus: Boolean = false, radiusDp: Int = BlofyTvDesign.CardRadius) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        when {
            BuildConfig.CODE_ONLY_LOGIN && focused && filledFocus -> intArrayOf(0xFFE9FFF7.toInt(), Accent, 0xFF149D9C.toInt())
            BuildConfig.CODE_ONLY_LOGIN && focused -> intArrayOf(0xFF174D5C.toInt(), 0xFF123C46.toInt(), Surface)
            BuildConfig.CODE_ONLY_LOGIN -> intArrayOf(Surface, 0xFF09242E.toInt())
            focused && filledFocus -> intArrayOf(0xFFE6D2FF.toInt(), Accent, 0xFFB882F0.toInt())
            focused -> intArrayOf(0xFF63408A.toInt(), 0xFF3D2756.toInt(), Surface)
            else -> intArrayOf(Surface, 0xFF180F23.toInt())
        }
    ).apply {
        val density = context.resources.displayMetrics.density
        cornerRadius = radiusDp * density
        setStroke(
            ((if (focused) 2 else 1) * density).toInt(),
            if (focused) (if (BuildConfig.CODE_ONLY_LOGIN) 0xFFE8FFFC.toInt() else 0xFFEBD8FF.toInt()) else 0x52FFFFFF
        )
    }

    fun buttonBackground(context: Context, primary: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            BuildConfig.CODE_ONLY_LOGIN && primary && focused -> intArrayOf(0xFFE4FFFA.toInt(), 0xFF6CEAD8.toInt(), 0xFF36C8BD.toInt())
            BuildConfig.CODE_ONLY_LOGIN && primary -> intArrayOf(0xFF46E4D0.toInt(), 0xFF1BAEAE.toInt())
            BuildConfig.CODE_ONLY_LOGIN && focused -> intArrayOf(0xFF1A6470.toInt(), 0xFF0E3A46.toInt())
            BuildConfig.CODE_ONLY_LOGIN -> intArrayOf(Surface, 0xFF09242E.toInt())
            primary && focused -> intArrayOf(0xFFE9D4FF.toInt(), 0xFFD3B2FF.toInt(), 0xFFB67DEA.toInt())
            primary -> intArrayOf(Accent, 0xFFB98AEF.toInt())
            focused -> intArrayOf(0xFF7650A2.toInt(), 0xFF4A2E69.toInt())
            else -> intArrayOf(Surface, 0xFF1A1026.toInt())
        }
    ).apply {
        cornerRadius = BlofyTvDesign.ButtonRadius * context.resources.displayMetrics.density
        setStroke(
            ((if (focused) 2 else 1) * context.resources.displayMetrics.density).toInt(),
            if (focused) (if (BuildConfig.CODE_ONLY_LOGIN) 0xFFE8FFFC.toInt() else 0xFFF0E1FF.toInt()) else 0x52FFFFFF
        )
    }

    fun styleButton(button: Button, primary: Boolean = false, onFocus: ((Boolean) -> Unit)? = null) {
        val density = button.resources.displayMetrics.density
        button.apply {
            isAllCaps = false
            minHeight = 0; minimumHeight = 0; minWidth = 0; minimumWidth = 0
            setPadding((12 * density).toInt(), 0, (12 * density).toInt(), 0)
            textSize = 12f
            typeface = BlofyTvDesign.preferredTypeface(this)
            gravity = Gravity.CENTER
            isSingleLine = true
            ellipsize = TextUtils.TruncateAt.END
            isFocusable = true
            isFocusableInTouchMode = DeviceClass.detect(context) == DeviceClass.Kind.TV
            stateListAnimator = null
            backgroundTintList = null
            elevation = 0f
            background = buttonBackground(context, primary, false)
            setTextColor(if (primary) Background else White)
            setOnFocusChangeListener { view, focused ->
                background = buttonBackground(context, primary, focused)
                setTextColor(if (primary) Background else White)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(context, 1.028f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(context, 8 * density) else 0f)
                    .setDuration(TvUiTuning.focusDuration(context, focused))
                    .start()
                onFocus?.invoke(focused)
            }
        }
    }

    /** Long translated labels and optional trailer/resume actions remain reachable. */
    fun actionStrip(context: Context, row: LinearLayout) = HorizontalScrollView(context).apply {
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        isFocusable = false
        isFocusableInTouchMode = false
        layoutDirection = context.resources.configuration.layoutDirection
        clipToPadding = false
        val inset = (3 * resources.displayMetrics.density).toInt()
        setPadding(inset, inset, inset, inset)
        addView(row, FrameLayout.LayoutParams(-2, -2))
    }
}
