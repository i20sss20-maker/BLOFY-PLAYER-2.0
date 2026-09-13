package tv.blofy.player.core.identity

import android.app.Application
import android.content.pm.PackageManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.privacy.PrivacyPreferences
import tv.blofy.player.core.update.AppUpdatePrompt
import tv.blofy.player.ui.account.AccountActivity
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
class CommercialPreparationTest {
    private val app get() = RuntimeEnvironment.getApplication()

    @Test fun diagnosticsRequireExplicitOptInAndCanBeStopped() {
        app.getSharedPreferences("blofy_privacy", 0).edit().clear().commit()
        assertFalse(PrivacyPreferences.diagnosticsEnabled(app))
        PrivacyPreferences.setDiagnostics(app, true)
        assertTrue(PrivacyPreferences.diagnosticsEnabled(app))
        PrivacyPreferences.setDiagnostics(app, false)
        assertFalse(PrivacyPreferences.diagnosticsEnabled(app))
    }

    @Test fun trialSignalIsStableAndDoesNotExposeTheAndroidIdOrChangeLoginIdentity() {
        val identity = DeviceIdentity.deviceId(app)
        val first = TrialIdentity.digest("1234567890abcdef")
        assertEquals(first, TrialIdentity.digest("1234567890ABCDEF"))
        assertEquals(64, first?.length)
        assertFalse(first!!.contains("1234567890abcdef"))
        assertNotEquals(first, TrialIdentity.digest("1234567890abcdea"))
        assertEquals(identity, DeviceIdentity.deviceId(app))
        assertNull(TrialIdentity.digest(null)); assertNull(TrialIdentity.digest("0000000000000000"))
    }

    @Test fun accountPageWorksBeforeActivationAndNeverStartsARequestOnOpen() {
        val controller = Robolectric.buildActivity(AccountActivity::class.java).setup()
        assertNotNull(controller.get().findViewById<android.view.View>(android.R.id.content))
        assertNull(shadowOf(app).nextStartedActivity)
        controller.pause().stop().destroy()
    }

    @Test fun playPackageOmitsInstallerAndOpensOnlyTheStoreForUpdates() {
        val permissions = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        assertEquals(!BuildConfig.IS_GOOGLE_PLAY, permissions.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        val portal = checkNotNull(ActivationPortalUrl.create("https://example.test", "BLOFY-ABCD-EFGH", "123456"))
        assertEquals(if (BuildConfig.IS_GOOGLE_PLAY) "/connect" else "/", java.net.URI(portal).path)
        if (BuildConfig.IS_GOOGLE_PLAY) {
            val controller = Robolectric.buildActivity(AccountActivity::class.java).setup()
            AppUpdatePrompt.check(controller.get(), force = true)
            assertEquals("https://play.google.com/store/apps/details?id=${BuildConfig.APPLICATION_ID}", shadowOf(app).nextStartedActivity.dataString)
            controller.pause().stop().destroy()
        }
    }

    @Test fun recoveryCredentialsNeverFollowRedirects(): Unit = runBlocking {
        val source = MockWebServer(); val target = MockWebServer()
        source.start(); target.start()
        try {
            source.enqueue(MockResponse().setResponseCode(307).addHeader("Location", target.url("/capture")))
            try { AccountClient.post(app, "/api/v1/license/recovery/create", baseUrl = source.url("/").toString()); fail("Redirect must fail") }
            catch (_: AccountClient.Failure) { }
            assertEquals(0, target.requestCount)
        } finally { source.shutdown(); target.shutdown() }
    }
}
