package tv.blofy.player.ui.common

import android.app.Activity
import android.content.Context
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.LinearSnapHelper
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.core.device.DeviceClass
import kotlin.math.roundToInt

/** Shared ergonomics: adaptive sizing, deterministic focus and lightweight snapping. */
object TvUiTuning {
    fun scale(context: Context): Float {
        val configuration = context.resources.configuration
        val widthDp = configuration.screenWidthDp.takeIf { it > 0 } ?: configuration.smallestScreenWidthDp
        return when (DeviceClass.detect(context)) {
            DeviceClass.Kind.TV -> when {
                widthDp >= 1800 -> 1.10f
                widthDp >= 1200 -> 1.04f
                widthDp in 1..960 -> 0.94f
                else -> 1f
            }
            DeviceClass.Kind.TABLET -> when {
                widthDp >= 1000 -> 1.04f
                widthDp in 1..700 -> 0.96f
                else -> 1f
            }
            DeviceClass.Kind.PHONE -> when {
                widthDp in 1..360 -> 0.88f
                widthDp in 361..480 -> 0.94f
                else -> 1f
            }
        }
    }

    fun dp(context: Context, value: Int): Int = (value * context.resources.displayMetrics.density * scale(context)).roundToInt()
    fun sp(context: Context, value: Float): Float = value * scale(context)

    fun installSafeFocus(recycler: RecyclerView, edgeDp: Int = 32) {
        val edge = dp(recycler.context, edgeDp)
        recycler.clipToPadding = false
        recycler.clipChildren = false
        recycler.isFocusable = false
        recycler.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        recycler.preserveFocusAfterLayout = true
        recycler.itemAnimator = null
        recycler.setPadding(
            maxOf(recycler.paddingLeft, edge),
            maxOf(recycler.paddingTop, edge / 2),
            maxOf(recycler.paddingRight, edge),
            maxOf(recycler.paddingBottom, edge / 2)
        )
        recycler.addOnChildAttachStateChangeListener(object : RecyclerView.OnChildAttachStateChangeListener {
            override fun onChildViewAttachedToWindow(view: View) {
                // TV/box navigation needs focus-in-touch-mode because many vendor firmwares report
                // a pointer device even when the primary input is a DPAD remote. On touch devices
                // this remains harmless: click/tap handling is unchanged.
                view.isFocusableInTouchMode = true
                view.addOnLayoutChangeListener { child, _, _, _, _, _, _, _, _ ->
                    if (child.hasFocus()) keepVisible(recycler, child, edge)
                }
                view.setOnFocusChangeListenerChain { child, focused ->
                    if (focused) recycler.post { keepVisible(recycler, child, edge) }
                }
            }
            override fun onChildViewDetachedFromWindow(view: View) = Unit
        })
    }

    fun installLinearSnap(recycler: RecyclerView) {
        if (recycler.onFlingListener == null) runCatching { LinearSnapHelper().attachToRecyclerView(recycler) }
    }

    fun enter(activity: Activity) {
        activity.window.decorView.alpha = 0.985f
        activity.window.decorView.animate().alpha(1f).setDuration(BlofyTvDesign.SectionTransitionMs).start()
    }

    private fun keepVisible(recycler: RecyclerView, child: View, edge: Int) {
        val left = child.left - edge
        val right = child.right + edge
        val top = child.top - edge / 2
        val bottom = child.bottom + edge / 2
        when {
            left < recycler.paddingLeft -> recycler.scrollBy(left - recycler.paddingLeft, 0)
            right > recycler.width - recycler.paddingRight -> recycler.scrollBy(right - (recycler.width - recycler.paddingRight), 0)
            top < recycler.paddingTop -> recycler.scrollBy(0, top - recycler.paddingTop)
            bottom > recycler.height - recycler.paddingBottom -> recycler.scrollBy(0, bottom - (recycler.height - recycler.paddingBottom))
        }
    }

    private fun View.setOnFocusChangeListenerChain(extra: (View, Boolean) -> Unit) {
        val previous = onFocusChangeListener
        setOnFocusChangeListener { view, focused ->
            previous?.onFocusChange(view, focused)
            extra(view, focused)
        }
    }
}
