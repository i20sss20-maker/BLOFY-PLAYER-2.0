package tv.blofy.player.ui.login

import android.content.Context
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.R
import tv.blofy.player.core.identity.ActivationCheckResponse.State
import tv.blofy.player.core.identity.ActivationDisplayState
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

/** A stable status directly below the QR; connection messages have their own view. */
internal class ActivationStatusView(context: Context) : LinearLayout(context) {
    private val title = TextView(context).apply {
        tag = "blofy_trial_title"
        textSize = 13f
        typeface = BlofyTvDesign.HeadingTypeface
        gravity = Gravity.CENTER
    }
    private val detail = TextView(context).apply {
        tag = "blofy_trial_detail"
        textSize = 11f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(CinemaStyle.Muted)
        gravity = Gravity.CENTER
    }
    init {
        tag = "blofy_trial_status"
        orientation = VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(8), dp(6), dp(8), dp(6))
        background = BlofyTvDesign.badge(dp(12).toFloat())
        addView(title, LayoutParams(-1, -2))
        addView(detail, LayoutParams(-1, -2).apply { topMargin = dp(3) })
        render(null)
    }

    fun render(snapshot: ActivationDisplayState.Snapshot?, now: Long = System.currentTimeMillis()) {
        val remaining = snapshot?.remainingMinutes(now)
        val expired = snapshot?.state == State.EXPIRED ||
            (snapshot?.state in listOf(State.TRIAL, State.ACTIVE) && remaining == 0L)
        val blocked = snapshot?.state == State.BLOCKED
        title.setTextColor(if (expired || blocked) 0xFFFFCCA0.toInt() else CinemaStyle.Accent)
        title.text = context.getString(when {
            blocked -> R.string.trial_blocked
            expired && snapshot?.trial == true -> R.string.trial_ended
            expired -> R.string.activation_ended
            snapshot?.state == State.TRIAL -> R.string.trial_remaining
            snapshot?.state == State.ACTIVE -> R.string.activation_active
            else -> R.string.trial_status_unknown
        })
        detail.text = when {
            blocked -> context.getString(R.string.trial_contact_support)
            expired -> context.getString(R.string.trial_renew_qr)
            snapshot?.state in listOf(State.TRIAL, State.ACTIVE) && remaining != null -> {
                val days = remaining / 1440L
                val hours = (remaining % 1440L) / 60L
                val minutes = remaining % 60L
                context.getString(R.string.trial_time_remaining, days, hours, minutes)
            }
            snapshot?.state == State.ACTIVE -> context.getString(R.string.activation_no_expiry)
            else -> context.getString(R.string.trial_refresh_status)
        }
        contentDescription = "${title.text}. ${detail.text}"
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
