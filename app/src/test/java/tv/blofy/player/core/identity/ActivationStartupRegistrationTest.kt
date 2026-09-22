package tv.blofy.player.core.identity

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import tv.blofy.player.data.local.ActivationEntity

class ActivationStartupRegistrationTest {
    @Test(expected = CancellationException::class)
    fun startupStillPropagatesCancellation() = runBlocking {
        ActivationStartupRegistration.attempt { throw CancellationException("cancelled") }
    }

    @Test(expected = AssertionError::class)
    fun fatalErrorsAreNotDisguisedAsTemporaryStorageFailures() = runBlocking {
        ActivationStartupRegistration.attempt { throw AssertionError("fatal") }
    }
    private fun state(activated: Boolean, expiresAt: Long?) = ActivationEntity(
        deviceId = "BLOFY-TEST-0001",
        activationCode = "123456",
        activated = activated,
        expiresAt = expiresAt,
        lastCheckAt = 0L
    )

    @Test fun freshIdentityRegistersAutomatically() {
        assertTrue(ActivationStartupRegistration.shouldRegister(state(activated = false, expiresAt = null)))
    }

    @Test fun activeOrTrialIdentityDoesNotReRegister() {
        assertFalse(ActivationStartupRegistration.shouldRegister(state(activated = true, expiresAt = System.currentTimeMillis() + 86_400_000L)))
        assertFalse(ActivationStartupRegistration.shouldRegister(state(activated = true, expiresAt = null)))
    }

    @Test fun previouslyCheckedExpiredIdentityDoesNotLoopOnEveryColdStart() {
        assertFalse(ActivationStartupRegistration.shouldRegister(state(activated = false, expiresAt = System.currentTimeMillis() - 1L)))
    }
}
