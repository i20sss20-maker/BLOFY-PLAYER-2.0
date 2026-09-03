package tv.blofy.player.data.local

import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.FtsOptions

@Fts4(tokenizer = FtsOptions.TOKENIZER_UNICODE61)
@Entity(tableName = "streams_fts")
data class StreamSearchFtsEntity(
    val contentKey: String,
    val providerId: String,
    val kind: String,
    val searchable: String
)
