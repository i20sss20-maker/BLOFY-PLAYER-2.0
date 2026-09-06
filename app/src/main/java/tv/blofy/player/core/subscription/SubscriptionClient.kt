package tv.blofy.player.core.subscription

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

object SubscriptionClient {
    data class Plan(
        val key: String,
        val name: String,
        val durationDays: Int?,
        val maxDevices: Int,
        val priceMinor: Long,
        val currency: String,
    )

    data class Quote(
        val planKey: String,
        val name: String,
        val durationDays: Int?,
        val maxDevices: Int,
        val amountMinor: Long,
        val currency: String,
        val couponCode: String?,
    )

    data class Order(
        val orderId: String,
        val planKey: String,
        val status: String,
        val amountMinor: Long,
        val currency: String,
        val couponCode: String?,
    )

    data class Status(
        val active: Boolean,
        val planKey: String?,
        val planName: String?,
        val maxDevices: Int?,
        val startsAt: Long?,
        val expiresAt: Long?,
    )

    private val json = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun plans(baseUrl: String): List<Plan> {
        val request = Request.Builder().url(endpoint(baseUrl, "/api/v1/subscriptions/plans")).get().build()
        client.newCall(request).awaitResponse().use { response ->
            check(response.isSuccessful) { "plans_http_${response.code}" }
            val root = JSONObject(response.body?.string().orEmpty())
            val items = root.optJSONArray("items") ?: JSONArray()
            return buildList {
                for (i in 0 until items.length()) {
                    val row = items.optJSONObject(i) ?: continue
                    add(Plan(
                        key = row.optString("key"),
                        name = row.optString("name"),
                        durationDays = if (row.isNull("durationDays")) null else row.optInt("durationDays"),
                        maxDevices = row.optInt("maxDevices", 1),
                        priceMinor = row.optLong("priceMinor"),
                        currency = row.optString("currency", "SAR"),
                    ))
                }
            }.filter { it.key.isNotBlank() }
        }
    }

    suspend fun quote(context: Context, baseUrl: String, planKey: String, coupon: String?): Quote {
        val root = postAuthenticated(context, endpoint(baseUrl, "/api/v1/subscriptions/quote"), JSONObject().apply {
            put("planKey", planKey)
            coupon?.trim()?.takeIf(String::isNotBlank)?.let { put("couponCode", it) }
        })
        return Quote(
            planKey = root.getString("planKey"),
            name = root.optString("name"),
            durationDays = if (root.isNull("durationDays")) null else root.optInt("durationDays"),
            maxDevices = root.optInt("maxDevices", 1),
            amountMinor = root.optLong("amountMinor"),
            currency = root.optString("currency", "SAR"),
            couponCode = root.optString("couponCode").takeIf(String::isNotBlank),
        )
    }

    suspend fun createOrder(context: Context, baseUrl: String, planKey: String, coupon: String?): Order {
        val root = postAuthenticated(context, endpoint(baseUrl, "/api/v1/subscriptions/orders"), JSONObject().apply {
            put("planKey", planKey)
            coupon?.trim()?.takeIf(String::isNotBlank)?.let { put("couponCode", it) }
        }, expected = 201)
        return Order(
            orderId = root.getString("orderId"),
            planKey = root.getString("planKey"),
            status = root.optString("status", "pending"),
            amountMinor = root.optLong("amountMinor"),
            currency = root.optString("currency", "SAR"),
            couponCode = root.optString("couponCode").takeIf(String::isNotBlank),
        )
    }

    suspend fun checkoutUrl(context: Context, baseUrl: String, orderId: String): String {
        val root = postAuthenticated(context, endpoint(baseUrl, "/api/v1/subscriptions/checkout"), JSONObject().apply {
            put("orderId", orderId)
        })
        return root.getString("checkoutUrl").also {
            check(it.startsWith("https://", ignoreCase = true)) { "invalid_checkout_url" }
        }
    }

    suspend fun status(context: Context, baseUrl: String): Status {
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

    private suspend fun postAuthenticated(context: Context, url: String, body: JSONObject, expected: Int = 200): JSONObject {
        body.put("deviceId", DeviceIdentity.deviceId(context))
        body.put("activationCode", DeviceIdentity.activationCode(context))
        val request = Request.Builder().url(url).post(body.toString().toRequestBody(json)).build()
        client.newCall(request).awaitResponse().use { response ->
            val raw = response.body?.string().orEmpty()
            check(response.code == expected) {
                runCatching { JSONObject(raw).optString("error") }.getOrNull()?.takeIf(String::isNotBlank)
                    ?: "subscription_http_${response.code}"
            }
            return JSONObject(raw)
        }
    }

    private fun endpoint(baseUrl: String, path: String): String =
        baseUrl.trim().trimEnd('/') + path

    fun formatMoney(amountMinor: Long, currency: String): String =
        "%.2f %s".format(amountMinor / 100.0, currency.uppercase())
}
