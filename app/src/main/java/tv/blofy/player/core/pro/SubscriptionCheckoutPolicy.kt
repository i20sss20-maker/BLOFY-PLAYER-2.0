package tv.blofy.player.core.pro

/**
 * A compile-time distribution decision. Never infer billing from installer package,
 * user preferences, build flavor suffixes, or a remote flag.
 */
enum class PaymentChannel { GOOGLE_PLAY, BLOFY_WEBSITE }

/**
 * The package from Google Play can offer only Google Play Billing for app-only
 * digital subscriptions (unless a separately approved exception applies).
 * Website builds may offer a checkout controlled by BLOFY's backend.
 *
 * Both channels can use one server-verified entitlement and annual products.
 */
object SubscriptionCheckoutPolicy {
    fun channel(isGooglePlayBuild: Boolean): PaymentChannel =
        if (isGooglePlayBuild) PaymentChannel.GOOGLE_PLAY else PaymentChannel.BLOFY_WEBSITE

    fun checkoutReady(channel: PaymentChannel): Boolean = false // Do not accept money before billing + backend verification ship.

    fun productId(plan: PlayerPlan): String? = plan.productId

    fun isOffPlatformCheckoutAllowed(channel: PaymentChannel): Boolean =
        channel == PaymentChannel.BLOFY_WEBSITE

    fun annualPriceSar(plan: PlayerPlan): Int = plan.annualPriceSar
}
