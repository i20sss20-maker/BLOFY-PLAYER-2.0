package tv.blofy.player.ui.catalog

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class RelatedSeriesPolicyTest {
    private fun series(key:String,genre:String?=null,kind:String="series") =
        StreamEntity(key=key,providerId="p",remoteId=key,categoryId="series",
            kind=kind,name=key,genre=genre)
    @Test fun onlyConfirmedSharedSourceGenresQualify() {
        val current=series("a","Crime")
        val items=listOf(series("b","Crime"),series("c","Comedy"),
            series("d",null),series("e","Crime","movie"),current)
        assertEquals(listOf("b"),RelatedSeriesPolicy.rank(current,emptyList(),items,emptyMap()).map{it.key})
    }
    @Test fun savedDetailMetadataEnablesRelatedSeries() {
        val current=series("a")
        val items=listOf(series("b"),series("c","Action"))
        val related=RelatedSeriesPolicy.rank(current,listOf("Drama"),items,emptyMap(),
            cachedGenres=mapOf("b" to listOf("Drama")))
        assertEquals(listOf("b"),related.map{it.key})
    }
    @Test fun noFalseRecommendationsWhenGenreMissing() {
        assertTrue(RelatedSeriesPolicy.rank(series("a"),emptyList(),
            listOf(series("b")),emptyMap()).isEmpty())
    }
}
