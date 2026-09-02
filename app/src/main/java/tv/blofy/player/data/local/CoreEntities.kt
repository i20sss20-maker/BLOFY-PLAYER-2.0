package tv.blofy.player.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "providers")
data class ProviderEntity(
    @PrimaryKey val id: String,
    val name: String,
    val baseUrl: String,
    val username: String,
    val password: String,
    val providerType: String = "xtream",
    val liveFormat: String = "ts",
    val preferredTransport: String = "cronet",
    val preferredEngine: String = "media3",
    val allowCrossProtocolRedirects: Boolean = true,
    val enabled: Boolean = true,
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "categories",
    indices = [
        Index("providerId"),
        Index("kind"),
        Index(value = ["providerId", "kind", "orderIndex"])
    ]
)
data class CategoryEntity(
    @PrimaryKey val key: String,
    val providerId: String,
    val remoteId: String,
    val kind: String,
    val name: String,
    val orderIndex: Int = 0,
    val hidden: Boolean = false
)

@Entity(
    tableName = "streams",
    indices = [
        Index("providerId"),
        Index("categoryId"),
        Index("kind"),
        Index(value = ["providerId", "kind", "categoryId", "name"]),
        Index(value = ["providerId", "kind", "name"]),
        Index(value = ["providerId", "name"]),
        Index(value = ["providerId", "kind", "addedAt"])
    ]
)
data class StreamEntity(
    @PrimaryKey val key: String,
    val providerId: String,
    val remoteId: String,
    val categoryId: String?,
    val kind: String,
    val name: String,
    val icon: String? = null,
    val extension: String? = null,
    val directSource: String? = null,
    val epgChannelId: String? = null,
    val streamType: String? = null,
    val addedAt: Long? = null,
    val plot: String? = null,
    val genre: String? = null,
    val releaseDate: String? = null,
    val year: String? = null,
    val rating: String? = null,
    val duration: String? = null,
    val backdrop: String? = null,
    val archiveEnabled: Boolean = false,
    val archiveDurationDays: Int = 0,
    val favorite: Boolean = false,
    val locked: Boolean = false
)

@Entity(tableName = "episodes", indices = [Index("providerId"), Index("seriesId"), Index("season")])
data class EpisodeEntity(
    @PrimaryKey val key: String,
    val providerId: String,
    val seriesId: String,
    val remoteId: String,
    val season: Int,
    val episode: Int,
    val title: String,
    val extension: String = "mp4",
    val directSource: String? = null,
    val durationSecs: Long? = null
)

@Entity(tableName = "watch_state", indices = [Index("providerId"), Index("kind")])
data class WatchStateEntity(
    @PrimaryKey val contentKey: String,
    val providerId: String,
    val kind: String,
    val positionMs: Long,
    val durationMs: Long,
    val completed: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "epg", indices = [Index("providerId"), Index("streamId"), Index("startMs")])
data class EpgEntity(
    @PrimaryKey val key: String,
    val providerId: String,
    val streamId: String,
    val title: String,
    val description: String? = null,
    val startMs: Long,
    val endMs: Long
)

@Entity(tableName = "activation")
data class ActivationEntity(
    @PrimaryKey val deviceId: String,
    val activationCode: String,
    val activated: Boolean = false,
    val expiresAt: Long? = null,
    val lastCheckAt: Long = 0L
)
