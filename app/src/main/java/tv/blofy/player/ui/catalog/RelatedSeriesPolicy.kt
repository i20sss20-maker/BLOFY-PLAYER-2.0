package tv.blofy.player.ui.catalog

import tv.blofy.player.data.local.StreamEntity

/** Pure catalog-based series recommendations; no watch history leaves device. */
internal object RelatedSeriesPolicy {
    fun rank(
        current: StreamEntity,
        detailGenres: List<String>,
        nearby: List<StreamEntity>,
        categoryNames: Map<String,String>,
        cachedGenres: Map<String,List<String>> = emptyMap(),
        limit: Int = 12
    ): List<StreamEntity> {
        val source=MovieGenres.identify(
            listOfNotNull(current.genre,detailGenres.joinToString(",")).joinToString(","),
            categoryNames[current.categoryId])
        if (source.isEmpty()) return emptyList()
        return nearby.asSequence()
            .filter { it.kind=="series" && it.key!=current.key && !it.locked }
            .map { item ->
                val genres=MovieGenres.identify(
                    listOfNotNull(item.genre,cachedGenres[item.key].orEmpty().joinToString(","))
                        .joinToString(","),categoryNames[item.categoryId])
                item to source.intersect(genres).size
            }
            .filter { it.second>0 }
            .sortedWith(compareByDescending<Pair<StreamEntity,Int>> { it.second }
                .thenByDescending { it.first.rating?.toDoubleOrNull() ?: 0.0 }
                .thenBy { it.first.key })
            .map { it.first }.distinctBy {it.key}
            .take(limit.coerceIn(1,16)).toList()
    }
}
