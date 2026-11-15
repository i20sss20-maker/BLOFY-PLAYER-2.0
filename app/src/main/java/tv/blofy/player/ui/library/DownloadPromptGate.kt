package tv.blofy.player.ui.library

import java.util.WeakHashMap

/**
 * One optional download preflight at a time per activity. A weak owner key
 * avoids retaining a destroyed TV screen if its coroutine is cancelled.
 */
internal class DownloadPromptGate {
    private val inFlight = WeakHashMap<Any, Boolean>()

    @Synchronized
    fun enter(owner: Any): Boolean {
        if (inFlight.containsKey(owner)) return false
        inFlight[owner] = true
        return true
    }

    @Synchronized
    fun leave(owner: Any) {
        inFlight.remove(owner)
    }
}
