package tv.blofy.player.ui.subscription

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.subscription.SubscriptionClient
import tv.blofy.player.ui.common.BlofyTvDesign
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SubscriptionActivity : AppCompatActivity() {
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private var loading = false
    private var firstResume = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@SubscriptionActivity, R.drawable.blofy_home_background)
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = if (resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
            setPadding(dp(36), dp(28), dp(36), dp(34))
        }
        content.addView(TextView(this).apply {
            text = "BLOFY PLUS"
            textSize = if (DeviceClass.isTv(this@SubscriptionActivity)) 32f else 27f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
        })
        content.addView(TextView(this).apply {
            text = "Manage your plan, renewal and device subscription"
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, dp(4), 0, dp(14))
        })
        status = TextView(this).apply {
            text = "Checking subscription…"
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        content.addView(status, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
        scroll.addView(content)
        setContentView(scroll)
        load()
    }

    override fun onResume() {
        super.onResume()
        if (firstResume) {
            firstResume = false
            return
        }
        if (::status.isInitialized && !loading) load()
    }

    private fun load() {
        if (loading) return
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) {
            status.text = "Subscription service is not configured"
            return
        }
        loading = true
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    SubscriptionClient.status(applicationContext, endpoint) to SubscriptionClient.plans(endpoint)
                }
                render(result.first, result.second)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                status.text = "Unable to load subscription • ${error.message ?: "network error"}"
            } finally {
                loading = false
            }
        }
    }

    private fun render(current: SubscriptionClient.Status, plans: List<SubscriptionClient.Plan>) {
        while (content.childCount > 3) content.removeViewAt(3)
        content.addView(actionButton("اشتراكي وفحص اتصال البث") {
            startActivity(Intent(this, ConnectionStatusActivity::class.java))
        }, LinearLayout.LayoutParams(-1, dp(48)).apply { bottomMargin = dp(12) })
        status.text = if (current.active) {
            buildString {
                append("Active • ${current.planName ?: current.planKey ?: "BLOFY"}")
                current.expiresAt?.let { append(" • until ${formatDate(it)}") }
                if (current.maxDevices != null) append(" • ${current.maxDevices} device${if (current.maxDevices == 1) "" else "s"}")
            }
        } else "No active paid plan • choose a plan below"

        if (plans.isEmpty()) {
            content.addView(messageCard("No plans are available right now."))
            return
        }
        plans.forEach { plan ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(20), dp(16), dp(20), dp(16))
                background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
                elevation = dp(3).toFloat()
                addView(TextView(this@SubscriptionActivity).apply {
                    text = plan.name
                    textSize = 20f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(Color.WHITE)
                })
                addView(TextView(this@SubscriptionActivity).apply {
                    val duration = plan.durationDays?.let { "$it days" } ?: "Lifetime"
                    text = "$duration  •  ${plan.maxDevices} device${if (plan.maxDevices == 1) "" else "s"}"
                    textSize = 13.5f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.TextMuted)
                    setPadding(0, dp(4), 0, dp(10))
                })
                addView(TextView(this@SubscriptionActivity).apply {
                    text = SubscriptionClient.formatMoney(plan.priceMinor, plan.currency)
                    textSize = 22f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(BlofyTvDesign.PurpleBright)
                })
                addView(actionButton("Choose plan") { askCouponAndQuote(plan) }, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(12) })
            }
            content.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
        }
        content.addView(actionButton("Refresh status") { load() }, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(4) })
    }

    private fun askCouponAndQuote(plan: SubscriptionClient.Plan) {
        val coupon = EditText(this).apply {
            hint = "Coupon code (optional)"
            isSingleLine = true
            setPadding(dp(18), dp(8), dp(18), dp(8))
        }
        AlertDialog.Builder(this)
            .setTitle(plan.name)
            .setMessage("Review the final price before creating the payment order.")
            .setView(coupon)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Continue") { _, _ -> quote(plan, coupon.text?.toString()) }
            .show()
    }

    private fun quote(plan: SubscriptionClient.Plan, coupon: String?) {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        status.text = "Calculating price…"
        lifecycleScope.launch {
            try {
                val quote = withContext(Dispatchers.IO) {
                    SubscriptionClient.quote(applicationContext, endpoint, plan.key, coupon)
                }
                AlertDialog.Builder(this@SubscriptionActivity)
                    .setTitle("Confirm ${quote.name.ifBlank { plan.name }}")
                    .setMessage(
                        "Total: ${SubscriptionClient.formatMoney(quote.amountMinor, quote.currency)}\n" +
                            "Devices: ${quote.maxDevices}\n" +
                            (quote.couponCode?.let { "Coupon: $it\n" } ?: "") +
                            "\nThe device activates only after BLOFY receives a verified payment confirmation."
                    )
                    .setNegativeButton("Back", null)
                    .setPositiveButton("Continue to payment") { _, _ -> createOrder(plan, quote.couponCode) }
                    .show()
                status.text = "Price ready"
            } catch (error: Throwable) {
                status.text = "Unable to calculate price • ${error.message ?: "error"}"
            }
        }
    }

    private fun createOrder(plan: SubscriptionClient.Plan, coupon: String?) {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        status.text = "Creating secure order…"
        lifecycleScope.launch {
            try {
                val order = withContext(Dispatchers.IO) {
                    SubscriptionClient.createOrder(applicationContext, endpoint, plan.key, coupon)
                }
                status.text = "Order ${order.orderId.take(8)}… created • awaiting payment"

                val checkout = runCatching {
                    withContext(Dispatchers.IO) {
                        SubscriptionClient.checkoutUrl(applicationContext, endpoint, order.orderId)
                    }
                }.getOrNull()

                if (!checkout.isNullOrBlank()) {
                    AlertDialog.Builder(this@SubscriptionActivity)
                        .setTitle("Secure payment")
                        .setMessage(
                            "Order: ${order.orderId}\n" +
                                "Amount: ${SubscriptionClient.formatMoney(order.amountMinor, order.currency)}\n\n" +
                                "Continue to the secure payment page. BLOFY will activate this device automatically after the signed payment confirmation is verified."
                        )
                        .setNegativeButton("Later", null)
                        .setPositiveButton("Pay now") { _, _ -> openCheckout(checkout) }
                        .show()
                } else {
                    AlertDialog.Builder(this@SubscriptionActivity)
                        .setTitle("Order created")
                        .setMessage(
                            "Order: ${order.orderId}\n" +
                                "Amount: ${SubscriptionClient.formatMoney(order.amountMinor, order.currency)}\n\n" +
                                "The payment provider is not connected yet. The order remains pending and cannot activate the device without a verified payment event."
                        )
                        .setPositiveButton("OK", null)
                        .show()
                }
            } catch (error: Throwable) {
                status.text = "Unable to create order • ${error.message ?: "error"}"
            }
        }
    }

    private fun openCheckout(url: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addCategory(Intent.CATEGORY_BROWSABLE) })
        }.onFailure {
            status.text = "Could not open secure payment page"
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14.5f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.025f, false)
        setOnClickListener { action() }
    }

    private fun messageCard(message: String) = TextView(this).apply {
        text = message
        textSize = 15f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(BlofyTvDesign.TextMuted)
        setPadding(dp(18), dp(18), dp(18), dp(18))
        background = BlofyTvDesign.elevatedSurface(dp(18).toFloat())
    }

    private fun formatDate(value: Long): String = SimpleDateFormat("dd MMM yyyy", Locale.getDefault()).format(Date(value))
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
