package tv.blofy.player.security

import android.content.Context
import androidx.core.content.FileProvider
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.ActivationCheckRequest
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.update.AppReleaseRepository
import tv.blofy.player.core.update.UpdatePackageVerifier
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.login.LoginActivity
import java.io.File

/** Isolated minified-target smoke tests. No real provider account or production API is used. */
@RunWith(AndroidJUnit4::class)
class R8RuntimeContractTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before fun onlyExplicitIsolatedReview() {
        // Ordinary Debug/production-target test suites do not run these Release-only checks.
        // The review runner supplies this argument and requires six passes, with zero skips.
        assumeTrue(InstrumentationRegistry.getArguments().getString("r8Review") == "true")
        assertEquals("https://blofy-security-review.invalid", BuildConfig.ACTIVATION_BASE_URL)
        assertFalse(BuildConfig.DEBUG)
    }

    @Test fun activationJsonNamesSurviveObfuscation() {
        assertFalse("R8 target must be non-debuggable", BuildConfig.DEBUG)
        val gson = Gson()
        val request = ActivationCheckRequest("BLOFY-LOCAL-TEST", "123456", "local-review")
        val json = JsonParser.parseString(gson.toJson(request)).asJsonObject
        assertEquals("BLOFY-LOCAL-TEST", json.get("deviceId").asString)
        assertEquals("123456", json.get("activationCode").asString)
        assertEquals("android", json.get("platform").asString)
        val response = gson.fromJson("""{"status":"active","expiresAt":2000,"serverTime":1000}""", ActivationCheckResponse::class.java)
        assertEquals(ActivationCheckResponse.State.ACTIVE, response.state())
        assertTrue(response.canUse())
    }

    @Test fun oldReleaseCacheJsonStillLoads() {
        val prefs = context.getSharedPreferences("blofy_app_release", Context.MODE_PRIVATE)
        val old = prefs.getString("release_json", null)
        try {
            prefs.edit().putString("release_json", """{"versionCode":2000054,"versionName":"review","minSupportedVersionCode":1,"downloadUrl":"https://example.invalid/review.apk","releaseNotes":"اختبار","fetchedAt":1000}""").commit()
            val cached = AppReleaseRepository.cached(context)
            assertNotNull(cached)
            assertEquals(2000054, cached!!.versionCode)
            assertEquals("اختبار", cached.releaseNotes)
            assertTrue(cached.updateAvailable(2000053))
        } finally {
            prefs.edit().apply { if (old == null) remove("release_json") else putString("release_json", old) }.commit()
        }
    }

    @Test fun roomGeneratedImplementationOpens() {
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        try { assertTrue(db.openHelper.writableDatabase.isOpen) } finally { db.close() }
    }

    @Test fun bundledFfmpegNativeLibraryLoads() {
        assertTrue(BuildConfig.FFMPEG_EXTENSION_BUNDLED)
        val library = Class.forName("androidx.media3.decoder.ffmpeg.FfmpegLibrary")
        assertEquals(true, library.getMethod("isAvailable").invoke(null))
    }

    @Test fun updateVerifierAndFileProviderRemainRestricted() {
        assertFalse(UpdatePackageVerifier.verify(context, File(context.applicationInfo.sourceDir), BuildConfig.VERSION_CODE))
        try {
            FileProvider.getUriForFile(context, "${context.packageName}.updates", File(context.filesDir, "private-review.json"))
            fail("Update provider exposed an unrelated private file")
        } catch (_: IllegalArgumentException) { /* Expected. */ }
    }

    @Test fun loginActivityStartsWithoutProductionConnection() {
        assertTrue("Never register a CI device in production", BuildConfig.ACTIVATION_BASE_URL.endsWith(".invalid"))
        ActivityScenario.launch(LoginActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertFalse(activity.isFinishing)
                assertNotNull(activity.window.decorView)
            }
        }
    }
}
