package tv.blofy.player.data.remote

import java.math.BigDecimal
import kotlin.math.floor

/** Keeps category/content IDs comparable when Gson decodes JSON numbers as Double. */
object XtreamIdentifier {
    fun normalize(value: Any?): String? {
        val normalized = when (value) {
            null -> return null
            is Byte, is Short, is Int, is Long -> (value as Number).toLong().toString()
            is Float, is Double -> normalizeDecimal((value as Number).toDouble(), value.toString())
            is Number -> value.toString()
            else -> value.toString().trim()
        }
        return normalized.takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
    }

    private fun normalizeDecimal(value: Double, source: String): String {
        if (!value.isFinite()) return ""
        if (value == floor(value) && value >= Long.MIN_VALUE.toDouble() && value <= Long.MAX_VALUE.toDouble()) {
            return value.toLong().toString()
        }
        return runCatching { BigDecimal(source).stripTrailingZeros().toPlainString() }.getOrDefault(source)
    }
}
