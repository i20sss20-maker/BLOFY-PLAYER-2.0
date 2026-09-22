package tv.blofy.player.core.storage

import java.security.MessageDigest

/** Same lowercase SHA-256 cache keys, without allocating a Formatter for each of 32 bytes. */
internal object StableHash {
    private const val HEX = "0123456789abcdef"
    fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        val out = CharArray(bytes.size * 2)
        bytes.forEachIndexed { index, byte ->
            val valueByte = byte.toInt() and 0xff
            out[index * 2] = HEX[valueByte ushr 4]
            out[index * 2 + 1] = HEX[valueByte and 15]
        }
        return String(out)
    }
}
