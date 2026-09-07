package tv.blofy.player.data.profile

import org.json.JSONArray
import org.json.JSONObject

/** Reapply edits made during a request without discarding unrelated changes from the server. */
internal object ProfileSnapshotEdits {
    fun rebase(before: JSONObject, current: JSONObject, incoming: JSONObject): JSONObject {
        val result = JSONObject(incoming.toString())
        for (key in listOf("watchlist", "hiddenCategories")) {
            val old = strings(before.optJSONArray(key))
            val now = strings(current.optJSONArray(key))
            val removed = old.toSet() - now.toSet()
            val added = now.toSet() - old.toSet()
            val values = LinkedHashSet(strings(incoming.optJSONArray(key))).apply {
                removeAll(removed)
                addAll(added)
            }.toList()
            result.put(key, JSONArray(if (key == "watchlist") values.takeLast(500) else values.take(500)))
        }
        if (strings(before.optJSONArray("homeRows")) != strings(current.optJSONArray("homeRows"))) {
            result.put("homeRows", current.optJSONArray("homeRows") ?: JSONArray())
        }
        val oldSettings = before.optJSONObject("settings") ?: JSONObject()
        val nowSettings = current.optJSONObject("settings") ?: JSONObject()
        val settings = JSONObject((incoming.optJSONObject("settings") ?: JSONObject()).toString())
        val keys = oldSettings.keys().asSequence().toSet() + nowSettings.keys().asSequence().toSet()
        keys.forEach { key ->
            when {
                !nowSettings.has(key) -> settings.remove(key)
                !oldSettings.has(key) || oldSettings.opt(key) != nowSettings.opt(key) -> settings.put(key, nowSettings.opt(key))
            }
        }
        result.put("settings", settings)
        return result
    }

    private fun strings(array: JSONArray?): List<String> = if (array == null) emptyList() else
        (0 until array.length()).map { array.optString(it) }.filter(String::isNotBlank).distinct()
}
