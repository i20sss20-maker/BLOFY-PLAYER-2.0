package tv.blofy.player.core.playback

import androidx.room.InvalidationTracker
import tv.blofy.player.data.local.BlofyDatabase

/** Keeps the in-memory channel window aligned with catalog refreshes and provider changes. */
object SmartZappingInvalidator {
    @Volatile
    private var installed = false

    @Synchronized
    fun install(database: BlofyDatabase) {
        if (installed) return
        database.invalidationTracker.addObserver(
            object : InvalidationTracker.Observer("streams", "providers") {
                override fun onInvalidated(tables: Set<String>) {
                    SmartZappingCache.clear()
                }
            }
        )
        installed = true
    }
}
