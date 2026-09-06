package tv.blofy.player.data.profile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Lightweight profile state intentionally lives outside the playback/catalog database.
 * It can later be synced to BLOFY Cloud without migrating or touching playback state.
 */
object BlofyProfileStore {
    private const val PREFS = "blofy_profiles_v1"
    private const val KEY_PROFILES = "profiles"
    private const val KEY_ACTIVE = "active_profile"
    private const val MAX_PROFILES = 8

    data class Profile(
        val id: String,
        val name: String,
        val kidsMode: Boolean = false,
        val guest: Boolean = false,
        val pinEnabled: Boolean = false,
        val createdAt: Long = System.currentTimeMillis(),
    )

    fun all(context: Context): List<Profile> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PROFILES, null)
            ?: return listOf(defaultProfile()).also { saveAll(context, it) }
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    add(
                        Profile(
                            id = row.optString("id"),
                            name = row.optString("name"),
                            kidsMode = row.optBoolean("kidsMode"),
                            guest = row.optBoolean("guest"),
                            pinEnabled = row.optBoolean("pinEnabled"),
                            createdAt = row.optLong("createdAt").takeIf { it > 0L } ?: System.currentTimeMillis(),
                        )
                    )
                }
            }.filter { it.id.isNotBlank() && it.name.isNotBlank() }.ifEmpty { listOf(defaultProfile()) }
        }.getOrElse { listOf(defaultProfile()) }
    }

    fun active(context: Context): Profile {
        val profiles = all(context)
        val activeId = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIVE, null)
        return profiles.firstOrNull { it.id == activeId } ?: profiles.first().also { select(context, it.id) }
    }

    @Synchronized
    fun create(context: Context, name: String, kidsMode: Boolean = false, guest: Boolean = false): Profile {
        val cleanName = name.trim().take(32)
        require(cleanName.isNotBlank()) { "Profile name is required" }
        val current = all(context).filterNot { it.guest && guest }
        require(current.size < MAX_PROFILES) { "Profile limit reached" }
        val profile = Profile(
            id = UUID.randomUUID().toString(),
            name = cleanName,
            kidsMode = kidsMode,
            guest = guest,
        )
        saveAll(context, current + profile)
        return profile
    }

    @Synchronized
    fun update(context: Context, profile: Profile) {
        val profiles = all(context)
        require(profiles.any { it.id == profile.id }) { "Profile not found" }
        val clean = profile.copy(name = profile.name.trim().take(32))
        require(clean.name.isNotBlank()) { "Profile name is required" }
        saveAll(context, profiles.map { if (it.id == clean.id) clean else it })
    }

    @Synchronized
    fun delete(context: Context, profileId: String): Boolean {
        val profiles = all(context)
        if (profiles.size <= 1) return false
        val next = profiles.filterNot { it.id == profileId }
        if (next.size == profiles.size) return false
        saveAll(context, next)
        if (active(context).id == profileId) select(context, next.first().id)
        return true
    }

    fun select(context: Context, profileId: String): Boolean {
        if (all(context).none { it.id == profileId }) return false
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_ACTIVE, profileId).commit()
    }

    fun storageNamespace(context: Context): String = active(context).id

    private fun defaultProfile() = Profile(
        id = "primary",
        name = "Primary",
    )

    private fun saveAll(context: Context, profiles: List<Profile>) {
        val array = JSONArray()
        profiles.take(MAX_PROFILES).forEach { profile ->
            array.put(JSONObject().apply {
                put("id", profile.id)
                put("name", profile.name)
                put("kidsMode", profile.kidsMode)
                put("guest", profile.guest)
                put("pinEnabled", profile.pinEnabled)
                put("createdAt", profile.createdAt)
            })
        }
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_PROFILES, array.toString()).commit()) {
            "Unable to persist profiles"
        }
    }
}
