package tv.blofy.player.ui.common

/**
 * Fast 64-bit stable ID for RecyclerView items.
 * Avoids the high collision rate of Java's 32-bit String.hashCode() on very large catalogs.
 */
internal fun stableId64(value: String): Long {
    var hash = -3750763034362895579L
    for (ch in value) {
        hash = hash xor ch.code.toLong()
        hash *= 1099511628211L
    }
    return hash
}
