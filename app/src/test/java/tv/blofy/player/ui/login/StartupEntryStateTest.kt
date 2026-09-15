package tv.blofy.player.ui.login

import android.content.Context
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class StartupEntryStateTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication().applicationContext
        StartupEntryState.clear(context)
    }

    @After
    fun tearDown() {
        StartupEntryState.clear(context)
    }

    @Test
    fun freshInstallDoesNotSkipLogin() {
        assertFalse(StartupEntryState.shouldOpenHome(context, nowMs = 1_000L))
    }

    @Test
    fun readyActiveProviderSkipsLoginUntilExpiry() {
        StartupEntryState.rememberReady(context, "provider-a", expiresAt = 20_000L)

        assertTrue(StartupEntryState.shouldOpenHome(context, nowMs = 19_999L))
        assertFalse(StartupEntryState.shouldOpenHome(context, nowMs = 20_000L))
    }

    @Test
    fun lifetimeActivationKeepsAutoEntryReady() {
        StartupEntryState.rememberReady(context, "provider-a", expiresAt = null)

        assertTrue(StartupEntryState.shouldOpenHome(context, nowMs = Long.MAX_VALUE - 1L))
    }

    @Test
    fun clearImmediatelyReturnsStartupToLogin() {
        StartupEntryState.rememberReady(context, "provider-a", expiresAt = 20_000L)
        StartupEntryState.clear(context)

        assertFalse(StartupEntryState.shouldOpenHome(context, nowMs = 2_000L))
    }
}
