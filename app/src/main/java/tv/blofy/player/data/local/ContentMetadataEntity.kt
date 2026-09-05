package tv.blofy.player.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "content_metadata",
    indices = [Index("providerId")]
)
data class ContentMetadataEntity(
    @PrimaryKey val contentKey: String,
    val providerId: String,
    /** Serialized provider-only metadata. Empty string means the provider returned no extra details. */
    val payloadJson: String,
    val updatedAt: Long = System.currentTimeMillis()
)
