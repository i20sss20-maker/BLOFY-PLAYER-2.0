package tv.blofy.player.ui.login

import android.app.Application
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.R
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationCheckResponse.State
import tv.blofy.player.core.identity.ActivationDisplayState
import tv.blofy.player.data.local.ActivationEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "ar")
class ActivationStatusViewTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun title(view: ActivationStatusView) = view.findViewWithTag<TextView>("blofy_trial_title").text.toString()
    private fun detail(view: ActivationStatusView) = view.findViewWithTag<TextView>("blofy_trial_detail").text.toString()

    @Test fun countdownUsesServerClockAndBecomesRenewalAtExactExpiry() {
        val now = 1_000_000L
        val snapshot = ActivationDisplayState.Snapshot(State.TRIAL, now + 120_000L, 60_000L)
        val view = ActivationStatusView(context)
        view.render(snapshot, now)
        assertEquals(context.getString(R.string.trial_remaining), title(view))
        assertEquals(context.getString(R.string.trial_time_remaining, 0L, 0L, 1L), detail(view))
        view.render(snapshot, now + 60_000L)
        assertEquals(context.getString(R.string.trial_ended), title(view))
        assertEquals(context.getString(R.string.trial_renew_qr), detail(view))
        assertEquals(0L, snapshot.remainingMinutes(now + 999_999L))
    }

    @Test fun lifetimeBlockedAndUnknownAreNeverShownAsFreeTrials() {
        val view = ActivationStatusView(context)
        view.render(ActivationDisplayState.Snapshot(State.ACTIVE, null))
        assertEquals(context.getString(R.string.activation_no_expiry), detail(view))
        view.render(ActivationDisplayState.Snapshot(State.BLOCKED, 1L))
        assertEquals(context.getString(R.string.trial_blocked), title(view))
        view.render(null)
        assertEquals(context.getString(R.string.trial_refresh_status), detail(view))
    }

    @Test fun storedTrialStatusIsBoundToTheDeviceAndExpiryWithoutChangingActivation() {
        val identity = ActivationEntity("display-device", "123456", true, 9_999_999_999_999L)
        ActivationDisplayState.record(context, identity, ActivationCheckResponse("trial", identity.expiresAt))
        assertEquals(State.TRIAL, ActivationDisplayState.read(context, identity).state)
        assertEquals(State.ACTIVE, ActivationDisplayState.read(context, identity.copy(deviceId = "other-device")).state)
        assertEquals(State.ACTIVE, ActivationDisplayState.read(context, identity.copy(expiresAt = null)).state)
        assertTrue(identity.activated)
    }
}
