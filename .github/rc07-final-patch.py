from pathlib import Path

p = Path('app/src/main/java/tv/blofy/player/core/subscription/SubscriptionClient.kt')
s = p.read_text().replace('import okhttp3.HttpUrl.Companion.toHttpUrl\n', '')
old = '''    suspend fun status(context: Context, baseUrl: String): Status {
        val url = endpoint(baseUrl, "/api/v1/subscriptions/status").toHttpUrl().newBuilder()
            .addQueryParameter("deviceId", DeviceIdentity.deviceId(context))
            .addQueryParameter("activationCode", DeviceIdentity.activationCode(context))
            .build()
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).awaitResponse().use { response ->
            check(response.isSuccessful) { "subscription_status_http_${response.code}" }
            val root = JSONObject(response.body?.string().orEmpty())
            return Status(
                active = root.optBoolean("active", false),
                planKey = root.optString("planKey").takeIf(String::isNotBlank),
                planName = root.optString("planName").takeIf(String::isNotBlank),
                maxDevices = if (root.has("maxDevices") && !root.isNull("maxDevices")) root.optInt("maxDevices") else null,
                startsAt = if (root.has("startsAt") && !root.isNull("startsAt")) root.optLong("startsAt") else null,
                expiresAt = if (root.has("expiresAt") && !root.isNull("expiresAt")) root.optLong("expiresAt") else null,
            )
        }
    }
'''
new = '''    suspend fun status(context: Context, baseUrl: String): Status {
        // Credentials belong in the encrypted request body, never in a query string that can be logged.
        val root = postAuthenticated(context, endpoint(baseUrl, "/api/v1/subscriptions/status"), JSONObject())
        return Status(
            active = root.optBoolean("active", false),
            planKey = root.optString("planKey").takeIf(String::isNotBlank),
            planName = root.optString("planName").takeIf(String::isNotBlank),
            maxDevices = if (root.has("maxDevices") && !root.isNull("maxDevices")) root.optInt("maxDevices") else null,
            startsAt = if (root.has("startsAt") && !root.isNull("startsAt")) root.optLong("startsAt") else null,
            expiresAt = if (root.has("expiresAt") && !root.isNull("expiresAt")) root.optLong("expiresAt") else null,
        )
    }
'''
if old not in s: raise SystemExit('SubscriptionClient.status source changed unexpectedly')
p.write_text(s.replace(old, new))

p = Path('services/activation/src/subscription-hook.mjs')
s = p.read_text()
old = '''async function subscriptionStatus(req, res, requestUrl) {
  const deviceId = String(requestUrl.searchParams.get('deviceId') || '').trim();
  const activationCode = String(requestUrl.searchParams.get('activationCode') || '').trim();
'''
new = '''async function subscriptionStatus(req, res, requestUrl) {
  // New clients keep device credentials out of URLs and reverse-proxy access logs.
  // GET remains temporarily compatible with already-installed older builds.
  const auth = req.method === 'POST' ? await readJson(req) : requestUrl.searchParams;
  const deviceId = String(req.method === 'POST' ? auth.deviceId : auth.get('deviceId') || '').trim();
  const activationCode = String(req.method === 'POST' ? auth.activationCode : auth.get('activationCode') || '').trim();
'''
if old not in s: raise SystemExit('subscriptionStatus source changed unexpectedly')
s = s.replace(old, new)
old_route = "if (req.method === 'GET' && requestUrl.pathname === `${PREFIX}/status`)"
new_route = "if ((req.method === 'POST' || req.method === 'GET') && requestUrl.pathname === `${PREFIX}/status`)"
if old_route not in s: raise SystemExit('subscription status route source changed unexpectedly')
p.write_text(s.replace(old_route, new_route))

p = Path('app/build.gradle.kts')
s = p.read_text().replace('versionCode = 2000013', 'versionCode = 2000014').replace('versionName = "2.0.0-rc07.5"', 'versionName = "2.0.0-rc07.6"')
if 'versionCode = 2000014' not in s or 'versionName = "2.0.0-rc07.6"' not in s: raise SystemExit('version bump failed')
p.write_text(s)

t = Path('app/src/test/java/tv/blofy/player/core/subscription/SubscriptionClientTest.kt')
t.parent.mkdir(parents=True, exist_ok=True)
t.write_text(r'''package tv.blofy.player.core.subscription

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.core.identity.DeviceIdentity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28, 35], application = Application::class)
class SubscriptionClientTest {
    private lateinit var server: MockWebServer
    private val app get() = RuntimeEnvironment.getApplication<Application>()

    @Before fun setup() { server = MockWebServer().also { it.start() } }
    @After fun cleanup() { server.shutdown() }

    @Test fun subscriptionStatusUsesPostBodyAndNeverLeaksActivationCodeInUrl() = runBlocking(Dispatchers.IO) {
        server.enqueue(MockResponse().setResponseCode(200).setHeader("content-type", "application/json").setBody("""{"active":false}"""))
        SubscriptionClient.status(app, server.url("/").toString())
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/subscriptions/status", request.requestUrl?.encodedPath)
        assertNull(request.requestUrl?.query)
        val body = JSONObject(request.body.readUtf8())
        assertEquals(DeviceIdentity.deviceId(app), body.getString("deviceId"))
        assertEquals(DeviceIdentity.activationCode(app), body.getString("activationCode"))
    }
}
''')

Path('.github/rc07-final-patch.py').unlink()
