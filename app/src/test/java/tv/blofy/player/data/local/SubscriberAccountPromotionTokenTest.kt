package tv.blofy.player.data.local

import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.core.identity.BlofySubscriberClient

/** Exercises the actual Room DAO + existing AES-GCM fixture; no network or production accounts. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
class SubscriberAccountPromotionTokenTest {
    private lateinit var db: BlofyDatabase
    private val original = ProviderEntity("saved-account", "Saved", "https://fixture.example.test",
        "user-a", "pass-a", updatedAt = 100L, subscriberToken = "session-a")
    private val replacement = original.copy(username = "user-b", password = "pass-b",
        updatedAt = 200L, subscriberToken = "session-b")
    private val stagedId = "candidate-only"
    private val resume = WatchStateEntity("${original.id}:movie:1", original.id, "movie", 12_000L, 60_000L)
    private val activation = ActivationEntity("BLOFY-TEST-ONLY", "123456", activated = true)

    private suspend fun seed(provider: ProviderEntity) {
        db.dao().upsertProviderStored(provider)
        db.dao().replaceCatalog(provider.id, "movie", emptyList(), listOf(
            StreamEntity("${provider.id}:movie:1", provider.id, "1", null, "movie", "Fixture movie")
        ))
    }

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
        seed(original)
        db.dao().saveWatchState(resume)
        db.dao().upsertActivation(activation)
    }
    @After fun cleanup() = db.close()

    private suspend fun assertNewAccount() {
        val saved = checkNotNull(db.dao().provider(original.id))
        assertEquals(replacement.username, saved.username)
        assertEquals(replacement.password, saved.password)
        assertEquals(replacement.subscriberToken, saved.subscriberToken)
        val mirrored = BlofySubscriberClient.portalSource(saved, "https://portal.example.test")
        assertEquals("session-b", mirrored.username)
        assertEquals("https://portal.example.test/api/v1/subscribers/xtream", mirrored.baseUrl)
        assertEquals(resume, db.dao().watchState(resume.contentKey))
        assertEquals(activation, db.dao().activation())
    }

    @Test fun explicitReplacementCommitsTheNewSessionToken(): Unit = runBlocking(Dispatchers.IO) {
        seed(replacement.copy(id = stagedId, enabled = false))
        db.dao().promoteExplicitSourceReplacement(stagedId, replacement, original)
        assertNewAccount()
    }

    @Test fun foregroundSourceChangeCommitsTheNewSessionToken(): Unit = runBlocking(Dispatchers.IO) {
        seed(replacement.copy(id = stagedId, enabled = false))
        db.dao().promoteStagedRefresh(stagedId, replacement, expectedSource = original)
        assertNewAccount()
    }

    @Test fun backgroundSourceChangeCommitsTheNewSessionToken(): Unit = runBlocking(Dispatchers.IO) {
        seed(replacement.copy(id = stagedId, enabled = false))
        db.dao().promoteStagedBackgroundRefresh(stagedId, original, replacement)
        assertNewAccount()
    }

    @Test fun failedReplacementKeepsOldAccountAndRetryCommitsNewAccount(): Unit = runBlocking(Dispatchers.IO) {
        assertTrue(runCatching {
            db.dao().promoteExplicitSourceReplacement(stagedId, replacement, original)
        }.isFailure)
        assertEquals(original, db.dao().provider(original.id))
        assertEquals(1, db.dao().catalogCountAll(original.id, "movie"))
        seed(replacement.copy(id = stagedId, enabled = false))
        db.dao().promoteExplicitSourceReplacement(stagedId, replacement, original)
        assertNewAccount()
    }

    @Test fun addingSeparateAccountDoesNotReplaceTheFirst(): Unit = runBlocking(Dispatchers.IO) {
        val added = replacement.copy(id = "independent-account")
        seed(added)
        db.dao().saveAndActivateProvider(added)
        assertEquals(original.copy(enabled = false), db.dao().provider(original.id))
        assertEquals(1, db.dao().catalogCountAll(original.id, "movie"))
        assertEquals(replacement.subscriberToken, db.dao().provider(added.id)?.subscriberToken)
        assertEquals(resume, db.dao().watchState(resume.contentKey))
    }

    @Test fun olderSameSourceForegroundRefreshDoesNotUndoTokenRenewal(): Unit = runBlocking(Dispatchers.IO) {
        seed(original.copy(id = stagedId, enabled = false))
        db.dao().upsertProviderStored(original.copy(subscriberToken = "renewed-session"))
        db.dao().promoteStagedRefresh(stagedId, original, expectedSource = original)
        assertEquals("renewed-session", db.dao().provider(original.id)?.subscriberToken)
    }

    @Test fun olderSameSourceBackgroundRefreshDoesNotUndoTokenRenewal(): Unit = runBlocking(Dispatchers.IO) {
        seed(original.copy(id = stagedId, enabled = false))
        db.dao().upsertProviderStored(original.copy(subscriberToken = "renewed-session"))
        db.dao().promoteStagedBackgroundRefresh(stagedId, original, original)
        assertEquals("renewed-session", db.dao().provider(original.id)?.subscriberToken)
    }

    @Test fun staleAccountReplacementCannotOverwriteLaterCredentials(): Unit = runBlocking(Dispatchers.IO) {
        seed(replacement.copy(id = stagedId, enabled = false))
        val newer = original.copy(username = "user-c", password = "pass-c", subscriberToken = "session-c")
        db.dao().upsertProviderStored(newer)
        assertTrue(runCatching { db.dao().promoteExplicitSourceReplacement(stagedId, replacement, original) }.isFailure)
        assertEquals(newer, db.dao().provider(original.id))
        assertEquals(1, db.dao().catalogCountAll(original.id, "movie"))
    }
}
