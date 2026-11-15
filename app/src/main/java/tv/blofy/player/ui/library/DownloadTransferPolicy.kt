package tv.blofy.player.ui.library

/** Pure checks for progressive downloads; never inspect untrusted stream data. */
internal object DownloadTransferPolicy {
    private const val RESERVE_BYTES = 256L * 1024L * 1024L

    fun enoughSpace(freeBytes: Long, expectedBytes: Long): Boolean =
        freeBytes < 0L || expectedBytes <= 0L ||
            (freeBytes >= RESERVE_BYTES && expectedBytes <= freeBytes - RESERVE_BYTES)

    fun bytesPerSecond(previousBytes: Long, currentBytes: Long, elapsedMs: Long): Long =
        if (elapsedMs <= 0L || currentBytes <= previousBytes) 0L
        else ((currentBytes - previousBytes) * 1000L / elapsedMs).coerceAtLeast(0L)

    fun secondsRemaining(totalBytes: Long, downloadedBytes: Long, speed: Long): Long? {
        if (totalBytes <= 0L || downloadedBytes < 0L ||
            speed <= 0L || downloadedBytes >= totalBytes
        ) return null
        val left = totalBytes - downloadedBytes
        // Ceiling division without adding speed-1 (which can overflow Long).
        return (left / speed + if (left % speed == 0L) 0L else 1L)
            .coerceAtMost(86_400L)
    }

    fun isValidDownloadedFile(status: Int, bytes: Long, hasUri: Boolean): Boolean =
        status == android.app.DownloadManager.STATUS_SUCCESSFUL && hasUri && bytes > 0L
}
