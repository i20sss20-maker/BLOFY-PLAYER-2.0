package tv.blofy.player.core.profile

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.local.BlofyDatabase

/**
 * Enforces a conservative local Kids profile policy before protected content can stay open.
 * Playback engines are intentionally untouched; this guard works above playback by closing
 * content screens whose locally cached metadata clearly marks them as adult-oriented.
 */
class KidsContentGuard : Application.ActivityLifecycleCallbacks {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (!ProfileStore.isKids(activity.applicationContext)) return

        val contentKey = activity.intent?.getStringExtra("content_key").orEmpty()
        if (contentKey.isBlank()) return

        scope.launch {
            val blocked = runCatching {
                val stream = BlofyDatabase.get(activity.applicationContext).dao().stream(contentKey) ?: return@runCatching false
                KidsPolicy.isBlocked(
                    title = stream.name,
                    genre = stream.genre,
                    plot = stream.plot,
                ) || stream.locked
            }.getOrDefault(false)

            if (blocked) withContext(Dispatchers.Main) {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    Toast.makeText(activity, "This title is hidden in Kids Mode", Toast.LENGTH_SHORT).show()
                    activity.finish()
                }
            }
        }
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}

object KidsPolicy {
    private val blockedTerms = listOf(
        "adult", "adults only", "18+", "+18", "18 plus", "r18", "r18+", "nc-17", "nc17", "tv-ma",
        "xxx", "porn", "erotic", "erotica", "sex", "sexual", "nude", "nudity", "uncensored", "playboy",
        "للكبار", "للبالغين", "بالغين", "18 سنة", "+18", "اباح", "إباح", "جنسي", "جنسية", "عري"
    )

    // Keep this intentionally explicit. Kids Mode must hide clearly marked adult content without
    // guessing from ordinary drama/action words and accidentally removing normal catalog items.
    fun isBlocked(title: String?, genre: String?, plot: String?): Boolean {
        val haystack = listOf(title, genre, plot)
            .filterNotNull()
            .joinToString(" ")
            .lowercase()
            .replace('_', ' ')
        if (haystack.isBlank()) return false
        return blockedTerms.any { term ->
            val normalized = term.lowercase()
            haystack.contains(normalized)
        }
    }
}
