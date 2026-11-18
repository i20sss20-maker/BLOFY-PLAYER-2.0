package tv.blofy.player.data

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity

class StreamCatalogDeltaParserTest {
    private val providerId = "active-code-provider"

    @Test fun updatedMoviePreservesFavoriteAndLockedStateWithoutExposingSourceCredentials() {
        val previous = StreamEntity(
            key = "$providerId:movie:452", providerId = providerId,
            remoteId = "452", categoryId = "2", kind = "movie",
            name = "Old title", extension = "mp4", genre = "Action",
            plot = "Cached description", favorite = true, locked = true
        )
        val row = StreamCatalogDeltaParser.item(providerId, "movie", mapOf(
            "stream_id" to 452.0, "name" to "New title",
            "stream_icon" to "https://images.example/movie.jpg",
            "category_id" to 3.0, "container_extension" to "mkv"
        ), previous)
        assertNotNull(row)
        val newer = checkNotNull(row)
        assertEquals("452", newer.remoteId)
        assertEquals("$providerId:movie:452", newer.key)
        assertEquals("3", newer.categoryId)
        assertEquals("New title", newer.name)
        assertEquals("mkv", newer.extension)
        assertTrue(newer.favorite)
        assertTrue(newer.locked)
        assertEquals("Cached description", newer.plot)
        assertNull(newer.directSource)
    }

    @Test fun seriesDeltaRetainsCachedMetadataWithoutRenamingProvider() {
        val previous = StreamEntity(
            key = "$providerId:series:14", providerId = providerId, remoteId = "14",
            categoryId = "7", kind = "series", name = "Series",
            plot = "Old detail", addedAt = 5L
        )
        val value = StreamCatalogDeltaParser.item(providerId,"series",mapOf(
            "series_id" to 14.0,"name" to "Updated",
            "cover" to "https://images.example/cover.png",
            "last_modified" to "100"
        ), previous)
        assertNotNull(value)
        assertEquals("14",value?.remoteId)
        assertEquals("Updated",value?.name)
        assertEquals("Old detail",value?.plot)
        assertEquals(100L,value?.addedAt)
    }

    @Test fun categoryRetainsHiddenFlagDuringSync() {
        val old=CategoryEntity("$providerId:live:9",providerId,"9","live","Old",9,true)
        val row=StreamCatalogDeltaParser.category(providerId,"live",mapOf(
            "category_id" to 9.0,"category_name" to "Sport"
        ),old)
        assertTrue(row?.hidden==true)
        assertEquals("Sport",row?.name)
        assertEquals(9,row?.orderIndex)
    }

    @Test fun badRowsAreNeverImported() {
        assertNull(StreamCatalogDeltaParser.item(providerId,"movie",mapOf("name" to "No ID")))
        assertNull(StreamCatalogDeltaParser.item(providerId,"movie",mapOf("stream_id" to 5)))
        assertNull(StreamCatalogDeltaParser.category(providerId,"random",mapOf(
            "category_id" to "2","category_name" to "bad")))
    }
}
