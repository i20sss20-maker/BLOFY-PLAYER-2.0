package tv.blofy.player.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import tv.blofy.player.core.text.ArabicSearchNormalizer

internal const val BLOFY_DATABASE_VERSION = 9

@Database(
    entities = [
        ProviderEntity::class,
        CategoryEntity::class,
        StreamEntity::class,
        EpisodeEntity::class,
        WatchStateEntity::class,
        EpgEntity::class,
        ActivationEntity::class,
        StreamSearchFtsEntity::class
    ],
    version = BLOFY_DATABASE_VERSION,
    exportSchema = false
)
abstract class BlofyDatabase : RoomDatabase() {
    abstract fun dao(): BlofyDao

    companion object {
        @Volatile private var instance: BlofyDatabase? = null

        internal val ALL_MIGRATIONS = arrayOf(
            object : Migration(1, 2) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        """
                        CREATE TABLE IF NOT EXISTS `epg` (
                            `key` TEXT NOT NULL,
                            `providerId` TEXT NOT NULL,
                            `streamId` TEXT NOT NULL,
                            `title` TEXT NOT NULL,
                            `description` TEXT,
                            `startMs` INTEGER NOT NULL,
                            `endMs` INTEGER NOT NULL,
                            PRIMARY KEY(`key`)
                        )
                        """.trimIndent()
                    )
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_epg_providerId` ON `epg` (`providerId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_epg_streamId` ON `epg` (`streamId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_epg_startMs` ON `epg` (`startMs`)")
                    db.execSQL(
                        """
                        CREATE TABLE IF NOT EXISTS `activation` (
                            `deviceId` TEXT NOT NULL,
                            `activationCode` TEXT NOT NULL,
                            `activated` INTEGER NOT NULL,
                            `expiresAt` INTEGER,
                            `lastCheckAt` INTEGER NOT NULL,
                            PRIMARY KEY(`deviceId`)
                        )
                        """.trimIndent()
                    )
                }
            },
            object : Migration(2, 3) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        """
                        CREATE TABLE `providers_new` (
                            `id` TEXT NOT NULL,
                            `name` TEXT NOT NULL,
                            `baseUrl` TEXT NOT NULL,
                            `username` TEXT NOT NULL,
                            `password` TEXT NOT NULL,
                            `providerType` TEXT NOT NULL,
                            `liveFormat` TEXT NOT NULL,
                            `preferredTransport` TEXT NOT NULL,
                            `preferredEngine` TEXT NOT NULL,
                            `allowCrossProtocolRedirects` INTEGER NOT NULL,
                            `enabled` INTEGER NOT NULL,
                            `updatedAt` INTEGER NOT NULL,
                            PRIMARY KEY(`id`)
                        )
                        """.trimIndent()
                    )
                    db.execSQL(
                        """
                        INSERT INTO `providers_new` (
                            `id`, `name`, `baseUrl`, `username`, `password`, `providerType`,
                            `liveFormat`, `preferredTransport`, `preferredEngine`,
                            `allowCrossProtocolRedirects`, `enabled`, `updatedAt`
                        )
                        SELECT
                            `id`, `name`, `baseUrl`, `username`, `password`, 'xtream',
                            `liveFormat`, `preferredTransport`, `preferredEngine`,
                            `allowCrossProtocolRedirects`, `enabled`, `updatedAt`
                        FROM `providers`
                        """.trimIndent()
                    )
                    db.execSQL("DROP TABLE `providers`")
                    db.execSQL("ALTER TABLE `providers_new` RENAME TO `providers`")
                }
            },
            object : Migration(3, 4) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `plot` TEXT")
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `genre` TEXT")
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `releaseDate` TEXT")
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `year` TEXT")
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `rating` TEXT")
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `duration` TEXT")
                    db.execSQL("ALTER TABLE `streams` ADD COLUMN `backdrop` TEXT")
                }
            },
            object : Migration(4, 5) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        """
                        CREATE TABLE `streams_new` (
                            `key` TEXT NOT NULL,
                            `providerId` TEXT NOT NULL,
                            `remoteId` TEXT NOT NULL,
                            `categoryId` TEXT,
                            `kind` TEXT NOT NULL,
                            `name` TEXT NOT NULL,
                            `icon` TEXT,
                            `extension` TEXT,
                            `directSource` TEXT,
                            `epgChannelId` TEXT,
                            `streamType` TEXT,
                            `addedAt` INTEGER,
                            `plot` TEXT,
                            `genre` TEXT,
                            `releaseDate` TEXT,
                            `year` TEXT,
                            `rating` TEXT,
                            `duration` TEXT,
                            `backdrop` TEXT,
                            `archiveEnabled` INTEGER NOT NULL,
                            `archiveDurationDays` INTEGER NOT NULL,
                            `favorite` INTEGER NOT NULL,
                            `locked` INTEGER NOT NULL,
                            PRIMARY KEY(`key`)
                        )
                        """.trimIndent()
                    )
                    db.execSQL(
                        """
                        INSERT INTO `streams_new` (
                            `key`, `providerId`, `remoteId`, `categoryId`, `kind`, `name`,
                            `icon`, `extension`, `directSource`, `epgChannelId`, `streamType`,
                            `addedAt`, `plot`, `genre`, `releaseDate`, `year`, `rating`,
                            `duration`, `backdrop`, `archiveEnabled`, `archiveDurationDays`,
                            `favorite`, `locked`
                        )
                        SELECT
                            `key`, `providerId`, `remoteId`, `categoryId`, `kind`, `name`,
                            `icon`, `extension`, `directSource`, `epgChannelId`, `streamType`,
                            `addedAt`, `plot`, `genre`, `releaseDate`, `year`, `rating`,
                            `duration`, `backdrop`, 0, 0, `favorite`, `locked`
                        FROM `streams`
                        """.trimIndent()
                    )
                    db.execSQL("DROP TABLE `streams`")
                    db.execSQL("ALTER TABLE `streams_new` RENAME TO `streams`")
                    db.execSQL("CREATE INDEX `index_streams_providerId` ON `streams` (`providerId`)")
                    db.execSQL("CREATE INDEX `index_streams_categoryId` ON `streams` (`categoryId`)")
                    db.execSQL("CREATE INDEX `index_streams_kind` ON `streams` (`kind`)")
                }
            },
            object : Migration(5, 6) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL("UPDATE `streams` SET `locked` = 0 WHERE `locked` != 0")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_categories_providerId_kind_orderIndex` ON `categories` (`providerId`, `kind`, `orderIndex`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_kind_categoryId_name` ON `streams` (`providerId`, `kind`, `categoryId`, `name`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_name` ON `streams` (`providerId`, `name`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_kind_addedAt` ON `streams` (`providerId`, `kind`, `addedAt`)")
                }
            },
            object : Migration(6, 7) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_categories_providerId` ON `categories` (`providerId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_categories_kind` ON `categories` (`kind`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_categories_providerId_kind_orderIndex` ON `categories` (`providerId`, `kind`, `orderIndex`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId` ON `streams` (`providerId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_categoryId` ON `streams` (`categoryId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_kind` ON `streams` (`kind`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_kind_categoryId_name` ON `streams` (`providerId`, `kind`, `categoryId`, `name`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_name` ON `streams` (`providerId`, `name`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_kind_addedAt` ON `streams` (`providerId`, `kind`, `addedAt`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_episodes_providerId` ON `episodes` (`providerId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_episodes_seriesId` ON `episodes` (`seriesId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_episodes_season` ON `episodes` (`season`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_watch_state_providerId` ON `watch_state` (`providerId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_watch_state_kind` ON `watch_state` (`kind`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_epg_providerId` ON `epg` (`providerId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_epg_streamId` ON `epg` (`streamId`)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_epg_startMs` ON `epg` (`startMs`)")
                }
            },
            object : Migration(7, 8) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL("CREATE INDEX IF NOT EXISTS `index_streams_providerId_kind_name` ON `streams` (`providerId`, `kind`, `name`)")
                }
            },
            object : Migration(8, 9) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        """
                        CREATE VIRTUAL TABLE IF NOT EXISTS `streams_fts`
                        USING FTS4(`contentKey`, `providerId`, `kind`, `searchable`, tokenize=unicode61)
                        """.trimIndent()
                    )
                    // Existing installs get an immediately usable index. New/changed rows are
                    // maintained by BlofyDao delta-sync transactions after migration.
                    val cursor = db.query(
                        "SELECT `key`, providerId, kind, name, genre, year, plot, releaseDate, streamType FROM streams"
                    )
                    val insert = db.compileStatement(
                        "INSERT INTO streams_fts(contentKey,providerId,kind,searchable) VALUES(?,?,?,?)"
                    )
                    cursor.use {
                        while (it.moveToNext()) {
                            val contentKey = it.getString(0)
                            val providerId = it.getString(1)
                            val kind = it.getString(2)
                            val searchable = ArabicSearchNormalizer.searchable(
                                it.getString(3),
                                it.getString(4),
                                it.getString(5),
                                it.getString(6),
                                it.getString(7),
                                it.getString(8)
                            )
                            insert.clearBindings()
                            insert.bindString(1, contentKey)
                            insert.bindString(2, providerId)
                            insert.bindString(3, kind)
                            insert.bindString(4, searchable)
                            insert.executeInsert()
                        }
                    }
                }
            }
        )

        fun get(context: Context): BlofyDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                BlofyDatabase::class.java,
                "blofy-player-2.db"
            ).addMigrations(*ALL_MIGRATIONS).build().also { instance = it }
        }
    }
}
