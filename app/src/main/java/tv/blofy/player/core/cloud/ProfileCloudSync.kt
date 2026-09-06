package tv.blofy.player.core.cloud

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.profile.ProfileLibraryStore
import java.security.MessageDigest

/**
 * Conflict-safe profile UX synchronization.
 * Playback/catalog data never leaves the local database through this layer.
 */
object ProfileCloudSync {
    data class Result(
        val action: String,
        val revision: Long,
        val changedLocal: Boolean = false,
    )

    private const val PREFS = "blofy_profile_cloud_state_v1"
    private val mutex = Mutex()

    suspend fun syncActive(context: Context): Result? = mutex.withLock {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return@withLock null
        val profile = ProfileStore.active(context)
        if (profile.guest) return@withLock null
        sync(context.applicationContext, endpoint, profile.id)
    }

    suspend fun backupActive(context: Context): Result? = mutex.withLock {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return@withLock null
        val profile = ProfileStore.active(context)
        if (profile.guest) return@withLock null
        val remote = ProfileCloudClient.get(context, endpoint, profile.id)
        val payload = ProfileLibraryStore.snapshotJson(context, profile.id)
        when (val saved = ProfileCloudClient.put(context, endpoint, profile.id, remote.revision, payload)) {
            is ProfileCloudClient.SaveResult.Saved -> {
                remember(context, profile.id, saved.revision, fingerprint(saved.payload))
                Result("backup", saved.revision)
            }
            is ProfileCloudClient.SaveResult.Conflict -> Result("deferred", saved.revision)
        }
    }

    suspend fun restoreActive(context: Context): Result? = mutex.withLock {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return@withLock null
        val profile = ProfileStore.active(context)
        if (profile.guest) return@withLock null
        val remote = ProfileCloudClient.get(context, endpoint, profile.id)
        if (!remote.exists) return@withLock Result("no_backup", 0L)
        ProfileLibraryStore.restoreSnapshot(context, profile.id, remote.payload)
        remember(context, profile.id, remote.revision, fingerprint(ProfileLibraryStore.snapshotJson(context, profile.id)))
        Result("restore", remote.revision, changedLocal = true)
    }

    suspend fun createPairCodeActive(context: Context): ProfileCloudClient.PairCode? = mutex.withLock {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return@withLock null
        val profile = ProfileStore.active(context)
        if (profile.guest) return@withLock null

        val remote = ProfileCloudClient.get(context, endpoint, profile.id)
        val payload = ProfileLibraryStore.snapshotJson(context, profile.id)
        when (val saved = ProfileCloudClient.put(context, endpoint, profile.id, remote.revision, payload)) {
            is ProfileCloudClient.SaveResult.Saved -> remember(context, profile.id, saved.revision, fingerprint(saved.payload))
            is ProfileCloudClient.SaveResult.Conflict -> {
                val newest = ProfileCloudClient.get(context, endpoint, profile.id)
                val merged = merge(newest.payload, payload)
                val retried = ProfileCloudClient.put(context, endpoint, profile.id, newest.revision, merged)
                if (retried is ProfileCloudClient.SaveResult.Saved) {
                    ProfileLibraryStore.restoreSnapshot(context, profile.id, retried.payload)
                    remember(context, profile.id, retried.revision, fingerprint(retried.payload))
                } else return@withLock null
            }
        }
        ProfileCloudClient.createPairCode(context, endpoint, profile.id)
    }

    suspend fun restorePairActive(context: Context, code: String): Result? = mutex.withLock {
        val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
        if (endpoint.isBlank()) return@withLock null
        val profile = ProfileStore.active(context)
        if (profile.guest) return@withLock null
        val restored = ProfileCloudClient.restorePairCode(context, endpoint, profile.id, code)
        ProfileLibraryStore.restoreSnapshot(context, profile.id, restored.payload)
        remember(context, profile.id, restored.revision, fingerprint(ProfileLibraryStore.snapshotJson(context, profile.id)))
        Result("pair_restore", restored.revision, changedLocal = true)
    }

    fun lastSyncAt(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("$profileId:last_sync", 0L)

    fun knownRevision(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("$profileId:revision", 0L)

    suspend fun sync(context: Context, endpoint: String, profileId: String): Result {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val revisionKey = "$profileId:revision"
        val fingerprintKey = "$profileId:fingerprint"
        val knownRevision = prefs.getLong(revisionKey, 0L)
        val lastFingerprint = prefs.getString(fingerprintKey, null)

        var localPayload = ProfileLibraryStore.snapshotJson(context, profileId)
        var localFingerprint = fingerprint(localPayload)
        var remote = ProfileCloudClient.get(context, endpoint, profileId)

        if (!remote.exists) {
            val saved = ProfileCloudClient.put(context, endpoint, profileId, 0L, localPayload)
            if (saved is ProfileCloudClient.SaveResult.Saved) {
                remember(context, profileId, saved.revision, fingerprint(saved.payload))
                return Result("uploaded", saved.revision)
            }
            remote = ProfileCloudClient.get(context, endpoint, profileId)
        }

        val localUnchangedSinceSync = lastFingerprint != null && lastFingerprint == localFingerprint
        val remoteAdvanced = remote.revision > knownRevision

        if (remoteAdvanced && (localUnchangedSinceSync || isEffectivelyEmpty(localPayload))) {
            ProfileLibraryStore.restoreSnapshot(context, profileId, remote.payload)
            localPayload = ProfileLibraryStore.snapshotJson(context, profileId)
            localFingerprint = fingerprint(localPayload)
            remember(context, profileId, remote.revision, localFingerprint)
            return Result("restored", remote.revision, changedLocal = true)
        }

        if (remoteAdvanced && !localUnchangedSinceSync) {
            val merged = merge(remote.payload, localPayload)
            return saveWithOneRetry(context, endpoint, profileId, remote.revision, merged, changedLocal = true)
        }

        if (knownRevision == remote.revision && lastFingerprint == localFingerprint) {
            return Result("unchanged", remote.revision)
        }

        return saveWithOneRetry(context, endpoint, profileId, remote.revision, localPayload, changedLocal = false)
    }

    private suspend fun saveWithOneRetry(
        context: Context,
        endpoint: String,
        profileId: String,
        expectedRevision: Long,
        payload: JSONObject,
        changedLocal: Boolean,
    ): Result {
        return when (val first = ProfileCloudClient.put(context, endpoint, profileId, expectedRevision, payload)) {
            is ProfileCloudClient.SaveResult.Saved -> {
                ProfileLibraryStore.restoreSnapshot(context, profileId, first.payload)
                remember(context, profileId, first.revision, fingerprint(first.payload))
                Result("uploaded", first.revision, changedLocal)
            }
            is ProfileCloudClient.SaveResult.Conflict -> {
                val newest = ProfileCloudClient.get(context, endpoint, profileId)
                val merged = merge(newest.payload, payload)
                when (val second = ProfileCloudClient.put(context, endpoint, profileId, newest.revision, merged)) {
                    is ProfileCloudClient.SaveResult.Saved -> {
                        ProfileLibraryStore.restoreSnapshot(context, profileId, second.payload)
                        remember(context, profileId, second.revision, fingerprint(second.payload))
                        Result("merged", second.revision, changedLocal = true)
                    }
                    is ProfileCloudClient.SaveResult.Conflict -> Result("deferred", second.revision)
                }
            }
        }
    }

    private fun merge(remote: JSONObject, local: JSONObject): JSONObject {
        val remoteWatch = remote.optJSONArray("watchlist").strings(500)
        val localWatch = local.optJSONArray("watchlist").strings(500)
        val mergedWatch = LinkedHashSet<String>().apply { addAll(remoteWatch); addAll(localWatch) }.toList().takeLast(500)

        val remoteHidden = remote.optJSONArray("hiddenCategories").strings(500)
        val localHidden = local.optJSONArray("hiddenCategories").strings(500)
        val mergedHidden = LinkedHashSet<String>().apply { addAll(remoteHidden); addAll(localHidden) }.toList().take(500)

        val localRows = local.optJSONArray("homeRows").strings(20).filter { it in ProfileLibraryStore.ALL_HOME_ROWS }
        val remoteRows = remote.optJSONArray("homeRows").strings(20).filter { it in ProfileLibraryStore.ALL_HOME_ROWS }
        val rows = (if (localRows.isNotEmpty()) localRows else remoteRows).distinct()

        // Settings are explicit user intent. Start with the remote snapshot, then let the
        // currently edited device win key-by-key. The service independently sanitizes this map.
        val settings = JSONObject()
        copySettings(remote.optJSONObject("settings"), settings)
        copySettings(local.optJSONObject("settings"), settings)

        return JSONObject().apply {
            put("watchlist", JSONArray(mergedWatch))
            put("hiddenCategories", JSONArray(mergedHidden))
            put("homeRows", JSONArray(rows))
            put("settings", settings)
        }
    }

    private fun copySettings(source: JSONObject?, target: JSONObject) {
        if (source == null) return
        val keys = source.keys()
        var count = target.length()
        while (keys.hasNext() && count < 80) {
            val key = keys.next()
            if (!Regex("[A-Za-z0-9._-]{1,64}").matches(key)) continue
            when (val value = source.opt(key)) {
                is String -> target.put(key, value.take(256))
                is Boolean, is Int, is Long, is Double -> target.put(key, value)
                else -> continue
            }
            count++
        }
    }

    private fun JSONArray?.strings(limit: Int): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (i in 0 until length()) {
                optString(i).trim().takeIf(String::isNotBlank)?.let(::add)
                if (size >= limit) break
            }
        }.distinct()
    }

    private fun isEffectivelyEmpty(payload: JSONObject): Boolean =
        payload.optJSONArray("watchlist").strings(1).isEmpty() &&
            payload.optJSONArray("hiddenCategories").strings(1).isEmpty() &&
            payload.optJSONArray("homeRows").strings(20) == ProfileLibraryStore.DEFAULT_HOME_ROWS &&
            (payload.optJSONObject("settings")?.length() ?: 0) == 0

    private fun fingerprint(payload: JSONObject): String = MessageDigest.getInstance("SHA-256")
        .digest(payload.toString().toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun remember(context: Context, profileId: String, revision: Long, fingerprint: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("$profileId:revision", revision)
            .putString("$profileId:fingerprint", fingerprint)
            .putLong("$profileId:last_sync", System.currentTimeMillis())
            .apply()
    }
}
