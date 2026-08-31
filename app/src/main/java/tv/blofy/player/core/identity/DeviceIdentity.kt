package tv.blofy.player.core.identity

import android.content.Context
import android.provider.Settings
import java.security.MessageDigest

object DeviceIdentity {
    fun deviceId(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val digest = sha256("blofy:$androidId:${context.packageName}")
        val code = digest.take(8).uppercase()
        return "BLOFY-${code.take(4)}-${code.drop(4)}"
    }

    fun activationCode(context: Context): String {
        val numeric = sha256("activation:${deviceId(context)}")
            .take(12)
            .fold(0L) { acc, c -> (acc * 33L + c.code) % 1_000_000L }
        return numeric.toString().padStart(6, '0')
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
