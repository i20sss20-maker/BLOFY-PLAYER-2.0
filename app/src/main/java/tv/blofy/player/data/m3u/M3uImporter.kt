package tv.blofy.player.data.m3u

import kotlinx.coroutines.flow.first
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.util.UUID
import java.util.concurrent.TimeUnit

class M3uImporter(
    private val dao: BlofyDao,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
) {
    suspend fun sync(provider: ProviderEntity) {
        val request = Request.Builder()
            .url(provider.baseUrl)
            .header("User-Agent", "BLOFY PLAYER/2.0")
            .build()
        val text = client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("M3U HTTP ${response.code}")
            response.body?.string() ?: error("Empty M3U playlist")
        }
        val entries = M3uParser.parse(text)
        if (entries.isEmpty()) error("No playable M3U entries")

        listOf("live", "movie").forEach { kind ->
            val kindEntries = entries.filter { it.kind == kind }
            val favorites = dao.streams(provider.id, kind, null).first().associate { it.key to (it.favorite to it.locked) }
            val groups = kindEntries.map { it.group }.distinct()

            dao.clearCategories(provider.id, kind)
            dao.clearStreams(provider.id, kind)

            dao.upsertCategories(groups.mapIndexed { index, group ->
                val groupId = stableId(group)
                CategoryEntity(
                    key = "${provider.id}:$kind:$groupId",
                    providerId = provider.id,
                    remoteId = groupId,
                    kind = kind,
                    name = group,
                    orderIndex = index
                )
            })

            val groupIds = groups.associateWith(::stableId)
            dao.upsertStreams(kindEntries.map { entry ->
                val remoteId = stableId(entry.url)
                val key = "${provider.id}:$kind:$remoteId"
                val flags = favorites[key]
                StreamEntity(
                    key = key,
                    providerId = provider.id,
                    remoteId = remoteId,
                    categoryId = groupIds[entry.group],
                    kind = kind,
                    name = entry.name,
                    icon = entry.logo,
                    extension = entry.url.substringBefore('?').substringAfterLast('.', "").takeIf { it.length in 2..5 },
                    directSource = entry.url,
                    epgChannelId = entry.tvgId,
                    favorite = flags?.first ?: false,
                    locked = flags?.second ?: false
                )
            })
        }
    }

    private fun stableId(value: String): String = UUID.nameUUIDFromBytes(value.toByteArray()).toString()
}
