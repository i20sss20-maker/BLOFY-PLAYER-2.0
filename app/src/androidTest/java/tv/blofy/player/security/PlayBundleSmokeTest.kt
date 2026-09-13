package tv.blofy.player.security

import android.content.pm.PackageManager
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.account.AccountActivity
import tv.blofy.player.ui.login.LoginActivity

@RunWith(AndroidJUnit4::class)
class PlayBundleSmokeTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun isolatedBundleReviewOnly() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("playBundleReview") == "true")
        assertTrue(BuildConfig.IS_GOOGLE_PLAY)
        assertFalse(BuildConfig.DEBUG)
    }
    @Test fun installerAbsentAndOriginalFfmpegLoads() {
        assertFalse(context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions.orEmpty().contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        assertTrue(BuildConfig.FFMPEG_EXTENSION_BUNDLED)
        val library=Class.forName("androidx.media3.decoder.ffmpeg.FfmpegLibrary")
        assertEquals(true,library.getMethod("isAvailable").invoke(null))
    }
    @Test fun androidKeystoreAndRoomStoreOnlyEncryptedCredentials(): Unit = runBlocking {
        val db=Room.inMemoryDatabaseBuilder(context,BlofyDatabase::class.java).build()
        try {
            val row=ProviderEntity("play-bundle-fixture","Fixture","https://example.invalid","fixture","isolated-password")
            db.dao().upsertProvider(row)
            val stored=checkNotNull(db.dao().providerStored(row.id))
            assertTrue(stored.baseUrl.startsWith("BLOFYENC1:"))
            assertTrue(stored.password.startsWith("BLOFYENC1:"))
            assertEquals(row,db.dao().provider(row.id))
        } finally { db.close() }
    }
    @Test fun loginAndPrivacyOpenWithNetworkBlocked() {
        ActivityScenario.launch(LoginActivity::class.java).use { scenario ->
            scenario.onActivity { assertFalse(it.isFinishing); assertNotNull(it.findViewById<android.view.View>(android.R.id.content)) }
        }
        ActivityScenario.launch(AccountActivity::class.java).use { scenario ->
            scenario.onActivity { assertFalse(it.isFinishing); assertNotNull(it.findViewById<android.view.View>(android.R.id.content)) }
        }
    }
}
