package tv.blofy.player.data.preparation

import android.database.sqlite.SQLiteOpenHelper
import org.junit.rules.ExternalResource
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.metadata.ProviderMetadataCache

/** App singletons must not outlive Robolectric's per-test SQLite connections. */
internal class DatabaseIsolationRule : ExternalResource() {
    private val catalog = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private val metadata = ProviderMetadataCache::class.java.getDeclaredField("helper").apply { isAccessible = true }

    override fun before() {
        catalog.set(null, null)
        metadata.set(null, null)
    }

    override fun after() {
        val database = catalog.get(null) as? BlofyDatabase
        val helper = metadata.get(null) as? SQLiteOpenHelper
        catalog.set(null, null)
        metadata.set(null, null)
        try { database?.close() } finally { helper?.close() }
    }
}
