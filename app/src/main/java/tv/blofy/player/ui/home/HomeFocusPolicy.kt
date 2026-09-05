package tv.blofy.player.ui.home

/** Physical left/right within an RTL row. Sidebar is reachable only from the left edge. */
object HomeFocusPolicy {
    sealed class Move {
        data class Item(val index: Int) : Move()
        object Sidebar : Move()
        object Stay : Move()
    }

    fun horizontal(index: Int, size: Int, left: Boolean, rtl: Boolean): Move {
        if (index !in 0 until size) return Move.Stay
        val step = if (left == rtl) 1 else -1
        val next = index + step
        return if (next in 0 until size) Move.Item(next) else if (left) Move.Sidebar else Move.Stay
    }

    fun row(key: String): String? = when {
        key.startsWith("poster_") -> key.substringBeforeLast('_').substringBeforeLast('_')
        key.startsWith("top10_") -> "top10"
        key == "hero_watch" || key == "hero_movies" -> "hero"
        key.endsWith("_story") -> "stories"
        else -> null
    }
}
