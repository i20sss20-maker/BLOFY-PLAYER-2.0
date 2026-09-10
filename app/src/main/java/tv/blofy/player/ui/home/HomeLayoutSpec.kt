package tv.blofy.player.ui.home

/** Uses the current window so a tablet in split screen receives the compact layout. */
internal data class HomeLayoutSpec(val width: Int, val height: Int, val remote: Boolean) {
    val compact = !remote && width < 600
    val gutter = if (compact) 16 else if (remote) 20 else 18
    val railWidth = if (remote) 124 else 136
    val railRowHeight = if (remote) ((height - 116) / 8 - 6).coerceIn(30, 36) else 48
    val posterWidth = when {
        compact -> ((width - gutter * 2 - 28) / 2.5f).toInt().coerceIn(104, 148)
        width < 1000 -> 122
        else -> 140
    }
    val heroHeight = when {
        compact -> (height * .56f).toInt().coerceIn(340, 430)
        remote && height <= 600 -> 224
        else -> 274
    }
    val actionHeight = if (remote) 34 else 48
}
