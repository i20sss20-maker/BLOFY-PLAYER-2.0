package tv.blofy.player.data.local

import org.junit.Assert.assertEquals
import org.junit.Test

class BlofyDatabaseMigrationTest {
    @Test
    fun `migrations preserve every published database version`() {
        val migrationPath = BlofyDatabase.ALL_MIGRATIONS.map {
            it.startVersion to it.endVersion
        }

        assertEquals(
            listOf(
                1 to 2,
                2 to 3,
                3 to 4,
                4 to 5,
                5 to 6,
                6 to 7,
                7 to 8,
                8 to 9,
                9 to 10
            ),
            migrationPath
        )
        assertEquals(BLOFY_DATABASE_VERSION, migrationPath.last().second)
    }
}
