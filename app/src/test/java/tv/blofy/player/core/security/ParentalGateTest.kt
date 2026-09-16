package tv.blofy.player.core.security

import android.app.Application
import android.content.Context
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ParentalGateTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication().applicationContext
        ParentalGate.clearPin(context)
    }

    @After
    fun tearDown() {
        ParentalGate.clearPin(context)
    }

    @Test
    fun setPin_acceptsOnlyFourToEightDigits() {
        assertFalse(ParentalGate.setPin(context, "123"))
        assertFalse(ParentalGate.setPin(context, "123456789"))
        assertFalse(ParentalGate.setPin(context, "12ab"))
        assertTrue(ParentalGate.setPin(context, "1234"))
        assertTrue(ParentalGate.hasPin(context))
    }

    @Test
    fun verify_acceptsCorrectPin_andRejectsWrongPin() {
        assertTrue(ParentalGate.setPin(context, "246810"))

        assertFalse(ParentalGate.verify(context, "000000"))
        assertTrue(ParentalGate.verify(context, "246810"))
    }

    @Test
    fun clearPin_disablesGate() {
        assertTrue(ParentalGate.setPin(context, "7788"))
        assertTrue(ParentalGate.hasPin(context))

        ParentalGate.clearPin(context)

        assertFalse(ParentalGate.hasPin(context))
        assertTrue(ParentalGate.verify(context, "anything"))
    }
}
