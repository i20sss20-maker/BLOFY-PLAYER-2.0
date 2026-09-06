package tv.blofy.player.core.profile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * Local BLOFY profiles. The catalog/playback engines stay shared; profile-owned UX state is
 * namespaced by profile id and can later be synchronized to BLOFY Cloud independently.
 */
object ProfileStore {
    data class Profile(
        val id: String,
        val name: String,
        val kids: Boolean,
        val pinHash: String?,
        val guest: Boolean = false,
        val createdAt: Long = System.currentTimeMillis(),
    )

    private const val PREFS = "blofy_profiles"
    private const val KEY_ACTIVE = "active_profile"
    private const val KEY_PROFILES = "profiles_v2"
    private const val MAX_PROFILES = 8

    private val legacyDefaults = listOf(
        Profile("main", "الرئيسي", false, null),
        Profile("kids", "أطفال", true, null)
    )

    fun all(context: Context): List<Profile> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_PROFILES, null)
        if (raw.isNullOrBlank()) {
            // Preserve PINs from the original two-profile implementation on first migration.
            val migrated = legacyDefaults.map { it.copy(pinHash = prefs.getString("pin_${it.id}", null)) }
            saveAll(context, migrated)
            return migrated
        }
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    val id = row.optString("id").trim()
                    val name = row.optString("name").trim()
                    if (id.isBlank() || name.isBlank()) continue
                    add(Profile(
                        id = id,
                        name = name.take(32),
                        kids = row.optBoolean("kids"),
                        pinHash = row.optString("pinHash").takeIf { it.isNotBlank() && it != "null" },
                        guest = row.optBoolean("guest"),
                        createdAt = row.optLong("createdAt").takeIf { it > 0L } ?: System.currentTimeMillis(),
                    ))
                }
            }.take(MAX_PROFILES).ifEmpty { legacyDefaults }
        }.getOrElse { legacyDefaults }
    }

    fun active(context: Context): Profile {
        val profiles = all(context)
        val id = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIVE, profiles.first().id)
        return profiles.firstOrNull { it.id == id } ?: profiles.first().also { select(context, it.id) }
    }

    @Synchronized
    fun create(context: Context, name: String, kids: Boolean = false, guest: Boolean = false): Profile {
        val clean = name.trim().take(32)
        require(clean.isNotBlank()) { "Profile name is required" }
        val current = all(context)
        require(current.size < MAX_PROFILES) { "Profile limit reached" }
        if (guest) require(current.none { it.guest }) { "Guest profile already exists" }
        val profile = Profile(UUID.randomUUID().toString(), clean, kids, null, guest)
        saveAll(context, current + profile)
        return profile
    }

    @Synchronized
    fun rename(context: Context, id: String, name: String): Boolean {
        val clean = name.trim().take(32)
        if (clean.isBlank()) return false
        val current = all(context)
        if (current.none { it.id == id }) return false
        saveAll(context, current.map { if (it.id == id) it.copy(name = clean) else it })
        return true
    }

    @Synchronized
    fun delete(context: Context, id: String): Boolean {
        val current = all(context)
        if (current.size <= 1 || current.none { it.id == id }) return false
        val next = current.filterNot { it.id == id }
        saveAll(context, next)
        if (active(context).id == id) select(context, next.first().id)
        return true
    }

    fun select(context: Context, id: String): Boolean {
        if (all(context).none { it.id == id }) return false
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ACTIVE, id).commit()
    }

    @Synchronized
    fun setPin(context: Context, id: String, pin: String?) {
        val current = all(context)
        if (current.none { it.id == id }) return
        val pinHash = pin?.takeIf { it.length in 4..8 && it.all(Char::isDigit) }?.let(::hash)
        saveAll(context, current.map { if (it.id == id) it.copy(pinHash = pinHash) else it })
    }

    fun verifyPin(profile: Profile, pin: String): Boolean = profile.pinHash == null || profile.pinHash == hash(pin)
    fun isKids(context: Context): Boolean = active(context).kids
    fun storageNamespace(context: Context): String = active(context).id

    private fun saveAll(context: Context, profiles: List<Profile>) {
        val array = JSONArray()
        profiles.take(MAX_PROFILES).forEach { profile ->
            array.put(JSONObject().apply {
                put("id", profile.id)
                put("name", profile.name)
                put("kids", profile.kids)
                put("pinHash", profile.pinHash ?: JSONObject.NULL)
                put("guest", profile.guest)
                put("createdAt", profile.createdAt)
            })
        }
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_PROFILES, array.toString()).commit()) { "Unable to persist profiles" }
    }

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
