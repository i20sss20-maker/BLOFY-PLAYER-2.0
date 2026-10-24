package tv.blofy.player.ui.home

import android.graphics.Rect
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.ScrollView
import tv.blofy.player.ui.catalog.ArtworkLoader

/**
 * Only bind poster artwork when it can be seen through the vertical AND horizontal
 * TV scroll containers. A Home with many shelves used to queue every image at once,
 * including rows the viewer could not see, competing with DPAD and SQLite work.
 *
 * Keeps the image views themselves stable for remote focus. This is not a RecyclerView
 * or a new playback/network subsystem.
 */
internal class HomePosterArtworkBinder(
    private val host: View,
    private val load: (ImageView, List<String?>) -> Unit = ArtworkLoader::loadPriority,
    private val cancel: (ImageView) -> Unit = ArtworkLoader::cancel,
    private val visible: (ImageView) -> Boolean = ::isActuallyVisible,
) {
    private val queued = LinkedHashMap<ImageView, List<String?>>()
    private val bound = LinkedHashSet<ImageView>()
    private var scheduled = false
    private val pulse = Runnable { scheduled = false; bindVisible() }

    fun stage(view: ImageView, sources: List<String?>) {
        queued[view] = sources
    }

    /** A focused item always gets priority even if the firmware scroll is one frame late. */
    fun focus(view: ImageView) {
        val sources = queued.remove(view) ?: return
        bound.add(view)
        load(view, sources)
    }

    /** Coalesce rapid wheel/remote scroll callbacks into one pass per frame. */
    fun onViewportChanged() {
        if (scheduled || queued.isEmpty()) return
        scheduled = true
        host.postOnAnimation(pulse)
    }

    private fun bindVisible() {
        var loaded = 0
        val iterator = queued.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (!visible(entry.key)) continue
            iterator.remove()
            bound.add(entry.key)
            load(entry.key, entry.value)
            if (++loaded >= VISIBLE_BATCH_LIMIT) break
        }
        // Large screens can display more than one batch; yield between batches.
        if (loaded == VISIBLE_BATCH_LIMIT) onViewportChanged()
    }

    fun clear() {
        host.removeCallbacks(pulse)
        scheduled = false
        queued.clear()
        bound.forEach(cancel)
        bound.clear()
    }

    /** Keep preserved rows bound when only history rows are replaced. */
    fun pruneDetached() {
        queued.keys.removeAll { !it.isAttachedToWindow }
        val iterator = bound.iterator()
        while (iterator.hasNext()) {
            val image = iterator.next()
            if (!image.isAttachedToWindow) {
                cancel(image)
                iterator.remove()
            }
        }
    }

    companion object {
        internal const val VISIBLE_BATCH_LIMIT = 8
    }
}

/**
 * Some Home shelves deliberately use clipChildren=false so focused posters can
 * scale past card edges. Check BOTH scroll viewports explicitly: Android's generic
 * getGlobalVisibleRect may include offscreen children in that configuration.
 */
internal fun isActuallyVisible(image: ImageView): Boolean {
    if (!image.isAttachedToWindow || !image.isShown) return false
    val imageBounds = Rect()
    val viewport = Rect()
    if (!image.getGlobalVisibleRect(imageBounds)) return false
    var ancestor = image.parent
    while (ancestor is View) {
        if (ancestor is ScrollView || ancestor is HorizontalScrollView) {
            if (!ancestor.getGlobalVisibleRect(viewport) || !imageBounds.intersect(viewport)) return false
        }
        ancestor = ancestor.parent
    }
    return imageBounds.width() > 0 && imageBounds.height() > 0
}
