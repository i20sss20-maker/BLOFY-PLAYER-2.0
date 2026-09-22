package tv.blofy.player.data.preparation

import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicInteger

/** A slow URL occupies one worker, not the whole next group. Memory stays bounded by one page. */
internal suspend fun <T> forEachDownload(items: List<T>, concurrency: Int, action: suspend (T) -> Unit) = coroutineScope {
    require(concurrency > 0)
    val next = AtomicInteger()
    repeat(minOf(concurrency, items.size)) {
        launch {
            while (true) {
                ensureActive()
                val index = next.getAndIncrement()
                if (index >= items.size) break
                action(items[index])
            }
        }
    }
}
