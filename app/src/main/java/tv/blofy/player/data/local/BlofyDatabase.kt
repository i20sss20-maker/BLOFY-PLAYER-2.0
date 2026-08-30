package tv.blofy.player.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        ProviderEntity::class,
        CategoryEntity::class,
        StreamEntity::class,
        EpisodeEntity::class,
        WatchStateEntity::class
    ],
    version = 1,
    exportSchema = true
)
abstract class BlofyDatabase : RoomDatabase() {
    abstract fun dao(): BlofyDao

    companion object {
        @Volatile private var instance: BlofyDatabase? = null

        fun get(context: Context): BlofyDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                BlofyDatabase::class.java,
                "blofy-player-2.db"
            ).fallbackToDestructiveMigration().build().also { instance = it }
        }
    }
}
