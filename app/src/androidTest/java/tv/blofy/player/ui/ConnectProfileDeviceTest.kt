package tv.blofy.player.ui

import android.content.Context
import android.content.Intent
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.ExternalStreamConnectClient
import tv.blofy.player.core.identity.ExternalStreamConnectStore
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.ui.login.ExternalStreamConnectActivity

@RunWith(AndroidJUnit4::class)
class ConnectProfileDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun descendants(v: View): List<View> =
        listOf(v) + if (v is ViewGroup) (0 until v.childCount).flatMap { descendants(v.getChildAt(it)) } else emptyList()

    @Test fun androidKeystoreRoundTripAndTamperDetectionDoNotTouchStreamSession() {
        assertTrue(BuildConfig.CODE_ONLY_LOGIN)
        assertTrue("Run only against the isolated QA package", context.packageName.endsWith(".stream.qa"))
        val legacyBefore = StreamCodeSession.isClaimed(context)
        val tokenBefore = StreamCodeSession.token(context)
        val prefs = context.getSharedPreferences("blofy_connect_profile", Context.MODE_PRIVATE)
        val host = checkNotNull(ExternalStreamConnectClient.parseHost("https://provider.example.com:8443"))
        val user = "synthetic-connect-user"
        val password = "synthetic-connect-password"
        try {
            ExternalStreamConnectStore.clear(context)
            assertNull(ExternalStreamConnectStore.load(context))
            ExternalStreamConnectStore.save(context, ExternalStreamConnectClient.Credentials(host,user,password))
            val encrypted = checkNotNull(prefs.getString("sealed_v1",null))
            val decoded = Base64.decode(encrypted,Base64.NO_WRAP)
            assertFalse(String(decoded,Charsets.UTF_8).contains(password))
            assertFalse(prefs.all.values.any { it.toString().contains(password) })
            val restored = checkNotNull(ExternalStreamConnectStore.load(context))
            assertEquals(host,restored.host)
            assertEquals(user,restored.username)
            assertEquals(password,restored.password)
            ExternalStreamConnectStore.save(context, ExternalStreamConnectClient.Credentials(host,user,password))
            assertNotEquals("Each save must use a new nonce", encrypted,prefs.getString("sealed_v1",null))
            decoded[decoded.lastIndex] = (decoded.last().toInt() xor 1).toByte()
            assertTrue(prefs.edit().putString("sealed_v1",Base64.encodeToString(decoded,Base64.NO_WRAP)).commit())
            assertNull("Tampered ciphertext must not yield a profile",ExternalStreamConnectStore.load(context))
        } finally { ExternalStreamConnectStore.clear(context) }
        assertNull(ExternalStreamConnectStore.load(context))
        assertEquals(legacyBefore,StreamCodeSession.isClaimed(context))
        assertEquals(tokenBefore,StreamCodeSession.token(context))
    }

    @Test fun connectScreenOpensWithNoProfileAndDoesNotExposeExistingCredentials() {
        assertTrue(context.packageName.endsWith(".stream.qa"))
        ExternalStreamConnectStore.clear(context)
        ActivityScenario.launch<ExternalStreamConnectActivity>(Intent(context,ExternalStreamConnectActivity::class.java)).use { scenario ->
            scenario.onActivity { activity ->
                val views = descendants(activity.window.decorView)
                assertTrue(views.filterIsInstance<TextView>().any { it.text.toString().contains("BLOFY STREAM CONNECT") })
                val field = views.filterIsInstance<EditText>().first { it.hint?.toString()=="أدخل 8 أرقام" }
                assertFalse("Pairing code must not be saved in view state",field.isSaveEnabled)
                assertTrue(field.text.isNullOrEmpty())
                assertEquals(android.text.InputType.TYPE_CLASS_NUMBER,field.inputType)
                field.setText("01234567")
                assertEquals("01234567",field.text.toString())
                assertEquals("01234567",ExternalStreamConnectClient.normalizeCode(field.text.toString()))
                assertNotNull(ExternalStreamConnectClient.parseHost("http://provider.example.com:8080"))
                assertTrue(views.filterIsInstance<Button>().any { it.text.toString()=="ربط الاشتراك الخارجي" && it.isFocusable })
                assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
            }
        }
    }
}
